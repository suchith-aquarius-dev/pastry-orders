# Pastry WhatsApp Bot — Complete Guide

WhatsApp Cloud API order management bot for a pastry business — built on
Meta's WhatsApp Flows for the ordering UI, with a Node.js/Express backend
and Postgres for order storage.

This is the single, comprehensive reference for the project: structure,
local setup, full Droplet deployment, and every real-world gotcha hit along
the way (with fixes), so future setups — new Droplet, new developer,
disaster recovery — go faster than the first one did.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Environment Variables Reference](#2-environment-variables-reference)
3. [Local Setup](#3-local-setup)
4. [Domain & DNS](#4-domain--dns)
5. [Provisioning the Droplet](#5-provisioning-the-droplet)
6. [Node.js via nvm](#6-nodejs-via-nvm)
7. [PostgreSQL Setup (Droplet)](#7-postgresql-setup-droplet)
8. [Deploying the App](#8-deploying-the-app)
9. [Nginx + Certbot (HTTPS)](#9-nginx--certbot-https)
10. [Registering the Webhook with Meta](#10-registering-the-webhook-with-meta)
11. [Static vs Dynamic Flow](#11-static-vs-dynamic-flow)
12. [End-to-End Test Checklist](#12-end-to-end-test-checklist)
13. [Fast Diagnosis Reference](#13-fast-diagnosis-reference)
14. [Security Checklist](#14-security-checklist)

---

## 1. Project Structure

```
pastry-orders/
├── src/
│   ├── routes/
│   │   ├── webhook.js          # main webhook: messages, button taps, flow submissions
│   │   └── flowEndpoint.js     # flow data-exchange handler (only for dynamic flows)
│   ├── services/
│   │   ├── whatsapp.js         # send text messages + flow template
│   │   ├── orders.js           # save/read/update orders in Postgres
│   │   ├── notify.js           # Slack kitchen notification
│   │   └── verifySignature.js  # webhook signature verification
│   ├── db/
│   │   ├── index.js            # Postgres connection pool
│   │   └── migrations/
│   │       └── 001_create_orders.sql
│   └── app.js                  # Express app + route mounting
├── flow/
│   └── order-flow.json         # sample 3-screen Flow JSON (static version)
├── keys/                       # RSA keys for dynamic flows (gitignored — create locally)
├── server.js                   # entry point
├── ecosystem.config.js         # PM2 process config
├── deploy.sh                   # simple git-pull + restart deploy script
├── package.json
├── .env.example
└── .gitignore
```

---

## 2. Environment Variables Reference

See `.env.example` for the full template. Where each value actually comes
from, and whether it depends on the webhook being live yet:

| Variable | Where to find it | Depends on webhook being live? |
|---|---|---|
| `PORT` | Your own choice (default 3000) | No |
| `WHATSAPP_TOKEN` | Business Settings → Users → **System Users** → create one → Generate Token → check `whatsapp_business_messaging` + `whatsapp_business_management` → expiration: **Never** | No |
| `WHATSAPP_PHONE_NUMBER_ID` | App Dashboard → WhatsApp → API Setup | No |
| `WHATSAPP_APP_SECRET` | App Dashboard → Settings → Basic → App Secret → Show | No |
| `VERIFY_TOKEN` | Any random string you invent yourself — must match exactly what you type into Meta's Callback URL config | No |
| `ORDER_FLOW_ID` / `ORDER_FLOW_TEMPLATE_NAME` | Set once you've published a Flow + had its template approved | N/A (comes later) |
| `DATABASE_URL` | Your own Postgres connection string (`postgres://user:pass@localhost:5432/dbname`) | No |
| `SLACK_WEBHOOK_URL` | Optional — Slack → Apps → Incoming Webhooks | No |

**Important:** the "temporary access token" shown by default on the API
Setup page expires every 24 hours — that's expected behavior for that
specific token type, unrelated to your webhook's deployment status. Always
generate a **permanent System User token** instead (see table above) for
`WHATSAPP_TOKEN`.

⚠️ **Don't confuse `WHATSAPP_APP_SECRET` with `WHATSAPP_TOKEN`:**
- **App Secret** — short, ~32-character hex string. Used only for HMAC
  webhook signature verification.
- **Access Token** — long string (200+ characters) starting with `EAA...`.
  Used to actually call the Graph API.

Using the App Secret where a token is expected fails with a misleading
error: `"Object with ID '...' does not exist, cannot be loaded due to
missing permissions"` (`error_subcode: 33`) — it's not really a permissions
problem, it's the wrong kind of credential.

🔒 **If either value is ever pasted/shared in plaintext anywhere (chat,
ticket, repo), rotate it immediately:** App Dashboard → Settings → Basic →
App Secret → **Reset**, then update `.env` and restart PM2 (see §8).

---

## 3. Local Setup

```bash
npm install
cp .env.example .env
# fill in .env with your real values
```

### macOS local Postgres notes
If Postgres was installed via the **official `.dmg` from postgresql.org**
(not Homebrew), the binaries live in a non-PATH location:
```bash
ls /Library/PostgreSQL/        # find your version folder, e.g. "16"
echo 'export PATH="/Library/PostgreSQL/16/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```
(If installed via **Postgres.app** instead:
`/Applications/Postgres.app/Contents/Versions/latest/bin`.)

⚠️ **`sudo -u postgres psql` does NOT work on macOS** the way it does on
Linux — it fails with `could not identify current directory: Permission
denied`. This is specific to how the EDB Mac installer sets up the
`postgres` OS user.

**Fix:** connect over TCP instead, using the password set during the
`.dmg` installer wizard (not your Mac login password):
```bash
psql -U postgres -h localhost
```

### Create the database and run the migration
```bash
psql -U pastry_app -d pastry_orders -h localhost -f src/db/migrations/001_create_orders.sql
```
(See §7 below for the full `CREATE DATABASE`/`GRANT` steps if starting from scratch.)

### Run locally
```bash
npm run dev
```

**Note:** Meta cannot call `http://localhost:3000` — inbound webhook testing
genuinely requires a public HTTPS URL. Local runs are useful for testing
outbound sends and DB logic, but full inbound testing needs either the
deployed Droplet or a tool like `ngrok` tunneling to your machine.

---

## 4. Domain & DNS

Add an **A record** at your domain registrar:
```
Type: A
Name: @        (root domain — see §9 for why you can skip "www" entirely)
Value: <Droplet public IP>
TTL: 3600
```

Verify propagation before doing anything else:
```bash
dig yourdomain.com +short
```
Must print your Droplet's IP. Don't proceed to Certbot or Meta webhook
setup until this resolves.

---

## 5. Provisioning the Droplet

Connect to your Droplet:
```bash
ssh root@YOUR_DROPLET_IP
```

---

## 6. Node.js via nvm

**Do not** use `apt install npm` — it installs an old Node version.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
```

⚠️ **nvm isn't available in your current shell right after install.** The
installer only writes lines into `~/.bashrc` for **future** sessions.
Running `nvm install --lts` immediately in the same block fails with
`nvm: command not found`.

**Fix — run as separate steps, and re-source your shell:**
```bash
source ~/.bashrc
# or, if that doesn't pick it up:
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm --version     # confirm it's loaded
nvm install --lts
node -v
npm -v
```

⚠️ **Never pipe/chain install commands together blindly** — if one command
in a piped chain fails partway (e.g. `curl: (23) Failure writing output to
destination`), run each step individually and confirm success before moving on.

---

## 7. PostgreSQL Setup (Droplet)

```bash
sudo apt install postgresql postgresql-contrib -y
```

### Create the database and app user
```bash
sudo -u postgres psql
```
> `sudo -u postgres psql` works out of the box on **Ubuntu** because
> Postgres uses **peer authentication** for local Unix-socket connections —
> no password needed. This is different from `-h localhost`, which forces
> password/TCP auth.

Inside `psql`:
```sql
CREATE DATABASE pastry_orders;
CREATE USER pastry_app WITH PASSWORD 'your_strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE pastry_orders TO pastry_app;
```

⚠️ **"permission denied for schema public" when running the migration.**
As of **Postgres 15+**, the `public` schema no longer auto-grants `CREATE`
privileges to all users.

**Fix — while still connected as `postgres`:**
```sql
\c pastry_orders
GRANT ALL ON SCHEMA public TO pastry_app;
GRANT USAGE, CREATE ON SCHEMA public TO pastry_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pastry_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO pastry_app;
\q
```
The last line ensures **future** tables/migrations automatically get the
right permissions too.

⚠️ **Pasting multiple SQL/meta-commands at once breaks `\c`.** `psql`'s
backslash meta-commands (like `\c dbname`) parse the **entire line** as
positional arguments. If lines get joined during a paste, you'll see:
`invalid integer value "ON" for connection option "port"`.
**Fix:** run one command at a time, especially `\c` and multi-line SQL blocks.

### Run the migration
```bash
psql -U pastry_app -d pastry_orders -h localhost -f src/db/migrations/001_create_orders.sql
```

⚠️ **`psql -U postgres -h localhost` fails with "password authentication
failed."** The `postgres` superuser has **no password set** by default. A
harmless `GSSAPI security context` warning appears first — ignore it, it's
just a fallback negotiation attempt.

**Fix:** use `sudo -u postgres psql` for admin tasks (peer auth). Only your
app's own user (`pastry_app`) needs `-h localhost` + password, since that's
how your Node app connects too.

### Verify
```bash
psql -U pastry_app -d pastry_orders -h localhost -c "\dt"
```

Quick check without typing the password interactively (testing convenience only):
```bash
PGPASSWORD='your_password' psql -U pastry_app -d pastry_orders -h localhost -c "SELECT * FROM orders;"
```
⚠️ Don't leave real production passwords sitting in shell history long-term.

---

## 8. Deploying the App

Clone this repo onto the Droplet:
```bash
git clone https://github.com/suchith-aquarius-dev/pastry-orders.git
cd pastry-orders
npm install
cp .env.example .env   # then edit with real production values
```

Run the DB migration against the Droplet's Postgres instance (§7 above).

Start with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed command to enable start-on-boot
```

⚠️ **PM2 shows app status as "errored" with no obvious reason.** Most
likely cause: `npm install` wasn't (re-)run after cloning, so
`node_modules` was missing/incomplete — the app crashes immediately on
`require('express')` etc.

**Fix:**
```bash
npm install
pm2 restart pastry-webhook
```
**Lesson for future deploys:** always run `npm install` after every
`git pull`, in case `package.json` changed. The included `deploy.sh` already
does this automatically:
```bash
./deploy.sh
```

### Confirming the app is alive at each layer
```bash
pm2 status
pm2 logs pastry-webhook --lines 50 --nostream
curl http://localhost:3000/health        # bypasses Nginx entirely
sudo lsof -i :3000                       # confirms something is bound to the port
```

---

## 9. Nginx + Certbot (HTTPS)

```bash
sudo apt install nginx -y
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

Create `/etc/nginx/sites-available/pastry-webhook`:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # Block access to dotfiles (.env, .git, etc.)
    location ~ /\. {
        deny all;
        return 404;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/pastry-webhook /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
curl http://yourdomain.com/health   # confirm this works BEFORE running Certbot
```

⚠️ **504 Bad Gateway** means Nginx is fine, but your Node app isn't
responding. Check, in order:
```bash
pm2 status
curl http://localhost:3000/health
sudo lsof -i :3000
sudo tail -30 /var/log/nginx/error.log
```
(Same root cause as the PM2 "errored" gotcha in §8, most likely.)

### Get the SSL certificate
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

⚠️ **Certbot fails if you request a `www` subdomain without a matching DNS
record:** `no valid A records found for www.yourdomain.com`.

**Fix:** for a webhook-only server, just skip `www` entirely — don't
request it, and make sure `server_name` in Nginx only lists the root domain.

### Confirm HTTPS + redirect
```bash
curl https://yourdomain.com/health
```
A `301 Moved Permanently` on the plain `http://` version afterward is
**expected and correct** — Certbot auto-configures the HTTP→HTTPS redirect.
Follow it automatically with `curl -L http://yourdomain.com/health` to
confirm the full chain.

### Confirm auto-renewal
```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

**Note:** bots will constantly probe your access logs for `/.env`, `/.git`,
etc. within hours of going live — this is normal internet background noise.
The dotfile-blocking rule above handles it; confirm `curl` on `/.env`
returns 404.

---

## 10. Registering the Webhook with Meta

**Meta App Dashboard → WhatsApp → Configuration:**
- Callback URL: `https://yourdomain.com/webhook`
- Verify token: same value as `VERIFY_TOKEN` in `.env`

Manually test the verification handshake before trusting the UI:
```bash
curl "https://yourdomain.com/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test12345"
```
Should return exactly `test12345` as plain text.

Then, in the same Configuration page under **Webhook fields**, toggle
**`messages`** to ON. Verifying the callback URL and subscribing to the
`messages` field are two separate steps — easy to do the first and forget
the second.

### ⚠️ The big one: webhook verifies fine, `messages` field is ON, test number is allowlisted — but NO events ever arrive

Everything can *look* correctly configured — webhook verified, `messages`
field subscribed, test recipient number added and OTP-verified (WhatsApp →
API Setup → "To"), Nginx/PM2/DB all confirmed working, and even Meta's own
"Check web testhooks" log showing a real payload with actual message
content (misleadingly — this shows Meta *attempted* delivery, not that it
reached your endpoint) — and yet your Nginx access/error logs show **zero
trace** of any `/webhook` POST request.

**Root cause:** verifying the Callback URL and toggling the `messages`
field only tells Meta *"this app can receive webhooks and wants this
field."* It does **not** automatically subscribe your specific WhatsApp
Business Account (WABA) to send its events to this app. That's a separate,
explicit step — normally handled invisibly by Meta's "Embedded Signup" flow,
but **required manually** when setting up Cloud API by hand.

**Fix — subscribe the app to the WABA directly via the Graph API:**
```bash
curl -X POST "https://graph.facebook.com/v20.0/YOUR_WABA_ID/subscribed_apps" -H "Authorization: Bearer YOUR_WHATSAPP_TOKEN"
```
- `YOUR_WABA_ID` — found as `entry[0].id` in any webhook test payload, or in
  WhatsApp Manager account details
- `YOUR_WHATSAPP_TOKEN` — your permanent System User access token (the long
  `EAA...` string — **not** your App Secret, see §2)

Expected response:
```json
{"success": true}
```

Verify it stuck:
```bash
curl -X GET "https://graph.facebook.com/v20.0/YOUR_WABA_ID/subscribed_apps" -H "Authorization: Bearer YOUR_WHATSAPP_TOKEN"
```

**If setting up a fresh WABA/app pair in the future without Embedded
Signup, do this `subscribed_apps` call right after registering the
webhook** — don't wait for delivery to mysteriously not work first.

### Test recipient allowlisting (dev/test mode)
If your WABA is still using Meta's auto-provisioned test number (not a
verified production number), only phone numbers explicitly added as
recipients can message it:
**WhatsApp → API Setup → "To" section → Manage phone number list** → add
your number → verify via OTP.

---

## 11. Static vs Dynamic Flow

This starter ships with a **static Flow** (`flow/order-flow.json`) — no
live data calls needed. Submissions arrive as a plain `nfm_reply` on the
regular `/webhook` route, handled in `src/routes/webhook.js`. This is the
fastest way to launch.

If you later need live stock checks or date-availability blocking, upgrade
to a **dynamic Flow**:

1. Generate an RSA keypair:
   ```bash
   mkdir -p keys
   openssl genrsa -out keys/private.pem 2048
   openssl rsa -in keys/private.pem -pubout -out keys/public.pem
   ```
2. Upload `keys/public.pem`'s contents to Meta via the Flow's Encryption
   Keys step in WhatsApp Manager.
3. Point the Flow's endpoint URI at `https://yourdomain.com/flow-data-endpoint`.
4. `src/routes/flowEndpoint.js` already implements Meta's encryption scheme
   (RSA-OAEP wrapped AES-128-GCM) — fill in your real logic (stock checks,
   pricing, etc.) inside the `data_exchange` branch.

**Never commit `keys/private.pem` to git** — it's covered by `.gitignore`,
but double-check before your first push.

---

## 12. End-to-End Test Checklist

Run these in order after any fresh deploy:

```bash
# 1. App + DB alive
curl https://yourdomain.com/health
psql -U pastry_app -d pastry_orders -h localhost -c "SELECT * FROM orders;"

# 2. Outbound send works (confirms token + phone number ID are correct)
node test-send.js     # small throwaway script calling sendTextMessage()

# 3. Inbound real message (confirms full pipeline incl. subscribed_apps)
#    -> send "hi" from an allowlisted test number to your WhatsApp test number
pm2 logs pastry-webhook --lines 0

# 4. Simulated signed Flow submission (tests DB save + confirmation + kitchen notify
#    without waiting on the real Flow being published/approved)
node generate-signature.js
curl -X POST https://yourdomain.com/webhook -H "Content-Type: application/json" -H "X-Hub-Signature-256: <generated>" -d '<payload>'

# 5. Signature rejection (confirms security is working)
#    same as #4 but with a corrupted/missing signature header -> should be rejected

# 6. GET verification handshake (usually already confirmed via Meta's UI)
curl "https://yourdomain.com/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
```

---

## 13. Fast Diagnosis Reference

| Symptom | Most likely cause | Check |
|---|---|---|
| `curl` to domain hangs/fails entirely | DNS not propagated | `dig yourdomain.com +short` |
| 504 Bad Gateway | Node app not running/crashed | `pm2 status`, `pm2 logs`, `curl localhost:3000/health` |
| PM2 shows "errored" | Missing `node_modules`, bad `.env` | `npm install`, check `.env` values |
| Certbot fails on `www` | Missing DNS A record for `www` | Drop `-d www...` from the certbot command |
| Webhook won't verify in Meta dashboard | Wrong `VERIFY_TOKEN`, stale PM2 process, wrong URL | Manual `curl` test of the GET handshake (§10) |
| Verified, but no messages ever arrive | **Missing `subscribed_apps` call** | `curl .../subscribed_apps` GET to check, POST to fix |
| Test number can't message the bot | Number not in "To" allowlist (dev mode) | WhatsApp → API Setup → Manage phone number list |
| `psql: password authentication failed` | Wrong password, or `-h localhost` with `postgres` user (no password set) | Use `sudo -u postgres psql` for admin tasks instead |
| `permission denied for schema public` | Postgres 15+ default privilege change | Run the `GRANT ... ON SCHEMA public` block (§7) |

---

## 14. Security Checklist

- [ ] Confirm `WHATSAPP_APP_SECRET` and `WHATSAPP_TOKEN` have never been
      committed to git (`.env` is gitignored — double check with `git status`)
- [ ] If either value was ever pasted in plaintext anywhere outside your own
      terminal/`.env` file, rotate it immediately (App Dashboard → Settings
      → Basic → Reset for the secret; regenerate a new System User token
      for the access token)
- [ ] Nginx dotfile-blocking rule in place and tested (`curl` on `/.env`
      should return 404)
- [ ] Postgres port 5432 is **not** exposed publicly — confirm with
      `sudo ufw status` that only 80/443/22 are open
- [ ] `keys/private.pem` (if/when you set up a dynamic Flow) is gitignored
      and never committed

---

## Other Notes

- `/health` returns a simple 200 JSON response — useful to confirm Nginx/PM2
  are correctly wired up.
- Kitchen notifications go to Slack via `SLACK_WEBHOOK_URL` if set,
  otherwise they just log to the console — handy for testing without Slack.
- Webhook signature verification (`verifySignature.js`) fails closed if
  `WHATSAPP_APP_SECRET` isn't set — make sure it's filled in before going live.
