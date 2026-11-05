/* Sign in / create account. On success the server sets the session cookie and we open the app. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function paintTheme() {
    var dark = document.body.classList.contains('dark');
    $('#themeBtn').innerHTML = dark ? SUN : MOON;
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0a0d0a' : '#e9e9e9';
  }
  $('#themeBtn').onclick = function () {
    var dark = document.body.classList.toggle('dark');
    try { localStorage.setItem('dues_theme', dark ? 'dark' : 'light'); } catch (e) { }
    paintTheme();
  };
  paintTheme();

  var mode = 'in';
  function setMode(m) {
    mode = m;
    $('#tabIn').classList.toggle('on', m === 'in'); $('#tabUp').classList.toggle('on', m === 'up');
    $('#tabIn').setAttribute('aria-selected', String(m === 'in')); $('#tabUp').setAttribute('aria-selected', String(m === 'up'));
    $('#fName').hidden = $('#fBiz').hidden = m === 'in';
    $('#title').textContent = m === 'in' ? 'Welcome back' : 'Create your account';
    $('#sub').textContent = m === 'in' ? 'Sign in to see who owes you and who to remind today.' : 'Free to start. Add your first invoice in a minute.';
    $('#go').textContent = m === 'in' ? 'Sign in' : 'Create account';
    $('#pass').autocomplete = m === 'in' ? 'current-password' : 'new-password';
    $('#err').textContent = '';
  }
  $('#tabIn').onclick = function () { setMode('in'); };
  $('#tabUp').onclick = function () { setMode('up'); };
  if (location.hash === '#signup') setMode('up');

  // already signed in? go straight to the app
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { if (r.ok) location.replace('/app'); }).catch(function () { });

  $('#form').onsubmit = function (e) {
    e.preventDefault();
    var err = $('#err'), go = $('#go'); err.textContent = '';
    var body = { username: $('#user').value.trim(), password: $('#pass').value };
    if (!body.username || !body.password) { err.textContent = 'Enter your username and password.'; return; }
    if (mode === 'up') { body.name = $('#name').value.trim(); body.business = $('#biz').value.trim(); if (body.password.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; } }
    go.disabled = true; go.textContent = mode === 'in' ? 'Signing in…' : 'Creating…';
    fetch(mode === 'in' ? '/api/login' : '/api/signup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.'); location.replace('/app'); }); })
      .catch(function (x) { err.textContent = x.message === 'Failed to fetch' ? 'No connection. Check your internet.' : x.message; go.disabled = false; go.textContent = mode === 'in' ? 'Sign in' : 'Create account'; });
  };
})();
