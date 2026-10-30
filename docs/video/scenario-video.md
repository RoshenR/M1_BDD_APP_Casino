# Scénario de la vidéo

Durée cible : **10 min 15 s** (fourchette imposée : 8 à 12 min).
Chaque séquence vise des critères précis de la grille, notés entre crochets.
Le texte à dire est dans [`script-oral.md`](script-oral.md), et les commandes exactes dans
[`commandes-demo.md`](commandes-demo.md).

## Vue d'ensemble

| # | Début | Durée | Séquence | À l'écran | Critères démontrés |
|---|---|---|---|---|---|
| 1 | 0:00 | 0:40 | Introduction | README dans IntelliJ (aperçu Markdown) | Présentation du projet |
| 2 | 0:40 | 1:00 | Architecture et choix | `docs/presentation.md` : schéma d'architecture, tableau « Comment les bases sont reliées » | Vidéo 3 (choix techniques) · Doc : justification |
| 3 | 1:40 | 1:30 | Démarrage vierge | Terminal : `down -v`, `up -d --wait` ; pendant l'attente, scripts `db/init`, `mongo-init`, *healthcheck* ; `docker compose ps`, log « Stats Mongo reconstruites » | Vidéo 1 · Infra (compose, création, peuplement) |
| 4 | 3:10 | 1:50 | Contenu et structure des bases | `npm run contenu:sql`, `UPDATE` refusé en `casino_api`, `npm run mongo` (count, `findOne`, index), Redis | Vidéo 1 · Relationnel (schéma, contraintes, rôle limité) · NoSQL (modélisation, index, TTL, volume) |
| 5 | 5:00 | 2:15 | Application : écriture, relecture, lecture croisée, erreurs | Front (alice, roulette) → `derniere-partie:sql` → `derniere-partie:mongo` → Redis → « Bilan croisé » → erreur 404 → `npm run test:api` | Vidéo 2 · API (connexion aux bases, endpoints R/W des deux familles, endpoint croisé, erreurs) · Bonus front |
| 6 | 7:15 | 2:15 | Requêtes avancées et performance | `npm run demo:1` (Q1, Q5, Q9), `npm run demo:3` (avant/après), `npm run demo:mongo` (explain, pipeline, validateur) | Vidéo 3 · Relationnel (requêtes avancées, index) · NoSQL (requêtes avancées, index) · Bonus perf |
| 7 | 9:30 | 0:45 | Conclusion | `docs/presentation.md` § 9 ou README « Outils d'IA » | Synthèse, limites |

Le script oral compte environ 1 300 mots, soit **9 min 20 s de parole** à 140 mots par
minute. Avec les manipulations, la vidéo fera 10 à 11 min 30. **Chronométrer la
répétition** : au-delà de 11 min 30, supprimer dans cet ordre la commande Redis de la
séquence 4, Q5 dans la séquence 6, puis le contre-exemple C de `demo:3`. En dessous de
9 min, ajouter la séquence facultative « Sauvegarde » (`npm run sauvegarde`, 20 s).

## Détail par séquence

### 1 · Introduction (0:00 – 0:40)

- **Écran** : `README.md` en aperçu, en haut (titre, citation, tableau des documents, pile technique).
- **Action** : aucune ; faire défiler lentement jusqu'à « Pile technique ».
- **Message clé** : un casino en ligne, l'argent dans PostgreSQL, le comportement de jeu dans MongoDB, l'éphémère dans Redis.

### 2 · Architecture et choix techniques (0:40 – 1:40)

- **Écran** : `docs/presentation.md`, § 2 (image d'architecture), puis § 5 (tableau des liens entre bases).
- **Message clé** : la répartition suit la nature de la donnée ; PostgreSQL est la source de vérité, et MongoDB contient du dérivé, relié par le même identifiant joueur et partie.

### 3 · Démarrage depuis zéro (1:40 – 3:10)

- **Prérequis** : avoir fait un `down -v` + `up` complet **avant** l'enregistrement, pour que les images soient déjà construites.
- **Actions** : `docker compose down -v` → `docker compose up -d --wait`.
- **Pendant l'attente** (≈ 1 à 2 min, à commenter sans couper) : montrer `db/init/01_schema.sql` (contraintes), `06_seed.sql` (`generate_series`), `db/mongo-init/01-collections.js` (validateur, TTL), le *healthcheck* de `docker-compose.yml`.
- **Après** : `docker compose ps` (7 conteneurs) puis `docker compose logs api | Select-String "Stats Mongo"`.
- **Si l'attente dépasse 1 min 30** : on peut accélérer ce passage au montage, en l'indiquant à l'écran (« ×4 »). L'exécution reste réelle et visible.

### 4 · Contenu des bases (3:10 – 5:00)

- `npm run contenu:sql` : volumes, jointure, contraintes, intégrité (0 ligne).
- `UPDATE` en `casino_api` → `permission denied`.
- `npm run mongo` : `countDocuments()`, `findOne({_id: 742})` (commenter les clés dynamiques), `getIndexes()` sur `replays` (TTL, partiel).
- Redis : `--scan --pattern "session:*"` (après la connexion de la séquence 5, ou la montrer à ce moment-là).

### 5 · Application (5:00 – 7:15)

1. Front, connexion d'**alice** par la tuile ; le salon affiche le RTP réel (vue SQL).
2. Roulette : 10 jetons sur Rouge.
3. `npm run derniere-partie:sql` : la partie et son débit/crédit dans le grand livre.
4. `npm run derniere-partie:mongo` : le replay (même `partieId`) et les stats d'alice.
5. `ZREVRANGE` Redis : alice dans le classement temps réel.
6. Front : Profil → Mes stats → **Bilan croisé** (PostgreSQL + MongoDB, « synchronisé »).
7. Front : transfert vers `personne_123` → bandeau rouge (404).
8. `npm run test:api` : 37 OK, à faire défiler en commentant les sections 3 (`DELETE` SQL) et 5 (CRUD MongoDB).

### 6 · Requêtes avancées et performance (7:15 – 9:30)

1. `npm run demo:1` : Q1 (`LEFT JOIN`, filtre dans le `ON`), Q5 (`FILTER`, `HAVING`), Q9 (`WITH RECURSIVE ... CYCLE`).
2. `npm run demo:3` : la requête A avant (`Seq Scan`, ≈ 55 ms), puis après (`Index Scan`, < 1 ms) ; la requête C qui n'accélère pas.
3. `npm run demo:mongo` : § 3 `IXSCAN` contre `COLLSCAN`, § 4 pipeline (équité de la roulette), § 6 validateur.

### 7 · Conclusion (9:30 – 10:15)

- **Écran** : `docs/presentation.md` § 9 (limites).
- **Message** : ce qui est garanti par la base, la complémentarité des trois bases, deux limites assumées, une piste d'amélioration.

## Montage

- Une seule prise par séquence ; couper les silences et les fautes de frappe, **jamais** une exécution.
- Ajouter en surimpression, en bas à droite, le numéro et le titre de la séquence (aide la lecture du correcteur).
- Exporter en MP4 (H.264, AAC), 1080p, 30 images/s. Viser **moins de 95 Mo** pour pouvoir déposer le fichier sur GitHub (voir la checklist).
