-- =============================================================================
-- DEMO 04 · FONCTIONS, PROCEDURES ET DECLENCHEURS
-- =============================================================================
--   docker compose exec postgres psql -U postgres -d casino -f /db/demo/04-fonctions-triggers.sql
--
-- Le fil conducteur : TOUT ce que la base garantit, l'application n'a plus a le
-- verifier — ni a l'oublier.
-- =============================================================================

\set ON_ERROR_STOP on
SET search_path = casino, public;

-- Les fonctions metier exigent un contexte applicatif (_exiger_identite).
-- On se fait passer pour alice (joueur 2) le temps de la demo.
SELECT set_config('app.joueur_id', '2', false);

-- Repartir d'un etat propre : on cloture les mains de blackjack laissees
-- en cours par une demo precedente (un joueur ne peut en avoir qu'une).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, joueur_id FROM parties WHERE statut = 'en_cours' LOOP
    PERFORM set_config('app.joueur_id', r.joueur_id::text, false);
    PERFORM blackjack_action(r.joueur_id, r.id, 'rester');
  END LOOP;
  PERFORM set_config('app.joueur_id', '2', false);
END $$;


\echo ''
\echo '################ Q1 - Fonction SQL simple, IMMUTABLE ################'
\echo ''
-- IMMUTABLE : meme entree -> meme sortie, ne lit pas la base. Elle peut donc
-- servir dans un index, et le planificateur peut la pre-calculer.

SELECT roulette_est_rouge(32) AS "32 est rouge",
       roulette_est_rouge(33) AS "33 est rouge",
       roulette_multiplicateur('rouge',    32) AS "mise rouge, sort 32",
       roulette_multiplicateur('plein:17', 17) AS "plein 17, sort 17",
       roulette_multiplicateur('rouge',     0) AS "rouge, sort le ZERO";

\echo ''
\echo '-- Tout l avantage du casino tient dans cette ligne : le 0.'
\echo '   36 numeros payants sur 37 cases -> RTP = 36/37 = 97,30 %'
SELECT round(36.0 / 37.0, 4) AS rtp_roulette;


\echo ''
\echo '################ Q2 - Fonction plpgsql avec exception explicite ################'
\echo ''
-- Le pendant de ca_evenement() du TP 04 : RAISE EXCEPTION si l objet manque.

SELECT ca_jeu('roulette')  AS ca_roulette,
       ca_jeu('blackjack') AS ca_blackjack,
       ca_jeu('machine')   AS ca_machine;

\echo ''
\echo '-- Sur un jeu inexistant : une erreur metier, pas un NULL silencieux'
DO $$
BEGIN
  PERFORM ca_jeu('poker');
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'Refuse : %', SQLERRM;
END $$;


\echo ''
\echo '################ Q3 - RETURNS TABLE : une vue parametree ################'
\echo ''
-- Utilisable dans un FROM, donc joignable et groupable.

SELECT * FROM parties_joueur(2, 5);

\echo ''
\echo '-- ...et on peut l agreger comme n importe quelle table'
SELECT jeu, count(*) AS parties, sum(net) AS net
FROM parties_joueur(2, 100)
GROUP BY jeu
ORDER BY net;


\echo ''
\echo '################ Q4 - Une procedure metier complete ################'
\echo ''
-- jouer_roulette fait 5 choses en UN aller-retour reseau et UNE transaction :
--   1. valide le joueur, son statut, son exclusion, les bornes de mise
--   2. cree la partie et son engagement cryptographique (seed + hash)
--   3. debite la mise dans le grand livre
--   4. tire le numero
--   5. credite le gain
-- Si n importe quelle etape echoue, TOUT est annule. Pas de demi-mise perdue.

SELECT solde AS solde_avant FROM joueurs WHERE id = 2;

SELECT jsonb_pretty(jouer_roulette(2, 100, 'rouge', 'demo-soutenance'));

SELECT solde AS solde_apres FROM joueurs WHERE id = 2;

\echo ''
\echo '-- Les deux mouvements ecrits par cette seule instruction'
SELECT type, montant, solde_apres, libelle
FROM transactions
WHERE joueur_id = 2
ORDER BY id DESC
LIMIT 3;


\echo ''
\echo '################ Q5 - Provably fair : le joueur peut verifier ################'
\echo ''
-- Le hash du seed est publie AVANT la partie, le seed apres.
-- Personne ne peut choisir le resultat une fois le hash annonce.

WITH derniere AS (
  SELECT id FROM parties WHERE joueur_id = 2 ORDER BY id DESC LIMIT 1
)
SELECT * FROM verifier_partie((SELECT id FROM derniere));

\echo ''
\echo '-- Et le joueur rejoue le tirage lui-meme avec les fonctions publiques :'
SELECT p.id,
       p.etat->>'numero'                                        AS numero_annonce,
       alea(p.server_seed, p.client_seed, p.nonce, 0, 37)::text AS numero_recalcule
FROM parties p
WHERE p.joueur_id = 2 AND p.jeu_id = 2 AND p.statut = 'terminee'
ORDER BY p.id DESC
LIMIT 3;


\echo ''
\echo '################ Q6 - Blackjack : un etat qui vit entre deux appels ################'
\echo ''

SELECT jsonb_pretty(blackjack_commencer(2, 20, 'demo-bj'));

\echo ''
\echo '-- La partie est en_cours, son etat est stocke en jsonb'
SELECT id, statut, etat FROM parties WHERE joueur_id = 2 ORDER BY id DESC LIMIT 1;

\echo ''
\echo '-- Le joueur reste : le croupier tire jusqu a 17, puis on compare'
SELECT jsonb_pretty(blackjack_action(2,
  (SELECT id FROM parties WHERE joueur_id = 2 ORDER BY id DESC LIMIT 1),
  'rester'));


\echo ''
\echo '################ Q7 - TRIGGER : le grand livre est immuable ################'
\echo ''
-- Une comptabilite ne se corrige pas, elle se contre-passe.

DO $$
BEGIN
  UPDATE transactions SET montant = 999999 WHERE id = 1;
  RAISE NOTICE 'Accepte — inattendu.';
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'UPDATE refuse : %', SQLERRM;
END $$;

DO $$
BEGIN
  DELETE FROM transactions WHERE id = 1;
  RAISE NOTICE 'Accepte — inattendu.';
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'DELETE refuse : %', SQLERRM;
END $$;


\echo ''
\echo '################ Q8 - TRIGGER : le solde ne peut pas desynchroniser ################'
\echo ''
-- joueurs.solde est un CACHE. transactions est la VERITE.
-- trg_maj_solde est le seul chemin d ecriture du cache.

SELECT count(*) AS incoherences FROM verifier_integrite_soldes();

\echo ''
\echo '-- On corrompt volontairement le cache, en tant que superutilisateur'
\echo '   (aucun role applicatif ne peut faire ce UPDATE : permission denied)'
UPDATE joueurs SET solde = 123456 WHERE id = 2;

\echo ''
\echo '-- DETECTER : le controle d integrite compare cache et grand livre'
SELECT joueur_id, pseudo, solde_cache, solde_livre, ecart
FROM verifier_integrite_soldes();

\echo ''
\echo '-- Le danger est reel : _mouvement() calcule le nouveau solde a partir'
\echo '   du CACHE. Si on laissait jouer alice maintenant, la faute se'
\echo '   propagerait dans le grand livre. C est le prix de la denormalisation.'
\echo ''
\echo '-- REPARER : reconstruire le cache depuis la seule source de verite'
CALL reparer_soldes();

SELECT count(*) AS incoherences_apres FROM verifier_integrite_soldes();

\echo ''
\echo '>>> Une denormalisation assumee, c est une denormalisation qu on sait'
\echo '    DETECTER et REPARER. Les trois garde-fous :'
\echo '      1. seul trg_maj_solde ecrit joueurs.solde'
\echo '      2. verifier_integrite_soldes() detecte'
\echo '      3. reparer_soldes() corrige'


\echo ''
\echo '################ Q9 - TRIGGER BEFORE : le jeu responsable ################'
\echo ''
-- Regle metier IMPOSSIBLE a contourner : ni par l API, ni par un script,
-- ni par pgAdmin. Elle est dans la base.

SELECT set_config('app.joueur_id', '4', false);
SELECT definir_exclusion(4, 7) AS carol_exclue_jusquau;

DO $$
BEGIN
  PERFORM jouer_roulette(4, 10, 'rouge');
  RAISE NOTICE 'Accepte — inattendu.';
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'Mise refusee par la fonction : %', SQLERRM;
END $$;

\echo ''
\echo '-- Et meme en ecrivant DIRECTEMENT dans le grand livre, en tant que'
\echo '   superutilisateur, le trigger BEFORE INSERT refuse :'
DO $$
BEGIN
  INSERT INTO transactions (joueur_id, type, montant, solde_apres)
  VALUES (4, 'mise', -10, 1000);
  RAISE NOTICE 'Accepte — inattendu.';
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'Refuse par trg_verifier_mise : %', SQLERRM;
END $$;

-- On leve l exclusion pour la suite des demos.
UPDATE joueurs SET exclu_jusqu_au = NULL WHERE id = 4;


\echo ''
\echo '################ Q10 - TRIGGER AFTER : le journal d audit ################'
\echo ''
-- to_jsonb(OLD) / to_jsonb(NEW), une seule fonction pour plusieurs tables
-- grace a TG_TABLE_NAME et TG_OP.

UPDATE jeux    SET mise_max = 750      WHERE code = 'roulette';
UPDATE joueurs SET statut   = 'suspendu' WHERE id = 5;
UPDATE joueurs SET statut   = 'actif'    WHERE id = 5;

SELECT table_cible, operation, cle,
       avant->>'statut'   AS statut_avant,
       apres->>'statut'   AS statut_apres,
       avant->>'mise_max' AS mise_max_avant,
       apres->>'mise_max' AS mise_max_apres,
       role_bdd
FROM journal_audit
ORDER BY id DESC
LIMIT 5;

UPDATE jeux SET mise_max = 1000 WHERE code = 'roulette';

\echo ''
\echo '-- Le solde, lui, n est PAS audite : ce serait une ligne par mise,'
\echo '   soit des millions de lignes pour rien (slide 48).'
SELECT count(*) AS lignes_audit_total FROM journal_audit;


\echo ''
\echo '################ Q11 - TRIGGER : pas de cycle dans le parrainage ################'
\echo ''
-- Sans ce garde-fou, WITH RECURSIVE bouclerait a l infini.

DO $$
BEGIN
  UPDATE joueurs SET parrain_id = 4 WHERE id = 2;   -- alice parrainee par carol,
  RAISE NOTICE 'Accepte — inattendu.';              -- qui descend d alice
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'Refuse : %', SQLERRM;
END $$;


\echo ''
\echo '################ Q12 - PROCEDURE : rembourser une partie ################'
\echo ''
-- Controle du statut, puis mouvements compensatoires. Aucun DELETE.

SELECT set_config('app.joueur_id', '2', false);
SELECT id, mise, gain, statut FROM parties
WHERE joueur_id = 2 AND statut = 'terminee' ORDER BY id DESC LIMIT 1 \gset partie_

CALL rembourser_partie(:partie_id, 'Demonstration soutenance');

SELECT id, statut FROM parties WHERE id = :partie_id;

SELECT type, montant, libelle
FROM transactions
WHERE partie_id = :partie_id
ORDER BY id;

\echo ''
\echo '-- Rembourser deux fois : refuse'
-- Note : psql ne substitue pas ses variables (:partie_id) a l'interieur d'un
-- bloc dollar-quote. On relit donc la partie depuis la base.
DO $$
DECLARE v_id bigint;
BEGIN
  SELECT id INTO v_id FROM parties WHERE statut = 'annulee' ORDER BY id DESC LIMIT 1;
  CALL rembourser_partie(v_id);
  RAISE NOTICE 'Accepte — inattendu.';
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'Refuse : %', SQLERRM;
END $$;

\echo ''
\echo '-- Et le grand livre est toujours coherent'
SELECT count(*) AS incoherences FROM verifier_integrite_soldes();
