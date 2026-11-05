/* Public pay page: /p/<token>. Shows what is owed and how to pay (UPI in one tap, Razorpay if set up), and lets the client say "I've paid". */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var root = $('#root'), token = location.pathname.split('/').pop();
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { var v = Math.round(n * 100) / 100; return v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function day(s) { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function ph(p) { p = String(p || ''); return /^\+91\d{10}$/.test(p) ? '+91 ' + p.slice(3, 8) + ' ' + p.slice(8) : p; }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2600); }
  var STAR = '<svg class="star" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0C55 30 70 45 100 50 70 55 55 70 50 100 45 70 30 55 0 50 30 45 45 30 50 0Z" fill="rgba(255,255,255,.3)"/></svg>';
  var TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  fetch('/api/pay/' + encodeURIComponent(token)).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'This link is not valid.'); return d; }); }).then(function (d) {
    document.title = (d.business ? d.business + ' · ' : '') + 'Invoice ' + d.number;
    var c = esc(d.currency || '₹');
    if (d.status !== 'open' || d.balance <= 0) {
      root.innerHTML = '<section class="card paid"><div class="tick">' + TICK + '</div><h1 style="font-size:24px;font-weight:400">' + (d.status === 'void' ? 'This invoice was cancelled' : 'All paid') + '</h1>' +
        '<p class="lbl" style="margin-top:6px">Invoice ' + esc(d.number) + (d.business ? ' · ' + esc(d.business) : '') + (d.status === 'paid' ? '. Thank you!' : '') + '</p></section>';
      return;
    }
    var late = d.due_on < d.today;
    var h = '<section class="card c-lime">' + STAR + '<div class="who">' + esc(d.business || 'Invoice') + '</div>' +
      '<div class="big2"><span><span class="cur">' + c + '</span>' + fmt(d.balance) + '</span>' + (late ? ' <span class="chip">Overdue</span>' : '') + '</div>' +
      '<div class="sub">Invoice ' + esc(d.number) + (d.description ? ' · ' + esc(d.description) : '') + '<br>' + (late ? 'Was due ' : 'Due ') + esc(day(d.due_on)) + (d.balance < d.amount ? ' · ' + c + fmt(d.amount - d.balance) + ' already paid' : '') + '</div></section>';
    h += '<section class="card"><div class="ch"><h2>Pay ' + c + fmt(d.balance) + '</h2></div><div class="form">';
    if (d.upi) h += '<a class="btn solid full" href="' + esc(d.upi) + '" id="upi">Pay with UPI app</a><div class="panel" style="margin:4px 0 0"><div class="lbl">Or pay to UPI ID</div><div class="upi">' + esc(d.upi_id) + '</div></div><button class="btn soft full" type="button" id="copyUpi">Copy UPI ID</button>';
    if (d.razorpay) h += '<a class="btn ' + (d.upi ? 'ghost' : 'solid') + ' full" href="' + esc(d.razorpay) + '" rel="noopener">Card, netbanking or wallet</a>';
    if (!d.upi && !d.razorpay) h += '<p class="lbl" style="line-height:1.6">Please pay ' + esc(d.business || 'us') + ' the way you usually do' + (d.phone || d.email ? ', or get in touch: ' + esc([ph(d.phone), d.email].filter(Boolean).join(' · ')) : '') + '.</p>';
    h += '</div></section>';
    h += '<section class="card"><div class="ch"><h2>Already paid?</h2></div><form class="form" id="claim" novalidate><label class="field"><span>UPI / bank reference (optional)</span><input id="ref" maxlength="80" placeholder="12-digit UTR"></label>' +
      '<p class="err" hidden></p><button class="btn ghost full" type="submit" id="go">Tell ' + esc(d.business || 'them') + ' I’ve paid</button></form></section>';
    if (d.phone || d.email) h += '<p class="foot">Questions? ' + (d.phone ? '<a href="tel:' + esc(d.phone) + '" style="color:var(--pos)">' + esc(ph(d.phone)) + '</a>' : '') + (d.phone && d.email ? ' · ' : '') + (d.email ? '<a href="mailto:' + esc(d.email) + '" style="color:var(--pos)">' + esc(d.email) + '</a>' : '') + '</p>';
    h += '<p class="foot">Sent with Dues</p>';
    root.innerHTML = h;
    var cu = $('#copyUpi'); if (cu) cu.onclick = function () { try { navigator.clipboard.writeText(d.upi_id).then(function () { toast('UPI ID copied'); }); } catch (e) { prompt('UPI ID', d.upi_id); } };
    $('#claim').onsubmit = function (e) {
      e.preventDefault(); var b = $('#go'); b.disabled = true;
      fetch('/api/pay/' + encodeURIComponent(token) + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: $('#ref').value.trim() }) })
        .then(function (r) { return r.json().then(function (x) { if (!r.ok) throw new Error(x.error); }); })
        .then(function () { $('#claim').innerHTML = '<div class="note" style="border:0;background:var(--chip)"><b>Thanks!</b> <span>' + esc(d.business || 'They') + ' will confirm it.</span></div>'; })
        .catch(function (x) { b.disabled = false; var er = $('#claim .err'); er.textContent = x.message || 'Could not send. Try again.'; er.hidden = false; });
    };
  }).catch(function (e) {
    root.innerHTML = '<section class="card paid"><h1 style="font-size:22px;font-weight:400">Link not found</h1><p class="lbl" style="margin-top:6px">' + esc(e.message) + '</p></section>';
  });
})();
