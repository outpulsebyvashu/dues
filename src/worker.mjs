/**
 * Dues — Cloudflare Worker (API + static app). Follows up on unpaid invoices until they are paid.
 *
 * Storage: D1 (binding DB). Sessions: signed, HttpOnly cookie (SESSION_SECRET). Passwords: PBKDF2-SHA256.
 * D1 has no row-level security, so every query here is filtered by the signed-in account's user_id.
 *
 * Optional secrets:
 *   RESEND_API_KEY + EMAIL_FROM          email reminders are sent automatically
 *   RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET a Razorpay payment link is made for each invoice
 *   RAZORPAY_WEBHOOK_SECRET              Razorpay tells Dues when a link is paid; the invoice closes itself
 * Cron (wrangler.jsonc): once a day, plans reminders for every account and sends the email ones.
 */
import { SCHEMA } from './schema.mjs';

const COOKIE = '__Host-dues';
const SESSION_TTL = 30 * 24 * 3600;
const PBKDF2_ITER = 100000;
const te = new TextEncoder(), td = new TextDecoder();

export const DEFAULT_SETTINGS = {
  business: '', upi: '', phone: '', email: '', currency: '₹',
  steps: [
    { days: -3, tone: 'gentle' },
    { days: 0, tone: 'due' },
    { days: 3, tone: 'firm' },
    { days: 7, tone: 'firm' },
    { days: 15, tone: 'final' },
  ],
  templates: {
    gentle: 'Hi {client}, a friendly reminder that invoice {number} for {amount} is due on {due}. You can pay here: {link}. Thank you! – {business}',
    due: 'Hi {client}, invoice {number} for {amount} is due today. Pay here: {link}. Thank you! – {business}',
    firm: 'Hi {client}, invoice {number} for {amount} was due on {due} and is now {late} days late. Please pay today: {link}. – {business}',
    final: 'Hi {client}, this is a final reminder: invoice {number} for {amount} is {late} days overdue. Please pay now or tell us when you will: {link}. – {business}',
  },
};
const TONES = ['gentle', 'due', 'firm', 'final'];
const METHODS = ['upi', 'bank', 'cash', 'card', 'razorpay', 'cheque', 'other'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

/* ───────── small helpers ───────── */
export function b64u(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s), o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
const uid = () => crypto.randomUUID();
const token = (n = 18) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const nowIso = () => new Date().toISOString();
export const istToday = (ms = Date.now()) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
export const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const r2 = (n) => Math.round(n * 100) / 100;
export function money(n, cur = '₹') { return cur + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 }); }
async function sha256(s) { return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)))); }

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function body(req) {
  const t = await req.text();
  if (t.length > 200000) throw new HttpError(413, 'That is too much at once.');
  try { const v = JSON.parse(t || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; } catch { throw new HttpError(400, 'Send a JSON body.'); }
}
function text(v, max, field, required = false) {
  if (v === undefined || v === null || v === '') { if (required) throw new HttpError(400, `${field} is required.`); return ''; }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${field} must be text.`);
  const t = String(v).trim();
  if (required && !t) throw new HttpError(400, `${field} is required.`);
  if (t.length > max) throw new HttpError(400, `${field} is too long (max ${max}).`);
  return t;
}
function amount(v, field = 'Amount') {
  const n = typeof v === 'string' ? Number(v.replace(/[,₹\s]/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1e10) throw new HttpError(400, `${field} must be more than 0.`);
  return r2(n);
}
function day(v, field, fallback) {
  if (v === undefined || v === null || v === '') { if (fallback === undefined) throw new HttpError(400, `${field} is required.`); return fallback; }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD).`);
  return v;
}
export function phone(v) {
  const t = text(v, 20, 'Phone'); if (!t) return '';
  const d = t.replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (/^[6-9]\d{9}$/.test(ten)) return '+91' + ten;
  if (t.startsWith('+') && d.length >= 8 && d.length <= 15) return '+' + d;   // other countries, e.g. +971
  throw new HttpError(400, 'Enter a valid mobile number.');
}
function email(v) {
  const t = text(v, 120, 'Email').toLowerCase(); if (!t) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new HttpError(400, 'Enter a valid email.');
  return t;
}

/* ───────── passwords + sessions ───────── */
export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(salt), iterations: PBKDF2_ITER }, key, 256);
  return b64u(new Uint8Array(bits));
}
function sameString(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const hmacKey = (secret) => crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
async function makeSession(uidv, secret) {
  const b = b64u(te.encode(JSON.stringify({ u: uidv, exp: Math.floor(Date.now() / 1000) + SESSION_TTL })));
  return b + '.' + b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), te.encode(b))));
}
async function readSession(tok, secret) {
  try {
    if (!tok || !secret) return null;
    const [b, s, x] = tok.split('.'); if (!b || !s || x !== undefined) return null;
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(s), te.encode(b)))) return null;
    const p = JSON.parse(td.decode(unb64u(b))); return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
function cookieOf(req) { for (const part of (req.headers.get('Cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim(); } return null; }
const setCookie = (v, age) => `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function secretOf(env) { if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) throw new HttpError(500, 'The server is not set up yet: SESSION_SECRET is missing.'); return env.SESSION_SECRET; }
async function requireUser(req, env) {
  const s = await readSession(cookieOf(req), secretOf(env));
  if (!s) throw new HttpError(401, 'Please sign in.');
  const u = await env.DB.prepare('select id, username, name, created_at from users where id = ?').bind(s.u).first();
  if (!u) throw new HttpError(401, 'Please sign in.');
  return u;
}

/* ───────── first-use setup ───────── */
let ready = null;
function ensureDb(env) {
  if (!ready) ready = (async () => { for (const q of SCHEMA) await env.DB.prepare(q).run(); })().catch((e) => { ready = null; throw e; });
  return ready;
}

/* ───────── settings ───────── */
async function settingsOf(env, userId) {
  const r = await env.DB.prepare('select data from settings where user_id = ?').bind(userId).first();
  const s = r ? JSON.parse(r.data) : {};
  return { ...DEFAULT_SETTINGS, ...s, templates: { ...DEFAULT_SETTINGS.templates, ...(s.templates || {}) }, steps: Array.isArray(s.steps) && s.steps.length ? s.steps : DEFAULT_SETTINGS.steps };
}
function cleanSettings(b, cur) {
  const out = { ...cur };
  if ('business' in b) out.business = text(b.business, 80, 'Business name');
  if ('upi' in b) { const u = text(b.upi, 60, 'UPI ID'); if (u && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(u)) throw new HttpError(400, 'Enter a UPI ID like name@bank.'); out.upi = u; }
  if ('phone' in b) out.phone = phone(b.phone);
  if ('email' in b) out.email = email(b.email);
  if ('currency' in b) out.currency = text(b.currency, 4, 'Currency') || '₹';
  if ('steps' in b) {
    if (!Array.isArray(b.steps) || !b.steps.length || b.steps.length > 8) throw new HttpError(400, 'Add 1 to 8 reminder steps.');
    const steps = b.steps.map((s, i) => {
      const d = Number(s && s.days);
      if (!Number.isInteger(d) || d < -30 || d > 120) throw new HttpError(400, `Step ${i + 1}: days must be a whole number from -30 to 120.`);
      return { days: d, tone: TONES.includes(s.tone) ? s.tone : 'firm' };
    }).sort((a, b2) => a.days - b2.days);
    if (new Set(steps.map((s) => s.days)).size !== steps.length) throw new HttpError(400, 'Two steps are on the same day.');
    out.steps = steps;
  }
  if ('templates' in b && b.templates && typeof b.templates === 'object') {
    out.templates = { ...cur.templates };
    for (const t of TONES) if (t in b.templates) out.templates[t] = text(b.templates[t], 600, `The ${t} message`, true);
  }
  return out;
}

/* ───────── reminders ───────── */
export function fill(tpl, v) { return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)); }
function prettyDay(d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function messageFor(s, inv, client, origin, today) {
  const bal = r2(inv.amount - inv.paid);
  return fill(s.templates[inv._tone] || s.templates.firm, {
    client: (client.name || '').split(' ')[0] || 'there', amount: money(bal, s.currency), number: inv.number, due: prettyDay(inv.due_on),
    late: Math.max(0, daysBetween(inv.due_on, today)), link: origin + '/p/' + inv.pay_token, business: s.business || 'us',
  });
}
/**
 * Plans reminders for one account up to `today`. For each open invoice with money left, the newest schedule step that is
 * due gets a reminder; older steps that were never sent are skipped, so importing an old invoice sends one message, not five.
 * A promise to pay pauses reminders until the promised day; a missed promise is logged once and reminders resume.
 */
export async function planFollowups(env, userId, today, origin) {
  const s = await settingsOf(env, userId);
  const invs = (await env.DB.prepare(
    `select i.*, c.name as c_name, c.phone as c_phone, c.email as c_email from invoices i join clients c on c.id = i.client_id
     where i.user_id = ? and i.status = 'open' and i.amount > i.paid`).bind(userId).all()).results;
  const made = [];
  for (const inv of invs) {
    if (inv.promise_on && inv.promise_on >= today) continue;
    if (inv.promise_on && inv.promise_on < today) {
      const seen = await env.DB.prepare(`select 1 from events where invoice_id = ? and kind = 'promise_missed' and detail = ?`).bind(inv.id, inv.promise_on).first();
      if (!seen) await logEvent(env, userId, inv.id, 'promise_missed', inv.promise_on);
    }
    let latest = -1;
    s.steps.forEach((st, i) => { if (addDays(inv.due_on, st.days) <= today) latest = i; });
    if (latest < 0) continue;
    const have = (await env.DB.prepare('select step from followups where invoice_id = ?').bind(inv.id).all()).results.map((r) => r.step);
    if (have.includes(latest)) continue;
    // after a missed promise, a step already used before the promise is not repeated: the next one is
    const stmts = [];
    for (let i = 0; i < latest; i++) if (!have.includes(i))
      stmts.push(env.DB.prepare(`insert or ignore into followups (id, user_id, invoice_id, step, tone, channel, due_on, status, message, created_at) values (?, ?, ?, ?, ?, ?, ?, 'skipped', '', ?)`)
        .bind(uid(), userId, inv.id, i, s.steps[i].tone, 'none', addDays(inv.due_on, s.steps[i].days), nowIso()));
    inv._tone = s.steps[latest].tone;
    const client = { name: inv.c_name };
    const channel = inv.c_phone ? 'whatsapp' : inv.c_email ? 'email' : 'whatsapp';
    const id = uid();
    stmts.push(env.DB.prepare(`insert or ignore into followups (id, user_id, invoice_id, step, tone, channel, due_on, status, message, created_at) values (?, ?, ?, ?, ?, ?, ?, 'due', ?, ?)`)
      .bind(id, userId, inv.id, latest, s.steps[latest].tone, channel, addDays(inv.due_on, s.steps[latest].days), messageFor(s, inv, client, origin, today), nowIso()));
    await env.DB.batch(stmts);
    made.push({ id, channel, email: inv.c_email, invoice: inv });
  }
  return made;
}
async function sendEmailReminders(env, userId) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return 0;
  const s = await settingsOf(env, userId);
  const due = (await env.DB.prepare(
    `select f.*, i.number, c.email as c_email from followups f join invoices i on i.id = f.invoice_id join clients c on c.id = i.client_id
     where f.user_id = ? and f.status = 'due' and f.channel = 'email' and c.email != ''`).bind(userId).all()).results;
  let n = 0;
  for (const f of due) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [f.c_email], reply_to: s.email || undefined, subject: `Invoice ${f.number} from ${s.business || 'us'}`, text: f.message }),
    });
    if (r.ok) { await markSent(env, userId, f, 'email'); n++; }
    else await logEvent(env, userId, f.invoice_id, 'email_failed', String(r.status));
  }
  return n;
}
async function markSent(env, userId, f, via) {
  await env.DB.batch([
    env.DB.prepare(`update followups set status = 'sent', sent_at = ? where id = ? and user_id = ?`).bind(nowIso(), f.id, userId),
    env.DB.prepare(`insert into events (user_id, invoice_id, kind, detail, created_at) values (?, ?, 'reminder_sent', ?, ?)`).bind(userId, f.invoice_id, `${f.tone} · ${via}`, nowIso()),
  ]);
}
async function logEvent(env, userId, invoiceId, kind, detail = '') {
  await env.DB.prepare('insert into events (user_id, invoice_id, kind, detail, created_at) values (?, ?, ?, ?, ?)').bind(userId, invoiceId, kind, String(detail).slice(0, 300), nowIso()).run();
}

/* ───────── invoices ───────── */
async function invoiceOf(env, userId, id) {
  const inv = await env.DB.prepare(
    `select i.*, c.name as client_name, c.company as client_company, c.phone as client_phone, c.email as client_email
     from invoices i join clients c on c.id = i.client_id where i.id = ? and i.user_id = ?`).bind(id, userId).first();
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  return inv;
}
function shape(inv, today) {
  const balance = r2(inv.amount - inv.paid);
  const overdue = inv.status === 'open' && balance > 0 && inv.due_on < today;
  return { ...inv, balance, overdue, late_days: overdue ? daysBetween(inv.due_on, today) : 0, promised: !!(inv.promise_on && inv.promise_on >= today && inv.status === 'open') };
}
async function nextNumber(env, userId) {
  const r = await env.DB.prepare(`select count(*) as n from invoices where user_id = ?`).bind(userId).first();
  let n = (r?.n || 0) + 1;
  for (;;) { const num = 'INV-' + String(n).padStart(4, '0'); if (!(await env.DB.prepare('select 1 from invoices where user_id = ? and number = ?').bind(userId, num).first())) return num; n++; }
}
async function razorpayLink(env, s, inv, client, origin) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  const bal = r2(inv.amount - inv.paid); if (bal <= 0) return null;
  const r = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(bal * 100), currency: 'INR', reference_id: inv.id.slice(0, 40), description: `Invoice ${inv.number}${s.business ? ' · ' + s.business : ''}`.slice(0, 2048),
      customer: { name: client.name, contact: client.phone || undefined, email: client.email || undefined }, notify: { sms: false, email: false }, reminder_enable: false,
      notes: { dues_invoice: inv.id }, callback_url: origin + '/p/' + inv.pay_token, callback_method: 'get' }),
  });
  if (!r.ok) return null;
  return (await r.json()).short_url || null;
}
async function addPayment(env, userId, inv, amt, method, ref, paidOn) {
  const bal = r2(inv.amount - inv.paid);
  if (amt > bal + 0.001) throw new HttpError(400, `That is more than the ${money(bal)} left on this invoice.`);
  const paid = r2(inv.paid + amt), done = paid >= inv.amount - 0.001;
  await env.DB.batch([
    env.DB.prepare('insert into payments (id, user_id, invoice_id, amount, method, ref, paid_on, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)').bind(uid(), userId, inv.id, amt, method, ref, paidOn, nowIso()),
    env.DB.prepare(`update invoices set paid = ?, status = ?, paid_on = ?, promise_on = case when ? then null else promise_on end, updated_at = ? where id = ? and user_id = ?`)
      .bind(paid, done ? 'paid' : 'open', done ? paidOn : null, done ? 1 : 0, nowIso(), inv.id, userId),
    env.DB.prepare(`update followups set status = 'skipped' where invoice_id = ? and status = 'due' and ?`).bind(inv.id, done ? 1 : 0),
    env.DB.prepare('insert into events (user_id, invoice_id, kind, detail, created_at) values (?, ?, ?, ?, ?)').bind(userId, inv.id, done ? 'paid_full' : 'paid_part', `${money(amt)} · ${method}${ref ? ' · ' + ref : ''}`, nowIso()),
  ]);
}
async function upsertClient(env, userId, b) {
  if (b.client_id) {
    const c = await env.DB.prepare('select * from clients where id = ? and user_id = ?').bind(String(b.client_id), userId).first();
    if (!c) throw new HttpError(404, 'Client not found.');
    return c;
  }
  const name = text(b.client_name, 80, 'Client name', true);
  const found = await env.DB.prepare('select * from clients where user_id = ? and lower(name) = lower(?)').bind(userId, name).first();
  if (found) return found;
  const c = { id: uid(), user_id: userId, name, company: text(b.client_company, 80, 'Company'), phone: phone(b.client_phone), email: email(b.client_email), notes: '', created_at: nowIso() };
  await env.DB.prepare('insert into clients (id, user_id, name, company, phone, email, notes, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)').bind(c.id, userId, c.name, c.company, c.phone, c.email, '', c.created_at).run();
  return c;
}
async function createInvoice(env, userId, b, origin) {
  const client = await upsertClient(env, userId, b);
  const today = istToday();
  const number = text(b.number, 30, 'Invoice number') || await nextNumber(env, userId);
  if (await env.DB.prepare('select 1 from invoices where user_id = ? and number = ?').bind(userId, number).first()) throw new HttpError(409, `Invoice ${number} already exists.`);
  const issued = day(b.issued_on, 'Issue date', today), due = day(b.due_on, 'Due date', addDays(issued, 15));
  if (due < issued) throw new HttpError(400, 'The due date is before the issue date.');
  const inv = { id: uid(), user_id: userId, client_id: client.id, number, description: text(b.description, 300, 'Description'), amount: amount(b.amount), paid: 0, issued_on: issued, due_on: due, pay_token: token(), created_at: nowIso() };
  await env.DB.prepare(`insert into invoices (id, user_id, client_id, number, description, amount, paid, issued_on, due_on, status, pay_token, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 0, ?, ?, 'open', ?, ?, ?)`)
    .bind(inv.id, userId, inv.client_id, inv.number, inv.description, inv.amount, inv.issued_on, inv.due_on, inv.pay_token, inv.created_at, inv.created_at).run();
  await logEvent(env, userId, inv.id, 'created', money(inv.amount));
  const s = await settingsOf(env, userId);
  const link = await razorpayLink(env, s, inv, client, origin).catch(() => null);
  if (link) await env.DB.prepare('update invoices set rp_link = ? where id = ?').bind(link, inv.id).run();
  return inv.id;
}

/* CSV import: header row with any of number, client, phone, email, company, amount, issued, due, description, paid */
export function parseCsv(textIn) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(textIn).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); if (row.some((x) => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
function csvDate(v) {
  const t = String(v || '').trim(); if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);                       // DD/MM/YYYY (India)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(t); return Number.isNaN(d.getTime()) ? t : d.toISOString().slice(0, 10);
}

/* ───────── summary (dashboard numbers) ───────── */
async function summary(env, userId) {
  const today = istToday(), monthStart = today.slice(0, 8) + '01';
  const open = (await env.DB.prepare(`select i.id, i.number, i.amount, i.paid, i.due_on, i.promise_on, c.name as client_name from invoices i join clients c on c.id = i.client_id where i.user_id = ? and i.status = 'open' and i.amount > i.paid`).bind(userId).all()).results;
  let outstanding = 0, overdue = 0, overdueCount = 0, promised = 0;
  const ageing = [{ label: 'Not due yet', amount: 0, count: 0 }, { label: '1–30 days late', amount: 0, count: 0 }, { label: '31–60 days late', amount: 0, count: 0 }, { label: '61–90 days late', amount: 0, count: 0 }, { label: '90+ days late', amount: 0, count: 0 }];
  const weeks = [0, 1, 2, 3].map((w) => ({ from: addDays(today, w * 7), to: addDays(today, w * 7 + 6), amount: 0 }));
  for (const i of open) {
    const bal = r2(i.amount - i.paid); outstanding += bal;
    const late = daysBetween(i.due_on, today);
    const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    ageing[b].amount += bal; ageing[b].count++;
    if (late > 0) { overdue += bal; overdueCount++; }
    if (i.promise_on && i.promise_on >= today) promised += bal;
    const expect = i.promise_on && i.promise_on >= today ? i.promise_on : i.due_on < today ? today : i.due_on;   // simple forecast
    const w = weeks.find((x) => expect >= x.from && expect <= x.to); if (w) w.amount += bal;
  }
  const coll = await env.DB.prepare(`select coalesce(sum(amount), 0) as month, count(*) as n from payments where user_id = ? and paid_on >= ?`).bind(userId, monthStart).first();
  const billed = await env.DB.prepare(`select coalesce(sum(amount), 0) as billed, coalesce(sum(paid), 0) as paid, count(*) as n from invoices where user_id = ? and status != 'void'`).bind(userId).first();
  const avg = await env.DB.prepare(`select avg(julianday(paid_on) - julianday(issued_on)) as d from invoices where user_id = ? and status = 'paid' and paid_on is not null`).bind(userId).first();
  const fu = await env.DB.prepare(`select count(*) as n from followups where user_id = ? and status = 'due'`).bind(userId).first();
  const clients = await env.DB.prepare(`select count(*) as n from clients where user_id = ?`).bind(userId).first();
  return {
    today, outstanding: r2(outstanding), overdue: r2(overdue), overdue_count: overdueCount, open_count: open.length, promised: r2(promised),
    collected_month: r2(coll.month), payments_month: coll.n, billed: r2(billed.billed), collected_all: r2(billed.paid), invoices: billed.n,
    collection_rate: billed.billed > 0 ? Math.round((billed.paid / billed.billed) * 100) : 0, avg_days_to_pay: avg?.d == null ? null : Math.round(avg.d),
    ageing: ageing.map((a) => ({ ...a, amount: r2(a.amount) })), forecast: weeks.map((w) => ({ ...w, amount: r2(w.amount) })), followups_due: fu.n, clients: clients.n,
  };
}

/* ───────── routes ───────── */
const routes = [];
const route = (m, p, h) => routes.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), h]);

route('POST', '/api/signup', async ({ req, env }) => {
  const b = await body(req);
  const username = text(b.username, 40, 'Username', true).toLowerCase();
  if (!/^[a-z0-9._@-]{3,40}$/.test(username)) throw new HttpError(400, 'Username: 3–40 letters, numbers, dots, dashes or @.');
  const password = String(b.password || '');
  if (password.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'That password is too long.');
  if (env.SIGNUP === 'closed') throw new HttpError(403, 'New accounts are closed. Ask the owner for an account.');
  if (await env.DB.prepare('select 1 from users where username = ?').bind(username).first()) throw new HttpError(409, 'That username is taken.');
  const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const u = { id: uid(), username, name: text(b.name, 60, 'Name') || username.split('@')[0], pass_hash: await hashPassword(password, salt), salt };
  const s = { ...DEFAULT_SETTINGS, business: text(b.business, 80, 'Business name') };
  await env.DB.batch([
    env.DB.prepare('insert into users (id, username, name, pass_hash, salt, created_at) values (?, ?, ?, ?, ?, ?)').bind(u.id, u.username, u.name, u.pass_hash, u.salt, nowIso()),
    env.DB.prepare('insert into settings (user_id, data) values (?, ?)').bind(u.id, JSON.stringify(s)),
  ]);
  return json({ user: { name: u.name, username } }, 201, { 'Set-Cookie': setCookie(await makeSession(u.id, secretOf(env)), SESSION_TTL) });
});

route('POST', '/api/login', async ({ req, env }) => {
  const b = await body(req);
  const username = String(b.username || '').trim().toLowerCase(), password = String(b.password || '');
  const key = await sha256((req.headers.get('CF-Connecting-IP') || 'local') + '|' + username);
  const since = new Date(Date.now() - 15 * 60e3).toISOString();
  const tries = await env.DB.prepare('select count(*) as n from login_attempts where key = ? and created_at > ?').bind(key, since).first();
  if (tries.n >= 8) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
  const u = await env.DB.prepare('select * from users where username = ?').bind(username).first();
  const ok = u && sameString(await hashPassword(password, u.salt), u.pass_hash);
  if (!ok) {
    await env.DB.prepare('insert into login_attempts (key, created_at) values (?, ?)').bind(key, nowIso()).run();
    throw new HttpError(401, 'Wrong username or password.');
  }
  await env.DB.prepare('delete from login_attempts where key = ? or created_at < ?').bind(key, since).run();
  return json({ user: { name: u.name, username: u.username } }, 200, { 'Set-Cookie': setCookie(await makeSession(u.id, secretOf(env)), SESSION_TTL) });
});
route('POST', '/api/logout', async () => json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) }));
route('GET', '/api/me', async ({ req, env }) => { const u = await requireUser(req, env); return json({ user: u, settings: await settingsOf(env, u.id), email_ready: !!(env.RESEND_API_KEY && env.EMAIL_FROM), razorpay_ready: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) }); });
route('PATCH', '/api/me', async ({ req, env }) => {
  const u = await requireUser(req, env), b = await body(req);
  if ('name' in b) await env.DB.prepare('update users set name = ? where id = ?').bind(text(b.name, 60, 'Name', true), u.id).run();
  if ('new_password' in b) {
    const full = await env.DB.prepare('select * from users where id = ?').bind(u.id).first();
    if (!sameString(await hashPassword(String(b.password || ''), full.salt), full.pass_hash)) throw new HttpError(400, 'Your current password is wrong.');
    const np = String(b.new_password || ''); if (np.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.');
    const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.prepare('update users set pass_hash = ?, salt = ? where id = ?').bind(await hashPassword(np, salt), salt, u.id).run();
  }
  return json({ ok: true });
});

route('GET', '/api/settings', async ({ req, env }) => { const u = await requireUser(req, env); return json({ settings: await settingsOf(env, u.id) }); });
route('PUT', '/api/settings', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const s = cleanSettings(await body(req), await settingsOf(env, u.id));
  await env.DB.prepare('insert into settings (user_id, data) values (?, ?) on conflict(user_id) do update set data = excluded.data').bind(u.id, JSON.stringify(s)).run();
  return json({ settings: s });
});

route('GET', '/api/summary', async ({ req, env, url }) => {
  const u = await requireUser(req, env);
  await planFollowups(env, u.id, istToday(), url.origin);
  return json(await summary(env, u.id));
});

/* clients */
route('GET', '/api/clients', async ({ req, env }) => {
  const u = await requireUser(req, env), today = istToday();
  const r = await env.DB.prepare(
    `select c.*, count(i.id) as invoices,
       coalesce(sum(case when i.status = 'open' then i.amount - i.paid end), 0) as owed,
       coalesce(sum(case when i.status = 'open' and i.due_on < ? then i.amount - i.paid end), 0) as overdue,
       avg(case when i.status = 'paid' then julianday(i.paid_on) - julianday(i.issued_on) end) as avg_days
     from clients c left join invoices i on i.client_id = c.id and i.status != 'void' where c.user_id = ? group by c.id order by owed desc, c.name`).bind(today, u.id).all();
  return json({ clients: r.results.map((c) => ({ ...c, owed: r2(c.owed), overdue: r2(c.overdue), avg_days: c.avg_days == null ? null : Math.round(c.avg_days) })) });
});
route('POST', '/api/clients', async ({ req, env }) => {
  const u = await requireUser(req, env), b = await body(req);
  const name = text(b.name, 80, 'Name', true);
  if (await env.DB.prepare('select 1 from clients where user_id = ? and lower(name) = lower(?)').bind(u.id, name).first()) throw new HttpError(409, `${name} is already a client.`);
  const id = uid();
  await env.DB.prepare('insert into clients (id, user_id, name, company, phone, email, notes, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, name, text(b.company, 80, 'Company'), phone(b.phone), email(b.email), text(b.notes, 500, 'Notes'), nowIso()).run();
  return json({ id }, 201);
});
route('GET', '/api/clients/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env), today = istToday();
  const c = await env.DB.prepare('select * from clients where id = ? and user_id = ?').bind(p.id, u.id).first();
  if (!c) throw new HttpError(404, 'Client not found.');
  const inv = (await env.DB.prepare('select * from invoices where client_id = ? and user_id = ? order by issued_on desc limit 200').bind(p.id, u.id).all()).results;
  return json({ client: c, invoices: inv.map((i) => shape(i, today)) });
});
route('PATCH', '/api/clients/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env), b = await body(req);
  const c = await env.DB.prepare('select * from clients where id = ? and user_id = ?').bind(p.id, u.id).first();
  if (!c) throw new HttpError(404, 'Client not found.');
  await env.DB.prepare('update clients set name = ?, company = ?, phone = ?, email = ?, notes = ? where id = ?')
    .bind('name' in b ? text(b.name, 80, 'Name', true) : c.name, 'company' in b ? text(b.company, 80, 'Company') : c.company, 'phone' in b ? phone(b.phone) : c.phone,
      'email' in b ? email(b.email) : c.email, 'notes' in b ? text(b.notes, 500, 'Notes') : c.notes, p.id).run();
  return json({ ok: true });
});
route('DELETE', '/api/clients/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const n = await env.DB.prepare('select count(*) as n from invoices where client_id = ? and user_id = ?').bind(p.id, u.id).first();
  if (n.n) throw new HttpError(409, 'This client has invoices. Void or keep them; a client with invoices cannot be deleted.');
  const r = await env.DB.prepare('delete from clients where id = ? and user_id = ?').bind(p.id, u.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Client not found.');
  return json({ ok: true });
});

/* invoices */
route('GET', '/api/invoices', async ({ req, env, url }) => {
  const u = await requireUser(req, env), today = istToday();
  const f = url.searchParams.get('status') || 'open', q = (url.searchParams.get('q') || '').trim().toLowerCase();
  let where = 'i.user_id = ?'; const args = [u.id];
  if (f === 'open') where += ` and i.status = 'open'`;
  else if (f === 'overdue') { where += ` and i.status = 'open' and i.due_on < ? and i.amount > i.paid`; args.push(today); }
  else if (f === 'promised') { where += ` and i.status = 'open' and i.promise_on >= ?`; args.push(today); }
  else if (f === 'paid' || f === 'void') { where += ' and i.status = ?'; args.push(f); }
  if (q) { where += ` and (lower(i.number) like ? or lower(c.name) like ? or lower(i.description) like ?)`; args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  const r = await env.DB.prepare(`select i.*, c.name as client_name, c.phone as client_phone, c.email as client_email from invoices i join clients c on c.id = i.client_id where ${where} order by case when i.status = 'open' then i.due_on end asc, i.issued_on desc limit 500`).bind(...args).all();
  return json({ invoices: r.results.map((i) => shape(i, today)), today });
});
route('POST', '/api/invoices', async ({ req, env, url }) => {
  const u = await requireUser(req, env);
  const id = await createInvoice(env, u.id, await body(req), url.origin);
  await planFollowups(env, u.id, istToday(), url.origin);
  return json(shape(await invoiceOf(env, u.id, id), istToday()), 201);
});
route('POST', '/api/invoices/import', async ({ req, env, url }) => {
  const u = await requireUser(req, env), b = await body(req);
  const rows = parseCsv(text(b.csv, 190000, 'CSV', true));
  if (rows.length < 2) throw new HttpError(400, 'Add a header row and at least one invoice.');
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ix = { number: col('number', 'invoice', 'invoiceno', 'invoicenumber', 'no'), client: col('client', 'customer', 'name', 'clientname', 'customername'), phone: col('phone', 'mobile', 'whatsapp', 'contact'),
    email: col('email', 'mail'), company: col('company', 'business'), amount: col('amount', 'total', 'value', 'invoiceamount'), issued: col('issued', 'issuedon', 'date', 'invoicedate'), due: col('due', 'dueon', 'duedate'),
    description: col('description', 'details', 'item', 'items', 'for'), paid: col('paid', 'amountpaid', 'received') };
  if (ix.client < 0 || ix.amount < 0) throw new HttpError(400, 'The CSV needs at least a client column and an amount column.');
  if (rows.length > 501) throw new HttpError(400, 'Import up to 500 invoices at a time.');
  const done = [], errors = [];
  for (let k = 1; k < rows.length; k++) {
    const r = rows[k], g = (i) => (i >= 0 ? (r[i] || '').trim() : '');
    try {
      const id = await createInvoice(env, u.id, { number: g(ix.number), client_name: g(ix.client), client_phone: g(ix.phone), client_email: g(ix.email), client_company: g(ix.company),
        amount: g(ix.amount), issued_on: csvDate(g(ix.issued)) || undefined, due_on: csvDate(g(ix.due)) || undefined, description: g(ix.description) }, url.origin);
      const paid = Number(g(ix.paid).replace(/[,₹\s]/g, ''));
      if (paid > 0) await addPayment(env, u.id, await invoiceOf(env, u.id, id), Math.min(paid, Number(g(ix.amount).replace(/[,₹\s]/g, ''))), 'other', 'imported', csvDate(g(ix.issued)) || istToday());
      done.push(id);
    } catch (e) { errors.push({ row: k + 1, error: e instanceof HttpError ? e.message : 'Could not read this row.' }); }
  }
  await planFollowups(env, u.id, istToday(), url.origin);
  return json({ imported: done.length, errors }, done.length ? 201 : 400);
});
route('GET', '/api/invoices/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env), today = istToday();
  const inv = shape(await invoiceOf(env, u.id, p.id), today);
  const [pays, evs, fus] = await Promise.all([
    env.DB.prepare('select * from payments where invoice_id = ? and user_id = ? order by paid_on desc, created_at desc').bind(p.id, u.id).all(),
    env.DB.prepare('select * from events where invoice_id = ? and user_id = ? order by id desc limit 100').bind(p.id, u.id).all(),
    env.DB.prepare(`select * from followups where invoice_id = ? and user_id = ? and status != 'skipped' order by step`).bind(p.id, u.id).all(),
  ]);
  return json({ invoice: inv, payments: pays.results, events: evs.results, followups: fus.results });
});
route('PATCH', '/api/invoices/:id', async ({ req, env, p, url }) => {
  const u = await requireUser(req, env), b = await body(req);
  const inv = await invoiceOf(env, u.id, p.id);
  if (inv.status === 'void') throw new HttpError(409, 'A void invoice cannot be changed.');
  const amt = 'amount' in b ? amount(b.amount) : inv.amount;
  if (amt < inv.paid - 0.001) throw new HttpError(400, `${money(inv.paid)} is already paid, so the amount can't be lower than that.`);
  const issued = 'issued_on' in b ? day(b.issued_on, 'Issue date') : inv.issued_on, due = 'due_on' in b ? day(b.due_on, 'Due date') : inv.due_on;
  if (due < issued) throw new HttpError(400, 'The due date is before the issue date.');
  const number = 'number' in b ? text(b.number, 30, 'Invoice number', true) : inv.number;
  if (number !== inv.number && await env.DB.prepare('select 1 from invoices where user_id = ? and number = ?').bind(u.id, number).first()) throw new HttpError(409, `Invoice ${number} already exists.`);
  const done = inv.paid >= amt - 0.001;
  await env.DB.prepare(`update invoices set number = ?, description = ?, amount = ?, issued_on = ?, due_on = ?, status = ?, paid_on = case when ? then coalesce(paid_on, ?) else null end, updated_at = ? where id = ?`)
    .bind(number, 'description' in b ? text(b.description, 300, 'Description') : inv.description, amt, issued, due, done ? 'paid' : 'open', done ? 1 : 0, istToday(), nowIso(), inv.id).run();
  await logEvent(env, u.id, inv.id, 'edited', '');
  if (due !== inv.due_on) await env.DB.prepare(`delete from followups where invoice_id = ? and status != 'sent'`).bind(inv.id).run();   // re-plan from the new date
  await planFollowups(env, u.id, istToday(), url.origin);
  return json(shape(await invoiceOf(env, u.id, inv.id), istToday()));
});
route('POST', '/api/invoices/:id/payments', async ({ req, env, p }) => {
  const u = await requireUser(req, env), b = await body(req);
  const inv = await invoiceOf(env, u.id, p.id);
  if (inv.status !== 'open') throw new HttpError(409, inv.status === 'paid' ? 'This invoice is already paid.' : 'This invoice is void.');
  const method = METHODS.includes(b.method) ? b.method : 'other';
  const amt = 'amount' in b ? amount(b.amount) : r2(inv.amount - inv.paid);
  await addPayment(env, u.id, inv, amt, method, text(b.ref, 80, 'Reference'), day(b.paid_on, 'Payment date', istToday()));
  return json(shape(await invoiceOf(env, u.id, inv.id), istToday()), 201);
});
route('DELETE', '/api/invoices/:id/payments/:pid', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const pay = await env.DB.prepare('select * from payments where id = ? and invoice_id = ? and user_id = ?').bind(p.pid, p.id, u.id).first();
  if (!pay) throw new HttpError(404, 'Payment not found.');
  const inv = await invoiceOf(env, u.id, p.id);
  if (inv.status === 'void') throw new HttpError(409, 'A void invoice cannot be changed.');
  await env.DB.batch([
    env.DB.prepare('delete from payments where id = ?').bind(pay.id),
    env.DB.prepare(`update invoices set paid = round(paid - ?, 2), status = 'open', paid_on = null, updated_at = ? where id = ?`).bind(pay.amount, nowIso(), inv.id),
    env.DB.prepare('insert into events (user_id, invoice_id, kind, detail, created_at) values (?, ?, ?, ?, ?)').bind(u.id, inv.id, 'payment_removed', money(pay.amount), nowIso()),
  ]);
  return json(shape(await invoiceOf(env, u.id, inv.id), istToday()));
});
route('POST', '/api/invoices/:id/promise', async ({ req, env, p }) => {
  const u = await requireUser(req, env), b = await body(req), today = istToday();
  const inv = await invoiceOf(env, u.id, p.id);
  if (inv.status !== 'open') throw new HttpError(409, 'Only an open invoice can have a promise to pay.');
  const on = day(b.date, 'Promised date');
  if (on < today) throw new HttpError(400, 'The promised date has already passed.');
  if (on > addDays(today, 180)) throw new HttpError(400, 'Pick a date within 6 months.');
  const note = text(b.note, 200, 'Note');
  await env.DB.batch([
    env.DB.prepare('update invoices set promise_on = ?, promise_note = ?, updated_at = ? where id = ?').bind(on, note, nowIso(), inv.id),
    env.DB.prepare(`update followups set status = 'skipped' where invoice_id = ? and status = 'due'`).bind(inv.id),
    env.DB.prepare('insert into events (user_id, invoice_id, kind, detail, created_at) values (?, ?, ?, ?, ?)').bind(u.id, inv.id, 'promise', on + (note ? ' · ' + note : ''), nowIso()),
  ]);
  return json(shape(await invoiceOf(env, u.id, inv.id), today));
});
route('DELETE', '/api/invoices/:id/promise', async ({ req, env, p, url }) => {
  const u = await requireUser(req, env);
  const inv = await invoiceOf(env, u.id, p.id);
  await env.DB.prepare('update invoices set promise_on = null, promise_note = null, updated_at = ? where id = ?').bind(nowIso(), inv.id).run();
  await logEvent(env, u.id, inv.id, 'promise_cleared', '');
  await planFollowups(env, u.id, istToday(), url.origin);
  return json(shape(await invoiceOf(env, u.id, inv.id), istToday()));
});
route('POST', '/api/invoices/:id/void', async ({ req, env, p }) => {
  const u = await requireUser(req, env), b = await body(req);
  const inv = await invoiceOf(env, u.id, p.id);
  if (inv.status === 'paid') throw new HttpError(409, 'A paid invoice cannot be voided. Remove its payments first.');
  await env.DB.batch([
    env.DB.prepare(`update invoices set status = 'void', updated_at = ? where id = ?`).bind(nowIso(), inv.id),
    env.DB.prepare(`update followups set status = 'skipped' where invoice_id = ? and status = 'due'`).bind(inv.id),
    env.DB.prepare('insert into events (user_id, invoice_id, kind, detail, created_at) values (?, ?, ?, ?, ?)').bind(u.id, inv.id, 'void', text(b.reason, 200, 'Reason'), nowIso()),
  ]);
  return json(shape(await invoiceOf(env, u.id, inv.id), istToday()));
});
route('POST', '/api/invoices/:id/remind', async ({ req, env, p, url }) => {   // a reminder now, outside the schedule
  const u = await requireUser(req, env), today = istToday();
  const inv = await invoiceOf(env, u.id, p.id);
  if (inv.status !== 'open') throw new HttpError(409, 'Only open invoices get reminders.');
  const s = await settingsOf(env, u.id);
  inv._tone = inv.due_on < today ? (daysBetween(inv.due_on, today) > 14 ? 'final' : 'firm') : inv.due_on === today ? 'due' : 'gentle';
  return json({ message: messageFor(s, inv, { name: inv.client_name }, url.origin, today), phone: inv.client_phone, email: inv.client_email, tone: inv._tone });
});
route('POST', '/api/invoices/:id/reminded', async ({ req, env, p }) => {
  const u = await requireUser(req, env), b = await body(req);
  const inv = await invoiceOf(env, u.id, p.id);
  await logEvent(env, u.id, inv.id, 'reminder_sent', `${TONES.includes(b.tone) ? b.tone : 'manual'} · ${b.channel === 'email' ? 'email' : 'whatsapp'}`);
  return json({ ok: true });
});

/* follow-ups (today's queue) */
route('GET', '/api/followups', async ({ req, env, url }) => {
  const u = await requireUser(req, env), today = istToday();
  await planFollowups(env, u.id, today, url.origin);
  const r = await env.DB.prepare(
    `select f.*, i.number, i.amount, i.paid, i.due_on as inv_due, c.name as client_name, c.phone as client_phone, c.email as client_email
     from followups f join invoices i on i.id = f.invoice_id join clients c on c.id = i.client_id
     where f.user_id = ? and f.status = 'due' and i.status = 'open' order by f.due_on, i.due_on`).bind(u.id).all();
  const sent = await env.DB.prepare(`select count(*) as n from followups where user_id = ? and status = 'sent' and sent_at >= ?`).bind(u.id, new Date(Date.parse(today + 'T00:00:00+05:30')).toISOString()).first();
  const missed = (await env.DB.prepare(
    `select i.id, i.number, i.promise_on, i.amount, i.paid, c.name as client_name from invoices i join clients c on c.id = i.client_id
     where i.user_id = ? and i.status = 'open' and i.promise_on is not null and i.promise_on < ?`).bind(u.id, today).all()).results;
  return json({ followups: r.results.map((f) => ({ ...f, balance: r2(f.amount - f.paid), late_days: Math.max(0, daysBetween(f.inv_due, today)) })), sent_today: sent.n, missed_promises: missed, today });
});
route('POST', '/api/followups/:id/sent', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const f = await env.DB.prepare('select * from followups where id = ? and user_id = ?').bind(p.id, u.id).first();
  if (!f) throw new HttpError(404, 'Reminder not found.');
  if (f.status === 'due') await markSent(env, u.id, f, f.channel);
  return json({ ok: true });
});
route('POST', '/api/followups/:id/skip', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const r = await env.DB.prepare(`update followups set status = 'skipped' where id = ? and user_id = ? and status = 'due'`).bind(p.id, u.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Reminder not found.');
  return json({ ok: true });
});
route('POST', '/api/followups/send-email', async ({ req, env }) => {
  const u = await requireUser(req, env);
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new HttpError(503, 'Email is not set up yet. Add RESEND_API_KEY and EMAIL_FROM in Cloudflare.');
  return json({ sent: await sendEmailReminders(env, u.id) });
});

route('GET', '/api/activity', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const r = await env.DB.prepare(`select e.*, i.number, c.name as client_name from events e left join invoices i on i.id = e.invoice_id left join clients c on c.id = i.client_id where e.user_id = ? order by e.id desc limit 40`).bind(u.id).all();
  return json({ events: r.results });
});

/* public pay page data */
route('GET', '/api/pay/:token', async ({ env, p }) => {
  const inv = await env.DB.prepare(`select i.*, c.name as client_name from invoices i join clients c on c.id = i.client_id where i.pay_token = ?`).bind(p.token).first();
  if (!inv) throw new HttpError(404, 'This payment link is not valid.');
  const s = await settingsOf(env, inv.user_id);
  const bal = r2(inv.amount - inv.paid);
  const upi = s.upi && inv.status === 'open' && bal > 0 ? `upi://pay?pa=${encodeURIComponent(s.upi)}&pn=${encodeURIComponent(s.business || 'Payee')}&am=${bal.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Invoice ' + inv.number)}` : '';
  return json({ number: inv.number, description: inv.description, amount: inv.amount, balance: bal, due_on: inv.due_on, issued_on: inv.issued_on, status: inv.status,
    client: (inv.client_name || '').split(' ')[0], business: s.business, upi_id: s.upi, upi, razorpay: inv.status === 'open' ? inv.rp_link : null, phone: s.phone, email: s.email, currency: s.currency, today: istToday() });
});
route('POST', '/api/pay/:token/claim', async ({ req, env, p }) => {   // "I've paid": the owner sees it and confirms
  const b = await body(req);
  const inv = await env.DB.prepare('select * from invoices where pay_token = ?').bind(p.token).first();
  if (!inv) throw new HttpError(404, 'This payment link is not valid.');
  if (inv.status !== 'open') return json({ ok: true });
  const recent = await env.DB.prepare(`select count(*) as n from events where invoice_id = ? and kind = 'client_says_paid' and created_at > ?`).bind(inv.id, new Date(Date.now() - 3600e3).toISOString()).first();
  if (recent.n >= 3) throw new HttpError(429, 'Thanks, we already have your message.');
  await logEvent(env, inv.user_id, inv.id, 'client_says_paid', text(b.ref, 80, 'Reference'));
  return json({ ok: true });
});

/* Razorpay webhook: payment_link.paid closes the invoice */
route('POST', '/api/razorpay/webhook', async ({ req, env }) => {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new HttpError(404, 'Not set up.');
  const raw = await req.text();
  const sig = req.headers.get('X-Razorpay-Signature') || '';
  const key = await crypto.subtle.importKey('raw', te.encode(env.RAZORPAY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(raw)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!sameString(want, sig)) throw new HttpError(400, 'Bad signature.');
  const ev = JSON.parse(raw);
  if (ev.event !== 'payment_link.paid') return json({ ok: true });
  const link = ev.payload?.payment_link?.entity, pay = ev.payload?.payment?.entity;
  const invId = link?.notes?.dues_invoice; if (!invId || !pay) return json({ ok: true });
  const inv = await env.DB.prepare('select * from invoices where id = ?').bind(invId).first();
  if (!inv || inv.status !== 'open') return json({ ok: true });
  if (await env.DB.prepare('select 1 from payments where ref = ? and invoice_id = ?').bind(pay.id, inv.id).first()) return json({ ok: true });
  const amt = Math.min(r2(pay.amount / 100), r2(inv.amount - inv.paid));
  if (amt > 0) await addPayment(env, inv.user_id, inv, amt, 'razorpay', pay.id, istToday());
  return json({ ok: true });
});

/* ───────── entry ───────── */
const PAGES = { '/': '/index.html', '/login': '/login.html', '/app': '/app.html' };
// Static files: the ASSETS binding (wrangler deploy), or the copy bundled into the script by scripts/bundle.mjs.
const assetsOf = (env) => env.ASSETS || globalThis.__DUES_ASSETS;
function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  r.headers.set('X-Content-Type-Options', 'nosniff'); r.headers.set('X-Frame-Options', 'DENY'); r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  r.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  r.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (r.headers.get('Content-Type')?.includes('text/html')) r.headers.set('Cache-Control', 'no-cache');
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.get('Origin');
        if (origin && !['GET', 'HEAD'].includes(req.method) && url.pathname !== '/api/razorpay/webhook' && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-site request blocked.');
        await ensureDb(env);
        for (const [m, re, h] of routes) { if (m !== req.method) continue; const g = re.exec(url.pathname); if (g) return withHeaders(await h({ req, env, url, p: { ...g.groups } })); }
        throw new HttpError(404, 'Unknown endpoint.');
      }
      const ASSETS = assetsOf(env);
      if (url.pathname.startsWith('/p/')) return withHeaders(await ASSETS.fetch(new Request(new URL('/pay.html', url), req)));
      const page = PAGES[url.pathname];
      const res = await ASSETS.fetch(page ? new Request(new URL(page, url), req) : req);
      if (res.status === 404) { const nf = await ASSETS.fetch(new Request(new URL('/404.html', url), req)); return withHeaders(new Response(nf.body, { status: 404, headers: nf.headers })); }
      return withHeaders(res);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    await ensureDb(env);
    const origin = env.PUBLIC_URL || '';
    const users = (await env.DB.prepare('select id from users').all()).results;
    for (const u of users) { await planFollowups(env, u.id, istToday(), origin); await sendEmailReminders(env, u.id); }
  },
};
export { HttpError, summary, shape };
