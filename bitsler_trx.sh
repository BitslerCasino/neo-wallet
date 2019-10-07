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

echo "Installing TRX Docker"

mkdir -p $HOME/.trx/logs
mkdir -p $HOME/.trx/datas

echo "Initial TRX Configuration"

read -p 'notify url(this url will be called when a deposit arrives): ' notify


[[ -z "$notify" ]] && die "Error: notify url is required. exiting..."

echo "Creating TRX configuration at $HOME/.trx/trx.env"

cat >$HOME/.trx/trx.env <<EOL
NODE_ENV=production
HOST=https://api.trongrid.io
PORT=8844
NOTIFY_URL=$notify
FREEZE=6000
EOL

cat >$HOME/.trx/db.json <<'EOL'
{
  "settings": {
    "secret": ""
  }
}
EOL

echo Installing TRX Container

docker volume create --name=trx-data
docker pull unibtc/trx:latest
docker run -v trx-data:/usr/src/app --name=trx-node -d \
      -p 8844:8844 \
      -v $HOME/.trx/trx.env:/usr/src/app/.env \
      -v $HOME/.trx/db.json:/usr/src/app/db.json \
      -v $HOME/.trx/datas:/usr/src/app/datas \
      -v $HOME/.trx/logs:/usr/src/app/logs \
      unibtc/trx:latest

cat >/usr/bin/trx-cli <<'EOL'
#!/usr/bin/env bash
docker exec -it trx-node /bin/bash -c "trx-cli $*"
EOL

cat >/usr/bin/trx-update <<'EOL'
#!/usr/bin/env bash
if [[ $EUID -ne 0 ]]; then
   echo "This script must be ran as root or sudo" 1>&2
   exit 1
fi
VERSION=$1
echo "Updating trx to $VERSION"
sudo docker stop trx-node || true
sudo docker rm trx-node || true
sudo docker images -a | grep "unibtc/trx" | awk '{print $3}' | xargs docker rmi
sudo docker pull unibtc/trx:$VERSION
sudo rm -rf ~/docker/volumes/trx-data  || true
sudo docker volume rm trx-data
sudo docker volume create --name=trx-data
docker run -v trx-data:/usr/src/app --name=trx-node -d \
      -p 8844:8844 \
      -v $HOME/.trx/trx.env:/usr/src/app/.env \
      -v $HOME/.trx/db.json:/usr/src/app/db.json \
      -v $HOME/.trx/datas:/usr/src/app/datas \
      -v $HOME/.trx/logs:/usr/src/app/logs \
      unibtc/trx:$VERSION
EOL

cat >/usr/bin/trx-rm <<'EOL'
#!/usr/bin/env bash
if [[ $EUID -ne 0 ]]; then
   echo "This script must be ran as root or sudo" 1>&2
   exit 1
fi
echo "WARNING! This will delete ALL TRX installation and files"
echo "Make sure your wallet seeds and phrase are safely backed up, there is no way to recover it!"
function uninstall() {
  sudo docker stop trx-node
  sudo docker rm trx-node
  sudo rm -rf ~/docker/volumes/trx-data ~/.trx /usr/bin/trx-cli
  sudo docker volume rm trx-data
  sudo docker image rm unibtc/trx:latest
  echo "Successfully removed"
  sudo rm -- "$0"
}
read -p "Continue (Y)?" choice
case "$choice" in
  y|Y ) uninstall;;
  * ) exit;;
esac
EOL

chmod +x /usr/bin/trx-rm
chmod +x /usr/bin/trx-cli
chmod +x /usr/bin/trx-update
echo
echo "==========================="
echo "==========================="
echo "Installation Complete"
echo
echo "RUN trx-cli getinfo"