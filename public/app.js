/* Dues app: Overview, Invoices, Follow-ups, Clients, Settings. Talks only to /api on the same site (cookie session). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ME = null, view = 'overview', invFilter = 'open', query = '', FU_COUNT = 0;

  /* ───────── icons ───────── */
  var I = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M8 7h9v9"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
    ring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3l-9 9"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4"/></svg>',
    msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  };
  var STAR = '<svg class="star" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0C55 30 70 45 100 50 70 55 55 70 50 100 45 70 30 55 0 50 30 45 45 30 50 0Z" fill="rgba(255,255,255,.3)"/></svg>';

  /* ───────── helpers ───────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cur() { return (ME && ME.settings.currency) || '₹'; }
  function fmt(n) { var v = Math.round(Number(n) * 100) / 100; return v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function money(n) { return cur() + fmt(n); }
  function bigMoney(n) { return '<span class="cur">' + esc(cur()) + '</span>' + fmt(Math.round(n)); }
  function fitBig(el) { if (!el) return; var len = el.textContent.length; el.style.fontSize = len > 9 ? 'min(' + (15 * 9 / len).toFixed(1) + 'vw,' + Math.round(84 * 9 / len) + 'px)' : ''; }
  function day(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''; }
  function dayY(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function when(iso) { var d = new Date(iso); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function todayIst() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function initials(name) { var p = String(name || '?').trim().split(/\s+/); return esc(((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()); }
  function ph(p) { p = String(p || ''); return /^\+91\d{10}$/.test(p) ? '+91 ' + p.slice(3, 8) + ' ' + p.slice(8) : p; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function api(method, path, body) {
    var o = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(path, o).then(function (r) {
      return r.text().then(function (t) {
        var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { }
        if (r.status === 401) { location.replace('/login'); throw new Error('Please sign in.'); }
        if (!r.ok) { var e = new Error((d && d.error) || 'Something went wrong. Try again.'); e.status = r.status; e.data = d; throw e; }
        return d;
      });
    }, function () { throw new Error('No connection. Check your internet.'); });
  }
  var tt = 0;
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2600); }
  function copy(text, done) {
    try { navigator.clipboard.writeText(text).then(function () { toast(done || 'Copied'); }, function () { prompt('Copy this:', text); }); }
    catch (e) { prompt('Copy this:', text); }
  }
  function waLink(phone, text) { return 'https://wa.me/' + String(phone || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(text); }
  function payUrl(token) { return location.origin + '/p/' + token; }
  var TONE = { gentle: ['Gentle', 'cat-t'], due: ['Due today', 'cat-k'], firm: ['Firm', 'cat-f'], final: ['Final', 'cat-f'] };
  var EVENTS = { created: 'Invoice created', reminder_sent: 'Reminder sent', promise: 'Promised to pay by', promise_missed: 'Promise missed', promise_cleared: 'Promise cleared',
    paid_part: 'Part payment received', paid_full: 'Paid in full', payment_removed: 'Payment removed', void: 'Voided', edited: 'Details edited', client_says_paid: 'Client says they paid', email_failed: 'Email could not be sent' };

  /* ───────── sheets ───────── */
  var onClose = null;
  function sheet(html, mount) {
    closeSheet(true);
    var root = $('#sheetRoot');
    root.innerHTML = '<div class="sheet" id="sheet"><div class="sheet-card" role="dialog" aria-modal="true"><div class="grab"></div>' + html + '</div></div>';
    var s = $('#sheet');
    s.addEventListener('click', function (e) { if (e.target === s) closeSheet(); });
    $$('[data-close]', s).forEach(function (b) { b.onclick = function () { closeSheet(); }; });
    document.body.style.overflow = 'hidden';
    if (mount) mount($('.sheet-card', s));
    var f = $('input:not([type=hidden]),textarea,select', s); if (f && window.innerWidth > 720) setTimeout(function () { f.focus(); }, 50);
    return $('.sheet-card', s);
  }
  function closeSheet(silent) { var r = $('#sheetRoot'); if (r.innerHTML) { r.innerHTML = ''; document.body.style.overflow = ''; if (!silent && onClose) { var f = onClose; onClose = null; f(); } } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  function head(title, sub) { return '<div class="sheet-top"><div class="sheet-who"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div><button class="x" type="button" data-close aria-label="Close">' + I.x + '</button></div>'; }
  function formErr(card, msg) { var e = $('.err', card); if (e) { e.textContent = msg; e.hidden = !msg; } else toast(msg); }

  /* ───────── shell ───────── */
  function paintTheme() {
    var dark = document.body.classList.contains('dark');
    $('#themeBtn').innerHTML = dark ? I.sun : I.moon;
    var m = $('meta[name=theme-color]'); if (m) m.content = dark ? '#0a0d0a' : '#e9e9e9';
  }
  function toggleTheme() { var d = document.body.classList.toggle('dark'); try { localStorage.setItem('dues_theme', d ? 'dark' : 'light'); } catch (e) { } paintTheme(); }
  $('#themeBtn').onclick = toggleTheme;
  $('#logoutBtn').onclick = signOut;
  function signOut() { api('POST', '/api/logout').then(function () { location.replace('/login'); }, function () { location.replace('/login'); }); }
  $('#searchBtn').onclick = function () {
    var b = $('#searchBar'), open = !b.classList.contains('open');
    b.classList.toggle('open', open); this.setAttribute('aria-expanded', String(open));
    if (open) $('#q').focus(); else if (query) { query = ''; $('#q').value = ''; render(); }
  };
  var qt = 0;
  $('#q').oninput = function () {
    clearTimeout(qt);
    qt = setTimeout(function () { query = $('#q').value.trim(); if (view !== 'invoices' && view !== 'clients') { view = 'invoices'; invFilter = 'all'; } render(); }, 220);
  };
  $('#tabs').onclick = function (e) { var b = e.target.closest('.tab'); if (b) go(b.dataset.v); };
  $('#avatar').onclick = accountSheet;
  function go(v, filter) {
    view = v; if (filter) invFilter = filter;
    $$('.tab').forEach(function (t) { var on = t.dataset.v === v; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
    try { history.replaceState(null, '', '#' + v); } catch (e) { }
    window.scrollTo(0, 0);
    render();
  }
  function setFuCount(n) { FU_COUNT = n; var b = $('#fuN'); b.textContent = n; b.hidden = !n; }
  function render() {
    var fn = { overview: overview, invoices: invoices, followups: followups, clients: clients, settings: settings }[view] || overview;
    fn();
  }
  function fail(e) { $('#view').innerHTML = '<div class="cards" style="margin-top:16px"><div class="empty"><b>Could not load this</b>' + esc(e.message) + '<br><button class="btn solid" type="button" id="retry">Try again</button></div></div>'; $('#retry').onclick = render; }

  /* ───────── OVERVIEW ───────── */
  var balMode = 'out';
  function overview() {
    Promise.all([api('GET', '/api/summary'), api('GET', '/api/followups'), api('GET', '/api/activity')]).then(function (r) {
      var S = r[0], F = r[1], A = r[2].events;
      setFuCount(F.followups.length);
      if (view !== 'overview') return;
      var firstRun = !S.invoices;
      var ringLen = 327, pct = S.collection_rate;
      var h = '<div class="bento">';
      // balance
      h += '<section class="card c-balance" aria-label="Money owed to you"><div class="bal-top"><div class="seg" role="group" aria-label="Show"><button type="button" data-b="out" class="' + (balMode === 'out' ? 'on' : '') + '">Outstanding</button><button type="button" data-b="late" class="' + (balMode === 'late' ? 'on' : '') + '">Overdue</button></div>' +
        '<div class="acct"><span>Business</span><strong>' + esc(ME.settings.business || ME.user.name) + '</strong></div></div>' +
        '<div class="lbl" id="bigLbl"></div><div class="big" id="bigNum"></div>' +
        '<div class="actions"><button class="btn solid" type="button" id="newInv">New invoice</button><button class="btn ghost" type="button" id="toFu">' + (F.followups.length ? 'Remind ' + F.followups.length : 'Remind') + '</button></div>' +
        '<button class="fab" type="button" id="toInv" aria-label="All invoices">' + I.arrow + '</button></section>';
      // lime
      h += '<section class="card c-lime" aria-label="This month">' + STAR + '<div style="display:flex;align-items:center;margin-bottom:22px;position:relative"><button class="pill-dark" type="button" id="limeNew">THIS MONTH <i>+</i></button></div>' +
        '<div class="lbl" style="position:relative">Collected this month</div><div class="big2"><span><span class="cur">' + esc(cur()) + '</span>' + fmt(Math.round(S.collected_month)) + '</span> <span class="chip">' + plural(S.payments_month, 'payment') + '</span></div>' +
        '<div class="tiles"><button class="tile" type="button" data-go="invoices:paid" style="text-align:left"><span>Collection rate</span><strong>' + S.collection_rate + '%</strong></button>' +
        '<button class="tile" type="button" data-go="clients" style="text-align:left"><span>Avg days to pay</span><strong>' + (S.avg_days_to_pay == null ? '–' : S.avg_days_to_pay) + '</strong></button></div></section>';
      // donut
      h += '<section class="card c-donut" aria-label="Collected so far"><div class="ch"><span class="ic">' + I.ring + '</span><h2>Collected</h2><button class="act" type="button" id="impBtn">Import</button></div>' +
        '<div class="donut"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="trk" cx="60" cy="60" r="52" fill="none" stroke-width="12"/><circle class="val" id="ring" cx="60" cy="60" r="52" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="0 ' + ringLen + '"/></svg>' +
        '<div class="mid"><b>' + pct + '%</b><span>of ' + money(S.billed) + ' billed</span></div></div>' +
        '<div class="note">' + I.check + '<span>' + (S.promised > 0 ? '<b>' + money(S.promised) + '</b> promised by clients' : S.invoices ? '<b>' + money(S.collected_all) + '</b> collected so far' : 'Add an invoice to start') + '</span></div></section>';
      // ageing bars
      var maxA = Math.max.apply(null, S.ageing.map(function (a) { return a.amount; }).concat([1]));
      h += '<section class="card c-bars" aria-label="How late"><div class="ch"><span class="ic">' + I.bars + '</span><h2>Ageing</h2></div>' +
        '<div class="stat-row"><div class="stat-big">' + S.overdue_count + '</div><span class="lbl">' + (S.overdue_count === 1 ? 'invoice is' : 'invoices are') + ' late</span></div><div class="bars">' +
        S.ageing.map(function (a, i) {
          return '<div><div class="bar-h"><span>' + esc(a.label) + '</span><span>' + money(a.amount) + (a.count ? ' · ' + a.count : '') + '</span></div><div class="track"><div class="fill' + (i === 0 ? '' : i >= 3 ? ' r' : ' o') + '" style="width:' + (a.amount / maxA * 100).toFixed(1) + '%"></div></div></div>';
        }).join('') + '</div></section>';
      // today
      var alerts = F.missed_promises.slice(0, 2).map(function (m) {
        return '<div class="alert"><span class="ic">' + I.alert + '</span><div class="tx"><b>' + esc(m.client_name) + '</b><span>Promise missed · ' + esc(day(m.promise_on)) + ' · ' + money(m.amount - m.paid) + '</span></div><button class="go" type="button" data-inv="' + esc(m.id) + '" aria-label="Open">' + I.arrow + '</button></div>';
      }).join('');
      var rows = F.followups.slice(0, 4).map(function (f) {
        var t = TONE[f.tone] || TONE.firm;
        return '<button class="row" type="button" data-fu="' + esc(f.id) + '"><span class="ic ' + t[1] + '">' + initials(f.client_name) + '</span><span class="tx"><b>' + esc(f.client_name) + '</b><span>' + esc(f.number) + ' · ' + t[0] + (f.late_days ? ' · ' + f.late_days + 'd late' : '') + '</span></span><span class="rt' + (f.late_days ? ' o' : '') + '">' + money(f.balance) + '</span></button>';
      }).join('');
      h += '<section class="card c-recent" aria-label="Today"><div class="ch"><span class="ic">' + I.clock + '</span><h2>Today</h2>' + (F.followups.length > 4 ? '<button class="act" type="button" data-go="followups">All ' + F.followups.length + '</button>' : '') + '</div>' + alerts +
        (rows || (alerts ? '' : '<div class="row"><span class="ic cat-t">' + I.check + '</span><span class="tx"><b>All caught up</b><span>' + (F.sent_today ? plural(F.sent_today, 'reminder') + ' sent today' : 'No one to remind today') + '</span></span></div>')) + '</section>';
      h += '</div>';
      // forecast + activity
      if (!firstRun) {
        var maxF = Math.max.apply(null, S.forecast.map(function (w) { return w.amount; }).concat([1]));
        h += '<div class="list-h"><h2>Expected to come in</h2><span class="chip">4 weeks</span></div><div class="cards"><section class="card" style="grid-column:1/-1"><div class="bars" style="margin-top:0">' +
          S.forecast.map(function (w, i) { return '<div><div class="bar-h"><span>' + (i === 0 ? 'This week' : day(w.from) + ' – ' + day(w.to)) + '</span><span>' + money(w.amount) + '</span></div><div class="track"><div class="fill" style="width:' + (w.amount / maxF * 100).toFixed(1) + '%"></div></div></div>'; }).join('') +
          '</div><p class="lbl" style="margin-top:14px;line-height:1.5">Based on due dates and promises. Overdue money is counted in this week.</p></section></div>';
        h += '<div class="list-h"><h2>Recent activity</h2></div><div class="cards"><section class="card" style="grid-column:1/-1;padding-top:8px;padding-bottom:8px">' + (A.length ? A.slice(0, 8).map(function (e) {
          return '<button class="row" type="button" data-inv="' + esc(e.invoice_id || '') + '"><span class="ic ' + (/paid/.test(e.kind) ? 'cat-t' : /missed|void|failed/.test(e.kind) ? 'cat-f' : 'cat-g') + '">' + (/paid/.test(e.kind) ? I.check : /reminder/.test(e.kind) ? I.send : I.list) + '</span><span class="tx"><b>' + esc(EVENTS[e.kind] || e.kind) + (e.kind === 'promise' ? ' ' + esc(day(e.detail.slice(0, 10))) : '') + '</b><span>' + esc([e.client_name, e.number].filter(Boolean).join(' · ')) + '</span></span><span class="rt m">' + esc(when(e.created_at)) + '</span></button>';
        }).join('') : '<div class="row"><span class="tx"><span>Nothing yet.</span></span></div>') + '</section></div>';
      } else {
        h += '<div class="list-h"><h2>Get started</h2></div><div class="cards"><div class="empty"><b>Add your first invoice</b>Dues reminds your clients on WhatsApp or email before and after the due date, and stops as soon as they pay.<br>' +
          '<button class="btn solid" type="button" id="firstInv">New invoice</button> <button class="btn soft" type="button" id="firstImp">Import CSV</button></div></div>';
      }
      $('#view').innerHTML = h;
      function paintBal() {
        $('#bigLbl').textContent = balMode === 'out' ? 'Outstanding · ' + plural(S.open_count, 'open invoice') : 'Overdue · ' + plural(S.overdue_count, 'late invoice');
        $('#bigNum').innerHTML = bigMoney(balMode === 'out' ? S.outstanding : S.overdue); fitBig($('#bigNum'));
        $$('[data-b]').forEach(function (b) { b.classList.toggle('on', b.dataset.b === balMode); });
      }
      paintBal();
      $$('[data-b]').forEach(function (b) { b.onclick = function () { balMode = b.dataset.b; paintBal(); }; });
      requestAnimationFrame(function () { var r = $('#ring'); if (r) r.setAttribute('stroke-dasharray', (pct / 100 * ringLen).toFixed(1) + ' ' + ringLen); });
      $('#newInv').onclick = $('#limeNew').onclick = function () { invoiceForm(); };
      $('#toFu').onclick = function () { go('followups'); };
      $('#toInv').onclick = function () { go('invoices', 'open'); };
      $('#impBtn').onclick = importSheet;
      if ($('#firstInv')) { $('#firstInv').onclick = function () { invoiceForm(); }; $('#firstImp').onclick = importSheet; }
      bindCommon();
    }).catch(fail);
  }
  function bindCommon() {
    $$('[data-inv]').forEach(function (b) { if (b.dataset.inv) b.onclick = function () { openInvoice(b.dataset.inv); }; });
    $$('[data-go]').forEach(function (b) { b.onclick = function () { var p = b.dataset.go.split(':'); go(p[0], p[1]); }; });
    $$('[data-fu]').forEach(function (b) { b.onclick = function () { go('followups'); }; });
    $$('[data-client]').forEach(function (b) { b.onclick = function () { openClient(b.dataset.client); }; });
  }

  /* ───────── INVOICES ───────── */
  var FILTERS = [['open', 'Open'], ['overdue', 'Overdue'], ['promised', 'Promised'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All']];
  function invCard(i) {
    var cls = i.status === 'paid' ? 'cat-t' : i.status === 'void' ? 'cat-g' : i.overdue ? 'cat-f' : i.promised ? 'cat-k' : 'cat-t';
    var tags = [];
    if (i.status === 'paid') tags.push('<span class="chip">Paid ' + esc(day(i.paid_on)) + '</span>');
    else if (i.status === 'void') tags.push('<span class="chip g">Void</span>');
    else {
      if (i.overdue) tags.push('<span class="chip o">' + i.late_days + ' days late</span>');
      else tags.push('<span class="chip g">Due ' + esc(day(i.due_on)) + '</span>');
      if (i.promised) tags.push('<span class="chip k">Promised ' + esc(day(i.promise_on)) + '</span>');
      if (i.paid > 0) tags.push('<span class="tag">' + money(i.paid) + ' paid</span>');
    }
    if (!i.client_phone && !i.client_email && i.status === 'open') tags.push('<span class="tag">No contact</span>');
    var part = i.status === 'open' && i.paid > 0;
    return '<button class="sec" type="button" data-inv="' + esc(i.id) + '"><div class="sec-top"><span class="ic ' + cls + '">' + initials(i.client_name) + '</span><span class="nm"><small>' + esc(i.number) + ' · ' + esc(dayY(i.issued_on)) + '</small><b>' + esc(i.client_name) + '</b></span>' +
      '<span class="amt">' + money(i.status === 'open' ? i.balance : i.amount) + (part ? '<small>of ' + money(i.amount) + '</small>' : i.status === 'open' ? '<small>due</small>' : '') + '</span></div>' +
      (i.description ? '<p>' + esc(i.description) + '</p>' : '') + (part ? '<div class="track"><div class="fill" style="width:' + (i.paid / i.amount * 100).toFixed(1) + '%"></div></div>' : '') +
      '<div class="tags">' + tags.join('') + '</div></button>';
  }
  function invoices() {
    var qs = '/api/invoices?status=' + encodeURIComponent(invFilter) + (query ? '&q=' + encodeURIComponent(query) : '');
    api('GET', qs).then(function (d) {
      if (view !== 'invoices') return;
      var list = d.invoices, total = list.reduce(function (a, i) { return a + (i.status === 'open' ? i.balance : i.amount); }, 0);
      var h = '<div class="list-h"><h2>Invoices</h2><span class="chip">' + list.length + '</span><span class="grow"></span><button class="btn soft sm" type="button" id="imp">Import</button><button class="btn solid sm" type="button" id="new">New invoice</button></div>' +
        '<div class="filters" role="tablist">' + FILTERS.map(function (f) { return '<button type="button" role="tab" data-f="' + f[0] + '" class="' + (invFilter === f[0] ? 'on' : '') + '" aria-selected="' + (invFilter === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div>';
      if (query) h += '<p class="lbl" style="margin:0 2px 12px">Results for “' + esc(query) + '” · <button type="button" id="clearQ" style="color:var(--pos)">Clear</button></p>';
      if (list.length && invFilter !== 'void') h += '<p class="lbl" style="margin:0 2px 12px">' + (invFilter === 'paid' ? 'Total ' : 'Total due ') + '<b style="color:var(--ink);font-weight:500">' + money(total) + '</b></p>';
      h += '<div class="cards">' + (list.length ? list.map(invCard).join('') :
        '<div class="empty"><b>' + (query ? 'No matches' : invFilter === 'open' ? 'Nothing owed right now' : 'Nothing here') + '</b>' + (invFilter === 'open' && !query ? 'Add an invoice and Dues will follow up for you.<br><button class="btn solid" type="button" id="new2">New invoice</button>' : '') + '</div>') + '</div>';
      $('#view').innerHTML = h;
      $('#new').onclick = function () { invoiceForm(); }; $('#imp').onclick = importSheet;
      if ($('#new2')) $('#new2').onclick = function () { invoiceForm(); };
      if ($('#clearQ')) $('#clearQ').onclick = function () { query = ''; $('#q').value = ''; render(); };
      $$('[data-f]').forEach(function (b) { b.onclick = function () { invFilter = b.dataset.f; invoices(); }; });
      bindCommon();
    }).catch(fail);
  }

  function invoiceForm(cur0, presetClient) {
    var editing = !!cur0;
    api('GET', '/api/clients').then(function (d) {
      var cl = d.clients, today = todayIst();
      var opts = '<option value="">+ New client</option>' + cl.map(function (c) { return '<option value="' + esc(c.id) + '"' + ((presetClient === c.id || (cur0 && cur0.client_id === c.id)) ? ' selected' : '') + '>' + esc(c.name) + (c.company ? ' · ' + esc(c.company) : '') + '</option>'; }).join('');
      var card = sheet(head(editing ? 'Edit ' + cur0.number : 'New invoice', editing ? cur0.client_name : 'Dues will remind them before and after the due date') +
        '<form class="form" id="f" novalidate>' +
        (editing ? '' : '<label class="field"><span>Client</span><select id="cid">' + opts + '</select></label>' +
          '<div id="newc" class="form"><label class="field"><span>Client name</span><input id="cn" maxlength="80" placeholder="Ravi Kumar" autocomplete="off"></label>' +
          '<div class="two"><label class="field"><span>WhatsApp number</span><input id="cp" type="tel" inputmode="tel" maxlength="20" placeholder="98765 43210"></label><label class="field"><span>Email</span><input id="ce" type="email" inputmode="email" maxlength="120" placeholder="optional"></label></div></div>') +
        '<div class="two"><label class="field"><span>Amount (' + esc(cur()) + ')</span><input id="am" inputmode="decimal" placeholder="25,000" value="' + (editing ? cur0.amount : '') + '"></label>' +
        '<label class="field"><span>Invoice number</span><input id="no" maxlength="30" placeholder="Auto" value="' + (editing ? esc(cur0.number) : '') + '"></label></div>' +
        '<label class="field"><span>What it’s for</span><input id="ds" maxlength="300" placeholder="Brand identity, October retainer…" value="' + (editing ? esc(cur0.description) : '') + '"></label>' +
        '<div class="two"><label class="field"><span>Issued</span><input id="is" type="date" value="' + (editing ? cur0.issued_on : today) + '"></label><label class="field"><span>Due</span><input id="du" type="date" value="' + (editing ? cur0.due_on : addDays(today, 15)) + '"></label></div>' +
        (editing ? '' : '<div class="filters" style="margin:0" id="terms">' + [7, 15, 30, 45].map(function (n) { return '<button type="button" data-t="' + n + '" class="' + (n === 15 ? 'on' : '') + '">' + n + ' days</button>'; }).join('') + '</div>') +
        '<p class="err" hidden></p><button class="btn solid full" type="submit" id="save">' + (editing ? 'Save changes' : 'Create invoice') + '</button></form>');
      var nc = $('#newc', card), cid = $('#cid', card);
      function showNew() { if (nc) nc.hidden = !!(cid && cid.value); }
      if (cid) { cid.onchange = showNew; showNew(); }
      var terms = $('#terms', card);
      if (terms) terms.onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; $$('[data-t]', terms).forEach(function (x) { x.classList.toggle('on', x === b); }); $('#du', card).value = addDays($('#is', card).value || today, +b.dataset.t); };
      $('#f', card).onsubmit = function (e) {
        e.preventDefault(); formErr(card, '');
        var b = { amount: $('#am', card).value, number: $('#no', card).value.trim() || undefined, description: $('#ds', card).value.trim(), issued_on: $('#is', card).value, due_on: $('#du', card).value };
        if (!editing) { if (cid.value) b.client_id = cid.value; else { b.client_name = $('#cn', card).value.trim(); b.client_phone = $('#cp', card).value.trim(); b.client_email = $('#ce', card).value.trim(); if (!b.client_name) return formErr(card, 'Choose a client or type a name.'); } }
        if (!b.amount) return formErr(card, 'Enter the amount.');
        if (editing && !b.number) b.number = cur0.number;
        var btn = $('#save', card); btn.disabled = true;
        api(editing ? 'PATCH' : 'POST', editing ? '/api/invoices/' + cur0.id : '/api/invoices', b).then(function (inv) {
          toast(editing ? 'Saved' : inv.number + ' created'); closeSheet(true); render(); openInvoice(inv.id);
        }).catch(function (x) { btn.disabled = false; formErr(card, x.message); });
      };
    }).catch(function (e) { toast(e.message); });
  }

  function openInvoice(id) {
    api('GET', '/api/invoices/' + id).then(function (d) {
      var i = d.invoice, open = i.status === 'open', link = payUrl(i.pay_token);
      var chips = i.status === 'paid' ? '<span class="chip">Paid ' + esc(dayY(i.paid_on)) + '</span>' : i.status === 'void' ? '<span class="chip g">Void</span>' : (i.overdue ? '<span class="chip o">' + i.late_days + ' days late</span>' : '<span class="chip g">Due ' + esc(dayY(i.due_on)) + '</span>');
      if (i.promised) chips += ' <span class="chip k">Promised ' + esc(day(i.promise_on)) + '</span>';
      var h = head(i.client_name, i.number + (i.description ? ' · ' + i.description : '')) +
        '<div class="tags" style="margin:-6px 0 6px">' + chips + '</div>' +
        '<div class="kv"><div><span>Amount</span><strong>' + money(i.amount) + '</strong></div><div><span>' + (open ? 'Left to pay' : 'Paid') + '</span><strong>' + money(open ? i.balance : i.paid) + '</strong></div>' +
        '<div><span>Issued</span><strong>' + esc(dayY(i.issued_on)) + '</strong></div><div><span>Due</span><strong>' + esc(dayY(i.due_on)) + '</strong></div></div>' +
        (i.paid > 0 && open ? '<div class="track" style="margin:4px 0 14px"><div class="fill" style="width:' + (i.paid / i.amount * 100).toFixed(1) + '%"></div></div>' : '') +
        (i.promised ? '<div class="panel"><div class="lbl">Promise to pay</div>By <b style="font-weight:500">' + esc(dayY(i.promise_on)) + '</b>' + (i.promise_note ? ' · ' + esc(i.promise_note) : '') + '. Reminders are paused until then.</div>' : '') +
        (open ? '<div class="sheet-actions"><button class="btn lime" type="button" id="remind">' + I.send + 'Remind now</button><button class="btn solid" type="button" id="pay">Record payment</button></div>' +
          '<div class="sheet-actions" style="margin-top:10px"><button class="btn soft" type="button" id="promise">' + (i.promised ? 'Change promise' : 'Promise to pay') + '</button><button class="btn soft" type="button" id="plink">' + I.link + 'Pay link</button></div>' : '') +
        (d.payments.length ? '<div class="section-h">Payments</div><div>' + d.payments.map(function (p) {
          return '<div class="row"><span class="ic cat-t">' + I.check + '</span><span class="tx"><b>' + money(p.amount) + '</b><span>' + esc(dayY(p.paid_on)) + ' · ' + esc(p.method) + (p.ref ? ' · ' + esc(p.ref) : '') + '</span></span>' + (i.status !== 'void' ? '<button class="btn soft sm" type="button" data-rmpay="' + esc(p.id) + '">Remove</button>' : '') + '</div>';
        }).join('') + '</div>' : '') +
        '<div class="section-h">History</div><ul class="timeline">' + d.events.map(function (e) {
          var cls = /paid_|promise$/.test(e.kind) ? '' : /missed|void|failed|removed/.test(e.kind) ? 'o' : 'g';
          return '<li><span class="dot ' + cls + '"></span><div><b style="font-weight:400">' + esc(EVENTS[e.kind] || e.kind) + (e.kind === 'promise' ? ' ' + esc(dayY(e.detail.slice(0, 10))) : '') + '</b>' +
            '<small>' + esc(when(e.created_at)) + (e.detail && e.kind !== 'promise' ? ' · ' + esc(e.detail) : e.kind === 'promise' && e.detail.length > 10 ? ' · ' + esc(e.detail.slice(13)) : '') + '</small></div></li>';
        }).join('') + '</ul>' +
        (i.status !== 'void' ? '<div class="sheet-actions" style="margin-top:16px">' + (i.status !== 'paid' ? '<button class="btn soft" type="button" id="edit">Edit</button>' : '') + (open ? '<button class="btn danger" type="button" id="void">Void</button>' : '') + '</div>' : '');
      var card = sheet(h);
      onClose = function () { render(); };
      if (open) {
        $('#remind', card).onclick = function () { remindFlow(i); };
        $('#pay', card).onclick = function () { paymentForm(i); };
        $('#promise', card).onclick = function () { promiseForm(i); };
        $('#plink', card).onclick = function () {
          var c = sheet(head('Pay link', 'Your client opens this to pay ' + money(i.balance)) + '<div class="msg">' + esc(link) + '</div>' +
            '<div class="sheet-actions"><button class="btn solid" type="button" id="cp">Copy link</button><a class="btn soft" href="' + esc(link) + '" target="_blank" rel="noopener">Open</a></div>' +
            (ME.settings.upi ? '' : '<p class="lbl" style="margin-top:12px;line-height:1.5">Add your UPI ID in Settings so clients can pay in one tap from this page.</p>'));
          $('#cp', c).onclick = function () { copy(link, 'Pay link copied'); };
          onClose = function () { openInvoice(i.id); };
        };
      }
      $$('[data-rmpay]', card).forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap to confirm'; return; }
          api('DELETE', '/api/invoices/' + i.id + '/payments/' + b.dataset.rmpay).then(function () { toast('Payment removed'); openInvoice(i.id); }).catch(function (x) { toast(x.message); });
        };
      });
      var ed = $('#edit', card); if (ed) ed.onclick = function () { invoiceForm(i); };
      var vd = $('#void', card); if (vd) vd.onclick = function () {
        if (vd.dataset.sure !== '1') { vd.dataset.sure = '1'; vd.textContent = 'Tap again to void'; return; }
        api('POST', '/api/invoices/' + i.id + '/void', {}).then(function () { toast(i.number + ' voided'); openInvoice(i.id); }).catch(function (x) { toast(x.message); });
      };
    }).catch(function (e) { toast(e.message); });
  }

  function remindFlow(i) {
    api('POST', '/api/invoices/' + i.id + '/remind', {}).then(function (r) {
      var card = sheet(head('Remind ' + (i.client_name || ''), (TONE[r.tone] || TONE.firm)[0] + ' message · edit it if you like') +
        '<label class="field"><span>Message</span><textarea id="m" rows="6">' + esc(r.message) + '</textarea></label>' +
        '<div class="sheet-actions" style="margin-top:12px">' + (r.phone ? '<a class="btn lime" id="wa" href="#" target="_blank" rel="noopener">' + I.msg + 'WhatsApp</a>' : '') +
        (r.email ? '<a class="btn solid" id="em" href="#">Email</a>' : '') + '<button class="btn soft" type="button" id="cp">Copy</button></div>' +
        (!r.phone && !r.email ? '<p class="lbl" style="margin-top:12px;line-height:1.5">This client has no WhatsApp number or email. Copy the message, or add their contact in Clients.</p>' : ''));
      onClose = function () { openInvoice(i.id); };
      function done(ch) { api('POST', '/api/invoices/' + i.id + '/reminded', { tone: r.tone, channel: ch }).then(function () { toast('Reminder logged'); }).catch(function () { }); }
      var wa = $('#wa', card); if (wa) wa.onclick = function () { wa.href = waLink(r.phone, $('#m', card).value); done('whatsapp'); };
      var em = $('#em', card); if (em) em.onclick = function () { em.href = 'mailto:' + encodeURIComponent(r.email) + '?subject=' + encodeURIComponent('Invoice ' + i.number) + '&body=' + encodeURIComponent($('#m', card).value); done('email'); };
      $('#cp', card).onclick = function () { copy($('#m', card).value, 'Message copied'); };
    }).catch(function (e) { toast(e.message); });
  }
  function paymentForm(i) {
    var card = sheet(head('Record payment', i.number + ' · ' + money(i.balance) + ' left') + '<form class="form" id="f" novalidate>' +
      '<div class="two"><label class="field"><span>Amount (' + esc(cur()) + ')</span><input id="am" inputmode="decimal" value="' + i.balance + '"></label><label class="field"><span>Paid on</span><input id="dt" type="date" value="' + todayIst() + '"></label></div>' +
      '<div class="two"><label class="field"><span>How</span><select id="me"><option value="upi">UPI</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>' +
      '<label class="field"><span>Reference</span><input id="rf" maxlength="80" placeholder="UTR / cheque no."></label></div>' +
      '<p class="err" hidden></p><button class="btn solid full" type="submit" id="save">Save payment</button></form>');
    onClose = function () { openInvoice(i.id); };
    $('#f', card).onsubmit = function (e) {
      e.preventDefault(); formErr(card, ''); var btn = $('#save', card); btn.disabled = true;
      api('POST', '/api/invoices/' + i.id + '/payments', { amount: $('#am', card).value, paid_on: $('#dt', card).value, method: $('#me', card).value, ref: $('#rf', card).value.trim() })
        .then(function (n) { toast(n.status === 'paid' ? 'Paid in full. Reminders stopped.' : money(n.balance) + ' still to pay'); closeSheet(true); render(); openInvoice(i.id); })
        .catch(function (x) { btn.disabled = false; formErr(card, x.message); });
    };
  }
  function promiseForm(i) {
    var t = todayIst();
    var card = sheet(head('Promise to pay', 'Reminders pause until this date. If it passes unpaid, Dues flags it and starts again.') + '<form class="form" id="f" novalidate>' +
      '<label class="field"><span>They will pay by</span><input id="dt" type="date" min="' + t + '" value="' + (i.promise_on && i.promise_on >= t ? i.promise_on : addDays(t, 7)) + '"></label>' +
      '<label class="field"><span>Note</span><input id="nt" maxlength="200" placeholder="e.g. after their client pays them" value="' + esc(i.promise_note || '') + '"></label>' +
      '<p class="err" hidden></p><button class="btn solid full" type="submit" id="save">Save promise</button>' + (i.promised ? '<button class="btn soft full" type="button" id="clear">Remove promise</button>' : '') + '</form>');
    onClose = function () { openInvoice(i.id); };
    $('#f', card).onsubmit = function (e) {
      e.preventDefault(); formErr(card, ''); var btn = $('#save', card); btn.disabled = true;
      api('POST', '/api/invoices/' + i.id + '/promise', { date: $('#dt', card).value, note: $('#nt', card).value.trim() }).then(function () { toast('Promise saved'); closeSheet(true); openInvoice(i.id); })
        .catch(function (x) { btn.disabled = false; formErr(card, x.message); });
    };
    var cl = $('#clear', card); if (cl) cl.onclick = function () { api('DELETE', '/api/invoices/' + i.id + '/promise').then(function () { toast('Promise removed'); closeSheet(true); openInvoice(i.id); }).catch(function (x) { formErr(card, x.message); }); };
  }
  function importSheet() {
    var card = sheet(head('Import invoices', 'From Excel, Tally, Zoho or Google Sheets: save as CSV') +
      '<div class="panel"><div class="lbl">Columns Dues understands</div><span style="font-size:13px;line-height:1.6">client, amount, due · plus optional number, phone, email, company, issued, description, paid. Dates like 15/09/2026 or 2026-09-15.</span></div>' +
      '<form class="form" id="f" novalidate><label class="field"><span>Choose a CSV file</span><input id="file" type="file" accept=".csv,text/csv" style="padding-top:13px"></label>' +
      '<label class="field"><span>…or paste it</span><textarea id="csv" rows="6" placeholder="number,client,phone,amount,due&#10;INV-101,Ravi Kumar,9876543210,25000,15/11/2026"></textarea></label>' +
      '<p class="err" hidden></p><div id="res"></div><button class="btn solid full" type="submit" id="save">Import</button></form>');
    $('#file', card).onchange = function () { var f = this.files[0]; if (!f) return; if (f.size > 180000) return formErr(card, 'That file is too big. Split it into parts of up to 500 rows.'); var r = new FileReader(); r.onload = function () { $('#csv', card).value = r.result; }; r.readAsText(f); };
    $('#f', card).onsubmit = function (e) {
      e.preventDefault(); formErr(card, ''); var csv = $('#csv', card).value.trim(); if (!csv) return formErr(card, 'Choose a file or paste the CSV.');
      var btn = $('#save', card); btn.disabled = true; btn.textContent = 'Importing…';
      api('POST', '/api/invoices/import', { csv: csv }).then(show, function (x) { if (x.data && x.data.errors) show(x.data); else { formErr(card, x.message); } btn.disabled = false; btn.textContent = 'Import'; });
      function show(d) {
        $('#res', card).innerHTML = '<div class="panel"><b style="font-weight:500">' + plural(d.imported, 'invoice') + ' imported</b>' + (d.errors.length ? '<div class="lbl" style="margin-top:6px">' + d.errors.slice(0, 8).map(function (x) { return 'Row ' + x.row + ': ' + esc(x.error); }).join('<br>') + (d.errors.length > 8 ? '<br>…and ' + (d.errors.length - 8) + ' more' : '') + '</div>' : '') + '</div>';
        if (d.imported) { btn.textContent = 'Done'; btn.disabled = false; btn.onclick = function (ev) { ev.preventDefault(); closeSheet(); go('invoices', 'open'); }; }
      }
    };
  }

  /* ───────── FOLLOW-UPS ───────── */
  function followups() {
    api('GET', '/api/followups').then(function (F) {
      setFuCount(F.followups.length);
      if (view !== 'followups') return;
      var emails = F.followups.filter(function (f) { return f.channel === 'email' && f.client_email; }).length;
      var h = '<div class="list-h"><h2>Today’s follow-ups</h2><span class="chip">' + F.followups.length + '</span><span class="grow"></span>' + (ME.email_ready && emails ? '<button class="btn solid sm" type="button" id="sendAll">Send ' + plural(emails, 'email') + '</button>' : '') + '</div>';
      h += F.missed_promises.map(function (m) {
        return '<div class="alert"><span class="ic">' + I.alert + '</span><div class="tx"><b>' + esc(m.client_name) + ' missed their promise</b><span>' + esc(m.number) + ' · promised ' + esc(day(m.promise_on)) + ' · ' + money(m.amount - m.paid) + '</span></div><button class="go" type="button" data-inv="' + esc(m.id) + '" aria-label="Open invoice">' + I.arrow + '</button></div>';
      }).join('');
      if (F.sent_today) h += '<p class="lbl" style="margin:4px 2px 12px">' + plural(F.sent_today, 'reminder') + ' sent today.</p>';
      h += '<div class="cards">' + (F.followups.length ? F.followups.map(function (f) {
        var t = TONE[f.tone] || TONE.firm;
        var btns = (f.client_phone ? '<a class="btn lime sm" href="' + esc(waLink(f.client_phone, f.message)) + '" target="_blank" rel="noopener" data-send="' + esc(f.id) + '">' + I.msg + 'WhatsApp</a>' : '') +
          (f.client_email ? '<a class="btn solid sm" href="mailto:' + esc(f.client_email) + '?subject=' + encodeURIComponent('Invoice ' + f.number) + '&body=' + encodeURIComponent(f.message) + '" data-send="' + esc(f.id) + '">Email</a>' : '') +
          '<button class="btn soft sm" type="button" data-copy="' + esc(f.id) + '">Copy</button>' + (!f.client_phone && !f.client_email ? '<button class="btn soft sm" type="button" data-send="' + esc(f.id) + '">Mark sent</button>' : '') +
          '<button class="btn soft sm" type="button" data-skip="' + esc(f.id) + '">Skip</button>';
        return '<div class="sec" data-fid="' + esc(f.id) + '"><div class="sec-top"><span class="ic ' + t[1] + '">' + initials(f.client_name) + '</span><span class="nm"><small>' + t[0] + ' · ' + esc(f.number) + (f.late_days ? ' · ' + f.late_days + 'd late' : '') + '</small><b>' + esc(f.client_name) + '</b></span><span class="amt">' + money(f.balance) + '</span></div>' +
          '<div class="msg">' + esc(f.message) + '</div><div class="tags">' + btns + '</div><div class="tags" style="margin-top:8px"><button type="button" class="tag" data-inv="' + esc(f.invoice_id) + '">Open invoice</button></div></div>';
      }).join('') : '<div class="empty"><b>All caught up</b>Nobody needs a reminder today. Dues checks every morning and lines up the next ones here.</div>') + '</div>';
      $('#view').innerHTML = h;
      var byId = {}; F.followups.forEach(function (f) { byId[f.id] = f; });
      $$('[data-send]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.dataset.send;
          api('POST', '/api/followups/' + id + '/sent').then(function () { var c = $('[data-fid="' + id + '"]'); if (c) c.remove(); setFuCount(Math.max(0, FU_COUNT - 1)); toast('Marked as sent'); }).catch(function (x) { toast(x.message); });
        });
      });
      $$('[data-copy]').forEach(function (b) { b.onclick = function () { copy(byId[b.dataset.copy].message, 'Message copied'); }; });
      $$('[data-skip]').forEach(function (b) { b.onclick = function () { api('POST', '/api/followups/' + b.dataset.skip + '/skip').then(function () { var c = $('[data-fid="' + b.dataset.skip + '"]'); if (c) c.remove(); setFuCount(Math.max(0, FU_COUNT - 1)); toast('Skipped'); }).catch(function (x) { toast(x.message); }); }; });
      var sa = $('#sendAll'); if (sa) sa.onclick = function () { sa.disabled = true; api('POST', '/api/followups/send-email').then(function (d) { toast(plural(d.sent, 'email') + ' sent'); followups(); }).catch(function (x) { sa.disabled = false; toast(x.message); }); };
      bindCommon();
    }).catch(fail);
  }

  /* ───────── CLIENTS ───────── */
  function clients() {
    api('GET', '/api/clients').then(function (d) {
      if (view !== 'clients') return;
      var q = query.toLowerCase();
      var list = d.clients.filter(function (c) { return !q || (c.name + ' ' + c.company + ' ' + c.phone + ' ' + c.email).toLowerCase().indexOf(q) > -1; });
      var h = '<div class="list-h"><h2>Clients</h2><span class="chip">' + list.length + '</span><span class="grow"></span><button class="btn solid sm" type="button" id="add">Add client</button></div>';
      h += '<div class="cards">' + (list.length ? list.map(function (c) {
        return '<button class="sec" type="button" data-client="' + esc(c.id) + '"><div class="sec-top"><span class="ic ' + (c.overdue > 0 ? 'cat-f' : c.owed > 0 ? 'cat-k' : 'cat-t') + '">' + initials(c.name) + '</span><span class="nm"><small>' + esc(c.company || ph(c.phone) || c.email || 'No contact yet') + '</small><b>' + esc(c.name) + '</b></span>' +
          '<span class="amt">' + money(c.owed) + '<small>' + (c.overdue > 0 ? money(c.overdue) + ' late' : 'owed') + '</small></span></div>' +
          '<div class="tags"><span class="tag">' + plural(c.invoices, 'invoice') + '</span>' + (c.avg_days != null ? '<span class="tag">pays in ~' + c.avg_days + ' days</span>' : '') + (c.overdue > 0 ? '<span class="chip o">Late</span>' : c.owed > 0 ? '' : c.invoices ? '<span class="chip">All paid</span>' : '') + '</div></button>';
      }).join('') : '<div class="empty"><b>' + (q ? 'No matches' : 'No clients yet') + '</b>' + (q ? '' : 'Clients are added when you create an invoice, or add one here.') + '</div>') + '</div>';
      $('#view').innerHTML = h;
      $('#add').onclick = function () { clientForm(); };
      bindCommon();
    }).catch(fail);
  }
  function clientForm(c) {
    var card = sheet(head(c ? 'Edit ' + c.name : 'Add client') + '<form class="form" id="f" novalidate>' +
      '<label class="field"><span>Name</span><input id="n" maxlength="80" value="' + esc(c ? c.name : '') + '" placeholder="Ravi Kumar"></label>' +
      '<label class="field"><span>Company</span><input id="co" maxlength="80" value="' + esc(c ? c.company : '') + '" placeholder="optional"></label>' +
      '<div class="two"><label class="field"><span>WhatsApp number</span><input id="p" type="tel" inputmode="tel" maxlength="20" value="' + esc(c ? c.phone : '') + '" placeholder="98765 43210"></label>' +
      '<label class="field"><span>Email</span><input id="e" type="email" inputmode="email" maxlength="120" value="' + esc(c ? c.email : '') + '" placeholder="optional"></label></div>' +
      '<label class="field"><span>Notes</span><textarea id="no" maxlength="500" rows="3" placeholder="Who to call, how they like to pay…">' + esc(c ? c.notes : '') + '</textarea></label>' +
      '<p class="err" hidden></p><button class="btn solid full" type="submit" id="save">' + (c ? 'Save' : 'Add client') + '</button></form>');
    if (c) onClose = function () { openClient(c.id); };
    $('#f', card).onsubmit = function (e) {
      e.preventDefault(); formErr(card, ''); var btn = $('#save', card); btn.disabled = true;
      var b = { name: $('#n', card).value.trim(), company: $('#co', card).value.trim(), phone: $('#p', card).value.trim(), email: $('#e', card).value.trim(), notes: $('#no', card).value.trim() };
      api(c ? 'PATCH' : 'POST', c ? '/api/clients/' + c.id : '/api/clients', b).then(function (r) { toast(c ? 'Saved' : b.name + ' added'); closeSheet(true); render(); openClient(c ? c.id : r.id); })
        .catch(function (x) { btn.disabled = false; formErr(card, x.message); });
    };
  }
  function openClient(id) {
    api('GET', '/api/clients/' + id).then(function (d) {
      var c = d.client, inv = d.invoices;
      var owed = inv.filter(function (i) { return i.status === 'open'; }).reduce(function (a, i) { return a + i.balance; }, 0);
      var late = inv.filter(function (i) { return i.overdue; }).reduce(function (a, i) { return a + i.balance; }, 0);
      var card = sheet(head(c.name, [c.company, ph(c.phone), c.email].filter(Boolean).join(' · ') || 'No contact details') +
        '<div class="kv"><div><span>Owes you</span><strong>' + money(owed) + '</strong></div><div><span>Late</span><strong>' + money(late) + '</strong></div></div>' +
        '<div class="sheet-actions">' + (c.phone ? '<a class="btn lime" href="' + esc(waLink(c.phone, '')) + '" target="_blank" rel="noopener">' + I.msg + 'WhatsApp</a><a class="btn soft" href="tel:' + esc(c.phone) + '">Call</a>' : '') +
        (c.email ? '<a class="btn soft" href="mailto:' + esc(c.email) + '">Email</a>' : '') + '<button class="btn solid" type="button" id="ni">New invoice</button></div>' +
        (c.notes ? '<div class="panel"><div class="lbl">Notes</div>' + esc(c.notes) + '</div>' : '') +
        '<div class="section-h">Invoices</div>' + (inv.length ? inv.map(function (i) {
          return '<button class="row" type="button" data-inv="' + esc(i.id) + '"><span class="ic ' + (i.status === 'paid' ? 'cat-t' : i.status === 'void' ? 'cat-g' : i.overdue ? 'cat-f' : 'cat-k') + '">' + (i.status === 'paid' ? I.check : I.list) + '</span><span class="tx"><b>' + esc(i.number) + '</b><span>' +
            (i.status === 'paid' ? 'Paid ' + esc(day(i.paid_on)) : i.status === 'void' ? 'Void' : i.overdue ? i.late_days + ' days late' : 'Due ' + esc(day(i.due_on))) + '</span></span><span class="rt' + (i.overdue ? ' o' : i.status !== 'paid' ? ' m' : '') + '">' + money(i.status === 'open' ? i.balance : i.amount) + '</span></button>';
        }).join('') : '<p class="lbl">No invoices yet.</p>') +
        '<div class="sheet-actions" style="margin-top:16px"><button class="btn soft" type="button" id="ed">Edit client</button>' + (inv.length ? '' : '<button class="btn danger" type="button" id="del">Delete</button>') + '</div>');
      onClose = function () { render(); };
      $('#ni', card).onclick = function () { invoiceForm(null, c.id); };
      $('#ed', card).onclick = function () { clientForm(c); };
      $$('[data-inv]', card).forEach(function (b) { b.onclick = function () { openInvoice(b.dataset.inv); }; });
      var del = $('#del', card); if (del) del.onclick = function () {
        if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Tap again to delete'; return; }
        api('DELETE', '/api/clients/' + c.id).then(function () { toast(c.name + ' deleted'); closeSheet(); }).catch(function (x) { toast(x.message); });
      };
    }).catch(function (e) { toast(e.message); });
  }

  /* ───────── SETTINGS ───────── */
  var TONE_HELP = { gentle: 'Before the due date', due: 'On the due date', firm: 'After it is late', final: 'Last reminder' };
  function settings() {
    api('GET', '/api/me').then(function (d) {
      ME = d; if (view !== 'settings') return;
      var s = d.settings;
      var h = '<div class="bento">';
      h += '<section class="card" style="grid-column:1/-1"><div class="ch"><span class="ic">' + I.user + '</span><h2>Your business</h2></div><form class="form" id="biz" novalidate>' +
        '<div class="two"><label class="field"><span>Business name</span><input id="bn" maxlength="80" value="' + esc(s.business) + '" placeholder="Shown on reminders"></label>' +
        '<label class="field"><span>UPI ID</span><input id="up" maxlength="60" value="' + esc(s.upi) + '" placeholder="yourname@okhdfcbank" autocapitalize="none"></label></div>' +
        '<div class="two"><label class="field"><span>Your phone (shown on the pay page)</span><input id="ph" type="tel" maxlength="20" value="' + esc(s.phone) + '"></label>' +
        '<label class="field"><span>Your email (replies go here)</span><input id="em" type="email" maxlength="120" value="' + esc(s.email) + '"></label></div>' +
        '<p class="err" hidden></p><button class="btn solid" type="submit">Save</button></form></section>';
      h += '<section class="card" style="grid-column:1/-1"><div class="ch"><span class="ic">' + I.clock + '</span><h2>Reminder schedule</h2></div>' +
        '<p class="lbl" style="line-height:1.5;margin:-6px 0 14px">Days from the due date: −3 is three days before, 0 is the due date, 7 is a week late. Each invoice gets one message per step, and stops when it is paid or a promise is made.</p>' +
        '<div class="form" id="steps"></div><div class="sheet-actions"><button class="btn soft sm" type="button" id="addStep">Add step</button></div>' +
        '<div class="section-h">Messages</div><p class="lbl" style="line-height:1.5;margin:-4px 2px 12px">Use {client}, {amount}, {number}, {due}, {late}, {link} and {business}.</p><div class="form">' +
        ['gentle', 'due', 'firm', 'final'].map(function (t) { return '<label class="field"><span>' + (TONE[t] || TONE.firm)[0] + ' · ' + TONE_HELP[t] + '</span><textarea data-tpl="' + t + '" rows="3" maxlength="600">' + esc(s.templates[t]) + '</textarea></label>'; }).join('') +
        '<p class="err" id="schErr" hidden></p><button class="btn solid" type="button" id="saveSch">Save schedule</button></div></section>';
      h += '<section class="card c-donut"><div class="ch"><span class="ic">' + I.plug + '</span><h2>Connections</h2></div>' +
        '<div class="status-line"><span class="chip">On</span><span class="tx">WhatsApp<small>Opens WhatsApp with the message ready. You tap send.</small></span></div>' +
        '<div class="status-line"><span class="chip' + (d.email_ready ? '' : ' g') + '">' + (d.email_ready ? 'On' : 'Off') + '</span><span class="tx">Automatic email<small>' + (d.email_ready ? 'Email reminders go out every morning.' : 'Add RESEND_API_KEY and EMAIL_FROM in Cloudflare to send emails by themselves.') + '</small></span></div>' +
        '<div class="status-line"><span class="chip' + (d.razorpay_ready ? '' : ' g') + '">' + (d.razorpay_ready ? 'On' : 'Off') + '</span><span class="tx">Razorpay<small>' + (d.razorpay_ready ? 'Each invoice gets a card/netbanking link; paid links close the invoice.' : 'Optional. Add your Razorpay keys in Cloudflare for card and netbanking.') + '</small></span></div>' +
        '<div class="status-line"><span class="chip' + (s.upi ? '' : ' g') + '">' + (s.upi ? 'On' : 'Off') + '</span><span class="tx">UPI on the pay page<small>' + (s.upi ? esc(s.upi) : 'Add your UPI ID above.') + '</small></span></div></section>';
      h += '<section class="card c-bars"><div class="ch"><span class="ic">' + I.gear + '</span><h2>Account</h2></div><form class="form" id="acc" novalidate>' +
        '<label class="field"><span>Your name</span><input id="nm" maxlength="60" value="' + esc(d.user.name) + '"></label>' +
        '<label class="field"><span>Current password</span><input id="op" type="password" autocomplete="current-password" placeholder="Only to change password"></label>' +
        '<label class="field"><span>New password</span><input id="np" type="password" autocomplete="new-password" placeholder="At least 8 characters"></label>' +
        '<p class="err" hidden></p><div class="sheet-actions"><button class="btn solid" type="submit">Save</button><button class="btn soft" type="button" id="so">Sign out</button></div>' +
        '<p class="lbl" style="margin-top:6px">Signed in as ' + esc(d.user.username) + '</p></form></section>';
      h += '<section class="card c-recent"><div class="ch"><span class="ic">' + I.sun + '</span><h2>Appearance</h2></div><div class="seg"><button type="button" data-th="light" class="' + (document.body.classList.contains('dark') ? '' : 'on') + '">Light</button><button type="button" data-th="dark" class="' + (document.body.classList.contains('dark') ? 'on' : '') + '">Dark</button></div>' +
        '<p class="lbl" style="margin-top:14px;line-height:1.5">Install Dues on your phone: open the browser menu and choose Add to Home screen.</p></section>';
      h += '</div>';
      $('#view').innerHTML = h;
      var steps = s.steps.map(function (x) { return { days: x.days, tone: x.tone }; });
      function drawSteps() {
        $('#steps').innerHTML = steps.map(function (st, k) {
          return '<div class="steprow"><input class="input" type="number" min="-30" max="120" value="' + st.days + '" data-k="' + k + '" data-f="days" aria-label="Days from due date">' +
            '<select class="input" data-k="' + k + '" data-f="tone" aria-label="Tone">' + ['gentle', 'due', 'firm', 'final'].map(function (t) { return '<option value="' + t + '"' + (st.tone === t ? ' selected' : '') + '>' + TONE[t][0] + '</option>'; }).join('') + '</select>' +
            '<button class="x" type="button" data-rm="' + k + '" aria-label="Remove step"' + (steps.length === 1 ? ' disabled' : '') + '>' + I.x + '</button></div>';
        }).join('');
      }
      drawSteps();
      $('#steps').oninput = $('#steps').onchange = function (e) { var t = e.target; if (t.dataset.k == null) return; var st = steps[+t.dataset.k]; if (t.dataset.f === 'days') st.days = parseInt(t.value, 10); else st.tone = t.value; };
      $('#steps').onclick = function (e) { var b = e.target.closest('[data-rm]'); if (b && steps.length > 1) { steps.splice(+b.dataset.rm, 1); drawSteps(); } };
      $('#addStep').onclick = function () { if (steps.length >= 8) return toast('Up to 8 steps'); var last = steps[steps.length - 1]; steps.push({ days: (last ? last.days : 0) + 7, tone: 'firm' }); drawSteps(); };
      $('#saveSch').onclick = function () {
        var e = $('#schErr'); e.hidden = true; var tpl = {}; $$('[data-tpl]').forEach(function (t) { tpl[t.dataset.tpl] = t.value; });
        api('PUT', '/api/settings', { steps: steps, templates: tpl }).then(function (r) { ME.settings = r.settings; steps = r.settings.steps.slice(); drawSteps(); toast('Schedule saved'); }).catch(function (x) { e.textContent = x.message; e.hidden = false; });
      };
      $('#biz').onsubmit = function (ev) {
        ev.preventDefault(); var card = $('#biz'); formErr(card, '');
        api('PUT', '/api/settings', { business: $('#bn').value, upi: $('#up').value.trim(), phone: $('#ph').value, email: $('#em').value }).then(function (r) { ME.settings = r.settings; toast('Saved'); }).catch(function (x) { formErr(card, x.message); });
      };
      $('#acc').onsubmit = function (ev) {
        ev.preventDefault(); var card = $('#acc'); formErr(card, ''); var b = { name: $('#nm').value.trim() };
        if ($('#np').value) { b.password = $('#op').value; b.new_password = $('#np').value; }
        api('PATCH', '/api/me', b).then(function () { $('#op').value = $('#np').value = ''; toast('Saved'); paintUser(b.name); }).catch(function (x) { formErr(card, x.message); });
      };
      $('#so').onclick = signOut;
      $$('[data-th]').forEach(function (b) { b.onclick = function () { var want = b.dataset.th === 'dark'; if (want !== document.body.classList.contains('dark')) toggleTheme(); $$('[data-th]').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    }).catch(fail);
  }

  /* ───────── account sheet ───────── */
  function paintUser(name) { ME.user.name = name || ME.user.name; $('#who').textContent = (ME.user.name || '').split(' ')[0] || 'there'; $('#avatar').textContent = initials(ME.user.name); }
  function accountSheet() {
    var card = sheet('<div class="sheet-top"><div class="avatar" aria-hidden="true">' + initials(ME.user.name) + '</div><div class="sheet-who"><b>' + esc(ME.user.name) + '</b><span>' + esc(ME.user.username) + '</span>' +
      (ME.settings.business ? '<span class="chip" style="align-self:flex-start;margin-top:4px">' + esc(ME.settings.business) + '</span>' : '') + '</div><button class="x" type="button" data-close aria-label="Close">' + I.x + '</button></div>' +
      '<div class="sheet-actions"><button class="btn ghost" type="button" id="st">Switch theme</button><button class="btn soft" type="button" id="sg">Settings</button><button class="btn solid" type="button" id="so">Sign out</button></div>');
    $('#st', card).onclick = toggleTheme; $('#sg', card).onclick = function () { closeSheet(true); go('settings'); }; $('#so', card).onclick = signOut;
  }

  /* ───────── start ───────── */
  paintTheme();
  api('GET', '/api/me').then(function (d) {
    ME = d; paintUser();
    var h = (location.hash || '').slice(1);
    go(['overview', 'invoices', 'followups', 'clients', 'settings'].indexOf(h) > -1 ? h : 'overview');
  }).catch(function (e) { if (e.message !== 'Please sign in.') fail(e); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(function () { });
})();
