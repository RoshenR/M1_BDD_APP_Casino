/**
 * =============================================================================
 * Neo4j — le graphe social et la detection de collusion
 * =============================================================================
 * Le meme graphe existe dans PostgreSQL (joueurs.parrain_id et la table
 * amities). L'interet est precisement la COMPARAISON :
 *
 *   PostgreSQL          WITH RECURSIVE ... UNION ALL ...   (module 01)
 *   Neo4j               MATCH (a)-[:PARRAINE*1..5]->(b)
 *
 * Postgres gagne quand la profondeur est connue et que les donnees doivent
 * etre transactionnelles. Cypher gagne pour les chemins de longueur variable
 * et la detection de CYCLES — typiquement deux joueurs qui se renvoient des
 * jetons en boucle.
 *
 * Regle du projet : Neo4j est une PROJECTION en lecture. La verite reste dans
 * PostgreSQL ; une panne Neo4j ne bloque jamais une partie.
 * =============================================================================
 */
import neo4j, { type Driver } from 'neo4j-driver';
import { config } from '../config.js';

let driver: Driver | null = null;

export async function connecterNeo4j(): Promise<void> {
  driver = neo4j.driver(
    config.neo4j.url,
    neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
  );
  await driver.verifyConnectivity();

  const s = driver.session();
  try {
    await s.run('CREATE CONSTRAINT joueur_id IF NOT EXISTS FOR (j:Joueur) REQUIRE j.id IS UNIQUE');
  } finally {
    await s.close();
  }
}

export async function cypher<T = Record<string, unknown>>(
  requete: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  if (!driver) return [];
  const s = driver.session();
  try {
    const res = await s.run(requete, params);
    return res.records.map((r) => r.toObject() as T);
  } finally {
    await s.close();
  }
}

/** Projette un joueur et son lien de parrainage dans le graphe. */
export async function synchroniserJoueur(
  id: number,
  pseudo: string,
  parrainId: number | null,
): Promise<void> {
  try {
    await cypher(
      `MERGE (j:Joueur {id: $id})
       SET   j.pseudo = $pseudo
       WITH j
       CALL (j) {
         WITH j
         MATCH (j)<-[r:PARRAINE]-() DELETE r
       }
       WITH j
       WHERE $parrainId IS NOT NULL
       MERGE (p:Joueur {id: $parrainId})
       MERGE (p)-[:PARRAINE]->(j)`,
      { id, pseudo, parrainId },
    );
  } catch (e) {
    console.error('[neo4j] synchronisation ignoree :', (e as Error).message);
  }
}

/** Enregistre un transfert de jetons entre joueurs (arete ponderee). */
export async function enregistrerTransfert(de: number, vers: number, montant: number): Promise<void> {
  try {
    await cypher(
      `MATCH (a:Joueur {id: $de}), (b:Joueur {id: $vers})
       MERGE (a)-[t:TRANSFERE]->(b)
       ON CREATE SET t.total = $montant, t.nb = 1
       ON MATCH  SET t.total = t.total + $montant, t.nb = t.nb + 1`,
      { de, vers, montant },
    );
  } catch (e) {
    console.error('[neo4j] transfert ignore :', (e as Error).message);
  }
}

export async function fermerNeo4j(): Promise<void> {
  await driver?.close();
}
