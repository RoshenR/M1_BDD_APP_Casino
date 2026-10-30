# Checklist d'enregistrement

## La veille (ou au moins 1 heure avant)

### Code et dépôt

- [ ] Être sur la branche à présenter : `ahuV1`, ou `master` après la fusion de la pull request.
- [ ] **Fusionner `ahuV1` dans `master`** (pull request sur GitHub) pour que l'historique des commits soit visible sur la branche principale (risque de pénalité −1 sinon).
- [ ] `git status` est propre (aucun fichier modifié non commité).

### Répétition complète « machine vierge »

Cette étape n'a pas pu être exécutée pendant l'audit (la suppression des volumes a été bloquée). **C'est la plus importante.**

```powershell
docker compose down -v
docker compose up -d --wait --build
npm run test:api
```

- [ ] `up` se termine sans erreur ; noter sa durée : ______ (elle sert à décider s'il faudra accélérer ce passage au montage).
- [ ] `test:api` : **37 réussis, 0 échec**.
- [ ] `npm run typecheck:docker` : aucune erreur.
- [ ] Dans le front (Chrome) : connexion d'alice par la tuile, une partie de roulette, Profil → **Mes stats** → le bloc **Bilan croisé** s'affiche et indique « ✓ synchronisé ».
- [ ] Transfert vers `personne_123` : le bandeau rouge `Joueur "personne_123" introuvable` s'affiche.
- [ ] `docker compose exec postgres psql -U casino_api -d casino -c "UPDATE joueurs SET solde = 1000000 WHERE id = 2"` affiche `permission denied` **sans demander de mot de passe**. Si un mot de passe est demandé, retirer cette commande du tournage et montrer `/sante` à la place.
- [ ] Faire une répétition chronométrée à voix haute : durée ______ (cible 10 à 11 min 30).

### Remettre à zéro juste avant de tourner

Les démos laissent des traces (index créés par `demo:3`, parties d'alice) :

```powershell
docker compose down -v
```

La séquence 3 du tournage relance `up` en direct.

## Le poste

- [ ] Docker Desktop démarré, et images déjà construites (le `--build` de la veille), sinon le premier `up` télécharge et construit pendant plusieurs minutes.
- [ ] Fermer Slack, Discord, la messagerie et les notifications Windows (assistant de concentration : **Alarmes uniquement**).
- [ ] Ne laisser ouvert **aucun** onglet ni fichier contenant un mot de passe réel, un jeton ou une adresse personnelle.
- [ ] Ne pas ouvrir `.env` à l'écran (de toute façon, il n'est pas nécessaire).
- [ ] IntelliJ : police de l'éditeur à **16** au moins, police de la console à **15** au moins (Settings → Editor → Font et Color Scheme → Console Font).
- [ ] IntelliJ : thème clair ou sombre, mais contrasté ; masquer les panneaux inutiles.
- [ ] Ouvrir à l'avance, dans cet ordre, les onglets : `README.md` (aperçu), `docs/presentation.md` (aperçu), `docker-compose.yml`, `db/init/01_schema.sql`, `db/init/06_seed.sql`, `db/mongo-init/01-collections.js`, `package.json`.
- [ ] Terminal IntelliJ ouvert à la racine du projet ; `cls` pour le vider.
- [ ] Chrome : zoom à **125 %** ; onglets prêts sur <http://localhost:5173/connexion> (il s'ouvrira après le démarrage) et <http://localhost:3000/sante>.
- [ ] Résolution d'écran 1920 × 1080 (évite un texte illisible une fois la vidéo compressée).

## L'enregistrement

- [ ] Logiciel : **OBS Studio** (gratuit). Source « Capture d'écran », micro en entrée audio.
- [ ] Réglages OBS : 1920 × 1080, 30 images/s, MP4, encodeur x264 ou NVENC, débit vidéo **1 200 kb/s** (≈ 9 Mo par minute, donc ≈ 95 Mo pour 10 min 30).
- [ ] Micro testé : enregistrer 10 secondes et réécouter. Parler à 20 cm, sans souffle ; pièce calme.
- [ ] Le script oral ([`script-oral.md`](script-oral.md)) sur un deuxième écran ou imprimé.
- [ ] Les commandes ([`commandes-demo.md`](commandes-demo.md)) à portée, pour les copier-coller et éviter les fautes de frappe.

## Pendant le tournage, dans l'ordre

| # | Action | Résultat à voir à l'écran |
|---|---|---|
| 1 | README | titre, tableau des documents, pile technique |
| 2 | `docs/presentation.md` § 2 et § 5 | schéma d'architecture ; tableau des liens entre bases |
| 3 | `docker compose down -v` | `Volume casino_pgdata Removed` |
| 4 | `docker compose up -d --wait` | 7 services `Healthy` / `Started` |
| 5 | `docker compose ps` | 7 lignes, état `running` / `healthy` |
| 6 | `docker compose logs api \| Select-String "Stats Mongo"` | `Stats Mongo reconstruites : 10001 joueurs` |
| 7 | `npm run contenu:sql` | 1 208 221 / 800 000 / 10 005 ; intégrité : `(0 rows)` |
| 8 | `UPDATE` en `casino_api` | `permission denied for table joueurs` |
| 9 | `npm run mongo` + 3 commandes | ≈ 10 001 ; un document ; index `expireAfterSeconds` |
| 10 | Front : alice, roulette 10 sur rouge | résultat du tirage, solde mis à jour |
| 11 | `npm run derniere-partie:sql` | la partie, `mise -10.00`, `coherent = t` |
| 12 | `npm run derniere-partie:mongo` | replay (même `partieId`), `roulette.parties: 1` |
| 13 | `redis-cli ZREVRANGE ...` | `alice` et son net |
| 14 | Front : Mes stats → Bilan croisé | « ✓ synchronisé » |
| 15 | Front : transfert vers `personne_123` | bandeau rouge, 404 |
| 16 | `npm run test:api` | `37 reussi(s), 0 echec(s)` |
| 17 | `npm run demo:1` | Q1, Q5, Q9 |
| 18 | `npm run demo:3` | A : `Seq Scan` ≈ 55 ms → `Index Scan` < 1 ms ; C sans gain |
| 19 | `npm run demo:mongo` | § 3 `IXSCAN` 109 contre `COLLSCAN` 10 004 ; § 4 numéros ; § 6 validateur |
| 20 | `docs/presentation.md` § 9 | conclusion |

## Solutions de secours (sans jamais remplacer une exécution réelle)

| Problème | Solution |
|---|---|
| `up` échoue sur un port déjà utilisé | `docker compose down`, fermer le PostgreSQL / MongoDB local qui occupe le port (`netstat -ano \| findstr 5432`), relancer. |
| `up` très long (seed) | Laisser tourner en commentant les scripts ; au montage, accélérer ce passage en l'indiquant à l'écran. |
| `Stats Mongo` absent des logs | Attendre 10 s puis relancer la commande (la reconstruction tourne en tâche de fond). Sinon : `npm run test:api`, qui la relance par `POST /admin/mongo/reconstruire`. |
| `Mes stats` vide pour alice | Normal avant sa première partie : jouer d'abord, puis recharger la page. |
| Le front affiche `Failed to fetch` | L'API n'est pas prête : <http://localhost:3000/sante> doit répondre. Sinon `docker compose logs api`. |
| `demo:3` ne montre pas le « avant » | Les index existent déjà (`demo:3` a déjà été lancé) : `down -v`, puis `up`. |
| `npm run …` ne trouve pas `node` | Lancer directement la commande `docker compose …` correspondante (voir `package.json`) ; seuls `test:api` et `sauvegarde` exigent Node sur l'hôte. |
| Une commande échoue pendant le tournage | Ne pas couper : l'expliquer en une phrase, corriger, relancer. Une vraie erreur bien gérée vaut mieux qu'un montage. |

## Après le tournage

- [ ] Durée finale entre **8 et 12 minutes**.
- [ ] Réécouter : voix audible partout, aucun mot de passe réel ni jeton visible.
- [ ] Fichier **< 100 Mo** : le déposer dans `docs/video/presentation.mp4`, puis commit et push. Sinon, le compresser (HandBrake, préréglage « Fast 1080p30 », qualité RF 26) ou le publier en « non répertorié » sur YouTube.
- [ ] Dans `README.md`, section **Vidéo** : remplacer « à compléter » par le lien (vers le fichier du dépôt, ou vers la vidéo hébergée).
- [ ] Vérifier sur GitHub que le lien fonctionne depuis une fenêtre de navigation privée.
