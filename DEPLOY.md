# Deploying to Cloudways

Read this once before starting. It takes about 30 minutes. Steps 1 to 4 are
Cloudways clicking, steps 5 to 8 are terminal work.

---

## 1. Create the application

In the Cloudways panel:

- **Add Application** on your existing server
- Application: **Custom App**
- Name: `azkal-email`
- Once created, note the **Application folder name** (something like `abcdefghij`)

Your app path will be:

    /home/master/applications/<APP_FOLDER>/public_html

---

## 2. Add PostgreSQL

Cloudways servers ship with MySQL, not Postgres, so add it yourself.

Open **Server → Settings & Packages** and check whether PostgreSQL is offered.
If it is, install it there. If it is not, SSH in as master and run:

    sudo apt update
    sudo apt install -y postgresql postgresql-contrib

Then create the database and user:

    sudo -u postgres psql

    CREATE DATABASE azkal_email;
    CREATE USER azkal WITH ENCRYPTED PASSWORD 'PUT_A_LONG_RANDOM_PASSWORD_HERE';
    GRANT ALL PRIVILEGES ON DATABASE azkal_email TO azkal;
    \c azkal_email
    GRANT ALL ON SCHEMA public TO azkal;
    ALTER DATABASE azkal_email OWNER TO azkal;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    \q

Write that password down. You need it in step 5.

> If Cloudways will not let you install Postgres on the server, tell me and I
> will switch the app to a managed Postgres (Neon or Supabase have free tiers
> that comfortably handle 44k rows). It is a one-line change to `DATABASE_URL`.

---

## 3. Point the domain

**Application → Domain Management**, add:

    email.azkalmedia.com

Then in your DNS, add an A record for `email` pointing at the Cloudways server IP.

Once it resolves, go to **Application → SSL Certificate**, pick Let's Encrypt,
and enable **Force HTTPS**.

---

## 4. Node version

**Application → Settings → Node.js version**: set to **22**.

---

## 5. Upload the code

SSH into the server as the master user, then:

    cd /home/master/applications/<APP_FOLDER>/public_html
    rm -rf *

Upload `azkal-email.zip` (via SFTP, or `scp` from your Mac), then:

    unzip azkal-email.zip
    mv azkal-email/* azkal-email/.[!.]* . 2>/dev/null
    rmdir azkal-email
    rm azkal-email.zip

You should now see `package.json` in the current directory.

---

## 6. Environment and install

Create the environment file:

    cp .env.example .env
    nano .env

Fill in exactly these two, leave the SMTP block empty for now:

    DATABASE_URL=postgres://azkal:THE_PASSWORD_FROM_STEP_2@127.0.0.1:5432/azkal_email
    SESSION_SECRET=

For the session secret, run this and paste the output:

    openssl rand -base64 48

Save with Ctrl+O, Enter, Ctrl+X.

Then install and build:

    npm install
    npm run db:migrate
    npm run admin:create
    npm run build

`db:migrate` applies the schema and then the safety triggers. You should see
two files applied and `All migrations applied.`

`admin:create` will prompt for your email and a password. Minimum 12 characters.

---

## 7. Keep it running

Install PM2 and start the app under it:

    npm install -g pm2
    pm2 start npm --name azkal-email -- start
    pm2 save
    pm2 startup

The last command prints a `sudo` line. Copy it, run it, and PM2 will restart the
app automatically if the server reboots.

Check it is alive:

    pm2 status
    curl -I http://127.0.0.1:3000

---

## 8. Route the domain to port 3000

Cloudways serves from Apache/Nginx by default, which will not know about your
Node process. In **Application → Application Settings → Nginx / Apache**, or via
`/etc/nginx/sites-available/<APP_FOLDER>`, add a proxy block:

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

The `client_max_body_size` matters. Without it, a 34,000 row CSV upload is
rejected by Nginx before it ever reaches the application.

Reload:

    sudo service nginx reload

---

## 9. Open it

Go to **https://email.azkalmedia.com**, sign in with the account from step 6.

You will land on an empty dashboard. That is correct. Go to **Import**, pick
**Brokers**, and upload the brokers CSV.

---

## Backups

Set this up on day one. This database becomes the only record of who you have
contacted.

    mkdir -p /home/master/backups
    crontab -e

Add:

    0 3 * * * pg_dump -U azkal azkal_email | gzip > /home/master/backups/azkal_$(date +\%Y\%m\%d).sql.gz
    0 4 * * * find /home/master/backups -name "azkal_*.sql.gz" -mtime +14 -delete

Then pull a copy down to your Mac weekly:

    scp master@YOUR_SERVER_IP:/home/master/backups/azkal_*.sql.gz ~/Dropbox/azkal-backups/

---

## Updating later

    cd /home/master/applications/<APP_FOLDER>/public_html
    # upload the new files
    npm install
    npm run db:migrate
    npm run build
    pm2 restart azkal-email

---

## If something goes wrong

**App will not start**

    pm2 logs azkal-email --lines 50

Usually a missing environment variable. The app fails loudly rather than
starting broken.

**"The database is not reachable" on the dashboard**

Check Postgres is running and the credentials are right:

    sudo service postgresql status
    psql "$DATABASE_URL" -c "SELECT 1"

**CSV upload fails at around 10MB**

The `client_max_body_size` from step 8 is missing or Nginx was not reloaded.

**Import runs but Arabic names look like question marks**

Tell me the file and I will adjust the encoding detection. The importer already
falls back to Windows-1256, but registry exports vary.

**Migration says a relation already exists**

The schema was applied twice. Safe to ignore if the guards file applied cleanly
afterwards. If not, drop and recreate the database and rerun `db:migrate`.
