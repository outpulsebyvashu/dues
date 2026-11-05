# Dues

Accounts-receivable follow-up: reminds clients about unpaid invoices until they pay. An Outpulse.App product.
Stack: one Cloudflare Worker (`src/worker.mjs`) + D1 (`migrations/`) + static files (`public/`), Android shell in `android/`.

## The design is Manifold's. Do not invent a new look.
Use the tokens and components in `public/dues.css` (copied from Manifold's dashboard): lime #b7f36b, forest #0f3b1f, Outfit,
28px cards, pill buttons, `.bento`, `.c-balance`, `.c-lime`, `.seg`, `.tabs`, `.sec`, `.row`, `.chip`, bottom `.sheet`.
Light is the default, `body.dark` is dark. Check every screen at 390x844 in both themes.

## Rules
- Every query filters by the signed-in `user_id`. Add a test for each new endpoint, including that another account gets 404.
- India time (Asia/Kolkata) for "today", due dates and the daily job.
- Money in rupees with en-IN grouping (₹1,23,456).
- After changing `migrations/`, run `npm run schema` (the Worker creates tables from `src/schema.mjs` on first use).
- `npm test` must pass.
