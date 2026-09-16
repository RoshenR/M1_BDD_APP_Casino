-- =============================================================================
-- DEMO 03 · INDEX & PLANS D'EXECUTION
-- =============================================================================
-- C'EST LE SCRIPT LE PLUS PARLANT DU PROJET.
--
-- La base est livree SANS index de cle etrangere — exactement comme la base
-- Billetto du TP 03. 800 000 parties et 1,2 M de mouvements sans index : chaque
-- lecture de l'historique d'un joueur lit la table entiere.
--
--   docker compose exec postgres psql -U postgres -d casino -f /db/demo/03-index.sql
--
-- Methode (slide 36) : mesurer, comprendre, corriger, re-mesurer.
-- Jamais d'index « au feeling ».
-- =============================================================================

\set ON_ERROR_STOP on
SET search_path = casino, public;

\echo ''
\echo '#############################################################'
\echo '###   ETAPE 1 - MESURER : l etat actuel, sans index        ###'
\echo '#############################################################'
\echo ''

\echo '-- Ce que PRIMARY KEY et UNIQUE ont cree automatiquement...'
SELECT indexrelname AS index, relname AS "table",
       pg_size_pretty(pg_relation_size(indexrelid)) AS taille
FROM pg_stat_user_indexes
WHERE schemaname = 'casino'
ORDER BY relname, indexrelname;

\echo ''
\echo '-- ...et ce qui MANQUE : aucune cle etrangere n est indexee.'
\echo '   Or ce sont exactement les colonnes des jointures (slide 31).'
\echo ''

\echo '--- A - L historique du joueur 742 (1,2 M de mouvements) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, type, montant, solde_apres, cree_le
FROM transactions
WHERE joueur_id = 742
ORDER BY cree_le DESC
LIMIT 20;

\echo ''
\echo '--- B - Les parties du joueur 742 (800 000 parties) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT p.id, p.mise, p.gain, p.resultat
FROM parties p
WHERE p.joueur_id = 742;

\echo ''
\echo '--- C - Le tableau de bord du dernier mois ---'
EXPLAIN (ANALYZE, COSTS OFF)
SELECT g.nom, count(*), sum(p.mise - p.gain)
FROM parties p
JOIN jeux g ON g.id = p.jeu_id
WHERE p.cree_le >= now() - interval '30 days'
GROUP BY g.id;

\echo ''
\echo '--- D - count(*) = 0 CONTRE NOT EXISTS : SubPlan contre Anti Join ---'
\echo ''
\echo '    version naive : sous-requete correlee, rejouee pour CHAQUE joueur'
\echo '    (limitee a 50 joueurs : sur les 10 005, elle tournerait ~7 minutes)'
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM joueurs j
WHERE j.id BETWEEN 6 AND 55
  AND (SELECT count(*) FROM parties p WHERE p.joueur_id = j.id) = 0;

\echo ''
\echo '    version NOT EXISTS : un seul passage, arret a la premiere ligne'
\echo '    (sur les 10 005 joueurs, et pourtant plus rapide)'
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM joueurs j
WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.joueur_id = j.id);

\echo ''
\echo '>>> A LIRE : le noeud Seq Scan, le "Rows Removed by Filter" massif,'
\echo '    et l Execution Time. Notez-les avant de continuer.'
\echo ''


\echo ''
\echo '#############################################################'
\echo '###   ETAPE 2 - CORRIGER : creer les index qui manquent    ###'
\echo '#############################################################'
\echo ''

-- 1. La cle etrangere la plus sollicitee : l historique d un joueur.
--    Index COMPOSITE (joueur_id, cree_le DESC) : il sert le filtre ET le tri,
--    donc le ORDER BY ... LIMIT 20 n a plus rien a trier.
CREATE INDEX idx_transactions_joueur_date
  ON transactions (joueur_id, cree_le DESC);

-- 2. Les parties d un joueur.
CREATE INDEX idx_parties_joueur
  ON parties (joueur_id);

-- 3. Le tableau de bord filtre sur une periode.
CREATE INDEX idx_parties_date
  ON parties (cree_le DESC);

-- 4. L autre cle etrangere de parties (agregats par jeu).
CREATE INDEX idx_parties_jeu
  ON parties (jeu_id);

-- 5. L arbre de parrainage : la recursion joint sur parrain_id.
CREATE INDEX idx_joueurs_parrain
  ON joueurs (parrain_id);

-- 6. Index PARTIEL : une seule partie est en cours a la fois par joueur.
--    Indexer les 800 000 parties terminees ne servirait a rien ; on n indexe
--    que les quelques lignes utiles. Index minuscule, lecture immediate.
CREATE INDEX idx_parties_en_cours
  ON parties (joueur_id)
  WHERE statut = 'en_cours';

-- Rafraichir les statistiques : sans ANALYZE, le planificateur continue de
-- raisonner sur les anciennes estimations et peut ignorer les nouveaux index.
ANALYZE transactions;
ANALYZE parties;
ANALYZE joueurs;

\echo '-- 6 index crees, statistiques rafraichies.'


\echo ''
\echo '#############################################################'
\echo '###   ETAPE 3 - RE-MESURER : les memes requetes            ###'
\echo '#############################################################'
\echo ''

\echo '--- A - L historique du joueur 742 ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, type, montant, solde_apres, cree_le
FROM transactions
WHERE joueur_id = 742
ORDER BY cree_le DESC
LIMIT 20;

\echo ''
\echo '--- B - Les parties du joueur 742 ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT p.id, p.mise, p.gain, p.resultat
FROM parties p
WHERE p.joueur_id = 742;

\echo ''
\echo '--- C - Le tableau de bord du dernier mois ---'
\echo '    ATTENTION : celle-ci reste en Seq Scan, MALGRE idx_parties_date.'
\echo '    30 jours = un sixieme des 800 000 parties. Aller chercher 130 000'
\echo '    lignes une par une via l index coute PLUS CHER que de balayer la'
\echo '    table. Le planificateur a raison de l ignorer : un index n est utile'
\echo '    que sur une colonne SELECTIVE. C est la question 4 du TP 03.'
EXPLAIN (ANALYZE, COSTS OFF)
SELECT g.nom, count(*), sum(p.mise - p.gain)
FROM parties p
JOIN jeux g ON g.id = p.jeu_id
WHERE p.cree_le >= now() - interval '30 days'
GROUP BY g.id;

\echo ''
\echo '    ...mais sur une fenetre ETROITE (un seul jour), l index sert :'
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM parties
WHERE cree_le >= now() - interval '1 day';

\echo ''
\echo '--- F - Index Only Scan : repondre SANS lire la table ---'
\echo '    Toutes les colonnes demandees sont dans l index (joueur_id, cree_le).'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT max(cree_le) FROM transactions WHERE joueur_id = 742;


\echo ''
\echo '#############################################################'
\echo '###   ETAPE 4 - CE QU UN INDEX NE SAIT PAS FAIRE           ###'
\echo '#############################################################'
\echo ''

\echo '--- Colonne peu selective : 97 % des joueurs sont actifs ---'
\echo '    Le planificateur prefere, a raison, lire toute la table.'
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM joueurs WHERE statut = 'actif';

\echo ''
\echo '--- Motif au milieu : un B-tree ne sait pas le faire ---'
CREATE INDEX idx_joueurs_pseudo_tmp ON joueurs (pseudo);
ANALYZE joueurs;

\echo '    prefixe : utilisable par l index'
EXPLAIN (COSTS OFF) SELECT pseudo FROM joueurs WHERE pseudo LIKE 'joueur42%';

\echo '    motif au milieu : plus d Index Cond, seulement un Filter.'
\echo '    PostgreSQL parcourt l index EN ENTIER faute de mieux : ce n est'
\echo '    plus une recherche, c est un balayage deguise.'
EXPLAIN (COSTS OFF) SELECT pseudo FROM joueurs WHERE pseudo LIKE '%42%';

\echo '    fonction appliquee a la colonne : meme symptome, Filter sans Index Cond'
EXPLAIN (COSTS OFF) SELECT pseudo FROM joueurs WHERE lower(pseudo) = 'alice';

\echo '    ...sauf avec un index sur l EXPRESSION'
CREATE INDEX idx_joueurs_pseudo_lower ON joueurs (lower(pseudo));
ANALYZE joueurs;
EXPLAIN (COSTS OFF) SELECT pseudo FROM joueurs WHERE lower(pseudo) = 'alice';

DROP INDEX idx_joueurs_pseudo_tmp;
DROP INDEX idx_joueurs_pseudo_lower;


\echo ''
\echo '#############################################################'
\echo '###   ETAPE 5 - CE QUE LES INDEX COUTENT                   ###'
\echo '#############################################################'
\echo ''

\echo '-- Espace disque : chaque index est une structure a maintenir'
SELECT relname AS "table",
       pg_size_pretty(pg_table_size(relid))    AS donnees,
       pg_size_pretty(pg_indexes_size(relid))  AS index,
       round(100.0 * pg_indexes_size(relid) / nullif(pg_table_size(relid), 0)) AS "index pct"
FROM pg_stat_user_tables
WHERE schemaname = 'casino' AND pg_table_size(relid) > 100000
ORDER BY pg_table_size(relid) DESC;

\echo ''
\echo '-- Quels index servent VRAIMENT ? idx_scan = 0 -> candidat a la suppression'
SELECT relname AS "table", indexrelname AS index, idx_scan AS lectures,
       pg_size_pretty(pg_relation_size(indexrelid)) AS taille
FROM pg_stat_user_indexes
WHERE schemaname = 'casino'
ORDER BY idx_scan, pg_relation_size(indexrelid) DESC;

\echo ''
\echo '-- Cout en ECRITURE : +1 ecriture par index a chaque INSERT.'
\echo '   transactions porte maintenant 2 index : la PK et (joueur_id, cree_le).'
\echo ''

\echo '#############################################################'
\echo '###   Les requetes les plus couteuses (pg_stat_statements) ###'
\echo '#############################################################'
SELECT round(total_exec_time::numeric, 1) AS ms_total,
       calls,
       round(mean_exec_time::numeric, 2)  AS ms_moyen,
       left(query, 70)                    AS requete
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%'
ORDER BY total_exec_time DESC
LIMIT 10;
