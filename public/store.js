/* Dues on-device store: everything the app needs, kept in this browser (localStorage), no server.
   It answers the same requests the Dues server did (DuesAPI(method, path, body) → Promise), so the screens are unchanged.
   Data never leaves the device unless you export a backup or send a reminder. */
(function (root) {
  'use strict';
  var KEY = 'dues.data.v1';
  var TONES = ['gentle', 'due', 'firm', 'final'];
  var METHODS = ['upi', 'bank', 'cash', 'card', 'razorpay', 'cheque', 'other'];
  var DEFAULT_SETTINGS = {
    business: '', upi: '', phone: '', email: '', currency: '₹', site: '',
    steps: [{ days: -3, tone: 'gentle' }, { days: 0, tone: 'due' }, { days: 3, tone: 'firm' }, { days: 7, tone: 'firm' }, { days: 15, tone: 'final' }],
    templates: {
      gentle: 'Hi {client}, a friendly reminder that invoice {number} for {amount} is due on {due}. {pay} Thank you! – {business}',
      due: 'Hi {client}, invoice {number} for {amount} is due today. {pay} Thank you! – {business}',
      firm: 'Hi {client}, invoice {number} for {amount} was due on {due} and is now {late} days late. Please pay today. {pay} – {business}',
      final: 'Hi {client}, this is a final reminder: invoice {number} for {amount} is {late} days overdue. Please pay now or tell us when you will. {pay} – {business}'
    }
  };

  function HttpError(status, message) { var e = new Error(message); e.status = status; return e; }

  /* ───── helpers (same rules as the server version) ───── */
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  function istToday(ms) { return new Date((ms == null ? Date.now() : ms) + 5.5 * 3600e3).toISOString().slice(0, 10); }
  function addDays(day, n) { var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
  function money(n, cur) { var v = r2(n); return (cur || '₹') + Number(v).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); }
  function nowIso() { return new Date().toISOString(); }
  function uid() { return (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function prettyDay(d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function fill(tpl, v) { return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return k in v ? String(v[k]) : m; }); }
  function text(v, max, field, required) {
    if (v === undefined || v === null || v === '') { if (required) throw HttpError(400, field + ' is required.'); return ''; }
    if (typeof v !== 'string' && typeof v !== 'number') throw HttpError(400, field + ' must be text.');
    var t = String(v).trim();
    if (required && !t) throw HttpError(400, field + ' is required.');
    if (t.length > max) throw HttpError(400, field + ' is too long (max ' + max + ').');
    return t;
  }
  function amount(v, field) {
    field = field || 'Amount';
    var n = typeof v === 'string' ? Number(v.replace(/[,₹\s]/g, '')) : v;
    if (typeof n !== 'number' || !isFinite(n) || n <= 0 || n > 1e10) throw HttpError(400, field + ' must be more than 0.');
    return r2(n);
  }
  function day(v, field, fallback) {
    if (v === undefined || v === null || v === '') { if (fallback === undefined) throw HttpError(400, field + ' is required.'); return fallback; }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))) throw HttpError(400, field + ' must be a date (YYYY-MM-DD).');
    return v;
  }
  function phone(v) {
    var t = text(v, 20, 'Phone'); if (!t) return '';
    var d = t.replace(/\D/g, '');
    var ten = d.length === 12 && d.indexOf('91') === 0 ? d.slice(2) : d.length === 11 && d[0] === '0' ? d.slice(1) : d;
    if (/^[6-9]\d{9}$/.test(ten)) return '+91' + ten;
    if (t[0] === '+' && d.length >= 8 && d.length <= 15) return '+' + d;
    throw HttpError(400, 'Enter a valid mobile number.');
  }
  function email(v) {
    var t = text(v, 120, 'Email').toLowerCase(); if (!t) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw HttpError(400, 'Enter a valid email.');
    return t;
  }
  function link(v, field) {
    var t = text(v, 300, field || 'Link'); if (!t) return '';
    if (!/^https:\/\/[^\s]+$/i.test(t)) throw HttpError(400, (field || 'Link') + ' must start with https://');
    return t;
  }
  function parseCsv(textIn) {
    var rows = [], row = [], cell = '', q = false, s = String(textIn).replace(/^﻿/, '');
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); if (row.some(function (x) { return x.trim(); })) rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell); if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }
  function csvDate(v) {
    var t = String(v || '').trim(); if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    var m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    var d = new Date(t); return isNaN(d.getTime()) ? t : d.toISOString().slice(0, 10);
  }
  function b64uJson(o) {
    var bytes = new TextEncoder().encode(JSON.stringify(o)), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* ───── storage ─────
     The data lives in memory (DB). Every change is handed to a persist function: by default plain localStorage
     (tests, or an old unlocked install); once the vault is open, the vault encrypts it and saves it (and syncs it).
     lastGood is the last saved copy: a request that fails puts it back, so a failed request changes nothing. */
  var storage = root.localStorage;
  var DB = null, lastGood = null, dirty = false, persistHook = null, changeHook = null;
  function blank() { return { v: 1, me: { name: '' }, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), clients: [], invoices: [], payments: [], events: [], followups: [], deleted: [], nextEvent: 1, created: nowIso(), updated_at: nowIso() }; }
  function normal(d) {
    if (!d || d.v !== 1) d = blank();
    ['clients', 'invoices', 'payments', 'events', 'followups', 'deleted'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    if (!d.me) d.me = { name: '' };
    return d;
  }
  function load() {
    if (DB) return DB;
    if (lastGood) { DB = normal(JSON.parse(lastGood)); return DB; }
    var raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { }
    try { DB = normal(raw ? JSON.parse(raw) : null); } catch (e) { DB = blank(); }
    lastGood = JSON.stringify(DB);
    return DB;
  }
  function save() { dirty = true; load().updated_at = nowIso(); }
  function commit() {
    if (!dirty) return Promise.resolve();
    dirty = false;
    var snap = JSON.stringify(DB);
    var done = new Promise(function (ok) {   // a throw here (even a synchronous one) rejects, so the request rolls back
      if (persistHook) return ok(persistHook(snap));
      try { storage.setItem(KEY, snap); } catch (e) { throw HttpError(507, 'This phone is out of space for Dues data. Export a backup, then remove old paid invoices.'); }
      ok();
    });
    return done.then(function () { lastGood = snap; if (changeHook) changeHook(snap); });
  }
  function settingsOf() {
    var s = load().settings || {};
    return Object.assign({}, DEFAULT_SETTINGS, s, { templates: Object.assign({}, DEFAULT_SETTINGS.templates, s.templates || {}), steps: Array.isArray(s.steps) && s.steps.length ? s.steps : DEFAULT_SETTINGS.steps });
  }
  function logEvent(invoiceId, kind, detail) {
    var db = load();
    db.events.push({ id: uid(), invoice_id: invoiceId, kind: kind, detail: String(detail || '').slice(0, 300), created_at: nowIso() });
    if (db.events.length > 5000) db.events = db.events.slice(-4000);
  }
  var byId = function (list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; };
  function clientOf(id) { return byId(load().clients, id) || { name: '(deleted)', company: '', phone: '', email: '' }; }
  function invoiceOf(id) { var i = byId(load().invoices, id); if (!i) throw HttpError(404, 'Invoice not found.'); return i; }

  /* the client's pay page: invoice details travel inside the link, so it works on any static host */
  function payUrl(inv) {
    var s = settingsOf(); if (!s.site) return '';
    var c = clientOf(inv.client_id);
    var data = { b: s.business, n: inv.number, a: inv.amount, p: r2(inv.amount - inv.paid), d: inv.due_on, i: inv.issued_on, s: inv.status, u: s.upi, c: s.currency,
      x: inv.description || '', l: inv.rp_link || '', t: s.phone, e: s.email, k: (c.name || '').split(' ')[0] };
    return s.site.replace(/\/+$/, '') + '/pay.html#' + b64uJson(data);
  }
  function payLine(inv) {
    var s = settingsOf(), url = payUrl(inv);
    if (url) return 'Pay here: ' + url;
    var parts = [];
    if (s.upi) parts.push('Pay by UPI to ' + s.upi + '.');
    if (inv.rp_link) parts.push('Or pay online: ' + inv.rp_link);
    return parts.join(' ');
  }
  function messageFor(inv, tone, today) {
    var s = settingsOf(), c = clientOf(inv.client_id), pay = payLine(inv);
    return fill(s.templates[tone] || s.templates.firm, {
      client: (c.name || '').split(' ')[0] || 'there', amount: money(inv.amount - inv.paid, s.currency), number: inv.number, due: prettyDay(inv.due_on),
      late: Math.max(0, daysBetween(inv.due_on, today)), pay: pay, link: pay, business: s.business || 'us'
    }).replace(/\s+–/g, ' –').replace(/ {2,}/g, ' ').trim();
  }
  function shape(inv, today) {
    var c = clientOf(inv.client_id), balance = r2(inv.amount - inv.paid);
    var overdue = inv.status === 'open' && balance > 0 && inv.due_on < today;
    return Object.assign({}, inv, { client_name: c.name, client_company: c.company, client_phone: c.phone, client_email: c.email, balance: balance, overdue: overdue,
      late_days: overdue ? daysBetween(inv.due_on, today) : 0, promised: !!(inv.promise_on && inv.promise_on >= today && inv.status === 'open'), pay_url: payUrl(inv) });
  }

  /* reminders: newest due step per open invoice; older unsent steps are skipped; a promise pauses them */
  function planFollowups(today) {
    var db = load(), s = settingsOf();
    db.invoices.forEach(function (inv) {
      if (inv.status !== 'open' || inv.amount - inv.paid <= 0) return;
      if (inv.promise_on && inv.promise_on >= today) return;
      if (inv.promise_on && inv.promise_on < today && !db.events.some(function (e) { return e.invoice_id === inv.id && e.kind === 'promise_missed' && e.detail === inv.promise_on; })) logEvent(inv.id, 'promise_missed', inv.promise_on);
      var latest = -1;
      s.steps.forEach(function (st, i) { if (addDays(inv.due_on, st.days) <= today) latest = i; });
      if (latest < 0) return;
      var have = db.followups.filter(function (f) { return f.invoice_id === inv.id; }).map(function (f) { return f.step; });
      if (have.indexOf(latest) > -1) return;
      for (var i = 0; i < latest; i++) if (have.indexOf(i) < 0)
        db.followups.push({ id: uid(), invoice_id: inv.id, step: i, tone: s.steps[i].tone, channel: 'none', due_on: addDays(inv.due_on, s.steps[i].days), status: 'skipped', message: '', created_at: nowIso() });
      var c = clientOf(inv.client_id);
      db.followups.push({ id: uid(), invoice_id: inv.id, step: latest, tone: s.steps[latest].tone, channel: c.phone ? 'whatsapp' : c.email ? 'email' : 'whatsapp',
        due_on: addDays(inv.due_on, s.steps[latest].days), status: 'due', message: '', created_at: nowIso() });
    });
  }
  function nextNumber() {
    var db = load(), n = db.invoices.length + 1;
    for (;;) { var num = 'INV-' + String(n).padStart(4, '0'); if (!db.invoices.some(function (i) { return i.number === num; })) return num; n++; }
  }
  function upsertClient(b) {
    var db = load();
    if (b.client_id) { var c = byId(db.clients, String(b.client_id)); if (!c) throw HttpError(404, 'Client not found.'); return c; }
    var name = text(b.client_name, 80, 'Client name', true);
    var found = db.clients.filter(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })[0];
    if (found) return found;
    var nc = { id: uid(), name: name, company: text(b.client_company, 80, 'Company'), phone: phone(b.client_phone), email: email(b.client_email), notes: '', created_at: nowIso() };
    db.clients.push(nc); return nc;
  }
  function createInvoice(b) {
    var db = load(), amt = amount(b.amount), client = upsertClient(b), today = istToday();
    var number = text(b.number, 30, 'Invoice number') || nextNumber();
    if (db.invoices.some(function (i) { return i.number === number; })) throw HttpError(409, 'Invoice ' + number + ' already exists.');
    var issued = day(b.issued_on, 'Issue date', today), due = day(b.due_on, 'Due date', addDays(issued, 15));
    if (due < issued) throw HttpError(400, 'The due date is before the issue date.');
    var inv = { id: uid(), client_id: client.id, number: number, description: text(b.description, 300, 'Description'), amount: amt, paid: 0, issued_on: issued, due_on: due,
      status: 'open', promise_on: null, promise_note: null, rp_link: link(b.rp_link, 'Payment link') || null, paid_on: null, created_at: nowIso(), updated_at: nowIso() };
    db.invoices.push(inv);
    logEvent(inv.id, 'created', money(inv.amount));
    return inv;
  }
  function addPayment(inv, amt, method, ref, paidOn) {
    var db = load(), bal = r2(inv.amount - inv.paid);
    if (amt > bal + 0.001) throw HttpError(400, 'That is more than the ' + money(bal) + ' left on this invoice.');
    inv.paid = r2(inv.paid + amt);
    var done = inv.paid >= inv.amount - 0.001;
    db.payments.push({ id: uid(), invoice_id: inv.id, amount: amt, method: method, ref: ref, paid_on: paidOn, created_at: nowIso() });
    inv.status = done ? 'paid' : 'open'; inv.paid_on = done ? paidOn : null; if (done) inv.promise_on = null; inv.updated_at = nowIso();
    if (done) db.followups.forEach(function (f) { if (f.invoice_id === inv.id && f.status === 'due') f.status = 'skipped'; });
    logEvent(inv.id, done ? 'paid_full' : 'paid_part', money(amt) + ' · ' + method + (ref ? ' · ' + ref : ''));
  }

  function summary() {
    var db = load(), today = istToday(), monthStart = today.slice(0, 8) + '01';
    var open = db.invoices.filter(function (i) { return i.status === 'open' && i.amount > i.paid; });
    var outstanding = 0, overdue = 0, overdueCount = 0, promised = 0;
    var ageing = ['Not due yet', '1–30 days late', '31–60 days late', '61–90 days late', '90+ days late'].map(function (l) { return { label: l, amount: 0, count: 0 }; });
    var weeks = [0, 1, 2, 3].map(function (w) { return { from: addDays(today, w * 7), to: addDays(today, w * 7 + 6), amount: 0 }; });
    open.forEach(function (i) {
      var bal = r2(i.amount - i.paid); outstanding += bal;
      var late = daysBetween(i.due_on, today), bk = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
      ageing[bk].amount += bal; ageing[bk].count++;
      if (late > 0) { overdue += bal; overdueCount++; }
      if (i.promise_on && i.promise_on >= today) promised += bal;
      var expect = i.promise_on && i.promise_on >= today ? i.promise_on : i.due_on < today ? today : i.due_on;
      weeks.forEach(function (w) { if (expect >= w.from && expect <= w.to) w.amount += bal; });
    });
    var month = db.payments.filter(function (p) { return p.paid_on >= monthStart && byId(db.invoices, p.invoice_id); });
    var live = db.invoices.filter(function (i) { return i.status !== 'void'; });
    var billed = live.reduce(function (a, i) { return a + i.amount; }, 0), paid = live.reduce(function (a, i) { return a + i.paid; }, 0);
    var done = db.invoices.filter(function (i) { return i.status === 'paid' && i.paid_on; });
    return {
      today: today, outstanding: r2(outstanding), overdue: r2(overdue), overdue_count: overdueCount, open_count: open.length, promised: r2(promised),
      collected_month: r2(month.reduce(function (a, p) { return a + p.amount; }, 0)), payments_month: month.length, billed: r2(billed), collected_all: r2(paid), invoices: live.length,
      collection_rate: billed > 0 ? Math.round(paid / billed * 100) : 0,
      avg_days_to_pay: done.length ? Math.round(done.reduce(function (a, i) { return a + daysBetween(i.issued_on, i.paid_on); }, 0) / done.length) : null,
      ageing: ageing.map(function (a) { return Object.assign(a, { amount: r2(a.amount) }); }), forecast: weeks.map(function (w) { return Object.assign(w, { amount: r2(w.amount) }); }),
      followups_due: db.followups.filter(function (f) { return f.status === 'due'; }).length, clients: db.clients.length
    };
  }
  function cleanSettings(b, cur) {
    var out = Object.assign({}, cur);
    if ('business' in b) out.business = text(b.business, 80, 'Business name');
    if ('upi' in b) { var u = text(b.upi, 60, 'UPI ID'); if (u && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(u)) throw HttpError(400, 'Enter a UPI ID like name@bank.'); out.upi = u; }
    if ('phone' in b) out.phone = phone(b.phone);
    if ('email' in b) out.email = email(b.email);
    if ('site' in b) out.site = link(b.site, 'Website address').replace(/\/+$/, '');
    if ('currency' in b) out.currency = text(b.currency, 4, 'Currency') || '₹';
    if ('steps' in b) {
      if (!Array.isArray(b.steps) || !b.steps.length || b.steps.length > 8) throw HttpError(400, 'Add 1 to 8 reminder steps.');
      var steps = b.steps.map(function (st, i) {
        var d = Number(st && st.days);
        if (!Number.isInteger(d) || d < -30 || d > 120) throw HttpError(400, 'Step ' + (i + 1) + ': days must be a whole number from -30 to 120.');
        return { days: d, tone: TONES.indexOf(st.tone) > -1 ? st.tone : 'firm' };
      }).sort(function (a, c) { return a.days - c.days; });
      if (new Set(steps.map(function (x) { return x.days; })).size !== steps.length) throw HttpError(400, 'Two steps are on the same day.');
      out.steps = steps;
    }
    if ('templates' in b && b.templates && typeof b.templates === 'object') {
      out.templates = Object.assign({}, cur.templates);
      TONES.forEach(function (t) { if (t in b.templates) out.templates[t] = text(b.templates[t], 600, 'The ' + t + ' message', true); });
    }
    return out;
  }

  /* ───── routes (same paths as the server version) ───── */
  var routes = [];
  function route(m, p, h) { routes.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/?]+)') + '$'), h]); }

  route('GET', '/api/me', function () { var db = load(); return { user: { name: db.me.name, username: 'Saved on this device', created_at: db.created }, settings: settingsOf(), setup_done: !!db.me.name, email_ready: false, razorpay_ready: false, local: true }; });
  route('PATCH', '/api/me', function (b) { var db = load(); if ('name' in b) { db.me.name = text(b.name, 60, 'Name', true); db.me.updated_at = nowIso(); } save(); return { ok: true }; });
  route('GET', '/api/settings', function () { return { settings: settingsOf() }; });
  route('PUT', '/api/settings', function (b) { var s = cleanSettings(b, settingsOf()); var db = load(); db.settings = s; db.settings_at = nowIso(); save(); return { settings: s }; });
  route('GET', '/api/summary', function () { planFollowups(istToday()); save(); return summary(); });

  route('GET', '/api/clients', function () {
    var db = load(), today = istToday();
    return { clients: db.clients.map(function (c) {
      var inv = db.invoices.filter(function (i) { return i.client_id === c.id && i.status !== 'void'; });
      var paid = inv.filter(function (i) { return i.status === 'paid' && i.paid_on; });
      return Object.assign({}, c, { invoices: inv.length,
        owed: r2(inv.filter(function (i) { return i.status === 'open'; }).reduce(function (a, i) { return a + i.amount - i.paid; }, 0)),
        overdue: r2(inv.filter(function (i) { return i.status === 'open' && i.due_on < today; }).reduce(function (a, i) { return a + i.amount - i.paid; }, 0)),
        avg_days: paid.length ? Math.round(paid.reduce(function (a, i) { return a + daysBetween(i.issued_on, i.paid_on); }, 0) / paid.length) : null });
    }).sort(function (a, b) { return b.owed - a.owed || a.name.localeCompare(b.name); }) };
  });
  route('POST', '/api/clients', function (b) {
    var db = load(), name = text(b.name, 80, 'Name', true);
    if (db.clients.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) throw HttpError(409, name + ' is already a client.');
    var c = { id: uid(), name: name, company: text(b.company, 80, 'Company'), phone: phone(b.phone), email: email(b.email), notes: text(b.notes, 500, 'Notes'), created_at: nowIso() };
    db.clients.push(c); save(); return { id: c.id };
  });
  route('GET', '/api/clients/:id', function (b, p) {
    var db = load(), c = byId(db.clients, p.id), today = istToday(); if (!c) throw HttpError(404, 'Client not found.');
    return { client: c, invoices: db.invoices.filter(function (i) { return i.client_id === c.id; }).sort(function (a, z) { return z.issued_on.localeCompare(a.issued_on); }).map(function (i) { return shape(i, today); }) };
  });
  route('PATCH', '/api/clients/:id', function (b, p) {
    var c = byId(load().clients, p.id); if (!c) throw HttpError(404, 'Client not found.');
    var n = { name: 'name' in b ? text(b.name, 80, 'Name', true) : c.name, company: 'company' in b ? text(b.company, 80, 'Company') : c.company, phone: 'phone' in b ? phone(b.phone) : c.phone,
      email: 'email' in b ? email(b.email) : c.email, notes: 'notes' in b ? text(b.notes, 500, 'Notes') : c.notes };
    Object.assign(c, n, { updated_at: nowIso() }); save(); return { ok: true };
  });
  route('DELETE', '/api/clients/:id', function (b, p) {
    var db = load();
    if (db.invoices.some(function (i) { return i.client_id === p.id; })) throw HttpError(409, 'This client has invoices. Void or keep them; a client with invoices cannot be deleted.');
    var n = db.clients.length; db.clients = db.clients.filter(function (c) { return c.id !== p.id; });
    if (db.clients.length === n) throw HttpError(404, 'Client not found.');
    db.deleted.push(p.id);
    save(); return { ok: true };
  });

  route('GET', '/api/invoices', function (b, p, q) {
    var db = load(), today = istToday(), f = q.get('status') || 'open', s = (q.get('q') || '').trim().toLowerCase();
    var list = db.invoices.filter(function (i) {
      if (f === 'open' && i.status !== 'open') return false;
      if (f === 'overdue' && !(i.status === 'open' && i.due_on < today && i.amount > i.paid)) return false;
      if (f === 'promised' && !(i.status === 'open' && i.promise_on && i.promise_on >= today)) return false;
      if ((f === 'paid' || f === 'void') && i.status !== f) return false;
      if (s) { var c = clientOf(i.client_id); if ((i.number + ' ' + c.name + ' ' + i.description).toLowerCase().indexOf(s) < 0) return false; }
      return true;
    }).sort(function (a, z) { return (a.status === 'open' && z.status === 'open') ? a.due_on.localeCompare(z.due_on) : a.status === 'open' ? -1 : z.status === 'open' ? 1 : z.issued_on.localeCompare(a.issued_on); });
    return { invoices: list.slice(0, 1000).map(function (i) { return shape(i, today); }), today: today };
  });
  route('POST', '/api/invoices', function (b) { var inv = createInvoice(b); planFollowups(istToday()); save(); return shape(inv, istToday()); });
  route('POST', '/api/invoices/import', function (b) {
    var rows = parseCsv(text(b.csv, 2000000, 'CSV', true));
    if (rows.length < 2) throw HttpError(400, 'Add a header row and at least one invoice.');
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/[^a-z]/g, ''); });
    function col() { var names = [].slice.call(arguments); return head.findIndex(function (h) { return names.indexOf(h) > -1; }); }
    var ix = { number: col('number', 'invoice', 'invoiceno', 'invoicenumber', 'no'), client: col('client', 'customer', 'name', 'clientname', 'customername'), phone: col('phone', 'mobile', 'whatsapp', 'contact'),
      email: col('email', 'mail'), company: col('company', 'business'), amount: col('amount', 'total', 'value', 'invoiceamount'), issued: col('issued', 'issuedon', 'date', 'invoicedate'), due: col('due', 'dueon', 'duedate'),
      description: col('description', 'details', 'item', 'items', 'for'), paid: col('paid', 'amountpaid', 'received') };
    if (ix.client < 0 || ix.amount < 0) throw HttpError(400, 'The CSV needs at least a client column and an amount column.');
    if (rows.length > 2001) throw HttpError(400, 'Import up to 2,000 invoices at a time.');
    var done = 0, errors = [];
    for (var k = 1; k < rows.length; k++) {
      var r = rows[k], g = function (i) { return i >= 0 ? (r[i] || '').trim() : ''; };
      try {
        var inv = createInvoice({ number: g(ix.number), client_name: g(ix.client), client_phone: g(ix.phone), client_email: g(ix.email), client_company: g(ix.company),
          amount: g(ix.amount), issued_on: csvDate(g(ix.issued)) || undefined, due_on: csvDate(g(ix.due)) || undefined, description: g(ix.description) });
        var paid = Number(g(ix.paid).replace(/[,₹\s]/g, ''));
        if (paid > 0) addPayment(inv, Math.min(paid, inv.amount), 'other', 'imported', csvDate(g(ix.issued)) || istToday());
        done++;
      } catch (e) { errors.push({ row: k + 1, error: e.status ? e.message : 'Could not read this row.' }); }
    }
    planFollowups(istToday()); save();
    if (!done) { var err = HttpError(400, 'Nothing was imported.'); err.data = { imported: 0, errors: errors }; throw err; }
    return { imported: done, errors: errors };
  });
  route('GET', '/api/invoices/:id', function (b, p) {
    var db = load(), today = istToday(), inv = invoiceOf(p.id);
    return { invoice: shape(inv, today),
      payments: db.payments.filter(function (x) { return x.invoice_id === inv.id; }).sort(function (a, z) { return z.paid_on.localeCompare(a.paid_on) || z.created_at.localeCompare(a.created_at); }),
      events: db.events.filter(function (e) { return e.invoice_id === inv.id; }).slice(-100).reverse(),
      followups: db.followups.filter(function (f) { return f.invoice_id === inv.id && f.status !== 'skipped'; }) };
  });
  route('PATCH', '/api/invoices/:id', function (b, p) {
    var db = load(), inv = invoiceOf(p.id);
    if (inv.status === 'void') throw HttpError(409, 'A void invoice cannot be changed.');
    var amt = 'amount' in b ? amount(b.amount) : inv.amount;
    if (amt < inv.paid - 0.001) throw HttpError(400, money(inv.paid) + ' is already paid, so the amount can\'t be lower than that.');
    var issued = 'issued_on' in b ? day(b.issued_on, 'Issue date') : inv.issued_on, due = 'due_on' in b ? day(b.due_on, 'Due date') : inv.due_on;
    if (due < issued) throw HttpError(400, 'The due date is before the issue date.');
    var number = 'number' in b ? text(b.number, 30, 'Invoice number', true) : inv.number;
    if (number !== inv.number && db.invoices.some(function (i) { return i.number === number; })) throw HttpError(409, 'Invoice ' + number + ' already exists.');
    var rp = 'rp_link' in b ? (link(b.rp_link, 'Payment link') || null) : inv.rp_link;
    var dueChanged = due !== inv.due_on, done = inv.paid >= amt - 0.001;
    Object.assign(inv, { number: number, description: 'description' in b ? text(b.description, 300, 'Description') : inv.description, amount: amt, issued_on: issued, due_on: due, rp_link: rp,
      status: done ? 'paid' : 'open', paid_on: done ? (inv.paid_on || istToday()) : null, updated_at: nowIso() });
    logEvent(inv.id, 'edited', '');
    if (dueChanged) db.followups = db.followups.filter(function (f) { return !(f.invoice_id === inv.id && f.status !== 'sent'); });
    planFollowups(istToday()); save();
    return shape(inv, istToday());
  });
  route('POST', '/api/invoices/:id/payments', function (b, p) {
    var inv = invoiceOf(p.id);
    if (inv.status !== 'open') throw HttpError(409, inv.status === 'paid' ? 'This invoice is already paid.' : 'This invoice is void.');
    addPayment(inv, 'amount' in b ? amount(b.amount) : r2(inv.amount - inv.paid), METHODS.indexOf(b.method) > -1 ? b.method : 'other', text(b.ref, 80, 'Reference'), day(b.paid_on, 'Payment date', istToday()));
    save(); return shape(inv, istToday());
  });
  route('DELETE', '/api/invoices/:id/payments/:pid', function (b, p) {
    var db = load(), inv = invoiceOf(p.id), pay = db.payments.filter(function (x) { return x.id === p.pid && x.invoice_id === inv.id; })[0];
    if (!pay) throw HttpError(404, 'Payment not found.');
    if (inv.status === 'void') throw HttpError(409, 'A void invoice cannot be changed.');
    db.payments = db.payments.filter(function (x) { return x !== pay; });
    db.deleted.push(pay.id);
    Object.assign(inv, { paid: r2(inv.paid - pay.amount), status: 'open', paid_on: null, updated_at: nowIso() });
    logEvent(inv.id, 'payment_removed', money(pay.amount)); save();
    return shape(inv, istToday());
  });
  route('POST', '/api/invoices/:id/promise', function (b, p) {
    var db = load(), today = istToday(), inv = invoiceOf(p.id);
    if (inv.status !== 'open') throw HttpError(409, 'Only an open invoice can have a promise to pay.');
    var on = day(b.date, 'Promised date');
    if (on < today) throw HttpError(400, 'The promised date has already passed.');
    if (on > addDays(today, 180)) throw HttpError(400, 'Pick a date within 6 months.');
    var note = text(b.note, 200, 'Note');
    Object.assign(inv, { promise_on: on, promise_note: note, updated_at: nowIso() });
    db.followups.forEach(function (f) { if (f.invoice_id === inv.id && f.status === 'due') f.status = 'skipped'; });
    logEvent(inv.id, 'promise', on + (note ? ' · ' + note : '')); save();
    return shape(inv, today);
  });
  route('DELETE', '/api/invoices/:id/promise', function (b, p) {
    var inv = invoiceOf(p.id);
    Object.assign(inv, { promise_on: null, promise_note: null, updated_at: nowIso() });
    logEvent(inv.id, 'promise_cleared', ''); planFollowups(istToday()); save();
    return shape(inv, istToday());
  });
  route('POST', '/api/invoices/:id/void', function (b, p) {
    var db = load(), inv = invoiceOf(p.id);
    if (inv.status === 'paid') throw HttpError(409, 'A paid invoice cannot be voided. Remove its payments first.');
    inv.status = 'void'; inv.updated_at = nowIso();
    db.followups.forEach(function (f) { if (f.invoice_id === inv.id && f.status === 'due') f.status = 'skipped'; });
    logEvent(inv.id, 'void', text(b.reason, 200, 'Reason')); save();
    return shape(inv, istToday());
  });
  route('POST', '/api/invoices/:id/remind', function (b, p) {
    var today = istToday(), inv = invoiceOf(p.id);
    if (inv.status !== 'open') throw HttpError(409, 'Only open invoices get reminders.');
    var tone = inv.due_on < today ? (daysBetween(inv.due_on, today) > 14 ? 'final' : 'firm') : inv.due_on === today ? 'due' : 'gentle';
    var c = clientOf(inv.client_id);
    return { message: messageFor(inv, tone, today), phone: c.phone, email: c.email, tone: tone };
  });
  route('POST', '/api/invoices/:id/reminded', function (b, p) {
    var inv = invoiceOf(p.id);
    logEvent(inv.id, 'reminder_sent', (TONES.indexOf(b.tone) > -1 ? b.tone : 'manual') + ' · ' + (b.channel === 'email' ? 'email' : 'whatsapp')); save();
    return { ok: true };
  });

  route('GET', '/api/followups', function () {
    var db = load(), today = istToday();
    planFollowups(today); save();
    var list = db.followups.filter(function (f) { var i = byId(db.invoices, f.invoice_id); return f.status === 'due' && i && i.status === 'open'; })
      .map(function (f) {
        var i = byId(db.invoices, f.invoice_id), c = clientOf(i.client_id);
        return Object.assign({}, f, { number: i.number, amount: i.amount, paid: i.paid, inv_due: i.due_on, client_name: c.name, client_phone: c.phone, client_email: c.email,
          balance: r2(i.amount - i.paid), late_days: Math.max(0, daysBetween(i.due_on, today)), message: messageFor(i, f.tone, today) });
      }).sort(function (a, z) { return a.due_on.localeCompare(z.due_on) || a.inv_due.localeCompare(z.inv_due); });
    var dayStart = new Date(Date.parse(today + 'T00:00:00+05:30')).toISOString();
    var missed = db.invoices.filter(function (i) { return i.status === 'open' && i.promise_on && i.promise_on < today; })
      .map(function (i) { return { id: i.id, number: i.number, promise_on: i.promise_on, amount: i.amount, paid: i.paid, client_name: clientOf(i.client_id).name }; });
    return { followups: list, sent_today: db.followups.filter(function (f) { return f.status === 'sent' && f.sent_at >= dayStart; }).length, missed_promises: missed, today: today };
  });
  route('POST', '/api/followups/:id/sent', function (b, p) {
    var db = load(), f = byId(db.followups, p.id); if (!f) throw HttpError(404, 'Reminder not found.');
    if (f.status === 'due') { f.status = 'sent'; f.sent_at = nowIso(); f.updated_at = f.sent_at; logEvent(f.invoice_id, 'reminder_sent', f.tone + ' · ' + f.channel); save(); }
    return { ok: true };
  });
  route('POST', '/api/followups/:id/skip', function (b, p) {
    var f = byId(load().followups, p.id); if (!f || f.status !== 'due') throw HttpError(404, 'Reminder not found.');
    f.status = 'skipped'; f.updated_at = nowIso(); save(); return { ok: true };
  });
  route('GET', '/api/activity', function () {
    var db = load();
    return { events: db.events.slice(-40).reverse().map(function (e) { var i = byId(db.invoices, e.invoice_id); return Object.assign({}, e, { number: i ? i.number : '', client_name: i ? clientOf(i.client_id).name : '' }); }) };
  });

  /* backup */
  route('GET', '/api/backup', function () { return { app: 'dues', exported_at: nowIso(), data: load() }; });
  route('POST', '/api/restore', function (b) {
    var d = b && b.data;
    if (!d || d.v !== 1 || !Array.isArray(d.invoices) || !Array.isArray(d.clients)) throw HttpError(400, 'This is not a Dues backup file.');
    DB = normal(d); DB.reset_at = nowIso(); save(); return { ok: true, invoices: d.invoices.length, clients: d.clients.length };
  });
  route('POST', '/api/erase', function () { DB = blank(); DB.reset_at = nowIso(); save(); return { ok: true }; });

  var queue = Promise.resolve();   // one request at a time, so saves never overlap
  function DuesAPI(method, path, body) {
    var run = queue.then(function () {
      if (DuesAPI.locked) throw HttpError(423, 'Dues is locked.');
      var out;
      try {
        load();
        var u = new URL(path, 'https://dues.local'), hit = false;
        for (var i = 0; i < routes.length && !hit; i++) {
          var r = routes[i]; if (r[0] !== method) continue;
          var m = r[1].exec(u.pathname); if (!m) continue;
          hit = true; out = r[2](body || {}, m.groups || {}, u.searchParams);
        }
        if (!hit) throw HttpError(404, 'Unknown request.');
      } catch (e) { DB = null; dirty = false; throw e.status ? e : HttpError(500, 'Something went wrong: ' + e.message); }
      return commit().then(function () { return JSON.parse(JSON.stringify(out)); }, function (e) { DB = null; throw e.status ? e : HttpError(500, 'Could not save: ' + e.message); });
    });
    queue = run.catch(function () { });
    return run;
  }
  DuesAPI.locked = false;
  /* the vault calls this after unlocking: data in memory, and where to save changes */
  DuesAPI.attach = function (data, persist, onChange) { DB = normal(data); lastGood = JSON.stringify(DB); dirty = false; persistHook = persist; changeHook = onChange || null; DuesAPI.locked = false; };
  DuesAPI.detach = function () { DB = null; lastGood = null; dirty = false; persistHook = null; changeHook = null; DuesAPI.locked = true; };
  DuesAPI.snapshot = function () { return JSON.parse(lastGood || JSON.stringify(load())); };
  /* data from another device was merged in: show it without saving it back */
  DuesAPI.replace = function (data) { return queue = queue.then(function () { DB = normal(data); lastGood = JSON.stringify(DB); dirty = false; }); };
  DuesAPI.legacyPlain = function () { try { var raw = storage.getItem(KEY); return raw ? normal(JSON.parse(raw)) : null; } catch (e) { return null; } };
  DuesAPI.dropLegacyPlain = function () { try { storage.removeItem(KEY); } catch (e) { } };
  DuesAPI.blank = blank;
  DuesAPI.helpers = { istToday: istToday, addDays: addDays, daysBetween: daysBetween, money: money, fill: fill, parseCsv: parseCsv, phone: phone, b64uJson: b64uJson, reset: function () { DB = null; lastGood = null; } };
  root.DuesAPI = DuesAPI;
})(typeof window !== 'undefined' ? window : globalThis);
