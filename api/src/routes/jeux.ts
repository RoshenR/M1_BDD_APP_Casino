/**
 * =============================================================================
 * Les trois jeux
 * =============================================================================
 * Regardez la taille de ce fichier : il n'y a AUCUNE logique de jeu dedans.
 *
 * Pas de tirage aleatoire, pas de table de gains, pas de calcul de main, pas
 * de verification de solde, pas de debit ni de credit. Tout cela est dans
 * PostgreSQL, en PL/pgSQL, sous transaction.
 *
 * L'API fait trois choses :
 *   1. valider la forme de la requete (zod)
 *   2. poser le contexte du joueur et appeler UNE fonction
 *   3. traduire l'erreur PostgreSQL eventuelle en code HTTP
 *
 * C'est exactement le message de la slide 61 : « tout ce que la base garantit,
 * l'application n'a plus a le verifier — ni a l'oublier ».
 * =============================================================================
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avecJoueur, requete } from '../infra/postgres.js';
import { enregistrerReplay, lireReplay, majStats } from '../infra/mongo.js';
import { majClassement } from '../infra/redis.js';
import { traduireErreurPg } from '../erreurs.js';

const schemaMise = z.object({
  mise: z.number().positive().max(100_000),
  clientSeed: z.string().max(64).optional(),
});

const schemaRoulette = schemaMise.extend({
  // rouge | noir | pair | impair | manque | passe | douzaine:1-3 | colonne:1-3 | plein:0-36
  pari: z.string().regex(/^(rouge|noir|pair|impair|manque|passe|douzaine:[1-3]|colonne:[1-3]|plein:([0-9]|[12][0-9]|3[0-6]))$/),
});

const schemaAction = z.object({
  partieId: z.number().int().positive(),
  action: z.enum(['tirer', 'rester', 'doubler']),
});

type Resultat = Record<string, unknown>;

export async function routesJeux(app: FastifyInstance): Promise<void> {
  /**
   * Appelle une fonction de jeu dans le contexte du joueur, puis pousse les
   * effets secondaires non transactionnels (replay et stats Mongo, classement
   * Redis). Ils ne peuvent pas faire echouer la partie : elle est deja validee
   * et comptabilisee par PostgreSQL.
   */
  async function jouer(
    joueurId: number,
    pseudo: string,
    sql: string,
    params: unknown[],
    double = false,
  ): Promise<Resultat> {
    let resultat: Resultat;
    try {
      resultat = await avecJoueur(joueurId, async (client) => {
        const res = await client.query<{ r: Resultat }>(sql, params);
        return res.rows[0]!.r;
      });
    } catch (err) {
      throw traduireErreurPg(err);
    }

    if (resultat.statut !== 'en_cours') {
      const mise = Number(resultat.mise ?? 0);
      const gain = Number(resultat.gain ?? 0);
      await enregistrerReplay({
        partieId: Number(resultat.partie_id),
        joueurId,
        jeu: String(resultat.jeu ?? 'blackjack'),
        mise,
        gain,
        coups: [resultat.etat ?? { joueur: resultat.joueur, croupier: resultat.croupier }],
      });
      await majClassement(pseudo, gain - mise);
      await majStats(joueurId, pseudo, resultat, double);
    }

    return resultat;
  }

  // --- Catalogue (public) ----------------------------------------------------
  app.get('/jeux', async () => {
    return requete('SELECT id, code, nom, mise_min, mise_max, rtp_theorique FROM casino.v_jeux_actifs ORDER BY id');
  });

  // --- Roulette --------------------------------------------------------------
  app.post('/jeux/roulette', { onRequest: [app.authentifier] }, async (req) => {
    const { mise, pari, clientSeed } = schemaRoulette.parse(req.body);
    return jouer(
      req.joueur.id,
      req.joueur.pseudo,
      'SELECT casino.jouer_roulette($1, $2, $3, $4) AS r',
      [req.joueur.id, mise, pari, clientSeed ?? 'defaut'],
    );
  });

  // --- Machine a sous --------------------------------------------------------
  app.post('/jeux/machine', { onRequest: [app.authentifier] }, async (req) => {
    const { mise, clientSeed } = schemaMise.parse(req.body);
    return jouer(
      req.joueur.id,
      req.joueur.pseudo,
      'SELECT casino.jouer_machine($1, $2, $3) AS r',
      [req.joueur.id, mise, clientSeed ?? 'defaut'],
    );
  });

  // --- Blackjack : distribution ---------------------------------------------
  app.post('/jeux/blackjack', { onRequest: [app.authentifier] }, async (req) => {
    const { mise, clientSeed } = schemaMise.parse(req.body);
    return jouer(
      req.joueur.id,
      req.joueur.pseudo,
      'SELECT casino.blackjack_commencer($1, $2, $3) AS r',
      [req.joueur.id, mise, clientSeed ?? 'defaut'],
    );
  });

  // --- Blackjack : tirer / rester / doubler ---------------------------------
  app.post('/jeux/blackjack/action', { onRequest: [app.authentifier] }, async (req) => {
    const { partieId, action } = schemaAction.parse(req.body);
    return jouer(
      req.joueur.id,
      req.joueur.pseudo,
      'SELECT casino.blackjack_action($1, $2, $3) AS r',
      [req.joueur.id, partieId, action],
      action === 'doubler',
    );
  });

  // --- Reprendre une main interrompue ---------------------------------------
  app.get('/jeux/blackjack/en-cours', { onRequest: [app.authentifier] }, async (req) => {
    // La RLS garantit qu'on ne peut lire QUE ses propres parties : pas besoin
    // d'ajouter un WHERE joueur_id = ... , la politique le fait deja.
    const [partie] = await requeteContexte(req.joueur.id,
      `SELECT partie_id, mise, etat, statut
       FROM casino.v_historique_parties
       WHERE statut = 'en_cours'
       ORDER BY partie_id DESC LIMIT 1`);
    return partie ?? null;
  });

  // --- Provably fair : verifier une partie -----------------------------------
  app.get<{ Params: { id: string } }>('/parties/:id/verification', { onRequest: [app.authentifier] }, async (req) => {
    const id = Number(req.params.id);
    const [v] = await requeteContexte(req.joueur.id,
      'SELECT * FROM casino.verifier_partie($1)', [id]);
    const replay = await lireReplay(id);
    return { ...(v ?? {}), replay: replay?.coups ?? null };
  });
}

/** Petit utilitaire local : une requete de lecture dans le contexte du joueur. */
async function requeteContexte(
  joueurId: number,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  return avecJoueur(joueurId, async (client) => {
    const res = await client.query(sql, params);
    return res.rows;
  });
}
