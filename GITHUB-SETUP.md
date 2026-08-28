# GitHub and deployment: complete step by step

Nothing assumed. Every command, every click, and what you should see back.
Keep this open next to your Terminal.

---

# PART A: Prepare your Mac

## A1. Open Terminal
Press `Cmd + Space`, type `Terminal`, press Enter.

## A2. Check git is installed

    git --version

**Expected:** `git version 2.39.5` or similar.

**If it says "command not found"** or a popup offers to install developer tools,
click **Install**, wait a few minutes, then run it again.

## A3. Tell git who you are

Only needed once ever on this Mac. Git refuses to save your work without it.

    git config --global user.name "Jerome"
    git config --global user.email "jerome@azkalmedia.com"

Neither prints anything. That is correct. Check it took:

    git config --global user.name

**Expected:** `Jerome`

---

# PART B: Create the repository on GitHub

## B1. Sign in
Go to **https://github.com** and sign in. No account? Click **Sign up** first.

## B2. Start a new repository
Go to **https://github.com/new**

Or click the **+** icon top right of any GitHub page, then **New repository**.

## B3. Fill the form

**Owner** - leave as your username.

**Repository name** - type exactly:

    azkal-email

**Description** - leave empty.

**Public / Private** - click **Private**. This matters. Public would put your
database schema and sending setup on the open internet.

**Add a README file** - leave UNTICKED.
**Add .gitignore** - leave as `None`.
**Choose a license** - leave as `None`.

Those last three must be left alone. Your project already has them, and adding
them here creates a conflict that is annoying to untangle.

## B4. Create it
Click the green **Create repository** button.

## B5. Copy your repository address

You now see a mostly empty page. Near the top is a box with an address like:

    https://github.com/jerome/azkal-email.git

**Copy it.** You need it in step D7. If you cannot see it, click the **HTTPS**
button above the box.

Leave this tab open.

---

# PART C: Create your access token

GitHub stopped accepting account passwords from the command line. You need a
token. This is the step that stops most people.

## C1. Go to token settings
Click your **profile picture**, top right.
Click **Settings**.
Scroll to the very bottom of the left sidebar. Click **Developer settings**.
Click **Personal access tokens** to expand.
Click **Tokens (classic)**.

## C2. Generate
Click **Generate new token** top right, then **Generate new token (classic)**.
It may ask for your password or 2FA code.

## C3. Configure

**Note** - type: `Azkal email platform`
**Expiration** - choose **90 days**.
**Select scopes** - tick **repo**, the first one. It auto-ticks five items
underneath, which is correct. Tick nothing else.

## C4. Create and copy
Scroll down, click green **Generate token**.

You now see a long string starting `ghp_`.

**Copy it and paste it somewhere safe right now.** GitHub never shows it again.
Lose it and you make a new one.

## C5. What it is for
When Terminal asks for a **password**, you paste this token. Not your GitHub
password. The token IS the password now.

---

# PART D: Upload your code

## D1. Go to your project

    cd ~/Documents/azkal-email
    ls

**Expected:** a list including `package.json`, `src`, `scripts`, `drizzle`.

**If "No such file or directory"**, find it:

    ls ~/Documents
    ls ~/Downloads

## D2. Start tracking

    git init

**Expected:** `Initialized empty Git repository in ...`
**If "Reinitialized existing"**, fine, carry on.

## D3. Gather the files

    git add .

That dot is part of the command. Nothing prints. Correct.

## D4. SAFETY CHECK before committing

    git status

You see a long list of green filenames.

**Look through it for `.env`**

You should NOT see `.env` on its own. You SHOULD see `.env.example`, which is
different and safe.

**If you see plain `.env`, stop.** Run `cat .gitignore` and tell me what it
says. Otherwise your database password ends up on GitHub.

## D5. Save the snapshot

    git commit -m "Azkal email platform"

**Expected:** `130 files changed, 8500 insertions(+)` or similar.
**If "Please tell me who you are"**, do step A3.

## D6. Name the branch

    git branch -M main

Nothing prints. Correct.

## D7. Connect to GitHub

Use the address from B5, with your username:

    git remote add origin https://github.com/YOUR_USERNAME/azkal-email.git

Nothing prints. Correct.

**If "remote origin already exists"**:

    git remote set-url origin https://github.com/YOUR_USERNAME/azkal-email.git

## D8. Upload

    git push -u origin main

A box appears asking for username and password.

- **Username:** your GitHub username
- **Password:** paste the `ghp_...` token from C4

The password stays invisible as you paste. That is normal. Press Enter.

**Expected:** lines ending with `branch 'main' set up to track 'origin/main'.`

## D9. Confirm

Refresh your GitHub browser tab. You should see all your files.

**Check the file list. There must be no `.env`.** If there is, tell me at once.

Your code is now backed up.

---

# PART E: Get onto Cloudways

## E1. Find your login details

Open **https://platform.cloudways.com**, sign in.
Click **Servers** in the top menu.
Click your server.
Click **Master Credentials** on the left.

Note down:
- **Public IP**
- **Username** (usually `master`)
- **Password** (click the eye icon to reveal, then copy)

## E2. Connect

    ssh master@123.45.67.89

Use your actual IP.

**First time only** it asks:

    Are you sure you want to continue connecting (yes/no)?

Type `yes`, press Enter.

Then paste the password. It stays invisible. Press Enter.

**Expected:** your prompt changes to `master@server:~$`

You are now typing on the server, not your Mac.

## E3. Find your application folder

    ls /home/master/applications/

**Expected:** folders with random names like `abcdefghij`.

If there are several, the newest is yours:

    ls -lat /home/master/applications/

You can also confirm in Cloudways: **Applications → azkal-email → Application
Settings**, where the folder name is shown.

**Write it down.** Everything below uses it.

---

# PART F: Put the code on the server

## F1. Go to the application folder

    cd /home/master/applications/abcdefghij
    ls

Use your real folder name.
**Expected:** a folder called `public_html`.

## F2. Set the Node version FIRST

In the Cloudways browser tab: **Applications → azkal-email → Application
Settings**. Find **Node.js version**, set to **22**, save.

Back in Terminal:

    node -v

**Expected:** `v22.x.x` or higher.
**If v18 or lower:** type `exit`, then SSH back in and check again.

## F3. Replace public_html with your repository

    rm -rf public_html
    git clone https://github.com/YOUR_USERNAME/azkal-email.git public_html

Asks for username and the `ghp_` token again.

**Expected:** `Cloning into 'public_html'...` then progress.

## F4. Go into it

    cd public_html
    ls

**Expected:** the same files you saw on your Mac.

---

# PART G: Set it up

## G1. Run the setup script

    bash server-setup.sh

Does everything: checks Node, sets up the database, writes `.env` with a fresh
secret, installs, builds, applies the schema, installs PM2, starts both
services. About five minutes.

**It pauses and asks you things.** Read each question.

## G2. If PostgreSQL is not installed

The script stops and shows you options. Try:

    sudo apt update
    sudo apt install -y postgresql postgresql-contrib

May ask for your password. Use the Cloudways master password.

Then run `bash server-setup.sh` again.

**If it fails with a permission error**, tell me. We switch to a managed
database, which is a one-line change, not a problem.

## G3. Create your login

    npm run admin:create

Asks for email and password. The password stays hidden as you type, which is
intentional. Minimum 16 characters.

## G4. Send me the outbound IP

At the end the script prints:

    Outbound IP for the OVH firewall rule:  123.45.67.89

**Copy that and send it to me.** It locks the mail server so only your app can
use it.

---

# PART H: Make the site reachable

The app is running but only the server can see it. Two more steps.

## H1. Point the domain

In your DNS for `azkalmedia.com`, add an A record:

| Type | Name | Value |
|---|---|---|
| A | `email` | your Cloudways server IP |

Then Cloudways: **Applications → azkal-email → Domain Management**, add
`email.azkalmedia.com`.

Then **SSL Certificate → Let's Encrypt**, and turn on **Force HTTPS**.

## H2. Connect Nginx to the app

Cloudways runs Nginx, which does not know about your app yet.

**Tell me when you reach this step** and I will give you the exact config, since
the file location varies between Cloudways plans.

---

# PART I: From now on

## Making a change

On your Mac:

    cd ~/Documents/azkal-email
    git add .
    git commit -m "describe what you changed"
    git push

On the server:

    ssh master@YOUR_SERVER_IP
    cd /home/master/applications/YOUR_FOLDER/public_html
    bash deploy.sh

Pulls, installs, applies database changes, rebuilds, restarts. If the build
fails it refuses to restart, so a mistake cannot take the site down.

## Checking on things

    pm2 status                is everything running
    pm2 logs azkal-worker     watch the sending
    pm2 logs azkal-web        website errors
    pm2 stop azkal-worker     emergency stop, site stays up
    pm2 restart all           after any change

## Leaving the server

    exit

---

# Common problems

**"Permission denied (publickey)"**
Wrong username. Check Master Credentials again.

**"Support for password authentication was removed"**
You used your GitHub password. Use the `ghp_` token.

**"Authentication failed" repeatedly on push**
Your Mac saved the wrong password. Clear it:

    git credential-osxkeychain erase
    host=github.com
    protocol=https

Press Enter twice after the last line, then push again.

**"Please tell me who you are"**
Do step A3.

**"fatal: not a git repository"**
Wrong folder. `cd ~/Documents/azkal-email` first.

**Setup script fails partway**
Send me everything it printed. Re-running is safe; it skips what is done.

**Lost your token**
Make a new one, steps C1 to C4. The old one stops working, which is fine.
