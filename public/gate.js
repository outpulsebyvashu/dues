/* Dues gate: nothing opens until you are through it.
   First time: sign in / create an online account (Supabase), or use Dues on this phone only. Then set a PIN.
   After that: the PIN pad (or fingerprint on Android) unlocks the encrypted vault.
   Dues locks itself after 1 minute in the background or 10 minutes without a tap.
   Changes are saved encrypted on the phone, then synced to your account when you are signed in. */
(function () {
  'use strict';
  var V = window.DuesVault, C = window.DuesCloud, API = window.DuesAPI;
  var LOCK_AWAY_MS = 60 * 1000, LOCK_IDLE_MS = 10 * 60 * 1000, PIN_LEN = 6;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var IC = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.34 9.1 4.5 4.5 0 0 0 6.5 19z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    finger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11v3.5a7 7 0 0 1-1.6 4.5"/><path d="M8.5 9.5a3.5 3.5 0 0 1 7 0v4.5c0 1.6-.3 3.1-.9 4.5"/><path d="M5.5 13.5V10a6.5 6.5 0 0 1 11.9-3.6"/><path d="M18.5 10.5v3.5c0 1.2-.1 2.3-.4 3.4"/><path d="M5.6 16.5c.3-.8.4-1.6.4-2.5"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9.5l-5 5M12 9.5l5 5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };
  var STAR = '<svg class="star" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0C55 30 70 45 100 50 70 55 55 70 50 100 45 70 30 55 0 50 30 45 45 30 50 0Z" fill="rgba(255,255,255,.3)"/></svg>';

  /* ───── Android fingerprint bridge ───── */
  var A = window.DuesAndroid, bioWait = null;
  function bioAvailable() { try { return !!(A && A.bioAvailable && A.bioAvailable()); } catch (e) { return false; } }
  window.duesBio = function (res) { var r; try { r = typeof res === 'string' ? JSON.parse(res) : res; } catch (e) { r = { ok: false }; } var w = bioWait; bioWait = null; if (w) w(r || { ok: false }); };
  function bio(op, arg) { return new Promise(function (ok) { bioWait = ok; try { if (op === 'enroll') A.bioEnroll(arg); else A.bioUnlock(); } catch (e) { bioWait = null; ok({ ok: false, error: e.message }); } }); }

  /* ───── state while unlocked ───── */
  var state = null;            // { db, session, cloud: { version, at } }
  var sync = { status: 'off', message: '', timer: 0, running: false, again: false };
  var onReady = null;

  function payload() { return { db: state.db, session: state.session, cloud: state.cloud }; }
  function persist(snap) { state.db = JSON.parse(snap); return V.save(payload()).then(function () { syncSoon(); }); }
  C.onSession(function (s) {
    if (!state) return;
    state.session = s;
    if (!s) { sync.status = 'off'; emit(); }
    V.save(payload()).catch(function () { });
  });
  function emit() { try { window.dispatchEvent(new CustomEvent('dues:sync', { detail: { status: sync.status, message: sync.message } })); } catch (e) { } }
  function syncSoon(ms) { if (!state || !C.signedIn()) return; clearTimeout(sync.timer); sync.timer = setTimeout(runSync, ms == null ? 1200 : ms); }
  async function runSync() {
    if (!state || !C.signedIn()) return;
    if (sync.running) { sync.again = true; return; }
    if (navigator.onLine === false) { sync.status = 'offline'; sync.message = 'Offline. Changes will sync when you are back online.'; emit(); return; }
    sync.running = true; sync.status = 'syncing'; emit();
    try {
      var sent = API.snapshot();
      var r = await C.sync(sent, (state.cloud && state.cloud.version) || 0);
      state.cloud = { version: r.version, at: new Date().toISOString() };
      if (r.changed) {
        var now = API.snapshot();   // you may have changed something while it synced: keep both
        var data = JSON.stringify(now) === JSON.stringify(sent) ? r.data : C.merge(now, r.data);
        await API.replace(data); state.db = data;
        if (data !== r.data) sync.again = true;
        window.dispatchEvent(new CustomEvent('dues:remote'));
      }
      await V.save(payload());
      sync.status = 'synced'; sync.message = '';
    } catch (e) {
      sync.status = e.code === 'nosession' ? 'off' : 'error'; sync.message = e.message;
    }
    sync.running = false; emit();
    if (sync.again) { sync.again = false; syncSoon(400); }
  }
  window.addEventListener('online', function () { syncSoon(0); });
  setInterval(function () { if (state && document.visibilityState === 'visible') syncSoon(0); }, 90 * 1000);

  /* ───── auto-lock ───── */
  var hiddenAt = 0, lastTouch = Date.now();
  ['pointerdown', 'keydown', 'scroll'].forEach(function (ev) { document.addEventListener(ev, function () { lastTouch = Date.now(); }, { passive: true, capture: true }); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); if (state) runSync(); }
    else { if (state && hiddenAt && Date.now() - hiddenAt > LOCK_AWAY_MS) lockNow(); else syncSoon(0); }
  });
  setInterval(function () { if (state && Date.now() - lastTouch > LOCK_IDLE_MS) lockNow(); }, 15000);
  function lockNow() {
    if (!state) return;
    var done = function () { state = null; V.lock(); API.detach(); location.reload(); };
    API('GET', '/api/me').then(done, done);   // waits for the last save to finish first
  }

  /* ───── screens ───── */
  var root = null;
  function screen(html, mount) {
    if (!root) { root = document.createElement('div'); root.className = 'gate'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Dues sign in'); document.body.appendChild(root); }
    document.body.classList.add('gated');
    var dark = document.body.classList.contains('dark');
    root.innerHTML = '<div class="gate-in"><div class="gate-brand"><img src="icon-192.png" alt=""><b>Dues</b><button class="round" type="button" id="gTheme" aria-label="Switch theme">' + (dark ? IC.sun : IC.moon) + '</button></div>' + html + '</div>';
    $('#gTheme', root).onclick = function () { var d = document.body.classList.toggle('dark'); try { localStorage.setItem('dues_theme', d ? 'dark' : 'light'); } catch (e) { } this.innerHTML = d ? IC.sun : IC.moon; var m = $('meta[name=theme-color]'); if (m) m.content = d ? '#0a0d0a' : '#e9e9e9'; };
    root.scrollTop = 0;
    if (mount) mount(root);
    var f = $('input', root); if (f && window.innerWidth > 720) setTimeout(function () { f.focus(); }, 30);
  }
  function close() { if (root) { root.remove(); root = null; } document.body.classList.remove('gated'); }
  function err(r, m) { var e = $('.err', r); if (e) { e.textContent = m || ''; e.hidden = !m; } }
  function busy(btn, on, text) { if (!btn) return; if (on) { btn.dataset.t = btn.textContent; btn.textContent = text || 'Please wait…'; btn.disabled = true; } else { btn.textContent = btn.dataset.t || btn.textContent; btn.disabled = false; } }
  function pwField(id, label, auto) { return '<label class="field"><span>' + label + '</span><div class="pw"><input class="input" id="' + id + '" type="password" autocomplete="' + auto + '" maxlength="72" required><button type="button" data-eye="' + id + '">Show</button></div></label>'; }
  function eyes(r) { $$('[data-eye]', r).forEach(function (b) { b.onclick = function () { var i = $('#' + b.dataset.eye, r); var show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; }; }); }

  /* first screen */
  function start(opts) {
    opts = opts || {};
    var legacy = API.legacyPlain();
    var cfg = C.configured();
    screen('<section class="card c-lime">' + STAR + '<h1>Get paid without the awkward calls</h1><p class="lbl">Polite WhatsApp and email reminders until every invoice is paid. Your data is encrypted on this phone and locked with your PIN.</p></section>' +
      (legacy ? '<section class="card"><p class="lbl" style="line-height:1.5">Dues found invoices from before. They will be kept and encrypted when you finish.</p></section>' : '') +
      '<section class="card"><div class="ch"><span class="ic">' + IC.cloud + '</span><h2>Online account</h2></div>' +
      (cfg ? '<p class="lbl" style="line-height:1.5;margin:-8px 0 14px">Sign in to keep a copy in your account and use Dues on more than one phone.</p><div class="form"><button class="btn solid full" type="button" id="gIn">Sign in</button><button class="btn ghost full" type="button" id="gUp">Create account</button></div>'
        : '<p class="lbl" style="line-height:1.5;margin:-8px 0 14px">Online accounts are not set up in this copy of Dues yet.</p><button class="btn soft full" type="button" id="gCfg">Set up online accounts</button>') + '</section>' +
      '<section class="card"><div class="ch"><span class="ic">' + IC.phone + '</span><h2>This phone only</h2></div><p class="lbl" style="line-height:1.5;margin:-8px 0 14px">No account. Everything stays on this phone. Back it up from Settings now and then.</p><button class="btn soft full" type="button" id="gLocal">Use on this phone only</button></section>',
      function (r) {
        if ($('#gIn', r)) $('#gIn', r).onclick = function () { signIn({}); };
        if ($('#gUp', r)) $('#gUp', r).onclick = signUp;
        if ($('#gCfg', r)) $('#gCfg', r).onclick = function () { setup(start); };
        $('#gLocal', r).onclick = function () { setPin(function (pin) { return create(pin, legacy || API.blank(), null, null); }, start); };
      });
  }

  /* Supabase project details (only needed if config.js was left empty) */
  function setup(back) {
    var c = C.config();
    screen('<section class="card"><div class="ch"><span class="ic">' + IC.cloud + '</span><h2>Set up online accounts</h2></div>' +
      '<p class="lbl" style="line-height:1.5;margin:-8px 0 14px">From your Supabase project: Project Settings → API. Run supabase/schema.sql in its SQL editor first. Use the anon (public) key, never the service_role key.</p>' +
      '<form class="form" id="gF" novalidate><label class="field"><span>Project URL</span><input class="input" id="gU" type="url" inputmode="url" autocapitalize="none" placeholder="https://abcd.supabase.co" value="' + esc(c.supabaseUrl) + '"></label>' +
      '<label class="field"><span>Anon key</span><input class="input" id="gK" autocapitalize="none" autocomplete="off" spellcheck="false" value="' + esc(c.supabaseAnonKey) + '"></label>' +
      '<p class="err" hidden></p><button class="btn solid full" type="submit">Save</button></form></section><button class="btn soft full" type="button" id="gBack">Back</button>',
      function (r) {
        $('#gBack', r).onclick = function () { back(); };
        $('#gF', r).onsubmit = function (e) { e.preventDefault(); try { C.setConfig($('#gU', r).value, $('#gK', r).value); back(); } catch (x) { err(r, x.message); } };
      });
  }

  /* sign in. mode: {} first run, { replace: true } forgot PIN, { connect: true } from Settings */
  function signIn(mode, note) {
    screen('<section class="card"><div class="ch"><span class="ic">' + IC.lock + '</span><h2>' + (mode.replace ? 'Sign in to reset your PIN' : 'Sign in') + '</h2></div>' +
      (note ? '<p class="okmsg" style="margin:-6px 0 12px">' + esc(note) + '</p>' : '') +
      (mode.replace ? '<p class="lbl" style="line-height:1.5;margin:-6px 0 14px">Your data comes back from your account. Changes that had not synced yet will be lost.</p>' : '') +
      '<form class="form" id="gF" novalidate><label class="field"><span>Email</span><input class="input" id="gE" type="email" inputmode="email" autocomplete="username" autocapitalize="none" maxlength="120"></label>' +
      pwField('gP', 'Password', 'current-password') + '<p class="err" hidden></p><button class="btn solid full" type="submit">Sign in</button></form>' +
      '<div class="links" style="margin-top:8px"><button type="button" id="gForgot">Forgot password?</button>' + (mode.replace ? '' : '<button type="button" id="gNew">Create account</button>') + '</div></section>' +
      '<button class="btn soft full" type="button" id="gBack">Back</button>',
      function (r) {
        eyes(r);
        $('#gBack', r).onclick = function () { if (mode.connect) close(); else if (mode.replace) lock(); else start(); };
        $('#gForgot', r).onclick = function () { forgot(mode, $('#gE', r).value); };
        if ($('#gNew', r)) $('#gNew', r).onclick = function () { signUp(mode); };
        $('#gF', r).onsubmit = function (e) {
          e.preventDefault(); err(r, '');
          var b = $('button[type=submit]', r); busy(b, true, 'Signing in…');
          C.signIn($('#gE', r).value, $('#gP', r).value).then(function () { return afterSignIn(mode); }).catch(function (x) { busy(b, false); err(r, x.message); });
        };
      });
  }
  function signUp(mode) {
    mode = mode && mode.connect ? mode : {};
    screen('<section class="card"><div class="ch"><span class="ic">' + IC.mail + '</span><h2>Create account</h2></div>' +
      '<form class="form" id="gF" novalidate><label class="field"><span>Your name</span><input class="input" id="gN" autocomplete="name" maxlength="60"></label>' +
      '<label class="field"><span>Email</span><input class="input" id="gE" type="email" inputmode="email" autocomplete="username" autocapitalize="none" maxlength="120"></label>' +
      pwField('gP', 'Password', 'new-password') + '<p class="lbl" style="margin-top:-4px">At least 8 characters, with letters and numbers.</p>' +
      '<p class="err" hidden></p><button class="btn solid full" type="submit">Create account</button></form>' +
      '<div class="links" style="margin-top:8px"><button type="button" id="gHave">I already have an account</button></div></section><button class="btn soft full" type="button" id="gBack">Back</button>',
      function (r) {
        eyes(r);
        $('#gBack', r).onclick = function () { if (mode.connect) close(); else start(); };
        $('#gHave', r).onclick = function () { signIn(mode); };
        $('#gF', r).onsubmit = function (e) {
          e.preventDefault(); err(r, '');
          var name = $('#gN', r).value.trim(); if (!name) return err(r, 'Enter your name.');
          var b = $('button[type=submit]', r); busy(b, true, 'Creating…');
          C.signUp($('#gE', r).value, $('#gP', r).value, name).then(function (res) {
            if (!res.signedIn) return signIn(mode, 'Check your email and open the link to confirm, then sign in here.');
            return afterSignIn(Object.assign({ name: name }, mode));
          }).catch(function (x) { busy(b, false); err(r, x.message); });
        };
      });
  }
  function forgot(mode, email) {
    screen('<section class="card"><div class="ch"><span class="ic">' + IC.mail + '</span><h2>Reset your password</h2></div>' +
      '<p class="lbl" style="line-height:1.5;margin:-8px 0 14px">We will email you a link to set a new password.</p>' +
      '<form class="form" id="gF" novalidate><label class="field"><span>Email</span><input class="input" id="gE" type="email" inputmode="email" autocomplete="username" autocapitalize="none" maxlength="120" value="' + esc(email || '') + '"></label>' +
      '<p class="err" hidden></p><p class="okmsg" hidden></p><button class="btn solid full" type="submit">Send link</button></form></section><button class="btn soft full" type="button" id="gBack">Back</button>',
      function (r) {
        $('#gBack', r).onclick = function () { signIn(mode); };
        $('#gF', r).onsubmit = function (e) {
          e.preventDefault(); err(r, '');
          var b = $('button[type=submit]', r); busy(b, true, 'Sending…');
          C.recover($('#gE', r).value).then(function () { busy(b, false); var o = $('.okmsg', r); o.textContent = 'If that email has an account, a link is on its way. Open it on this phone.'; o.hidden = false; })
            .catch(function (x) { busy(b, false); err(r, x.message); });
        };
      });
  }

  /* after signing in: bring the account's data down, keep anything already on this phone, then set the PIN */
  async function afterSignIn(mode) {
    var remote = null;
    try { remote = await C.pull(); } catch (e) { if (e.code !== 'offline') throw e; }
    if (mode.connect) {   // already unlocked: merge what is here with the account
      var here = API.snapshot();
      var merged = remote ? C.merge(here, remote.data) : here;
      state.session = C.sessionForStorage(); state.cloud = { version: remote ? remote.version : 0 };
      await API.replace(merged); state.db = merged;
      await V.save(payload());
      close(); window.dispatchEvent(new CustomEvent('dues:remote')); syncSoon(0);
      return;
    }
    var legacy = mode.replace ? null : API.legacyPlain();
    var db = remote ? (legacy ? C.merge(legacy, remote.data) : remote.data) : (legacy || API.blank());
    if (!remote && mode.name && !(db.me && db.me.name)) db.me = { name: mode.name, updated_at: new Date().toISOString() };
    var session = C.sessionForStorage();
    setPin(function (pin) { if (mode.replace) V.wipe(); return create(pin, db, session, { version: remote ? remote.version : 0 }); }, function () { C.signOut(); start(); });
  }

  /* PIN pad: set (twice) or unlock */
  function pad(r, onDigits) {
    var val = '';
    function paint() { $$('.pin-dots i', r).forEach(function (d, k) { d.classList.toggle('on', k < val.length); }); }
    function press(d) {
      if (r.dataset.busy === '1') return;
      if (d === 'del') val = val.slice(0, -1);
      else if (val.length < PIN_LEN) val += d;
      paint();
      if (val.length === PIN_LEN) { var v = val; r.dataset.busy = '1'; setTimeout(function () { r.dataset.busy = ''; onDigits(v, function () { val = ''; paint(); }); }, 120); }
    }
    $('.pad', r).onclick = function (e) { var b = e.target.closest('[data-d]'); if (b) press(b.dataset.d); };
    document.onkeydown = function (e) { if (!r.isConnected) { document.onkeydown = null; return; } if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); } else if (e.key === 'Backspace') press('del'); };
  }
  function padHtml(extra) {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(function (d) { return '<button type="button" data-d="' + d + '" aria-label="' + d + '">' + d + '</button>'; }).join('');
    return '<div class="pin-dots" aria-hidden="true">' + new Array(PIN_LEN + 1).join('<i></i>') + '</div><p class="pin-msg" role="status"></p>' +
      '<div class="pad">' + keys + (extra || '<span></span>') + '<button type="button" data-d="0" aria-label="0">0</button><button type="button" class="k" data-d="del" aria-label="Delete">' + IC.del + '</button></div>';
  }
  function say(r, m, bad) { var p = $('.pin-msg', r); p.textContent = m || ''; p.classList.toggle('bad', !!bad); if (bad) { var d = $('.pin-dots', r); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); } }
  function setPin(finish, back) {
    var first = null;
    screen('<section class="card lock-card"><div class="avatar" aria-hidden="true" style="background:var(--chip);color:var(--ink)">' + IC.lock.replace('<svg', '<svg style="width:24px;height:24px"') + '</div><h2 id="gT">Set a ' + PIN_LEN + '-digit PIN</h2><p class="lbl">You will use it to open Dues on this phone.</p>' + padHtml() + '</section>' +
      '<button class="btn soft full" type="button" id="gBack">Back</button>',
      function (r) {
        $('#gBack', r).onclick = function () { document.onkeydown = null; back(); };
        pad(r, function (v, clear) {
          if (!first) {
            if (/^(\d)\1+$/.test(v) || '0123456789'.indexOf(v) > -1 || '9876543210'.indexOf(v) > -1) { say(r, 'Too easy to guess. Try another PIN.', true); return clear(); }
            first = v; $('#gT', r).textContent = 'Enter it again'; say(r, ''); return clear();
          }
          if (v !== first) { first = null; $('#gT', r).textContent = 'Set a ' + PIN_LEN + '-digit PIN'; say(r, 'The PINs did not match. Start again.', true); return clear(); }
          r.dataset.busy = '1'; say(r, 'Encrypting…');
          Promise.resolve(finish(v)).then(function () { document.onkeydown = null; }).catch(function (x) { r.dataset.busy = ''; first = null; say(r, x.message, true); clear(); });
        });
      });
  }
  async function create(pin, db, session, cloud) {
    var p = { db: db || API.blank(), session: session, cloud: cloud };
    await V.create(pin, p);
    API.dropLegacyPlain();
    open(p);
  }

  /* lock screen */
  function lock() {
    var bioOn = V.bioOn() && bioAvailable();
    screen('<section class="card lock-card"><div class="avatar" aria-hidden="true">' + IC.lock.replace('<svg', '<svg style="width:24px;height:24px"') + '</div><h2>Dues is locked</h2><p class="lbl">Enter your PIN</p>' +
      padHtml(bioOn ? '<button type="button" class="k" id="gBio" aria-label="Unlock with fingerprint">' + IC.finger + '</button>' : '') + '</section>' +
      '<div class="links"><button type="button" id="gForgotPin">Forgot PIN?</button></div>',
      function (r) {
        pad(r, function (v, clear) {
          r.dataset.busy = '1'; say(r, 'Unlocking…');
          V.unlock(v).then(function (p) { document.onkeydown = null; open(p); })
            .catch(function (x) { r.dataset.busy = ''; say(r, x.message, true); clear(); });
        });
        var bb = $('#gBio', r);
        function tryBio() {
          bio('unlock').then(function (res) {
            if (!res.ok || !res.key) { if (res.error) say(r, res.error, true); return; }
            return V.unlockWithKey(res.key).then(function (p) { document.onkeydown = null; open(p); });
          }).catch(function (x) { say(r, x.message, true); });
        }
        if (bb) { bb.onclick = tryBio; setTimeout(tryBio, 250); }
        $('#gForgotPin', r).onclick = forgotPin;
      });
  }
  function forgotPin() {
    screen('<section class="card"><div class="ch"><span class="ic">' + IC.lock + '</span><h2>Forgot your PIN?</h2></div>' +
      '<p class="lbl" style="line-height:1.55;margin:-8px 0 14px">Your PIN is the key to the data on this phone; nobody can open it without it, not even us.' +
      (C.configured() ? ' If you use an online account, sign in again: your data comes back from it and you set a new PIN.' : '') + ' Otherwise you can erase this phone and start again (restore a backup afterwards).</p>' +
      '<div class="form">' + (C.configured() ? '<button class="btn solid full" type="button" id="gRe">Sign in again</button>' : '') +
      '<button class="btn danger full" type="button" id="gWipe">Erase this phone and start again</button></div></section><button class="btn soft full" type="button" id="gBack">Back</button>',
      function (r) {
        $('#gBack', r).onclick = lock;
        if ($('#gRe', r)) $('#gRe', r).onclick = function () { signIn({ replace: true }); };
        $('#gWipe', r).onclick = function () {
          var b = this; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again: this deletes everything on this phone'; return; }
          V.wipe(); API.dropLegacyPlain(); location.reload();
        };
      });
  }

  /* unlocked: hand the data to the app */
  function open(p) {
    state = { db: p.db || API.blank(), session: p.session || null, cloud: p.cloud || null };
    C.restore(state.session);
    API.attach(state.db, persist);
    sync.status = C.signedIn() ? 'syncing' : 'off';
    lastTouch = Date.now(); hiddenAt = 0;
    close();
    if (onReady) { var f = onReady; onReady = null; f(); }
    syncSoon(0);
  }

  /* ───── Settings → Account card (drawn by app.js through DuesUI) ───── */
  function ago(iso) { if (!iso) return ''; var s = Math.round((Date.now() - new Date(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function syncText() {
    if (!C.signedIn()) return 'Not signed in';
    if (sync.status === 'syncing') return 'Syncing…';
    if (sync.status === 'error' || sync.status === 'offline') return sync.message;
    return state && state.cloud && state.cloud.at ? 'Synced ' + ago(state.cloud.at) : 'Waiting to sync';
  }
  var Gate = {
    ready: function () {
      return new Promise(function (ok) {
        onReady = ok;
        if (!window.crypto || !window.crypto.subtle) { screen('<section class="card"><h2 style="font-weight:400">This browser cannot encrypt</h2><p class="lbl" style="line-height:1.5;margin-top:8px">Open Dues over https (or in the Android app) in an up-to-date browser.</p></section>'); return; }
        if (V.exists()) lock(); else start();
      });
    },
    lockNow: lockNow,
    syncNow: function () { syncSoon(0); },
    signedIn: function () { return C.signedIn(); },
    user: function () { return C.user(); },
    where: function () { return C.signedIn() ? 'Encrypted on this phone · synced to ' + (C.user().email || 'your account') : 'Encrypted on this phone'; },
    settingsHtml: function () {
      var u = C.user(), bioCan = bioAvailable();
      var chip = function (on, t) { return '<span class="chip' + (on ? '' : ' g') + '">' + (t || (on ? 'On' : 'Off')) + '</span>'; };
      return '<section class="card" style="grid-column:1/-1" id="acctCard"><div class="ch"><span class="ic">' + IC.lock + '</span><h2>Account and security</h2></div>' +
        '<div class="status-line">' + chip(true) + '<span class="tx">PIN lock<small>Data on this phone is encrypted (AES-256). Dues locks after 1 minute away or 10 minutes idle.</small></span></div>' +
        (bioCan ? '<div class="status-line">' + chip(V.bioOn()) + '<span class="tx">Fingerprint<small>Unlock with your fingerprint instead of the PIN.</small></span><button class="toggle" type="button" role="switch" id="aBio" aria-label="Fingerprint unlock" aria-checked="' + V.bioOn() + '"></button></div>' : '') +
        '<div class="status-line">' + chip(!!u, u ? 'On' : 'Off') + '<span class="tx">Online account<small>' + (u ? esc(u.email) : C.configured() ? 'Sign in to sync with your account and use more than one phone.' : 'Not set up in this copy of Dues.') + '</small></span></div>' +
        (u ? '<div class="status-line">' + chip(sync.status === 'synced', sync.status === 'error' ? 'Error' : sync.status === 'offline' ? 'Offline' : sync.status === 'syncing' ? '…' : 'On') + '<span class="tx">Sync<small id="aSync">' + esc(syncText()) + '</small></span></div>' : '') +
        '<div class="sheet-actions" style="flex-wrap:wrap"><button class="btn solid sm" type="button" id="aLock">Lock now</button><button class="btn soft sm" type="button" id="aPin">Change PIN</button>' +
        (u ? '<button class="btn soft sm" type="button" id="aSyncNow">Sync now</button><button class="btn soft sm" type="button" id="aPw">Change password</button><button class="btn ghost sm" type="button" id="aOut">Sign out</button>'
          : C.configured() ? '<button class="btn soft sm" type="button" id="aIn">Sign in</button><button class="btn ghost sm" type="button" id="aUp">Create account</button>' : '<button class="btn soft sm" type="button" id="aCfg">Set up online accounts</button>') +
        '</div>' + (u ? '<button class="btn danger full" style="margin-top:12px" type="button" id="aDel">Delete my online account</button>' : '') + '</section>';
    },
    wireSettings: function (card, ui) {
      if (!card) return;
      var refresh = function () { var c = $('#acctCard'); if (c) { c.outerHTML = Gate.settingsHtml(); Gate.wireSettings($('#acctCard'), ui); } };
      window.removeEventListener('dues:sync', Gate._onSync || function () { });
      Gate._onSync = function () { var s = $('#aSync'); if (s) s.textContent = syncText(); else refresh(); };
      window.addEventListener('dues:sync', Gate._onSync);
      var on = function (id, fn) { var b = $('#' + id, card); if (b) b.onclick = fn; };
      on('aLock', lockNow);
      on('aSyncNow', function () { syncSoon(0); ui.toast('Syncing…'); });
      on('aIn', function () { signIn({ connect: true }); });
      on('aUp', function () { signUp({ connect: true }); });
      on('aCfg', function () { setup(function () { close(); refresh(); }); });
      on('aBio', function () {
        var b = this;
        if (V.bioOn()) { try { A.bioClear(); } catch (e) { } V.setBio(false); b.setAttribute('aria-checked', 'false'); ui.toast('Fingerprint unlock off'); return refresh(); }
        V.rawKey().then(function (k) { return bio('enroll', k); }).then(function (res) {
          if (res.ok) { V.setBio(true); ui.toast('Fingerprint unlock on'); } else ui.toast(res.error || 'Fingerprint not set up');
          refresh();
        }).catch(function (x) { ui.toast(x.message); });
      });
      on('aPin', function () {
        var c = ui.sheet(ui.head('Change PIN', 'Your data is re-locked with the new PIN') + '<form class="form" id="pf" novalidate>' +
          '<label class="field"><span>Current PIN</span><input class="input" id="p0" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="' + PIN_LEN + '" autocomplete="off"></label>' +
          '<label class="field"><span>New PIN (' + PIN_LEN + ' digits)</span><input class="input" id="p1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="' + PIN_LEN + '" autocomplete="off"></label>' +
          '<label class="field"><span>New PIN again</span><input class="input" id="p2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="' + PIN_LEN + '" autocomplete="off"></label>' +
          '<p class="err" hidden></p><button class="btn solid full" type="submit">Change PIN</button></form>');
        $('#pf', c).onsubmit = function (e) {
          e.preventDefault(); ui.formErr(c, '');
          var a = $('#p1', c).value, b2 = $('#p2', c).value;
          if (!new RegExp('^\\d{' + PIN_LEN + '}$').test(a)) return ui.formErr(c, 'Use ' + PIN_LEN + ' digits.');
          if (a !== b2) return ui.formErr(c, 'The new PINs do not match.');
          V.changePin($('#p0', c).value, a).then(function () { ui.closeSheet(true); ui.toast('PIN changed'); }).catch(function (x) { ui.formErr(c, x.message); });
        };
      });
      on('aPw', function () {
        var c = ui.sheet(ui.head('Change password', C.user().email) + '<form class="form" id="wf" novalidate>' + pwField('w1', 'New password', 'new-password') + pwField('w2', 'New password again', 'new-password') +
          '<p class="lbl">At least 8 characters, with letters and numbers.</p><p class="err" hidden></p><button class="btn solid full" type="submit">Change password</button></form>');
        eyes(c);
        $('#wf', c).onsubmit = function (e) {
          e.preventDefault(); ui.formErr(c, '');
          if ($('#w1', c).value !== $('#w2', c).value) return ui.formErr(c, 'The passwords do not match.');
          C.changePassword($('#w1', c).value).then(function () { ui.closeSheet(true); ui.toast('Password changed'); }).catch(function (x) { ui.formErr(c, x.message); });
        };
      });
      on('aOut', function () {
        var b = this;
        if (b.dataset.sure !== '1') {
          b.dataset.sure = '1'; b.textContent = sync.status === 'synced' ? 'Tap again to sign out' : 'Not all changes synced. Tap again to sign out anyway';
          ui.toast('Signing out removes Dues data from this phone. It stays in your account.'); runSync(); return;
        }
        runSync().then(function () { return C.signOut(); }).then(function () { state = null; V.wipe(); API.detach(); location.reload(); });
      });
      on('aDel', function () {
        var b = this;
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again: deletes your account and its online copy'; return; }
        C.deleteAccount().then(function () {
          ui.toast('Account deleted. Your data stays on this phone only.');
          state.session = null; state.cloud = null; V.save(payload()); refresh();
        }).catch(function (x) { ui.toast(x.message); });
      });
    }
  };
  window.DuesGate = Gate;
})();
