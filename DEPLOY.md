# Deploying to Cloudways

The app runs live 24/7 with the web interface and the send worker as two
background services. No terminals stay open.

**This is safe to do before the OVH mail server exists.** With no SMTP details
configured the worker starts in sink mode: it claims, renders and records
messages but physically cannot deliver anything. When OVH is ready you add three
lines to `.env` and restart one service.

Doing it in this order is deliberate: deploying gives you the Cloudways outbound
IP, which the OVH firewall rule needs.

---

## 1. Create the application

Cloudways panel:

- **Add Application** on your existing server
- Application: **Custom App**
- Name: `azkal-email`
- Note the application folder name it gives you

Your path will be:

    /home/master/applications/<APP_FOLDER>/public_html

Then **Application Settings → Node.js version → 22**.

---

## 2. The database question

Cloudways ships MySQL, not PostgreSQL. Two options.

**A: install PostgreSQL on the server.** Works on most Cloudways plans.

    sudo apt update
    sudo apt install -y postgresql postgresql-contrib

The setup script in step 3 will then create the database and user for you.

**B: use a managed PostgreSQL.** If Cloudways will not let you install it, or
you would rather not maintain it, both neon.tech and supabase.com have free
tiers that handle 38,000 rows without trouble. Create a database, copy the
connection string, and paste it into `.env` as `DATABASE_URL`.

Option B also gives you managed backups, which is worth something given this
database is the only record of who you have contacted.

Either works. The application does not care.

---

## 3. Upload and run the setup script

Upload the project via SFTP to `public_html`, or from your Mac:

    cd ~/Documents
    scp -r azkal-email/* master@YOUR_SERVER_IP:/home/master/applications/<APP_FOLDER>/public_html/

Do not copy `node_modules`, `.next` or `.env`. Those are rebuilt on the server.

Then SSH in:

    ssh master@YOUR_SERVER_IP
    cd /home/master/applications/<APP_FOLDER>/public_html
    bash server-setup.sh

It checks Node, sets up the database, writes `.env` with a fresh session secret,
installs dependencies, builds, applies the schema and safety triggers, installs
PM2, and starts both services.

At the end it prints **the server outbound IP**. Write that down. It goes in the
OVH firewall rule.

Then create your login:

    npm run admin:create

---

## 4. Point the domain at the app

Cloudways serves through Nginx, which does not know about your Node process
yet.

In your DNS, add an A record for `email` on `azkalmedia.com` pointing at the
Cloudways server IP. Then in the panel add `email.azkalmedia.com` under **Domain
Management**, and enable **Let's Encrypt SSL** with **Force HTTPS**.

Then add the proxy. In **Application Settings → Nginx**, or by editing
`/etc/nginx/sites-available/<APP_FOLDER>`:

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 60M;
    }

`client_max_body_size` matters. Without it a 34,000 row CSV upload is rejected
by Nginx before it ever reaches the app.

    sudo service nginx reload

---

## 5. Check it

Open **https://email.azkalmedia.com** and sign in.

    pm2 status

Both `azkal-web` and `azkal-worker` should show `online`.

    pm2 logs azkal-worker --lines 20

You should see the worker announce sink mode:

    Transport  local sink (writes files, sends nothing)
    NOTE       Nothing will actually be delivered.

That is correct until OVH exists.

---

## 6. Backups

Do this on day one. This database is the only record of who you have contacted.

    mkdir -p /home/master/backups
    crontab -e

Add:

    0 3 * * * pg_dump "$DATABASE_URL" | gzip > /home/master/backups/azkal_$(date +\%Y\%m\%d).sql.gz
    0 4 * * * find /home/master/backups -name "azkal_*.sql.gz" -mtime +14 -delete

Then pull a copy to your Mac weekly:

    scp master@YOUR_SERVER_IP:/home/master/backups/azkal_*.sql.gz ~/Dropbox/azkal-backups/

If you chose managed PostgreSQL in step 2, backups are handled for you.

---

## 7. Later: connecting the mail server

Once the OVH VPS passes verification, add three lines to `.env`:

    SMTP_HOST=mail.azkalmedia.agency
    SMTP_USER=azkalsend
    SMTP_PASS=<from /root/azkal-credentials.txt on the OVH box>

Set the warmup start date:

    psql "$DATABASE_URL" -c "UPDATE system_settings SET value = to_jsonb(CURRENT_DATE::text) WHERE key = 'warmup_started_on';"

Then:

    pm2 restart azkal-worker
    pm2 logs azkal-worker

The worker will now announce:

    Transport  Postfix at mail.azkalmedia.agency:587
    WARNING    This sends real email.

Nothing else changes. Same code, same queue, same safety rules.

---

## Everyday commands

    pm2 status                    what is running
    pm2 logs azkal-worker         watch it send
    pm2 restart azkal-worker      after changing .env or settings
    pm2 stop azkal-worker         halt sending, site stays up
    pm2 restart all               after deploying new code

Stopping the worker is the emergency brake. The site keeps working, campaigns
keep their state, nothing sends.

---

## Updating later

    cd /home/master/applications/<APP_FOLDER>/public_html
    # upload changed files
    npm install
    npx tsx scripts/migrate.ts
    npm run build
    pm2 restart all

---

## If something goes wrong

**Site will not load**

    pm2 logs azkal-web --lines 50

Usually a missing environment variable. The app fails loudly rather than
starting broken.

**Worker keeps restarting**

    pm2 logs azkal-worker --err --lines 50

**502 from Nginx**

The app is not running, or the proxy block in step 4 is missing.

    pm2 status
    curl -I http://127.0.0.1:3000

**CSV upload fails around 10MB**

`client_max_body_size` is missing or Nginx was not reloaded.

**Cannot install PostgreSQL**

Go with option B in step 2. It is a one-line change to `DATABASE_URL`.
