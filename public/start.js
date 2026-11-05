/* Opens the app when signed in, the sign-in page otherwise. */
fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { location.replace(r.ok ? '/app' : '/login'); }, function () { location.replace('/login'); });
