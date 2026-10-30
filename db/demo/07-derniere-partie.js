// =============================================================================
// 07 · ECRITURE PUIS RELECTURE (MongoDB)            npm run derniere-partie:mongo
// =============================================================================
// La meme partie, cote MongoDB : son replay (partieId = parties.id) et le
// document de statistiques d'alice (_id = joueurs.id), mis a jour par $inc.
// =============================================================================
db = db.getSiblingDB('casino');
const ALICE = 2;

print('\n--- Dernier replay d alice ---');
printjson(db.replays.find({ joueurId: ALICE }, { _id: 0 }).sort({ cree_le: -1 }).limit(1).toArray());

print('\n--- Ses statistiques (document stats_joueurs) ---');
printjson(db.stats_joueurs.findOne({ _id: ALICE }, { 'roulette.numeros': 0 }));
