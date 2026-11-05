// Runs the Worker against SQLite (node:sqlite) with stand-ins for D1, static assets, Resend and Razorpay. Node 22.7+, no installs.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const root = new URL('../', import.meta.url).pathname;
const W = await import(root + 'src/worker.mjs');
const worker = W.default;

const sqlite = new DatabaseSync(':memory:'); sqlite.exec('pragma foreign_keys = on');
const norm = (r) => (r === undefined ? null : { ...r });
const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a),
  first: async () => norm(sqlite.prepare(sql).get(...args)),
  all: async () => ({ results: sqlite.prepare(sql).all(...args).map(norm) }),
  run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; } });
const DB = { prepare: (s) => stmt(s), batch: async (l) => { sqlite.exec('begin'); try { const o = []; for (const s of l) o.push(await s.run()); sqlite.exec('commit'); return o; } catch (e) { sqlite.exec('rollback'); throw e; } } };
const ASSETS = { fetch: async (req) => new Response('<html>' + new URL(req.url).pathname + '</html>', { status: new URL(req.url).pathname === '/nope.html' ? 404 : 200 }) };
const sent = [];
globalThis.fetch = async (url, o) => {
  if (String(url).includes('resend.com')) { sent.push(JSON.parse(o.body)); return new Response('{"id":"x"}', { status: 200 }); }
  if (String(url).includes('razorpay.com')) return new Response(JSON.stringify({ short_url: 'https://rzp.io/i/test' }), { status: 200 });
  throw new Error('unexpected fetch ' + url);
};
const env = { DB, ASSETS, SESSION_SECRET: 'test-secret-that-is-long-enough' };
const step = (n) => console.log('ok -', n);

const jar = {};
async function call(method, path, { body, as, headers = {} } = {}) {
  const h = { ...headers };
  if (as && jar[as]) h.Cookie = jar[as];
  if (body !== undefined) { h['Content-Type'] = 'application/json'; }
  const res = await worker.fetch(new Request('https://dues.test' + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env);
  const sc = res.headers.get('Set-Cookie'); if (sc && as) jar[as] = sc.split(';')[0];
  const t = await res.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: res.status, data, headers: res.headers };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
const today = W.istToday();

// ---- unit bits ----
assert.equal(W.phone('98765 43210'), '+919876543210'); assert.equal(W.phone('+971 50 123 4567'), '+971501234567'); assert.equal(W.phone(''), '');
assert.throws(() => W.phone('12345'));
assert.equal(W.addDays('2026-01-30', 3), '2026-02-02'); assert.equal(W.daysBetween('2026-01-01', '2026-01-31'), 30);
assert.equal(W.fill('Hi {client}, {amount} {x}', { client: 'Ravi', amount: '₹5,000' }), 'Hi Ravi, ₹5,000 {x}');
assert.deepEqual(W.parseCsv('a,b\n"x, y","he said ""hi"""\r\n\n1,2'), [['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]);
assert.equal(W.money(1234567.5), '₹12,34,567.50'); step('helpers: phone, dates, templates, CSV, Indian money format');

// ---- pages ----
assert.match((await call('GET', '/')).data, /index\.html/); assert.match((await call('GET', '/p/abc')).data, /pay\.html/);
assert.equal((await call('GET', '/api/nope')).status, 404); step('pages and pay links served; unknown API is 404');

// ---- accounts ----
assert.equal((await call('GET', '/api/me')).status, 401);
assert.equal((await call('POST', '/api/signup', { body: { username: 'ab', password: 'longenough' } })).status, 400);
assert.equal((await call('POST', '/api/signup', { body: { username: 'vashu', password: 'short' } })).status, 400);
ok(await call('POST', '/api/signup', { as: 'a', body: { username: 'Vashu', name: 'Vashudev', password: 'correct horse', business: 'Outpulse Studio' } }), 201);
assert.equal((await call('POST', '/api/signup', { body: { username: 'vashu', password: 'another one' } })).status, 409);
const me = ok(await call('GET', '/api/me', { as: 'a' }));
assert.equal(me.user.username, 'vashu'); assert.equal(me.settings.business, 'Outpulse Studio'); assert.ok(!('pass_hash' in me.user));
assert.notEqual(sqlite.prepare('select pass_hash from users').get().pass_hash, 'correct horse'); step('sign up, password hashed, session cookie');
assert.equal((await call('POST', '/api/login', { body: { username: 'vashu', password: 'wrong pass' } })).status, 401);
ok(await call('POST', '/api/login', { as: 'a2', body: { username: 'VASHU', password: 'correct horse' } }));
for (let i = 0; i < 8; i++) await call('POST', '/api/login', { body: { username: 'vashu', password: 'nope nope' } });
assert.equal((await call('POST', '/api/login', { body: { username: 'vashu', password: 'correct horse' } })).status, 429); step('login, wrong password, locked after 8 tries');
assert.equal((await call('GET', '/api/me', { headers: { Cookie: '__Host-dues=forged.token' } })).status, 401);
assert.equal((await call('POST', '/api/clients', { as: 'a', body: { name: 'X' }, headers: { Origin: 'https://evil.test' } })).status, 403); step('forged cookie and cross-site writes refused');
ok(await call('POST', '/api/signup', { as: 'b', body: { username: 'other', password: 'other password' } }), 201);

// ---- settings ----
assert.equal((await call('PUT', '/api/settings', { as: 'a', body: { upi: 'not a upi' } })).status, 400);
assert.equal((await call('PUT', '/api/settings', { as: 'a', body: { steps: [{ days: 0 }, { days: 0 }] } })).status, 400);
ok(await call('PUT', '/api/settings', { as: 'a', body: { upi: 'outpulse@okicici', phone: '9876543210', steps: [{ days: 7, tone: 'firm' }, { days: -2, tone: 'gentle' }, { days: 0, tone: 'due' }, { days: 20, tone: 'final' }] } }));
const st = ok(await call('GET', '/api/settings', { as: 'a' })).settings;
assert.deepEqual(st.steps.map((s) => s.days), [-2, 0, 7, 20]); assert.equal(st.phone, '+919876543210'); step('settings validated, steps sorted');

// ---- clients and invoices ----
const c1 = ok(await call('POST', '/api/clients', { as: 'a', body: { name: 'Ravi Kumar', company: 'Kaapi Co', phone: '9811122233' } }), 201).id;
assert.equal((await call('POST', '/api/clients', { as: 'a', body: { name: 'ravi kumar' } })).status, 409);
assert.equal((await call('GET', '/api/clients/' + c1, { as: 'b' })).status, 404); step('clients: create, no duplicates, other accounts cannot see them');
const due10ago = W.addDays(today, -10);
const i1 = ok(await call('POST', '/api/invoices', { as: 'a', body: { client_id: c1, amount: '25,000', description: 'Brand identity', issued_on: W.addDays(today, -25), due_on: due10ago } }), 201);
assert.equal(i1.number, 'INV-0001'); assert.equal(i1.amount, 25000); assert.equal(i1.overdue, true); assert.equal(i1.late_days, 10);
const i2 = ok(await call('POST', '/api/invoices', { as: 'a', body: { client_name: 'Meera Salon', client_email: 'meera@salon.in', amount: 8000, due_on: W.addDays(today, 1) } }), 201);
assert.equal(i2.number, 'INV-0002'); assert.equal(i2.client_email, 'meera@salon.in');
assert.equal((await call('POST', '/api/invoices', { as: 'a', body: { client_id: c1, amount: 0 } })).status, 400);
assert.equal((await call('POST', '/api/invoices', { as: 'a', body: { client_id: c1, amount: 10, number: 'INV-0001' } })).status, 409);
assert.equal((await call('POST', '/api/invoices', { as: 'a', body: { client_id: c1, amount: 10, issued_on: '2026-02-10', due_on: '2026-02-01' } })).status, 400);
assert.equal((await call('GET', '/api/invoices/' + i1.id, { as: 'b' })).status, 404); step('invoices: numbering, new client on the fly, validation, isolation');

// ---- reminders ----
let fu = ok(await call('GET', '/api/followups', { as: 'a' }));
const f1 = fu.followups.find((f) => f.invoice_id === i1.id);
assert.ok(f1); assert.equal(f1.tone, 'firm'); assert.equal(f1.channel, 'whatsapp'); assert.match(f1.message, /Ravi/); assert.match(f1.message, /₹25,000/); assert.match(f1.message, /10 days late/); assert.match(f1.message, /https:\/\/dues\.test\/p\//);
assert.equal(fu.followups.filter((f) => f.invoice_id === i1.id).length, 1);
const skipped = sqlite.prepare(`select count(*) as n from followups where invoice_id = ? and status = 'skipped'`).get(i1.id).n;
assert.equal(skipped, 2);                                                                   // -2 and 0 skipped, only the 7-day one is due
const f2 = fu.followups.find((f) => f.invoice_id === i2.id); assert.ok(f2 && f2.tone === 'gentle' && f2.channel === 'email'); step('reminders: one message per invoice for the newest due step, older ones skipped');
ok(await call('GET', '/api/followups', { as: 'a' })); assert.equal(sqlite.prepare(`select count(*) as n from followups where status = 'due'`).get().n, 2); step('reminders: planning twice adds nothing');
ok(await call('POST', `/api/followups/${f1.id}/sent`, { as: 'a' }));
fu = ok(await call('GET', '/api/followups', { as: 'a' })); assert.equal(fu.sent_today, 1); assert.ok(!fu.followups.find((f) => f.id === f1.id));
assert.equal((await call('POST', `/api/followups/${f1.id}/sent`, { as: 'b' })).status, 404); step('reminders: mark sent, logged, others cannot touch');

// email sending through Resend
await call('POST', '/api/followups/send-email', { as: 'a' }).then((r) => assert.equal(r.status, 503));
env.RESEND_API_KEY = 're_test'; env.EMAIL_FROM = 'Dues <dues@outpulse.company>';
assert.equal(ok(await call('POST', '/api/followups/send-email', { as: 'a' })).sent, 1); assert.equal(sent[0].to[0], 'meera@salon.in'); assert.match(sent[0].subject, /INV-0002/); step('reminders: email ones go out through Resend');

// ---- promise to pay ----
assert.equal((await call('POST', `/api/invoices/${i1.id}/promise`, { as: 'a', body: { date: W.addDays(today, -1) } })).status, 400);
const pr = ok(await call('POST', `/api/invoices/${i1.id}/promise`, { as: 'a', body: { date: W.addDays(today, 5), note: 'salary on 10th' } }));
assert.equal(pr.promised, true);
sqlite.exec(`delete from followups where invoice_id = '${i1.id}'`);
fu = ok(await call('GET', '/api/followups', { as: 'a' })); assert.ok(!fu.followups.find((f) => f.invoice_id === i1.id)); step('promise to pay pauses reminders');
sqlite.prepare('update invoices set promise_on = ? where id = ?').run(W.addDays(today, -2), i1.id);
fu = ok(await call('GET', '/api/followups', { as: 'a' }));
assert.ok(fu.followups.find((f) => f.invoice_id === i1.id)); assert.equal(fu.missed_promises.length, 1);
assert.equal(sqlite.prepare(`select count(*) as n from events where kind = 'promise_missed'`).get().n, 1);
ok(await call('GET', '/api/followups', { as: 'a' })); assert.equal(sqlite.prepare(`select count(*) as n from events where kind = 'promise_missed'`).get().n, 1); step('missed promise: logged once, reminders resume');

// ---- payments ----
assert.equal((await call('POST', `/api/invoices/${i1.id}/payments`, { as: 'a', body: { amount: 30000 } })).status, 400);
let p1 = ok(await call('POST', `/api/invoices/${i1.id}/payments`, { as: 'a', body: { amount: 10000, method: 'upi', ref: 'UTR123' } }), 201);
assert.equal(p1.balance, 15000); assert.equal(p1.status, 'open');
p1 = ok(await call('POST', `/api/invoices/${i1.id}/payments`, { as: 'a', body: { method: 'bank' } }), 201);
assert.equal(p1.status, 'paid'); assert.equal(p1.balance, 0); assert.equal(p1.promise_on, null);
assert.equal(sqlite.prepare(`select count(*) as n from followups where invoice_id = ? and status = 'due'`).get(i1.id).n, 0);
assert.equal((await call('POST', `/api/invoices/${i1.id}/payments`, { as: 'a', body: { amount: 1 } })).status, 409); step('payments: partial, full, closes and stops reminders');
const det = ok(await call('GET', '/api/invoices/' + i1.id, { as: 'a' }));
assert.equal(det.payments.length, 2); assert.ok(det.events.some((e) => e.kind === 'paid_full') && det.events.some((e) => e.kind === 'created') && det.events.some((e) => e.kind === 'promise'));
const back = ok(await call('DELETE', `/api/invoices/${i1.id}/payments/${det.payments[0].id}`, { as: 'a' }));
assert.equal(back.status, 'open'); assert.ok(back.balance > 0); step('activity log; removing a payment reopens the invoice');

// ---- edit, void, manual reminder ----
const ed = ok(await call('PATCH', '/api/invoices/' + i2.id, { as: 'a', body: { amount: 9000, due_on: W.addDays(today, 30) } }));
assert.equal(ed.amount, 9000); assert.equal(ed.overdue, false);
assert.equal((await call('PATCH', '/api/invoices/' + i1.id, { as: 'a', body: { amount: 100 } })).status, 400);
const rm = ok(await call('POST', `/api/invoices/${i2.id}/remind`, { as: 'a' })); assert.equal(rm.tone, 'gentle'); assert.match(rm.message, /Meera/);
const vd = ok(await call('POST', `/api/invoices/${i2.id}/void`, { as: 'a', body: { reason: 'duplicate' } })); assert.equal(vd.status, 'void');
assert.equal((await call('PATCH', '/api/invoices/' + i2.id, { as: 'a', body: { amount: 1 } })).status, 409); step('edit, manual reminder text, void');

// ---- CSV import ----
const csv = 'Invoice No,Customer,Mobile,Amount,Date,Due Date,Paid\nA-1,Glow Salon,9822233344,"12,500",01/09/2026,15/09/2026,2500\nA-2,Kaapi Co,,4000,2026-10-01,2026-10-20,\nA-3,,,,,,\n';
const im = await call('POST', '/api/invoices/import', { as: 'a', body: { csv } });
assert.equal(im.status, 201); assert.equal(im.data.imported, 2); assert.equal(im.data.errors.length, 1); assert.equal(im.data.errors[0].row, 4);
const a1 = sqlite.prepare(`select * from invoices where number = 'A-1'`).get();
assert.equal(a1.due_on, '2026-09-15'); assert.equal(a1.paid, 2500); assert.equal(a1.amount, 12500); step('CSV import: Indian dates, partial paid, bad rows reported');

// ---- summary ----
const sm = ok(await call('GET', '/api/summary', { as: 'a' }));
const openBal = sqlite.prepare(`select sum(amount - paid) as s from invoices where user_id = (select id from users where username='vashu') and status = 'open'`).get().s;
assert.equal(sm.outstanding, openBal); assert.ok(sm.overdue > 0 && sm.overdue <= sm.outstanding);
assert.equal(sm.ageing.reduce((a, b) => a + b.amount, 0), sm.outstanding); assert.equal(sm.ageing.length, 5); assert.equal(sm.forecast.length, 4);
assert.ok(sm.collected_month >= 10000); assert.ok(sm.collection_rate > 0 && sm.collection_rate < 100);
assert.equal(ok(await call('GET', '/api/summary', { as: 'b' })).outstanding, 0); step('summary: outstanding, ageing adds up, forecast, other account sees nothing');
const cl = ok(await call('GET', '/api/clients', { as: 'a' })).clients; assert.ok(cl.find((c) => c.name === 'Ravi Kumar').owed > 0);
assert.equal((await call('DELETE', '/api/clients/' + c1, { as: 'a' })).status, 409); step('clients list with amounts owed; client with invoices cannot be deleted');

// ---- public pay page ----
const tok = sqlite.prepare('select pay_token from invoices where id = ?').get(i1.id).pay_token;
const pay = ok(await call('GET', '/api/pay/' + tok));
assert.equal(pay.business, 'Outpulse Studio'); assert.ok(pay.upi.startsWith('upi://pay?pa=outpulse%40okicici')); assert.ok(!('user_id' in pay) && !('client_phone' in pay));
assert.equal((await call('GET', '/api/pay/wrong')).status, 404);
ok(await call('POST', `/api/pay/${tok}/claim`, { body: { ref: 'UTR999' } }));
assert.ok(sqlite.prepare(`select 1 from events where kind = 'client_says_paid'`).get()); step('pay page: UPI link, no private data, "I have paid" note');

// ---- Razorpay ----
env.RAZORPAY_KEY_ID = 'rzp_test'; env.RAZORPAY_KEY_SECRET = 'sec'; env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
const i3 = ok(await call('POST', '/api/invoices', { as: 'a', body: { client_id: c1, amount: 5000 } }), 201);
assert.equal(i3.rp_link, 'https://rzp.io/i/test');
const ev = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { notes: { dues_invoice: i3.id } } }, payment: { entity: { id: 'pay_1', amount: 500000 } } } });
assert.equal((await call('POST', '/api/razorpay/webhook', { body: ev, headers: { 'X-Razorpay-Signature': 'bad' } })).status, 400);
const sig = createHmac('sha256', 'whsec').update(ev).digest('hex');
ok(await call('POST', '/api/razorpay/webhook', { body: ev, headers: { 'X-Razorpay-Signature': sig } }));
ok(await call('POST', '/api/razorpay/webhook', { body: ev, headers: { 'X-Razorpay-Signature': sig } }));
assert.equal(sqlite.prepare('select status from invoices where id = ?').get(i3.id).status, 'paid');
assert.equal(sqlite.prepare('select count(*) as n from payments where invoice_id = ?').get(i3.id).n, 1); step('Razorpay: payment link made, signed webhook closes the invoice once');

// ---- daily job ----
sqlite.exec(`delete from followups`);
await worker.scheduled({}, { ...env, PUBLIC_URL: 'https://dues.example' }, {});
assert.ok(sqlite.prepare(`select count(*) as n from followups`).get().n > 0); step('daily job plans reminders for every account');

console.log('\nALL PASSED');
