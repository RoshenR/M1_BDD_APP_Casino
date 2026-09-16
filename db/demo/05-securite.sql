-- =============================================================================
-- DEMO 05 · ROLES, DROITS & ROW LEVEL SECURITY
-- =============================================================================
--   docker compose exec postgres psql -U postgres -d casino -f /db/demo/05-securite.sql
--
-- A executer en tant que postgres : le script utilise SET ROLE pour se glisser
-- successivement dans la peau de chaque role, comme le fait le cours.
-- =============================================================================

\set ON_ERROR_STOP off
SET search_path = casino, public;


\echo ''
\echo '################ Q1 - Qui est qui ? ################'
\echo ''
SELECT r.rolname                          AS role,
       r.rolcanlogin                      AS "peut se connecter",
       r.rolbypassrls                     AS "ignore la RLS",
       coalesce(string_agg(g.rolname, ', ' ORDER BY g.rolname), '-') AS "membre de"
FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member = r.oid
LEFT JOIN pg_roles g        ON g.oid = m.roleid
WHERE r.rolname LIKE 'casino%'
GROUP BY r.rolname, r.rolcanlogin, r.rolbypassrls
ORDER BY r.rolcanlogin, r.rolname;


\echo ''
\echo '################ Q2 - Un role sans GRANT ne lit RIEN ################'
\echo ''
CREATE ROLE demo_inconnu NOLOGIN;
SET ROLE demo_inconnu;

\echo '-- Couche 1 : sans USAGE sur le schema, la table n EXISTE meme pas pour lui'
SELECT count(*) FROM jeux;

RESET ROLE;
GRANT USAGE ON SCHEMA casino TO demo_inconnu;
SET ROLE demo_inconnu;

\echo ''
\echo '-- Couche 2 : le schema est visible, mais la table reste fermee'
SELECT count(*) FROM jeux;

RESET ROLE;
REVOKE USAGE ON SCHEMA casino FROM demo_inconnu;
DROP ROLE demo_inconnu;

\echo ''
\echo '>>> Deux messages differents pour deux couches differentes :'
\echo '    USAGE sur le SCHEMA, puis SELECT sur la TABLE.'


\echo ''
\echo '################ Q3 - GRANT COLONNE PAR COLONNE ################'
\echo ''
-- casino_joueur a SELECT sur (id, pseudo, statut, solde, cree_le, parrain_id).
-- Pas sur email, pas sur date_naissance, pas sur mot_de_passe_hash.

SET ROLE casino_joueur;

\echo '-- Colonnes autorisees : ca passe'
SELECT id, pseudo, statut FROM joueurs WHERE id = 2;

\echo ''
\echo '-- L email : refuse'
SELECT email FROM joueurs WHERE id = 2;

\echo ''
\echo '-- Le hash du mot de passe : refuse'
SELECT mot_de_passe_hash FROM joueurs WHERE id = 2;

\echo ''
\echo '-- Et le SELECT * aussi, forcement : il demande TOUTES les colonnes'
SELECT * FROM joueurs WHERE id = 2;

RESET ROLE;

\echo ''
\echo '-- Le detail des droits, colonne par colonne :'
SELECT column_name, privilege_type, grantee
FROM information_schema.column_privileges
WHERE table_name = 'joueurs' AND grantee = 'casino_joueur'
ORDER BY column_name;


\echo ''
\echo '################ Q4 - L API ne peut pas ecrire. Du tout. ################'
\echo ''
SET ROLE casino_joueur;

\echo '-- Se crediter un million'
UPDATE joueurs SET solde = 1000000 WHERE id = 2;

\echo ''
\echo '-- Ecrire directement dans le grand livre'
INSERT INTO transactions (joueur_id, type, montant, solde_apres)
VALUES (2, 'depot', 1000000, 1000000);

\echo ''
\echo '-- Effacer une partie perdante'
DELETE FROM parties WHERE joueur_id = 2;

\echo ''
\echo '-- Appeler la fonction interne qui ecrit le grand livre'
SELECT _mouvement(2, 'depot', 1000000);

\echo ''
\echo '-- Se promouvoir administrateur'
UPDATE joueurs SET role = 'admin' WHERE id = 2;

RESET ROLE;

\echo ''
\echo '>>> Cinq facons de tricher, cinq « permission denied ».'
\echo '    La seule porte ouverte est la liste de fonctions de 05_securite.sql,'
\echo '    et chacune controle statut, exclusion, bornes de mise et solde.'


\echo ''
\echo '################ Q5 - SECURITY DEFINER : jouer sans droit d ecriture ################'
\echo ''
SET ROLE casino_joueur;
SELECT set_config('app.joueur_id', '2', false);

\echo '-- Le meme role qui vient de se voir refuser 5 ecritures... joue :'
SELECT jouer_roulette(2, 10, 'noir')->>'resultat' AS resultat,
       (jouer_roulette(2, 10, 'noir')->>'solde')::numeric AS solde;

RESET ROLE;

\echo ''
\echo '-- Comment ? La fonction s execute avec les droits de son PROPRIETAIRE.'
SELECT p.proname                         AS fonction,
       pg_get_userbyid(p.proowner)       AS proprietaire,
       p.prosecdef                       AS "security definer",
       p.proconfig                       AS "search_path fixe"
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'casino' AND p.prosecdef
ORDER BY p.proname;

\echo ''
\echo '>>> Notez le search_path = casino, public, pg_temp — avec pg_temp EN DERNIER.'
\echo '    Sans lui, un appelant pourrait creer pg_temp.joueurs : la fonction'
\echo '    lirait SA table, avec les droits du proprietaire (slide 55).'


\echo ''
\echo '################ Q6 - ROW LEVEL SECURITY ################'
\echo ''
\echo '-- Les politiques en place :'
SELECT tablename, policyname, cmd AS commande,
       array_to_string(roles, ', ') AS pour_les_roles,
       qual                         AS "USING (...)"
FROM pg_policies
WHERE schemaname = 'casino'
ORDER BY tablename, policyname;

\echo ''
SET ROLE casino_joueur;

\echo '-- SANS contexte applicatif : app_joueur_id() vaut NULL, donc zero ligne.'
SELECT set_config('app.joueur_id', '', false);
SELECT count(*) AS transactions_visibles FROM transactions;

\echo ''
\echo '-- Avec le contexte d alice (joueur 2)'
SELECT set_config('app.joueur_id', '2', false);
SELECT count(*) AS vues_par_alice FROM transactions;

\echo ''
\echo '-- Avec le contexte de bob (joueur 3) : LA REQUETE NE CHANGE PAS'
SELECT set_config('app.joueur_id', '3', false);
SELECT count(*) AS vues_par_bob FROM transactions;

\echo ''
\echo '-- Bob ne peut pas lire les parties d alice, meme en la nommant :'
SELECT count(*) AS parties_d_alice_vues_par_bob
FROM parties WHERE joueur_id = 2;

RESET ROLE;

\echo ''
\echo '-- Le meme compte, vu par le superutilisateur : tout est la.'
SELECT count(*) AS total_reel FROM transactions WHERE joueur_id = 2;


\echo ''
\echo '################ Q7 - RLS activee SANS politique = zero ligne ################'
\echo ''
-- journal_audit a la RLS activee et aucune politique pour casino_joueur.
-- Meme si un GRANT SELECT lui etait accorde par erreur, il ne verrait rien.

SELECT count(*) AS lignes_reelles FROM journal_audit;

GRANT SELECT ON journal_audit TO casino_joueur;   -- l'erreur qu'on simule

SET ROLE casino_joueur;
SELECT set_config('app.joueur_id', '2', false);
SELECT count(*) AS vues_malgre_le_grant FROM journal_audit;
RESET ROLE;

REVOKE SELECT ON journal_audit FROM casino_joueur;

\echo '>>> Ceinture (GRANT) ET bretelles (RLS).'


\echo ''
\echo '################ Q8 - LA FUITE PAR LES VUES ################'
\echo ''
-- C'est le piege de la slide 57, et la question 6 du TP 05.
-- Une vue s'execute par defaut avec les droits de SON PROPRIETAIRE :
-- elle contourne donc la RLS des tables qu'elle lit.

\echo '-- Etat actuel : nos vues applicatives portent security_invoker'
SELECT c.relname AS vue,
       coalesce((SELECT option_value
                 FROM pg_options_to_table(c.reloptions)
                 WHERE option_name = 'security_invoker'), 'false') AS security_invoker
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'casino' AND c.relkind = 'v'
ORDER BY c.relname;

\echo ''
\echo '-- On casse volontairement v_historique_parties...'
ALTER VIEW v_historique_parties SET (security_invoker = false);

SET ROLE casino_joueur;
SELECT set_config('app.joueur_id', '2', false);
\echo '   alice, a travers la vue devenue permissive :'
SELECT count(DISTINCT joueur_id) AS joueurs_visibles FROM v_historique_parties;
RESET ROLE;

\echo ''
\echo '-- ...et on repare'
ALTER VIEW v_historique_parties SET (security_invoker = true);

SET ROLE casino_joueur;
SELECT set_config('app.joueur_id', '2', false);
\echo '   alice, a travers la vue corrigee :'
SELECT count(DISTINCT joueur_id) AS joueurs_visibles FROM v_historique_parties;
RESET ROLE;

\echo ''
\echo '>>> Une vue mal configuree annule toute la RLS en silence.'
\echo '    A verifier systematiquement sur chaque vue exposee.'


\echo ''
\echo '################ Q9 - Le role de reporting ne voit aucune PII ################'
\echo ''
SET ROLE casino_bi;

\echo '-- Les agregats : autorises'
SELECT jour, jeu, nb_parties, marge_casino
FROM mv_stats_quotidiennes
ORDER BY jour DESC, jeu
LIMIT 5;

\echo ''
\echo '-- La table des joueurs : refusee'
SELECT pseudo FROM joueurs LIMIT 1;

\echo ''
\echo '-- Le grand livre : refuse'
SELECT count(*) FROM transactions;

RESET ROLE;

\echo ''
\echo '>>> Une vue materialisee ne connait pas la RLS : elle agrege pour tout'
\echo '    le monde. C est exactement pour ca qu elle n est accordee qu au BI.'


\echo ''
\echo '################ Q10 - Bilan des droits ################'
\echo ''
SELECT grantee, table_name, string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) AS droits
FROM information_schema.role_table_grants
WHERE table_schema = 'casino'
  AND grantee LIKE 'casino%'
GROUP BY grantee, table_name
ORDER BY grantee, table_name;

\echo ''
\echo '-- Et les fonctions accessibles a l application :'
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fonction,
       p.prosecdef AS "security definer"
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'casino'
  AND has_function_privilege('casino_joueur', p.oid, 'EXECUTE')
ORDER BY p.proname;
