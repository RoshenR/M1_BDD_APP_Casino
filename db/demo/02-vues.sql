-- =============================================================================
-- DEMO 02 · VUES & VUES MATERIALISEES
-- =============================================================================
--   docker compose exec postgres psql -U postgres -d casino -f /db/demo/02-vues.sql
-- =============================================================================

\set ON_ERROR_STOP on
SET search_path = casino, public;

\echo ''
\echo '################ Q1 · Une vue s''utilise comme une table ################'
\echo ''
-- v_resultats_par_jeu encapsule une jointure externe + 6 agregats.
-- L'application ne connait que le nom de la vue ; le schema peut changer derriere.

SELECT nom, nb_parties, marge_casino, rtp_reel, rtp_theorique
FROM v_resultats_par_jeu
ORDER BY marge_casino DESC;

\echo ''
\echo '-- Le RTP annonce est-il tenu ? Ecart entre theorie et pratique'
\echo ''
SELECT nom,
       rtp_theorique,
       rtp_reel,
       round((rtp_reel - rtp_theorique) * 100, 2) AS ecart_points
FROM v_resultats_par_jeu
WHERE nb_parties > 0;


\echo ''
\echo '################ Q2 · Une vue qui lit une vue ################'
\echo ''
-- v_classement lit v_stats_joueur, qui lit joueurs et parties.
-- PostgreSQL protege la chaine : essayez le DROP plus bas.

SELECT * FROM v_classement ORDER BY rang LIMIT 10;

\echo ''
\echo '-- DROP VIEW sur un maillon de la chaine : PostgreSQL refuse'
\echo ''
DO $$
BEGIN
  DROP VIEW v_stats_joueur;
  RAISE NOTICE 'Le DROP a reussi — ce n''etait pas prevu.';
EXCEPTION
  WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'Refuse, comme attendu : %', SQLERRM;
    RAISE NOTICE 'HINT : DROP VIEW ... CASCADE, puis recreer toute la chaine (dans une migration).';
END $$;


\echo ''
\echo '################ Q3 · Vue modifiable et WITH CHECK OPTION ################'
\echo ''
-- v_jeux_actifs ne contient qu'une table, aucun agregat : elle est modifiable.
-- WITH CHECK OPTION interdit d'ecrire une ligne qui SORTIRAIT de la vue.

\echo '-- Modifier une borne de mise a travers la vue : accepte'
UPDATE v_jeux_actifs SET mise_max = 1200 WHERE code = 'roulette';
SELECT code, mise_min, mise_max FROM v_jeux_actifs WHERE code = 'roulette';

\echo ''
\echo '-- Desactiver le jeu a travers la vue des jeux ACTIFS : refuse'
DO $$
BEGIN
  UPDATE v_jeux_actifs SET mise_max = 0 WHERE code = 'roulette';
  RAISE NOTICE 'Accepte — inattendu.';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'Refuse par la contrainte de la table : %', SQLERRM;
END $$;

-- Remise en etat
UPDATE jeux SET mise_max = 1000 WHERE code = 'roulette';


\echo ''
\echo '################ Q4 · Vue contre vue materialisee ################'
\echo ''
-- La vue relance sa definition a chaque lecture : toujours a jour, cout complet.
-- La vue materialisee lit une table : instantanee, mais figee jusqu'au REFRESH.

\echo '-- Cout d''une lecture de la VUE (recalcul complet)'
\timing on
SELECT count(*) FROM v_resultats_par_jeu;
\timing off

\echo ''
\echo '-- Cout d''une lecture de la VUE MATERIALISEE (simple lecture de table)'
\timing on
SELECT sum(nb_parties) FROM mv_stats_quotidiennes;
\timing off


\echo ''
\echo '################ Q5 · La fenetre de peremption ################'
\echo ''
-- On joue une partie : la vue change immediatement, la materialisee non.

\echo '-- Avant : parties d''aujourd''hui, vues des deux cotes'
SELECT 'vue (temps reel)' AS source,
       count(*)           AS parties_aujourdhui
FROM parties WHERE cree_le::date = current_date AND statut = 'terminee'
UNION ALL
SELECT 'vue materialisee',
       coalesce(sum(nb_parties), 0)
FROM mv_stats_quotidiennes WHERE jour = current_date;

\echo ''
\echo '-- On joue 5 parties de roulette avec alice (joueur 2)'
SELECT set_config('app.joueur_id', '2', false);
SELECT jouer_roulette(2, 10, 'rouge')->>'resultat' AS resultat
FROM generate_series(1, 5);

\echo ''
\echo '-- Apres : la vue a bouge, la materialisee est perimee'
SELECT 'vue (temps reel)' AS source,
       count(*)           AS parties_aujourdhui
FROM parties WHERE cree_le::date = current_date AND statut = 'terminee'
UNION ALL
SELECT 'vue materialisee',
       coalesce(sum(nb_parties), 0)
FROM mv_stats_quotidiennes WHERE jour = current_date;

\echo ''
\echo '-- REFRESH CONCURRENTLY : les lecteurs ne sont pas bloques pendant le recalcul'
\echo '   (exige l''index UNIQUE mv_stats_quotidiennes_pk)'
CALL rafraichir_stats();

SELECT 'vue materialisee apres REFRESH' AS source,
       coalesce(sum(nb_parties), 0)     AS parties_aujourdhui
FROM mv_stats_quotidiennes WHERE jour = current_date;


\echo ''
\echo '################ Q6 · Renommer une colonne d''une vue ################'
\echo ''
-- CREATE OR REPLACE VIEW accepte : changer une expression, ajouter une colonne
-- A LA FIN. Il refuse : renommer, supprimer, changer le type ou l'ordre.

DO $$
BEGIN
  CREATE OR REPLACE VIEW v_resultats_par_jeu AS
  SELECT g.id AS jeu_id, g.code, g.nom, g.rtp_theorique,
         count(p.id) AS nombre_de_parties,       -- <<< renommee
         coalesce(sum(p.mise), 0) AS total_mise,
         coalesce(sum(p.gain), 0) AS total_redistribue,
         coalesce(sum(p.mise - p.gain), 0) AS marge_casino,
         round(sum(p.gain) / nullif(sum(p.mise), 0), 4) AS rtp_reel,
         count(DISTINCT p.joueur_id) AS nb_joueurs
  FROM jeux g
  LEFT JOIN parties p ON p.jeu_id = g.id AND p.statut = 'terminee'
  GROUP BY g.id;
  RAISE NOTICE 'Accepte — inattendu.';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Refuse, comme attendu : %', SQLERRM;
    RAISE NOTICE 'Pour renommer : DROP VIEW ... CASCADE puis recreer la chaine.';
END $$;


\echo ''
\echo '################ Q7 · Une vue materialisee ne connait pas la RLS ################'
\echo ''
-- Elle agrege pour tout le monde. C'est pour cela qu'elle n'est accordee
-- qu'a casino_bi et casino_admin, jamais a casino_joueur.

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'mv_stats_quotidiennes'
ORDER BY grantee;
