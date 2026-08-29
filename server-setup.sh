#!/usr/bin/env bash
#
# Azkal Email Platform: server setup
#
# Run this from inside the application folder on Cloudways after uploading
# the code:
#
#   bash server-setup.sh
#
# Safe to re-run. It skips anything already done.

set -uo pipefail

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; N='\033[0m'
ok()   { echo -e "${G}  OK${N}  $1"; }
warn() { echo -e "${Y}  !!${N}  $1"; }
fail() { echo -e "${R}  XX${N}  $1"; }
step() { echo -e "\n=== $1 ==="; }

APP_DIR="$(pwd)"
DB_NAME="azkal_email"
DB_USER="azkal"

echo "
Azkal Email Platform: server setup
==================================
  Folder  $APP_DIR
"

[[ -f package.json ]] || { fail "No package.json here. cd into the app folder first."; exit 1; }

# ---------------------------------------------------------------------------
step "1. Node"
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null; then
  fail "Node is not installed. Set the Node version in the Cloudways panel first."
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node $(node -v) is too old. Set version 22 in Application Settings."
  exit 1
fi
ok "Node $(node -v)"

# ---------------------------------------------------------------------------
step "2. PostgreSQL"
# ---------------------------------------------------------------------------
if command -v psql >/dev/null; then
  ok "psql found: $(psql --version | awk '{print $3}')"
  HAVE_LOCAL_PG=1
else
  warn "PostgreSQL is not installed on this server."
  echo "
    Two options:

    A) Install it here (needs sudo):
         sudo apt update && sudo apt install -y postgresql postgresql-contrib

    B) Use a managed database instead. Free tiers at neon.tech or
       supabase.com handle 38,000 rows comfortably. Create one, copy the
       connection string, and paste it into .env as DATABASE_URL.

    If you pick B, skip to step 3 and this script will use whatever
    DATABASE_URL you have set.
"
  HAVE_LOCAL_PG=0
fi

if [[ "$HAVE_LOCAL_PG" == "1" ]] && ! grep -q "DATABASE_URL=postgres" .env 2>/dev/null; then
  echo ""
  read -rp "  Create the local database and user now? [Y/n] " mk
  if [[ "$mk" != "n" ]]; then
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
    sudo -u postgres psql <<SQL >/dev/null 2>&1
CREATE DATABASE ${DB_NAME};
CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASS}';
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};
SQL
    sudo -u postgres psql -d "${DB_NAME}" <<SQL >/dev/null 2>&1
GRANT ALL ON SCHEMA public TO ${DB_USER};
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
    echo "postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}" > .db-url.tmp
    chmod 600 .db-url.tmp
    ok "Database created. Connection string saved to .db-url.tmp"
    warn "Copy it into .env as DATABASE_URL, then delete .db-url.tmp"
  fi
fi

# ---------------------------------------------------------------------------
step "3. Environment"
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  cp .env.example .env
  SECRET=$(openssl rand -base64 48)
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env
  if [[ -f .db-url.tmp ]]; then
    DBURL=$(cat .db-url.tmp)
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DBURL}|" .env
    rm -f .db-url.tmp
    ok ".env created with database and session secret"
  else
    warn ".env created. Set DATABASE_URL in it before continuing."
    exit 1
  fi
else
  ok ".env already exists, leaving it alone"
fi

if grep -q "CHANGE_ME" .env; then
  fail "There are still CHANGE_ME placeholders in .env. Edit it, then re-run."
  exit 1
fi

# ---------------------------------------------------------------------------
step "4. Install and build"
# ---------------------------------------------------------------------------
npm install --no-audit --no-fund 2>&1 | tail -2
ok "Dependencies installed"

npm run build 2>&1 | grep -E "Compiled|Error|error" | head -5
if [[ ! -d .next ]]; then
  fail "The build failed. Scroll up for the error."
  exit 1
fi
ok "Build complete"

# ---------------------------------------------------------------------------
step "5. Database schema"
# ---------------------------------------------------------------------------
# set -a; source .env; set +a

if psql "$DATABASE_URL" -c "SELECT 1 FROM email_identities LIMIT 1" >/dev/null 2>&1; then
  COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM email_identities")
  ok "Schema already present, ${COUNT} contacts"
else
  npx tsx scripts/migrate.ts
  ok "Schema and safety triggers applied"
fi

if ! psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM users" 2>/dev/null | grep -qv "^0$"; then
  echo ""
  warn "No admin account yet. Create one:"
  echo "    npm run admin:create"
fi

# ---------------------------------------------------------------------------
step "6. Process manager"
# ---------------------------------------------------------------------------
mkdir -p logs

if ! command -v pm2 >/dev/null; then
  npm install -g pm2 >/dev/null 2>&1 || {
    warn "Could not install PM2 globally. Try: sudo npm install -g pm2"
  }
fi

if command -v pm2 >/dev/null; then
  ok "PM2 $(pm2 -v)"
  pm2 delete azkal-web azkal-worker >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs
  pm2 save >/dev/null 2>&1
  echo ""
  pm2 status
else
  fail "PM2 is not available. Install it and run: pm2 start ecosystem.config.cjs"
  exit 1
fi

# ---------------------------------------------------------------------------
step "7. Outbound IP"
# ---------------------------------------------------------------------------
# This is the address the OVH firewall will be told to trust.
OUT_IP=$(curl -4 -s --max-time 10 ifconfig.me || echo "could not detect")
ok "This server's outbound IP is ${OUT_IP}"

echo "
==================================================
Done.

  App:     http://127.0.0.1:3000  (proxy it to your domain, see DEPLOY.md)
  Web:     pm2 logs azkal-web
  Worker:  pm2 logs azkal-worker

The worker is running in SINK MODE. It renders and records messages but
sends nothing, because no SMTP details are configured. That is correct
until the OVH mail server exists.

Outbound IP for the OVH firewall rule:  ${OUT_IP}

Next:
  1. Set up the Nginx proxy (DEPLOY.md step 4)
  2. Create your admin account:  npm run admin:create
  3. Set up nightly backups (DEPLOY.md)
  4. Order the OVH VPS, then add SMTP_HOST, SMTP_USER and SMTP_PASS
     to .env and run:  pm2 restart azkal-worker
==================================================
"
