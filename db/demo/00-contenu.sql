-- =============================================================================
-- 00 · PREUVE DU CONTENU CHARGE (PostgreSQL)              npm run contenu:sql
-- =============================================================================
-- A lancer juste apres `docker compose up -d --wait` : le seed est termine
-- (le healthcheck attend la table migration_terminee).
-- =============================================================================
SET search_path = casino, public;

\echo ''
\echo '--- Volume par table ---'
SELECT 'joueurs' AS table_, count(*) AS lignes FROM joueurs
UNION ALL SELECT 'jeux',          count(*) FROM jeux
UNION ALL SELECT 'parties',       count(*) FROM parties
UNION ALL SELECT 'transactions',  count(*) FROM transactions
UNION ALL SELECT 'amities',       count(*) FROM amities
UNION ALL SELECT 'transferts',    count(*) FROM transferts
UNION ALL SELECT 'journal_audit', count(*) FROM journal_audit
ORDER BY lignes DESC;

\echo ''
\echo '--- Taille sur disque ---'
SELECT relname AS table_, pg_size_pretty(pg_total_relation_size(relid)) AS taille
FROM pg_statio_user_tables WHERE schemaname = 'casino'
ORDER BY pg_total_relation_size(relid) DESC LIMIT 4;

\echo ''
\echo '--- Apercu : les comptes de demonstration (sans email ni hash) ---'
SELECT id, pseudo, role, statut, solde, parrain_id FROM joueurs WHERE id <= 6 ORDER BY id;

\echo ''
\echo '--- Apercu : 3 parties et leurs mouvements d argent (jointure) ---'
SELECT p.id AS partie, j.pseudo, g.code AS jeu, p.mise, p.gain, p.resultat,
       t.type, t.montant, t.solde_apres
FROM parties p
JOIN joueurs j ON j.id = p.joueur_id
JOIN jeux g    ON g.id = p.jeu_id
JOIN transactions t ON t.partie_id = p.id
WHERE p.id IN (SELECT id FROM parties WHERE statut = 'terminee' ORDER BY id LIMIT 3)
ORDER BY p.id, t.id;

\echo ''
\echo '--- Contraintes de la table transactions ---'
SELECT conname, left(regexp_replace(pg_get_constraintdef(oid), '\s+', ' ', 'g'), 110) AS definition
FROM pg_constraint WHERE conrelid = 'transactions'::regclass ORDER BY contype, conname;

\echo ''
\echo '--- Le grand livre est-il coherent ? (0 ligne attendue) ---'
SELECT * FROM verifier_integrite_soldes();
