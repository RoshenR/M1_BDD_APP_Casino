/**
 * =============================================================================
 * Redis — trois usages, trois justifications
 * =============================================================================
 *  1. SESSIONS      refresh tokens revocables (SETEX + DEL a la deconnexion)
 *  2. RATE LIMITING protection des tentatives de connexion (INCR + EXPIRE)
 *  3. CLASSEMENT    leaderboard temps reel en ZSET (ZINCRBY / ZREVRANGE)
 *
 * Le 3e est le plus interessant pedagogiquement : il se compare directement a
 * la vue materialisee mv_stats_quotidiennes.
 *
 *   Redis ZSET          -> temps reel, volatil, O(log n) par mise a jour
 *   vue materialisee    -> figee jusqu'au REFRESH, mais transactionnelle
 *                          et reconstructible depuis la source de verite
 *
 * Regle du projet : AUCUN solde dans Redis. L'argent vit dans PostgreSQL,
 * sous contrainte et sous transaction. Redis n'a que du derive et du jetable.
 * =============================================================================
 */
import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

redis.on('error', (e) => console.error('[redis]', e.message));

const CLE_CLASSEMENT = 'casino:classement:net';

/** Refresh token revocable : la deconnexion le supprime vraiment. */
export async function enregistrerSession(jti: string, joueurId: number): Promise<void> {
  await redis.setex(`session:${jti}`, config.refreshDureeSecondes, String(joueurId));
}

export async function lireSession(jti: string): Promise<number | null> {
  const v = await redis.get(`session:${jti}`);
  return v === null ? null : Number(v);
}

export async function revoquerSession(jti: string): Promise<void> {
  await redis.del(`session:${jti}`);
}

/** Compteur glissant de tentatives echouees, par email. */
export async function compterTentative(cle: string, fenetreSecondes = 300): Promise<number> {
  const n = await redis.incr(`tentative:${cle}`);
  if (n === 1) await redis.expire(`tentative:${cle}`, fenetreSecondes);
  return n;
}

export async function reinitialiserTentatives(cle: string): Promise<void> {
  await redis.del(`tentative:${cle}`);
}

/** Classement temps reel : mis a jour a chaque partie, sans toucher a la base. */
export async function majClassement(pseudo: string, resultatNet: number): Promise<void> {
  await redis.zincrby(CLE_CLASSEMENT, resultatNet, pseudo);
}

export async function lireClassement(limite = 20): Promise<{ pseudo: string; net: number }[]> {
  const plat = await redis.zrevrange(CLE_CLASSEMENT, 0, limite - 1, 'WITHSCORES');
  const sortie: { pseudo: string; net: number }[] = [];
  for (let i = 0; i < plat.length; i += 2) {
    sortie.push({ pseudo: plat[i]!, net: Number(plat[i + 1]) });
  }
  return sortie;
}

export async function fermerRedis(): Promise<void> {
  await redis.quit();
}
