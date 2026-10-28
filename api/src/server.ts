/**
 * =============================================================================
 * API Casino — Fastify + TypeScript, SQL brut
 * =============================================================================
 * Backend dissocie du front : il ne rend aucune page, il expose du JSON.
 * Le front (React/Vite, port 5173) ne parle qu'a cette API, jamais a la base.
 * =============================================================================
 */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';

import { config } from './config.js';
import { ErreurHttp } from './erreurs.js';
import { fermerPostgres, requete } from './infra/postgres.js';
import { fermerRedis, redis } from './infra/redis.js';
import { compterStats, connecterMongo, fermerMongo } from './infra/mongo.js';
import { routesAuth } from './routes/auth.js';
import { routesProfil } from './routes/profil.js';
import { routesJeux } from './routes/jeux.js';
import { routesStats } from './routes/stats.js';
import { fermerAdmin, reconstruireStatsMongo, routesAdmin } from './routes/admin.js';

declare module 'fastify' {
  interface FastifyRequest {
    joueur: { id: number; pseudo: string; role: string };
  }
  interface FastifyInstance {
    authentifier: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    exigerAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const app = Fastify({
  logger: { level: config.env === 'development' ? 'info' : 'warn' },
});

await app.register(cors, { origin: config.corsOrigin, credentials: true });
await app.register(jwt, { secret: config.jwtSecret });

// Limitation de debit adossee a Redis : le compteur est partage entre toutes
// les instances de l'API, contrairement a un compteur en memoire.
await app.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  redis,
  keyGenerator: (req) => req.ip,
});

// --- Authentification --------------------------------------------------------
app.decorate('authentifier', async (req: FastifyRequest) => {
  try {
    const charge = await req.jwtVerify<{ sub: string; pseudo: string; role: string }>();
    req.joueur = { id: Number(charge.sub), pseudo: charge.pseudo, role: charge.role };
  } catch {
    throw new ErreurHttp(401, 'Authentification requise');
  }
});

app.decorate('exigerAdmin', async (req: FastifyRequest) => {
  if (req.joueur?.role !== 'admin') {
    throw new ErreurHttp(403, 'Reserve aux administrateurs');
  }
});

// --- Gestion centralisee des erreurs ----------------------------------------
app.setErrorHandler((err, req, reply) => {
  if (err instanceof ErreurHttp) {
    return reply.code(err.statut).send({ erreur: err.message, code: err.code });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      erreur: 'Requete invalide',
      details: err.issues.map((i) => ({ champ: i.path.join('.'), probleme: i.message })),
    });
  }
  if ((err as { statusCode?: number }).statusCode === 429) {
    return reply.code(429).send({ erreur: 'Trop de requetes, ralentissez.' });
  }
  req.log.error(err);
  return reply.code(500).send({ erreur: 'Erreur interne' });
});

// --- Sante -------------------------------------------------------------------
app.get('/sante', async () => {
  const [etat] = await requete<{ version: string; role: string; jeux: number }>(
    `SELECT version()                              AS version,
            current_user                           AS role,
            (SELECT count(*)::int FROM casino.jeux) AS jeux`,
  );
  return {
    ok: true,
    // Doit afficher casino_api : la preuve que l'API ne tourne pas en postgres.
    role_postgres: etat?.role,
    version: etat?.version.split(' ').slice(0, 2).join(' '),
    jeux: etat?.jeux,
  };
});

// --- Routes ------------------------------------------------------------------
await app.register(routesAuth);
await app.register(routesProfil);
await app.register(routesJeux);
await app.register(routesStats);
await app.register(routesAdmin);

// --- Demarrage ---------------------------------------------------------------
// Mongo est facultatif : une panne ne doit pas empecher de jouer, puisqu'il ne
// porte que du derive (replays, statistiques de jeu).
await connecterMongo().catch((e) => app.log.warn(`Mongo indisponible : ${e.message}`));

// Premier demarrage : la collection stats_joueurs est vide alors que la base
// contient deja 800 000 parties. On la reconstruit en tache de fond.
if ((await compterStats()) === 0) {
  reconstruireStatsMongo()
    .then((r) => app.log.info(`Stats Mongo reconstruites : ${r.documents} joueurs en ${r.duree_ms} ms`))
    .catch((e) => app.log.warn(`Reconstruction des stats Mongo impossible : ${e.message}`));
}

await app.listen({ port: config.port, host: config.hote });
app.log.info(`API prete sur http://localhost:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await Promise.allSettled([fermerPostgres(), fermerAdmin(), fermerRedis(), fermerMongo()]);
    process.exit(0);
  });
}
