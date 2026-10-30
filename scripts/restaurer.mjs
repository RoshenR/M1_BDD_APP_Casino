#!/usr/bin/env node
/**
 * =============================================================================
 * Restauration d'une sauvegarde        npm run restaurer -- backups/<horodatage>
 * =============================================================================
 * 1. roles.sql      rejoue les roles (les "already exists" sont normaux sur
 *                   une instance ou ils existent deja)
 * 2. casino.dump    pg_restore --clean --if-exists : supprime puis recree les
 *                   objets du schema casino, avec leurs donnees et leurs droits
 * 3. mongo.archive  mongorestore --drop : remplace les collections
 *
 * L'API doit etre arretee pendant la restauration (docker compose stop api),
 * sinon ses connexions ouvertes bloquent la suppression des objets.
 * =============================================================================
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dossier = process.argv[2] ? resolve(racine, process.argv[2]) : null;
if (!dossier || !existsSync(join(dossier, 'casino.dump'))) {
  console.error('Usage : npm run restaurer -- backups/<horodatage>');
  process.exit(1);
}

function depuisFichier(args, fichier, { tolerer = false } = {}) {
  return new Promise((ok, ko) => {
    const p = spawn('docker', ['compose', 'exec', '-T', ...args], { cwd: racine, stdio: ['pipe', 'inherit', 'inherit'] });
    createReadStream(join(dossier, fichier)).pipe(p.stdin);
    p.on('error', ko);
    p.on('close', (code) => (code === 0 || tolerer ? ok() : ko(new Error(`${fichier} : code ${code}`))));
  });
}

console.log(`Restauration depuis ${dossier}`);
await depuisFichier(['postgres', 'psql', '-q', '-U', 'postgres', '-d', 'postgres'], 'roles.sql', { tolerer: true });
await depuisFichier(['postgres', 'pg_restore', '-U', 'postgres', '-d', 'casino', '--clean', '--if-exists'], 'casino.dump');
console.log('  PostgreSQL restaure');
await depuisFichier(['mongo', 'sh', '-c',
  'mongorestore --quiet --archive --gzip --drop -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'],
  'mongo.archive');
console.log('  MongoDB restaure');
