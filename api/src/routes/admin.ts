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
import { cypher } from '../infra/neo4j.js';
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
   * Projette le graphe PostgreSQL dans Neo4j.
   * A lancer une fois apres le premier demarrage : Neo4j ne recoit sinon que
   * les inscriptions et les transferts faits depuis l'API.
   * La verite reste PostgreSQL ; ceci n'est qu'une copie de travail.
   */
  app.post('/admin/neo4j/synchroniser', proteger, async () => {
    const joueurs = await admin<{ id: number; pseudo: string; parrain_id: number | null }>(
      'SELECT id, pseudo, parrain_id FROM casino.joueurs ORDER BY id');

    const transferts = await admin<{ de: number; vers: number; total: number; nb: number }>(
      `SELECT e.joueur_id AS de, r.joueur_id AS vers,
              sum(r.montant)::float8 AS total, count(*)::int AS nb
       FROM casino.transactions e
       JOIN casino.transactions r
         ON r.type = 'transfert_recu'
        AND r.cree_le = e.cree_le
        AND r.montant = -e.montant
       WHERE e.type = 'transfert_envoye'
       GROUP BY 1, 2`);

    await cypher('MATCH (n:Joueur) DETACH DELETE n');
    await cypher(
      `UNWIND $lignes AS l
       MERGE (j:Joueur {id: l.id}) SET j.pseudo = l.pseudo`,
      { lignes: joueurs.map((j) => ({ id: j.id, pseudo: j.pseudo })) });
    await cypher(
      `UNWIND $lignes AS l
       MATCH (p:Joueur {id: l.parrain}), (f:Joueur {id: l.id})
       MERGE (p)-[:PARRAINE]->(f)`,
      { lignes: joueurs.filter((j) => j.parrain_id).map((j) => ({ id: j.id, parrain: j.parrain_id })) });
    await cypher(
      `UNWIND $lignes AS l
       MATCH (a:Joueur {id: l.de}), (b:Joueur {id: l.vers})
       MERGE (a)-[t:TRANSFERE]->(b) SET t.total = l.total, t.nb = l.nb`,
      { lignes: transferts });

    return { joueurs: joueurs.length, transferts: transferts.length };
  });

  /**
   * Detection de collusion — LA question pour laquelle Cypher bat SQL.
   * On cherche des CYCLES de transferts : A donne a B, B donne a C, C donne a A.
   * En SQL il faudrait une CTE recursive avec detection de boucle et un
   * garde-fou de profondeur ; en Cypher, c'est un motif.
   */
  app.get('/admin/collusion', proteger, async () => {
    const cycles = await cypher(
      `MATCH chemin = (a:Joueur)-[:TRANSFERE*2..4]->(a)
       RETURN [n IN nodes(chemin) | n.pseudo] AS boucle,
              reduce(s = 0, r IN relationships(chemin) | s + r.total) AS volume
       ORDER BY volume DESC
       LIMIT 20`,
    );
    return { cycles, note: 'Le meme calcul en SQL demanderait une CTE recursive avec detection de boucle.' };
  });

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

export async function fermerAdmin(): Promise<void> {
  await poolAdmin.end();
}
