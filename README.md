# Dues
### Get paid without the awkward calls

Dues follows up on unpaid invoices until they are paid. It reminds clients on WhatsApp or email before and after the due date, gives every invoice a pay page (UPI in one tap, Razorpay optional), pauses when a client promises to pay, and stops as soon as the money comes in.

Same design language as Manifold: lime and forest, Outfit, rounded cards, pill buttons, bento grid, light and dark, mobile first.

---

## What's inside

| Screen | What it does |
|---|---|
| Overview | Outstanding and overdue, collected this month, collection rate, ageing (not due, 1–30, 31–60, 61–90, 90+ days), today's reminders, missed promises, 4-week forecast, recent activity |
| Invoices | Open, overdue, promised, paid and void; new invoice in one sheet; CSV import (Excel, Tally, Zoho, Google Sheets); record full or part payments; promise to pay; pay link; edit; void; full history |
| Follow-ups | Today's reminders with the message ready: one tap opens WhatsApp or email; copy; skip. Email reminders can send themselves |
| Clients | What each client owes, how late, and how many days they usually take to pay |
| Settings | Business name, UPI ID, reminder schedule (days before or after the due date, with a gentle, due, firm or final message), message templates, connections, account, theme |
| Pay page `/p/<code>` | Public page for the client: amount, Pay with UPI app, UPI ID, Razorpay link, "I've paid" with a UTR |

### How reminders work
- The schedule is a list of steps in days from the due date (default −3, 0, +3, +7, +15).
- Each invoice gets **one** message per step. If an old invoice is imported, only the newest step is sent, not every missed one.
- A promise to pay pauses reminders until the promised day. If the day passes unpaid, Dues flags it and starts again.
- Paying in full (recorded, or through Razorpay) closes the invoice and cancels its pending reminders.
- Every morning at 8:00 India time a scheduled job plans reminders for every account and sends the email ones.

---

## Deploy (Cloudflare Workers + D1)

Everything runs on one Worker with static assets and a D1 database, like Manifold.

```bash
npm install
npx wrangler login
npx wrangler secret put SESSION_SECRET      # a long random string (40+ characters)
npm run deploy
```

The D1 database `dues` is already in `wrangler.jsonc`. Tables are created on the first request (and by `npm run db:migrate`).

Or connect this repository in the Cloudflare dashboard (Workers & Pages → the `dues` Worker → Settings → Builds → Connect to Git), the same way Manifold deploys.

### Optional secrets
| Secret | Turns on |
|---|---|
| `RESEND_API_KEY` + `EMAIL_FROM` (e.g. `Dues <dues@outpulse.company>`) | Email reminders that send themselves |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` | A card / netbanking payment link on every invoice |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay closes the invoice when the client pays (webhook URL: `/api/razorpay/webhook`, event `payment_link.paid`) |
| `SIGNUP` = `closed` (variable) | Stops new accounts being created |

WhatsApp reminders open WhatsApp with the message ready; you tap send. (Sending without a tap needs the WhatsApp Business API.)

---

## Android app

`android/` is a native Kotlin shell around the live site, like the Niro apps: WhatsApp, UPI apps, the dialer and email open in their own apps, the back button closes sheets first, and there is an offline screen.
Every push to `main` that changes `android/` builds a signed APK in GitHub Actions and publishes it as a release (`Dues.apk`).

`dues-sideload.jks` is a sideload key kept in the repo so every build can update the previous one. Before publishing to Google Play, make a new private upload key and keep it out of the repo.

You can also install the web app directly: open it in Chrome → menu → Add to Home screen.

---

## Develop and test

```bash
npm test                 # about 25 checks against SQLite (Node 22.7+, no installs)
npm run schema           # after changing migrations/: regenerates src/schema.mjs
node scripts/bundle.mjs  # one-file build (dist/worker.mjs) with the static files inside, for uploading without wrangler
```

## Security
- Passwords: PBKDF2-SHA256 (100,000 rounds) with a random salt; sign-in is limited to 8 tries per 15 minutes.
- Sessions: signed, HttpOnly, Secure, SameSite cookie (`__Host-dues`), 30 days.
- Every query is limited to the signed-in account; another account's invoice answers 404.
- Cross-site writes are refused; a strict Content-Security-Policy is sent on every page.
- The pay page shows only the amount, invoice number, business name and payment details: no client phone or email.
