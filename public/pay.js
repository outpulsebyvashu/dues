/* Client pay page: pay.html#<data>. The invoice details travel inside the link (no server), so this works on any static host.
   Shows what is owed and how to pay (UPI in one tap, an online payment link if added), and lets the client tell you they've paid. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var root = $('#root');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { var v = Math.round(n * 100) / 100; return v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function day(s) { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function ph(p) { p = String(p || ''); return /^\+91\d{10}$/.test(p) ? '+91 ' + p.slice(3, 8) + ' ' + p.slice(8) : p; }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2600); }
  var STAR = '<svg class="star" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0C55 30 70 45 100 50 70 55 55 70 50 100 45 70 30 55 0 50 30 45 45 30 50 0Z" fill="rgba(255,255,255,.3)"/></svg>';
  var TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function read() {
    var h = location.hash.slice(1); if (!h) return null;
    try {
      var b = atob(h.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((h.length + 3) % 4)), bytes = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
      var d = JSON.parse(new TextDecoder().decode(bytes));
      return d && d.n && typeof d.a === 'number' ? d : null;
    } catch (e) { return null; }
  }
  var d = read();
  if (!d) { root.innerHTML = '<section class="card paid"><h1 style="font-size:22px;font-weight:400">Link not found</h1><p class="lbl" style="margin-top:6px">This payment link is incomplete. Ask for the link again.</p></section>'; return; }
  document.title = (d.b ? d.b + ' · ' : '') + 'Invoice ' + d.n;
  var c = esc(d.c || '₹'), today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  if (d.s !== 'open' || d.p <= 0) {
    root.innerHTML = '<section class="card paid"><div class="tick">' + TICK + '</div><h1 style="font-size:24px;font-weight:400">' + (d.s === 'void' ? 'This invoice was cancelled' : 'All paid') + '</h1>' +
      '<p class="lbl" style="margin-top:6px">Invoice ' + esc(d.n) + (d.b ? ' · ' + esc(d.b) : '') + (d.s === 'paid' ? '. Thank you!' : '') + '</p></section>';
    return;
  }
  var late = d.d < today;
  var upi = d.u ? 'upi://pay?pa=' + encodeURIComponent(d.u) + '&pn=' + encodeURIComponent(d.b || 'Payee') + '&am=' + Number(d.p).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Invoice ' + d.n) : '';
  var h = '<section class="card c-lime">' + STAR + '<div class="who">' + esc(d.b || 'Invoice') + '</div>' +
    '<div class="big2"><span><span class="cur">' + c + '</span>' + fmt(d.p) + '</span>' + (late ? ' <span class="chip">Overdue</span>' : '') + '</div>' +
    '<div class="sub">' + (d.k ? 'For ' + esc(d.k) + ' · ' : '') + 'Invoice ' + esc(d.n) + (d.x ? ' · ' + esc(d.x) : '') + '<br>' + (late ? 'Was due ' : 'Due ') + esc(day(d.d)) + (d.p < d.a ? ' · ' + c + fmt(d.a - d.p) + ' already paid' : '') + '</div></section>';
  h += '<section class="card"><div class="ch"><h2>Pay ' + c + fmt(d.p) + '</h2></div><div class="form">';
  if (upi) h += '<a class="btn solid full" href="' + esc(upi) + '">Pay with UPI app</a><div class="panel" style="margin:4px 0 0"><div class="lbl">Or pay to UPI ID</div><div class="upi">' + esc(d.u) + '</div></div><button class="btn soft full" type="button" id="copyUpi">Copy UPI ID</button>';
  if (d.l && /^https:\/\//i.test(d.l)) h += '<a class="btn ' + (upi ? 'ghost' : 'solid') + ' full" href="' + esc(d.l) + '" rel="noopener">Card, netbanking or wallet</a>';
  if (!upi && !d.l) h += '<p class="lbl" style="line-height:1.6">Please pay ' + esc(d.b || 'us') + ' the way you usually do' + (d.t || d.e ? ', or get in touch: ' + esc([ph(d.t), d.e].filter(Boolean).join(' · ')) : '') + '.</p>';
  h += '</div></section>';
  if (d.t || d.e) h += '<section class="card"><div class="ch"><h2>Already paid?</h2></div><form class="form" id="claim" novalidate><label class="field"><span>UPI / bank reference (optional)</span><input id="ref" maxlength="80" placeholder="12-digit UTR"></label>' +
    '<button class="btn ghost full" type="submit">Tell ' + esc(d.b || 'them') + ' I’ve paid</button></form></section>';
  if (d.t || d.e) h += '<p class="foot">Questions? ' + (d.t ? '<a href="tel:' + esc(d.t) + '" style="color:var(--pos)">' + esc(ph(d.t)) + '</a>' : '') + (d.t && d.e ? ' · ' : '') + (d.e ? '<a href="mailto:' + esc(d.e) + '" style="color:var(--pos)">' + esc(d.e) + '</a>' : '') + '</p>';
  h += '<p class="foot">Sent with Dues</p>';
  root.innerHTML = h;
  var cu = $('#copyUpi'); if (cu) cu.onclick = function () { try { navigator.clipboard.writeText(d.u).then(function () { toast('UPI ID copied'); }, function () { prompt('UPI ID', d.u); }); } catch (e) { prompt('UPI ID', d.u); } };
  var cl = $('#claim'); if (cl) cl.onsubmit = function (e) {
    e.preventDefault();
    var ref = $('#ref').value.trim();
    var msg = 'Hi, I have paid invoice ' + d.n + ' (' + (d.c || '₹') + fmt(d.p) + ').' + (ref ? ' Reference: ' + ref + '.' : '');
    location.href = d.t ? 'https://wa.me/' + String(d.t).replace(/\D/g, '') + '?text=' + encodeURIComponent(msg)
      : 'mailto:' + encodeURIComponent(d.e) + '?subject=' + encodeURIComponent('Paid: invoice ' + d.n) + '&body=' + encodeURIComponent(msg);
  };
})();
