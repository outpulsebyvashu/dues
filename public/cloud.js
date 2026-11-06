/* Dues online: accounts through Supabase Auth, and your data synced to your own Supabase project.
   No libraries: plain fetch to Supabase's REST endpoints. The project URL and the public anon key go in config.js
   (both are public by design; your data is protected by row-level security: each account can only read and write its own row).
   Sync keeps one row per account with a version number: a save only lands if nobody saved in between; if someone did,
   the two copies are merged (newest change of each record wins, deletions are kept) and saved again. */
(function (root) {
  'use strict';
  function cfg() {
    var c = Object.assign({ supabaseUrl: '', supabaseAnonKey: '', redirectTo: '' }, root.DUES_CONFIG || {});
    try { var o = JSON.parse(root.localStorage.getItem('dues.cloud.config') || 'null'); if (o && o.supabaseUrl) c = Object.assign(c, o); } catch (e) { }
    c.supabaseUrl = String(c.supabaseUrl || '').replace(/\/+$/, '');
    return c;
  }
  function err(status, message, code) { var e = new Error(message); e.status = status; e.code = code; return e; }

  var session = null;     // { access_token, refresh_token, expires_at (ms), user: { id, email } }
  var onSession = null;   // called when tokens change, so they are saved (encrypted) with the data

  function friendly(status, body) {
    var m = (body && (body.error_description || body.msg || body.message || body.error)) || '';
    if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you.';
    if (/already registered|already been registered|user already exists/i.test(m)) return 'This email already has an account. Sign in instead.';
    if (/password should be|weak password/i.test(m)) return 'Use a stronger password: at least 8 characters with letters and numbers.';
    if (/rate limit|too many/i.test(m) || status === 429) return 'Too many tries. Wait a few minutes and try again.';
    if (/refresh token/i.test(m)) return 'Your session ended. Sign in again.';
    return m || 'Something went wrong (' + status + '). Try again.';
  }
  async function call(path, opts) {
    var c = cfg();
    if (!c.supabaseUrl || !c.supabaseAnonKey) throw err(0, 'Online accounts are not set up yet.', 'nocfg');
    opts = opts || {};
    var h = Object.assign({ apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' }, opts.headers || {});
    var r;
    try { r = await root.fetch(c.supabaseUrl + path, { method: opts.method || 'GET', headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }); }
    catch (e) { throw err(0, 'No connection. Check your internet.', 'offline'); }
    var t = await r.text(), body = null; try { body = t ? JSON.parse(t) : null; } catch (e) { }
    if (!r.ok) throw err(r.status, friendly(r.status, body), body && (body.error_code || body.code || body.error));
    return body;
  }
  function take(s) {
    if (!s || !s.access_token) return null;
    session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: Date.now() + (s.expires_in || 3600) * 1000 - 60000, user: { id: s.user && s.user.id, email: s.user && s.user.email } };
    if (onSession) onSession(Cloud.sessionForStorage());
    return session;
  }
  async function token() {
    if (!session) throw err(401, 'Sign in again.', 'nosession');
    if (Date.now() < session.expires_at) return session.access_token;
    try { take(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })); }
    catch (e) { if (e.status === 400 || e.status === 401) { session = null; if (onSession) onSession(null); throw err(401, 'Your session ended. Sign in again.', 'nosession'); } throw e; }
    return session.access_token;
  }
  async function authed(path, opts) {
    opts = opts || {};
    var t = await token();
    try { return await call(path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}) })); }
    catch (e) {
      if (e.status !== 401) throw e;
      session.expires_at = 0; t = await token();   // the token was revoked or expired early: refresh once
      return call(path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}) }));
    }
  }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function strong(p) { return typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p); }

  /* ───── merge: newest change of each record wins; deletions stay deleted; totals are recomputed ───── */
  function stamp(x) { return x.updated_at || x.sent_at || x.created_at || ''; }
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    if ((a.reset_at || '') !== (b.reset_at || '')) return (a.reset_at || '') > (b.reset_at || '') ? a : b;   // erase/restore wins as a whole
    var out = JSON.parse(JSON.stringify(stamp(a) >= stamp(b) ? a : b));
    var gone = {}; (a.deleted || []).concat(b.deleted || []).forEach(function (id) { gone[id] = 1; });
    out.deleted = Object.keys(gone);
    ['clients', 'invoices', 'payments', 'events', 'followups'].forEach(function (k) {
      var m = {};
      (a[k] || []).concat(b[k] || []).forEach(function (x) {
        if (!x || gone[x.id]) return;
        var cur = m[x.id];
        if (!cur || stamp(x) > stamp(cur) || (stamp(x) === stamp(cur) && k === 'followups' && cur.status === 'due' && x.status !== 'due')) m[x.id] = x;
      });
      out[k] = Object.keys(m).map(function (id) { return m[id]; }).sort(function (x, y) { return (x.created_at || '').localeCompare(y.created_at || ''); });
    });
    out.me = ((a.me && a.me.updated_at) || '') >= ((b.me && b.me.updated_at) || '') ? a.me : b.me;
    var sa = a.settings_at || '', sb = b.settings_at || '';
    out.settings = sa >= sb ? a.settings : b.settings; out.settings_at = sa >= sb ? a.settings_at : b.settings_at;
    var pays = {};
    out.payments.forEach(function (p) { (pays[p.invoice_id] = pays[p.invoice_id] || []).push(p); });
    out.invoices.forEach(function (i) {   // payments from both phones count: work the totals out again
      var ps = pays[i.id] || [];
      i.paid = Math.round(ps.reduce(function (s, p) { return s + p.amount; }, 0) * 100) / 100;
      if (i.status !== 'void') {
        var done = i.paid >= i.amount - 0.001;
        i.status = done ? 'paid' : 'open';
        i.paid_on = done ? (i.paid_on || ps.map(function (p) { return p.paid_on; }).sort().pop() || null) : null;
        if (done) i.promise_on = null;
      }
    });
    out.updated_at = stamp(a) >= stamp(b) ? stamp(a) : stamp(b);
    return out;
  }

  var Cloud = {
    configured: function () { var c = cfg(); return !!(c.supabaseUrl && c.supabaseAnonKey); },
    config: cfg,
    setConfig: function (url, key) {
      url = String(url || '').trim().replace(/\/+$/, ''); key = String(key || '').trim();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) throw err(400, 'Enter the project URL, like https://abcd.supabase.co');
      if (!/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[\w-]+)$/.test(key)) throw err(400, 'Paste the anon (public) key from Project Settings → API.');
      root.localStorage.setItem('dues.cloud.config', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }));
    },
    onSession: function (fn) { onSession = fn; },
    restore: function (stored) { session = stored && stored.refresh_token ? Object.assign({ expires_at: 0 }, stored) : null; },
    sessionForStorage: function () { return session ? { refresh_token: session.refresh_token, access_token: session.access_token, expires_at: session.expires_at, user: session.user } : null; },
    user: function () { return session && session.user; },
    signedIn: function () { return !!session; },
    validEmail: validEmail, strong: strong, merge: merge,

    signUp: async function (email, password, name) {
      email = String(email || '').trim().toLowerCase();
      if (!validEmail(email)) throw err(400, 'Enter a valid email.');
      if (!strong(password)) throw err(400, 'Use at least 8 characters with letters and numbers.');
      var c = cfg();
      var r = await call('/auth/v1/signup' + (c.redirectTo ? '?redirect_to=' + encodeURIComponent(c.redirectTo) : ''), { method: 'POST', body: { email: email, password: password, data: { name: String(name || '').slice(0, 60) } } });
      if (r && r.access_token) { take(r); return { signedIn: true }; }
      return { signedIn: false, confirm: true };   // the project asks people to confirm their email first
    },
    signIn: async function (email, password) {
      email = String(email || '').trim().toLowerCase();
      if (!validEmail(email) || !password) throw err(400, 'Enter your email and password.');
      take(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email, password: password } }));
      return session.user;
    },
    recover: async function (email) {
      email = String(email || '').trim().toLowerCase();
      if (!validEmail(email)) throw err(400, 'Enter the email you signed up with.');
      var c = cfg();
      await call('/auth/v1/recover' + (c.redirectTo ? '?redirect_to=' + encodeURIComponent(c.redirectTo) : ''), { method: 'POST', body: { email: email } });
    },
    /* reset page: the email link signs you in for a moment so you can set a new password */
    setPasswordWithToken: async function (accessToken, password) {
      if (!strong(password)) throw err(400, 'Use at least 8 characters with letters and numbers.');
      await call('/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer ' + accessToken }, body: { password: password } });
    },
    changePassword: async function (password) {
      if (!strong(password)) throw err(400, 'Use at least 8 characters with letters and numbers.');
      await authed('/auth/v1/user', { method: 'PUT', body: { password: password } });
    },
    signOut: async function (everywhere) {
      var t = session && session.access_token;
      session = null; if (onSession) onSession(null);
      if (t) { try { await call('/auth/v1/logout' + (everywhere ? '?scope=global' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + t } }); } catch (e) { } }
    },

    deleteAccount: async function () {
      await authed('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
      session = null; if (onSession) onSession(null);
    },

    /* ───── data row ───── */
    pull: async function () {
      var rows = await authed('/rest/v1/dues_data?select=data,version,updated_at');
      return rows && rows[0] ? rows[0] : null;
    },
    /* save local data on top of `base` (the version we last saw). Returns the new version, merging first if needed. */
    sync: async function (local, base) {
      var remote = await Cloud.pull();
      if (!remote) {
        var ins = await authed('/rest/v1/dues_data', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { data: local, version: 1 } });
        return { data: local, version: ins[0].version, changed: false };
      }
      var data = local, changed = false;
      if (remote.version !== base) { data = merge(local, remote.data); changed = JSON.stringify(data) !== JSON.stringify(local); }
      if (JSON.stringify(data) === JSON.stringify(remote.data)) return { data: data, version: remote.version, changed: changed };
      var up = await authed('/rest/v1/dues_data?version=eq.' + remote.version, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { data: data, version: remote.version + 1 } });
      if (!up || !up.length) return Cloud.sync(data, -1);   // someone saved in between: merge again
      return { data: data, version: up[0].version, changed: changed };
    },
    /* erase or restore: this copy replaces the online one */
    overwrite: async function (local) {
      var remote = await Cloud.pull();
      if (!remote) { var ins = await authed('/rest/v1/dues_data', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { data: local, version: 1 } }); return ins[0].version; }
      var up = await authed('/rest/v1/dues_data?version=eq.' + remote.version, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { data: local, version: remote.version + 1 } });
      if (!up || !up.length) return Cloud.overwrite(local);
      return up[0].version;
    }
  };
  root.DuesCloud = Cloud;
})(typeof window !== 'undefined' ? window : globalThis);
