/* Email verification landing — calls the API with the emailed token and
   shows a clear success/failure state. */
(function () {
  'use strict';
  function byId(id) { return document.getElementById(id); }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const msg = byId('vMsg');
    if (!token) { if (msg) msg.textContent = 'No verification token found in this link.'; return; }
    if (msg) msg.textContent = 'Verifying your email…';
    const res = await window.api('/api/auth/verify-email?token=' + encodeURIComponent(token), 'GET', null, false);
    if (msg) {
      msg.textContent = res.message || (res.error ? 'Verification failed.' : 'Email verified.');
      msg.style.color = (res.error ? 'var(--red-600)' : 'var(--green-700, #047857)');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
