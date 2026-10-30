// =============================================================================
// 06 · MONGODB — demonstration (mongosh)
// =============================================================================
//   npm run demo:mongo
//   (= docker compose exec mongo mongosh ... casino /db/demo/06-mongodb.js)
//
// Collections :
//   stats_joueurs  1 document par joueur, une branche par jeu (forme variable)
//   replays        1 document par partie jouee dans l'application (TTL 1 an)
// =============================================================================

db = db.getSiblingDB('casino');
const titre = (t) => print('\n################ ' + t + ' ################\n');

// -----------------------------------------------------------------------------
titre('1 · Volume et apercu');
// -----------------------------------------------------------------------------
print('stats_joueurs :', db.stats_joueurs.countDocuments(), 'documents');
print('replays       :', db.replays.countDocuments(), 'documents');
printjson(db.stats_joueurs.findOne({ pseudo: 'alice' }) ?? db.stats_joueurs.findOne());

// -----------------------------------------------------------------------------
titre('2 · Filtre sur champs imbriques + projection + tri');
// -----------------------------------------------------------------------------
// Qui a deja touche x200 ou plus a la machine ? (surveillance anti-fraude)
printjson(db.stats_joueurs.find(
  { 'machine.meilleur_multiplicateur': { $gte: 200 } },
  { pseudo: 1, 'machine.meilleur_multiplicateur': 1, 'machine.parties': 1 }
).sort({ 'machine.meilleur_multiplicateur': -1 }).limit(5).toArray());

// Operateurs combines : roulette tres jouee ET jackpot "trois sept" obtenu
print('Joueurs avec un "trois sept" :',
  db.stats_joueurs.countDocuments({ 'machine.combinaisons.trois sept': { $exists: true } }));

// -----------------------------------------------------------------------------
titre('3 · Index : COLLSCAN contre IXSCAN');
// -----------------------------------------------------------------------------
const plan = (cursor) => {
  const e = cursor.explain('executionStats');
  const etapes = [];
  let s = e.queryPlanner.winningPlan;
  while (s) { etapes.push(s.stage + (s.indexName ? '(' + s.indexName + ')' : '')); s = s.inputStage; }
  return { plan: etapes.join(' <- '), docs_examines: e.executionStats.totalDocsExamined,
           cles_examinees: e.executionStats.totalKeysExamined, ms: e.executionStats.executionTimeMillis };
};
const filtre = { 'machine.meilleur_multiplicateur': { $gte: 200 } };
print('Avec index   :'); printjson(plan(db.stats_joueurs.find(filtre)));
print('Sans index   :'); printjson(plan(db.stats_joueurs.find(filtre).hint({ $natural: 1 })));
print('Index de stats_joueurs :'); printjson(db.stats_joueurs.getIndexes().map((i) => i.name));
print('Index de replays (dont TTL et partiel) :');
printjson(db.replays.getIndexes().map((i) => ({ nom: i.name, cle: i.key,
  ttl_s: i.expireAfterSeconds, partiel: i.partialFilterExpression })));

// -----------------------------------------------------------------------------
titre('4 · Pipeline d agregation : le tirage de la roulette est-il equitable ?');
// -----------------------------------------------------------------------------
// $objectToArray transforme { "17": 3, "0": 1 } en [{k:"17",v:3}, ...]
// $unwind -> une ligne par (joueur, numero) ; $group -> somme sur le casino.
const numeros = db.stats_joueurs.aggregate([
  { $match: { 'roulette.numeros': { $exists: true } } },
  { $project: { _id: 0, n: { $objectToArray: '$roulette.numeros' } } },
  { $unwind: '$n' },
  { $group: { _id: { $toInt: '$n.k' }, sorties: { $sum: '$n.v' } } },
  { $group: { _id: null, total: { $sum: '$sorties' },
              numeros: { $push: { numero: '$_id', sorties: '$sorties' } } } },
  { $unwind: '$numeros' },
  { $project: { _id: 0, numero: '$numeros.numero', sorties: '$numeros.sorties',
                pct: { $round: [{ $multiply: [{ $divide: ['$numeros.sorties', '$total'] }, 100] }, 3] } } },
  { $sort: { sorties: -1 } }
]).toArray();
print('Attendu : 2,703 % par numero (1/37)');
print('Plus sortis  :'); printjson(numeros.slice(0, 3));
print('Moins sortis :'); printjson(numeros.slice(-3));

// -----------------------------------------------------------------------------
titre('5 · $facet : trois analyses en un seul passage');
// -----------------------------------------------------------------------------
printjson(db.stats_joueurs.aggregate([
  { $facet: {
    machine_combinaisons: [
      { $project: { c: { $objectToArray: { $ifNull: ['$machine.combinaisons', {}] } } } },
      { $unwind: '$c' },
      { $group: { _id: '$c.k', sorties: { $sum: '$c.v' }, joueurs: { $sum: 1 } } },
      { $sort: { sorties: -1 } }
    ],
    joueurs_par_volume: [
      { $bucket: { groupBy: { $add: [{ $ifNull: ['$roulette.parties', 0] },
                                     { $ifNull: ['$machine.parties', 0] },
                                     { $ifNull: ['$blackjack.parties', 0] }] },
                   boundaries: [0, 50, 80, 100, 1000000], default: 'autre',
                   output: { joueurs: { $sum: 1 } } } }
    ],
    totaux: [
      { $group: { _id: null, spins: { $sum: '$roulette.parties' },
                  tours: { $sum: '$machine.parties' }, mains: { $sum: '$blackjack.parties' } } }
    ]
  } }
]).toArray());

// -----------------------------------------------------------------------------
titre('6 · CRUD et validateur JSON Schema (sur une copie de test)');
// -----------------------------------------------------------------------------
const ID_TEST = -1;
db.replays.deleteOne({ partieId: ID_TEST });

// C : un document valide
db.replays.insertOne({ partieId: ID_TEST, joueurId: 2, jeu: 'roulette', mise: 10, gain: 0,
                       coups: [{ numero: 17, couleur: 'noir' }], cree_le: new Date() });
// R
printjson(db.replays.findOne({ partieId: ID_TEST }, { _id: 0 }));
// U : sous-document embarque
db.replays.updateOne({ partieId: ID_TEST },
  { $set: { 'annotation.note': 'demo', 'annotation.favori': true, 'annotation.maj_le': new Date() } });
printjson(db.replays.findOne({ partieId: ID_TEST }, { _id: 0, annotation: 1 }));
// Le validateur refuse un document incomplet (jeu inconnu, pas de coups)
try {
  db.replays.insertOne({ partieId: -2, joueurId: 2, jeu: 'poker', cree_le: new Date() });
} catch (e) {
  print('REFUSE par le validateur :', e.errmsg ?? e.message);
}
// D
print('Supprime :', db.replays.deleteOne({ partieId: ID_TEST }).deletedCount, 'document');
