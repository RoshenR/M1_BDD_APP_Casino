-- =============================================================================
-- 05 · ROLES, DROITS & ROW LEVEL SECURITY
-- =============================================================================
-- MODULE 05. Les trois couches de la slide 51 :
--
--   1. pg_hba.conf        qui peut se connecter            (scram-sha-256)
--   2. GRANT / REVOKE     a quels objets, a quelles colonnes
--   3. ROW LEVEL SECURITY a quelles lignes
--
-- Objectif du projet : l'API ne peut PAS ecrire dans les tables d'argent.
-- Meme avec une injection SQL complete, un attaquant ne peut que rejouer les
-- fonctions metier, qui controlent tout (solde, statut, exclusion, bornes).
--
--   UPDATE joueurs SET solde = 1000000;    -> ERROR: permission denied
--   SELECT jouer_roulette(42, 10, 'rouge') -> la seule porte d'entree
-- =============================================================================

\echo '=== 05 · roles, droits et RLS ==='

SET search_path = casino, public;


-- =============================================================================
-- 1. LES ROLES
-- =============================================================================
-- PostgreSQL ne connait qu'une notion : le role. Avec LOGIN, c'est un
-- utilisateur ; sans, c'est un groupe (slide 52).
-- Les droits sont donnes aux GROUPES ; les comptes en heritent.
-- =============================================================================

-- --- Proprietaire des objets -------------------------------------------------
-- Volontairement NON superutilisateur. Les fonctions SECURITY DEFINER
-- s'executeront avec SES droits : si l'une d'elles a une faille, le rayon
-- d'action est limite au schema casino, pas a l'instance entiere.
-- (Le cours fait tourner les fonctions en tant que postgres ; c'est le meme
--  mecanisme, en plus prudent.)
CREATE ROLE casino_proprietaire NOLOGIN;

-- --- Groupes -----------------------------------------------------------------
CREATE ROLE casino_lecture NOLOGIN;   -- catalogue public, aucune donnee perso
CREATE ROLE casino_joueur  NOLOGIN;   -- ce que l'application web a le droit de faire
CREATE ROLE casino_bi      NOLOGIN;   -- reporting agrege, sans PII
CREATE ROLE casino_admin   NOLOGIN;   -- exploitation

-- --- Comptes de connexion ----------------------------------------------------
-- Une application = un role. JAMAIS postgres (slide 54).
CREATE ROLE casino_api        LOGIN PASSWORD 'api_secret'      IN ROLE casino_joueur, casino_lecture;
CREATE ROLE casino_analyste   LOGIN PASSWORD 'analyste_secret' IN ROLE casino_bi;
-- BYPASSRLS est un ATTRIBUT de role : il ne s'herite pas par appartenance a un
-- groupe, il faut le poser sur le compte lui-meme.
CREATE ROLE casino_superviseur LOGIN PASSWORD 'super_secret' BYPASSRLS IN ROLE casino_admin;

COMMENT ON ROLE casino_api IS 'Compte de l''API web. EXECUTE sur les fonctions metier, aucun droit d''ecriture direct.';
COMMENT ON ROLE casino_analyste IS 'Reporting. Lit les vues materialisees, jamais la table joueurs.';
COMMENT ON ROLE casino_superviseur IS 'Exploitation. BYPASSRLS : ignore toutes les politiques (slide 57).';


-- =============================================================================
-- 2. TRANSFERT DE PROPRIETE
-- =============================================================================
-- Les objets ont ete crees par postgres (superutilisateur). On les donne a
-- casino_proprietaire pour que SECURITY DEFINER ne signifie pas « superuser ».
-- =============================================================================
ALTER SCHEMA casino OWNER TO casino_proprietaire;

DO $$
DECLARE
  r record;
BEGIN
  -- Tables, vues et vues materialisees (les sequences d'identite suivent leur table).
  FOR r IN
    SELECT c.oid::regclass AS nom
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'casino' AND c.relkind IN ('r', 'v', 'm')
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO casino_proprietaire', r.nom);
  END LOOP;

  -- Fonctions ET procedures : ALTER ROUTINE couvre les deux.
  FOR r IN
    SELECT p.oid::regprocedure AS nom
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'casino'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO casino_proprietaire', r.nom);
  END LOOP;
END $$;


-- =============================================================================
-- 3. FERMER, PUIS OUVRIR
-- =============================================================================
-- Piege de la slide 54 : PUBLIC recoit EXECUTE sur CHAQUE nouvelle fonction.
-- Sans ce REVOKE, n'importe quel role connecte pourrait appeler _mouvement()
-- et se crediter ce qu'il veut. On ferme d'abord, on ouvre ensuite.
-- =============================================================================
REVOKE ALL ON SCHEMA casino                     FROM PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA casino    FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA casino    FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA casino    FROM PUBLIC;

GRANT USAGE ON SCHEMA casino TO casino_lecture, casino_joueur, casino_bi, casino_admin;

-- Hierarchie : un joueur est aussi un lecteur du catalogue. Sans cela, les vues
-- en security_invoker qui joignent jeux echoueraient sur « permission denied ».
GRANT casino_lecture TO casino_joueur;
-- Meme logique pour l'exploitation : export_stats_joueurs() appelle bj_total()
-- et roulette_est_rouge(), accordees au groupe de lecture.
GRANT casino_lecture TO casino_admin;


-- =============================================================================
-- 4. DROITS SUR LES OBJETS — jusqu'a la colonne
-- =============================================================================

-- --- Catalogue : lisible par tous les roles applicatifs ----------------------
GRANT SELECT ON jeux, v_jeux_actifs TO casino_lecture;

-- v_resultats_par_jeu est un agregat GLOBAL (marge et RTP reel par jeu), sans
-- aucune donnee personnelle. Elle n'a volontairement PAS security_invoker :
-- elle doit voir toutes les parties pour que la moyenne ait un sens.
-- Publier le RTP reellement constate est d'ailleurs une obligation dans la
-- vraie vie ; ici c'est la page d'accueil qui l'affiche.
GRANT SELECT ON v_resultats_par_jeu TO casino_lecture;

-- --- Table joueurs : GRANT COLONNE PAR COLONNE -------------------------------
-- C'est la demonstration de la slide 53 : « lire le nom d'un client, pas son
-- e-mail ». Ici : ni email, ni date de naissance, ni mot_de_passe_hash.
-- Le joueur recupere SES propres coordonnees par mon_compte(), pas autrement.
-- role est accorde : l'API en a besoin pour distinguer un administrateur.
-- Ce n'est pas une donnee personnelle, contrairement a email ou date_naissance.
GRANT SELECT (id, pseudo, statut, role, solde, cree_le, parrain_id)
  ON joueurs TO casino_joueur;

-- --- Donnees de jeu : lisibles, mais filtrees ligne a ligne par la RLS -------
GRANT SELECT ON parties, transactions, amities TO casino_joueur;

-- --- Vues applicatives -------------------------------------------------------
-- Elles portent security_invoker = true : les droits et la RLS de l'appelant
-- s'appliquent a travers elles.
GRANT SELECT ON v_profil_public, v_historique_parties, v_solde_joueur, v_stats_joueur
  TO casino_joueur;

-- --- Reporting : des agregats, jamais de PII ---------------------------------
GRANT SELECT ON mv_stats_quotidiennes, v_resultats_par_jeu, v_classement TO casino_bi;

-- --- Exploitation ------------------------------------------------------------
GRANT ALL ON ALL TABLES    IN SCHEMA casino TO casino_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA casino TO casino_admin;


-- =============================================================================
-- 5. SECURITY DEFINER — la seule porte d'ecriture
-- =============================================================================
-- Ces fonctions s'executent avec les droits de casino_proprietaire, pas ceux de
-- l'appelant. L'API n'a donc AUCUN privilege d'ecriture, et joue quand meme.
--
-- SET search_path = casino, public, pg_temp — avec pg_temp EN DERNIER.
-- Le piege de la slide 55 : sans search_path fixe, l'appelant peut creer
-- pg_temp.joueurs ; la fonction lirait SA table, avec les droits du proprietaire.
--
-- ATTENTION AUX MIGRATIONS : un CREATE OR REPLACE FUNCTION sans clause
-- SECURITY DEFINER REMET la fonction en SECURITY INVOKER et efface son
-- search_path. Rejouer 02_fonctions.sql seul desarme donc toute la securite.
-- Regle : on rejoue toujours 05_securite.sql derriere 02_fonctions.sql.
-- =============================================================================
DO $$
DECLARE
  v_routine text;
  -- Surface publique de l'API. Tout ce qui n'est pas dans cette liste reste
  -- inaccessible a casino_api, y compris _mouvement() et _valider_mise().
  v_publiques text[] := ARRAY[
    'inscrire(text,text,text,date,text)',
    'authentifier(text,text)',
    'mon_compte(integer)',
    'modifier_profil(integer,text,text)',
    'changer_mot_de_passe(integer,text,text)',
    'definir_exclusion(integer,integer)',
    'definir_limite(integer,numeric)',
    'deposer(integer,numeric)',
    'retirer(integer,numeric)',
    'transferer_jetons(integer,integer,numeric,text)',
    'jouer_roulette(integer,numeric,text,text)',
    'jouer_machine(integer,numeric,text)',
    'blackjack_commencer(integer,numeric,text)',
    'blackjack_action(integer,bigint,text)',
    'parties_joueur(integer,integer)',
    'classement(integer)',
    'verifier_partie(bigint)',
    'ca_jeu(text)'
  ];
BEGIN
  FOREACH v_routine IN ARRAY v_publiques LOOP
    EXECUTE format(
      'ALTER ROUTINE casino.%s SECURITY DEFINER SET search_path = casino, public, pg_temp',
      v_routine);
    EXECUTE format('GRANT EXECUTE ON ROUTINE casino.%s TO casino_joueur', v_routine);
  END LOOP;
END $$;

-- Fonctions d'exploitation : reservees a l'administration.
GRANT EXECUTE ON ROUTINE
  rembourser_partie(bigint, text),
  rafraichir_stats(),
  verifier_integrite_soldes(),
  reparer_soldes(),
  detecter_collusion(int),
  export_stats_joueurs()
TO casino_admin;

-- Lecture publique du catalogue : pas besoin de SECURITY DEFINER.
-- Ce sont des fonctions IMMUTABLE qui ne lisent aucune table : le joueur peut
-- s'en servir pour rejouer lui-meme le calcul d'une partie (provably fair).
GRANT EXECUTE ON ROUTINE roulette_multiplicateur(text, int), roulette_est_rouge(int),
                         machine_multiplicateur(text), machine_symbole(int),
                         bj_nom(int), bj_valeur(int), bj_total(int[]),
                         hash_seed(text), alea(text, text, int, int, int)
TO casino_lecture;

-- app_joueur_id() est evaluee DANS les politiques RLS, avec les droits de
-- l'appelant : sans EXECUTE, toute lecture d'une table protegee echouerait sur
-- « permission denied for function app_joueur_id ».
GRANT EXECUTE ON ROUTINE app_joueur_id() TO casino_lecture, casino_joueur, casino_bi;


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================
-- GRANT dit « cette table » ; une politique dit « ces lignes-la » (slide 56).
-- L'API se connecte avec UN role pour tous les joueurs : elle passe l'identite
-- par la session, a chaque transaction :
--
--   BEGIN;
--   SELECT set_config('app.joueur_id', '42', true);
--   SELECT * FROM transactions;     -- seulement celles du joueur 42
--   COMMIT;
--
-- Rappel : RLS activee sans aucune politique = ZERO ligne visible.
-- =============================================================================

-- --- transactions : le grand livre est strictement personnel -----------------
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_du_joueur
  ON transactions
  FOR SELECT
  TO casino_joueur
  USING (joueur_id = app_joueur_id());

CREATE POLICY transactions_admin
  ON transactions
  FOR ALL
  TO casino_admin
  USING (true);

-- --- parties : chacun son historique -----------------------------------------
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY parties_du_joueur
  ON parties
  FOR SELECT
  TO casino_joueur
  USING (joueur_id = app_joueur_id());

CREATE POLICY parties_admin
  ON parties
  FOR ALL
  TO casino_admin
  USING (true);

-- --- joueurs : les comptes fermes ou suspendus disparaissent -----------------
-- Ici la RLS ne filtre pas « ses lignes » mais « les lignes legitimes » : le
-- classement a besoin de voir les autres joueurs, la fermeture d'un compte doit
-- le faire disparaitre partout d'un coup, sans toucher au code applicatif.
ALTER TABLE joueurs ENABLE ROW LEVEL SECURITY;

CREATE POLICY joueurs_actifs_visibles
  ON joueurs
  FOR SELECT
  TO casino_joueur
  USING (statut = 'actif');

CREATE POLICY joueurs_admin
  ON joueurs
  FOR ALL
  TO casino_admin
  USING (true);

-- --- amities : son propre reseau ---------------------------------------------
ALTER TABLE amities ENABLE ROW LEVEL SECURITY;

CREATE POLICY amities_du_joueur
  ON amities
  FOR SELECT
  TO casino_joueur
  USING (joueur_id = app_joueur_id() OR ami_id = app_joueur_id());

-- --- journal_audit : RLS activee, AUCUNE politique pour casino_joueur --------
-- Consequence voulue : l'API voit zero ligne, meme si un GRANT SELECT lui etait
-- accorde par erreur. C'est la ceinture ET les bretelles.
ALTER TABLE journal_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY journal_audit_admin
  ON journal_audit
  FOR ALL
  TO casino_admin
  USING (true);

COMMENT ON TABLE journal_audit IS 'RLS activee sans politique pour casino_joueur : zero ligne visible cote application (slide 56).';

-- --- transferts : chacun voit ce qu'il a envoye et recu ----------------------
-- Aucun GRANT n'est accorde a casino_joueur pour l'instant (l'API lit le grand
-- livre) : la politique est prete si on en accorde un un jour.
ALTER TABLE transferts ENABLE ROW LEVEL SECURITY;

CREATE POLICY transferts_du_joueur
  ON transferts
  FOR SELECT
  TO casino_joueur
  USING (expediteur_id = app_joueur_id() OR destinataire_id = app_joueur_id());

CREATE POLICY transferts_admin
  ON transferts
  FOR ALL
  TO casino_admin
  USING (true);

-- NOTE : on n'active PAS FORCE ROW LEVEL SECURITY. Le proprietaire doit rester
-- exempte, sinon les fonctions SECURITY DEFINER (qui s'executent en tant que
-- casino_proprietaire) ne pourraient plus ecrire dans les tables qu'elles gerent.


-- =============================================================================
-- 7. LES OBJETS FUTURS
-- =============================================================================
-- Un droit oublie sur une table creee demain est une faille de demain.
-- =============================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE casino_proprietaire IN SCHEMA casino
  REVOKE EXECUTE ON ROUTINES FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE casino_proprietaire IN SCHEMA casino
  GRANT SELECT ON TABLES TO casino_admin;

-- Le search_path des comptes applicatifs : ils ne qualifient pas casino.*
ALTER ROLE casino_api        SET search_path = casino, public;
ALTER ROLE casino_analyste   SET search_path = casino, public;
ALTER ROLE casino_superviseur SET search_path = casino, public;
