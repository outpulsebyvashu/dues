# Dues
### Get paid without the awkward calls

Dues follows up on unpaid invoices until they are paid. It lines up WhatsApp or email reminders before and after the due date,
gives every invoice a way to pay (UPI in one tap, or a Razorpay/PhonePe link you paste), pauses when a client promises to pay,
and stops as soon as the money comes in.

**Static version:** no server, no account, no Workers. Plain HTML/CSS/JS files. Your data is saved on the device (browser storage)
and you can back it up to a file. The server version (Cloudflare Worker + D1) is kept on the `server-v1` branch for later.

Design: the Manifold design language (lime and forest, Outfit, rounded cards, pill buttons, bento grid, light and dark, mobile first).

---

## Use it

- **Android app:** install `Dues.apk` (from Releases). The app has the Dues pages built in, so it works offline and needs no website.
- **Browser:** open `public/app.html` from any static host (Cloudflare Pages, Netlify Drop, GitHub Pages), then Add to Home screen.

Data on the phone app and data in a browser are separate. Move it with **Settings → Back up** and **Restore a backup**.

## What's inside

| Screen | What it does |
|---|---|
| Overview | Outstanding and overdue, collected this month, collection rate, ageing (not due, 1–30, 31–60, 61–90, 90+ days), today's reminders, missed promises, 4-week forecast, recent activity |
| Invoices | Open, overdue, promised, paid, void; new invoice in one sheet; CSV import (Excel, Tally, Zoho, Google Sheets); full or part payments; promise to pay; pay link; edit; void; history |
| Follow-ups | Today's reminders with the message ready: one tap opens WhatsApp or your email app; copy; skip |
| Clients | What each client owes, how late, and how many days they usually take to pay |
| Settings | Your name and business, UPI ID, WhatsApp number, pay page website, reminder schedule and messages, back up / restore / export CSV / erase, theme |
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

## Put it on a free static host (optional, for pay links)
- **Cloudflare Pages:** dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets → upload the `public` folder (or `dues-static.zip`).
- **Netlify Drop:** app.netlify.com/drop → drop the `public` folder.

No build step, no settings, no secrets.

## Develop and test
```bash
npm test          # on-device store tests (Node 20+, no installs)
npm run serve     # http://localhost:8080/app.html
```
The Android app (`android/`) is built by GitHub Actions on every push that changes `public/` or `android/`, and published as a release.
`dues-sideload.jks` is a sideload key in the repo so each build can update the last one; make a private key before publishing to Google Play.
