/**
 * =============================================================================
 * Back-office — une AUTRE connexion, un AUTRE role
 * =============================================================================
 * Point important : ces routes n'utilisent pas le pool casino_api.
 * Elles ouvrent une connexion avec casino_superviseur, qui a BYPASSRLS et les
 * droits d'exploitation.
 *
 * Deux roles distincts dans la meme application, c'est le moindre privilege
 * applique jusqu'au bout : meme si une faille permettait a un joueur d'atteindre
 * une route admin, le JWT le ferait rejeter AVANT que la connexion privilegiee
 * ne soit ouverte.
 * =============================================================================
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { grosGagnants, remplacerStats, type StatsJoueur } from '../infra/mongo.js';
import { ErreurHttp, traduireErreurPg } from '../erreurs.js';

const poolAdmin = new pg.Pool({
  connectionString: process.env.DATABASE_URL_ADMIN ??
    'postgres://casino_superviseur:super_secret@postgres:5432/casino',
  max: 3,
});

async function admin<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string, params: unknown[] = [],
): Promise<T[]> {
  return (await poolAdmin.query<T>(sql, params)).rows;
}

export async function routesAdmin(app: FastifyInstance): Promise<void> {
  const proteger = { onRequest: [app.authentifier, app.exigerAdmin] };

  /** Le controle d'integrite du grand livre. Doit toujours rendre 0 ligne. */
  app.get('/admin/integrite', proteger, async () => {
    const ecarts = await admin('SELECT * FROM casino.verifier_integrite_soldes()');
    return { coherent: ecarts.length === 0, ecarts };
  });

  app.post('/admin/integrite/reparer', proteger, async () => {
    await admin('CALL casino.reparer_soldes()');
    const ecarts = await admin('SELECT * FROM casino.verifier_integrite_soldes()');
    return { coherent: ecarts.length === 0, ecarts };
  });

  /** REFRESH ... CONCURRENTLY : le tableau de bord se recalcule sans bloquer. */
  app.post('/admin/statistiques/rafraichir', proteger, async () => {
    const debut = Date.now();
    await admin('CALL casino.rafraichir_stats()');
    return { ok: true, duree_ms: Date.now() - debut };
  });

  /** Remboursement : contre-passation, jamais de DELETE. */
  app.post('/admin/parties/rembourser', proteger, async (req) => {
    const { partieId, motif } = z.object({
      partieId: z.number().int().positive(),
      motif: z.string().max(200).default('Litige'),
    }).parse(req.body);

    try {
      await admin('CALL casino.rembourser_partie($1, $2)', [partieId, motif]);
    } catch (err) {
      throw traduireErreurPg(err);
    }
    const [partie] = await admin('SELECT id, statut, mise, gain FROM casino.parties WHERE id = $1', [partieId]);
    return partie;
  });

  /** Journal d'audit : invisible pour casino_api (RLS sans politique). */
  app.get('/admin/audit', proteger, async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);
    return admin(
      `SELECT id, table_cible, operation, cle, avant, apres, role_bdd, joueur_app, cree_le
       FROM casino.journal_audit ORDER BY id DESC LIMIT $1`,
      [limite],
    );
  });

  /**
   * Tableau de bord quotidien, servi par la VUE MATERIALISEE.
   * Comparez la date la plus recente ici avec /statistiques/jeux (une vue
   * ordinaire, toujours a jour) : l'ecart est la « fenetre de peremption »
   * de la slide 24. POST /admin/statistiques/rafraichir la referme.
   */
  app.get('/admin/statistiques/jours', proteger, async (req) => {
    const { jours } = z.object({ jours: z.coerce.number().int().min(1).max(365).default(30) })
      .parse(req.query);
    return admin(
      `SELECT jour, jeu, nb_parties, nb_joueurs, total_mise, marge_casino,
              mise_moyenne, plus_gros_gain
       FROM casino.mv_stats_quotidiennes
       WHERE jour >= current_date - $1::int
       ORDER BY jour DESC, jeu`,
      [jours],
    );
  });

  /** Les requetes les plus couteuses (module 03). */
  app.get('/admin/requetes-lentes', proteger, async () => {
    return admin(
      `SELECT round(total_exec_time::numeric, 1) AS ms_total, calls,
              round(mean_exec_time::numeric, 2) AS ms_moyen, left(query, 120) AS requete
       FROM pg_stat_statements
       WHERE query NOT LIKE '%pg_stat%'
       ORDER BY total_exec_time DESC LIMIT 20`,
    );
  });

  /** Etat des index : lesquels servent, lesquels coutent (module 03). */
  app.get('/admin/index', proteger, async () => {
    return admin(
      `SELECT relname AS "table", indexrelname AS index, idx_scan AS lectures,
              pg_size_pretty(pg_relation_size(indexrelid)) AS taille
       FROM pg_stat_user_indexes WHERE schemaname = 'casino'
       ORDER BY idx_scan, pg_relation_size(indexrelid) DESC`,
    );
  });

  /**
   * Detection de collusion : les jetons qui tournent en boucle entre joueurs
   * (A -> B -> C -> A). Tout le calcul est dans detecter_collusion(), une
   * requete WITH RECURSIVE ... CYCLE sur la table transferts.
   */
  app.get('/admin/collusion', proteger, async (req) => {
    const { longueur } = z.object({ longueur: z.coerce.number().int().min(2).max(6).default(4) })
      .parse(req.query);
    return admin('SELECT * FROM casino.detecter_collusion($1)', [longueur]);
  });

  /**
   * Gros gagnants (surveillance anti-fraude), servis par MongoDB : filtre et
   * tri sur le champ imbrique machine.meilleur_multiplicateur, couvert par un
   * index. Ex. : ?multiplicateur=1000 -> les joueurs qui ont touche le jackpot.
   */
  app.get('/admin/mongo/gros-gagnants', proteger, async (req) => {
    const { multiplicateur, limite } = z.object({
      multiplicateur: z.coerce.number().int().min(1).max(1000).default(200),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(req.query);
    return grosGagnants(multiplicateur, limite);
  });

  /** Reconstruit la collection Mongo stats_joueurs depuis PostgreSQL. */
  app.post('/admin/mongo/reconstruire', proteger, async () => reconstruireStatsMongo());

  /** Suspension d'un compte : trace automatiquement par le trigger d'audit. */
  app.post('/admin/joueurs/statut', proteger, async (req) => {
    const { joueurId, statut } = z.object({
      joueurId: z.number().int().positive(),
      statut: z.enum(['actif', 'suspendu', 'ferme']),
    }).parse(req.body);

    const lignes = await admin(
      'UPDATE casino.joueurs SET statut = $2 WHERE id = $1 RETURNING id, pseudo, statut',
      [joueurId, statut],
    );
    if (lignes.length === 0) throw new ErreurHttp(404, 'Joueur introuvable');
    return lignes[0];
  });
}

/**
 * Les stats Mongo sont DERIVEES des parties : PostgreSQL les reconstruit a la
 * demande (export_stats_joueurs construit directement les documents jsonb).
 * Appele au demarrage si la collection est vide, puis a la demande.
 */
export async function reconstruireStatsMongo(): Promise<{ documents: number; duree_ms: number }> {
  const debut = Date.now();
  const lignes = await admin<{ document: StatsJoueur }>('SELECT document FROM casino.export_stats_joueurs()');
  const documents = await remplacerStats(lignes.map((l) => l.document));
  return { documents, duree_ms: Date.now() - debut };
}

export async function fermerAdmin(): Promise<void> {
  await poolAdmin.end();
}
