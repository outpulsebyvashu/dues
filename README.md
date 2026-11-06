# Dues
### Get paid without the awkward calls

Dues follows up on unpaid invoices until they are paid. It lines up WhatsApp or email reminders before and after the due date,
gives every invoice a way to pay (UPI in one tap, or a Razorpay/PhonePe link you paste), pauses when a client promises to pay,
and stops as soon as the money comes in.

**Static version:** no server of its own, no Workers. Plain HTML/CSS/JS files. Your data is encrypted on the phone and locked with
a PIN. Optionally, sign in with an online account (your own free Supabase project) to keep a synced copy and use more than one
phone. The server version (Cloudflare Worker + D1) is kept on the `server-v1` branch for later.

## Security
| | |
|---|---|
| PIN lock | 6-digit PIN on every open. Locks after 1 minute in the background or 10 minutes idle. 5 wrong tries, then waits of 30 s → 15 min. |
| Encryption on the phone | AES-256-GCM. The data key is locked by your PIN (PBKDF2-SHA256, 310,000 rounds). Only ciphertext is ever stored, including the sign-in token. |
| Fingerprint (Android) | The data key is kept under an Android Keystore key that only opens after a strong fingerprint/face check. Re-enrolling fingerprints turns it off. |
| Online accounts | Supabase Auth (email + password, email confirmation, password reset). One row per account, row-level security: an account can only reach its own row; signed-out visitors reach nothing. |
| Sync | Versioned saves: two phones never overwrite each other; changes merge record by record, deletions stay deleted. |
| Pages | Content-Security-Policy (no inline scripts, network only to Supabase), no referrer. Android blocks screenshots and the recent-apps preview. |
| Forgot PIN | Sign in again and the data comes back from your account. Without an account, nobody can open the data (back it up). |

Design: the Manifold design language (lime and forest, Outfit, rounded cards, pill buttons, bento grid, light and dark, mobile first).

---

## Use it

- **Android app:** install `Dues.apk` (from Releases). The app has the Dues pages built in, so it works offline and needs no website.
- **Browser:** open `public/app.html` from any static host (Cloudflare Pages, Netlify Drop, GitHub Pages), then Add to Home screen.

Without an account, data on the phone app and data in a browser are separate: move it with **Settings → Back up** and **Restore a backup**.
With an account, sign in on both and they stay in sync.

## What's inside

| Screen | What it does |
|---|---|
| Overview | Outstanding and overdue, collected this month, collection rate, ageing (not due, 1–30, 31–60, 61–90, 90+ days), today's reminders, missed promises, 4-week forecast, recent activity |
| Invoices | Open, overdue, promised, paid, void; new invoice in one sheet; CSV import (Excel, Tally, Zoho, Google Sheets); full or part payments; promise to pay; pay link; edit; void; history |
| Follow-ups | Today's reminders with the message ready: one tap opens WhatsApp or your email app; copy; skip |
| Clients | What each client owes, how late, and how many days they usually take to pay |
| Settings | Account and security (lock now, change PIN, fingerprint, sign in/out, sync, change password, delete account), your name and business, UPI ID, WhatsApp number, pay page website, reminder schedule and messages, back up / restore / export CSV / erase, theme |
| Pay page `pay.html#…` | Client page with amount, Pay with UPI app, UPI ID, online payment link, "I've paid" (messages you on WhatsApp) |

### Reminders
- The schedule is a list of steps in days from the due date (default −3, 0, +3, +7, +15). Each invoice gets one message per step.
  An old invoice that is imported gets only the newest step, not every missed one.
- Dues works out who to remind each time you open it. WhatsApp and email open with the message ready; you tap send.
- A promise to pay pauses reminders until that date. If it passes unpaid, Dues flags it and starts again.
- Recording full payment closes the invoice and cancels its reminders.

### Pay page
With no server, the invoice details (business, number, amount, due date, UPI ID, payment link, your phone) are put inside the link
itself, after the `#`. To give clients a pay page, upload `public/` to a free static host and put its address in Settings →
Pay page website. Without a website, reminders simply include your UPI ID and any payment link you added.

---

## Turn on online accounts (optional, free)
1. supabase.com → New project (region: Mumbai).
2. SQL Editor → New query → paste `supabase/schema.sql` → Run.
3. Authentication → URL Configuration: Site URL = your Dues site; add `https://your-site/reset.html` to Redirect URLs.
4. Project Settings → API: copy the Project URL and the **anon** key into `public/config.js` (or enter them in the app:
   start screen → Set up online accounts). Never use the service_role key.
5. Recommended: Authentication → Providers → Email: keep "Confirm email" on; Authentication → Policies: minimum password length 8.

Without these steps Dues works fully on the phone; only sign-in and sync are hidden.

## Put it on a free static host (optional, for pay links)
- **Cloudflare Pages:** dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets → upload the `public` folder (or `dues-static.zip`).
- **Netlify Drop:** app.netlify.com/drop → drop the `public` folder.

No build step, no settings, no secrets.

## Develop and test
```bash
npm test          # store, vault and sign-in/sync tests (Node 20+, no installs; Supabase is faked)
npm run serve     # http://localhost:8080/app.html
```
The Android app (`android/`) is built by GitHub Actions on every push that changes `public/` or `android/`, and published as a release.
`dues-sideload.jks` is a sideload key in the repo so each build can update the last one; make a private key before publishing to Google Play.
