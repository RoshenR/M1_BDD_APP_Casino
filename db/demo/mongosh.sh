#!/bin/sh
# Ouvre mongosh sur la base casino avec les identifiants du conteneur, sans
# jamais les ecrire dans une commande (ils ne s'affichent donc pas a l'ecran).
#   sh /db/demo/mongosh.sh                         -> shell interactif
#   sh /db/demo/mongosh.sh /db/demo/06-mongodb.js  -> execute un script
set -e
if [ $# -eq 0 ]; then
  exec mongosh --quiet \
    -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin casino
fi

# Mode script : --eval + load() et entree standard fermee. Sans cela, lance
# sans terminal (docker compose exec -T, console d'un IDE), mongosh ouvre son
# invite interactive et attend au lieu d'executer le fichier.
exec mongosh --quiet \
  -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin casino \
  --eval "load('$1')" < /dev/null
