/* Password reset: the email link lands here with a short-lived sign-in in the address (#access_token=…&type=recovery).
   We read it, clear it from the address bar at once, and use it only to set the new password. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var h = new URLSearchParams((location.hash || '').slice(1));
  var token = h.get('access_token'), type = h.get('type'), bad = h.get('error_description');
  try { history.replaceState(null, '', location.pathname); } catch (e) { }
  function show(sel, msg) { var e = $(sel); e.textContent = msg || ''; e.hidden = !msg; }
  document.querySelectorAll('[data-eye]').forEach(function (b) { b.onclick = function () { var i = document.getElementById(b.dataset.eye); var s = i.type === 'password'; i.type = s ? 'text' : 'password'; b.textContent = s ? 'Hide' : 'Show'; }; });
  if (!token || type !== 'recovery') {
    $('#f').hidden = true;
    var p = document.createElement('p'); p.className = 'lbl'; p.style.lineHeight = '1.5';
    p.textContent = bad ? 'This link did not work: ' + bad.replace(/\+/g, ' ') + '. Ask for a new one from the Dues sign-in screen.' : 'Open the link from your password reset email to get here. Links work once and expire after an hour.';
    $('#box').appendChild(p); return;
  }
  $('#f').onsubmit = function (e) {
    e.preventDefault(); show('.err'); var b = $('button[type=submit]');
    if ($('#p1').value !== $('#p2').value) return show('.err', 'The passwords do not match.');
    b.disabled = true;
    window.DuesCloud.setPasswordWithToken(token, $('#p1').value).then(function () {
      token = null; $('#f').querySelectorAll('input,button[type=submit]').forEach(function (x) { x.disabled = true; });
      show('.okmsg', 'Password saved. Open Dues and sign in with it.');
    }).catch(function (x) { b.disabled = false; show('.err', x.message); });
  };
})();
