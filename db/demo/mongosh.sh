#!/bin/sh
# Ouvre mongosh sur la base casino avec les identifiants du conteneur, sans
# jamais les ecrire dans une commande (ils ne s'affichent donc pas a l'ecran).
#   sh /db/demo/mongosh.sh                         -> shell interactif
#   sh /db/demo/mongosh.sh /db/demo/06-mongodb.js  -> execute un script
exec mongosh --quiet \
  -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin casino "$@"
