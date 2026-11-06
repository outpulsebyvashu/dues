# Dues

Accounts-receivable follow-up: reminds clients about unpaid invoices until they pay. An Outpulse.App product.

## Static only (no server) until the owner says otherwise
- Plain files in `public/`. `public/store.js` is the whole "backend": it answers `DuesAPI(method, '/api/…', body)` from data
  in localStorage. `app.js` only talks to `DuesAPI`. Do not add fetch calls to a server, Workers, or a database.
- The server version (Cloudflare Worker + D1) lives on the `server-v1` branch for when the owner moves back to it.
- Keep every path relative (the Android app serves `public/` from `https://appassets.androidplatform.net/assets/`).
- The pay page gets its data from the link (`pay.html#<base64url JSON>`); keep private client data (phone, email) out of it.

## The design is Manifold's. Do not invent a new look.
Use the tokens and components in `public/dues.css`: lime #b7f36b, forest #0f3b1f, Outfit, 28px cards, pill buttons, `.bento`,
`.c-balance`, `.c-lime`, `.seg`, `.tabs`, `.sec`, `.row`, `.chip`, bottom `.sheet`. Light is default, `body.dark` is dark.
Check every screen at 390x844 in both themes.

## Rules
- India time (Asia/Kolkata) for "today" and due dates. Money in rupees with en-IN grouping (₹1,23,456).
- A failed request must change nothing (store.js reloads from storage on any error).
- `npm test` must pass; add a test in `tests/store.test.mjs` for every new request.
