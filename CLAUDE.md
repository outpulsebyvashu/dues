# Dues

Accounts-receivable follow-up: reminds clients about unpaid invoices until they pay. An Outpulse.App product.

## Static files, no server of our own, until the owner says otherwise
- Plain files in `public/`. `public/store.js` is the whole "backend": it answers `DuesAPI(method, '/api/…', body)` from data
  in memory. `app.js` only talks to `DuesAPI`. Do not add Workers or another server.
- The only network calls are to Supabase (Auth + one `dues_data` row per account), in `public/cloud.js`, plain fetch, no SDK.
  Schema and row-level security are in `supabase/schema.sql`. The anon key may ship in `config.js`; the service_role key never.

## Security
- `gate.js` runs first: sign in / create account / this phone only, then a 6-digit PIN. Nothing opens until it is unlocked.
- `vault.js`: data, sign-in tokens and settings are stored only as AES-256-GCM ciphertext (`dues.vault.v1`); the data key is
  wrapped by PBKDF2-SHA256 (310,000 rounds) of the PIN. Never write plaintext data to localStorage (the old `dues.data.v1`
  is migrated into the vault and deleted).
- Auto-lock after 1 minute in the background or 10 minutes idle. Wrong PINs: 5 tries, then waits up to 15 minutes.
- Android: FLAG_SECURE; fingerprint unlock keeps the data key under a Keystore key that needs BIOMETRIC_STRONG.
- Pages keep their Content-Security-Policy meta tag: no inline scripts, `connect-src` only self and `*.supabase.co`.
- The server version (Cloudflare Worker + D1) lives on the `server-v1` branch for when the owner moves back to it.
- Keep every path relative (the Android app serves `public/` from `https://appassets.androidplatform.net/assets/`).
- The pay page gets its data from the link (`pay.html#<base64url JSON>`); keep private client data (phone, email) out of it.

## The design is Manifold's. Do not invent a new look.
Use the tokens and components in `public/dues.css`: lime #b7f36b, forest #0f3b1f, Outfit, 28px cards, pill buttons, `.bento`,
`.c-balance`, `.c-lime`, `.seg`, `.tabs`, `.sec`, `.row`, `.chip`, bottom `.sheet`. Light is default, `body.dark` is dark.
Check every screen at 390x844 in both themes.

## Rules
- India time (Asia/Kolkata) for "today" and due dates. Money in rupees with en-IN grouping (₹1,23,456).
- A failed request must change nothing (store.js puts back the last saved copy on any error, including a failed save).
- Sync merges by record id (newest `updated_at` wins, ids in `deleted[]` stay deleted, erase/restore set `reset_at` and win whole).
  Give new records an id and timestamps, and push deleted ids to `deleted`.
- `npm test` must pass; add a test in `tests/store.test.mjs` for every new request and in `tests/security.test.mjs` for
  vault, sign-in or sync changes.
