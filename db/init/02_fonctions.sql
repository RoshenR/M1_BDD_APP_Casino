-- =============================================================================
-- 02 · FONCTIONS & PROCEDURES (PL/pgSQL)
-- =============================================================================
-- MODULE 04. Toute la logique de jeu vit ici, dans la base.
--
-- Pourquoi ? (slide 39)
--   · un seul aller-retour reseau : CALL jouer_roulette(...) au lieu de 5 requetes
--   · la regle s'applique a TOUS les clients : web, script, pgAdmin, BI
--   · atomicite : debit de la mise + tirage + credit du gain = une transaction
--   · securite : l'API recoit EXECUTE, et AUCUN droit d'ecriture sur les tables
--
-- C'est ce dernier point qui compte le plus : meme avec une injection SQL dans
-- l'API, personne ne peut se crediter un million (voir 05_securite.sql).
-- =============================================================================

\echo '=== 02 · fonctions et procedures ==='

SET search_path = casino, public;


-- =============================================================================
-- PROVABLY FAIR — un hasard verifiable par le joueur
-- =============================================================================
-- Le casino tire un server_seed secret et publie son SHA-256 AVANT la partie.
-- Le joueur fournit son client_seed. Chaque carte / numero / symbole est derive
-- de HMAC(server_seed, client_seed:nonce:index). Une fois la partie terminee,
-- le server_seed est revele : le joueur rejoue le calcul et verifie.
--
-- Le casino ne peut donc pas choisir le resultat apres coup : le hash l'engage.
-- =============================================================================

CREATE OR REPLACE FUNCTION hash_seed(p_seed text)
RETURNS text
LANGUAGE sql
IMMUTABLE                                   -- meme entree -> meme sortie, ne lit pas la base
AS $$
  SELECT encode(digest(p_seed, 'sha256'), 'hex')
$$;

COMMENT ON FUNCTION hash_seed(text) IS 'Engagement publie avant la partie (provably fair).';


CREATE OR REPLACE FUNCTION alea(
  p_server_seed text,
  p_client_seed text,
  p_nonce       int,
  p_index       int,
  p_borne       int
)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  -- Les 4 premiers octets du HMAC, lus comme un entier non signe 32 bits.
  -- get_byte() evite le piege du cast bit(32)::int qui peut rendre un negatif.
  SELECT (
    (
      (get_byte(h, 0)::bigint << 24) |
      (get_byte(h, 1)::bigint << 16) |
      (get_byte(h, 2)::bigint <<  8) |
       get_byte(h, 3)::bigint
    ) % p_borne
  )::int
  FROM hmac(
         p_client_seed || ':' || p_nonce || ':' || p_index,
         p_server_seed,
         'sha256'
       ) AS h
$$;

COMMENT ON FUNCTION alea(text, text, int, int, int) IS 'Tirage deterministe dans [0, p_borne). Rejouable par le joueur une fois le server_seed revele.';


CREATE OR REPLACE FUNCTION verifier_partie(p_partie_id bigint)
RETURNS TABLE (partie_id bigint, hash_publie text, hash_recalcule text, conforme boolean)
LANGUAGE sql
STABLE                                      -- lit la base, stable le temps d'une requete
AS $$
  SELECT p.id,
         p.server_seed_hash,
         hash_seed(p.server_seed),
         p.server_seed_hash = hash_seed(p.server_seed)
  FROM parties p
  WHERE p.id = p_partie_id
    AND p.statut = 'terminee'               -- le seed n'est revele qu'apres
$$;

COMMENT ON FUNCTION verifier_partie(bigint) IS 'Le joueur verifie que le seed revele correspond bien au hash publie avant la partie.';


-- =============================================================================
-- MOUVEMENTS D'ARGENT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- _mouvement() : la SEULE porte d'entree du grand livre.
-- Verrouille la ligne joueur (FOR UPDATE) pour que deux parties simultanees ne
-- puissent pas lire le meme solde et le depenser deux fois.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _mouvement(
  p_joueur_id int,
  p_type      text,
  p_montant   numeric,
  p_partie_id bigint DEFAULT NULL,
  p_libelle   text   DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_solde numeric(14,2);
BEGIN
  SELECT solde INTO v_solde
  FROM joueurs
  WHERE id = p_joueur_id
  FOR UPDATE;                               -- verrou : serialise les mouvements du joueur

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Joueur % introuvable', p_joueur_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_solde := v_solde + p_montant;

  IF v_solde < 0 THEN
    RAISE EXCEPTION 'Solde insuffisant : il manque % jetons', -v_solde
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO transactions (joueur_id, partie_id, type, montant, solde_apres, libelle)
  VALUES (p_joueur_id, p_partie_id, p_type, p_montant, v_solde, p_libelle);
  -- trg_maj_solde reporte ensuite solde_apres sur joueurs.solde.

  RETURN v_solde;
END;
$$;

COMMENT ON FUNCTION _mouvement(int, text, numeric, bigint, text) IS 'Interne. Ecrit une ligne du grand livre sous verrou. Ne jamais accorder EXECUTE dessus a l''API.';


CREATE OR REPLACE PROCEDURE deposer(p_joueur_id int, p_montant numeric)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  IF p_montant <= 0 THEN
    RAISE EXCEPTION 'Le depot doit etre strictement positif (recu : %)', p_montant;
  END IF;
  IF p_montant > 10000 THEN
    RAISE EXCEPTION 'Depot plafonne a 10 000 jetons par operation (demande : %)', p_montant;
  END IF;

  PERFORM _mouvement(p_joueur_id, 'depot', p_montant, NULL, 'Depot de jetons');
END;
$$;


CREATE OR REPLACE PROCEDURE retirer(p_joueur_id int, p_montant numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  v_mise_en_cours numeric;
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  IF p_montant <= 0 THEN
    RAISE EXCEPTION 'Le retrait doit etre strictement positif (recu : %)', p_montant;
  END IF;

  -- On ne retire pas des jetons engages dans une main de blackjack en cours.
  SELECT coalesce(sum(mise), 0) INTO v_mise_en_cours
  FROM parties
  WHERE joueur_id = p_joueur_id AND statut = 'en_cours';

  IF v_mise_en_cours > 0 THEN
    RAISE EXCEPTION 'Partie en cours : terminez-la avant de retirer (% jetons engages)', v_mise_en_cours;
  END IF;

  PERFORM _mouvement(p_joueur_id, 'retrait', -p_montant, NULL, 'Retrait de jetons');
END;
$$;


-- -----------------------------------------------------------------------------
-- transferer_jetons() — le virement, cas d'ecole de l'atomicite
-- -----------------------------------------------------------------------------
-- Debiter A et crediter B sont DEUX ecritures. Si la seconde echoue et que la
-- premiere est deja validee, des jetons disparaissent. C'est exactement ce que
-- garantit une transaction : tout ou rien (TCL, slide 4).
--
-- Cote application il faudrait BEGIN / 4 requetes / COMMIT, avec la gestion
-- d'erreur qui va avec. Ici, un seul CALL, et l'atomicite est acquise.
--
-- Le transfert est aussi enregistre dans la table transferts : trois joueurs
-- qui se renvoient les memes jetons en boucle forment un cycle, que
-- detecter_collusion() retrouve en WITH RECURSIVE ... CYCLE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE transferer_jetons(
  p_de      int,
  p_vers    int,
  p_montant numeric,
  p_message text DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_pseudo_de   text;
  v_pseudo_vers text;
  v_statut      text;
BEGIN
  PERFORM _exiger_identite(p_de);

  IF p_de = p_vers THEN
    RAISE EXCEPTION 'Transfert vers soi-meme refuse';
  END IF;
  IF p_montant <= 0 THEN
    RAISE EXCEPTION 'Le montant doit etre strictement positif (recu : %)', p_montant;
  END IF;
  IF p_montant > 5000 THEN
    RAISE EXCEPTION 'Transfert plafonne a 5 000 jetons (demande : %)', p_montant;
  END IF;

  -- Les deux comptes doivent exister et etre actifs.
  SELECT pseudo INTO v_pseudo_de FROM joueurs WHERE id = p_de;
  SELECT pseudo, statut INTO v_pseudo_vers, v_statut FROM joueurs WHERE id = p_vers;

  IF v_pseudo_vers IS NULL THEN
    RAISE EXCEPTION 'Destinataire % introuvable', p_vers;
  ELSIF v_statut <> 'actif' THEN
    RAISE EXCEPTION 'Le compte de % n''est pas actif', v_pseudo_vers;
  END IF;

  -- Verrouillage dans l'ordre des identifiants : deux transferts croises
  -- (A vers B et B vers A en meme temps) ne peuvent pas s'interbloquer.
  IF p_de < p_vers THEN
    PERFORM 1 FROM joueurs WHERE id = p_de   FOR UPDATE;
    PERFORM 1 FROM joueurs WHERE id = p_vers FOR UPDATE;
  ELSE
    PERFORM 1 FROM joueurs WHERE id = p_vers FOR UPDATE;
    PERFORM 1 FROM joueurs WHERE id = p_de   FOR UPDATE;
  END IF;

  -- Si le debit echoue (solde insuffisant), le credit n'a jamais lieu.
  PERFORM _mouvement(p_de, 'transfert_envoye', -p_montant, NULL,
                     'Transfert vers ' || v_pseudo_vers || coalesce(' : ' || p_message, ''));
  INSERT INTO transferts (expediteur_id, destinataire_id, montant, message)
  VALUES (p_de, p_vers, p_montant, p_message);

  PERFORM _mouvement(p_vers, 'transfert_recu', p_montant, NULL,
                     'Transfert de ' || v_pseudo_de || coalesce(' : ' || p_message, ''));
END;
$$;

COMMENT ON PROCEDURE transferer_jetons(int, int, numeric, text) IS 'Virement entre joueurs. Deux ecritures, une transaction : impossible de perdre ou de creer des jetons.';


-- -----------------------------------------------------------------------------
-- rembourser_partie() — le pendant de rembourser_commande() du TP 04.
-- Controle du statut, puis mouvement compensatoire. Pas de DELETE : le grand
-- livre est immuable, on ecrit une ligne inverse.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE rembourser_partie(p_partie_id bigint, p_motif text DEFAULT 'Litige')
LANGUAGE plpgsql
AS $$
DECLARE
  v_partie parties;
BEGIN
  SELECT * INTO v_partie FROM parties WHERE id = p_partie_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie % introuvable', p_partie_id;
  ELSIF v_partie.statut = 'annulee' THEN
    RAISE EXCEPTION 'Partie % deja remboursee', p_partie_id;
  ELSIF v_partie.statut = 'en_cours' THEN
    RAISE EXCEPTION 'Partie % encore en cours : impossible de rembourser', p_partie_id;
  END IF;

  -- On rend la mise et on reprend le gain eventuellement verse.
  PERFORM _mouvement(v_partie.joueur_id, 'remboursement', v_partie.mise, p_partie_id,
                     'Remboursement : ' || p_motif);

  IF v_partie.gain > 0 THEN
    PERFORM _mouvement(v_partie.joueur_id, 'retrait', -v_partie.gain, p_partie_id,
                       'Reprise du gain annule');
  END IF;

  UPDATE parties SET statut = 'annulee' WHERE id = p_partie_id;
END;
$$;


-- =============================================================================
-- VALIDATION D'UNE MISE
-- =============================================================================
-- Renvoie l'id du jeu si tout est bon, leve une exception explicite sinon.
-- Les memes regles sont re-verifiees par trg_verifier_mise : la fonction donne
-- un message lisible, le trigger garantit la regle meme si on l'a contournee.
-- =============================================================================
CREATE OR REPLACE FUNCTION _valider_mise(p_joueur_id int, p_code_jeu text, p_mise numeric)
RETURNS int
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_joueur joueurs;
  v_jeu    jeux;
BEGIN
  -- Toutes les mises passent par ici : c'est le bon endroit pour le garde-fou.
  PERFORM _exiger_identite(p_joueur_id);

  SELECT * INTO v_joueur FROM joueurs WHERE id = p_joueur_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Joueur % introuvable', p_joueur_id;
  END IF;

  IF v_joueur.statut <> 'actif' THEN
    RAISE EXCEPTION 'Compte % : statut % — jeu impossible', v_joueur.pseudo, v_joueur.statut;
  END IF;

  IF v_joueur.exclu_jusqu_au IS NOT NULL AND v_joueur.exclu_jusqu_au > now() THEN
    RAISE EXCEPTION 'Auto-exclusion active jusqu''au %', to_char(v_joueur.exclu_jusqu_au, 'DD/MM/YYYY HH24:MI');
  END IF;

  SELECT * INTO v_jeu FROM jeux WHERE code = p_code_jeu;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jeu % inconnu', p_code_jeu;
  ELSIF NOT v_jeu.actif THEN
    RAISE EXCEPTION 'Le jeu % est temporairement ferme', v_jeu.nom;
  END IF;

  IF p_mise < v_jeu.mise_min OR p_mise > v_jeu.mise_max THEN
    RAISE EXCEPTION 'Mise hors bornes pour % : attendu entre % et % (recu : %)',
                    v_jeu.nom, v_jeu.mise_min, v_jeu.mise_max, p_mise;
  END IF;

  IF v_joueur.limite_mise IS NOT NULL AND p_mise > v_joueur.limite_mise THEN
    RAISE EXCEPTION 'Mise superieure a votre limite personnelle (% jetons)', v_joueur.limite_mise;
  END IF;

  RETURN v_jeu.id;
END;
$$;


-- -----------------------------------------------------------------------------
-- _nouvelle_partie() : cree la partie et debite la mise, atomiquement.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _nouvelle_partie(
  p_joueur_id   int,
  p_jeu_id      int,
  p_mise        numeric,
  p_client_seed text
)
RETURNS parties
LANGUAGE plpgsql
AS $$
DECLARE
  v_seed   text := encode(gen_random_bytes(32), 'hex');
  v_nonce  int;
  v_partie parties;
BEGIN
  -- Le nonce croit avec le nombre de parties du joueur : deux parties du meme
  -- joueur avec le meme client_seed ne peuvent pas donner le meme tirage.
  SELECT count(*)::int INTO v_nonce FROM parties WHERE joueur_id = p_joueur_id;

  INSERT INTO parties (joueur_id, jeu_id, mise, statut,
                       server_seed, server_seed_hash, client_seed, nonce)
  VALUES (p_joueur_id, p_jeu_id, p_mise, 'en_cours',
          v_seed, hash_seed(v_seed), coalesce(nullif(p_client_seed, ''), 'defaut'), v_nonce)
  RETURNING * INTO v_partie;

  PERFORM _mouvement(p_joueur_id, 'mise', -p_mise, v_partie.id, 'Mise');

  RETURN v_partie;
END;
$$;


-- -----------------------------------------------------------------------------
-- _cloturer_partie() : ecrit le resultat et credite le gain eventuel.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _cloturer_partie(
  p_partie_id bigint,
  p_gain      numeric,
  p_resultat  text,
  p_etat      jsonb DEFAULT NULL
)
RETURNS parties
LANGUAGE plpgsql
AS $$
DECLARE
  v_partie parties;
BEGIN
  UPDATE parties
  SET gain        = p_gain,
      resultat    = p_resultat,
      statut      = 'terminee',
      terminee_le = now(),
      etat        = coalesce(p_etat, etat)
  WHERE id = p_partie_id
  RETURNING * INTO v_partie;

  IF p_gain > 0 THEN
    PERFORM _mouvement(v_partie.joueur_id, 'gain', p_gain, p_partie_id,
                       'Gain : ' || p_resultat);
  END IF;

  RETURN v_partie;
END;
$$;


-- =============================================================================
-- JEU 1 · ROULETTE EUROPEENNE  (37 cases : 0 a 36)
-- =============================================================================
-- RTP = 36/37 = 97,30 % quel que soit le pari : c'est le zero, et lui seul,
-- qui fait la marge du casino.
-- =============================================================================

CREATE OR REPLACE FUNCTION roulette_est_rouge(p_numero int)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_numero IN (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36)
$$;


-- Combien rapporte 1 jeton mise sur p_pari si le tirage donne p_numero ?
-- (0 = perdu ; 2 = mise doublee ; 36 = plein)
CREATE OR REPLACE FUNCTION roulette_multiplicateur(p_pari text, p_numero int)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type  text := split_part(p_pari, ':', 1);
  v_arg   text := split_part(p_pari, ':', 2);
BEGIN
  -- Le zero rafle tout sauf un plein gagnant.
  IF p_numero = 0 THEN
    RETURN CASE WHEN v_type = 'plein' AND v_arg = '0' THEN 36 ELSE 0 END;
  END IF;

  RETURN CASE v_type
    WHEN 'rouge'    THEN CASE WHEN     roulette_est_rouge(p_numero) THEN 2 ELSE 0 END
    WHEN 'noir'     THEN CASE WHEN NOT roulette_est_rouge(p_numero) THEN 2 ELSE 0 END
    WHEN 'pair'     THEN CASE WHEN p_numero % 2 = 0 THEN 2 ELSE 0 END
    WHEN 'impair'   THEN CASE WHEN p_numero % 2 = 1 THEN 2 ELSE 0 END
    WHEN 'manque'   THEN CASE WHEN p_numero BETWEEN  1 AND 18 THEN 2 ELSE 0 END
    WHEN 'passe'    THEN CASE WHEN p_numero BETWEEN 19 AND 36 THEN 2 ELSE 0 END
    WHEN 'douzaine' THEN CASE WHEN ((p_numero - 1) / 12) + 1 = v_arg::int THEN 3 ELSE 0 END
    WHEN 'colonne'  THEN CASE WHEN ((p_numero - 1) % 3)  + 1 = v_arg::int THEN 3 ELSE 0 END
    WHEN 'plein'    THEN CASE WHEN p_numero = v_arg::int THEN 36 ELSE 0 END
    ELSE NULL
  END;
END;
$$;


CREATE OR REPLACE FUNCTION jouer_roulette(
  p_joueur_id   int,
  p_mise        numeric,
  p_pari        text,
  p_client_seed text DEFAULT 'defaut'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_jeu_id int;
  v_partie parties;
  v_numero int;
  v_mult   numeric;
  v_gain   numeric;
  v_etat   jsonb;
BEGIN
  v_jeu_id := _valider_mise(p_joueur_id, 'roulette', p_mise);

  IF roulette_multiplicateur(p_pari, 1) IS NULL THEN
    RAISE EXCEPTION 'Pari "%" invalide. Attendu : rouge, noir, pair, impair, manque, passe, douzaine:1-3, colonne:1-3, plein:0-36', p_pari;
  END IF;

  v_partie := _nouvelle_partie(p_joueur_id, v_jeu_id, p_mise, p_client_seed);

  v_numero := alea(v_partie.server_seed, v_partie.client_seed, v_partie.nonce, 0, 37);
  v_mult   := roulette_multiplicateur(p_pari, v_numero);
  v_gain   := round(p_mise * v_mult, 2);

  v_etat := jsonb_build_object(
    'pari',    p_pari,
    'numero',  v_numero,
    'couleur', CASE WHEN v_numero = 0 THEN 'vert'
                    WHEN roulette_est_rouge(v_numero) THEN 'rouge'
                    ELSE 'noir' END
  );

  v_partie := _cloturer_partie(v_partie.id, v_gain,
                               CASE WHEN v_gain > 0 THEN 'gagne' ELSE 'perdu' END,
                               v_etat);

  RETURN jsonb_build_object(
    'partie_id',   v_partie.id,
    'jeu',         'roulette',
    'mise',        p_mise,
    'gain',        v_gain,
    'resultat',    v_partie.resultat,
    'etat',        v_etat,
    'server_seed', v_partie.server_seed,     -- revele : la partie est finie
    'seed_hash',   v_partie.server_seed_hash,
    'solde',       (SELECT solde FROM joueurs WHERE id = p_joueur_id)
  );
END;
$$;

COMMENT ON FUNCTION jouer_roulette(int, numeric, text, text) IS 'Roulette europeenne. Debit, tirage et credit dans une seule transaction.';


-- =============================================================================
-- JEU 2 · MACHINE A SOUS  (3 rouleaux, 7 symboles ponderes)
-- =============================================================================
-- Table de gains :
--   3 identiques -> multiplicateur du symbole
--   exactement 2 identiques -> mise rendue (x1)
-- RTP theorique ~ 92,4 % — et 09_demo mesure le RTP REEL sur les parties jouees.
-- =============================================================================

CREATE OR REPLACE FUNCTION machine_symbole(p_tirage int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- 100 crans sur le rouleau, repartis selon la rarete voulue.
  SELECT CASE
    WHEN p_tirage <  25 THEN 'cerise'    -- 25 %
    WHEN p_tirage <  47 THEN 'citron'    -- 22 %
    WHEN p_tirage <  65 THEN 'raisin'    -- 18 %
    WHEN p_tirage <  79 THEN 'pasteque'  -- 14 %
    WHEN p_tirage <  89 THEN 'cloche'    -- 10 %
    WHEN p_tirage <  96 THEN 'diamant'   --  7 %
    ELSE                     'sept'      --  4 %
  END
$$;

CREATE OR REPLACE FUNCTION machine_multiplicateur(p_symbole text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_symbole
    WHEN 'cerise'   THEN    5
    WHEN 'citron'   THEN    8
    WHEN 'raisin'   THEN   12
    WHEN 'pasteque' THEN   25
    WHEN 'cloche'   THEN   60
    WHEN 'diamant'  THEN  200
    WHEN 'sept'     THEN 1000
  END::numeric
$$;


CREATE OR REPLACE FUNCTION jouer_machine(
  p_joueur_id   int,
  p_mise        numeric,
  p_client_seed text DEFAULT 'defaut'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_jeu_id   int;
  v_partie   parties;
  v_rouleaux text[];
  v_gain     numeric := 0;
  v_combo    text;
  v_etat     jsonb;
BEGIN
  v_jeu_id := _valider_mise(p_joueur_id, 'machine', p_mise);
  v_partie := _nouvelle_partie(p_joueur_id, v_jeu_id, p_mise, p_client_seed);

  SELECT array_agg(
           machine_symbole(alea(v_partie.server_seed, v_partie.client_seed, v_partie.nonce, i, 100))
           ORDER BY i
         )
  INTO v_rouleaux
  FROM generate_series(0, 2) AS i;

  IF v_rouleaux[1] = v_rouleaux[2] AND v_rouleaux[2] = v_rouleaux[3] THEN
    v_gain  := round(p_mise * machine_multiplicateur(v_rouleaux[1]), 2);
    v_combo := 'trois ' || v_rouleaux[1];
  ELSIF v_rouleaux[1] = v_rouleaux[2]
     OR v_rouleaux[2] = v_rouleaux[3]
     OR v_rouleaux[1] = v_rouleaux[3] THEN
    v_gain  := p_mise;                      -- mise rendue
    v_combo := 'paire';
  ELSE
    v_combo := 'rien';
  END IF;

  v_etat := jsonb_build_object('rouleaux', to_jsonb(v_rouleaux), 'combinaison', v_combo);

  v_partie := _cloturer_partie(v_partie.id, v_gain,
                               CASE WHEN v_gain > p_mise THEN 'gagne'
                                    WHEN v_gain = p_mise THEN 'egalite'
                                    ELSE 'perdu' END,
                               v_etat);

  RETURN jsonb_build_object(
    'partie_id',   v_partie.id,
    'jeu',         'machine',
    'mise',        p_mise,
    'gain',        v_gain,
    'resultat',    v_partie.resultat,
    'etat',        v_etat,
    'server_seed', v_partie.server_seed,
    'seed_hash',   v_partie.server_seed_hash,
    'solde',       (SELECT solde FROM joueurs WHERE id = p_joueur_id)
  );
END;
$$;


-- =============================================================================
-- JEU 3 · BLACKJACK
-- =============================================================================
-- Le seul jeu qui se joue en plusieurs coups : son etat intermediaire est
-- stocke dans parties.etat (jsonb) et la partie reste 'en_cours' entre deux
-- appels. Sabot infini (comme un sabot de 8 jeux melange en continu) : chaque
-- carte est tiree independamment.
--
-- Cartes codees 0..51 : valeur = (c % 13) + 1, couleur = c / 13.
-- =============================================================================

CREATE OR REPLACE FUNCTION bj_valeur(p_carte int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT least((p_carte % 13) + 1, 10)      -- V, D, R valent 10 ; l'As vaut 1 ici
$$;

CREATE OR REPLACE FUNCTION bj_nom(p_carte int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (ARRAY['A','2','3','4','5','6','7','8','9','10','V','D','R'])[(p_carte % 13) + 1]
      || (ARRAY['♠','♥','♦','♣'])[(p_carte / 13) + 1]
$$;


-- Total d'une main, As compte 11 tant que ca ne fait pas sauter.
CREATE OR REPLACE FUNCTION bj_total(p_cartes int[])
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total int := 0;
  v_as    int := 0;
  v_carte int;
BEGIN
  FOREACH v_carte IN ARRAY p_cartes LOOP
    v_total := v_total + bj_valeur(v_carte);
    IF (v_carte % 13) = 0 THEN              -- c'est un As
      v_as := v_as + 1;
    END IF;
  END LOOP;

  -- Remonter chaque As de 1 a 11 tant que le total le supporte.
  WHILE v_as > 0 AND v_total + 10 <= 21 LOOP
    v_total := v_total + 10;
    v_as    := v_as - 1;
  END LOOP;

  RETURN v_total;
END;
$$;


CREATE OR REPLACE FUNCTION _bj_vue(p_partie parties, p_devoiler boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_joueur   int[] := ARRAY(SELECT jsonb_array_elements_text(p_partie.etat->'joueur')::int);
  v_croupier int[] := ARRAY(SELECT jsonb_array_elements_text(p_partie.etat->'croupier')::int);
BEGIN
  RETURN jsonb_build_object(
    'partie_id', p_partie.id,
    'jeu',       'blackjack',
    'mise',      p_partie.mise,
    'gain',      p_partie.gain,
    'statut',    p_partie.statut,
    'resultat',  p_partie.resultat,
    'joueur', jsonb_build_object(
      'cartes', (SELECT jsonb_agg(bj_nom(c) ORDER BY i) FROM unnest(v_joueur) WITH ORDINALITY t(c, i)),
      'total',  bj_total(v_joueur)
    ),
    'croupier', jsonb_build_object(
      -- Tant que la main n'est pas finie, la deuxieme carte du croupier reste cachee.
      'cartes', CASE WHEN p_devoiler
                     THEN (SELECT jsonb_agg(bj_nom(c) ORDER BY i) FROM unnest(v_croupier) WITH ORDINALITY t(c, i))
                     ELSE jsonb_build_array(bj_nom(v_croupier[1]), '??') END,
      'total',  CASE WHEN p_devoiler THEN bj_total(v_croupier) ELSE bj_valeur(v_croupier[1]) END
    ),
    'actions', CASE WHEN p_partie.statut = 'en_cours'
                    THEN CASE WHEN jsonb_array_length(p_partie.etat->'joueur') = 2
                              THEN jsonb_build_array('tirer', 'rester', 'doubler')
                              ELSE jsonb_build_array('tirer', 'rester') END
                    ELSE jsonb_build_array() END,
    'server_seed', CASE WHEN p_partie.statut = 'terminee' THEN p_partie.server_seed ELSE NULL END,
    'seed_hash',   p_partie.server_seed_hash,
    'solde',       (SELECT solde FROM joueurs WHERE id = p_partie.joueur_id)
  );
END;
$$;


-- Le croupier tire jusqu'a 17, puis on compare. Credite le gain et clot.
CREATE OR REPLACE FUNCTION _bj_denouement(p_partie_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_partie   parties;
  v_joueur   int[];
  v_croupier int[];
  v_index    int;
  v_tj       int;
  v_tc       int;
  v_gain     numeric := 0;
  v_resultat text;
  v_bj       boolean;
BEGIN
  SELECT * INTO v_partie FROM parties WHERE id = p_partie_id FOR UPDATE;

  v_joueur   := ARRAY(SELECT jsonb_array_elements_text(v_partie.etat->'joueur')::int);
  v_croupier := ARRAY(SELECT jsonb_array_elements_text(v_partie.etat->'croupier')::int);
  v_index    := (v_partie.etat->>'tirages')::int;
  v_tj       := bj_total(v_joueur);

  IF v_tj > 21 THEN
    -- Le joueur a saute : le croupier n'a meme pas besoin de jouer.
    v_resultat := 'perdu';
  ELSE
    -- Le croupier tire tant qu'il est sous 17 (regle "stand on soft 17").
    LOOP
      v_tc := bj_total(v_croupier);
      EXIT WHEN v_tc >= 17;
      v_croupier := v_croupier || alea(v_partie.server_seed, v_partie.client_seed, v_partie.nonce, v_index, 52);
      v_index := v_index + 1;
    END LOOP;

    v_tc := bj_total(v_croupier);
    v_bj := (v_tj = 21 AND array_length(v_joueur, 1) = 2);

    IF v_bj AND NOT (v_tc = 21 AND array_length(v_croupier, 1) = 2) THEN
      v_resultat := 'blackjack';
      v_gain     := round(v_partie.mise * 2.5, 2);   -- paye 3:2
    ELSIF v_tc > 21 OR v_tj > v_tc THEN
      v_resultat := 'gagne';
      v_gain     := v_partie.mise * 2;
    ELSIF v_tj = v_tc THEN
      v_resultat := 'egalite';
      v_gain     := v_partie.mise;                   -- mise rendue
    ELSE
      v_resultat := 'perdu';
    END IF;
  END IF;

  v_partie := _cloturer_partie(
    p_partie_id, v_gain, v_resultat,
    jsonb_build_object('joueur',   to_jsonb(v_joueur),
                       'croupier', to_jsonb(v_croupier),
                       'tirages',  v_index)
  );

  RETURN _bj_vue(v_partie, true);
END;
$$;


CREATE OR REPLACE FUNCTION blackjack_commencer(
  p_joueur_id   int,
  p_mise        numeric,
  p_client_seed text DEFAULT 'defaut'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_jeu_id int;
  v_partie parties;
  v_cartes int[];
BEGIN
  v_jeu_id := _valider_mise(p_joueur_id, 'blackjack', p_mise);

  IF EXISTS (SELECT 1 FROM parties WHERE joueur_id = p_joueur_id AND statut = 'en_cours') THEN
    RAISE EXCEPTION 'Vous avez deja une main en cours : terminez-la d''abord';
  END IF;

  v_partie := _nouvelle_partie(p_joueur_id, v_jeu_id, p_mise, p_client_seed);

  -- 4 cartes : joueur, croupier, joueur, croupier — comme a une vraie table.
  SELECT array_agg(alea(v_partie.server_seed, v_partie.client_seed, v_partie.nonce, i, 52) ORDER BY i)
  INTO v_cartes
  FROM generate_series(0, 3) AS i;

  UPDATE parties
  SET etat = jsonb_build_object(
        'joueur',   jsonb_build_array(v_cartes[1], v_cartes[3]),
        'croupier', jsonb_build_array(v_cartes[2], v_cartes[4]),
        'tirages',  4)
  WHERE id = v_partie.id
  RETURNING * INTO v_partie;

  -- Blackjack naturel : la main se resout immediatement.
  IF bj_total(ARRAY[v_cartes[1], v_cartes[3]]) = 21 THEN
    RETURN _bj_denouement(v_partie.id);
  END IF;

  RETURN _bj_vue(v_partie, false);
END;
$$;


CREATE OR REPLACE FUNCTION blackjack_action(
  p_joueur_id int,
  p_partie_id bigint,
  p_action    text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_partie parties;
  v_joueur int[];
  v_index  int;
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  SELECT * INTO v_partie FROM parties WHERE id = p_partie_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie % introuvable', p_partie_id;
  ELSIF v_partie.joueur_id <> p_joueur_id THEN
    -- Meme sans RLS, une fonction verifie toujours a qui appartient la ligne.
    RAISE EXCEPTION 'Cette partie ne vous appartient pas';
  ELSIF v_partie.statut <> 'en_cours' THEN
    RAISE EXCEPTION 'Partie deja terminee';
  END IF;

  v_joueur := ARRAY(SELECT jsonb_array_elements_text(v_partie.etat->'joueur')::int);
  v_index  := (v_partie.etat->>'tirages')::int;

  CASE p_action
    WHEN 'rester' THEN
      RETURN _bj_denouement(p_partie_id);

    WHEN 'tirer' THEN
      v_joueur := v_joueur || alea(v_partie.server_seed, v_partie.client_seed, v_partie.nonce, v_index, 52);
      UPDATE parties
      SET etat = etat || jsonb_build_object('joueur', to_jsonb(v_joueur), 'tirages', v_index + 1)
      WHERE id = p_partie_id
      RETURNING * INTO v_partie;

      IF bj_total(v_joueur) >= 21 THEN
        RETURN _bj_denouement(p_partie_id);
      END IF;
      RETURN _bj_vue(v_partie, false);

    WHEN 'doubler' THEN
      IF array_length(v_joueur, 1) <> 2 THEN
        RAISE EXCEPTION 'On ne peut doubler que sur les deux premieres cartes';
      END IF;

      PERFORM _mouvement(p_joueur_id, 'mise', -v_partie.mise, p_partie_id, 'Double');
      v_joueur := v_joueur || alea(v_partie.server_seed, v_partie.client_seed, v_partie.nonce, v_index, 52);

      UPDATE parties
      SET mise = mise * 2,
          etat = etat || jsonb_build_object('joueur', to_jsonb(v_joueur),
                                            'tirages', v_index + 1,
                                            'double', true)
      WHERE id = p_partie_id;

      RETURN _bj_denouement(p_partie_id);   -- doubler force a rester

    ELSE
      RAISE EXCEPTION 'Action "%" inconnue. Attendu : tirer, rester ou doubler', p_action;
  END CASE;
END;
$$;


-- =============================================================================
-- FONCTIONS DE LECTURE (module 01 et 04)
-- =============================================================================

-- RETURNS TABLE = une "vue parametree" utilisable dans un FROM (slide 42).
CREATE OR REPLACE FUNCTION parties_joueur(p_joueur_id int, p_limite int DEFAULT 20)
RETURNS TABLE (
  partie_id bigint, jeu text, mise numeric, gain numeric,
  net numeric, resultat text, etat jsonb, jouee_le timestamptz
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  RETURN QUERY
    SELECT p.id, j.nom, p.mise, p.gain, p.resultat_net, p.resultat, p.etat, p.cree_le
    FROM parties p
    JOIN jeux j ON j.id = p.jeu_id
    WHERE p.joueur_id = p_joueur_id
      AND p.statut = 'terminee'
    ORDER BY p.cree_le DESC, p.id DESC
    LIMIT p_limite;
END;
$$;

COMMENT ON FUNCTION parties_joueur(int, int) IS 'Vue parametree : SELECT * FROM parties_joueur(42) — et on peut la GROUP BY.';


-- Le pendant de ca_evenement() du TP 04 : exception si l'objet n'existe pas.
CREATE OR REPLACE FUNCTION ca_jeu(p_code_jeu text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_jeu_id int;
  v_ca     numeric;
BEGIN
  SELECT id INTO v_jeu_id FROM jeux WHERE code = p_code_jeu;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jeu % introuvable', p_code_jeu;
  END IF;

  -- Le CA du casino, c'est ce que les joueurs ont perdu : mises - gains.
  SELECT coalesce(sum(mise - gain), 0) INTO v_ca
  FROM parties
  WHERE jeu_id = v_jeu_id AND statut = 'terminee';

  RETURN v_ca;
END;
$$;


-- -----------------------------------------------------------------------------
-- Controle d'integrite : le cache joueurs.solde dit-il la meme chose que le
-- grand livre ? Une denormalisation assumee se verifie (slide 9).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verifier_integrite_soldes()
RETURNS TABLE (joueur_id int, pseudo text, solde_cache numeric, solde_livre numeric, ecart numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT j.id, j.pseudo, j.solde, coalesce(sum(t.montant), 0),
         j.solde - coalesce(sum(t.montant), 0)
  FROM joueurs j
  LEFT JOIN transactions t ON t.joueur_id = j.id
  GROUP BY j.id
  HAVING j.solde <> coalesce(sum(t.montant), 0)
$$;

COMMENT ON FUNCTION verifier_integrite_soldes() IS 'Doit toujours renvoyer 0 ligne. Toute ligne = une incoherence entre le cache et le grand livre.';


-- -----------------------------------------------------------------------------
-- reparer_soldes() — remettre le cache d'aplomb depuis le grand livre
-- -----------------------------------------------------------------------------
-- _mouvement() calcule le nouveau solde a partir de joueurs.solde, donc a partir
-- du CACHE. C'est le prix de la denormalisation : si le cache est fausse, la
-- faute se propage aux ecritures suivantes.
--
-- D'ou les trois garde-fous du projet :
--   1. seul trg_maj_solde ecrit joueurs.solde (aucun role applicatif n'y touche)
--   2. verifier_integrite_soldes() DETECTE tout ecart
--   3. reparer_soldes() le CORRIGE depuis la seule source de verite
--
-- Une denormalisation assumee, c'est une denormalisation qu'on sait verifier
-- ET reparer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE reparer_soldes()
LANGUAGE plpgsql
AS $$
DECLARE
  v_repares int;
BEGIN
  -- Aucun trigger a desactiver : tous ceux de joueurs sont declares en
  -- UPDATE OF <colonnes>, et aucun ne surveille solde. C'est precisement ce
  -- que cette forme achete (slide 48 : « ligne a ligne = cout »).
  WITH verite AS (
    SELECT j.id, coalesce(sum(t.montant), 0) AS solde_reel
    FROM joueurs j
    LEFT JOIN transactions t ON t.joueur_id = j.id
    GROUP BY j.id
  )
  UPDATE joueurs j
  SET solde = v.solde_reel
  FROM verite v
  WHERE v.id = j.id AND j.solde <> v.solde_reel;

  GET DIAGNOSTICS v_repares = ROW_COUNT;

  RAISE NOTICE 'Soldes recalcules depuis le grand livre : % ligne(s) corrigee(s)', v_repares;
END $$;

COMMENT ON PROCEDURE reparer_soldes() IS 'Reconstruit joueurs.solde depuis transactions. Reserve a l''administration.';


-- =============================================================================
-- CONTEXTE APPLICATIF
-- =============================================================================
-- L'API se connecte avec UN SEUL role PostgreSQL (casino_api) pour tous les
-- joueurs. Elle passe l'utilisateur courant par la session, a chaque requete :
--
--   SELECT set_config('app.joueur_id', '42', true);   -- true = le temps de la transaction
--
-- C'est ce reglage que lisent les politiques RLS (slide 57).
-- =============================================================================
CREATE OR REPLACE FUNCTION app_joueur_id()
RETURNS int
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.joueur_id', true), '')::int
$$;

COMMENT ON FUNCTION app_joueur_id() IS 'Joueur courant, pose par l''API via set_config. NULL hors session applicative : les politiques RLS ne laissent alors rien passer.';


-- -----------------------------------------------------------------------------
-- _exiger_identite() — le garde-fou des fonctions SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- Une fonction SECURITY DEFINER s'execute avec les droits de son proprietaire :
-- la RLS ne s'y applique pas. Sans verification, casino_api pourrait appeler
-- mon_compte(999) et lire le compte d'un autre.
--
-- Regle : on n'agit que pour le joueur de la session, sauf role d'administration.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _exiger_identite(p_joueur_id int)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF pg_has_role(current_user, 'casino_admin', 'member') THEN
    RETURN;                                 -- administration et supervision
  END IF;

  IF app_joueur_id() IS NULL THEN
    RAISE EXCEPTION 'Contexte applicatif absent : appelez set_config(''app.joueur_id'', ...)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF app_joueur_id() <> p_joueur_id THEN
    RAISE EXCEPTION 'Acces refuse : la session appartient au joueur %, pas au joueur %',
                    app_joueur_id(), p_joueur_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION _exiger_identite(int) IS 'A appeler en tete de chaque fonction SECURITY DEFINER qui recoit un joueur_id : la RLS ne protege pas l''interieur d''une telle fonction.';


-- =============================================================================
-- AUTHENTIFICATION — le mot de passe ne quitte jamais la base
-- =============================================================================
-- Choix fort : le hachage (bcrypt via pgcrypto) se fait DANS PostgreSQL.
-- Consequence directe cote droits : l'API n'a jamais besoin de
-- SELECT sur joueurs.mot_de_passe_hash ni sur joueurs.email.
-- Un hash qu'on ne peut pas lire est un hash qui ne peut pas fuir.
-- =============================================================================

CREATE OR REPLACE FUNCTION inscrire(
  p_pseudo         text,
  p_email          text,
  p_mot_de_passe   text,
  p_date_naissance date,
  p_code_parrain   text DEFAULT NULL
)
RETURNS TABLE (joueur_id int, pseudo text, solde numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  v_parrain_id int;
  v_id         int;
BEGIN
  IF length(p_mot_de_passe) < 8 THEN
    RAISE EXCEPTION 'Mot de passe trop court : 8 caracteres minimum';
  END IF;

  IF p_code_parrain IS NOT NULL AND p_code_parrain <> '' THEN
    SELECT j.id INTO v_parrain_id FROM joueurs j WHERE j.pseudo = p_code_parrain;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parrain "%" introuvable', p_code_parrain;
    END IF;
  END IF;

  BEGIN
    INSERT INTO joueurs (pseudo, email, mot_de_passe_hash, date_naissance, parrain_id)
    VALUES (p_pseudo, p_email, crypt(p_mot_de_passe, gen_salt('bf', 10)),
            p_date_naissance, v_parrain_id)
    RETURNING id INTO v_id;
  EXCEPTION
    -- Messages utilisables tels quels par le front, plutot qu'un code Postgres brut.
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Pseudo ou email deja utilise';
  END;

  PERFORM _mouvement(v_id, 'bonus', 100, NULL, 'Bonus de bienvenue');

  IF v_parrain_id IS NOT NULL THEN
    PERFORM _mouvement(v_parrain_id, 'bonus', 50, NULL, 'Bonus de parrainage : ' || p_pseudo);
  END IF;

  RETURN QUERY
    SELECT j.id, j.pseudo, j.solde FROM joueurs j WHERE j.id = v_id;
END;
$$;


CREATE OR REPLACE FUNCTION authentifier(p_email text, p_mot_de_passe text)
RETURNS TABLE (joueur_id int, pseudo text, role text, statut text)
LANGUAGE sql
STABLE
AS $$
  SELECT j.id, j.pseudo, j.role, j.statut
  FROM joueurs j
  WHERE j.email = lower(trim(p_email))
    -- crypt() rehache le mot de passe fourni avec le sel stocke : si le
    -- resultat est identique au hash, le mot de passe est le bon.
    AND j.mot_de_passe_hash = crypt(p_mot_de_passe, j.mot_de_passe_hash)
    AND j.statut <> 'ferme'
$$;

COMMENT ON FUNCTION authentifier(text, text) IS 'Renvoie 0 ligne si l''identification echoue. L''appelant n''a aucun acces au hash.';


CREATE OR REPLACE FUNCTION changer_mot_de_passe(
  p_joueur_id int, p_ancien text, p_nouveau text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  IF length(p_nouveau) < 8 THEN
    RAISE EXCEPTION 'Mot de passe trop court : 8 caracteres minimum';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM joueurs
    WHERE id = p_joueur_id
      AND mot_de_passe_hash = crypt(p_ancien, mot_de_passe_hash)
  ) THEN
    RAISE EXCEPTION 'Mot de passe actuel incorrect';
  END IF;

  UPDATE joueurs
  SET mot_de_passe_hash = crypt(p_nouveau, gen_salt('bf', 10))
  WHERE id = p_joueur_id;

  RETURN true;
END;
$$;


-- =============================================================================
-- PROFIL
-- =============================================================================

-- Seule fonction qui expose l'email — et seulement celui du joueur demande.
CREATE OR REPLACE FUNCTION mon_compte(p_joueur_id int)
RETURNS TABLE (
  joueur_id int, pseudo text, email text, date_naissance date,
  solde numeric, statut text, role text, parraine_par text,
  limite_mise numeric, exclu_jusqu_au timestamptz, inscrit_le timestamptz
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  RETURN QUERY
    SELECT j.id, j.pseudo, j.email, j.date_naissance, j.solde, j.statut, j.role,
           p.pseudo, j.limite_mise, j.exclu_jusqu_au, j.cree_le
    FROM joueurs j
    LEFT JOIN joueurs p ON p.id = j.parrain_id
    WHERE j.id = p_joueur_id;
END;
$$;


CREATE OR REPLACE FUNCTION modifier_profil(
  p_joueur_id int,
  p_pseudo    text DEFAULT NULL,
  p_email     text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  UPDATE joueurs
  SET pseudo = coalesce(nullif(trim(p_pseudo), ''), pseudo),
      email  = coalesce(nullif(trim(p_email),  ''), email)
  WHERE id = p_joueur_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Joueur % introuvable', p_joueur_id;
  END IF;
  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Pseudo ou email deja utilise';
END;
$$;


-- -----------------------------------------------------------------------------
-- Jeu responsable. Une auto-exclusion ne se raccourcit jamais : on ne peut que
-- l'allonger. La regle est dans la base, donc aucun client ne peut la contourner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION definir_exclusion(p_joueur_id int, p_jours int)
RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  v_fin timestamptz;
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  IF p_jours < 1 OR p_jours > 365 THEN
    RAISE EXCEPTION 'Duree d''exclusion invalide : entre 1 et 365 jours';
  END IF;

  UPDATE joueurs
  SET exclu_jusqu_au = greatest(coalesce(exclu_jusqu_au, now()), now() + make_interval(days => p_jours))
  WHERE id = p_joueur_id
  RETURNING exclu_jusqu_au INTO v_fin;

  RETURN v_fin;
END;
$$;


CREATE OR REPLACE FUNCTION definir_limite(p_joueur_id int, p_limite numeric)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_limite numeric;
BEGIN
  PERFORM _exiger_identite(p_joueur_id);

  UPDATE joueurs
  SET limite_mise = CASE
        WHEN p_limite IS NULL THEN NULL
        -- On ne relache pas une limite deja posee : elle ne peut que baisser.
        ELSE least(coalesce(limite_mise, p_limite), p_limite)
      END
  WHERE id = p_joueur_id
  RETURNING limite_mise INTO v_limite;

  RETURN v_limite;
END;
$$;


-- =============================================================================
-- CLASSEMENT — une exception assumee a la RLS
-- =============================================================================
-- La RLS empeche un joueur de lire les parties des autres. Mais un classement
-- est legitime : il expose un agregat anonymise (pseudo + resultat net), pas
-- des lignes. On le sert donc par une fonction SECURITY DEFINER auditee plutot
-- que par un GRANT large sur parties, qui, lui, ouvrirait tout.
-- =============================================================================
CREATE OR REPLACE FUNCTION classement(p_limite int DEFAULT 20)
-- « position » est un mot reserve de PostgreSQL : on l'appelle rang.
RETURNS TABLE (rang bigint, pseudo text, nb_parties bigint, resultat_net numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT rank() OVER (ORDER BY coalesce(sum(p.resultat_net), 0) DESC, j.id),
         j.pseudo,
         count(p.id),
         coalesce(sum(p.resultat_net), 0)
  FROM joueurs j
  JOIN parties p ON p.joueur_id = j.id AND p.statut = 'terminee'
  WHERE j.statut = 'actif'
  GROUP BY j.id
  ORDER BY 4 DESC, j.id
  LIMIT p_limite
$$;



-- =============================================================================
-- DETECTION DE COLLUSION — WITH RECURSIVE ... CYCLE
-- =============================================================================
-- Des jetons qui tournent en boucle (A -> B -> C -> A) sont le motif classique
-- de la collusion : blanchiment, ou vidage d'un bonus a plusieurs.
--
-- On parcourt le graphe des transferts depuis chaque joueur. La clause CYCLE
-- (PostgreSQL 14+) fait deux choses a notre place :
--   · elle marque est_cycle = true des qu'un joueur deja visite reapparait
--   · elle arrete la recursion sur ce chemin — sans elle, une boucle
--     ferait tourner la requete a l'infini
--
-- Un anneau de 3 joueurs est trouve 3 fois (une fois depuis chacun) : on ne
-- garde que le parcours qui part du plus petit identifiant de l'anneau.
-- =============================================================================
CREATE OR REPLACE FUNCTION detecter_collusion(p_longueur_max int DEFAULT 4)
RETURNS TABLE (boucle text[], longueur int, volume numeric, nb_transferts bigint)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE flux AS (
    -- Une arete par couple (expediteur, destinataire), ponderee par le volume.
    SELECT expediteur_id AS de, destinataire_id AS vers,
           sum(montant) AS total, count(*) AS nb
    FROM transferts
    GROUP BY 1, 2
  ),
  parcours AS (
    -- Ancre : chaque expediteur est un point de depart possible.
    SELECT DISTINCT de AS depart, de AS courant,
           ARRAY[de] AS noeuds, 0 AS longueur, 0::numeric AS volume, 0::bigint AS nb
    FROM flux

    UNION ALL

    -- Recursion : on suit les transferts sortants du joueur courant.
    SELECT p.depart, f.vers, p.noeuds || f.vers, p.longueur + 1,
           p.volume + f.total, p.nb + f.nb
    FROM parcours p
    JOIN flux f ON f.de = p.courant
    WHERE p.longueur < p_longueur_max
  ) CYCLE courant SET est_cycle USING chemin
  SELECT ARRAY(SELECT j.pseudo
               FROM unnest(p.noeuds) WITH ORDINALITY AS n(id, ordre)
               JOIN joueurs j ON j.id = n.id
               ORDER BY n.ordre),
         p.longueur, p.volume, p.nb
  FROM parcours p
  WHERE p.est_cycle
    AND p.courant = p.depart                                   -- revenu au point de depart
    AND p.depart = (SELECT min(x) FROM unnest(p.noeuds) AS x)  -- un seul exemplaire par anneau
  ORDER BY p.volume DESC
$$;

COMMENT ON FUNCTION detecter_collusion(int) IS 'Anneaux de transferts (A -> B -> ... -> A) par WITH RECURSIVE ... CYCLE. Reserve a l''administration.';


-- =============================================================================
-- EXPORT VERS MONGODB — PostgreSQL fabrique les documents
-- =============================================================================
-- Les statistiques de jeu de chaque joueur vivent dans MongoDB (collection
-- stats_joueurs) parce que leur forme change d'un jeu a l'autre. Mais elles
-- sont DERIVEES des parties : cette fonction les reconstruit depuis la seule
-- source de verite, sous forme de documents jsonb prets a inserer.
--
-- jsonb_object_agg transforme des lignes (numero, nombre) en un objet
-- {"17": 3, "0": 1, ...} : c'est le pont entre le modele relationnel et le
-- modele document.
--
-- Les parties generees par le seed ont un etat sommaire : la combinaison de la
-- machine y est deduite du multiplicateur, le detail des mains de blackjack
-- n'y existe pas. Les parties jouees dans l'application sont completes.
-- =============================================================================
CREATE OR REPLACE FUNCTION export_stats_joueurs()
RETURNS TABLE (joueur_id int, document jsonb)
LANGUAGE sql
STABLE
AS $$
  -- Regle de performance : chaque CTE AGREGE d'abord par joueur (10 000 lignes
  -- au plus), et on ne joint qu'ensuite. Joindre les 266 000 parties brutes a
  -- un agregat pousse le planificateur vers des boucles imbriquees : la
  -- premiere version de cette fonction ne terminait pas en 5 minutes.
  WITH base AS MATERIALIZED (
    SELECT p.joueur_id, g.code, p.mise, p.gain, p.resultat, p.etat
    FROM parties p
    JOIN jeux g ON g.id = p.jeu_id
    WHERE p.statut = 'terminee'
  ),

  -- --- Roulette -------------------------------------------------------------
  rl AS MATERIALIZED (
    SELECT joueur_id, mise, gain,
           (etat->>'numero')::int AS numero,
           split_part(coalesce(etat->>'pari', 'rouge'), ':', 1) AS type_pari
    FROM base WHERE code = 'roulette'
  ),
  rl_totaux AS (
    SELECT joueur_id, jsonb_build_object(
      'parties',        count(*),
      'mise',           sum(mise),
      'gain',           sum(gain),
      'gagnees',        count(*) FILTER (WHERE gain > 0),
      'plus_gros_gain', max(gain),
      'couleurs', jsonb_build_object(
        'rouge', count(*) FILTER (WHERE numero <> 0 AND roulette_est_rouge(numero)),
        'noir',  count(*) FILTER (WHERE numero <> 0 AND NOT roulette_est_rouge(numero)),
        'vert',  count(*) FILTER (WHERE numero = 0))
    ) AS doc
    FROM rl GROUP BY joueur_id
  ),
  -- jsonb_object_agg : des lignes (numero, nombre) deviennent {"17": 3, "0": 1}
  rl_numeros AS (
    SELECT joueur_id, jsonb_object_agg(numero::text, nb) AS numeros
    FROM (SELECT joueur_id, numero, count(*) AS nb FROM rl GROUP BY 1, 2) x
    GROUP BY joueur_id
  ),
  rl_paris AS (
    SELECT joueur_id, jsonb_object_agg(type_pari, nb) AS paris
    FROM (SELECT joueur_id, type_pari, count(*) AS nb FROM rl GROUP BY 1, 2) x
    GROUP BY joueur_id
  ),

  -- --- Machine a sous -------------------------------------------------------
  mc AS MATERIALIZED (
    SELECT joueur_id, mise, gain,
           coalesce(etat->>'combinaison',
             CASE round(gain / mise)
               WHEN 1000 THEN 'trois sept'     WHEN 200 THEN 'trois diamant'
               WHEN 60   THEN 'trois cloche'   WHEN 25  THEN 'trois pasteque'
               WHEN 12   THEN 'trois raisin'   WHEN 8   THEN 'trois citron'
               WHEN 5    THEN 'trois cerise'   WHEN 1   THEN 'paire'
               ELSE 'rien' END) AS combinaison
    FROM base WHERE code = 'machine'
  ),
  mc_totaux AS (
    SELECT joueur_id, jsonb_build_object(
      'parties',                 count(*),
      'mise',                    sum(mise),
      'gain',                    sum(gain),
      'meilleur_multiplicateur', max(round(gain / mise))
    ) AS doc
    FROM mc GROUP BY joueur_id
  ),
  mc_comb AS (
    SELECT joueur_id, jsonb_object_agg(combinaison, nb) AS combinaisons
    FROM (SELECT joueur_id, combinaison, count(*) AS nb FROM mc GROUP BY 1, 2) x
    GROUP BY joueur_id
  ),

  -- --- Blackjack ------------------------------------------------------------
  -- Parties jouees dans l'application : etat = cartes (on recalcule le total).
  -- Parties du seed : etat = totaux deja calcules.
  bj AS MATERIALIZED (
    SELECT joueur_id, mise, gain, resultat, etat->>'double' = 'true' AS double,
           CASE WHEN etat ? 'joueur'
                THEN bj_total(ARRAY(SELECT jsonb_array_elements_text(etat->'joueur')::int))
                ELSE (etat->>'total_joueur')::int END AS total_joueur,
           CASE WHEN etat ? 'croupier'
                THEN bj_total(ARRAY(SELECT jsonb_array_elements_text(etat->'croupier')::int))
                ELSE (etat->>'total_croupier')::int END AS total_croupier,
           CASE WHEN etat ? 'joueur' THEN jsonb_array_length(etat->'joueur') - 2 ELSE 0 END AS tirees
    FROM base WHERE code = 'blackjack'
  ),
  bj_totaux AS (
    SELECT joueur_id, jsonb_build_object(
      'parties',          count(*),
      'mise',             sum(mise),
      'gain',             sum(gain),
      'depasses_21',      count(*) FILTER (WHERE total_joueur > 21),
      'croupier_depasse', count(*) FILTER (WHERE total_croupier > 21),
      'doubles',          count(*) FILTER (WHERE double),
      'somme_totaux',     sum(total_joueur),
      'cartes_tirees',    sum(tirees)
    ) AS doc
    FROM bj GROUP BY joueur_id
  ),
  bj_res AS (
    SELECT joueur_id, jsonb_object_agg(resultat, nb) AS resultats
    FROM (SELECT joueur_id, resultat, count(*) AS nb FROM bj GROUP BY 1, 2) x
    GROUP BY joueur_id
  )

  -- Assemblage : uniquement des jointures entre agregats d'au plus 10 000 lignes.
  SELECT j.id,
         jsonb_strip_nulls(jsonb_build_object(
           '_id',       j.id,
           'pseudo',    j.pseudo,
           'roulette',  rt.doc || jsonb_build_object('numeros', rn.numeros, 'paris', rp.paris),
           'machine',   mt.doc || jsonb_build_object('combinaisons', mcb.combinaisons),
           'blackjack', bt.doc || jsonb_build_object('resultats', br.resultats)))
  FROM joueurs j
  LEFT JOIN rl_totaux  rt  ON rt.joueur_id  = j.id
  LEFT JOIN rl_numeros rn  ON rn.joueur_id  = j.id
  LEFT JOIN rl_paris   rp  ON rp.joueur_id  = j.id
  LEFT JOIN mc_totaux  mt  ON mt.joueur_id  = j.id
  LEFT JOIN mc_comb    mcb ON mcb.joueur_id = j.id
  LEFT JOIN bj_totaux  bt  ON bt.joueur_id  = j.id
  LEFT JOIN bj_res     br  ON br.joueur_id  = j.id
  WHERE coalesce(rt.doc, mt.doc, bt.doc) IS NOT NULL
$$;

COMMENT ON FUNCTION export_stats_joueurs() IS 'Construit un document jsonb par joueur pour la collection MongoDB stats_joueurs. Reserve a l''administration.';
