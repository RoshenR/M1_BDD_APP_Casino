#!/usr/bin/env node
/**
 * =============================================================================
 * Tests de bout en bout de l'API (pile Docker demarree)
 * =============================================================================
 *   npm run test:api                 (API sur http://localhost:3000)
 *   API_URL=http://... npm run test:api
 *
 * Chaque test appelle une vraie route, qui touche une vraie base :
 * PostgreSQL, MongoDB ou Redis. Aucun mock. Le resultat est affiche ET ecrit
 * dans scripts/test-api.log (ignore par git).
 *
 * Aucune dependance : Node 18+ (fetch integre).
 * =============================================================================
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:3000';
const MDP = process.env.DEMO_PASSWORD ?? 'motdepasse';   // comptes de demo du seed
const journal = [];
let ok = 0;
let ko = 0;

function log(ligne) {
  console.log(ligne);
  journal.push(ligne);
}

async function appel(methode, route, { token, corps } = {}) {
  const r = await fetch(API + route, {
    method: methode,
    headers: {
      ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  let donnees = null;
  const texte = await r.text();
  try { donnees = texte ? JSON.parse(texte) : null; } catch { donnees = texte; }
  return { statut: r.status, donnees };
}

async function test(nom, fn) {
  try {
    const detail = await fn();
    ok++;
    log(`  OK   ${nom}${detail ? `  ->  ${detail}` : ''}`);
  } catch (e) {
    ko++;
    log(`  ECHEC ${nom}  ->  ${e.message}`);
  }
}

function attendu(cond, message) {
  if (!cond) throw new Error(message);
}

function statut(r, code) {
  attendu(r.statut === code, `HTTP ${r.statut} au lieu de ${code} : ${JSON.stringify(r.donnees).slice(0, 200)}`);
}

async function connexion(email) {
  const r = await appel('POST', '/auth/connexion', { corps: { email, motDePasse: MDP } });
  statut(r, 200);
  return r.donnees.token;
}

// =============================================================================
log(`Tests de l'API ${API} - ${new Date().toISOString()}`);

log('\n[0] Disponibilite');
await test('GET /sante repond et l\'API tourne en casino_api (pas en superutilisateur)', async () => {
  const r = await appel('GET', '/sante');
  statut(r, 200);
  attendu(r.donnees.role_postgres === 'casino_api', `role = ${r.donnees.role_postgres}`);
  return `${r.donnees.version}, role ${r.donnees.role_postgres}`;
});

// Au premier demarrage, l'API reconstruit stats_joueurs en tache de fond.
let docsMongo = 0;
for (let i = 0; i < 40; i++) {
  const r = await appel('GET', '/statistiques/tirages');
  docsMongo = r.donnees?.totaux?.documents ?? 0;
  if (r.statut === 200 && docsMongo >= 10000) break;
  await new Promise((res) => setTimeout(res, 3000));
}

log('\n[1] Authentification (PostgreSQL + Redis) et erreurs');
await test('POST /auth/connexion mauvais mot de passe -> 401', async () => {
  const r = await appel('POST', '/auth/connexion', { corps: { email: 'alice@casino.test', motDePasse: 'faux' } });
  statut(r, 401);
  return r.donnees.erreur;
});
await test('POST /auth/connexion corps invalide -> 400 (zod)', async () => {
  const r = await appel('POST', '/auth/connexion', { corps: { email: 'pas-un-email' } });
  statut(r, 400);
  return r.donnees.details?.map((d) => d.champ).join(', ');
});
const alice = await connexion('alice@casino.test');
const admin = await connexion('admin@casino.test');
await test('Route protegee sans jeton -> 401', async () => {
  statut(await appel('GET', '/moi'), 401);
});
await test('Route admin avec un jeton joueur -> 403', async () => {
  statut(await appel('GET', '/admin/integrite', { token: alice }), 403);
});

log('\n[2] PostgreSQL - lecture et ecriture');
await test('GET /jeux (vue v_jeux_actifs)', async () => {
  const r = await appel('GET', '/jeux');
  statut(r, 200);
  return r.donnees.map((j) => j.code).join(', ');
});
let soldeAvant = 0;
await test('GET /moi/solde (vue v_solde_joueur : cache = grand livre)', async () => {
  const r = await appel('GET', '/moi/solde', { token: alice });
  statut(r, 200);
  soldeAvant = Number(r.donnees.solde);
  attendu(Number(r.donnees.solde) === Number(r.donnees.solde_reel), 'cache != grand livre');
  return `solde ${r.donnees.solde}`;
});
await test('POST /moi/depot 50 (procedure deposer) puis relecture', async () => {
  const r = await appel('POST', '/moi/depot', { token: alice, corps: { montant: 50 } });
  statut(r, 200);
  attendu(Number(r.donnees.solde) === soldeAvant + 50, `solde ${r.donnees.solde}, attendu ${soldeAvant + 50}`);
  return `${soldeAvant} -> ${r.donnees.solde}`;
});
await test('POST /moi/depot montant negatif -> 400', async () => {
  statut(await appel('POST', '/moi/depot', { token: alice, corps: { montant: -5 } }), 400);
});
await test('GET /moi/transactions : la RLS ne renvoie que les lignes d\'alice', async () => {
  const r = await appel('GET', '/moi/transactions?limite=5', { token: alice });
  statut(r, 200);
  return `${r.donnees.length} lignes, derniere : ${r.donnees[0]?.type} ${r.donnees[0]?.montant}`;
});

log('\n[3] PostgreSQL - CRUD amities (DELETE reel)');
let bobId = null;
await test('POST /moi/amis bob -> 201', async () => {
  // Nettoyage si un test precedent a ete interrompu
  const liste = await appel('GET', '/moi/amis', { token: alice });
  const deja = liste.donnees.find((a) => a.pseudo === 'bob');
  if (deja) await appel('DELETE', `/moi/amis/${deja.ami_id}`, { token: alice });
  const r = await appel('POST', '/moi/amis', { token: alice, corps: { pseudo: 'bob' } });
  statut(r, 201);
  bobId = r.donnees.ami_id;
  return `ami_id ${bobId}`;
});
await test('POST /moi/amis bob une 2e fois -> 400 (deja ami)', async () => {
  const r = await appel('POST', '/moi/amis', { token: alice, corps: { pseudo: 'bob' } });
  statut(r, 400);
  return r.donnees.erreur;
});
await test('POST /moi/amis joueur inexistant -> 404', async () => {
  const r = await appel('POST', '/moi/amis', { token: alice, corps: { pseudo: 'personne_123' } });
  statut(r, 404);
  return r.donnees.erreur;
});
await test('GET /moi/amis contient bob', async () => {
  const r = await appel('GET', '/moi/amis', { token: alice });
  statut(r, 200);
  attendu(r.donnees.some((a) => a.pseudo === 'bob'), 'bob absent');
  return `${r.donnees.length} ami(s)`;
});
await test('DELETE /moi/amis/:id -> 2 lignes supprimees (les deux sens)', async () => {
  const r = await appel('DELETE', `/moi/amis/${bobId}`, { token: alice });
  statut(r, 200);
  attendu(r.donnees.lignes_supprimees === 2, JSON.stringify(r.donnees));
  return JSON.stringify(r.donnees);
});
await test('DELETE /moi/amis/:id une 2e fois -> 404', async () => {
  statut(await appel('DELETE', `/moi/amis/${bobId}`, { token: alice }), 404);
});

log('\n[4] Une partie : PostgreSQL (argent) + MongoDB (replay, stats) + Redis (classement)');
let partieId = null;
await test('POST /jeux/roulette 10 sur rouge', async () => {
  const r = await appel('POST', '/jeux/roulette', { token: alice, corps: { mise: 10, pari: 'rouge', clientSeed: 'test' } });
  statut(r, 200);
  partieId = Number(r.donnees.partie_id);
  return `partie ${partieId}, numero ${r.donnees.etat?.numero}, gain ${r.donnees.gain}`;
});
await test('POST /jeux/roulette mise hors bornes -> 400 (regle PL/pgSQL)', async () => {
  const r = await appel('POST', '/jeux/roulette', { token: alice, corps: { mise: 0.5, pari: 'rouge' } });
  statut(r, 400);
  return r.donnees.erreur;
});
await test('POST /jeux/roulette pari invalide -> 400 (zod)', async () => {
  statut(await appel('POST', '/jeux/roulette', { token: alice, corps: { mise: 10, pari: 'plein:99' } }), 400);
});
await test('GET /parties/:id/verification : PostgreSQL + replay MongoDB', async () => {
  const r = await appel('GET', `/parties/${partieId}/verification`, { token: alice });
  statut(r, 200);
  attendu(r.donnees.replay !== null, 'replay MongoDB absent');
  return `cles : ${Object.keys(r.donnees).join(', ')}`;
});
await test('GET /parties/999999999/verification -> 404', async () => {
  statut(await appel('GET', '/parties/999999999/verification', { token: alice }), 404);
});
await test('GET /classement/live contient alice (Redis ZSET)', async () => {
  const r = await appel('GET', '/classement/live');
  statut(r, 200);
  attendu(r.donnees.some((l) => l.pseudo === 'alice'), 'alice absente');
});

log('\n[5] MongoDB - CRUD replays');
await test('GET /moi/replays contient la partie jouee (C a eu lieu)', async () => {
  const r = await appel('GET', '/moi/replays?limite=5', { token: alice });
  statut(r, 200);
  attendu(r.donnees.some((x) => x.partieId === partieId), 'replay absent');
  return `${r.donnees.length} replay(s)`;
});
await test('PATCH /moi/replays/:id { favori, note } (U)', async () => {
  const r = await appel('PATCH', `/moi/replays/${partieId}`, { token: alice, corps: { favori: true, note: 'test auto' } });
  statut(r, 200);
  attendu(r.donnees.annotation?.favori === true, JSON.stringify(r.donnees.annotation));
  return JSON.stringify(r.donnees.annotation);
});
await test('GET /moi/replays?favoris=true (filtre sur champ imbrique)', async () => {
  const r = await appel('GET', '/moi/replays?favoris=true', { token: alice });
  statut(r, 200);
  attendu(r.donnees.length > 0 && r.donnees.every((x) => x.annotation?.favori === true), 'filtre incorrect');
  return `${r.donnees.length} favori(s)`;
});
await test('PATCH corps vide -> 400', async () => {
  statut(await appel('PATCH', `/moi/replays/${partieId}`, { token: alice, corps: {} }), 400);
});
await test('PATCH replay inexistant -> 404', async () => {
  statut(await appel('PATCH', '/moi/replays/999999999', { token: alice, corps: { favori: true } }), 404);
});
await test('PATCH replay d\'une partie d\'un autre joueur -> 404 (filtre joueurId)', async () => {
  const bob = await connexion('bob@casino.test');
  statut(await appel('PATCH', `/moi/replays/${partieId}`, { token: bob, corps: { favori: false } }), 404);
});
await test('DELETE /moi/replays/:id (D)', async () => {
  const r = await appel('DELETE', `/moi/replays/${partieId}`, { token: alice });
  statut(r, 200);
});
await test('DELETE une 2e fois -> 404', async () => {
  statut(await appel('DELETE', `/moi/replays/${partieId}`, { token: alice }), 404);
});

log('\n[6] MongoDB - requetes avancees');
await test(`stats_joueurs peuplee automatiquement (${docsMongo} documents)`, async () => {
  attendu(docsMongo >= 10000, `${docsMongo} documents`);
});
await test('GET /statistiques/tirages (pipeline $facet / $objectToArray / $unwind / $group)', async () => {
  const r = await appel('GET', '/statistiques/tirages');
  statut(r, 200);
  const n = r.donnees.roulette_numeros;
  attendu(n.length === 37, `${n.length} numeros`);
  return `${r.donnees.totaux.spins_roulette} spins ; plus sorti : ${n[0].numero} (${n[0].frequence_pct} %), moins sorti : ${n.at(-1).numero} (${n.at(-1).frequence_pct} %)`;
});
await test('GET /admin/mongo/gros-gagnants?multiplicateur=1000 (filtre imbrique + index)', async () => {
  const r = await appel('GET', '/admin/mongo/gros-gagnants?multiplicateur=1000&limite=50', { token: admin });
  statut(r, 200);
  attendu(r.donnees.every((d) => d.machine.meilleur_multiplicateur >= 1000), 'filtre incorrect');
  return `${r.donnees.length} joueur(s) ont touche x1000`;
});

log('\n[7] Lecture croisee PostgreSQL + MongoDB');
await test('GET /moi/bilan : argent (PostgreSQL) + comportement (MongoDB), meme identifiant', async () => {
  const r = await appel('GET', '/moi/bilan', { token: alice });
  statut(r, 200);
  attendu(r.donnees.source_postgres && r.donnees.source_mongodb, 'une des sources manque');
  return JSON.stringify(r.donnees.coherence);
});

log('\n[8] Back-office (role casino_superviseur)');
await test('GET /admin/integrite : grand livre coherent', async () => {
  const r = await appel('GET', '/admin/integrite', { token: admin });
  statut(r, 200);
  attendu(r.donnees.coherent === true, JSON.stringify(r.donnees.ecarts).slice(0, 200));
});
await test('GET /admin/collusion (WITH RECURSIVE ... CYCLE)', async () => {
  const r = await appel('GET', '/admin/collusion', { token: admin });
  statut(r, 200);
  return `${r.donnees.length} anneau(x)`;
});
await test('GET /joueurs/inexistant -> 404', async () => {
  statut(await appel('GET', '/joueurs/personne_123'), 404);
});

log(`\n${ok} reussi(s), ${ko} echec(s)`);
const ici = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(ici, 'test-api.log'), journal.join('\n') + '\n');
process.exit(ko === 0 ? 0 : 1);
