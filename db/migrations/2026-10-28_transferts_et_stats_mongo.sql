-- =============================================================================
-- MIGRATION 2026-10-28 · retrait de Neo4j, table transferts, export vers Mongo
-- =============================================================================
-- Pour une base DEJA initialisee (une base neuve recoit tout via db/init/).
-- Rejouable sans risque.
--
--   docker compose exec postgres psql -U postgres -d casino -f /db/migrations/2026-10-28_transferts_et_stats_mongo.sql
--
-- Ce que fait ce script :
--   1. cree la table transferts (le graphe « qui a paye qui »)
--   2. la remplit a partir des transferts deja presents dans le grand livre
--   3. recharge les fonctions (transferer_jetons ecrit desormais dans
--      transferts ; detecter_collusion et export_stats_joueurs apparaissent)
--   4. REAPPLIQUE la securite : recharger 02_fonctions.sql remet chaque
--      fonction en SECURITY INVOKER et efface son search_path. Sans cette
--      etape, l'API perdrait silencieusement tous ses droits.
-- =============================================================================

\set ON_ERROR_STOP on
SET search_path = casino, public;

BEGIN;

-- --- 1. La table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transferts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expediteur_id   int           NOT NULL REFERENCES joueurs(id) ON DELETE RESTRICT,
  destinataire_id int           NOT NULL REFERENCES joueurs(id) ON DELETE RESTRICT,
  montant         numeric(14,2) NOT NULL,
  message         text,
  cree_le         timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT transferts_montant_positif CHECK (montant > 0),
  CONSTRAINT transferts_pas_soi_meme    CHECK (expediteur_id <> destinataire_id)
);

COMMENT ON TABLE transferts IS 'Graphe oriente des transferts entre joueurs. Les mouvements d''argent correspondants sont dans transactions.';

ALTER TABLE transferts OWNER TO casino_proprietaire;
REVOKE ALL ON transferts FROM PUBLIC;
GRANT ALL ON transferts TO casino_admin;

ALTER TABLE transferts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transferts_du_joueur ON transferts;
CREATE POLICY transferts_du_joueur ON transferts FOR SELECT TO casino_joueur
  USING (expediteur_id = app_joueur_id() OR destinataire_id = app_joueur_id());
DROP POLICY IF EXISTS transferts_admin ON transferts;
CREATE POLICY transferts_admin ON transferts FOR ALL TO casino_admin USING (true);

-- --- 2. Reconstruction depuis le grand livre ----------------------------------
-- Un transfert, ce sont deux lignes ecrites dans la meme transaction : elles
-- partagent donc le meme now() et des montants opposes. C'est la cle de jointure.
INSERT INTO transferts (expediteur_id, destinataire_id, montant, cree_le)
SELECT e.joueur_id, r.joueur_id, r.montant, e.cree_le
FROM transactions e
JOIN transactions r
  ON r.type = 'transfert_recu'
 AND r.cree_le = e.cree_le
 AND r.montant = -e.montant
 AND r.joueur_id <> e.joueur_id
WHERE e.type = 'transfert_envoye'
  AND NOT EXISTS (SELECT 1 FROM transferts);   -- rejouable : une seule fois

COMMIT;

-- --- 3. Les fonctions ---------------------------------------------------------
\ir ../init/02_fonctions.sql

-- --- 4. La securite, reappliquee ----------------------------------------------
SET search_path = casino, public;

DO $$
DECLARE
  r record;
  v_routine text;
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
    'ca_jeu(text)',
    'ajouter_ami(integer,text)',
    'retirer_ami(integer,integer)'
  ];
BEGIN
  -- Proprietaire non superutilisateur, pour toutes les routines du schema.
  FOR r IN
    SELECT p.oid::regprocedure AS nom
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'casino'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO casino_proprietaire', r.nom);
  END LOOP;

  EXECUTE 'REVOKE ALL ON ALL ROUTINES IN SCHEMA casino FROM PUBLIC';

  FOREACH v_routine IN ARRAY v_publiques LOOP
    EXECUTE format(
      'ALTER ROUTINE casino.%s SECURITY DEFINER SET search_path = casino, public, pg_temp',
      v_routine);
    EXECUTE format('GRANT EXECUTE ON ROUTINE casino.%s TO casino_joueur', v_routine);
  END LOOP;
END $$;

GRANT EXECUTE ON ROUTINE
  rembourser_partie(bigint, text), rafraichir_stats(), verifier_integrite_soldes(),
  reparer_soldes(), detecter_collusion(int), export_stats_joueurs()
TO casino_admin;

GRANT EXECUTE ON ROUTINE roulette_multiplicateur(text, int), roulette_est_rouge(int),
                         machine_multiplicateur(text), machine_symbole(int),
                         bj_nom(int), bj_valeur(int), bj_total(int[]),
                         hash_seed(text), alea(text, text, int, int, int)
TO casino_lecture;
GRANT EXECUTE ON ROUTINE app_joueur_id() TO casino_lecture, casino_joueur, casino_bi;
GRANT casino_lecture TO casino_admin;   -- export_stats_joueurs() appelle bj_total()

-- --- Controle -----------------------------------------------------------------
SELECT count(*) AS transferts_importes FROM transferts;
SELECT count(*) AS fonctions_security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'casino' AND p.prosecdef;
SELECT count(*) AS anneaux_detectes FROM detecter_collusion(4);
