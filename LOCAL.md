# Running it on your Mac

You already have Homebrew, Node and PostgreSQL. If you are starting fresh on
another machine, do the "First time only" section at the bottom first.

---

## Three commands

    cd ~/Documents/azkal-email
    npm install
    npm run setup
    npm run dev

Then open **http://localhost:3000**

`npm run setup` handles everything: writes the .env file, creates the database,
applies the schema and safety triggers, asks for an admin email and password,
and offers to load demo data. It is safe to run more than once, anything
already done is skipped.

Leave the `npm run dev` terminal window open. That is the server. Ctrl+C stops it.

---

## What to look at

**Dashboard.** Compare it against the Content Portal and tell me what is off.

**Contacts.** Search a broker number like `BRN-40`. Use the filter dropdowns.
Click **Exclude** on someone, confirm, watch the row turn pink and the button
become Restore.

**Exclusions.** The contact you just excluded is at the top.

**Import.** Two sample files are in the `sample-data` folder. Upload
`sample_brokers.csv`, pick Brokers, check the guessed column mapping, run it.
Fifteen rows in, eleven unique addresses, three rejected. Click the rejected
count to download exactly which rows failed and why.

That file is deliberately awful: the same Gmail address written two ways, a
plus-tag, a cell with two addresses in it, a broken address, a row with no
email, and a disposable domain. It is there so you can watch the importer
handle all of it without losing anything.

**Settings.** Change the daily limit, save, watch the sidebar update.

**Campaigns and Templates.** Not built yet. They will say so.

---

## Before importing the real files

    npm run seed:demo -- wipe

Then import your real CSVs. 34,000 rows takes a couple of minutes.

---

## Every day after that

    cd ~/Documents/azkal-email
    npm run dev

PostgreSQL runs in the background permanently, so that is the only command.

---

## First time only, on a new machine

    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

Run the two PATH lines it prints at the end, then:

    brew install node postgresql@16
    brew services start postgresql@16
    echo \'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"\' >> ~/.zprofile
    source ~/.zprofile

On an Intel Mac use `/usr/local/opt/postgresql@16/bin` instead.

---

## If setup stops

It tells you what is wrong and what to type. The three it catches:

**PostgreSQL is not running**

    brew services start postgresql@16

**No role for your Mac user**

    createuser -s $(whoami)

**psql not found**

The PATH line above did not take. Open a new terminal window and try again.

**Port 3000 already in use**

    lsof -ti:3000 | xargs kill -9

**Start completely over**

    dropdb azkal_email
    rm .env
    npm run setup

Anything else, paste the terminal output and I will sort it.
