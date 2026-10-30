-- =============================================================================
-- 07 · ECRITURE PUIS RELECTURE (PostgreSQL)        npm run derniere-partie:sql
-- =============================================================================
-- Apres avoir joue une partie dans le front avec alice : la partie et ses
-- mouvements d'argent sont dans la base, ecrits par jouer_*() en UNE transaction.
-- =============================================================================
SET search_path = casino, public;

\echo ''
\echo '--- Derniere partie d alice ---'
SELECT p.id AS partie, g.nom AS jeu, p.mise, p.gain, p.resultat_net, p.resultat,
       p.etat, p.cree_le
FROM parties p JOIN jeux g ON g.id = p.jeu_id
WHERE p.joueur_id = (SELECT id FROM joueurs WHERE pseudo = 'alice')
ORDER BY p.id DESC LIMIT 1;

\echo ''
\echo '--- Ses mouvements dans le grand livre ---'
SELECT t.id, t.type, t.montant, t.solde_apres, t.cree_le
FROM transactions t
WHERE t.partie_id = (SELECT max(id) FROM parties
                     WHERE joueur_id = (SELECT id FROM joueurs WHERE pseudo = 'alice'))
ORDER BY t.id;

\echo ''
\echo '--- Le solde cache est egal a la somme du grand livre ---'
SELECT solde_cache, solde_reel, solde_cache = solde_reel AS coherent
FROM v_solde_joueur WHERE pseudo = 'alice';
