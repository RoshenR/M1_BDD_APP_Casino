/** Configuration lue depuis l'environnement (docker-compose la fournit). */
function requis(nom: string, defaut?: string): string {
  const v = process.env[nom] ?? defaut;
  if (v === undefined) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  hote: '0.0.0.0',
  env: process.env.NODE_ENV ?? 'development',

  databaseUrl: requis('DATABASE_URL', 'postgres://casino_api:api_secret@localhost:5432/casino'),
  redisUrl: requis('REDIS_URL', 'redis://localhost:6379'),
  mongoUrl: requis('MONGO_URL', 'mongodb://casino:casino@localhost:27017/casino?authSource=admin'),

  jwtSecret: requis('JWT_SECRET', 'dev-secret-a-changer-en-production'),
  jwtDuree: '15m',          // court : le refresh token vit dans Redis
  refreshDureeSecondes: 60 * 60 * 24 * 7,

  corsOrigin: requis('CORS_ORIGIN', 'http://localhost:5173'),
} as const;
