# Audit du projet par rapport à la grille d'évaluation

Références : `Projet-BDD-Consignes.pdf` et `Projet-BDD-Grille-evaluation.pdf` (EFREI, M1 Dév).
Audit réalisé le 30/10/2026 sur la branche `master` (commit `09daf89`), puis après les
corrections de la branche `ahuV1`.

## Comment l'audit a été vérifié

Rien n'est déclaré « validé » sur la seule foi du README. Chaque point a été vérifié dans
le code, puis **exécuté** :

| Vérification | Où | Résultat |
|---|---|---|
| Initialisation complète du schéma et du seed sur un cluster PostgreSQL **vierge** | conteneur Linux, PostgreSQL 16 | OK en 1 min 07 : 10 005 joueurs, 800 000 parties, 1 208 221 mouvements |
| Démos SQL 01, 02, 04 | idem | 0 erreur |
| Démo SQL 05 (sécurité) | idem | 12 `permission denied`, comme attendu |
| Démo SQL 03 (index, `EXPLAIN ANALYZE`) | idem | mesures reprises dans `docs/presentation.md` § 7 |
| Pile Docker complète (7 services) | PC Windows, Docker Desktop, PostgreSQL 18.6 | `docker compose up -d --wait` : 7 services *Healthy* |
| `npm run test:api` : 37 tests de bout en bout | PC Windows | **37 réussis, 0 échec** |
| `npm run typecheck:docker` (API + front) | PC Windows | 0 erreur |
| `npm run demo:mongo` | PC Windows | OK (sortie dans `docs/presentation.md` § 6 et § 7) |
| `npm run sauvegarde` | PC Windows | OK en 19 s (94,3 Mo + 0,8 Mo) |
| `pg_restore --clean` d'une sauvegarde | conteneur Linux | OK : 1 208 239 transactions, 10 politiques RLS |

**Non vérifié directement** : un `docker compose down -v` suivi d'un `up` sur le PC (la
suppression des volumes a été bloquée par sécurité pendant l'audit), et le front dans un
navigateur (le navigateur disponible bloquait les appels de `:5173` vers `:3000`). À faire
en premier dans la [checklist](checklist-enregistrement.md).

---

## Tableau de conformité

Légende : ✅ validé · 🟡 partiellement validé · ❌ non validé.
« Avant » = état de `master` au début de l'audit. « Après » = branche `ahuV1`.

### Partie 1 — Projet technique (12,5 points)

#### Base relationnelle (4 points)

| Critère | Pts | Avant | Après | Preuve (fichier, fonction, requête) | Manipulation pour la vidéo | Reste à faire |
|---|---|---|---|---|---|---|
| Schéma cohérent : PK, FK, `NOT NULL`, `UNIQUE`, `CHECK` | 1 | ✅ | ✅ | `db/init/01_schema.sql` : 7 tables, 9 FK, 3 `UNIQUE`, 23 `CHECK`, 1 colonne générée | `npm run contenu:sql` (section « Contraintes de la table transactions ») | — |
| CRUD fonctionnel sur les tables principales | 0,5 | 🟡 aucun `DELETE` exposé | ✅ | C : `inscrire()`, `jouer_*()`, `deposer()`, `ajouter_ami()` · R : vues et `/moi/*` · U : `modifier_profil()`, `PATCH /moi`, `POST /admin/joueurs/statut` · D : `retirer_ami()` (`DELETE /moi/amis/:id`) | `npm run test:api`, section [3] (« 2 lignes supprimées ») | Le grand livre n'a volontairement pas de `DELETE` (append-only) : le dire à l'oral |
| Jointures internes et externes | 0,5 | ✅ | ✅ | `LEFT JOIN` : `v_stats_joueur`, `v_resultats_par_jeu` (filtre dans le `ON`), `v_solde_joueur` · `INNER JOIN` : `GET /moi/amis`, `00-contenu.sql` | `npm run demo:1`, Q1 et Q2 (anti-jointure) | — |
| Requêtes avancées : `GROUP BY`/`HAVING`, sous-requêtes/`EXISTS`, CTE | 1 | ✅ | ✅ | `db/demo/01-requetes-complexes.sql` : Q2 `NOT EXISTS` / piège `NOT IN`, Q3 CTE chaînées, Q4 `WITH RECURSIVE`, Q5 `FILTER` + `HAVING`, Q6 sous-requête corrélée, Q7 `GROUPING SETS`, Q8 fenêtrage, Q9 `WITH RECURSIVE ... CYCLE` | `npm run demo:1` | — |
| Une vue utilisée par l'application + un index avec `EXPLAIN` avant/après | 0,5 | ✅ | ✅ | 6 vues lues par l'API (`v_jeux_actifs` : `GET /jeux`, `v_stats_joueur`, `v_solde_joueur`, `v_resultats_par_jeu`, `v_historique_parties`, `v_profil_public`) + `mv_stats_quotidiennes` · `db/demo/03-index.sql` | `npm run demo:3` : historique d'un joueur 60,8 ms → 0,08 ms | — |
| Logique serveur + rôle applicatif aux droits limités | 0,5 | ✅ | ✅ | 45 fonctions, 6 procédures, 10 déclencheurs · `casino_api` : aucun droit d'écriture, `EXECUTE` sur 20 fonctions `SECURITY DEFINER` · `GET /sante` renvoie `role_postgres: casino_api` | `UPDATE` refusé en `casino_api` (voir commandes) + `/sante` | — |

#### Base non relationnelle (4 points)

| Critère | Pts | Avant | Après | Preuve | Manipulation pour la vidéo | Reste à faire |
|---|---|---|---|---|---|---|
| Modélisation adaptée à la famille et au besoin | 1 | ✅ (README) | ✅ | `stats_joueurs` (embarqué, clés dynamiques, une branche par jeu) ; `replays` (référence à `parties.id`, sous-document `annotation`) ; Redis (session, compteur, ZSET) · `docs/presentation.md` § 4 | `npm run mongo` puis `db.stats_joueurs.findOne({_id: 742})` | — |
| CRUD fonctionnel | 0,5 | 🟡 C/R, et U par `$inc` ; pas de D ni d'écriture explicite | ✅ | `api/src/infra/mongo.ts` : `enregistrerReplay`, `lireReplays`, `annoterReplay` (`findOneAndUpdate`), `supprimerReplay` (`deleteOne`) | `npm run test:api`, section [5] ; `db/demo/06-mongodb.js` § 6 | — |
| Requêtes avancées : pipeline d'agrégation, structures adaptées | 1,5 | ❌ aucun `aggregate` | ✅ | `analyserTirages()` : `$facet`, `$objectToArray`, `$unwind`, `$group`, `$round` (`GET /statistiques/tirages`) · `grosGagnants()` : filtre `$gte` sur champ imbriqué, projection, tri · ZSET Redis (`ZINCRBY`/`ZREVRANGE`) | `npm run demo:mongo` § 2, 4, 5 | — |
| Index, TTL ou contrainte | 0,5 | ✅ (unique, TTL, validateur) | ✅ | `replays` : unique `partieId`, composite, **TTL** 1 an, **partiel** (favoris) · `stats_joueurs` : index sur champ imbriqué · validateurs `$jsonSchema` · TTL Redis (`SETEX`, `EXPIRE`) | `npm run demo:mongo` § 3 : `IXSCAN` 109 docs contre `COLLSCAN` 10 004 ; § 6 : document refusé par le validateur | — |
| Jeu de données réaliste, volume suffisant | 0,5 | 🟡 | 🟡 | `stats_joueurs` : **10 004 documents** dérivés de 800 000 parties (peuplement automatique) | `db.stats_joueurs.countDocuments()` | `replays` ne contient que les parties jouées dans l'application (0 au démarrage), et chaque joueur généré a 26-27 parties par jeu (répartition peu réaliste). Voir « Améliorations possibles » |

#### Application et API (2,5 points)

| Critère | Pts | Avant | Après | Preuve | Manipulation pour la vidéo | Reste à faire |
|---|---|---|---|---|---|---|
| Connexion effective à toutes les bases | 0,5 | ✅ | ✅ | `api/src/infra/postgres.ts`, `mongo.ts`, `redis.ts` · `GET /sante` | `docker compose ps` + `/sante` + `npm run test:api` | — |
| Endpoints lecture/écriture relationnelle | 0,75 | ✅ | ✅ | `GET /moi/solde`, `/moi/transactions`, `/moi/amis` · `POST /moi/depot`, `/jeux/*`, `/moi/amis` · `DELETE /moi/amis/:id` | jouer une partie dans le front, puis `npm run derniere-partie:sql` | — |
| Endpoints lecture/écriture non relationnelle | 0,75 | 🟡 lecture seule exposée | ✅ | `GET /moi/replays`, `/moi/stats-jeux`, `/statistiques/tirages` · `PATCH`/`DELETE /moi/replays/:id` · écriture à chaque partie | `npm run derniere-partie:mongo` + `npm run test:api` [5] | — |
| Un endpoint croisant les deux bases + gestion des erreurs | 0,5 | ✅ (`/parties/:id/verification`) ; 🟡 pas de 404 pour une partie absente | ✅ | `GET /moi/bilan` (argent PostgreSQL + comportement MongoDB, contrôle de cohérence) · onglet « Bilan croisé » du front · erreurs 400/401/403/404/409/503 dans `server.ts` et `erreurs.ts` | Profil → Mes stats → « Bilan croisé » ; transfert vers un pseudo inexistant → bandeau rouge | — |

#### Infrastructure (2 points)

| Critère | Pts | Avant | Après | Preuve | Manipulation pour la vidéo | Reste à faire |
|---|---|---|---|---|---|---|
| `docker compose` fonctionnel, une commande, machine vierge | 1 | ✅ | ✅ *sous réserve* | `docker-compose.yml` : 7 services, *healthchecks*, `depends_on: service_healthy` | `docker compose down -v` puis `docker compose up -d --wait` | **Faire un `down -v` + `up` complet avant l'enregistrement** (non exécuté pendant l'audit) |
| Scripts de création des schémas, collections, contraintes | 0,5 | ✅ | ✅ | `db/init/01` à `05`, `db/mongo-init/01-collections.js` | montrer les fichiers dans IntelliJ pendant le démarrage | — |
| Script de peuplement | 0,5 | ✅ | ✅ | `db/init/06_seed.sql` (`generate_series`, `setseed`) + peuplement MongoDB automatique au démarrage (`export_stats_joueurs()`) | `docker compose logs api` → « Stats Mongo reconstruites : … » | — |

### Partie 2 — Documentation (4,5 points)

| Critère | Pts | Avant | Après | Preuve | Reste à faire |
|---|---|---|---|---|---|
| README : présentation, prérequis, démarrage, endpoints, liens | 1 | 🟡 pas de prérequis, pas de lien vers la présentation ni la vidéo | ✅ | `README.md` : tableau des documents, prérequis, raccourcis, routes, gestion des erreurs, sauvegarde, vidéo, outils d'IA | **Remplacer « à compléter » par le lien de la vidéo** |
| Présentation et schéma d'architecture | 0,5 | ❌ pas de `docs/` | ✅ | `docs/presentation.md` § 1-2, `docs/schemas/architecture.png` | — |
| MCD, MLD, MPD (script commenté) | 1 | ❌ | ✅ | `docs/presentation.md` § 3, `docs/schemas/mcd.png`, `mld.png`, `db/init/01_schema.sql` | — |
| Structure NoSQL documentée avec un exemple commenté | 0,5 | 🟡 dans le README | ✅ | `docs/presentation.md` § 4 (documents réels commentés, index, CRUD, clés Redis) | — |
| Justification des bases, de la répartition, des relations inter-bases | 1 | ✅ (README) | ✅ | `docs/presentation.md` § 5 (dont le tableau « Comment les bases sont reliées ») | — |
| Exemples de requêtes + stratégie de sauvegarde | 0,5 | 🟡 pas de sauvegarde | ✅ | `docs/presentation.md` § 6 (6 requêtes avec intention et résultat réel) et § 8 ; `scripts/sauvegarde.mjs`, `restaurer.mjs` | — |

### Partie 3 — Vidéo (3 points)

| Critère | Pts | État | Préparé dans |
|---|---|---|---|
| Démarrage de la pile et peuplement montrés en direct, preuve du contenu | 1 | ❌ à enregistrer | [scénario](scenario-video.md), séquences 3 et 4 |
| Application en fonctionnement, écriture puis relecture, lecture croisée | 1 | ❌ à enregistrer | séquence 5 |
| Requêtes avancées exécutées et commentées, choix techniques expliqués | 1 | ❌ à enregistrer | séquences 2 et 6 |

### Bonus (2 points maximum)

| Critère | Pts | État | Preuve |
|---|---|---|---|
| Frontend fonctionnel connecté à l'API | 1 | ✅ | `web/` (React) : connexion, 3 jeux, profil, statistiques, classement, bilan croisé. Compilation vérifiée (`tsc`, Vite) ; à montrer en direct |
| Troisième base justifiée, mesures de performance poussées, ou tests automatisés | 1 | ✅ | Redis (3 usages justifiés) **et** `EXPLAIN ANALYZE` / `explain('executionStats')` **et** `npm run test:api` (37 tests) |

### Pénalités

| Motif | Retrait | Risque | Commentaire |
|---|---|---|---|
| La pile ne démarre pas en suivant le README | −2 | faible | vérifié avec `up` ; refaire `down -v` + `up` avant de rendre |
| Vidéo absente, inaudible ou illisible | −3 | **élevé tant qu'elle n'est pas faite** | voir la [checklist](checklist-enregistrement.md) (taille de police, micro) |
| Une seule famille de base | −4 | nul | PostgreSQL + MongoDB + Redis |
| Secrets versionnés | −1 | faible | seuls des mots de passe **de développement** documentés sont versionnés (`api_secret`, `super_secret`, `dev-secret-a-changer-en-production`), avec `.env.example`. Le dire si la question est posée. Aucun `.env` versionné |
| Dépôt sans historique de commits significatif | −1 | **réel** | `master` n'avait que 2 commits (`init`, puis le retrait de Neo4j). La branche `ahuV1` ajoute une quinzaine de commits thématiques, signés `Co-Authored-By: Claude`. **Fusionner `ahuV1` dans `master` par une pull request** pour qu'ils apparaissent |

---

## Estimation

| Section | Avant (`master`) | Après (`ahuV1`), vidéo faite | Max |
|---|---|---|---|
| Projet technique | ≈ 9,5 | ≈ 12 à 12,5 | 12,5 |
| Documentation | ≈ 2 | ≈ 4,5 | 4,5 |
| Vidéo | 0 | 3 si les trois séquences sont convaincantes | 3 |
| Bonus | 2 | 2 | 2 |
| Pénalités | −3 (vidéo) −1 (historique) | 0 à −1 (historique) | — |
| **Total** | **≈ 9,5 / 20** | **20 / 20** (plafond), avec de la marge grâce au bonus | 20 |

Ce n'est qu'une estimation : la note dépend de l'appréciation de l'enseignant, en
particulier sur la justification et la qualité de la vidéo.

---

## Corrections apportées (branche `ahuV1`)

Par ordre de points récupérés :

1. **`docs/presentation.md`** (≈ 3 points de documentation) : les 9 parties des consignes, MCD/MLD/MPD, schémas, mesures réelles.
2. **Pipelines d'agrégation MongoDB** (1,5 point) : `GET /statistiques/tirages` et `db/demo/06-mongodb.js`.
3. **CRUD MongoDB complet** (0,5 + 0,75 point) : `PATCH` et `DELETE /moi/replays/:partieId`, filtre `?favoris=true`.
4. **CRUD relationnel avec un vrai `DELETE`** (0,5 point) : `ajouter_ami()` / `retirer_ami()` en `SECURITY DEFINER`, routes `/moi/amis`.
5. **README** (≈ 0,5 point) : prérequis, liens, routes, gestion des erreurs, **déclaration des outils d'IA** (exigée par les consignes).
6. **Lecture croisée explicite** `GET /moi/bilan`, visible dans le front (onglet « Mes stats »).
7. **Gestion des erreurs** : 404 sur `/parties/:id/verification`, 503 si MongoDB est absent, panne Redis sans effet sur une partie déjà validée.
8. **Outillage** : `scripts/test-api.mjs` (37 tests), sauvegarde et restauration, scripts de preuve pour la vidéo (`00-contenu.sql`, `07-derniere-partie.*`).
9. **Correctif Windows** : `.gitattributes` force les fins de ligne LF sur les scripts shell exécutés dans les conteneurs.

Aucune fonctionnalité existante n'a été retirée. Les fonctions SQL existantes n'ont pas été modifiées : les deux nouvelles sont ajoutées à la suite de `02_fonctions.sql` et à la surface publique de `05_securite.sql` et de la migration.

## Améliorations possibles (non faites)

- **Volume de `replays`** : générer quelques milliers de replays au démarrage, à partir des parties du seed, pour que la collection, son TTL et ses index aient du contenu sans avoir à jouer. Gain : sécuriser le critère « jeu de données » (0,5 point). Coût : modifier le seed ou l'export, et rallonger le démarrage.
- **Répartition des joueurs** : une activité de type Pareto plutôt que 26 à 27 parties pour tout le monde.
- **Rôles PostgreSQL paramétrables** par variables d'environnement (aujourd'hui écrits dans `05_securite.sql`).
- **Lien de la vidéo** à ajouter au README une fois l'enregistrement fait.
