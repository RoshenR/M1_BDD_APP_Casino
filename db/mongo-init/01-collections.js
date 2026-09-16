// =============================================================================
// MongoDB — le replay detaille des parties
// =============================================================================
// Pourquoi Mongo ici, et pas une table PostgreSQL ?
//
//   · La forme du document change d'un jeu a l'autre : une main de blackjack
//     est une suite de coups, un spin de roulette est un seul evenement, un
//     tour de machine est trois rouleaux. Une table unique finirait en EAV
//     fourre-tout — exactement le defaut volontaire que le prof pointe sur
//     evenement_attributs (slide 8).
//   · Ces documents sont ecrits en masse, lus un par un, et JAMAIS joints.
//     Aucune jointure, aucun agregat transversal : rien qui demande du SQL.
//   · L'argent, lui, reste dans PostgreSQL. Mongo ne stocke aucun solde.
//
// Regle du projet : PostgreSQL est la source de verite, Mongo est un journal.
// =============================================================================

db = db.getSiblingDB('casino');

db.createCollection('replays', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['partieId', 'joueurId', 'jeu', 'coups', 'cree_le'],
      properties: {
        partieId: { bsonType: ['long', 'int'], description: 'parties.id cote PostgreSQL' },
        joueurId: { bsonType: 'int' },
        jeu:      { enum: ['blackjack', 'roulette', 'machine'] },
        mise:     { bsonType: ['double', 'int'] },
        gain:     { bsonType: ['double', 'int'] },
        // Forme libre : c'est precisement la raison d'etre de cette collection.
        coups:    { bsonType: 'array' },
        cree_le:  { bsonType: 'date' }
      }
    }
  }
});

// Lecture par partie (le joueur clique sur une ligne de son historique).
db.replays.createIndex({ partieId: 1 }, { unique: true });
// Lecture par joueur, du plus recent au plus ancien.
db.replays.createIndex({ joueurId: 1, cree_le: -1 });
// Purge automatique au bout d'un an : un replay n'est pas une piece comptable.
db.replays.createIndex({ cree_le: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

print('[mongo] collection "replays" prete');
