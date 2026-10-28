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
import { MongoClient, type AnyBulkWriteOperation, type Collection } from 'mongodb';
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

/**
 * Statistiques de jeu d'un joueur : UN document, dont chaque jeu remplit sa
 * propre branche avec sa propre forme. C'est la raison d'etre de Mongo ici :
 * en SQL il faudrait trois tables, ou une table cle/valeur fourre-tout.
 *
 * Ce ne sont PAS des donnees comptables (mises, solde : PostgreSQL), mais le
 * comportement de jeu : numeros sortis, combinaisons obtenues, mains depassees.
 */
export interface StatsJoueur {
  _id: number;
  pseudo: string;
  maj_le?: Date;
  roulette?: {
    parties: number; mise: number; gain: number; gagnees: number; plus_gros_gain: number;
    numeros: Record<string, number>;
    couleurs: Record<string, number>;
    paris: Record<string, number>;
  };
  machine?: {
    parties: number; mise: number; gain: number; meilleur_multiplicateur: number;
    combinaisons: Record<string, number>;
  };
  blackjack?: {
    parties: number; mise: number; gain: number;
    depasses_21: number; croupier_depasse: number; doubles: number;
    somme_totaux: number; cartes_tirees: number;
    resultats: Record<string, number>;
  };
}

let client: MongoClient | null = null;
let replays: Collection<Replay> | null = null;
let stats: Collection<StatsJoueur> | null = null;

export async function connecterMongo(): Promise<void> {
  client = new MongoClient(config.mongoUrl);
  await client.connect();
  replays = client.db('casino').collection<Replay>('replays');
  await replays.createIndex({ partieId: 1 }, { unique: true });
  await replays.createIndex({ joueurId: 1, cree_le: -1 });

  // La collection est normalement creee (avec son validateur) par
  // db/mongo-init. On la cree ici aussi pour un volume Mongo plus ancien.
  const db = client.db('casino');
  const existe = await db.listCollections({ name: 'stats_joueurs' }).hasNext();
  if (!existe) await db.createCollection('stats_joueurs');
  stats = db.collection<StatsJoueur>('stats_joueurs');
}

/* ---------------------------------------------------------------------------
   Mise a jour apres chaque partie : UN updateOne, des $inc.
   ---------------------------------------------------------------------------
   $inc est atomique cote serveur : deux parties simultanees du meme joueur ne
   peuvent pas s'ecraser. upsert cree le document a la premiere partie.
   Les cles dynamiques (« roulette.numeros.17 ») sont la force du modele
   document : pas de colonne a prevoir pour chaque numero ou combinaison.
   ------------------------------------------------------------------------ */
type Partie = Record<string, unknown>;

function incrementsPour(p: Partie, double: boolean): {
  inc: Record<string, number>;
  max: Record<string, number>;
} {
  const jeu = String(p.jeu);
  const mise = Number(p.mise ?? 0);
  const gain = Number(p.gain ?? 0);
  const inc: Record<string, number> = {
    [`${jeu}.parties`]: 1,
    [`${jeu}.mise`]: mise,
    [`${jeu}.gain`]: gain,
  };
  const max: Record<string, number> = {};
  const etat = (p.etat ?? {}) as Record<string, unknown>;

  if (jeu === 'roulette') {
    inc['roulette.gagnees'] = gain > 0 ? 1 : 0;
    inc[`roulette.numeros.${etat.numero}`] = 1;
    inc[`roulette.couleurs.${etat.couleur}`] = 1;
    inc[`roulette.paris.${String(etat.pari).split(':')[0]}`] = 1;
    max['roulette.plus_gros_gain'] = gain;
  }

  if (jeu === 'machine') {
    inc[`machine.combinaisons.${etat.combinaison}`] = 1;
    max['machine.meilleur_multiplicateur'] = mise > 0 ? Math.round(gain / mise) : 0;
  }

  if (jeu === 'blackjack') {
    const joueur = p.joueur as { total: number; cartes: unknown[] };
    const croupier = p.croupier as { total: number };
    inc[`blackjack.resultats.${p.resultat}`] = 1;
    inc['blackjack.depasses_21'] = joueur.total > 21 ? 1 : 0;
    inc['blackjack.croupier_depasse'] = croupier.total > 21 ? 1 : 0;
    inc['blackjack.doubles'] = double ? 1 : 0;
    inc['blackjack.somme_totaux'] = joueur.total;
    inc['blackjack.cartes_tirees'] = Math.max(0, joueur.cartes.length - 2);
  }

  return { inc, max };
}

export async function majStats(joueurId: number, pseudo: string, partie: Partie, double = false): Promise<void> {
  if (!stats) return;
  try {
    const { inc, max } = incrementsPour(partie, double);
    await stats.updateOne(
      { _id: joueurId },
      { $inc: inc, $max: max, $set: { pseudo, maj_le: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    // Statistique degradee : la partie, elle, est deja comptabilisee.
    console.error('[mongo] stats non mises a jour :', (e as Error).message);
  }
}

export async function lireStats(joueurId: number): Promise<StatsJoueur | null> {
  if (!stats) return null;
  return stats.findOne({ _id: joueurId });
}

export async function compterStats(): Promise<number> {
  return stats ? stats.estimatedDocumentCount() : -1;
}

/**
 * Reconstruction complete depuis PostgreSQL. Les documents arrivent deja
 * construits (fonction SQL export_stats_joueurs) : on les remplace en lots.
 */
export async function remplacerStats(documents: StatsJoueur[]): Promise<number> {
  if (!stats) return 0;
  const maintenant = new Date();
  for (let i = 0; i < documents.length; i += 1000) {
    const lot: AnyBulkWriteOperation<StatsJoueur>[] = documents.slice(i, i + 1000).map((d) => ({
      replaceOne: { filter: { _id: d._id }, replacement: { ...d, maj_le: maintenant }, upsert: true },
    }));
    await stats.bulkWrite(lot, { ordered: false });
  }
  return documents.length;
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
