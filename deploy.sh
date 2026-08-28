#!/usr/bin/env bash
#
# Deploy the latest code on the server.
#
#   bash deploy.sh
#
# Pulls from git, installs, applies any new migrations, rebuilds, and restarts
# both services. Safe to run any time.

set -euo pipefail

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}  OK${N}  $1"; }
warn() { echo -e "${Y}  !!${N}  $1"; }
step() { echo -e "\n=== $1 ==="; }

[[ -f package.json ]] || { echo "Run this from the app folder."; exit 1; }
[[ -f .env ]] || { echo "No .env here. Run server-setup.sh first."; exit 1; }

step "1. Pulling latest code"
BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo "none")
git pull --ff-only
AFTER=$(git rev-parse --short HEAD)

if [[ "$BEFORE" == "$AFTER" ]]; then
  ok "Already up to date at $AFTER"
else
  ok "Updated $BEFORE to $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" 2>/dev/null | head -10 || true
fi

step "2. Dependencies"
npm install --no-audit --no-fund 2>&1 | tail -2

step "3. Database migrations"
# Only applies files that have not run yet. Existing data is untouched.
npx tsx scripts/migrate.ts 2>&1 | tail -5 || warn "Migration step reported an issue, check above"

step "4. Build"
npm run build 2>&1 | grep -E "Compiled|Error|error" | head -5
[[ -d .next ]] || { echo -e "${R}Build failed. Not restarting.${N}"; exit 1; }
ok "Build complete"

step "5. Restart"
# Web first, then worker. The worker finishes its current message before
# stopping, so a restart never interrupts a send mid-flight.
pm2 restart azkal-web
pm2 restart azkal-worker
sleep 3
pm2 status

echo -e "\nDeployed. Watch the worker with:  pm2 logs azkal-worker\n"
