-- =============================================================================
-- 01 · SCHEMA
-- =============================================================================
-- Principe directeur (module 04, slide 48) : les CONTRAINTES D'ABORD.
-- NOT NULL, CHECK, FK, UNIQUE, GENERATED sont declaratives, rapides et
-- impossibles a oublier. On ne sort un trigger que lorsqu'aucune contrainte
-- ne sait exprimer la regle.
-- =============================================================================

\echo '=== 01 · schema ==='

CREATE SCHEMA IF NOT EXISTS casino;

-- digest() / hmac() / gen_random_bytes() : provably fair du module 04.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
-- Module 03 : reperer les requetes les plus couteuses.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;

SET search_path = casino, public;


-- -----------------------------------------------------------------------------
-- JOUEURS
-- -----------------------------------------------------------------------------
-- parrain_id pointe vers joueurs : une arborescence de parrainage, parcourue
-- en WITH RECURSIVE (module 01) — exactement la structure categories.parent_id
-- du cours.
-- -----------------------------------------------------------------------------
CREATE TABLE joueurs (
  id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pseudo             text        NOT NULL UNIQUE,
  email              text        NOT NULL UNIQUE,
  mot_de_passe_hash  text        NOT NULL,
  date_naissance     date        NOT NULL,
  parrain_id         int         REFERENCES joueurs(id) ON DELETE SET NULL,
  role               text        NOT NULL DEFAULT 'joueur',
  statut             text        NOT NULL DEFAULT 'actif',
  -- Solde denormalise, maintenu par trigger depuis le grand livre.
  -- Denormaliser est un choix assume (slide 9), pas un accident :
  -- v_solde_joueur recalcule la verite et verifier_integrite_soldes() compare.
  solde              numeric(14,2) NOT NULL DEFAULT 0,
  -- Jeu responsable : tant que cette date est dans le futur, aucune mise.
  exclu_jusqu_au     timestamptz,
  limite_mise        numeric(14,2),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  maj_le             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT joueurs_role_valide    CHECK (role   IN ('joueur', 'admin')),
  CONSTRAINT joueurs_statut_valide  CHECK (statut IN ('actif', 'suspendu', 'ferme')),
  CONSTRAINT joueurs_solde_positif  CHECK (solde >= 0),
  CONSTRAINT joueurs_pseudo_format  CHECK (pseudo ~ '^[A-Za-z0-9_-]{3,24}$'),
  CONSTRAINT joueurs_email_format   CHECK (email  ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT joueurs_limite_positive CHECK (limite_mise IS NULL OR limite_mise > 0),
  CONSTRAINT joueurs_pas_son_parrain CHECK (parrain_id IS DISTINCT FROM id)
);

COMMENT ON TABLE  joueurs IS 'Comptes joueurs. solde est un cache maintenu par trg_maj_solde ; la source de verite est la table transactions.';
COMMENT ON COLUMN joueurs.exclu_jusqu_au IS 'Auto-exclusion (jeu responsable). Verifiee par trg_verifier_mise avant toute mise.';
COMMENT ON COLUMN joueurs.parrain_id IS 'Arborescence de parrainage, parcourue en WITH RECURSIVE.';


-- -----------------------------------------------------------------------------
-- JEUX
-- -----------------------------------------------------------------------------
CREATE TABLE jeux (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text          NOT NULL UNIQUE,
  nom            text          NOT NULL,
  mise_min       numeric(14,2) NOT NULL DEFAULT 1,
  mise_max       numeric(14,2) NOT NULL DEFAULT 500,
  rtp_theorique  numeric(5,4)  NOT NULL,   -- Return To Player annonce
  actif          boolean       NOT NULL DEFAULT true,

  CONSTRAINT jeux_code_valide CHECK (code IN ('blackjack', 'roulette', 'machine')),
  CONSTRAINT jeux_mises_coherentes CHECK (mise_min > 0 AND mise_max >= mise_min),
  CONSTRAINT jeux_rtp_plausible CHECK (rtp_theorique BETWEEN 0.5 AND 1.0)
);

COMMENT ON TABLE jeux IS 'Catalogue des jeux et leurs bornes de mise. Table de reference : petite, tres lue, jamais indexee au-dela de sa PK (slide 31).';


-- -----------------------------------------------------------------------------
-- PARTIES
-- -----------------------------------------------------------------------------
-- Une partie = une main de blackjack, un spin de roulette, un tour de machine.
-- Le blackjack se joue en plusieurs coups : son etat intermediaire vit dans
-- `etat` (jsonb), et statut passe de 'en_cours' a 'terminee'.
--
-- PROVABLY FAIR : server_seed_hash est publie AVANT la partie, server_seed est
-- revele APRES. Le joueur peut donc verifier que le casino n'a pas triche.
-- -----------------------------------------------------------------------------
CREATE TABLE parties (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- RESTRICT et pas CASCADE : un compte se ferme (statut = 'ferme'), il ne
  -- s'efface pas. L'historique de jeu est une obligation reglementaire.
  joueur_id        int           NOT NULL REFERENCES joueurs(id) ON DELETE RESTRICT,
  jeu_id           int           NOT NULL REFERENCES jeux(id),
  mise             numeric(14,2) NOT NULL,
  gain             numeric(14,2) NOT NULL DEFAULT 0,
  -- GENERATED : pas besoin d'un trigger pour ca (slide 46).
  resultat_net     numeric(14,2) GENERATED ALWAYS AS (gain - mise) STORED,
  statut           text          NOT NULL DEFAULT 'en_cours',
  resultat         text,
  etat             jsonb         NOT NULL DEFAULT '{}'::jsonb,

  server_seed      text          NOT NULL,
  server_seed_hash text          NOT NULL,
  client_seed      text          NOT NULL,
  nonce            int           NOT NULL DEFAULT 0,

  cree_le          timestamptz   NOT NULL DEFAULT now(),
  terminee_le      timestamptz,

  CONSTRAINT parties_mise_positive   CHECK (mise > 0),
  CONSTRAINT parties_gain_positif    CHECK (gain >= 0),
  CONSTRAINT parties_statut_valide   CHECK (statut IN ('en_cours', 'terminee', 'annulee')),
  CONSTRAINT parties_resultat_valide CHECK (
    resultat IS NULL OR resultat IN ('gagne', 'perdu', 'egalite', 'blackjack')
  ),
  -- Une partie fermee (terminee OU annulee) a forcement une date de fin,
  -- et une partie en cours n'en a pas. Ecrit dans ce sens, le remboursement
  -- (terminee -> annulee) ne casse pas la contrainte.
  CONSTRAINT parties_fin_coherente CHECK (
    (statut = 'en_cours') = (terminee_le IS NULL)
  )
);

COMMENT ON TABLE  parties IS 'Une partie jouee. Table volumineuse : c''est elle qui rend les index du module 03 visibles.';
COMMENT ON COLUMN parties.server_seed_hash IS 'Publie avant la partie (provably fair) ; server_seed n''est revele qu''une fois la partie terminee.';
COMMENT ON COLUMN parties.etat IS 'Etat intermediaire du blackjack (mains, cartes restantes). Vide pour roulette et machine, resolues en un coup.';


-- -----------------------------------------------------------------------------
-- TRANSACTIONS — le grand livre
-- -----------------------------------------------------------------------------
-- Append-only : jamais d'UPDATE, jamais de DELETE (verrouille par trigger).
-- montant est SIGNE : une mise est negative, un gain est positif.
-- Le solde d'un joueur, c'est sum(montant). Tout le reste est du cache.
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  joueur_id   int           NOT NULL REFERENCES joueurs(id) ON DELETE RESTRICT,
  partie_id   bigint        REFERENCES parties(id) ON DELETE RESTRICT,
  type        text          NOT NULL,
  montant     numeric(14,2) NOT NULL,
  solde_apres numeric(14,2) NOT NULL,
  libelle     text,
  cree_le     timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT transactions_type_valide CHECK (
    type IN ('depot', 'retrait', 'mise', 'gain', 'bonus', 'remboursement',
             'transfert_envoye', 'transfert_recu')
  ),
  CONSTRAINT transactions_montant_non_nul CHECK (montant <> 0),
  -- Le signe decoule du type : une mise ne peut pas crediter un compte.
  CONSTRAINT transactions_signe_coherent CHECK (
    CASE type
      WHEN 'mise'             THEN montant < 0
      WHEN 'retrait'          THEN montant < 0
      WHEN 'transfert_envoye' THEN montant < 0
      ELSE montant > 0
    END
  ),
  CONSTRAINT transactions_solde_positif CHECK (solde_apres >= 0)
);

COMMENT ON TABLE transactions IS 'Grand livre append-only. Source de verite du solde. UPDATE et DELETE sont refuses par trg_livre_immuable.';


-- -----------------------------------------------------------------------------
-- JOURNAL D'AUDIT
-- -----------------------------------------------------------------------------
-- Alimente par des triggers AFTER (module 04, slide 47). Historise qui a change
-- quoi, quel que soit le client : web, script, pgAdmin ou BI.
-- -----------------------------------------------------------------------------
CREATE TABLE journal_audit (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_cible  text        NOT NULL,
  operation    text        NOT NULL,
  cle          text,
  avant        jsonb,
  apres        jsonb,
  role_bdd     text        NOT NULL DEFAULT current_user,
  joueur_app   text        DEFAULT nullif(current_setting('app.joueur_id', true), ''),
  cree_le      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT journal_operation_valide CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'))
);

COMMENT ON COLUMN journal_audit.role_bdd   IS 'Role PostgreSQL reellement connecte (casino_api, postgres...).';
COMMENT ON COLUMN journal_audit.joueur_app IS 'Utilisateur applicatif, pose par l''API via set_config(''app.joueur_id'', ...) — le meme reglage que celui qui pilote la RLS.';


-- -----------------------------------------------------------------------------
-- AMITIES — le graphe social
-- -----------------------------------------------------------------------------
CREATE TABLE amities (
  joueur_id int         NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  ami_id    int         NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  cree_le   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (joueur_id, ami_id),
  CONSTRAINT amities_pas_soi_meme CHECK (joueur_id <> ami_id)
);

COMMENT ON TABLE amities IS 'Graphe d''amities, rendu symetrique par le trigger amities_symetrie.';


-- -----------------------------------------------------------------------------
-- TRANSFERTS — qui envoie des jetons a qui
-- -----------------------------------------------------------------------------
-- Le grand livre sait qu'alice a perdu 500 jetons et que bob en a gagne 500,
-- mais pas que l'un a paye l'autre. Cette table garde le LIEN : c'est un graphe
-- oriente (expediteur -> destinataire), parcouru en WITH RECURSIVE ... CYCLE
-- pour detecter les jetons qui tournent en boucle (detecter_collusion()).
-- -----------------------------------------------------------------------------
CREATE TABLE transferts (
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
