#!/usr/bin/env node
/**
 * Execute les commandes de la demonstration et enregistre leurs sorties
 * REELLES dans captures-video/ (ignore par git), pour le montage de la video.
 *   npm run video:captures
 * Attention : la derniere etape (demo:3) cree les index de la demo 03.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dossier = join(racine, 'captures-video');
mkdirSync(dossier, { recursive: true });
const API = 'http://localhost:3000';

function lancer(nom, cmd, args, { filtre } = {}) {
  const debut = Date.now();
  const r = spawnSync(cmd, args, { cwd: racine, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  let sortie = (r.stdout ?? '') + (r.stderr ?? '');
  if (filtre) sortie = sortie.split('\n').filter(filtre).join('\n');
  const entete = `$ ${[cmd, ...args].join(' ')}\n`;
  writeFileSync(join(dossier, `${nom}.txt`), entete + sortie);
  console.log(`${nom.padEnd(22)} code ${r.status}  ${((Date.now() - debut) / 1000).toFixed(1)} s`);
}
async function http(nom, etapes) {
  const lignes = [];
  let token = null;
  for (const [methode, route, corps, auth] of etapes) {
    const r = await fetch(API + route, {
      method: methode,
      headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const texte = await r.text();
    if (route === '/auth/connexion') { token = JSON.parse(texte).token; lignes.push(`${methode} ${route}  ->  HTTP ${r.status} (jeton recu)`); continue; }
    let joli = texte; try { joli = JSON.stringify(JSON.parse(texte), null, 2); } catch {}
    lignes.push(`${methode} ${route}${corps ? '  ' + JSON.stringify(corps) : ''}\n<- HTTP ${r.status}\n${joli}\n`);
  }
  writeFileSync(join(dossier, `${nom}.txt`), lignes.join('\n'));
  console.log(`${nom.padEnd(22)} ok`);
}

const dc = (...a) => ['compose', ...a];
const psql = (...a) => dc('exec', '-T', 'postgres', 'psql', '-P', 'pager=off', ...a);
const mongo = (f) => dc('exec', '-T', 'mongo', 'sh', '/db/demo/mongosh.sh', f);

// `npm run video:captures -- partie` : joue une roulette pour alice (sans la
// supprimer, contrairement a test:api) puis la relit dans les deux bases.
if (process.argv[2] === 'partie') {
  await http('11b-partie-jouee', [
    ['POST', '/auth/connexion', { email: 'alice@casino.test', motDePasse: process.env.DEMO_PASSWORD ?? 'motdepasse' }],
    ['POST', '/jeux/roulette', { mise: 10, pari: 'rouge', clientSeed: 'video' }, true],
  ]);
  lancer('11-partie-sql', 'docker', psql('-U', 'postgres', '-d', 'casino', '-f', '/db/demo/07-derniere-partie.sql'));
  lancer('12-partie-mongo', 'docker', mongo('/db/demo/07-derniere-partie.js'));
  lancer('10-redis-classement', 'docker', dc('exec', '-T', 'redis', 'redis-cli', 'ZREVRANGE', 'casino:classement:net', '0', '4', 'WITHSCORES'));
  await http('13-bilan-et-erreur', [
    ['POST', '/auth/connexion', { email: 'alice@casino.test', motDePasse: process.env.DEMO_PASSWORD ?? 'motdepasse' }],
    ['GET', '/moi/bilan', null, true],
    ['POST', '/moi/transfert', { vers: 'personne_123', montant: 10 }, true],
  ]);
  process.exit(0);
}

lancer('01-up', 'docker', dc('up', '-d', '--wait'));
lancer('02-ps', 'docker', dc('ps', '--format', 'table {{.Name}}\t{{.Status}}'));
lancer('03-logs-api', 'docker', dc('logs', 'api'), { filtre: (l) => /Stats Mongo|API prete|Server listening/.test(l) });
lancer('04-contenu-sql', 'docker', psql('-U', 'postgres', '-d', 'casino', '-f', '/db/demo/00-contenu.sql'));
lancer('05-droits-api', 'docker', psql('-U', 'casino_api', '-d', 'casino', '-c', 'UPDATE joueurs SET solde = 1000000 WHERE id = 2'));
lancer('06-mongo-contenu', 'docker', mongo('/db/demo/08-video-mongo.js'));
await http('07-sante', [['GET', '/sante']]);
lancer('08-test-api', 'node', ['scripts/test-api.mjs']);
lancer('09-redis-sessions', 'docker', dc('exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', 'session:*'));
lancer('10-redis-classement', 'docker', dc('exec', '-T', 'redis', 'redis-cli', 'ZREVRANGE', 'casino:classement:net', '0', '4', 'WITHSCORES'));
lancer('11-partie-sql', 'docker', psql('-U', 'postgres', '-d', 'casino', '-f', '/db/demo/07-derniere-partie.sql'));
lancer('12-partie-mongo', 'docker', mongo('/db/demo/07-derniere-partie.js'));
await http('13-bilan-et-erreur', [
  ['POST', '/auth/connexion', { email: 'alice@casino.test', motDePasse: process.env.DEMO_PASSWORD ?? 'motdepasse' }],
  ['GET', '/moi/bilan', null, true],
  ['POST', '/moi/transfert', { vers: 'personne_123', montant: 10 }, true],
]);
lancer('14-demo1-sql', 'docker', psql('-U', 'postgres', '-d', 'casino', '-f', '/db/demo/01-requetes-complexes.sql'));
lancer('15-demo-mongo', 'docker', mongo('/db/demo/06-mongodb.js'));
lancer('16-demo3-index', 'docker', psql('-U', 'postgres', '-d', 'casino', '-f', '/db/demo/03-index.sql'));
console.log(`Sorties dans ${dossier}`);
