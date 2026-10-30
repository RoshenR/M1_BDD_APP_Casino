# Script oral

À lire tel quel, à un rythme posé (environ 140 mots par minute). Les passages
*[entre crochets et en italique]* sont des indications de jeu, à ne pas lire. En binôme,
une répartition possible : A lit les séquences 1, 2, 3 et 7, et B les séquences 4, 5 et 6.

Les chiffres annoncés sont ceux mesurés sur le jeu de données du seed. Si un chiffre
diffère légèrement à l'écran (durées en millisecondes, numéro de partie), **lire celui
de l'écran**.

---

## Séquence 1 — Introduction · 0:00 → 0:40

**Écran** : `README.md` en aperçu dans IntelliJ.
**Critère** : présentation du projet.

> Bonjour. Nous vous présentons Casino, notre projet de bases de données.
>
> C'est un casino en ligne fictif, avec trois jeux : la roulette, une machine à sous et le blackjack. Nous l'avons choisi parce qu'il mélange deux types de données très différents. D'un côté l'argent, qui doit être exact, transactionnel et impossible à contourner. De l'autre le comportement de jeu, dont la forme change d'un jeu à l'autre.
>
> La pile : PostgreSQL 18 pour l'argent et les règles, MongoDB pour le comportement de jeu, Redis pour les sessions et le classement temps réel. Il y a aussi une API Fastify en TypeScript, un front React, et le tout se lance avec Docker Compose.

---

## Séquence 2 — Architecture et choix techniques · 0:40 → 1:40

**Écran** : `docs/presentation.md`, § 2 (schéma), puis § 5 (tableau « Comment les bases sont reliées »).
**Critères** : vidéo — explication des choix ; documentation — justification.

> Voici l'architecture. Le front ne parle qu'à l'API, et l'API parle aux trois bases.
>
> PostgreSQL est la source de vérité. Toute la logique métier y est écrite en PL/pgSQL : les tirages, le calcul des gains, les mouvements d'argent. L'API se connecte avec un rôle qui n'a **aucun** droit d'écriture sur les tables. Elle ne peut qu'appeler des fonctions qui vérifient tout.
>
> *[Faire défiler jusqu'au § 5.]*
>
> MongoDB stocke le comportement de jeu : les numéros sortis à la roulette, les combinaisons de la machine, le déroulé d'une main. Chaque jeu a sa propre forme et ses propres clés. En SQL, il faudrait trois tables, ou une table clé-valeur fourre-tout. En document, c'est une branche par jeu, mise à jour par un seul incrément atomique.
>
> Les deux bases sont reliées par le même identifiant : l'identifiant du joueur PostgreSQL est l'`_id` du document Mongo, et l'identifiant de la partie est la clé du replay. Les données Mongo sont dérivées : on peut les reconstruire à tout moment depuis PostgreSQL. Enfin, Redis garde ce qui est jetable : les sessions, la limitation de débit et le classement en direct.

---

## Séquence 3 — Démarrage depuis un environnement vierge · 1:40 → 3:10

**Écran** : terminal IntelliJ, puis les fichiers `db/init`, `db/mongo-init` et `docker-compose.yml`.
**Critères** : vidéo — démarrage et peuplement en direct ; infrastructure (compose, scripts de création et de peuplement).

*[Taper : `docker compose down -v`]*

> On part de zéro : je supprime les conteneurs **et** les volumes. Il n'y a plus aucune donnée.

*[Taper : `docker compose up -d --wait`]*

> Et on relance la pile, en une seule commande. Pendant le démarrage, voici ce qui s'exécute.
>
> *[Ouvrir `db/init/`.]* PostgreSQL joue ces six scripts dans l'ordre : le schéma, les fonctions, les déclencheurs, les vues, la sécurité, et enfin le peuplement.
>
> *[Ouvrir `06_seed.sql`.]* Le peuplement est écrit en SQL pur, avec `generate_series` : dix mille joueurs, huit cent mille parties et un million deux cent mille mouvements d'argent.
>
> *[Ouvrir `db/mongo-init/01-collections.js`.]* Côté MongoDB, ce script crée les collections avec un validateur JSON Schema, un index unique et un index TTL qui purge les replays au bout d'un an.
>
> *[Ouvrir `docker-compose.yml`, healthcheck PostgreSQL.]* L'API ne démarre pas trop tôt : le healthcheck de PostgreSQL attend la fin du peuplement, et pas seulement que le serveur réponde.

*[Quand la commande rend la main : `docker compose ps`]*

> Les sept services sont démarrés.

*[Taper : `docker compose logs api | Select-String "Stats Mongo"`]*

> Et au démarrage, l'API a peuplé MongoDB toute seule : une fonction SQL fabrique un document par joueur, soit dix mille documents, sans aucune manipulation manuelle.

---

## Séquence 4 — Le contenu des bases · 3:10 → 5:00

**Écran** : terminal.
**Critères** : vidéo — preuve du contenu chargé ; relationnel (schéma, contraintes, rôle limité) ; NoSQL (modélisation, index, TTL, volume).

*[Taper : `npm run contenu:sql`]*

> Première preuve, dans PostgreSQL : un million deux cent mille transactions, huit cent mille parties, dix mille joueurs.
>
> *[Faire défiler.]* Une jointure entre les parties, les joueurs, les jeux et le grand livre : chaque partie a sa mise, débitée, et son gain éventuel, crédité.
>
> Les contraintes de la table `transactions` : le type doit être connu, le montant non nul, et le signe dépend du type. Une mise ne peut pas créditer un compte : c'est un `CHECK`, pas du code applicatif.
>
> Et le contrôle d'intégrité ne renvoie aucune ligne : le solde en cache est égal à la somme du grand livre pour chaque joueur.

*[Taper la commande `UPDATE` en `casino_api`.]*

> Maintenant, je me connecte avec le rôle de l'API et j'essaie de me créditer un million : permission refusée. Même une injection SQL dans l'API ne permettrait pas de toucher à l'argent.

*[Taper : `npm run mongo`, puis `db.stats_joueurs.countDocuments()`.]*

> Côté MongoDB : dix mille documents.

*[Taper : `db.stats_joueurs.findOne({ _id: 742 })`]*

> Voici un document. L'`_id`, c'est l'identifiant du joueur dans PostgreSQL. Il y a une branche par jeu. Dans `roulette.numeros`, les clés sont les numéros sortis : ce sont des clés dynamiques, qu'il n'a pas fallu prévoir dans un schéma.

*[Taper : `db.replays.getIndexes()`, puis `exit`.]*

> Et les index des replays : unique sur la partie, l'index TTL d'un an, et un index partiel qui ne contient que les replays mis en favori.

---

## Séquence 5 — L'application · 5:00 → 7:15

**Écran** : navigateur (front), puis terminal.
**Critères** : vidéo — écriture puis relecture, lecture croisée ; API (connexion aux bases, endpoints des deux familles, endpoint croisé, erreurs) ; bonus front.

*[Front : tuile « alice ».]*

> Passons à l'application. Je me connecte avec le compte de démonstration d'alice. Sur le salon, le taux de redistribution annoncé est comparé au taux réellement constaté : c'est une vue SQL calculée en direct sur les huit cent mille parties.

*[Roulette : mise 10, case Rouge, Lancer.]*

> Je joue dix jetons sur le rouge à la roulette. Le tirage, le débit et le crédit sont faits par une seule fonction PL/pgSQL, en une seule transaction.

*[Terminal : `npm run derniere-partie:sql`]*

> On retrouve immédiatement cette partie dans PostgreSQL, avec le numéro sorti, et ses mouvements dans le grand livre : la mise de dix jetons débitée *[et le gain crédité, si elle a gagné]*.

*[Taper : `npm run derniere-partie:mongo`]*

> Et dans MongoDB : le replay de la même partie, avec le même identifiant, et les statistiques d'alice, qui viennent d'être incrémentées.

*[Taper la commande `ZREVRANGE` Redis.]*

> Dans Redis, alice apparaît dans le classement en temps réel.

*[Front : Profil → Mes stats → Bilan croisé.]*

> Cette page croise les deux bases. Le nombre de parties, le total misé et le résultat net viennent de PostgreSQL. Le comportement de jeu vient de MongoDB. L'API compare le nombre de parties des deux côtés : elles sont synchronisées.

*[Front : transfert vers `personne_123`.]*

> Un cas d'erreur : un transfert vers un joueur qui n'existe pas. L'API répond 404, et le message s'affiche tel quel.

*[Terminal : `npm run test:api`, faire défiler.]*

> Pour couvrir toutes les routes, nous avons écrit trente-sept tests de bout en bout, sans aucun mock : ils appellent la vraie API, qui touche les vraies bases. On y voit le CRUD des amitiés, avec un vrai `DELETE` qui supprime les deux sens du lien. On y voit aussi le CRUD des replays dans MongoDB, avec l'annotation, le filtre sur les favoris et la suppression, ainsi que les erreurs 400, 401, 403 et 404. Trente-sept réussis, aucun échec.

---

## Séquence 6 — Requêtes avancées et performance · 7:15 → 9:30

**Écran** : terminal.
**Critères** : vidéo — requêtes avancées commentées ; relationnel (requêtes avancées, index avec `EXPLAIN`) ; NoSQL (agrégations, index) ; bonus performance.

*[Taper : `npm run demo:1`, remonter jusqu'à Q1.]*

> Les requêtes avancées en SQL. Ici, une jointure externe avec le filtre dans le `ON` : si on le mettait dans le `WHERE`, un jeu sans partie disparaîtrait du résultat. On voit que la roulette et le blackjack convergent vers leur taux théorique, mais pas la machine à sous.

*[Q5.]*

> Ici, `FILTER` calcule six agrégats en un seul passage sur huit cent mille lignes, et `HAVING` filtre les groupes après l'agrégation.

*[Q9.]*

> Et une CTE récursive avec la clause `CYCLE`, pour trouver les jetons qui tournent en boucle entre joueurs. C'est le motif d'une collusion. Les trois anneaux que nous avons placés dans les données arrivent en tête.

*[Taper : `npm run demo:3`, remonter jusqu'à « ETAPE 1 », requête A.]*

> La base démarre volontairement sans index sur les clés étrangères. L'historique d'un joueur lit toute la table : un `Seq Scan` sur un million deux cent mille lignes, *[lire la durée]* millisecondes.

*[Requête A après index.]*

> Après création de l'index composite joueur et date : un `Index Scan`, en moins d'une milliseconde. C'est plusieurs centaines de fois plus rapide.

*[Requête C.]*

> Et un contre-exemple : sur trente jours, l'index n'aide pas. On lit un sixième de la table, et le planificateur préfère, avec raison, un balayage séquentiel.

*[Taper : `npm run demo:mongo`, aller au § 3.]*

> Même démarche dans MongoDB. Avec l'index sur le champ imbriqué, la requête examine cent neuf documents. Sans index, elle en parcourt dix mille.

*[§ 4.]*

> Un pipeline d'agrégation : `$objectToArray` transforme le dictionnaire des numéros en tableau, `$unwind` en fait une ligne par numéro, et `$group` additionne sur tout le casino. Sur deux cent soixante-six mille tirages, chaque numéro sort entre 2,61 et 2,79 pour cent du temps, pour 2,70 attendus : le tirage est équitable.

*[§ 6.]*

> Et le validateur refuse un document mal formé.

---

## Séquence 7 — Conclusion · 9:30 → 10:15

**Écran** : `docs/presentation.md`, § 9.
**Critère** : synthèse.

> Pour conclure : tout ce que la base peut garantir, c'est elle qui le garantit. Ce sont les contraintes, les déclencheurs, la sécurité par ligne et un rôle applicatif sans droit d'écriture. Chaque base a un rôle précis : PostgreSQL pour la vérité, MongoDB pour le comportement de jeu à forme variable, Redis pour l'éphémère.
>
> Nos limites : des données générées trop régulières, et une synchronisation vers MongoDB qui repose sur la reconstruction plutôt que sur une file d'événements. Ce serait notre prochaine étape.
>
> Toute la documentation, avec le MCD, le MLD, le modèle MongoDB et la stratégie de sauvegarde, est dans le dossier `docs`. Merci de votre attention.
