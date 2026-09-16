-- =============================================================================
-- 04 · VUES & VUES MATERIALISEES
-- =============================================================================
-- MODULE 02. Une vue ne stocke rien : elle nomme une requete. Elle sert a
-- simplifier, reutiliser, securiser et decoupler (slide 22).
--
-- POINT CRITIQUE (slide 57) : une vue s'execute par defaut avec les droits de
-- SON PROPRIETAIRE. Elle contourne donc la RLS. Toutes les vues exposees a
-- l'API portent security_invoker = true pour appliquer les droits de l'appelant.
-- =============================================================================

\echo '=== 04 · vues ==='

SET search_path = casino, public;


-- =============================================================================
-- 1. LA VERITE COMPTABLE
-- =============================================================================
-- joueurs.solde est un cache. Ici, le solde recalcule depuis le grand livre.
-- LEFT JOIN : un joueur qui n'a jamais rien fait vaut 0, il ne disparait pas
-- (slide 13 — un produit jamais vendu n'est pas « a zero » en INNER JOIN,
-- il a disparu).
-- =============================================================================
CREATE OR REPLACE VIEW v_solde_joueur AS
SELECT j.id                                      AS joueur_id,
       j.pseudo,
       coalesce(sum(t.montant), 0)               AS solde_reel,
       j.solde                                   AS solde_cache,
       coalesce(sum(t.montant) FILTER (WHERE t.type = 'depot'), 0)  AS total_depose,
       coalesce(sum(t.montant) FILTER (WHERE t.type = 'retrait'), 0) AS total_retire,
       count(t.id)                               AS nb_mouvements
FROM joueurs j
LEFT JOIN transactions t ON t.joueur_id = j.id
GROUP BY j.id;

ALTER VIEW v_solde_joueur SET (security_invoker = true);
COMMENT ON VIEW v_solde_joueur IS 'Solde recalcule depuis le grand livre, a comparer au cache joueurs.solde.';


-- =============================================================================
-- 2. PROFIL PUBLIC — securiser par la vue
-- =============================================================================
-- « Exposer des colonnes choisies sans donner acces aux tables » (slide 22).
-- Ni email, ni hash de mot de passe, ni date de naissance : ils ne sont pas
-- dans la vue, donc ils ne peuvent pas fuir.
-- =============================================================================
CREATE OR REPLACE VIEW v_profil_public AS
SELECT j.id        AS joueur_id,
       j.pseudo,
       j.cree_le   AS inscrit_le,
       p.pseudo    AS parraine_par,
       (SELECT count(*) FROM joueurs f WHERE f.parrain_id = j.id) AS nb_filleuls
FROM joueurs j
LEFT JOIN joueurs p ON p.id = j.parrain_id
WHERE j.statut = 'actif';

ALTER VIEW v_profil_public SET (security_invoker = true);
COMMENT ON VIEW v_profil_public IS 'Profil sans donnee personnelle. Le visiteur lit cette vue, jamais la table joueurs.';


-- =============================================================================
-- 3. STATISTIQUES PAR JOUEUR — agregats conditionnels avec FILTER
-- =============================================================================
-- FILTER restreint un agregat a certaines lignes du groupe, sans sous-requete :
-- un seul passage sur parties pour six statistiques (slide 19).
-- =============================================================================
CREATE OR REPLACE VIEW v_stats_joueur AS
SELECT j.id                                                        AS joueur_id,
       j.pseudo,
       count(p.id)                                                 AS nb_parties,
       count(p.id) FILTER (WHERE p.resultat IN ('gagne','blackjack')) AS nb_gagnees,
       count(p.id) FILTER (WHERE p.resultat = 'perdu')             AS nb_perdues,
       coalesce(sum(p.mise), 0)                                    AS total_mise,
       coalesce(sum(p.gain), 0)                                    AS total_gagne,
       coalesce(sum(p.resultat_net), 0)                            AS resultat_net,
       -- NULLIF evite la division par zero pour un joueur qui n'a jamais joue.
       round(100.0 * count(p.id) FILTER (WHERE p.resultat IN ('gagne','blackjack'))
             / nullif(count(p.id), 0), 1)                          AS taux_reussite,
       -- Trois colonnes, un seul parcours de la table.
       coalesce(sum(p.resultat_net) FILTER (WHERE p.jeu_id = 1), 0) AS net_blackjack,
       coalesce(sum(p.resultat_net) FILTER (WHERE p.jeu_id = 2), 0) AS net_roulette,
       coalesce(sum(p.resultat_net) FILTER (WHERE p.jeu_id = 3), 0) AS net_machine,
       max(p.cree_le)                                              AS derniere_partie
FROM joueurs j
LEFT JOIN parties p ON p.joueur_id = j.id AND p.statut = 'terminee'
GROUP BY j.id;

ALTER VIEW v_stats_joueur SET (security_invoker = true);
COMMENT ON VIEW v_stats_joueur IS 'Un seul passage sur parties grace a FILTER. LEFT JOIN : les joueurs sans partie restent a zero.';


-- =============================================================================
-- 4. RESULTATS PAR JEU — le piege du filtre sur jointure externe
-- =============================================================================
-- La condition p.statut = 'terminee' est dans le ON, PAS dans le WHERE.
-- Dans le WHERE, elle eliminerait les jeux sans aucune partie terminee : le
-- LEFT JOIN serait devenu un INNER JOIN (slide 14).
-- =============================================================================
CREATE OR REPLACE VIEW v_resultats_par_jeu AS
SELECT g.id                              AS jeu_id,
       g.code,
       g.nom,
       g.rtp_theorique,
       count(p.id)                       AS nb_parties,
       coalesce(sum(p.mise), 0)          AS total_mise,
       coalesce(sum(p.gain), 0)          AS total_redistribue,
       -- Le CA du casino = ce que les joueurs ont perdu.
       coalesce(sum(p.mise - p.gain), 0) AS marge_casino,
       -- RTP reellement constate, a comparer au RTP annonce.
       round(sum(p.gain) / nullif(sum(p.mise), 0), 4) AS rtp_reel,
       count(DISTINCT p.joueur_id)       AS nb_joueurs
FROM jeux g
LEFT JOIN parties p ON p.jeu_id = g.id
                   AND p.statut = 'terminee'      -- <<< dans le ON
GROUP BY g.id;

COMMENT ON VIEW v_resultats_par_jeu IS 'Marge et RTP reel par jeu. Filtre place dans le ON pour conserver les jeux sans partie.';


-- =============================================================================
-- 5. HISTORIQUE DES PARTIES
-- =============================================================================
-- C'est LA vue ou security_invoker compte : sans lui, un joueur lisant cette
-- vue verrait les parties de tout le monde, parce que la vue s'executerait avec
-- les droits de son proprietaire et court-circuiterait la RLS sur parties.
-- =============================================================================
CREATE OR REPLACE VIEW v_historique_parties AS
SELECT p.id            AS partie_id,
       p.joueur_id,
       j.pseudo,
       g.code          AS jeu,
       g.nom           AS jeu_nom,
       p.mise,
       p.gain,
       p.resultat_net,
       p.resultat,
       p.etat,
       p.server_seed_hash,
       CASE WHEN p.statut = 'terminee' THEN p.server_seed END AS server_seed,
       p.statut,
       p.cree_le
FROM parties p
JOIN joueurs j ON j.id = p.joueur_id
JOIN jeux    g ON g.id = p.jeu_id;

ALTER VIEW v_historique_parties SET (security_invoker = true);
COMMENT ON VIEW v_historique_parties IS 'security_invoker = true : la RLS de parties s''applique a travers la vue (slide 57, « la fuite par les vues »).';


-- =============================================================================
-- 6. UNE VUE QUI LIT UNE VUE
-- =============================================================================
-- Les vues dependent les unes des autres (slide 26) : DROP VIEW v_stats_joueur
-- echouera tant que celle-ci existe. C'est voulu, PostgreSQL protege la chaine.
-- =============================================================================
CREATE OR REPLACE VIEW v_classement AS
SELECT rank() OVER (ORDER BY s.resultat_net DESC, s.joueur_id) AS rang,
       s.joueur_id,
       s.pseudo,
       s.nb_parties,
       s.total_mise,
       s.resultat_net,
       s.taux_reussite
FROM v_stats_joueur s
WHERE s.nb_parties > 0;

COMMENT ON VIEW v_classement IS 'Lit v_stats_joueur : essayez DROP VIEW v_stats_joueur pour voir PostgreSQL proteger la chaine de dependances.';


-- =============================================================================
-- 7. ARBRE DE PARRAINAGE — WITH RECURSIVE dans une vue
-- =============================================================================
-- L'equivalent exact de l'arbre categories.parent_id du cours (slide 18) :
-- une ancre (les joueurs sans parrain), puis une partie qui se relit elle-meme.
-- =============================================================================
CREATE OR REPLACE VIEW v_arbre_parrainage AS
WITH RECURSIVE arbre AS (
  -- 1. ancre : les racines, ceux qui n'ont ete parraines par personne
  SELECT id, pseudo, parrain_id,
         1            AS niveau,
         pseudo       AS chemin,
         id           AS racine_id
  FROM joueurs
  WHERE parrain_id IS NULL

  UNION ALL

  -- 2. recursion : les filleuls de ce qu'on vient de trouver
  SELECT j.id, j.pseudo, j.parrain_id,
         a.niveau + 1,
         a.chemin || ' > ' || j.pseudo,
         a.racine_id
  FROM joueurs j
  JOIN arbre a ON j.parrain_id = a.id
  -- La recursion s'arrete quand cette etape ne renvoie plus aucune ligne.
)
SELECT id AS joueur_id, pseudo, parrain_id, niveau, chemin, racine_id
FROM arbre;

COMMENT ON VIEW v_arbre_parrainage IS 'CTE recursive : chaque joueur avec sa profondeur et son chemin complet depuis la racine.';


-- =============================================================================
-- 8. VUE MODIFIABLE + WITH CHECK OPTION
-- =============================================================================
-- Une vue « simple » (une seule table, pas d'agregat, pas de GROUP BY) accepte
-- INSERT / UPDATE / DELETE : PostgreSQL les reporte sur la table (slide 25).
--
-- WITH CHECK OPTION interdit d'ecrire une ligne qui sortirait de la vue :
-- impossible de desactiver un jeu en passant PAR la vue des jeux actifs.
-- =============================================================================
CREATE OR REPLACE VIEW v_jeux_actifs AS
SELECT id, code, nom, mise_min, mise_max, rtp_theorique
FROM jeux
WHERE actif
WITH CHECK OPTION;

COMMENT ON VIEW v_jeux_actifs IS 'Vue modifiable. UPDATE v_jeux_actifs SET actif = false est refuse : la ligne sortirait de la vue.';


-- =============================================================================
-- 9. VUE MATERIALISEE — l'agregat coûteux, lu souvent
-- =============================================================================
-- Le tableau de bord lit des millions de parties. Recalculer a chaque
-- affichage serait absurde : on stocke le resultat (slide 23).
--
--   vue              -> toujours a jour, cout de la requete a chaque lecture
--   vue materialisee -> figee jusqu'au REFRESH, cout d'une lecture de table
--
-- L'index UNIQUE n'est pas cosmetique : il est EXIGE par REFRESH CONCURRENTLY.
-- =============================================================================
CREATE MATERIALIZED VIEW mv_stats_quotidiennes AS
SELECT p.cree_le::date                 AS jour,
       g.code                          AS jeu,
       count(*)                        AS nb_parties,
       count(DISTINCT p.joueur_id)     AS nb_joueurs,
       sum(p.mise)                     AS total_mise,
       sum(p.gain)                     AS total_redistribue,
       sum(p.mise - p.gain)            AS marge_casino,
       round(avg(p.mise), 2)           AS mise_moyenne,
       max(p.gain)                     AS plus_gros_gain
FROM parties p
JOIN jeux g ON g.id = p.jeu_id
WHERE p.statut = 'terminee'
GROUP BY 1, 2;

-- Sans cet index, REFRESH ... CONCURRENTLY refuse de s'executer.
CREATE UNIQUE INDEX mv_stats_quotidiennes_pk
  ON mv_stats_quotidiennes (jour, jeu);

-- Index de lecture : le dashboard filtre presque toujours sur une periode.
CREATE INDEX mv_stats_quotidiennes_jour ON mv_stats_quotidiennes (jour DESC);

COMMENT ON MATERIALIZED VIEW mv_stats_quotidiennes IS
  'Tableau de bord. Figee jusqu''au REFRESH. Aucune RLS possible sur une vue materialisee : elle agrege pour tout le monde, donc reservee aux roles admin/BI.';


-- Rafraichissement sans bloquer les lecteurs (exige l'index UNIQUE ci-dessus).
CREATE OR REPLACE PROCEDURE rafraichir_stats()
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stats_quotidiennes;
  RAISE NOTICE 'mv_stats_quotidiennes rafraichie a %', now();
END $$;

COMMENT ON PROCEDURE rafraichir_stats() IS 'A appeler par cron / pg_cron, ou apres un import. CONCURRENTLY : les lectures ne sont pas bloquees.';
