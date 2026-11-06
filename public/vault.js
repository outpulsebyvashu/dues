/* Dues vault: everything Dues keeps on the phone is encrypted.
   - A random 256-bit data key encrypts the data with AES-GCM (a fresh IV on every save).
   - The data key is locked with a key derived from your PIN (PBKDF2-SHA256, 310,000 rounds, random salt).
   - Only ciphertext is written to storage. The sign-in token for online sync is inside the encrypted part.
   - Wrong PINs make you wait longer each time. The fingerprint (Android) unlocks the data key held by the phone's keystore.
   Nothing here talks to the network. */
(function (root) {
  'use strict';
  var KEY = 'dues.vault.v1';
  var ITER = 310000;
  var subtle = root.crypto && root.crypto.subtle;
  var te = new TextEncoder(), td = new TextDecoder();
  var storage = root.localStorage;
  var dek = null;           // the data key while unlocked (CryptoKey); null when locked
  var rec = null;           // the stored record

  function b64(bytes) { var s = ''; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  function rand(n) { return root.crypto.getRandomValues(new Uint8Array(n)); }
  function read() { try { var r = storage.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function write(r) {
    try { storage.setItem(KEY, JSON.stringify(r)); }
    catch (e) { var x = new Error('This phone is out of space for Dues data. Export a backup, then remove old paid invoices.'); x.status = 507; throw x; }
  }
  function err(code, message, extra) { var e = new Error(message); e.code = code; if (extra) Object.assign(e, extra); return e; }

  function pinOk(pin) { return typeof pin === 'string' && (/^\d{6,12}$/.test(pin) || pin.length >= 8); }
  async function kek(pin, salt, iter) {
    var base = await subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, bytes) { var iv = rand(12); var ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes); return { iv: b64(iv), ct: b64(ct) }; }
  async function open(key, box) { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct))); }
  async function importDek(raw) { return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']); }

  /* wrong PINs: free tries, then 30s, 1 min, 5 min, 15 min */
  function waitFor(n) { return n < 5 ? 0 : n === 5 ? 30 : n === 6 ? 60 : n === 7 ? 300 : 900; }
  function throttle() {
    var f = (rec && rec.fails) || { n: 0, until: 0 };
    var left = Math.ceil(((f.until || 0) - Date.now()) / 1000);
    if (left > 0) throw err('wait', 'Too many wrong tries. Try again in ' + (left >= 60 ? Math.ceil(left / 60) + ' min' : left + ' s') + '.', { wait: left });
  }
  function failed() {
    var f = rec.fails || { n: 0, until: 0 }; f.n++;
    var w = waitFor(f.n); f.until = w ? Date.now() + w * 1000 : 0; rec.fails = f; write(rec);
    return err('wrong', w ? 'Wrong PIN. Wait ' + (w >= 60 ? w / 60 + ' min' : w + ' s') + ' before trying again.' : 'Wrong PIN. ' + (5 - f.n) + ' tries left before a wait.', { tries: f.n, wait: w });
  }

  var Vault = {
    exists: function () { rec = read(); return !!(rec && rec.v === 1 && rec.wrap && rec.data); },
    isUnlocked: function () { return !!dek; },
    pinOk: pinOk,
    bioOn: function () { rec = rec || read(); return !!(rec && rec.bio); },

    /* first time: make the data key, lock it with the PIN, save the payload */
    create: async function (pin, payload) {
      if (!pinOk(pin)) throw err('weak', 'Use at least 6 digits, or a passphrase of 8 or more characters.');
      var raw = rand(32), salt = rand(16);
      dek = await importDek(raw);
      var k = await kek(pin, salt, ITER);
      rec = { v: 1, kdf: { name: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt) }, wrap: await seal(k, raw), data: null, bio: false, fails: { n: 0, until: 0 }, created: new Date().toISOString() };
      rec.data = await seal(dek, te.encode(JSON.stringify(payload)));
      write(rec);
      return payload;
    },
    unlock: async function (pin) {
      rec = read(); if (!rec) throw err('none', 'Nothing to unlock.');
      throttle();
      var raw;
      try { raw = await open(await kek(pin, unb64(rec.kdf.salt), rec.kdf.iter), rec.wrap); }
      catch (e) { throw failed(); }
      dek = await importDek(raw);
      rec.fails = { n: 0, until: 0 }; write(rec);
      return JSON.parse(td.decode(await open(dek, rec.data)));
    },
    /* fingerprint: the phone's keystore hands back the data key */
    unlockWithKey: async function (rawB64) {
      rec = read(); if (!rec) throw err('none', 'Nothing to unlock.');
      var k = await importDek(unb64(rawB64));
      var data;
      try { data = JSON.parse(td.decode(await open(k, rec.data))); } catch (e) { throw err('bio', 'Fingerprint unlock no longer matches. Use your PIN.'); }
      dek = k; rec.fails = { n: 0, until: 0 }; write(rec);
      return data;
    },
    save: async function (payload) {
      if (!dek) throw err('locked', 'Dues is locked.');
      var box = await seal(dek, te.encode(JSON.stringify(payload)));
      rec = read() || rec; rec.data = box; write(rec);
    },
    rawKey: async function () { if (!dek) throw err('locked', 'Dues is locked.'); return b64(await subtle.exportKey('raw', dek)); },
    changePin: async function (oldPin, newPin) {
      if (!pinOk(newPin)) throw err('weak', 'Use at least 6 digits, or a passphrase of 8 or more characters.');
      rec = read(); throttle();
      var raw;
      try { raw = await open(await kek(oldPin, unb64(rec.kdf.salt), rec.kdf.iter), rec.wrap); } catch (e) { throw failed(); }
      var salt = rand(16);
      rec.kdf = { name: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt) };
      rec.wrap = await seal(await kek(newPin, salt, ITER), raw);
      rec.fails = { n: 0, until: 0 };
      write(rec);
    },
    setBio: function (on) { rec = read(); if (rec) { rec.bio = !!on; write(rec); } },
    lock: function () { dek = null; },
    wipe: function () { dek = null; rec = null; try { storage.removeItem(KEY); } catch (e) { } },
    _iter: ITER
  };
  root.DuesVault = Vault;
})(typeof window !== 'undefined' ? window : globalThis);
