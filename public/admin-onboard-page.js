/*════════════════════════════════════════════════════════════════════════════
SecureTMS — Admin invite landing page (?token=...).
Owns: invite-token validation, form prefill, admin registration + passkey
enrolment. Depends on app.js (api, registerPasskey).
═══════════════════════════════════════════════════════════════════════════*/
'use strict';

(function () {
  const PARAMS = new URLSearchParams(window.location.search);
  const TOKEN  = PARAMS.get('token');

  function setMsg(el, text, color) {
    if (!el) return;
    if (color) el.style.color = color;
    el.textContent = text;
  }

  function showInvalid(state, heading, body) {
    state.innerHTML = `
      <div class="invite-banner" style="background:var(--red-50);border-color:rgba(239,68,68,0.30);color:var(--red-700);">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" style="flex-shrink:0;margin-top:2px;">
          <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/>
        </svg>
        <div>
          <strong>${heading}</strong>
          ${body}
        </div>
      </div>`;
  }

  async function checkInvite() {
    const state = document.getElementById('inviteState');
    const form  = document.getElementById('onboardForm');
    if (!state || !form) return;

    if (!TOKEN) {
      showInvalid(state,
        'Missing invitation token.',
        'You can only access this page through a unique invitation link issued by an existing admin or the bootstrap CLI.');
      return;
    }

    const res = await window.api('/api/auth/invites/' + encodeURIComponent(TOKEN), 'GET', null, false);

    if (!res || res.error || !res.valid) {
      showInvalid(state,
        'Invitation not valid.',
        'It may have expired, already been used, or been revoked. Contact the admin who invited you.');
      return;
    }

    state.style.display = 'none';
    form.style.display = '';

    const emailInput = document.getElementById('admEmail');
    if (res.email && emailInput) {
      emailInput.value     = res.email;
      emailInput.readOnly  = true;
      const note = document.getElementById('emailLockedNote');
      if (note) note.textContent = '(locked by invitation)';
    }

    const banner = document.getElementById('inviteBanner');
    if (banner) banner.style.display = '';
    const meta = document.getElementById('inviteMeta');
    if (meta) {
      meta.textContent =
        ' Role: ' + (res.role || 'Admin') +
        (res.invitedBy ? ' · Invited by ' + res.invitedBy : '') +
        (res.expiresAt ? ' · Expires ' + new Date(res.expiresAt).toLocaleDateString() : '') +
        '.';
    }

    const btn = document.getElementById('onboardBtn');
    if (btn) btn.addEventListener('click', registerAdmin);
  }

  async function registerAdmin() {
    const name  = (document.getElementById('admName')     || {}).value || '';
    const email = (document.getElementById('admEmail')    || {}).value || '';
    const recov = (document.getElementById('admRecovery') || {}).value || '';
    const msgEl = document.getElementById('onboardMsg');
    const btn   = document.getElementById('onboardBtn');

    const nameTrim  = name.trim();
    const emailTrim = email.trim();
    const recovTrim = recov.trim();

    if (!nameTrim || !emailTrim || !recovTrim) {
      setMsg(msgEl, 'Please fill in all fields.', 'var(--red-600)');
      return;
    }

    if (btn) btn.disabled = true;
    setMsg(msgEl, 'Creating admin account…', 'var(--text-muted)');

    const reg = await window.api('/api/auth/register', 'POST', {
      name:           nameTrim,
      email:          emailTrim,
      recoveryEmail:  recovTrim,
      role:           'Admin',
      inviteToken:    TOKEN
    }, false);

    if (reg && reg.error) {
      if (btn) btn.disabled = false;
      setMsg(msgEl, reg.message || 'Could not create account.', 'var(--red-600)');
      return;
    }

    setMsg(msgEl, 'Admin account created. Enrolling your passkey…', 'var(--text-muted)');

    try {
      if (typeof window.registerPasskey === 'function') await window.registerPasskey();
      setMsg(msgEl, 'Admin registered. Redirecting to the operations console…', 'var(--green-700)');
      setTimeout(() => { window.location.href = '/dashboard.html'; }, 700);
    } catch (e) {
      if (btn) btn.disabled = false;
      setMsg(msgEl,
        'Account created but passkey enrollment failed: ' + (e && e.message ? e.message : e) + '. Sign in again to retry.',
        'var(--red-600)'
      );
    }
  }

  window.onReady(checkInvite);
})();
