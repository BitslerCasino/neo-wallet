#!/usr/bin/env bash

set -e

if [[ $EUID -ne 0 ]]; then
   echo "This script must be ran as root or sudo" 1>&2
   exit 1
fi

die () {
  ret=$?
  print "%s\n" "$@" >&2
  exit "$ret"
}

echo "Installing NEO Docker"

mkdir -p $HOME/.neo/logs
mkdir -p $HOME/.neo/datas

echo "Initial NEO Configuration"

read -p 'notify url(this url will be called when a deposit arrives): ' notify


[[ -z "$notify" ]] && die "Error: notify url is required. exiting..."

echo "Creating NEO configuration at $HOME/.neo/neo.env"

cat >$HOME/.neo/neo.env <<EOL
NODE_ENV=production
HOST=http://seed1.ngd.network:10332
PORT=10333
NOTIFY_URL=$notify
EOL

cat >$HOME/.neo/db.json <<'EOL'
{
  "settings": {
    "secret": ""
  }
}
EOL

echo Installing NEO Container

docker volume create --name=neo-data
docker pull bitsler/neo:latest
docker run -v neo-data:/usr/src/app --name=neo-node -d \
      -p 10333:10333 \
      -v $HOME/.neo/neo.env:/usr/src/app/.env \
      -v $HOME/.neo/db.json:/usr/src/app/db.json \
      -v $HOME/.neo/datas:/usr/src/app/datas \
      -v $HOME/.neo/logs:/usr/src/app/logs \
      bitsler/neo:latest

cat >/usr/bin/neo-cli <<'EOL'
#!/usr/bin/env bash
docker exec -it neo-node /bin/bash -c "neo-cli $*"
EOL

cat >/usr/bin/neo-update <<'EOL'
#!/usr/bin/env bash
if [[ $EUID -ne 0 ]]; then
   echo "This script must be ran as root or sudo" 1>&2
   exit 1
fi
VERSION=$1
echo "Updating neo to $VERSION"
sudo docker stop neo-node || true
sudo docker rm neo-node || true
sudo docker images -a | grep "bitsler/neo" | awk '{print $3}' | xargs docker rmi
sudo docker pull bitsler/neo:$VERSION
sudo rm -rf ~/docker/volumes/neo-data  || true
sudo docker volume rm neo-data
sudo docker volume create --name=neo-data
docker run -v neo-data:/usr/src/app --name=neo-node -d \
      -p 10333:10333 \
      -v $HOME/.neo/neo.env:/usr/src/app/.env \
      -v $HOME/.neo/db.json:/usr/src/app/db.json \
      -v $HOME/.neo/datas:/usr/src/app/datas \
      -v $HOME/.neo/logs:/usr/src/app/logs \
      bitsler/neo:$VERSION
EOL

cat >/usr/bin/neo-rm <<'EOL'
#!/usr/bin/env bash
if [[ $EUID -ne 0 ]]; then
   echo "This script must be ran as root or sudo" 1>&2
   exit 1
fi
echo "WARNING! This will delete ALL NEO installation and files"
echo "Make sure your wallet seeds and phrase are safely backed up, there is no way to recover it!"
function uninstall() {
  sudo docker stop neo-node
  sudo docker rm neo-node
  sudo rm -rf ~/docker/volumes/neo-data ~/.neo /usr/bin/neo-cli
  sudo docker volume rm neo-data
  sudo docker image rm bitsler/neo:latest
  echo "Successfully removed"
  sudo rm -- "$0"
}
read -p "Continue (Y)?" choice
case "$choice" in
  y|Y ) uninstall;;
  * ) exit;;
esac
EOL

chmod +x /usr/bin/neo-rm
chmod +x /usr/bin/neo-cli
chmod +x /usr/bin/neo-update
echo
echo "==========================="
echo "==========================="
echo "Installation Complete"
echo
echo "RUN neo-cli getinfo"