# Pastry WhatsApp Bot

WhatsApp Cloud API order management bot for a pastry business — built on
Meta's WhatsApp Flows for the ordering UI, with a Node.js/Express backend
and Postgres for order storage.

## Project structure

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

## Local setup

```bash
npm install
cp .env.example .env
# fill in .env with your real values
```

Create the database and run the migration:
```bash
psql -U pastry_app -d pastry_orders -h localhost -f src/db/migrations/001_create_orders.sql
```

Run locally:
```bash
npm run dev
```

## Environment variables

See `.env.example`. Key ones:
- `WHATSAPP_TOKEN` — permanent system-user access token from Meta
- `WHATSAPP_PHONE_NUMBER_ID` — from WhatsApp Manager
- `WHATSAPP_APP_SECRET` — from your Meta App's Basic Settings, used to verify webhook signatures
- `VERIFY_TOKEN` — any random string you choose; must match what you enter in the Meta App Dashboard webhook setup
- `ORDER_FLOW_ID` / `ORDER_FLOW_TEMPLATE_NAME` — set once you've published your Flow and had the template approved
- `DATABASE_URL` — your local Postgres connection string

## Deploying to a DigitalOcean Droplet

1. Clone this repo onto the Droplet:
   ```bash
   git clone git@github.com:yourusername/pastry-whatsapp-bot.git
   cd pastry-whatsapp-bot
   npm install
   cp .env.example .env   # then edit with real production values
   ```

2. Run the DB migration against your Droplet's Postgres instance.

3. Start with PM2:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

4. Put Nginx + Certbot in front for HTTPS (Meta requires HTTPS callback URLs).

5. In Meta App Dashboard → WhatsApp → Configuration, set:
   - Callback URL: `https://yourdomain.com/webhook`
   - Verify token: same value as `VERIFY_TOKEN` in `.env`

6. For future updates, just run:
   ```bash
   ./deploy.sh
   ```

## Static vs dynamic Flow

This starter ships with a **static Flow** (`flow/order-flow.json`) — no live
data calls needed. Submissions arrive as a plain `nfm_reply` on the regular
`/webhook` route, handled in `src/routes/webhook.js`. This is the fastest
way to launch.

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

**Never commit `keys/private.pem` to git** — it's already covered by
`.gitignore`, but double-check before your first push.

## Notes

- `/health` returns a simple 200 JSON response — useful to confirm Nginx/PM2
  are correctly wired up.
- Kitchen notifications go to Slack via `SLACK_WEBHOOK_URL` if set,
  otherwise they just log to the console — handy for testing without Slack.
- Webhook signature verification (`verifySignature.js`) fails closed if
  `WHATSAPP_APP_SECRET` isn't set — make sure it's filled in before going live.
