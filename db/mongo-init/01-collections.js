// =============================================================================
// MongoDB — 1. le replay detaille des parties
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

// =============================================================================
// stats_joueurs — le comportement de jeu, un document par joueur
// =============================================================================
// Chaque jeu remplit sa propre branche, avec sa propre forme :
//   roulette  : numeros sortis, couleurs, types de paris
//   machine   : combinaisons obtenues, meilleur multiplicateur
//   blackjack : resultats, mains depassees, doubles, total moyen
//
// En SQL, il faudrait trois tables, ou une table cle/valeur fourre-tout. Ici,
// un document, mis a jour par un seul updateOne + $inc apres chaque partie.
//
// Ce ne sont PAS des donnees comptables : les mises, gains et soldes font foi
// dans PostgreSQL. Cette collection est DERIVEE et reconstructible a tout
// moment depuis la base (fonction SQL export_stats_joueurs()).
// =============================================================================
db.createCollection('stats_joueurs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'pseudo'],
      properties: {
        _id:       { bsonType: ['int', 'long'], description: 'joueurs.id cote PostgreSQL' },
        pseudo:    { bsonType: 'string' },
        roulette:  { bsonType: 'object' },
        machine:   { bsonType: 'object' },
        blackjack: { bsonType: 'object' }
      }
    }
  }
});

print('[mongo] collection "stats_joueurs" prete');
