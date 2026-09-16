-- =============================================================================
-- DEMO 01 · REQUETES COMPLEXES
-- =============================================================================
-- Jointures, sous-requetes, CTE, CTE recursive, agregats avances.
--
--   docker compose exec postgres psql -U postgres -d casino -f /db/demo/01-requetes-complexes.sql
--
-- ou, pour derouler requete par requete devant le jury :
--   docker compose exec postgres psql -U postgres -d casino
-- =============================================================================

\set ON_ERROR_STOP on
SET search_path = casino, public;

\echo ''
\echo '################ Q1 · Resultats par jeu — le filtre dans le ON ################'
\echo ''
-- Un jeu sans aucune partie terminee ne doit pas DISPARAITRE : il doit apparaitre
-- a zero. Si on ecrivait WHERE p.statut = 'terminee', les lignes completees a NULL
-- seraient eliminees et le LEFT JOIN redeviendrait un INNER JOIN.
--
-- Regle : filtre sur la table optionnelle -> dans le ON.
--         filtre sur la table principale  -> dans le WHERE.

SELECT g.nom,
       count(p.id)                                   AS nb_parties,
       coalesce(sum(p.mise), 0)                      AS total_mise,
       coalesce(sum(p.gain), 0)                      AS redistribue,
       coalesce(sum(p.mise - p.gain), 0)             AS marge_casino,
       round(sum(p.gain) / nullif(sum(p.mise), 0), 4) AS rtp_reel,
       g.rtp_theorique
FROM jeux g
LEFT JOIN parties p ON p.jeu_id = g.id
                   AND p.statut = 'terminee'         -- <<< ici, pas dans le WHERE
GROUP BY g.id
ORDER BY marge_casino DESC;

\echo ''
\echo '-- La meme requete, le filtre deplace dans le WHERE : comparez les totaux'
\echo ''
SELECT count(*) AS lignes_avec_filtre_dans_ON
FROM jeux g
LEFT JOIN parties p ON p.jeu_id = g.id AND p.statut = 'terminee';

SELECT count(*) AS lignes_avec_filtre_dans_WHERE
FROM jeux g
LEFT JOIN parties p ON p.jeu_id = g.id
WHERE p.statut = 'terminee';


\echo ''
\echo '################ Q2 · Joueurs qui n''ont jamais joue — NOT EXISTS ################'
\echo ''
-- NOT EXISTS s'arrete a la premiere ligne trouvee, est insensible aux NULL, et
-- le planificateur en fait un Anti Join : un seul passage.
-- NOT IN se ferait pieger par un seul NULL dans la sous-requete et rendrait 0.

SELECT count(*) AS jamais_joue
FROM joueurs j
WHERE NOT EXISTS (
  SELECT 1                       -- la valeur renvoyee n'a aucune importance
  FROM parties p
  WHERE p.joueur_id = j.id
);

\echo ''
\echo '-- Version anti-jointure : LEFT JOIN ... WHERE p.id IS NULL (meme resultat)'
\echo ''
SELECT count(*) AS jamais_joue_anti_jointure
FROM joueurs j
LEFT JOIN parties p ON p.joueur_id = j.id
WHERE p.id IS NULL;

\echo ''
\echo '-- Le piege de NOT IN : un seul NULL et le resultat tombe a zero'
\echo ''
SELECT count(*) AS avec_un_null_parasite
FROM joueurs
WHERE id NOT IN (
  SELECT joueur_id FROM parties
  UNION ALL SELECT NULL          -- id NOT IN (7, NULL) -> NULL, jamais vrai
);


\echo ''
\echo '################ Q3 · CTE — chiffre d''affaires mensuel et panier moyen ################'
\echo ''
-- Plusieurs CTE separees par des virgules, chacune pouvant lire la precedente :
-- on ecrit la requete dans l'ordre ou on la pense.

WITH parties_payantes AS (
  SELECT p.id,
         date_trunc('month', p.cree_le) AS mois,
         p.mise,
         p.gain,
         p.mise - p.gain AS marge
  FROM parties p
  WHERE p.statut = 'terminee'
),
par_mois AS (
  SELECT mois,
         count(*)    AS nb_parties,
         sum(mise)   AS volume,
         sum(marge)  AS marge
  FROM parties_payantes
  GROUP BY mois
)
SELECT to_char(mois, 'YYYY-MM')         AS mois,
       nb_parties,
       volume,
       marge,
       round(volume / nb_parties, 2)    AS mise_moyenne,
       round(100.0 * marge / volume, 2) AS marge_pct
FROM par_mois
ORDER BY mois;


\echo ''
\echo '################ Q4 · CTE RECURSIVE — l''arbre de parrainage ################'
\echo ''
-- Une ancre (les joueurs sans parrain), puis une partie qui se relit elle-meme
-- jusqu'a ne plus rien produire. C'est la structure categories.parent_id du cours.

WITH RECURSIVE arbre AS (
  -- 1. ancre : les racines
  SELECT id, pseudo, 1 AS niveau, pseudo::text AS chemin
  FROM joueurs
  WHERE parrain_id IS NULL AND id <= 5

  UNION ALL

  -- 2. recursion : les filleuls de ce qu'on vient de trouver
  SELECT j.id, j.pseudo, a.niveau + 1, a.chemin || ' > ' || j.pseudo
  FROM joueurs j
  JOIN arbre a ON j.parrain_id = a.id
  WHERE a.niveau < 5                       -- on limite l'affichage, pas la logique
)
SELECT niveau, chemin
FROM arbre
ORDER BY chemin
LIMIT 30;

\echo ''
\echo '-- Profondeur de l''arbre complet et nombre de joueurs par niveau'
\echo ''
SELECT niveau, count(*) AS nb_joueurs
FROM v_arbre_parrainage
GROUP BY niveau
ORDER BY niveau;


\echo ''
\echo '################ Q5 · FILTER — plusieurs agregats en un seul passage ################'
\echo ''
-- FILTER restreint un agregat a certaines lignes du groupe, sans sous-requete.
-- Ici : six statistiques par jeu, un seul parcours de la table parties.

SELECT g.nom,
       count(*)                                                 AS parties,
       count(*) FILTER (WHERE p.resultat = 'gagne')             AS gagnees,
       count(*) FILTER (WHERE p.resultat = 'blackjack')         AS blackjacks,
       count(*) FILTER (WHERE p.resultat = 'egalite')           AS egalites,
       count(*) FILTER (WHERE p.resultat = 'perdu')             AS perdues,
       round(100.0 * count(*) FILTER (WHERE p.resultat IN ('gagne','blackjack'))
             / count(*), 2)                                     AS pct_gagnant,
       max(p.gain)                                              AS plus_gros_gain
FROM parties p
JOIN jeux g ON g.id = p.jeu_id
WHERE p.statut = 'terminee'
GROUP BY g.id
HAVING count(*) > 1000                     -- HAVING filtre les GROUPES, apres agregation
ORDER BY pct_gagnant DESC;


\echo ''
\echo '################ Q6 · Sous-requete correlee : elegante, mais chere ################'
\echo ''
-- Une sous-requete correlee est REJOUEE POUR CHAQUE LIGNE de la requete
-- externe. Sur 20 joueurs et une table sans index, c'est deja 40 balayages
-- des 800 000 parties. Sur les 10 005 joueurs, ce serait 20 000 balayages :
-- plusieurs minutes. D'ou le LIMIT — et la lecon.

\timing on
SELECT j.pseudo,
       (SELECT count(*)              FROM parties p WHERE p.joueur_id = j.id) AS nb_parties,
       (SELECT sum(p.mise - p.gain)  FROM parties p WHERE p.joueur_id = j.id) AS perdu
FROM joueurs j
WHERE j.id BETWEEN 6 AND 25
ORDER BY perdu DESC NULLS LAST;
\timing off

\echo ''
\echo '-- La MEME question, en une jointure + agregat : un seul passage,'
\echo '   sur la totalite des joueurs, et incomparablement plus rapide.'
\echo ''
\timing on
SELECT j.pseudo,
       j.solde,
       count(p.id)                       AS nb_parties,
       coalesce(sum(p.mise - p.gain), 0) AS perdu
FROM joueurs j
JOIN parties p ON p.joueur_id = j.id AND p.statut = 'terminee'
WHERE j.statut = 'actif'
GROUP BY j.id
ORDER BY perdu DESC
LIMIT 10;
\timing off

\echo ''
\echo '>>> Regle : une sous-requete correlee pour QUELQUES lignes, une jointure'
\echo '    agregee des qu il y en a beaucoup. Le module 03 explique pourquoi.'


\echo ''
\echo '################ Q7 · GROUPING SETS — sous-totaux en une requete ################'
\echo ''
-- Plusieurs niveaux d'agregation d'un coup : par jeu, par mois, et le total.

SELECT coalesce(g.nom, 'TOUS LES JEUX')                            AS jeu,
       coalesce(to_char(date_trunc('month', p.cree_le), 'YYYY-MM'), 'TOUTE PERIODE') AS mois,
       count(*)                                                    AS parties,
       sum(p.mise - p.gain)                                        AS marge
FROM parties p
JOIN jeux g ON g.id = p.jeu_id
WHERE p.statut = 'terminee'
  AND p.cree_le >= now() - interval '90 days'
GROUP BY GROUPING SETS ((g.nom, date_trunc('month', p.cree_le)), (g.nom), ())
ORDER BY jeu, mois;


\echo ''
\echo '################ Q8 · Fenetrage — le classement des joueurs ################'
\echo ''
-- rank() est calcule APRES le SELECT : il voit les agregats.

SELECT rank() OVER (ORDER BY sum(p.resultat_net) DESC) AS rang,
       j.pseudo,
       count(*)                 AS parties,
       sum(p.mise)              AS mise_totale,
       sum(p.resultat_net)      AS net
FROM joueurs j
JOIN parties p ON p.joueur_id = j.id AND p.statut = 'terminee'
WHERE j.statut = 'actif'
GROUP BY j.id
ORDER BY net DESC
LIMIT 10;
