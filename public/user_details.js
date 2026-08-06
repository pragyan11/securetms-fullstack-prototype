/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — My account page logic.
   Profile edit, email verification, device sessions, recovery codes and
   GDPR export / deletion. Relies on app.js (window.api, window.requireAuth).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function fmtDate(s) { if (!s) return '—'; try { return new Date(s).toLocaleString(); } catch { return '—'; } }
  function setText(id, text) { const el = byId(id); if (el) el.textContent = text; }
  function show(id) { const el = byId(id); if (el) el.style.display = ''; }
  function hide(id) { const el = byId(id); if (el) el.style.display = 'none'; }

  function getToastContainer() {
    let c = byId('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'ss-toast-container'; document.body.appendChild(c); }
    return c;
  }
  function showToast(message, type = 'success') {
    const t = document.createElement('div');
    t.className = 'ss-toast ss-toast--' + type;
    t.innerHTML = `<div class="ss-toast-icon">${type === 'success' ? '✓' : '!'}</div><div class="ss-toast-text">${esc(message)}</div>`;
    getToastContainer().appendChild(t);
    setTimeout(() => t.remove(), 3400);
  }

  function fallbackBackUrl(role) {
    if (role === 'Admin') return '/dashboard.html';
    if (role === 'Customer') return '/customer.html';
    if (role === 'Driver') return '/driver.html';
    return '/dashboard.html';
  }

  let profileUser = null;

  async function loadProfile() {
    show('profileSkeleton'); hide('profileOutput');
    const user = await window.api('/api/auth/me', 'GET', null, true);
    if (user.error) { showToast('Could not load profile: ' + (user.message || 'unknown error'), 'error'); return; }
    profileUser = user;

    setText('profileName', user.name || '—');
    setText('profileEmail', user.email || '—');
    setText('profileRole', user.role || '—');
    setText('profileCreated', fmtDate(user.createdAt));
    setText('userName', user.name || 'Account');
    setText('userRole', user.role || 'User');
    setText('footerRole', user.role ? user.role + ' view' : 'User view');
    setText('userAvatar', (user.name || 'AC').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase());
    byId('editName').value = user.name || '';
    byId('editRecovery').value = user.recoveryEmail || '';

    const backUrl = fallbackBackUrl(user.role);
    byId('backToAppLink')?.setAttribute('href', backUrl);
    byId('backToAppBtn')?.setAttribute('href', backUrl);

    // Email verification banner (A2).
    if (!user.emailVerified) {
      const b = byId('verifyBanner');
      if (b) { b.style.display = 'flex'; setText('verifyBannerMsg', 'Your email ' + user.email + " isn't verified yet — check your inbox for the confirmation link."); }
    } else {
      hide('verifyBanner');
    }

    hide('profileSkeleton'); show('profileOutput');
    return user;
  }

  async function saveProfile(e) {
    e.preventDefault();
    const msg = byId('profileEditMsg');
    if (msg) msg.textContent = 'Saving…';
    const res = await window.api('/api/auth/me', 'PUT', {
      name: byId('editName').value.trim(),
      recoveryEmail: byId('editRecovery').value.trim()
    }, true);
    if (res.error) { if (msg) { msg.textContent = res.message || 'Save failed.'; msg.style.color = 'var(--red-600)'; } return; }
    if (msg) { msg.textContent = 'Saved ✓'; msg.style.color = 'var(--green-700, #047857)'; }
    setText('profileName', res.name || '—');
    showToast('Profile updated');
    await loadProfile();
  }

  async function resendVerification() {
    const res = await window.api('/api/auth/resend-verification', 'POST', {}, true);
    showToast(res.message || (res.error ? res.message : 'Sent'), res.error ? 'error' : 'success');
  }

  async function loadPasskeys() {
    show('passkeysSkeleton'); hide('passkeysOutput');
    const data = await window.api('/api/auth/me/credentials', 'GET', null, true);
    if (data.error) { showToast('Could not load passkeys: ' + (data.message || 'unknown'), 'error'); return; }
    const creds = Array.isArray(data.credentials) ? data.credentials : [];
    const output = byId('passkeysOutput');
    if (!output) return;
    if (creds.length === 0) {
      output.innerHTML = `<div class="empty-state is-illustrated"><div class="empty-state-illu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11 V7 A5 5 0 0 1 17 7 V11"/></svg></div><div class="empty-state-title">No passkeys yet</div><div class="empty-state-msg">Register one from the login page's “Set up passkey on this device”.</div></div>`;
      hide('passkeysSkeleton'); show('passkeysOutput'); return;
    }
    output.innerHTML = creds.map((c, idx) => {
      const transports = Array.isArray(c.transports) && c.transports.length
        ? c.transports.map(t => `<span class="pill is-info" style="margin:2px 0;">${esc(t)}</span>`).join(' ')
        : '<span class="pill is-other" style="margin:2px 0;">Unknown</span>';
      return `<div style="border:1px solid var(--border-soft);border-radius:var(--r-md);padding:16px;margin-bottom:14px;background:var(--bg-soft);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <div><div style="font-weight:600;color:var(--text-hi);">Passkey #${idx + 1}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Registered credential</div></div>
          <span class="pill ${(c.counter || 0) > 0 ? 'is-info' : 'is-other'}">Counter: ${c.counter || 0}</span>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Credential ID</div>
          <code class="font-mono" style="display:block;word-break:break-all;background:white;border:1px solid var(--border-soft);border-radius:var(--r-sm);padding:8px 10px;font-size:12px;color:var(--text-hi);margin-top:4px;">${esc(c.credentialID)}</code>
        </div>
        <div style="margin-top:10px;">
          <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:4px;">Transports</div>
          <div>${transports}</div>
        </div>
      </div>`;
    }).join('');
    hide('passkeysSkeleton'); show('passkeysOutput');
  }

  /* ── Sessions (A4) ─────────────────────────────────────────────── */
  async function loadSessions() {
    const out = byId('sessionsOutput');
    if (!out) return;
    out.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Loading…</div>';
    const res = await window.api('/api/auth/sessions', 'GET', null, true);
    const sessions = Array.isArray(res) ? res : [];
    if (!sessions.length) { out.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No active sessions.</div>'; return; }
    out.innerHTML = sessions.map(s => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-soft);">
        <span style="width:34px;height:34px;border-radius:10px;background:${s.current ? 'var(--navy-700)' : 'var(--bg-soft)'};color:${s.current ? '#fff' : 'var(--text-muted)'};display:flex;align-items:center;justify-content:center;font-size:13px;">${s.current ? '✓' : '▣'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:var(--text-hi);">${esc(s.label || 'Unknown device')} ${s.current ? '<span class="pill is-info" style="font-size:10px;">This device</span>' : ''} ${s.revoked ? '<span class="pill is-cancelled" style="font-size:10px;">Revoked</span>' : ''}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">${esc(s.ip || '—')} · last seen ${fmtDate(s.lastSeenAt)}</div>
        </div>
        ${s.revoked ? '' : s.current ? '' : `<button class="btn btn-ghost btn-sm" data-revoke="${esc(s.id)}" type="button">Revoke</button>`}
      </div>`).join('');

    out.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await window.api('/api/auth/sessions/' + btn.dataset.revoke, 'DELETE', null, true);
        showToast(r.message || 'Session revoked', r.error ? 'error' : 'success');
        loadSessions();
      });
    });
  }

  /* ── Recovery codes (A5) ───────────────────────────────────────── */
  async function loadCodeCount() {
    const res = await window.api('/api/auth/recovery-codes', 'GET', null, true);
    const el = byId('rcCount');
    if (el && !res.error) { el.style.display = 'inline'; el.textContent = `(${res.count} active)`.replace('(0 active)', '(none generated)'); }
  }

  async function generateCodes() {
    const out = byId('codesOutput');
    const hasActive = (await window.api('/api/auth/recovery-codes', 'GET', null, true)).count > 0;
    if (hasActive && !confirm('You already have active recovery codes. Generating a new batch invalidates the old ones. Continue?')) return;
    out.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Generating…</div>';
    const res = await window.api('/api/auth/recovery-codes', 'POST', { force: true }, true);
    if (res.error) { out.innerHTML = `<div style="color:var(--red-600);font-size:13px;">${esc(res.message || 'Failed to generate codes.')}</div>`; return; }
    out.innerHTML = `
      <div style="background:#0f172a;border-radius:10px;padding:14px 16px;margin-top:10px;">
        <div style="color:#67e8f9;font-family:var(--font-mono);font-size:13.5px;line-height:1.9;">
          ${(res.codes || []).map(c => `<div>${esc(c)}</div>`).join('')}
        </div>
      </div>
      <p style="font-size:12px;color:var(--amber-700, #B45309);margin-top:10px;">Store these somewhere safe. They are shown only once (a copy was emailed to you).</p>`;
    loadCodeCount();
  }

  /* ── GDPR (E6) ─────────────────────────────────────────────────── */
  async function exportData() {
    const res = await window.api('/api/auth/me/export', 'GET', null, true);
    if (res.error) { showToast(res.message || 'Export failed', 'error'); return; }
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'speedx-export-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    showToast('Your data export has been downloaded');
  }

  async function deleteAccount() {
    const email = profileUser ? profileUser.email : '';
    if (!confirm('Delete your account permanently? This cannot be undone.')) return;
    const code = prompt('Type DELETE to confirm account deletion' + (email ? ' for ' + email : '') + ':');
    if (code !== 'DELETE') { showToast('Deletion cancelled', 'error'); return; }
    const res = await window.api('/api/auth/me', 'DELETE', { confirm: 'DELETE' }, true);
    showToast(res.message || 'Account deleted', res.error ? 'error' : 'success');
    setTimeout(() => { window.location.href = '/login.html'; }, 900);
  }

  async function init() {
    await window.requireAuth();
    await Promise.all([loadProfile(), loadPasskeys(), loadSessions(), loadCodeCount()]);

    byId('profileEditForm')?.addEventListener('submit', saveProfile);
    byId('resendVerifyBtn')?.addEventListener('click', resendVerification);
    byId('revokeAllBtn')?.addEventListener('click', async () => {
      const r = await window.api('/api/auth/sessions/revoke-all', 'POST', {}, true);
      showToast(r.message || 'Other devices signed out', r.error ? 'error' : 'success');
      loadSessions();
    });
    byId('genCodesBtn')?.addEventListener('click', generateCodes);
    byId('exportDataBtn')?.addEventListener('click', exportData);
    byId('deleteAccountBtn')?.addEventListener('click', deleteAccount);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
