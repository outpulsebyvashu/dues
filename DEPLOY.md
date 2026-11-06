# Deploy Dues (no GitHub needed)

The Cloudflare side is already set up: the `dues` Worker, its D1 database (`dues`), the SESSION_SECRET secret and the
address https://dues.business-outpulsestudio.workers.dev. You only need to put the code on it.

## Way 1: from your laptop (recommended)
Needs Node.js 20+ (`sudo apt install nodejs npm`, or nvm).

```bash
unzip dues.zip && cd dues
npm install
npx wrangler login          # opens the browser: sign in to Cloudflare and allow
npx wrangler deploy
```
Then open https://dues.business-outpulsestudio.workers.dev and create your account.
Next time you change something, run `npx wrangler deploy` again.

## Way 2: paste one file in the Cloudflare dashboard (phone or laptop)
`dist/worker.mjs` is the whole app (server + all pages) in one file.

1. dash.cloudflare.com → Workers & Pages → **dues** → **Edit code** (top right).
2. Open `worker.mjs` in the editor, select everything, delete it.
3. Paste the full contents of `dist/worker.mjs` from this zip.
4. Tap **Deploy**.
5. Settings → Variables and Secrets → Add variable: `PUBLIC_URL` = `https://dues.business-outpulsestudio.workers.dev` (used in reminder links sent by the morning job).
6. Settings → Trigger events → Add → Cron: `30 2 * * *` (8:00 am India time, plans reminders every morning).

The database binding (`DB`) and `SESSION_SECRET` are already on the Worker, so nothing else is needed.

## After it is live
- Android app: install `Dues.apk` (it opens the live site).
- Optional: add secrets `RESEND_API_KEY` + `EMAIL_FROM` for automatic emails, and Razorpay keys for card payments (see README).
