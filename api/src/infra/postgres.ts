/**
 * =============================================================================
 * PostgreSQL — SQL brut, aucun ORM
 * =============================================================================
 * Choix assume du projet : pas de Prisma, pas de TypeORM.
 *
 *   · un ORM genererait le SQL a notre place — or c'est le SQL qui est evalue
 *   · un ORM ne sait pas appeler une procedure PL/pgSQL autrement qu'en brut
 *   · un ORM veut des droits d'ecriture directs sur les tables ; notre role
 *     casino_api n'en a aucun
 *
 * On se connecte avec casino_api : EXECUTE sur les fonctions metier, SELECT sur
 * quelques vues, et rien d'autre. Toute ecriture passe par une fonction
 * SECURITY DEFINER qui valide les regles.
 * =============================================================================
 */
import pg from 'pg';
import { config } from '../config.js';

// numeric (NUMERIC/DECIMAL) arrive en string par defaut, pour ne pas perdre de
// precision. Nos montants tiennent largement dans un double : on convertit.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[postgres] erreur du pool :', err.message);
});

/** Requete simple, hors contexte joueur (catalogue, classement public...). */
export async function requete<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

/**
 * ---------------------------------------------------------------------------
 * LE POINT CENTRAL DE LA SECURITE APPLICATIVE
 * ---------------------------------------------------------------------------
 * L'API se connecte avec UN SEUL role PostgreSQL pour tous les joueurs.
 * Elle passe donc l'identite du joueur par la SESSION, a chaque transaction :
 *
 *     BEGIN;
 *     SELECT set_config('app.joueur_id', '42', true);   -- true = local a la transaction
 *     ... requetes ...
 *     COMMIT;
 *
 * C'est ce reglage que lisent :
 *   · les politiques RLS         -> USING (joueur_id = app_joueur_id())
 *   · _exiger_identite()         -> refuse d'agir pour un autre joueur
 *   · journal_audit.joueur_app   -> tracabilite applicative
 *
 * Le `true` est essentiel : le reglage meurt avec la transaction. Sans lui,
 * la connexion retournerait au pool en gardant l'identite du joueur precedent
 * — et le joueur suivant lirait ses donnees.
 * ---------------------------------------------------------------------------
 */
export async function avecJoueur<T>(
  joueurId: number,
  travail: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.joueur_id', String(joueurId)]);
    const resultat = await travail(client);
    await client.query('COMMIT');
    return resultat;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Raccourci : une seule requete dans le contexte d'un joueur. */
export async function requeteJoueur<T extends pg.QueryResultRow = pg.QueryResultRow>(
  joueurId: number,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return avecJoueur(joueurId, async (client) => {
    const res = await client.query<T>(sql, params);
    return res.rows;
  });
}

export async function fermerPostgres(): Promise<void> {
  await pool.end();
}
