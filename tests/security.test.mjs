// Tests the vault (public/vault.js) and online accounts + sync (public/cloud.js) in Node 20+, no installs.
// Supabase is replaced by a small fake that behaves like its REST API (auth, row-level security, version filter).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
const load = (f) => new Function(readFileSync(new URL('../public/' + f, import.meta.url), 'utf8'))();
load('store.js'); load('vault.js'); load('cloud.js');
const V = globalThis.DuesVault, C = globalThis.DuesCloud, api = globalThis.DuesAPI;
const step = (n) => console.log('ok -', n);
const rejects = async (p, code) => { try { await p; assert.fail('expected ' + code); } catch (e) { assert.equal(e.code ?? e.status, code, e.message); } };

/* ───── vault ───── */
assert.equal(V.exists(), false);
assert.equal(V.pinOk('12345'), false); assert.equal(V.pinOk('123456'), true); assert.equal(V.pinOk('long passphrase'), true);
await rejects(V.create('123', {}), 'weak');
const secret = { db: { v: 1, clients: [{ id: 'c1', name: 'Ravi Kumar', phone: '+919811122233' }] }, session: { refresh_token: 'rt-secret' } };
await V.create('482913', secret);
const stored = mem.get('dues.vault.v1');
assert.ok(V.exists() && V.isUnlocked());
assert.ok(!/Ravi|9811122233|rt-secret/.test(stored), 'only ciphertext is stored');
assert.equal(JSON.parse(stored).kdf.iter, 310000); step('vault stores only ciphertext');

V.lock(); assert.equal(V.isUnlocked(), false);
await rejects(V.save({}), 'locked');
assert.deepEqual(await V.unlock('482913'), secret); step('unlock with the right PIN');

V.lock();
for (let i = 1; i <= 4; i++) await rejects(V.unlock('000000'), 'wrong');
await rejects(V.unlock('000000'), 'wrong');            // 5th: now a 30 s wait
await rejects(V.unlock('482913'), 'wait');             // even the right PIN must wait
const r = JSON.parse(mem.get('dues.vault.v1')); r.fails.until = Date.now() - 1; mem.set('dues.vault.v1', JSON.stringify(r));
assert.deepEqual(await V.unlock('482913'), secret);
assert.equal(JSON.parse(mem.get('dues.vault.v1')).fails.n, 0); step('wrong PINs are throttled, and the count resets');

await V.save({ db: { v: 1, n: 2 } });
const raw = await V.rawKey();
await rejects(V.changePin('111111', '654321'), 'wrong');
const r2 = JSON.parse(mem.get('dues.vault.v1')); r2.fails = { n: 0, until: 0 }; mem.set('dues.vault.v1', JSON.stringify(r2));
await V.changePin('482913', '654321');
V.lock(); await rejects(V.unlock('482913'), 'wrong');
assert.deepEqual(await V.unlock('654321'), { db: { v: 1, n: 2 } }); step('change PIN keeps the data');

V.lock(); assert.deepEqual(await V.unlockWithKey(raw), { db: { v: 1, n: 2 } });
V.lock(); await rejects(V.unlockWithKey(Buffer.alloc(32, 7).toString('base64')), 'bio'); step('fingerprint key unlocks; a wrong key does not');

const tampered = JSON.parse(mem.get('dues.vault.v1')); tampered.data.ct = tampered.data.ct.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')); mem.set('dues.vault.v1', JSON.stringify(tampered));
await rejects(V.unlockWithKey(raw), 'bio'); step('tampered data is refused');
V.wipe(); assert.equal(V.exists(), false); assert.equal(mem.has('dues.vault.v1'), false); step('wipe');

/* ───── store persistence hook: a failed save changes nothing ───── */
let saved = null, failNext = false;
api.attach(api.blank(), (snap) => { if (failNext) { failNext = false; throw Object.assign(new Error('disk full'), { status: 507 }); } saved = snap; });
await api('PATCH', '/api/me', { name: 'Vashudev' });
assert.equal(JSON.parse(saved).me.name, 'Vashudev');
failNext = true;
await rejects(api('PATCH', '/api/me', { name: 'Someone Else' }), 507);
assert.equal((await api('GET', '/api/me')).user.name, 'Vashudev');
api.detach(); await rejects(api('GET', '/api/me'), 423); step('store saves through the vault hook; failed saves roll back; locked refuses');

/* ───── fake Supabase ───── */
const SB = 'https://abcdproject.supabase.co', ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
const users = new Map(), tokens = new Map(), refresh = new Map(), rows = new Map();
let n = 0, confirmEmails = false;
const json = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function issue(u) { const a = 'at' + ++n, rt = 'rt' + n; tokens.set(a, u.id); refresh.set(rt, u.id); return { access_token: a, refresh_token: rt, expires_in: 3600, user: { id: u.id, email: u.email } }; }
globalThis.fetch = async (url, o) => {
  const u = new URL(url), h = o.headers || {}, body = o.body ? JSON.parse(o.body) : null;
  assert.equal(h.apikey, ANON, 'anon key sent');
  const who = (h.Authorization || '').startsWith('Bearer ') ? tokens.get(h.Authorization.slice(7)) : null;
  const p = u.pathname, q = u.searchParams;
  if (p === '/auth/v1/signup') {
    if ([...users.values()].some((x) => x.email === body.email)) return json(422, { msg: 'User already registered' });
    const user = { id: 'u' + ++n, email: body.email, password: body.password, confirmed: !confirmEmails }; users.set(user.id, user);
    return confirmEmails ? json(200, { id: user.id, email: user.email }) : json(200, issue(user));
  }
  if (p === '/auth/v1/token' && q.get('grant_type') === 'password') {
    const user = [...users.values()].find((x) => x.email === body.email && x.password === body.password);
    if (!user) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    return json(200, issue(user));
  }
  if (p === '/auth/v1/token' && q.get('grant_type') === 'refresh_token') {
    const id = refresh.get(body.refresh_token); if (!id) return json(400, { error_description: 'Invalid Refresh Token' });
    refresh.delete(body.refresh_token); return json(200, issue(users.get(id)));
  }
  if (p === '/auth/v1/logout') { for (const [k, v] of tokens) if (v === who) tokens.delete(k); return json(204); }
  if (p === '/auth/v1/recover') return json(200, {});
  if (p === '/auth/v1/user' && o.method === 'PUT') { if (!who) return json(401, { msg: 'JWT expired' }); users.get(who).password = body.password; return json(200, {}); }
  if (p === '/rest/v1/dues_data') {
    if (!who) return json(401, { message: 'JWT expired' });          // anon role has no access at all
    const row = rows.get(who);                                       // row-level security: only your own row
    if (o.method === 'GET') return json(200, row ? [row] : []);
    if (o.method === 'POST') { if (row) return json(409, { message: 'duplicate key' }); const nr = { data: body.data, version: body.version, updated_at: new Date().toISOString() }; rows.set(who, nr); return json(201, [nr]); }
    if (o.method === 'PATCH') {
      const want = Number((q.get('version') || '').replace('eq.', ''));
      if (!row || row.version !== want) return json(200, []);
      Object.assign(row, body, { updated_at: new Date().toISOString() }); return json(200, [row]);
    }
  }
  return json(404, { message: 'not found ' + p });
};

/* ───── accounts ───── */
assert.equal(C.configured(), false);
await rejects(C.signIn('a@b.co', 'x'), 'nocfg');
assert.throws(() => C.setConfig('https://evil.example.com', ANON), /project URL/);
assert.throws(() => C.setConfig(SB, 'service_role_secret'), /anon/);
C.setConfig(SB + '/', ANON); assert.equal(C.config().supabaseUrl, SB);
let lastSession; C.onSession((s) => { lastSession = s; });
await rejects(C.signUp('not-an-email', 'abc12345'), 400);
await rejects(C.signUp('me@dues.in', 'short'), 400);
assert.deepEqual(await C.signUp('Me@Dues.in', 'goodpass123', 'Vashudev'), { signedIn: true });
assert.equal(C.user().email, 'me@dues.in'); assert.equal(lastSession.refresh_token, 'rt' + n);
await rejects(C.signUp('me@dues.in', 'goodpass123'), 422);
try { await C.signUp('me@dues.in', 'goodpass123'); } catch (e) { assert.match(e.message, /already has an account/); }
await C.signOut(); assert.equal(C.signedIn(), false); assert.equal(lastSession, null);
try { await C.signIn('me@dues.in', 'wrongpass1'); assert.fail(); } catch (e) { assert.equal(e.message, 'Wrong email or password.'); }
await C.signIn('me@dues.in', 'goodpass123'); assert.ok(C.signedIn());
confirmEmails = true; assert.deepEqual(await C.signUp('new@dues.in', 'goodpass123'), { signedIn: false, confirm: true }); confirmEmails = false;
await C.recover('me@dues.in'); step('sign up, sign in, sign out, errors in plain words');

/* expired access token: refreshed with the stored refresh token; a dead refresh token signs you out */
const stash = C.sessionForStorage();
C.restore(stash); assert.equal(await C.pull(), null);
tokens.clear();
const s2 = C.sessionForStorage(); C.restore(s2); assert.equal(await C.pull(), null, "refreshed after a revoked token");
const saved2 = C.sessionForStorage(); tokens.clear(); refresh.clear(); C.restore(saved2);
await rejects(C.pull(), 'nosession'); assert.equal(C.signedIn(), false);
await C.signIn('me@dues.in', 'goodpass123'); step('session refresh and expiry');

/* ───── sync and merge between two phones ───── */
const T = (m) => '2026-11-06T10:' + String(m).padStart(2, '0') + ':00.000Z';
const base = { v: 1, me: { name: 'V', updated_at: T(0) }, settings: { business: 'A' }, settings_at: T(0), clients: [{ id: 'c1', name: 'Ravi', created_at: T(0) }],
  invoices: [{ id: 'i1', client_id: 'c1', amount: 1000, paid: 0, status: 'open', created_at: T(0) }], payments: [], events: [], followups: [], deleted: [], created: T(0), updated_at: T(0) };
let A = await C.sync(base, 0); assert.equal(A.version, 1); assert.equal(rows.size, 1);
const remoteRow = [...rows.values()][0]; assert.equal(remoteRow.data.clients[0].name, 'Ravi');
assert.equal((await C.sync(base, 1)).version, 1, 'nothing new: no write');

// phone A adds a payment; phone B (still on version 1) adds a client and deletes nothing
const a2 = JSON.parse(JSON.stringify(base)); a2.payments.push({ id: 'p1', invoice_id: 'i1', amount: 400, paid_on: '2026-11-06', created_at: T(5) }); a2.updated_at = T(5);
A = await C.sync(a2, 1); assert.equal(A.version, 2); assert.equal(A.changed, false);
const b2 = JSON.parse(JSON.stringify(base)); b2.clients.push({ id: 'c2', name: 'Meera', created_at: T(6) }); b2.payments.push({ id: 'p2', invoice_id: 'i1', amount: 600, paid_on: '2026-11-06', created_at: T(6) });
b2.settings = { business: 'B' }; b2.settings_at = T(7); b2.updated_at = T(7);
const B = await C.sync(b2, 1); assert.equal(B.version, 3); assert.equal(B.changed, true);
assert.deepEqual(B.data.clients.map((c) => c.id), ['c1', 'c2']);
assert.deepEqual(B.data.payments.map((p) => p.id).sort(), ['p1', 'p2']);
assert.equal(B.data.invoices[0].paid, 1000); assert.equal(B.data.invoices[0].status, 'paid', 'payments from both phones add up');
assert.equal(B.data.settings.business, 'B', 'newest settings win'); step('two phones: changes merge, totals recomputed');

// a deletion on one phone stays deleted after the other phone syncs an old copy
const a3 = JSON.parse(JSON.stringify(B.data)); a3.clients = a3.clients.filter((c) => c.id !== 'c2'); a3.deleted.push('c2'); a3.updated_at = T(8);
await C.sync(a3, 3);
const stale = JSON.parse(JSON.stringify(B.data)); stale.updated_at = T(9);
const B2 = await C.sync(stale, 3); assert.ok(!B2.data.clients.some((c) => c.id === 'c2')); assert.ok(B2.data.deleted.includes('c2')); step('deletions are kept');

// erase on one phone wins over older data from the other
const wiped = Object.assign(api.blank(), { reset_at: T(20), updated_at: T(20) });
await C.sync(wiped, -1);
const old = JSON.parse(JSON.stringify(B2.data)); old.updated_at = T(21);
assert.equal((await C.sync(old, 2)).data.clients.length, 0); step('erase everywhere');

// someone saves between our read and our write: the version check catches it and we merge again
const realFetch = globalThis.fetch; let raced = false;
globalThis.fetch = async (url, o) => {
  if (!raced && o.method === 'PATCH') { raced = true; const row = [...rows.values()][0]; row.data = Object.assign({}, row.data, { clients: [...row.data.clients, { id: 'c9', name: 'Late', created_at: T(30) }] }); row.version++; }
  return realFetch(url, o);
};
const mine = JSON.parse(JSON.stringify([...rows.values()][0].data)); mine.clients.push({ id: 'c8', name: 'Mine', created_at: T(31) }); mine.updated_at = T(31);
const R = await C.sync(mine, [...rows.values()][0].version);
globalThis.fetch = realFetch;
assert.deepEqual(R.data.clients.map((c) => c.id).sort(), ['c8', 'c9']); assert.equal([...rows.values()][0].version, R.version); step('a save in between is merged, not lost');

await C.changePassword('newpass456'); await C.signOut(); await C.signIn('me@dues.in', 'newpass456'); step('change password');
console.log('ALL PASSED');
