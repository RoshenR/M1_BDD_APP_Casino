# Casino — projet SQL avancé (M1 EFREI)

Application web de casino fictif. **Toute la logique métier est dans PostgreSQL** :
tirages, calcul des gains, mouvements d'argent, règles de jeu responsable, droits
d'accès. L'API ne fait que valider la forme des requêtes, poser le contexte du
joueur et traduire les erreurs PostgreSQL en codes HTTP.

> *« Tout ce que la base garantit, l'application n'a plus à le vérifier — ni à l'oublier. »*

| Document | Contenu |
|---|---|
| [`docs/presentation.md`](docs/presentation.md) | Présentation complète : architecture, **MCD / MLD / MPD**, modèle MongoDB commenté, justification des choix, requêtes significatives, index, **sauvegarde**, limites |
| [`docs/video/`](docs/video/) | **Vidéo de présentation** (voir [Vidéo](#vidéo)) et son script |
| [`docs/schemas/`](docs/schemas/) | Schémas (PNG) et leurs sources Mermaid |

**Pile technique** : PostgreSQL 18 (base relationnelle, source de vérité) · MongoDB 7 (base
document) · Redis 7 (base clé-valeur) · API Node 24 / Fastify 5 / TypeScript · front
React 18 / Vite · Docker Compose.

---

## Prérequis

- **Docker** avec Compose v2 (Docker Desktop sous Windows / macOS), démon démarré.
- Environ **3 Go** d'espace disque libre (images + 1,2 M de lignes).
- Ports libres : `5173` (front), `3000` (API), `5432` (PostgreSQL), `8080` (pgAdmin),
  `27017` (MongoDB), `6379` (Redis).
- *Facultatif* : **Node 18+** sur la machine hôte, uniquement pour les raccourcis
  `npm run …` (tests, démos, sauvegarde). La pile elle-même n'en a pas besoin.

Aucun fichier `.env` n'est nécessaire : chaque variable a une valeur par défaut de
développement. [`.env.example`](.env.example) liste celles à surcharger.

## Démarrage

```bash
docker compose up -d --wait
```

Premier démarrage : **1 à 2 minutes** (génération de 10 005 joueurs, 800 000 parties,
1,2 M de mouvements). `--wait` attend la fin du remplissage, pas seulement le
démarrage du serveur.

| Service | Adresse | Identifiants |
|---|---|---|
| Front | http://localhost:5173 | — |
| API | http://localhost:3000/sante | — |
| pgAdmin | http://localhost:8080 | `admin@casino.example.com` / `admin` |
| PostgreSQL | `localhost:5432` | voir les rôles ci-dessous |

**Comptes de démonstration** — mot de passe commun : `motdepasse`

| Compte | Email | Rôle |
|---|---|---|
| `alice`, `bob`, `carol`, `dave` | `<pseudo>@casino.test` | joueur |
| `admin` | `admin@casino.test` | administrateur |

Pour repartir de zéro :

```bash
docker compose down -v && docker compose up -d --wait
```

Vérifier que tout fonctionne (37 tests de bout en bout, sur les trois bases) :

```bash
npm run test:api
```

### Raccourcis (`package.json`)

| Commande | Effet |
|---|---|
| `npm run up` / `down` / `reset` | démarrer / arrêter / tout recréer depuis zéro |
| `npm run psql` · `psql:api` · `mongo` · `redis` | ouvrir un client (superutilisateur, rôle applicatif, mongosh, redis-cli) |
| `npm run demo:1` … `demo:5` | démonstrations SQL (requêtes, vues, index, fonctions, sécurité) |
| `npm run demo:mongo` | démonstration MongoDB ([`db/demo/06-mongodb.js`](db/demo/06-mongodb.js)) |
| `npm run test:api` | tests de l'API ([`scripts/test-api.mjs`](scripts/test-api.mjs)) |
| `npm run typecheck:docker` | contrôle de type TypeScript dans le conteneur |
| `npm run sauvegarde` / `restaurer -- backups/<date>` | sauvegarde et restauration ([§ Sauvegarde](#sauvegarde)) |

---

## ⚠️ La base démarre volontairement SANS index

Aucune clé étrangère n'est indexée au premier démarrage — exactement comme la base
Billetto du TP 03 (*« aucune clé étrangère indexée »*). L'application est donc
**lente** tant que vous n'avez pas joué le module 03.

C'est le cœur de la démonstration : mesurer, corriger, re-mesurer.

```bash
docker compose exec postgres psql -U postgres -d casino -f /db/demo/03-index.sql
```

Résultats mesurés sur ce jeu de données :

| Requête | Sans index | Avec index | Gain |
|---|---|---|---|
| Historique d'un joueur (1,2 M lignes) | 46,2 ms | **0,31 ms** | ×150 |
| Parties d'un joueur (800 k lignes) | 57,8 ms | **2,22 ms** | ×26 |
| `max(cree_le)` d'un joueur | 46 ms | **0,06 ms** | Index Only Scan |
| Tableau de bord 30 jours | 195,9 ms | 204,8 ms | **aucun** (voir ci-dessous) |
| « jamais joué » — sous-requête corrélée (50 joueurs) | 6 167 ms | — | — |
| « jamais joué » — `NOT EXISTS` (10 005 joueurs) | **324 ms** | — | Anti Join |

La ligne qui n'accélère pas est la plus intéressante : 30 jours représentent un
sixième de la table, et aller chercher 130 000 lignes une par une via l'index coûte
plus cher qu'un balayage séquentiel. Le planificateur ignore l'index **à raison**.
C'est la question 4 du TP 03.

---

## Les 5 modules du cours, et où ils sont

| Module | Où | Ce qu'on y trouve |
|---|---|---|
| **01** Requêtes complexes | [`db/init/04_vues.sql`](db/init/04_vues.sql), [`db/demo/01-requetes-complexes.sql`](db/demo/01-requetes-complexes.sql) | `LEFT JOIN` avec filtre dans le `ON`, `NOT EXISTS` et le piège de `NOT IN`, CTE chaînées, `WITH RECURSIVE` sur l'arbre de parrainage, `WITH RECURSIVE … CYCLE` pour la détection de collusion, `FILTER`, `GROUPING SETS`, fenêtrage |
| **02** Vues & matérialisées | [`db/init/04_vues.sql`](db/init/04_vues.sql), [`db/demo/02-vues.sql`](db/demo/02-vues.sql) | 8 vues, chaîne de dépendances, `WITH CHECK OPTION`, `mv_stats_quotidiennes` + index unique + `REFRESH CONCURRENTLY`, `security_invoker` |
| **03** Index & plans | [`db/demo/03-index.sql`](db/demo/03-index.sql) | `EXPLAIN (ANALYZE, BUFFERS)` avant/après, index composite, index partiel, index sur expression, ce qu'un B-tree ne sait pas faire, coût en écriture, `pg_stat_user_indexes` |
| **04** Fonctions & triggers | [`db/init/02_fonctions.sql`](db/init/02_fonctions.sql), [`db/init/03_triggers.sql`](db/init/03_triggers.sql) | 45 fonctions et 6 procédures PL/pgSQL, 10 déclencheurs, exceptions métier, `RETURNS TABLE`, procédures, `to_jsonb` pour l'audit |
| **05** Rôles, droits & RLS | [`db/init/05_securite.sql`](db/init/05_securite.sql), [`db/demo/05-securite.sql`](db/demo/05-securite.sql) | 8 rôles, `GRANT` colonne par colonne, 20 fonctions `SECURITY DEFINER`, RLS sur 6 tables, la fuite par les vues |

### Jouer les démonstrations

Dans l'ordre. Chaque script est commenté et s'exécute d'un bloc.

```bash
docker compose exec postgres psql -U postgres -d casino -f /db/demo/01-requetes-complexes.sql
```
```bash
docker compose exec postgres psql -U postgres -d casino -f /db/demo/02-vues.sql
```
```bash
docker compose exec postgres psql -U postgres -d casino -f /db/demo/03-index.sql
```
```bash
docker compose exec postgres psql -U postgres -d casino -f /db/demo/04-fonctions-triggers.sql
```
```bash
docker compose exec postgres psql -U postgres -d casino -f /db/demo/05-securite.sql
```

> Le script 05 affiche **12 `ERROR: permission denied`**. C'est le résultat attendu :
> chacun démontre un droit correctement refusé.

---

## Le point fort : l'API ne peut pas écrire

Le rôle `casino_api` n'a **aucun** droit d'écriture sur les tables d'argent.
Il ne peut qu'appeler 20 fonctions `SECURITY DEFINER` qui contrôlent tout.

```bash
docker compose exec postgres psql -U casino_api -d casino
```
(mot de passe `api_secret`)

```sql
UPDATE joueurs SET solde = 1000000 WHERE id = 2;
-- ERROR:  permission denied for table joueurs

INSERT INTO transactions (joueur_id, type, montant, solde_apres)
VALUES (2, 'depot', 1000000, 1000000);
-- ERROR:  permission denied for table transactions

SELECT email FROM joueurs LIMIT 1;
-- ERROR:  permission denied for table joueurs   (GRANT colonne par colonne)

SELECT _mouvement(2, 'depot', 1000000);
-- ERROR:  permission denied for function _mouvement

-- La seule porte ouverte :
SELECT set_config('app.joueur_id', '2', false);
SELECT jouer_roulette(2, 10, 'rouge');
-- ça marche, et ça vérifie statut, auto-exclusion, bornes de mise et solde.
```

**Conséquence concrète : même avec une injection SQL complète dans l'API, un
attaquant ne peut pas se créditer un centime.** Il ne peut que rejouer les
fonctions métier, qui appliquent les mêmes règles à tout le monde.

### Les rôles

| Rôle | Type | Ce qu'il peut faire |
|---|---|---|
| `casino_proprietaire` | NOLOGIN | Propriétaire des objets. **Pas** superutilisateur : une faille dans une fonction `SECURITY DEFINER` reste confinée au schéma `casino`. |
| `casino_lecture` | groupe | Catalogue des jeux, fonctions de calcul publiques |
| `casino_joueur` | groupe | `SELECT` sur 7 colonnes de `joueurs` (ni email, ni hash), `EXECUTE` sur les 20 fonctions métier |
| `casino_bi` | groupe | Vues matérialisées et agrégats. **Aucune** donnée personnelle. |
| `casino_admin` | groupe | Exploitation |
| `casino_api` | **LOGIN** | L'application web (`casino_joueur` + `casino_lecture`) |
| `casino_analyste` | **LOGIN** | Reporting (`casino_bi`) |
| `casino_superviseur` | **LOGIN** | Back-office, `BYPASSRLS` |

L'API ouvre **deux connexions distinctes** : `casino_api` pour les routes joueur,
`casino_superviseur` pour les routes `/admin`. Moindre privilège appliqué jusqu'au bout.

### Row Level Security

L'API se connecte avec **un seul** rôle PostgreSQL pour tous les joueurs. Elle passe
l'identité par la session, à chaque transaction
([`api/src/infra/postgres.ts`](api/src/infra/postgres.ts)) :

```sql
BEGIN;
SELECT set_config('app.joueur_id', '42', true);   -- true = local à la transaction
SELECT * FROM transactions;                        -- seulement celles du joueur 42
COMMIT;
```

Le `true` est essentiel : sans lui, la connexion retournerait au pool en gardant
l'identité du joueur précédent.

| Table | Politique |
|---|---|
| `transactions` | `USING (joueur_id = app_joueur_id())` |
| `parties` | `USING (joueur_id = app_joueur_id())` |
| `joueurs` | `USING (statut = 'actif')` — un compte fermé disparaît partout d'un coup |
| `amities` | son propre réseau |
| `journal_audit` | **RLS activée, aucune politique** → zéro ligne visible pour l'application |

Vérification :

```sql
SET ROLE casino_joueur;
SELECT set_config('app.joueur_id', '2', false);
SELECT count(*) FROM transactions;   -- alice : ses lignes
SELECT set_config('app.joueur_id', '3', false);
SELECT count(*) FROM transactions;   -- bob : les siennes. LA REQUÊTE N'A PAS CHANGÉ.
```

### La fuite par les vues

Une vue s'exécute par défaut avec les droits de **son propriétaire** : elle
court-circuite donc la RLS. Toutes les vues exposées portent `security_invoker = true`.
Le script 05 le démontre en la cassant puis en la réparant :

| `security_invoker` | Joueurs visibles par alice dans `v_historique_parties` |
|---|---|
| `false` | **10 001** |
| `true` | **1** |

---

## Architecture

```
casino/
├── docker-compose.yml          7 services
├── package.json                raccourcis npm (démos, tests, sauvegarde)
├── .env.example                variables surchargeables (aucun secret réel versionné)
├── db/
│   ├── init/                   SQL : joués UNE FOIS au premier démarrage, dans l'ordre
│   │   ├── 01_schema.sql       7 tables, contraintes d'abord (MPD commenté)
│   │   ├── 02_fonctions.sql    45 fonctions et 6 procédures PL/pgSQL
│   │   ├── 03_triggers.sql     10 déclencheurs
│   │   ├── 04_vues.sql         8 vues + 1 vue matérialisée
│   │   ├── 05_securite.sql     rôles, GRANT, SECURITY DEFINER, RLS
│   │   └── 06_seed.sql         peuplement en SQL pur (generate_series)
│   ├── mongo-init/             MongoDB : collections, validateurs, index (TTL, partiel)
│   ├── demo/                   scripts de démonstration : 01 à 05 (SQL), 06 (MongoDB)
│   ├── migrations/             mise à niveau d'une base déjà initialisée
│   └── pgadmin-servers.json    3 connexions préconfigurées
├── api/                        Fastify + TypeScript, SQL brut, aucun ORM
│   └── src/
│       ├── infra/              postgres, redis, mongo
│       ├── routes/             auth · profil · jeux · stats · admin
│       └── erreurs.ts          codes PostgreSQL → codes HTTP
├── web/                        React + Vite (bonus : front connecté à l'API)
├── scripts/                    test-api.mjs, sauvegarde.mjs, restaurer.mjs
└── docs/                       presentation.md, schemas/, video/
```

Correspondance avec l'arborescence suggérée par les consignes :

| Consignes | Ici |
|---|---|
| `/docker/docker-compose.yml` | `docker-compose.yml` (racine : `docker compose up` sans option) |
| `/docker/init-sql` | `db/init/` (création **et** peuplement SQL) |
| `/docker/init-nosql` | `db/mongo-init/` (création) + peuplement automatique par l'API au démarrage, depuis `export_stats_joueurs()` |
| `/api`, `/front` | `api/`, `web/` |
| `/docs`, `/docs/video` | `docs/`, `docs/video/` |

### Pourquoi aucun ORM

Un Prisma ou un TypeORM aurait :

- généré le SQL à notre place — or c'est le SQL qui est évalué ;
- ignoré les vues, les procédures et la RLS ;
- exigé des droits d'écriture directs sur les tables, ce que `casino_api` n'a pas.

[`api/src/routes/jeux.ts`](api/src/routes/jeux.ts) ne contient **aucune** logique de
jeu : ni tirage, ni table de gains, ni calcul de main, ni vérification de solde.
Juste `zod` → `CALL` → traduction d'erreur.

### Les erreurs métier traversent toute la pile

```
PostgreSQL   RAISE EXCEPTION 'Mise hors bornes pour % : attendu entre % et % (reçu : %)'
     ↓
API          code P0001 → HTTP 400
     ↓
Front        affiché tel quel dans le bandeau rouge
```

Une seule définition de la règle, un seul message — valable pour le web, un script,
la BI ou pgAdmin.

---

## Le schéma

```
joueurs ──┬── parrain_id ──> joueurs        arbre, parcouru en WITH RECURSIVE
          │
          ├──< parties >── jeu_id ──> jeux
          │       │
          └──< transactions >─────────┘     grand livre append-only
          │
          ├──< amities                      graphe social
          │
          └──< transferts >── joueurs        qui a payé qui : graphe orienté,
                                             parcouru en WITH RECURSIVE … CYCLE

journal_audit                                alimenté par triggers AFTER
```

### Le grand livre

`transactions` est **append-only** : un trigger `BEFORE UPDATE OR DELETE` les refuse
tous les deux. Une correction se fait par contre-passation (`rembourser_partie`),
jamais par `UPDATE`.

`joueurs.solde` est un **cache** maintenu par le trigger `transactions_maj_solde`.
La vérité, c'est `sum(transactions.montant)`. Une dénormalisation assumée se vérifie
**et** se répare :

```sql
SELECT * FROM verifier_integrite_soldes();   -- doit rendre 0 ligne
CALL reparer_soldes();                       -- reconstruit depuis le grand livre
```

### Le RTP réel converge-t-il vers le RTP annoncé ?

La page d'accueil compare les deux, calculés en direct par `v_resultats_par_jeu` sur
les 800 000 parties :

| Jeu | RTP annoncé | RTP constaté | Écart |
|---|---|---|---|
| Blackjack | 99,50 % | 99,39 % | −0,11 pt |
| Roulette | 97,30 % | 97,05 % | −0,25 pt |
| Machine à sous | 92,40 % | 96,25 % | **+3,85 pt** |

Les deux premiers convergent. Le troisième non — et c'est instructif : la machine a
une combinaison qui paie **×1000** avec une probabilité de 0,006 %. Sur 266 000
parties on n'en attend qu'une quinzaine, et deux ou trois de plus (ou de moins)
déplacent le RTP de plusieurs points. La loi des grands nombres n'a pas encore
convergé sur cette queue de distribution.

Un vrai casino raisonne exactement comme ça : la marge n'est acquise qu'au bout de
*beaucoup* de parties, et les jeux à gros jackpot mettent le plus longtemps à
converger. Une requête SQL suffit à le montrer.

### Provably fair

Le casino tire un `server_seed`, publie son SHA-256 **avant** la partie, et le révèle
**après**. Chaque carte / numéro / symbole est dérivé de
`HMAC(server_seed, client_seed:nonce:index)`. Le joueur peut donc rejouer le calcul
lui-même :

```sql
SELECT p.id,
       p.etat->>'numero'                                 AS numero_annonce,
       alea(p.server_seed, p.client_seed, p.nonce, 0, 37) AS numero_recalcule
FROM parties p
WHERE p.jeu_id = 2 AND p.statut = 'terminee'
ORDER BY p.id DESC LIMIT 5;
```

Le casino ne peut pas choisir le résultat après coup : le hash l'engage.

---

## Redis et MongoDB, et pourquoi

Chacun répond à une question que PostgreSQL traite moins bien. Aucun ne stocke
d'argent : **la vérité reste dans PostgreSQL**, sous contrainte et sous transaction.

> Le projet utilisait aussi Neo4j. Nous l'avons retiré sur l'avis de notre
> professeur : avec quelques joueurs réels, le graphe n'a pas assez de relations
> pour justifier une base dédiée. Ce qu'il faisait est désormais en SQL (voir
> [Détection de collusion](#détection-de-collusion-en-sql)).

### Redis — sessions, rate-limiting, classement temps réel

Le classement en `ZSET` (`ZINCRBY` / `ZREVRANGE`) se compare directement à la vue
matérialisée. La page `/classement` affiche les deux côte à côte :

| | Redis ZSET | `classement()` PL/pgSQL | `mv_stats_quotidiennes` |
|---|---|---|---|
| Fraîcheur | temps réel | exact à l'instant T | figée jusqu'au `REFRESH` |
| Coût d'une lecture | O(log n) | agrégation complète | lecture de table |
| Fiabilité | volatil | transactionnel | reconstructible |

Trois outils, trois compromis. Aucun n'est « le bon ».

### MongoDB — statistiques de jeu et replays

Le partage est net :

| | PostgreSQL | MongoDB |
|---|---|---|
| Ce qu'on y range | **l'argent** : mises, gains, soldes, résultat net | **le comportement de jeu** |
| Exigence | exact, transactionnel, contraint | forme différente pour chaque jeu |
| Exemple | `v_stats_joueur` : parties, total misé, net | numéros sortis, combinaisons obtenues, mains dépassées |

**Collection `stats_joueurs`** — un document par joueur, une branche par jeu, et
chaque branche a sa propre forme :

```js
{ _id: 2, pseudo: "alice",
  roulette:  { parties: 60, numeros: { "8": 5, "17": 1, … }, couleurs: { rouge: 35, … }, paris: { plein: 34, rouge: 16, … } },
  machine:   { parties: 3, combinaisons: { paire: 2, rien: 1 }, meilleur_multiplicateur: 1 },
  blackjack: { parties: 2, resultats: { gagne: 1, perdu: 1 }, depasses_21: 1, doubles: 1, somme_totaux: 41 } }
```

En SQL, il faudrait trois tables, ou une table clé/valeur fourre-tout — le défaut
volontaire que le cours pointe sur `evenement_attributs`.

- **Écriture** : après chaque partie, l'API fait **un seul** `updateOne` avec des
  `$inc` sur des clés dynamiques (`roulette.numeros.17`). C'est atomique côté
  serveur, avec `upsert` pour la première partie.
  ([`api/src/infra/mongo.ts`](api/src/infra/mongo.ts), `majStats`)
- **Lecture** : `GET /moi/stats-jeux`, affiché dans l'onglet **Mes stats** du profil
  (tapis de fréquence des numéros, couleurs, combinaisons, taux de dépassement).
- **Reconstruction** : ces stats sont *dérivées*. La fonction SQL
  `export_stats_joueurs()` fabrique directement les 10 000 documents en `jsonb`
  grâce à `jsonb_object_agg`, en 2 à 3 secondes. L'API la lance au démarrage si la
  collection est vide, et à la demande avec `POST /admin/mongo/reconstruire`.

Les parties générées par le seed n'ont qu'un état sommaire : au blackjack, on ne
connaît pas leurs mains dépassées ni leurs doubles. Les parties jouées dans
l'application sont complètes.

> **Une leçon de performance au passage.** La première version de
> `export_stats_joueurs()` joignait les 266 000 parties brutes à des agrégats par
> joueur : elle ne terminait pas en 5 minutes. Agréger d'abord, joindre ensuite :
> 1,9 seconde.

**Collection `replays`** — le détail de chaque partie (coups du blackjack, rouleaux
de la machine), écrit en masse, lu un par un, **jamais joint**, et purgé par TTL au
bout d'un an. Le joueur peut l'annoter (sous-document `annotation` : note, favori) et
le supprimer : `PATCH` / `DELETE /moi/replays/:partieId`. Un index **partiel** ne
contient que les favoris.

**Requêtes avancées** ([`api/src/infra/mongo.ts`](api/src/infra/mongo.ts),
[`db/demo/06-mongodb.js`](db/demo/06-mongodb.js)) :

- `GET /statistiques/tirages` : pipeline `$facet` / `$objectToArray` / `$unwind` /
  `$group` sur les 10 000 documents. La roulette est-elle équitable ? Sur 266 845
  tirages, le numéro le plus sorti l'est à 2,789 % et le moins sorti à 2,614 %, pour
  2,703 % attendus.
- `GET /admin/mongo/gros-gagnants?multiplicateur=1000` : filtre et tri sur le champ
  imbriqué `machine.meilleur_multiplicateur`, couvert par un index (`IXSCAN` sur 109
  documents au lieu d'un `COLLSCAN` sur 10 004).
- `GET /moi/bilan` : **lecture croisée** — l'argent vient de PostgreSQL
  (`v_stats_joueur`), le comportement de MongoDB (`stats_joueurs`), reliés par le même
  identifiant, avec un contrôle de cohérence du nombre de parties.

Une panne Mongo fait perdre des stats et des replays, pas un jeton :
[`api/src/infra/mongo.ts`](api/src/infra/mongo.ts) attrape l'erreur et continue.

### Détection de collusion, en SQL

Des jetons qui tournent en boucle entre joueurs (A → B → C → A) sont le motif
qu'un vrai casino traque. La table `transferts` forme un graphe orienté « qui a
payé qui », que l'on parcourt en `WITH RECURSIVE`.

Le danger d'une CTE récursive sur un graphe : une boucle la fait tourner à
l'infini. La clause **`CYCLE`** (PostgreSQL 14+) marque `est_cycle = true` dès
qu'un joueur déjà visité réapparaît, et arrête la récursion sur ce chemin :

```sql
WITH RECURSIVE parcours AS (
  SELECT DISTINCT expediteur_id AS depart, expediteur_id AS courant,
         ARRAY[expediteur_id] AS noeuds, 0 AS longueur
  FROM transferts
  UNION ALL
  SELECT p.depart, t.destinataire_id, p.noeuds || t.destinataire_id, p.longueur + 1
  FROM parcours p JOIN transferts t ON t.expediteur_id = p.courant
  WHERE p.longueur < 4
) CYCLE courant SET est_cycle USING chemin
SELECT noeuds FROM parcours
WHERE est_cycle AND courant = depart;
```

La version complète est encapsulée dans `detecter_collusion()`, avec les pseudos, le
volume, et un seul exemplaire par anneau. Le seed place **trois anneaux
volontaires** ; ils arrivent en tête :

```
GET /admin/collusion
  joueur196 → joueur197 → joueur198 → joueur199 → joueur196    2 000 jetons
  joueur96  → joueur97  → joueur98  → joueur96                 1 500 jetons
  joueur296 → joueur297 → joueur296                            1 000 jetons
```

Viennent ensuite des allers-retours entre deux amis, plus banals : le volume aide à
trier le suspect du courant. Démonstration : question 9 de
[`db/demo/01-requetes-complexes.sql`](db/demo/01-requetes-complexes.sql).

---

## API

| Méthode | Route | |
|---|---|---|
| `POST` | `/auth/inscription` | crée le compte, vérifie la majorité, verse les bonus — une seule transaction |
| `POST` | `/auth/connexion` | rate-limité par Redis |
| `POST` | `/auth/refresh` | rotation du refresh token, révocable |
| `GET` | `/moi` | profil complet (seule route qui expose l'email) |
| `POST` | `/moi/depot` · `/moi/retrait` | |
| `POST` | `/moi/transfert` | virement entre joueurs, atomique |
| `GET` | `/moi/transactions` | grand livre — **sans `WHERE joueur_id`**, c'est la RLS qui filtre |
| `POST` | `/moi/exclusion` · `/moi/limite` | jeu responsable |
| `GET` | `/moi/parrainage` | descendance par `WITH RECURSIVE` |
| `GET` · `POST` | `/moi/amis` | liste (jointure) · ajout (`ajouter_ami()`) |
| `DELETE` | `/moi/amis/:amiId` | suppression réelle, des deux sens du lien (`retirer_ami()`) |
| `GET` | `/moi/stats-jeux` | statistiques de jeu (MongoDB) |
| `GET` | `/moi/bilan` | **lecture croisée** : argent (PostgreSQL) + comportement (MongoDB) |
| `GET` | `/moi/replays[?favoris=true]` | détail des parties (MongoDB) |
| `PATCH` · `DELETE` | `/moi/replays/:partieId` | annoter (note, favori) · supprimer un replay (MongoDB) |
| `POST` | `/jeux/roulette` · `/jeux/machine` · `/jeux/blackjack` | |
| `POST` | `/jeux/blackjack/action` | tirer · rester · doubler |
| `GET` | `/parties/:id/verification` | provably fair : preuve PostgreSQL + replay MongoDB ; 404 si absente |
| `GET` | `/classement` · `/classement/live` | PostgreSQL · Redis |
| `GET` | `/statistiques/jeux` | vue ordinaire, toujours à jour |
| `GET` | `/statistiques/tirages` | pipeline d'agrégation MongoDB (équité des tirages) |
| `GET` | `/admin/integrite` | contrôle du grand livre |
| `GET` | `/admin/statistiques/jours` | vue matérialisée (figée) — à comparer avec `/statistiques/jeux` |
| `POST` | `/admin/statistiques/rafraichir` | `REFRESH CONCURRENTLY` |
| `GET` | `/admin/audit` | journal (invisible pour `casino_api`) |
| `GET` | `/admin/index` · `/admin/requetes-lentes` | module 03 en production |
| `GET` | `/admin/collusion` | anneaux de transferts, `WITH RECURSIVE … CYCLE` |
| `POST` | `/admin/mongo/reconstruire` | régénère `stats_joueurs` depuis PostgreSQL |
| `GET` | `/admin/mongo/gros-gagnants` | filtre sur champ imbriqué indexé (MongoDB) |

**Gestion des erreurs** : corps invalide → `400` avec le détail des champs (zod) ;
règle métier PL/pgSQL (`RAISE EXCEPTION`) → `400` avec le message de la base ; jeton
absent → `401` ; rôle insuffisant → `403` ; ressource absente → `404` ; doublon →
`409` ; MongoDB indisponible → `503` sur les routes qui en dépendent. Tous ces cas sont
couverts par `npm run test:api`.

Exemple complet :

```bash
curl -s -X POST localhost:3000/auth/connexion -H 'Content-Type: application/json' -d '{"email":"alice@casino.test","motDePasse":"motdepasse"}'
```

---

## Les règles que la base fait respecter

Aucune n'est dans le front, et aucune n'est contournable — pas même depuis pgAdmin.

| Règle | Où |
|---|---|
| Inscription réservée aux majeurs | trigger `joueurs_normaliser` (un `CHECK` ne peut pas lire `now()`) |
| Email et pseudo normalisés | même trigger (un `CHECK` refuse, il ne corrige pas) |
| Pas de cycle dans le parrainage | trigger `joueurs_parrainage_sans_cycle`, par CTE récursive |
| Aucune mise si auto-exclu ou suspendu | trigger `transactions_verifier_mise` |
| Une auto-exclusion ne peut qu'être allongée | `definir_exclusion()` |
| Une limite de mise ne peut que baisser | `definir_limite()` |
| Le grand livre est immuable | trigger `transactions_immuable` |
| Le solde ne peut pas devenir négatif | `CHECK` + `_mouvement()` |
| Mise dans les bornes du jeu | `_valider_mise()` |
| Pas de retrait avec une main en cours | `retirer()` |
| Un transfert débite et crédite, ou rien | `transferer_jetons()`, une transaction |
| Une partie annulée garde sa date de fin | `CHECK parties_fin_coherente` |

Démonstration :

```sql
-- En tant que superutilisateur, en écrivant DIRECTEMENT dans le grand livre :
INSERT INTO casino.transactions (joueur_id, type, montant, solde_apres)
VALUES (4, 'mise', -10, 1000);
-- ERROR: Mise refusee : auto-exclusion active jusqu'au 23/09/2026
```

---

## Sauvegarde

```bash
npm run sauvegarde                              # -> backups/AAAAMMJJ_HHMM/
npm run restaurer -- backups/AAAAMMJJ_HHMM      # après docker compose stop api
```

`pg_dumpall --roles-only` + `pg_dump -Fc` pour PostgreSQL, `mongodump --archive --gzip`
pour MongoDB. Redis n'est pas sauvegardé : il ne contient que du jetable. Stratégie
complète (fréquence, rétention, PITR) : [`docs/presentation.md` § 8](docs/presentation.md#8-stratégie-de-sauvegarde).

---

## Notes de développement

**Ne jamais rejouer `02_fonctions.sql` seul.** Un `CREATE OR REPLACE FUNCTION` sans
clause `SECURITY DEFINER` remet la fonction en `SECURITY INVOKER` et efface son
`search_path` : toute la sécurité est désarmée en silence. Et `05_securite.sql` ne se
rejoue pas non plus, car il crée des rôles qui existent déjà.

Pour recharger les fonctions sur une base existante, passez par la migration. Elle
recharge `02_fonctions.sql`, puis réapplique propriétaire, `SECURITY DEFINER`,
`search_path` et droits. Elle est rejouable sans risque, et c'est aussi elle qui met
à niveau une base initialisée avant le 28 octobre (table `transferts`) :

```bash
docker compose exec postgres psql -U postgres -d casino -f /db/migrations/2026-10-28_transferts_et_stats_mongo.sql
```

Vérifications utiles :

```sql
-- Les 20 fonctions SECURITY DEFINER et leur search_path
SELECT proname, prosecdef, proconfig FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'casino' AND p.prosecdef;

-- Les politiques RLS
SELECT tablename, policyname, cmd, roles, qual FROM pg_policies WHERE schemaname = 'casino';

-- Le grand livre est-il cohérent ?
SELECT * FROM casino.verifier_integrite_soldes();
```

Contrôle de type :

```bash
cd api && npx tsc --noEmit
```

---

## Dépannage

| Symptôme | Cause | Solution |
|---|---|---|
| L'application est lente | Les index ne sont pas créés | Jouez `/db/demo/03-index.sql` — c'est voulu |
| `permission denied for function app_joueur_id` | RLS évaluée sans `EXECUTE` | Rejouez `05_securite.sql` |
| `Vous avez déjà une main en cours` | Blackjack non terminé | Tirez ou restez, ou `CALL rembourser_partie(id)` en admin |
| L'onglet « Mes stats » est vide | Collection Mongo vide | Redémarrez l'API ou `POST /admin/mongo/reconstruire` |
| `relation "transferts" does not exist` | Base initialisée avant le 28/10 | Jouez la migration ci-dessous |
| `/classement/live` vide | Redis n'a rien depuis son démarrage | Jouez quelques parties — c'est la démonstration du caractère volatil |
| Le seed échoue | Volume corrompu | `docker compose down -v` puis relancez |

---

## Chiffres

| | |
|---|---|
| Joueurs | 10 005 |
| Parties | 800 000 |
| Mouvements | ~1,2 M |
| Tables | 7 |
| Vues | 8 + 1 matérialisée |
| Fonctions et procédures | 45 + 6 |
| Déclencheurs | 10 |
| Rôles PostgreSQL | 8 |
| Politiques RLS | 10 sur 6 tables |
| Collections MongoDB | 2 (`stats_joueurs`, `replays`) |

---

## Vidéo

La vidéo de présentation (8 à 12 minutes) est déposée dans [`docs/video/`](docs/video/).
Si le fichier dépasse 100 Mo, le lien vers la version hébergée est indiqué ici.

**Vidéo : [`docs/video/presentation.mp4`](docs/video/presentation.mp4)** (8 min 44, 1080p).

Le scénario, le script oral et les commandes utilisées sont dans
[`docs/video/`](docs/video/).

---

## Outils d'IA utilisés

Conformément aux consignes, nous déclarons l'usage d'outils d'IA :

- **Claude (Anthropic), via Claude Code** — assistance au développement.
- **Claude (Anthropic)** — finalisation du projet : audit du projet par
  rapport à la grille d'évaluation, CRUD des amitiés (`ajouter_ami`, `retirer_ami`),
  CRUD des replays et pipelines d'agrégation MongoDB, lecture croisée `/moi/bilan`,
  script de démonstration MongoDB, tests de l'API, scripts de sauvegarde,
  `docs/presentation.md` et montage de la vidéo de présentation (motion design sur nos enregistrements vocaux). Ces commits portent la mention
  `Co-Authored-By: Claude`.

L'équipe reste responsable de chaque ligne livrée et doit pouvoir l'expliquer et la défendre.
