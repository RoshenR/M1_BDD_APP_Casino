/**
 * =============================================================================
 * Statistiques publiques — trois sources, trois natures
 * =============================================================================
 * Le meme classement, servi de trois facons differentes. C'est la comparaison
 * la plus parlante du projet sur le choix d'un magasin de donnees :
 *
 *   /classement/live       Redis ZSET            temps reel, volatil, O(log n)
 *   /classement            fonction PL/pgSQL     exact, transactionnel, recalcule
 *   /statistiques/jour     vue materialisee      instantane, fige, a rafraichir
 *
 * Aucune n'est « la bonne » : elles repondent a trois questions differentes.
 * =============================================================================
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requete } from '../infra/postgres.js';
import { lireClassement } from '../infra/redis.js';

export async function routesStats(app: FastifyInstance): Promise<void> {
  /**
   * Classement EXACT, recalcule a la demande depuis parties.
   * classement() est SECURITY DEFINER : elle contourne volontairement la RLS,
   * parce qu'elle ne renvoie que des agregats anonymisables (pseudo + net),
   * jamais des lignes. Un GRANT SELECT large sur parties, lui, ouvrirait tout.
   */
  app.get('/classement', async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(req.query);
    return requete('SELECT * FROM casino.classement($1)', [limite]);
  });

  /**
   * Classement TEMPS REEL, alimente a chaque partie par ZINCRBY.
   * Il ne couvre que les parties jouees depuis le dernier demarrage de Redis :
   * c'est un cache d'animation, pas une source de verite. La difference avec
   * la route ci-dessus est volontaire et visible.
   */
  app.get('/classement/live', async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(req.query);
    return lireClassement(limite);
  });

  /** Marge et RTP reel par jeu — la VUE, donc toujours a jour. */
  app.get('/statistiques/jeux', async () => {
    return requete(
      `SELECT code, nom, nb_parties, total_mise, total_redistribue,
              marge_casino, rtp_reel, rtp_theorique, nb_joueurs
       FROM casino.v_resultats_par_jeu
       ORDER BY marge_casino DESC`,
    );
  });

  // Le tableau de bord quotidien s'appuie sur mv_stats_quotidiennes, qui n'est
  // accordee qu'a casino_bi et casino_admin : une vue materialisee ne connait
  // pas la RLS, donc on ne l'ouvre pas a l'application joueur.
  // Voir la route /admin/statistiques/jours.

  /** Profil public d'un joueur : ni email, ni solde, ni historique. */
  app.get<{ Params: { pseudo: string } }>('/joueurs/:pseudo', async (req, reply) => {
    const [profil] = await requete(
      'SELECT * FROM casino.v_profil_public WHERE pseudo = $1',
      [req.params.pseudo],
    );
    if (!profil) return reply.code(404).send({ erreur: 'Joueur introuvable' });
    return profil;
  });
}
