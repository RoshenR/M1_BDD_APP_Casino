/**
 * =============================================================================
 * MongoDB — le replay detaille des parties
 * =============================================================================
 * Pourquoi pas une table PostgreSQL ?
 *
 *   · La forme du document change d'un jeu a l'autre : une main de blackjack
 *     est une SUITE de coups, un spin de roulette est un evenement unique,
 *     un tour de machine est trois rouleaux. Une table unique finirait en
 *     EAV fourre-tout — le defaut volontaire que le prof pointe (slide 8).
 *   · Ces documents sont ecrits en masse, lus un par un, jamais joints.
 *     Aucune jointure, aucun agregat transversal : rien qui reclame du SQL.
 *   · Ils sont jetables : un TTL d'un an les purge tout seuls.
 *
 * Regle du projet : l'argent reste dans PostgreSQL. Mongo est un JOURNAL.
 * Si Mongo tombe, on perd des replays, pas un centime — d'ou le try/catch :
 * un echec d'ecriture ici ne doit JAMAIS faire echouer une partie deja
 * validee et comptabilisee par la base.
 * =============================================================================
 */
import { MongoClient, type Collection } from 'mongodb';
import { config } from '../config.js';

export interface Replay {
  partieId: number;
  joueurId: number;
  jeu: string;
  mise: number;
  gain: number;
  coups: unknown[];
  cree_le: Date;
}

let client: MongoClient | null = null;
let replays: Collection<Replay> | null = null;

export async function connecterMongo(): Promise<void> {
  client = new MongoClient(config.mongoUrl);
  await client.connect();
  replays = client.db('casino').collection<Replay>('replays');
  await replays.createIndex({ partieId: 1 }, { unique: true });
  await replays.createIndex({ joueurId: 1, cree_le: -1 });
}

export async function enregistrerReplay(r: Omit<Replay, 'cree_le'>): Promise<void> {
  if (!replays) return;
  try {
    await replays.updateOne(
      { partieId: r.partieId },
      { $set: { ...r, cree_le: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    // Journal degrade : on trace et on continue. La partie est deja en base.
    console.error('[mongo] replay non enregistre :', (e as Error).message);
  }
}

export async function lireReplays(joueurId: number, limite = 20): Promise<Replay[]> {
  if (!replays) return [];
  return replays.find({ joueurId }).sort({ cree_le: -1 }).limit(limite).toArray();
}

export async function lireReplay(partieId: number): Promise<Replay | null> {
  if (!replays) return null;
  return replays.findOne({ partieId });
}

export async function fermerMongo(): Promise<void> {
  await client?.close();
}
