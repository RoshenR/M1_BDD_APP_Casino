# Commandes de la démonstration

Toutes les commandes se lancent **à la racine du projet**, dans le terminal d'IntelliJ
(PowerShell sous Windows), ou par l'icône ▶ en face du script dans `package.json`.

Comptes de démonstration : `alice`, `bob`, `carol`, `dave` (joueurs) et `admin`. Dans le
front, se connecter par les **tuiles « Comptes de démonstration »** de la page de
connexion : aucun mot de passe ne s'affiche à l'écran.

---

## Séquence 3 — Démarrage depuis un environnement vierge

```powershell
docker compose down -v
```

Attendu : `Container casino_… Removed`, puis `Volume casino_pgdata Removed` (ainsi que
`mongodata`, `redisdata`, `pgadmindata`).

```powershell
docker compose up -d --wait
```

Attendu : les 7 conteneurs passent à `Healthy` ou `Started`. Il faut compter 1 à 2
minutes, car PostgreSQL attend la fin du seed avant de se déclarer *healthy*.

Pendant l'attente, ouvrir dans IntelliJ :

- `docker-compose.yml`, lignes du *healthcheck* PostgreSQL (`SELECT 1 FROM casino.migration_terminee`) ;
- `db/init/` : les six scripts, joués dans l'ordre ;
- `db/init/06_seed.sql` : `generate_series(1, 800000)` ;
- `db/mongo-init/01-collections.js` : validateur `$jsonSchema` et index TTL.

```powershell
docker compose ps
```

```powershell
docker compose logs api | Select-String "Stats Mongo"
```

Attendu : `Stats Mongo reconstruites : 10001 joueurs en … ms` (le peuplement MongoDB
automatique, depuis PostgreSQL).

---

## Séquence 4 — Preuve du contenu chargé

### PostgreSQL

```powershell
npm run contenu:sql
```

Attendu ([`db/demo/00-contenu.sql`](../../db/demo/00-contenu.sql)) :

| table | lignes |
|---|---|
| transactions | 1 208 221 |
| parties | 800 000 |
| amities | 79 964 |
| joueurs | 10 005 |
| transferts | 1 597 |
| jeux | 3 |

Puis : la taille des tables (`parties` ≈ 250 Mo), les comptes de démo, une jointure
parties ↔ joueurs ↔ jeux ↔ transactions, les contraintes de `transactions`, et
`verifier_integrite_soldes()` qui renvoie **0 ligne**.

### Le rôle applicatif ne peut pas écrire

```powershell
docker compose exec postgres psql -U casino_api -d casino -c "UPDATE joueurs SET solde = 1000000 WHERE id = 2"
```

Attendu : `ERROR:  permission denied for table joueurs`.

> Si psql demande un mot de passe, ne pas le taper à l'écran : passer à la commande
> suivante. Le navigateur montre la même chose avec `/sante`.

Dans le navigateur : <http://localhost:3000/sante> → `"role_postgres":"casino_api"`.

### MongoDB

```powershell
npm run mongo
```

Puis, dans mongosh :

```js
db.stats_joueurs.countDocuments()
db.stats_joueurs.findOne({ _id: 742 })
db.replays.getIndexes()
exit
```

Attendu : environ 10 001 documents ; un document avec ses trois branches `roulette`,
`machine` et `blackjack` ; les index des replays, dont `cree_le_1` avec
`expireAfterSeconds: 31536000` (TTL) et `replays_favoris` avec
`partialFilterExpression`.

### Redis

```powershell
docker compose exec redis redis-cli --scan --pattern "session:*"
```

```powershell
docker compose exec redis redis-cli ZREVRANGE casino:classement:net 0 4 WITHSCORES
```

La première liste les sessions ouvertes (après la connexion d'alice dans le front). La
seconde renvoie le classement temps réel (vide tant que personne n'a joué depuis le
démarrage de Redis).

---

## Séquence 5 — Application, écriture puis relecture, lecture croisée

### Dans le navigateur

1. <http://localhost:5173> → **Se connecter** → tuile **alice**.
2. **Salon** : le RTP annoncé et le RTP constaté (vue `v_resultats_par_jeu`).
3. **Roulette** : mise 10, case **Rouge**, **Lancer**. Noter le numéro de la partie si le front l'affiche.

### Relecture dans les bases

```powershell
npm run derniere-partie:sql
```

Attendu ([`db/demo/07-derniere-partie.sql`](../../db/demo/07-derniere-partie.sql)) : la
partie (jeu Roulette, mise 10.00, `etat` avec le numéro sorti), puis ses mouvements dans
le grand livre (`mise -10.00`, et `gain` si elle a gagné), puis `coherent = t`.

```powershell
npm run derniere-partie:mongo
```

Attendu : le replay (`partieId` = le même identifiant que dans PostgreSQL, `coups`) et le
document `stats_joueurs` d'alice (`roulette.parties: 1`).

```powershell
docker compose exec redis redis-cli ZREVRANGE casino:classement:net 0 4 WITHSCORES
```

Attendu : `alice` avec son résultat net.

### Lecture croisée dans le front

**Profil** → onglet **Mes stats** → bloc **Bilan croisé** : nombre de parties, total misé
et résultat net (PostgreSQL), nombre de parties (MongoDB), « ✓ synchronisé ».

### Cas d'erreur dans le front

**Profil** → **Transférer** des jetons à `personne_123` → bandeau rouge
`Joueur "personne_123" introuvable` (HTTP 404).

### Tous les endpoints, en une commande

```powershell
npm run test:api
```

Attendu : 37 tests `OK`, regroupés en 9 sections : authentification et erreurs, lecture
et écriture PostgreSQL, CRUD amitiés (`DELETE` réel), une partie sur les trois bases,
CRUD replays MongoDB, requêtes avancées MongoDB, lecture croisée, back-office. La
dernière ligne doit être `37 reussi(s), 0 echec(s)`.

---

## Séquence 6 — Requêtes avancées et performances

### SQL

```powershell
npm run demo:1
```

À montrer en remontant la sortie :

- **Q1** : `LEFT JOIN` avec le filtre dans le `ON`, RTP réel par jeu ;
- **Q2** : `NOT EXISTS` = 5 joueurs, le piège de `NOT IN` = 0 ;
- **Q5** : `FILTER` et `HAVING count(*) > 1000` ;
- **Q9** : `WITH RECURSIVE ... CYCLE`, les trois anneaux de collusion en tête.

### Index, `EXPLAIN ANALYZE` avant / après

```powershell
npm run demo:3
```

À montrer :

- **Étape 1, A** : `Parallel Seq Scan on transactions`, `Execution Time` ≈ 50 à 60 ms ;
- **Étape 3, A** : `Index Scan using idx_transactions_joueur_date`, `Execution Time` < 1 ms ;
- **C** : le tableau de bord sur 30 jours **n'accélère pas**, et pourquoi.

> `demo:3` crée les index. Le relancer ne refait donc pas la mesure « avant ». Pour
> recommencer, refaire `docker compose down -v` puis `up`.

### MongoDB

```powershell
npm run demo:mongo
```

À montrer :

- **§ 3** : `FETCH <- IXSCAN(stats_meilleur_multiplicateur)`, 109 documents examinés, contre `COLLSCAN`, 10 004 ;
- **§ 4** : pipeline `$objectToArray` / `$unwind` / `$group`, numéro le plus sorti (≈ 2,79 %) et le moins sorti (≈ 2,61 %) pour 2,703 % attendus ;
- **§ 5** : `$facet`, les combinaisons de la machine (`trois sept` : 22 fois) ;
- **§ 6** : le validateur refuse un document (`Document failed validation`).

La même agrégation, servie par l'API : <http://localhost:3000/statistiques/tirages>.

---

## Séquence 7 (facultative) — Sauvegarde

```powershell
npm run sauvegarde
```

Attendu : `roles.sql`, `casino.dump` (≈ 94 Mo) et `mongo.archive` (≈ 1 Mo) dans
`backups/AAAAMMJJ_HHMM/`, en 20 secondes environ.

---

## Adresses utiles

| Quoi | Adresse |
|---|---|
| Front | <http://localhost:5173> |
| Santé de l'API | <http://localhost:3000/sante> |
| Pipeline MongoDB via l'API | <http://localhost:3000/statistiques/tirages> |
| Classement exact (fonction SQL) | <http://localhost:3000/classement> |
| Classement temps réel (Redis) | <http://localhost:3000/classement/live> |
| pgAdmin | <http://localhost:8080> |
