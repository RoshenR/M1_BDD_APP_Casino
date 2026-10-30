#!/usr/bin/env node
/**
 * =============================================================================
 * Sauvegarde des bases (pile Docker demarree)            npm run sauvegarde
 * =============================================================================
 * Cree backups/<horodatage>/ avec :
 *   roles.sql      les roles PostgreSQL (sans eux, les objets n'ont plus de
 *                  proprietaire ni de droits a la restauration)
 *   casino.dump    pg_dump au format custom (-Fc) : compresse, restauration
 *                  selective possible avec pg_restore
 *   mongo.archive  mongodump --archive --gzip de la base casino
 *
 * Redis n'est PAS sauvegarde ici : il ne contient que du jetable (sessions,
 * compteurs, classement temps reel). Son fichier AOF (appendonly yes) survit
 * deja aux redemarrages dans le volume redisdata.
 *
 * Aucun identifiant n'est ecrit dans ce script : ceux de Mongo sont lus dans
 * l'environnement du conteneur.
 * =============================================================================
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const horodatage = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1_');
const dossier = join(racine, 'backups', horodatage);
mkdirSync(dossier, { recursive: true });

function versFichier(args, fichier) {
  return new Promise((ok, ko) => {
    const p = spawn('docker', ['compose', 'exec', '-T', ...args], { cwd: racine, stdio: ['ignore', 'pipe', 'inherit'] });
    const sortie = createWriteStream(join(dossier, fichier));
    p.stdout.pipe(sortie);
    p.on('error', ko);
    p.on('close', (code) => sortie.close(() => (code === 0 ? ok() : ko(new Error(`${fichier} : code ${code}`)))));
  });
}

const taille = (f) => `${(statSync(join(dossier, f)).size / 1024 / 1024).toFixed(1)} Mo`;
const debut = Date.now();

console.log(`Sauvegarde dans ${dossier}`);
await versFichier(['postgres', 'pg_dumpall', '-U', 'postgres', '--roles-only'], 'roles.sql');
console.log(`  roles.sql      ${taille('roles.sql')}`);
await versFichier(['postgres', 'pg_dump', '-U', 'postgres', '-d', 'casino', '-Fc'], 'casino.dump');
console.log(`  casino.dump    ${taille('casino.dump')}`);
await versFichier(['mongo', 'sh', '-c',
  'mongodump --quiet --archive --gzip --db casino -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'],
  'mongo.archive');
console.log(`  mongo.archive  ${taille('mongo.archive')}`);
console.log(`Termine en ${((Date.now() - debut) / 1000).toFixed(1)} s. Restauration : npm run restaurer -- backups/${horodatage}`);
