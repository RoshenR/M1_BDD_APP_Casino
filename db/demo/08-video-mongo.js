// Captures pour la video : volume, un document, index des replays.
db = db.getSiblingDB('casino');
print('> db.stats_joueurs.countDocuments()');
print(db.stats_joueurs.countDocuments());
print('\n> db.stats_joueurs.findOne({ _id: 742 })');
printjson(db.stats_joueurs.findOne({ _id: 742 }));
print('\n> db.replays.getIndexes()');
printjson(db.replays.getIndexes().map((i) => ({ name: i.name, key: i.key,
  ...(i.unique ? { unique: true } : {}),
  ...(i.expireAfterSeconds ? { expireAfterSeconds: i.expireAfterSeconds } : {}),
  ...(i.partialFilterExpression ? { partialFilterExpression: i.partialFilterExpression } : {}) })));
