// Tests the on-device store (public/store.js) in Node with a stand-in localStorage. Node 20+, no installs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
new Function(readFileSync(new URL('../public/store.js', import.meta.url), 'utf8'))();
const api = globalThis.DuesAPI, H = api.helpers;
const ok = async (p) => p;
const bad = async (p, status) => { try { await p; assert.fail('expected ' + status); } catch (e) { assert.equal(e.status, status, e.message); } };
const step = (n) => console.log('ok -', n);
const today = H.istToday();

assert.equal(H.phone('98765 43210'), '+919876543210'); assert.equal(H.money(1234567.5), '₹12,34,567.50');
assert.deepEqual(H.parseCsv('a,b\n"x, y","he said ""hi"""\r\n\n1,2'), [['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]); step('helpers');

let me = await api('GET', '/api/me'); assert.equal(me.setup_done, false);
await api('PATCH', '/api/me', { name: 'Vashudev' });
await bad(api('PUT', '/api/settings', { upi: 'nope' }), 400);
await bad(api('PUT', '/api/settings', { site: 'http://insecure.example' }), 400);
await api('PUT', '/api/settings', { business: 'Outpulse Studio', upi: 'outpulse@okicici', phone: '9876543210' });
me = await api('GET', '/api/me'); assert.equal(me.setup_done, true); assert.equal(me.settings.phone, '+919876543210'); step('setup and settings');

const c1 = (await api('POST', '/api/clients', { name: 'Ravi Kumar', phone: '9811122233' })).id;
await bad(api('POST', '/api/clients', { name: 'ravi kumar' }), 409);
const i1 = await api('POST', '/api/invoices', { client_id: c1, amount: '25,000', description: 'Brand identity', issued_on: H.addDays(today, -25), due_on: H.addDays(today, -10) });
assert.equal(i1.number, 'INV-0001'); assert.equal(i1.amount, 25000); assert.equal(i1.late_days, 10); assert.equal(i1.pay_url, '');
const i2 = await api('POST', '/api/invoices', { client_name: 'Meera Salon', client_email: 'meera@salon.in', amount: 8000, due_on: H.addDays(today, 1) });
const nClients = (await api('GET', '/api/clients')).clients.length;
await bad(api('POST', '/api/invoices', { client_name: 'Ghost', amount: 0 }), 400);
assert.equal((await api('GET', '/api/clients')).clients.length, nClients, 'a failed invoice must not leave a new client behind');
await bad(api('POST', '/api/invoices', { client_id: c1, amount: 10, number: 'INV-0001' }), 409); step('invoices and validation; failures change nothing');

let fu = await api('GET', '/api/followups');
const f1 = fu.followups.find((f) => f.invoice_id === i1.id);
assert.equal(f1.tone, 'firm'); assert.match(f1.message, /Ravi/); assert.match(f1.message, /₹25,000/); assert.match(f1.message, /10 days late/); assert.match(f1.message, /Pay by UPI to outpulse@okicici/);
assert.equal(fu.followups.filter((f) => f.invoice_id === i1.id).length, 1);
await api('GET', '/api/followups'); assert.equal((await api('GET', '/api/followups')).followups.length, 2); step('reminders: newest step only, no duplicates, UPI in message');
await api('POST', `/api/followups/${f1.id}/sent`);
fu = await api('GET', '/api/followups'); assert.equal(fu.sent_today, 1); assert.ok(!fu.followups.find((f) => f.id === f1.id)); step('mark sent');

await api('PUT', '/api/settings', { site: 'https://dues.pages.dev/' });
const withSite = await api('GET', '/api/invoices/' + i2.id);
assert.ok(withSite.invoice.pay_url.startsWith('https://dues.pages.dev/pay.html#'));
const data = JSON.parse(Buffer.from(withSite.invoice.pay_url.split('#')[1], 'base64url').toString());
assert.equal(data.p, 8000); assert.equal(data.u, 'outpulse@okicici'); assert.equal(data.b, 'Outpulse Studio'); assert.ok(!('phone' in data) && data.k === 'Meera');
const rm = await api('POST', `/api/invoices/${i2.id}/remind`); assert.match(rm.message, /Pay here: https:\/\/dues\.pages\.dev\/pay\.html#/); step('pay link carries the invoice inside it');

await bad(api('POST', `/api/invoices/${i1.id}/promise`, { date: H.addDays(today, -1) }), 400);
await api('POST', `/api/invoices/${i1.id}/promise`, { date: H.addDays(today, 5) });
fu = await api('GET', '/api/followups'); assert.ok(!fu.followups.find((f) => f.invoice_id === i1.id)); step('promise pauses reminders');

await bad(api('POST', `/api/invoices/${i1.id}/payments`, { amount: 30000 }), 400);
let p = await api('POST', `/api/invoices/${i1.id}/payments`, { amount: 10000, method: 'upi', ref: 'UTR1' }); assert.equal(p.balance, 15000);
p = await api('POST', `/api/invoices/${i1.id}/payments`, { method: 'bank' }); assert.equal(p.status, 'paid'); assert.equal(p.promise_on, null);
const det = await api('GET', '/api/invoices/' + i1.id); assert.equal(det.payments.length, 2); assert.ok(det.events.some((e) => e.kind === 'paid_full'));
const back = await api('DELETE', `/api/invoices/${i1.id}/payments/${det.payments[0].id}`); assert.equal(back.status, 'open'); step('payments, close, reopen');

const csv = 'Invoice No,Customer,Mobile,Amount,Date,Due Date,Paid\nA-1,Glow Salon,9822233344,"12,500",01/09/2026,15/09/2026,2500\nA-2,Kaapi Co,,4000,2026-10-01,2026-10-20,\nA-3,,,,,,\n';
const im = await api('POST', '/api/invoices/import', { csv }); assert.equal(im.imported, 2); assert.equal(im.errors[0].row, 4); step('CSV import');

const sm = await api('GET', '/api/summary');
assert.equal(sm.ageing.reduce((a, b) => a + b.amount, 0), sm.outstanding); assert.ok(sm.collected_month >= 10000); assert.ok(sm.collection_rate > 0 && sm.collection_rate < 100); step('summary adds up');

const v = await api('POST', `/api/invoices/${i2.id}/void`, {}); assert.equal(v.status, 'void'); await bad(api('PATCH', '/api/invoices/' + i2.id, { amount: 1 }), 409); step('void');

// survives a reload, backup and restore, erase
H.reset(); assert.equal((await api('GET', '/api/invoices?status=all')).invoices.length, 4);
const bk = await api('GET', '/api/backup');
await api('POST', '/api/erase'); assert.equal((await api('GET', '/api/invoices?status=all')).invoices.length, 0);
await bad(api('POST', '/api/restore', { data: { nope: 1 } }), 400);
const rs = await api('POST', '/api/restore', bk); assert.equal(rs.invoices, 4);
assert.equal((await api('GET', '/api/invoices?status=all')).invoices.length, 4); step('saved across reloads; backup, erase, restore');
console.log('\nALL PASSED');
