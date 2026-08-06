/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — Account recovery page.
   Handles:
     1. /recover?token=...  → validates the emailed link, clears old passkeys
        (POST /api/auth/recover/complete) and offers to enroll a new one.
     2. Recovery code flow   → POST /api/auth/recover/with-code, then enroll.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function setMsg(text, color) {
    const el = byId('recMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color || 'var(--red-600)';
  }

  const PENDING = { mode: null, email: null };

  function dashboardForRole(role) {
    if (role === 'Admin') return '/dashboard.html';
    if (role === 'Customer') return '/customer.html';
    if (role === 'Driver') return '/driver.html';
    return '/dashboard.html';
  }

  async function enrollPasskey(email, msgEl) {
    if (typeof SimpleWebAuthnBrowser === 'undefined') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/libs/simplewebauthn-browser.umd.min.js';
        s.onload = resolve; s.onerror = () => reject(new Error('Failed to load WebAuthn library'));
        document.head.appendChild(s);
      });
    }
    const optsRes = await window.api('/api/auth/webauthn/register/options', 'POST', { email }, false);
    if (optsRes.error) throw new Error(optsRes.message || 'Could not start passkey setup');
    // Pin to the on-device authenticator (Windows Hello / PIN / face) so the
    // browser never asks to insert a USB security key.
    if (window.forcePlatformAuthenticator) window.forcePlatformAuthenticator(optsRes);
    let att;
    try {
      att = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optsRes });
    } catch (e) {
      throw new Error('Passkey registration failed: ' + (e.message || e));
    }
    const verify = await window.api('/api/auth/webauthn/register', 'POST', { email, attestationResponse: att }, false);
    if (verify.error || !verify.verified) throw new Error(verify.message || 'Server verification failed');
    if (verify.token) window.authToken = verify.token;
    return verify;
  }

  function showEnrollView(email) {
    const card = document.querySelector('.auth-form-card');
    if (!card) return;
    card.innerHTML = `
      <span class="eyebrow">Account unlocked</span>
      <h1 style="font-size:26px;margin-top:8px;">Almost there</h1>
      <p style="color:var(--text-muted);font-size:14px;margin-top:8px;margin-bottom:20px;">
        The old passkeys for <strong>${window.SecureTMS ? window.SecureTMS.escapeHtml(email) : email}</strong> were removed.
        Enroll a fresh passkey on this device to sign back in.
      </p>
      <button class="btn btn-lg" id="enrollBtn" type="button" style="width:100%;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px;margin-right:6px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11 V7 A5 5 0 0 1 17 7 V11"/></svg>
        Enroll passkey on this device
      </button>
      <p id="enrollMsg" style="margin-top:14px;font-size:13px;color:var(--red-600);min-height:18px;" role="status" aria-live="polite"></p>
      <p style="margin-top:10px;font-size:12px;color:var(--text-faint);">
        <a href="/login.html" style="color:inherit;">Back to sign in</a>
      </p>`;
    byId('enrollBtn').addEventListener('click', async () => {
      const em = byId('enrollMsg');
      if (em) { em.textContent = 'Enrolling your new passkey…'; em.style.color = 'var(--text-muted)'; }
      try {
        const v = await enrollPasskey(email);
        if (em) { em.textContent = 'Passkey enrolled — taking you to your dashboard…'; em.style.color = 'var(--green-700, #047857)'; }
        setTimeout(() => { window.location.href = dashboardForRole(v.user && v.user.role); }, 700);
      } catch (e) {
        if (em) { em.textContent = (e && e.message) || 'Enrollment failed. Please try again.'; em.style.color = 'var(--red-600)'; }
      }
    });
  }

  async function init() {
    // Mode 1: valid emailed recovery link in the URL.
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      const res = await window.api('/api/auth/recover/validate?token=' + encodeURIComponent(token), 'GET', null, false);
      if (res.error || !res.valid || !res.email) {
        setMsg(res.message || 'This recovery link is invalid or has expired. Request a new one below.', 'var(--red-600)');
      } else {
        // Complete the recovery (clears old passkeys) then offer re-enrollment.
        PENDING.mode = 'link'; PENDING.email = res.email;
        const done = await window.api('/api/auth/recover/complete', 'POST', { token }, false);
        if (done.error || !done.ok) {
          setMsg(done.message || 'Could not complete recovery. Please try again.', 'var(--red-600)');
        } else {
          showEnrollView(res.email);
          return;
        }
      }
    }

    // Mode 2: form flows.
    byId('recoverForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = byId('recEmail').value.trim();
      const recoveryEmail = byId('recRecovery').value.trim();
      if (!email || !recoveryEmail) { setMsg('Enter both email addresses.'); return; }
      setMsg('Sending recovery link…', 'var(--text-muted)');
      const res = await window.api('/api/auth/recover', 'POST', { email, recoveryEmail }, false);
      setMsg(res.message || 'Request processed.', 'var(--green-700, #047857)');
    });

    byId('recTabCode').addEventListener('click', () => {
      byId('codeForm').style.display = byId('codeForm').style.display === 'none' ? '' : 'none';
    });

    byId('codeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = byId('codeEmail').value.trim();
      const code = byId('codeInput').value.trim();
      if (!email || !code) { setMsg('Enter your email and recovery code.'); return; }
      setMsg('Verifying recovery code…', 'var(--text-muted)');
      const res = await window.api('/api/auth/recover/with-code', 'POST', { email, code }, false);
      if (res.error || !res.ok) {
        setMsg(res.message || 'Recovery code rejected.', 'var(--red-600)');
      } else {
        setMsg('Code accepted — enrolling a new passkey…', 'var(--green-700, #047857)');
        showEnrollView(res.email);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
