# Casino — projet SQL avancé (M1 EFREI)

Application web de casino fictif. **Toute la logique métier est dans PostgreSQL** :
tirages, calcul des gains, mouvements d'argent, règles de jeu responsable, droits
d'accès. L'API ne fait que valider la forme des requêtes, poser le contexte du
joueur et traduire les erreurs PostgreSQL en codes HTTP.

> *« Tout ce que la base garantit, l'application n'a plus à le vérifier — ni à l'oublier. »*

---

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
| Neo4j Browser | http://localhost:7474 | `neo4j` / `casinocasino` |
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
| **01** Requêtes complexes | [`db/init/04_vues.sql`](db/init/04_vues.sql), [`db/demo/01-requetes-complexes.sql`](db/demo/01-requetes-complexes.sql) | `LEFT JOIN` avec filtre dans le `ON`, `NOT EXISTS` et le piège de `NOT IN`, CTE chaînées, `WITH RECURSIVE` sur l'arbre de parrainage, `FILTER`, `GROUPING SETS`, fenêtrage |
| **02** Vues & matérialisées | [`db/init/04_vues.sql`](db/init/04_vues.sql), [`db/demo/02-vues.sql`](db/demo/02-vues.sql) | 8 vues, chaîne de dépendances, `WITH CHECK OPTION`, `mv_stats_quotidiennes` + index unique + `REFRESH CONCURRENTLY`, `security_invoker` |
| **03** Index & plans | [`db/demo/03-index.sql`](db/demo/03-index.sql) | `EXPLAIN (ANALYZE, BUFFERS)` avant/après, index composite, index partiel, index sur expression, ce qu'un B-tree ne sait pas faire, coût en écriture, `pg_stat_user_indexes` |
| **04** Fonctions & triggers | [`db/init/02_fonctions.sql`](db/init/02_fonctions.sql), [`db/init/03_triggers.sql`](db/init/03_triggers.sql) | 30+ fonctions PL/pgSQL, 8 triggers, exceptions métier, `RETURNS TABLE`, procédures, `to_jsonb` pour l'audit |
| **05** Rôles, droits & RLS | [`db/init/05_securite.sql`](db/init/05_securite.sql), [`db/demo/05-securite.sql`](db/demo/05-securite.sql) | 8 rôles, `GRANT` colonne par colonne, 17 fonctions `SECURITY DEFINER`, RLS sur 5 tables, la fuite par les vues |

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
Il ne peut qu'appeler 18 fonctions `SECURITY DEFINER` qui contrôlent tout.

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
| `casino_joueur` | groupe | `SELECT` sur 7 colonnes de `joueurs` (ni email, ni hash), `EXECUTE` sur les 18 fonctions métier |
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
├── db/
│   ├── init/                   joués UNE FOIS au premier démarrage, dans l'ordre
│   │   ├── 01_schema.sql       6 tables, contraintes d'abord
│   │   ├── 02_fonctions.sql    30+ fonctions et procédures PL/pgSQL
│   │   ├── 03_triggers.sql     8 déclencheurs
│   │   ├── 04_vues.sql         8 vues + 1 vue matérialisée
│   │   ├── 05_securite.sql     rôles, GRANT, SECURITY DEFINER, RLS
│   │   └── 06_seed.sql         remplissage en SQL pur (generate_series)
│   ├── demo/                   les 5 scripts de soutenance
│   ├── mongo-init/             collection replays + validateur + TTL
│   └── pgadmin-servers.json    3 connexions préconfigurées
├── api/                        Fastify + TypeScript, SQL brut, aucun ORM
│   └── src/
│       ├── infra/              postgres · redis · mongo · neo4j
│       ├── routes/             auth · profil · jeux · stats · admin
│       └── erreurs.ts          codes PostgreSQL → codes HTTP
└── web/                        React + Vite, volontairement simple
```

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
          └──< amities                      graphe social (dupliqué dans Neo4j)

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

## Les trois NoSQL, et pourquoi

Chacun répond à une question que PostgreSQL traite moins bien. Aucun ne stocke
d'argent : **la vérité reste dans PostgreSQL**, sous contrainte et sous transaction.

### Redis — sessions, rate-limiting, classement temps réel

Le classement en `ZSET` (`ZINCRBY` / `ZREVRANGE`) se compare directement à la vue
matérialisée. La page `/classement` affiche les deux côte à côte :

| | Redis ZSET | `classement()` PL/pgSQL | `mv_stats_quotidiennes` |
|---|---|---|---|
| Fraîcheur | temps réel | exact à l'instant T | figée jusqu'au `REFRESH` |
| Coût d'une lecture | O(log n) | agrégation complète | lecture de table |
| Fiabilité | volatil | transactionnel | reconstructible |

Trois outils, trois compromis. Aucun n'est « le bon ».

### MongoDB — replay détaillé des parties

La forme du document change d'un jeu à l'autre : une main de blackjack est une
*suite* de coups, un spin de roulette un événement unique, un tour de machine trois
rouleaux. Une table unique finirait en EAV fourre-tout — le défaut volontaire que le
cours pointe sur `evenement_attributs`. Ces documents sont écrits en masse, lus un
par un, **jamais joints**, et purgés par TTL au bout d'un an.

Une panne Mongo fait perdre des replays, pas un jeton :
[`api/src/infra/mongo.ts`](api/src/infra/mongo.ts) attrape et continue.

### Neo4j — parrainage et détection de collusion

Le même graphe existe dans PostgreSQL. L'intérêt est la **comparaison** :

```cypher
MATCH (moi:Joueur {id: 42})-[:PARRAINE*1..5]->(f:Joueur) RETURN f
```
```sql
WITH RECURSIVE descendance AS (
  SELECT id, pseudo, 1 AS niveau FROM joueurs WHERE parrain_id = 42
  UNION ALL
  SELECT j.id, j.pseudo, d.niveau + 1
  FROM joueurs j JOIN descendance d ON j.parrain_id = d.id
  WHERE d.niveau < 5
) SELECT * FROM descendance;
```

La route `/moi/parrainage` renvoie **les deux résultats** pour les mettre en regard.

Là où Cypher gagne vraiment, c'est la détection de **cycles** de transferts —
A → B → C → A, le motif qu'un vrai casino traque :

```cypher
MATCH chemin = (a:Joueur)-[:TRANSFERE*2..4]->(a)
RETURN [n IN nodes(chemin) | n.pseudo] AS boucle,
       reduce(s = 0, r IN relationships(chemin) | s + r.total) AS volume
ORDER BY volume DESC
```

En SQL, il faudrait une CTE récursive avec détection de boucle et garde-fou de
profondeur. En Cypher, c'est un motif.

Le seed place **trois anneaux volontaires** pour que la démonstration ait de quoi
trouver. Projetez d'abord le graphe (connecté en `admin`) :

```
POST /admin/neo4j/synchroniser     →  { joueurs: 10005, transferts: 1597 }
GET  /admin/collusion              →  les cycles, triés par volume
```

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
| `GET` | `/moi/parrainage` | PostgreSQL **et** Neo4j, côte à côte |
| `GET` | `/moi/replays` | MongoDB |
| `POST` | `/jeux/roulette` · `/jeux/machine` · `/jeux/blackjack` | |
| `POST` | `/jeux/blackjack/action` | tirer · rester · doubler |
| `GET` | `/parties/:id/verification` | provably fair |
| `GET` | `/classement` · `/classement/live` | PostgreSQL · Redis |
| `GET` | `/statistiques/jeux` | vue ordinaire, toujours à jour |
| `GET` | `/admin/integrite` | contrôle du grand livre |
| `GET` | `/admin/statistiques/jours` | vue matérialisée (figée) — à comparer avec `/statistiques/jeux` |
| `POST` | `/admin/statistiques/rafraichir` | `REFRESH CONCURRENTLY` |
| `GET` | `/admin/audit` | journal (invisible pour `casino_api`) |
| `GET` | `/admin/index` · `/admin/requetes-lentes` | module 03 en production |
| `GET` | `/admin/collusion` | Cypher |

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

## Notes de développement

**Ne jamais rejouer `02_fonctions.sql` seul.** Un `CREATE OR REPLACE FUNCTION` sans
clause `SECURITY DEFINER` remet la fonction en `SECURITY INVOKER` et efface son
`search_path` : toute la sécurité est désarmée en silence. Rejouez toujours
`05_securite.sql` derrière.

```bash
docker compose exec postgres psql -U postgres -d casino -f /docker-entrypoint-initdb.d/02_fonctions.sql -f /docker-entrypoint-initdb.d/05_securite.sql
```

Vérifications utiles :

```sql
-- Les 17 fonctions SECURITY DEFINER et leur search_path
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
| `/admin/collusion` renvoie vide | Neo4j pas encore peuplé | `POST /admin/neo4j/synchroniser` |
| `/classement/live` vide | Redis n'a rien depuis son démarrage | Jouez quelques parties — c'est la démonstration du caractère volatil |
| Le seed échoue | Volume corrompu | `docker compose down -v` puis relancez |

---

## Chiffres

| | |
|---|---|
| Joueurs | 10 005 |
| Parties | 800 000 |
| Mouvements | ~1,2 M |
| Tables | 6 |
| Vues | 8 + 1 matérialisée |
| Fonctions et procédures | 30+ |
| Déclencheurs | 8 |
| Rôles PostgreSQL | 8 |
| Politiques RLS | 8 sur 5 tables |
