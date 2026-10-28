/**
 * Profil, portefeuille, historique et jeu responsable.
 *
 * Toutes les lectures passent par avecJoueur() : la RLS filtre les lignes,
 * et _exiger_identite() refuse toute fonction appelee pour un autre joueur.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avecJoueur, requete } from '../infra/postgres.js';
import { lireReplays, lireStats } from '../infra/mongo.js';
import { ErreurHttp, traduireErreurPg } from '../erreurs.js';

const schemaMontant = z.object({ montant: z.number().positive().max(10_000) });

export async function routesProfil(app: FastifyInstance): Promise<void> {
  const proteger = { onRequest: [app.authentifier] };

  // --- Mon compte ------------------------------------------------------------
  app.get('/moi', proteger, async (req) => {
    // mon_compte() est la SEULE fonction qui expose l'email, et seulement
    // celui du joueur de la session : casino_api n'a pas SELECT (email).
    const [compte] = await lire(req.joueur.id, 'SELECT * FROM casino.mon_compte($1)', [req.joueur.id]);
    if (!compte) throw new ErreurHttp(404, 'Compte introuvable');
    return compte;
  });

  app.patch('/moi', proteger, async (req) => {
    const corps = z.object({
      pseudo: z.string().min(3).max(24).optional(),
      email: z.string().email().optional(),
    }).parse(req.body);

    try {
      await lire(req.joueur.id, 'SELECT casino.modifier_profil($1, $2, $3)',
        [req.joueur.id, corps.pseudo ?? null, corps.email ?? null]);
    } catch (err) {
      throw traduireErreurPg(err);
    }
    const [compte] = await lire(req.joueur.id, 'SELECT * FROM casino.mon_compte($1)', [req.joueur.id]);
    return compte;
  });

  app.post('/moi/mot-de-passe', proteger, async (req) => {
    const corps = z.object({
      ancien: z.string().min(1),
      nouveau: z.string().min(8).max(200),
    }).parse(req.body);

    try {
      await lire(req.joueur.id, 'SELECT casino.changer_mot_de_passe($1, $2, $3)',
        [req.joueur.id, corps.ancien, corps.nouveau]);
    } catch (err) {
      throw traduireErreurPg(err);
    }
    return { ok: true };
  });

  // --- Portefeuille ----------------------------------------------------------
  app.post('/moi/depot', proteger, async (req) => {
    const { montant } = schemaMontant.parse(req.body);
    try {
      await lire(req.joueur.id, 'CALL casino.deposer($1, $2)', [req.joueur.id, montant]);
    } catch (err) {
      throw traduireErreurPg(err);
    }
    return solde(req.joueur.id);
  });

  app.post('/moi/retrait', proteger, async (req) => {
    const { montant } = schemaMontant.parse(req.body);
    try {
      await lire(req.joueur.id, 'CALL casino.retirer($1, $2)', [req.joueur.id, montant]);
    } catch (err) {
      throw traduireErreurPg(err);
    }
    return solde(req.joueur.id);
  });

  app.get('/moi/solde', proteger, async (req) => solde(req.joueur.id));

  // --- Transfert entre joueurs ----------------------------------------------
  // Le cas d'ecole de l'atomicite : debiter A et crediter B sont deux
  // ecritures, mais une seule transaction. Cote API, c'est UN appel.
  app.post('/moi/transfert', proteger, async (req) => {
    const { vers, montant, message } = z.object({
      vers: z.string().min(3).max(24),
      montant: z.number().positive().max(5000),
      message: z.string().max(200).optional(),
    }).parse(req.body);

    const [destinataire] = await requete<{ id: number }>(
      'SELECT id FROM casino.joueurs WHERE pseudo = $1', [vers]);
    if (!destinataire) throw new ErreurHttp(404, `Joueur "${vers}" introuvable`);

    try {
      await lire(req.joueur.id, 'CALL casino.transferer_jetons($1, $2, $3, $4)',
        [req.joueur.id, destinataire.id, montant, message ?? null]);
    } catch (err) {
      throw traduireErreurPg(err);
    }
    return solde(req.joueur.id);
  });

  // --- Grand livre -----------------------------------------------------------
  app.get('/moi/transactions', proteger, async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);

    // Aucun WHERE joueur_id : la politique RLS transactions_du_joueur s'en charge.
    // Retirer le filtre applicatif ne cree donc aucune fuite — c'est precisement
    // ce qu'apporte la securite au niveau ligne.
    return lire(req.joueur.id,
      `SELECT id, type, montant, solde_apres, libelle, partie_id, cree_le
       FROM casino.transactions
       ORDER BY cree_le DESC, id DESC
       LIMIT $1`, [limite]);
  });

  // --- Historique de jeu -----------------------------------------------------
  app.get('/moi/parties', proteger, async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(req.query);
    return lire(req.joueur.id, 'SELECT * FROM casino.parties_joueur($1, $2)', [req.joueur.id, limite]);
  });

  app.get('/moi/statistiques', proteger, async (req) => {
    const [stats] = await lire(req.joueur.id,
      'SELECT * FROM casino.v_stats_joueur WHERE joueur_id = $1', [req.joueur.id]);
    return stats ?? null;
  });

  /** Replays detailles, servis par MongoDB. */
  app.get('/moi/replays', proteger, async (req) => lireReplays(req.joueur.id, 20));

  /**
   * Statistiques de jeu, servies par MongoDB : un document par joueur, une
   * branche par jeu, chacune avec sa propre forme. Les chiffres d'argent
   * (mises, net) restent ceux de PostgreSQL, dans /moi/statistiques.
   */
  app.get('/moi/stats-jeux', proteger, async (req) => (await lireStats(req.joueur.id)) ?? null);

  // --- Jeu responsable -------------------------------------------------------
  // Deux regles que la BASE fait respecter, pas le front :
  //   · une auto-exclusion ne peut qu'etre allongee
  //   · une limite de mise ne peut que baisser
  app.post('/moi/exclusion', proteger, async (req) => {
    const { jours } = z.object({ jours: z.number().int().min(1).max(365) }).parse(req.body);
    try {
      const [r] = await lire(req.joueur.id, 'SELECT casino.definir_exclusion($1, $2) AS jusqu_au',
        [req.joueur.id, jours]);
      return r;
    } catch (err) {
      throw traduireErreurPg(err);
    }
  });

  app.post('/moi/limite', proteger, async (req) => {
    const { limite } = z.object({ limite: z.number().positive().max(100_000).nullable() }).parse(req.body);
    try {
      const [r] = await lire(req.joueur.id, 'SELECT casino.definir_limite($1, $2) AS limite_mise',
        [req.joueur.id, limite]);
      return r;
    } catch (err) {
      throw traduireErreurPg(err);
    }
  });

  // --- Parrainage : WITH RECURSIVE ------------------------------------------
  app.get('/moi/parrainage', proteger, async (req) => {
    // Toute la descendance, generation par generation (module 01).
    return requete(
      `WITH RECURSIVE descendance AS (
         SELECT id, pseudo, 1 AS niveau
         FROM casino.joueurs WHERE parrain_id = $1
         UNION ALL
         SELECT j.id, j.pseudo, d.niveau + 1
         FROM casino.joueurs j
         JOIN descendance d ON j.parrain_id = d.id
         WHERE d.niveau < 5
       )
       SELECT niveau, count(*)::int AS nb, array_agg(pseudo ORDER BY pseudo) AS pseudos
       FROM descendance GROUP BY niveau ORDER BY niveau`,
      [req.joueur.id],
    );
  });

  // ---------------------------------------------------------------------------
  async function solde(joueurId: number) {
    const [r] = await lire(joueurId,
      `SELECT solde_cache AS solde, solde_reel, nb_mouvements
       FROM casino.v_solde_joueur WHERE joueur_id = $1`, [joueurId]);
    return r ?? { solde: 0 };
  }
}

async function lire(
  joueurId: number,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  return avecJoueur(joueurId, async (client) => (await client.query(sql, params)).rows);
}
