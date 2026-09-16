-- =============================================================================
-- 06 · REMPLISSAGE
-- =============================================================================
-- Un jeu de donnees VOLUMINEUX, genere en SQL pur (generate_series) : pas de
-- script Node, pas de Faker, quelques dizaines de secondes.
--
-- Pourquoi du volume ? Sans lui, EXPLAIN ANALYZE ne montre rien : le
-- planificateur choisit un Seq Scan sur une petite table, et c'est le bon choix.
-- Le module 03 n'a d'interet qu'a partir de centaines de milliers de lignes.
--
-- Cible : 10 000 joueurs · 800 000 parties · ~1,2 M de mouvements.
--
-- IMPORTANT — LES INDEX DE CLE ETRANGERE NE SONT PAS CREES ICI.
-- C'est volontaire, comme la base Billetto du TP 03 (« aucune cle etrangere
-- indexee »). L'application demarre donc LENTE. Le script db/demo/03-index.sql
-- mesure, cree les index, et re-mesure.
-- =============================================================================

\echo '=== 06 · remplissage (compter 30 a 90 s) ==='

SET search_path = casino, public;

-- Reproductible : deux installations donnent exactement les memes donnees.
SELECT setseed(0.42);


-- =============================================================================
-- 1. CATALOGUE
-- =============================================================================
-- L'ordre compte : v_stats_joueur reference les jeu_id 1, 2, 3.
INSERT INTO jeux (code, nom, mise_min, mise_max, rtp_theorique) VALUES
  ('blackjack', 'Blackjack',      1,  500, 0.9950),
  ('roulette',  'Roulette',       1, 1000, 0.9730),   -- 36/37
  ('machine',   'Machine a sous', 1,  200, 0.9240);


-- =============================================================================
-- 2. COMPTES DE DEMONSTRATION
-- =============================================================================
-- Mot de passe commun : motdepasse
-- Le hachage se fait dans la base (pgcrypto / bcrypt) : voir authentifier().
-- =============================================================================
INSERT INTO joueurs (pseudo, email, mot_de_passe_hash, date_naissance, role, cree_le)
VALUES
  ('admin', 'admin@casino.test', crypt('motdepasse', gen_salt('bf', 10)), '1985-04-12', 'admin',  now() - interval '400 days'),
  ('alice', 'alice@casino.test', crypt('motdepasse', gen_salt('bf', 10)), '1995-07-03', 'joueur', now() - interval '300 days'),
  ('bob',   'bob@casino.test',   crypt('motdepasse', gen_salt('bf', 10)), '1990-01-21', 'joueur', now() - interval '280 days'),
  ('carol', 'carol@casino.test', crypt('motdepasse', gen_salt('bf', 10)), '1998-11-09', 'joueur', now() - interval '250 days'),
  ('dave',  'dave@casino.test',  crypt('motdepasse', gen_salt('bf', 10)), '1992-02-28', 'joueur', now() - interval '200 days');

-- Un peu de parrainage entre eux : alice parraine bob, bob parraine carol...
UPDATE joueurs SET parrain_id = 2 WHERE pseudo = 'bob';
UPDATE joueurs SET parrain_id = 3 WHERE pseudo = 'carol';
UPDATE joueurs SET parrain_id = 3 WHERE pseudo = 'dave';


-- =============================================================================
-- 3. IMPORT MASSIF — triggers desactives
-- =============================================================================
-- transactions_maj_solde ferait un UPDATE sur joueurs pour CHACUNE des 1,2 M
-- de lignes. C'est exactement le cout dont parle la slide 48 (« ligne a ligne
-- = cout »). Pour un import, on desactive, on charge, puis on RECALCULE ce que
-- les triggers auraient fait — et on verifie que le compte est bon.
-- =============================================================================
ALTER TABLE joueurs      DISABLE TRIGGER USER;
ALTER TABLE transactions DISABLE TRIGGER USER;


-- --- 10 000 joueurs ----------------------------------------------------------
INSERT INTO joueurs (pseudo, email, mot_de_passe_hash, date_naissance, cree_le, statut)
SELECT
  'joueur' || g,
  'joueur' || g || '@casino.test',
  -- Un seul hash bcrypt reutilise : 10 000 hachages reels prendraient 2 minutes.
  (SELECT mot_de_passe_hash FROM joueurs WHERE pseudo = 'alice'),
  (date '1970-01-01' + (random() * 11000)::int),
  now() - interval '200 days' - (random() * interval '150 days'),
  -- 2 % de comptes non actifs : de quoi voir la RLS joueurs_actifs_visibles agir.
  CASE WHEN random() < 0.015 THEN 'suspendu'
       WHEN random() < 0.005 THEN 'ferme'
       ELSE 'actif' END
FROM generate_series(1, 10000) AS g;

-- Arbre de parrainage : chaque joueur est parraine par un joueur d'id inferieur.
-- On obtient un arbre large et profond, parfait pour WITH RECURSIVE.
UPDATE joueurs
SET parrain_id = 5 + (id - 6) / 4
WHERE id > 9;

-- --- Reseau d'amities --------------------------------------------------------
INSERT INTO amities (joueur_id, ami_id)
SELECT j, a
FROM (
  SELECT g AS j, 6 + ((g * 7 + s * 131) % 10000) AS a
  FROM generate_series(6, 10005) AS g,
       generate_series(1, 4)     AS s
) x
WHERE j <> a
ON CONFLICT DO NOTHING;


-- --- 800 000 parties ---------------------------------------------------------
-- Les probabilites reproduisent le RTP annonce de chaque jeu ; db/demo/02-vues.sql
-- compare ensuite le RTP THEORIQUE de la table jeux au RTP REEL constate.
WITH tirages AS (
  SELECT
    6 + (g % 10000)                            AS joueur_id,
    1 + (g % 3)                                AS jeu_id,
    (1 + floor(random() * 50))::numeric(14,2)  AS mise,
    random()                                   AS alea,
    random()                                   AS tirage,
    md5(random()::text || g)                   AS seed,
    now() - (random() * interval '180 days')   AS cree_le
  FROM generate_series(1, 800000) AS g
),
resolues AS (
  SELECT t.*,
         round(t.mise * CASE t.jeu_id
           -- Blackjack : 39,5 % gagne (x2), 4,5 % blackjack (x2,5), 9 % egalite
           WHEN 1 THEN CASE WHEN t.tirage < 0.395 THEN 2
                            WHEN t.tirage < 0.440 THEN 2.5
                            WHEN t.tirage < 0.530 THEN 1
                            ELSE 0 END
           -- Roulette : chance simple, 18/37 = 48,65 %
           WHEN 2 THEN CASE WHEN t.tirage < 0.4865 THEN 2 ELSE 0 END
           -- Machine a sous : la table de gains de machine_multiplicateur()
           ELSE        CASE WHEN t.tirage < 0.00006 THEN 1000
                            WHEN t.tirage < 0.00040 THEN  200
                            WHEN t.tirage < 0.00140 THEN   60
                            WHEN t.tirage < 0.00410 THEN   25
                            WHEN t.tirage < 0.00990 THEN   12
                            WHEN t.tirage < 0.02050 THEN    8
                            WHEN t.tirage < 0.03610 THEN    5
                            WHEN t.tirage < 0.46550 THEN    1
                            ELSE 0 END
         END, 2) AS gain
  FROM tirages t
)
INSERT INTO parties (joueur_id, jeu_id, mise, gain, statut, resultat, etat,
                     server_seed, server_seed_hash, client_seed, nonce,
                     cree_le, terminee_le)
SELECT
  r.joueur_id,
  r.jeu_id,
  r.mise,
  r.gain,
  'terminee',
  CASE WHEN r.jeu_id = 1 AND r.gain = round(r.mise * 2.5, 2) THEN 'blackjack'
       WHEN r.gain > r.mise THEN 'gagne'
       WHEN r.gain = r.mise THEN 'egalite'
       ELSE 'perdu' END,
  CASE r.jeu_id
    WHEN 2 THEN jsonb_build_object('numero', floor(r.alea * 37)::int, 'pari', 'rouge')
    WHEN 3 THEN jsonb_build_object('rouleaux', jsonb_build_array(
                  machine_symbole(floor(r.alea * 100)::int),
                  machine_symbole(floor(r.alea * 771)::int % 100),
                  machine_symbole(floor(r.alea * 337)::int % 100)))
    ELSE        jsonb_build_object('total_joueur',   17 + floor(r.alea * 5)::int,
                                   'total_croupier', 17 + floor(r.tirage * 5)::int)
  END,
  r.seed,
  hash_seed(r.seed),
  'seed-client-demo',
  0,
  r.cree_le,
  r.cree_le + interval '40 seconds'
FROM resolues r;


-- --- Le grand livre ----------------------------------------------------------
-- On assemble tous les mouvements, puis on calcule le solde courant avec une
-- fonction de fenetrage : une seule passe, au lieu de 1,2 M d'appels de trigger.
CREATE UNLOGGED TABLE _mouvements AS
  -- Depot d'ouverture : chacun arrive avec 50 000 jetons.
  SELECT id AS joueur_id, NULL::bigint AS partie_id, 'depot' AS type,
         50000::numeric(14,2) AS montant, cree_le, 0 AS ord,
         'Depot initial'::text AS libelle
  FROM joueurs
UNION ALL
  SELECT joueur_id, id, 'mise', -mise, cree_le, 1, 'Mise'
  FROM parties
UNION ALL
  SELECT joueur_id, id, 'gain', gain, cree_le, 2, 'Gain'
  FROM parties
  WHERE gain > 0;

INSERT INTO transactions (joueur_id, partie_id, type, montant, solde_apres, libelle, cree_le)
SELECT joueur_id, partie_id, type, montant,
       sum(montant) OVER (PARTITION BY joueur_id
                          ORDER BY cree_le, ord
                          ROWS UNBOUNDED PRECEDING),
       libelle, cree_le
FROM _mouvements
ORDER BY cree_le, ord;

DROP TABLE _mouvements;


-- --- Transferts entre joueurs ------------------------------------------------
-- De quoi alimenter la detection de collusion dans Neo4j. On melange :
--   · des transferts ordinaires entre amis
--   · trois ANNEAUX volontaires (A -> B -> C -> A), le motif qu'un vrai casino
--     traque : des jetons qui tournent en boucle pour blanchir ou pour vider
--     un bonus. En SQL il faudrait une CTE recursive avec detection de cycle ;
--     en Cypher, c'est un motif d'une ligne.
-- -----------------------------------------------------------------------------
CREATE UNLOGGED TABLE _transferts (
  de int, vers int, montant numeric(14,2), cree_le timestamptz
);

-- Transferts ordinaires : chacun envoie a un ami.
INSERT INTO _transferts (de, vers, montant, cree_le)
SELECT a.joueur_id, a.ami_id,
       (10 + floor(random() * 200))::numeric(14,2),
       now() - (random() * interval '120 days')
FROM amities a
WHERE random() < 0.02;

-- Trois anneaux de collusion, bien nets.
INSERT INTO _transferts (de, vers, montant, cree_le)
SELECT x.de, x.vers, 500, now() - make_interval(days => x.j)
FROM (VALUES
  (101, 102, 1), (102, 103, 2), (103, 101, 3),
  (201, 202, 4), (202, 203, 5), (203, 204, 6), (204, 201, 7),
  (301, 302, 8), (302, 301, 9)
) AS x(de, vers, j);

INSERT INTO transactions (joueur_id, type, montant, solde_apres, libelle, cree_le)
SELECT m.joueur_id, m.type, m.montant,
       -- Solde courant recalcule en incluant ces nouveaux mouvements.
       0, m.libelle, m.cree_le
FROM (
  SELECT de   AS joueur_id, 'transfert_envoye' AS type, -montant AS montant,
         'Transfert sortant' AS libelle, cree_le FROM _transferts
  UNION ALL
  SELECT vers, 'transfert_recu', montant, 'Transfert entrant', cree_le FROM _transferts
) m;

-- solde_apres est faux pour ces lignes : on le reconstruit ci-dessous, en une
-- seule passe, exactement comme pour le reste du grand livre.
WITH recalcul AS (
  SELECT id,
         sum(montant) OVER (PARTITION BY joueur_id ORDER BY cree_le, id
                            ROWS UNBOUNDED PRECEDING) AS solde
  FROM transactions
)
UPDATE transactions t
SET solde_apres = r.solde
FROM recalcul r
WHERE r.id = t.id AND t.solde_apres <> r.solde;

DROP TABLE _transferts;


-- =============================================================================
-- 4. RECALCULER CE QUE LES TRIGGERS AURAIENT FAIT
-- =============================================================================
UPDATE joueurs j
SET solde = t.total
FROM (
  SELECT joueur_id, sum(montant) AS total
  FROM transactions
  GROUP BY joueur_id
) t
WHERE t.joueur_id = j.id;

ALTER TABLE joueurs      ENABLE TRIGGER USER;
ALTER TABLE transactions ENABLE TRIGGER USER;


-- =============================================================================
-- 5. STATISTIQUES DU PLANIFICATEUR
-- =============================================================================
-- Sans ANALYZE, le planificateur travaille sur des estimations perimees et
-- choisit de mauvais plans (slide 35). A faire apres tout import massif.
-- =============================================================================
ANALYZE joueurs;
ANALYZE parties;
ANALYZE transactions;
ANALYZE amities;
ANALYZE jeux;


-- =============================================================================
-- 6. PREMIER CALCUL DE LA VUE MATERIALISEE
-- =============================================================================
-- Elle a ete creee sur une base vide : elle est vide. On la remplit maintenant.
REFRESH MATERIALIZED VIEW mv_stats_quotidiennes;


-- =============================================================================
-- 7. CONTROLE D'INTEGRITE
-- =============================================================================
DO $$
DECLARE
  v_ecarts int;
  v_joueurs int;
  v_parties bigint;
  v_mouvements bigint;
BEGIN
  SELECT count(*) INTO v_ecarts      FROM verifier_integrite_soldes();
  SELECT count(*) INTO v_joueurs     FROM joueurs;
  SELECT count(*) INTO v_parties     FROM parties;
  SELECT count(*) INTO v_mouvements  FROM transactions;

  IF v_ecarts > 0 THEN
    RAISE EXCEPTION 'Seed incoherent : % joueur(s) dont le solde ne correspond pas au grand livre', v_ecarts;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '  joueurs      : %', v_joueurs;
  RAISE NOTICE '  parties      : %', v_parties;
  RAISE NOTICE '  transactions : % (dont transferts entre joueurs)', v_mouvements;
  RAISE NOTICE '  integrite    : OK (cache = grand livre)';
  RAISE NOTICE '';
  RAISE NOTICE '  Comptes de demo : alice / bob / carol / dave / admin';
  RAISE NOTICE '  Mot de passe    : motdepasse';
  RAISE NOTICE '';
  RAISE NOTICE '  Les index de cle etrangere ne sont PAS crees : c''est voulu.';
  RAISE NOTICE '  Voir db/demo/03-index.sql pour la demonstration avant / apres.';
  RAISE NOTICE '';
END $$;


-- Drapeau lu par le healthcheck du docker compose : tant que cette table
-- n'existe pas, l'API n'est pas demarree.
CREATE TABLE migration_terminee (
  termine_le timestamptz NOT NULL DEFAULT now()
);
INSERT INTO migration_terminee DEFAULT VALUES;
