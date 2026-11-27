#!/usr/bin/env bash
# Runs ON the server (copied there and run by .github/workflows/deploy.yml, or by hand).
# Backs up the database, pulls main from GitHub, rebuilds the bot and waits for /health.
# The server's .env and the WhatsApp session volume are never touched.
set -euo pipefail

APP=/srv/mns-whatsapp-bot
REPO=https://github.com/imshailesh593/whatsapp_chatbot.git
HEALTH_URL=${HEALTH_URL:-https://wappoai.com/health}
DC="docker compose -p mnsbot -f docker-compose.yml -f docker-compose.vps.yml"

cd "$APP"
install -d -m 700 backups   # dumps hold customer data: root only
chmod 700 backups
stamp=$(date +%Y%m%d-%H%M%S)

echo "== backup"
( umask 077; $DC exec -T db pg_dump -U postgres -Fc mns_bot > "backups/pre-deploy-$stamp.dump" </dev/null )
[ -s "backups/pre-deploy-$stamp.dump" ] || { echo "backup is empty, stopping"; exit 1; }
ls -t backups/pre-deploy-*.dump | tail -n +11 | xargs -r rm -f --   # keep the 10 newest

echo "== fetch main"
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git clone --quiet --depth 1 --branch main "$REPO" "$src"
echo "deploying $(git -C "$src" log --oneline -1)"
rsync -a --exclude=.env --exclude=.git --exclude=node_modules --exclude=backups "$src"/ "$APP"/

echo "== rebuild"
$DC up -d --build bot </dev/null 2>&1 | tail -8

echo "== health"
for i in $(seq 1 30); do
  out=$(curl -fsS -m 10 "$HEALTH_URL" 2>/dev/null || true)
  if echo "$out" | grep -q '"ok":true'; then echo "$out"; echo "deploy ok (backup: backups/pre-deploy-$stamp.dump)"; exit 0; fi
  sleep 5
done
echo "bot did not become healthy within 150s. Last output: $out"
echo "Logs: $DC logs --tail 60 bot"
exit 1
