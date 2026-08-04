/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — My account / passkey details page logic.
   Relies on app.js (window.api, window.requireAuth, window.authUser).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  function fmtDate(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleString(); } catch { return '—'; }
  }

  function setText(id, text) {
    const el = byId(id);
    if (el) el.textContent = text;
  }

  function show(id) {
    const el = byId(id);
    if (el) el.style.display = '';
  }

  function hide(id) {
    const el = byId(id);
    if (el) el.style.display = 'none';
  }

  function getToastContainer() {
    let container = byId('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'ss-toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, type = 'success') {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = 'ss-toast ss-toast--' + type;
    toast.innerHTML = `
      <div class="ss-toast-icon">${type === 'success' ? '✓' : 'i'}</div>
      <div class="ss-toast-text">${escapeHtml(message)}</div>
    `;
    toast.style.transform = 'translateX(20px)';
    toast.style.opacity = '0';
    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.transform = 'none';
      toast.style.opacity = '1';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 220);
    }, 3000);
  }

  function fallbackBackUrl(role) {
    if (role === 'Admin') return '/dashboard.html';
    if (role === 'Customer') return '/customer.html';
    if (role === 'Driver') return '/driver.html';
    return '/dashboard.html';
  }

  async function loadProfile() {
    show('profileSkeleton');
    hide('profileOutput');

    const user = await window.api('/api/auth/me', 'GET', null, true);
    if (user.error) {
      showToast('Could not load profile: ' + (user.message || 'unknown error'), 'error');
      return;
    }

    setText('profileName', user.name || '—');
    setText('profileEmail', user.email || '—');
    setText('profileRole', user.role || '—');
    setText('profileCreated', fmtDate(user.createdAt));
    setText('userName', user.name || 'Account');
    setText('userRole', user.role || 'User');
    setText('footerRole', user.role ? user.role + ' view' : 'User view');
    setText('userAvatar', (user.name || 'AC').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase());

    // Wire back button to the role-appropriate dashboard
    const backUrl = fallbackBackUrl(user.role);
    byId('backToAppLink')?.setAttribute('href', backUrl);
    byId('backToAppBtn')?.setAttribute('href', backUrl);

    hide('profileSkeleton');
    show('profileOutput');
    return user;
  }

  async function loadPasskeys() {
    show('passkeysSkeleton');
    hide('passkeysOutput');

    const data = await window.api('/api/auth/me/credentials', 'GET', null, true);
    if (data.error) {
      showToast('Could not load passkeys: ' + (data.message || 'unknown error'), 'error');
      return;
    }

    const creds = Array.isArray(data.credentials) ? data.credentials : [];
    const output = byId('passkeysOutput');
    if (!output) return;

    if (creds.length === 0) {
      output.innerHTML = `
        <div class="empty-state is-illustrated">
          <div class="empty-state-illu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 26 v-4 c0-8 4-12 8-12 s8 4 8 12 v4"/><rect x="10" y="22" width="28" height="20" rx="2"/><circle cx="24" cy="32" r="3"/><path d="M24 35 v6"/></svg>
          </div>
          <div class="empty-state-title">No passkeys yet</div>
          <div class="empty-state-msg">You haven't registered a passkey for this account. Register one from the login or registration flow.</div>
        </div>`;
      hide('passkeysSkeleton');
      show('passkeysOutput');
      return;
    }

    output.innerHTML = creds.map((c, idx) => {
      const credId = c.credentialID || '';
      const publicKey = c.credentialPublicKey || '';
      const transports = Array.isArray(c.transports) ? c.transports : [];
      const transportPills = transports.length
        ? transports.map(t => `<span class="pill is-info" style="margin:2px 0;">${escapeHtml(t)}</span>`).join(' ')
        : '<span class="pill is-other" style="margin:2px 0;">Unknown</span>';

      return `
        <div style="border:1px solid var(--border-soft);border-radius:var(--r-md);padding:16px;margin-bottom:14px;background:var(--bg-soft);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
            <div>
              <div style="font-weight:600;color:var(--text-hi);">Passkey #${idx + 1}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Registered credential</div>
            </div>
            <span class="pill ${(c.counter || 0) > 0 ? 'is-info' : 'is-other'}">Counter: ${c.counter || 0}</span>
          </div>

          <div style="display:flex;flex-direction:column;gap:10px;">
            <div>
              <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Credential ID</div>
              <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
                <code class="font-mono" style="flex:1;word-break:break-all;background:white;border:1px solid var(--border-soft);border-radius:var(--r-sm);padding:8px 10px;font-size:12px;color:var(--text-hi);">${escapeHtml(credId)}</code>
                <button type="button" class="btn btn-sm btn-secondary" data-copy="${escapeHtml(credId)}">Copy</button>
              </div>
            </div>

            <div>
              <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Public Key (base64)</div>
              <div style="display:flex;gap:8px;align-items:flex-start;margin-top:4px;">
                <code class="font-mono" style="flex:1;word-break:break-all;background:white;border:1px solid var(--border-soft);border-radius:var(--r-sm);padding:8px 10px;font-size:12px;color:var(--text-hi);max-height:120px;overflow:auto;">${escapeHtml(publicKey)}</code>
                <button type="button" class="btn btn-sm btn-secondary" data-copy="${escapeHtml(publicKey)}">Copy</button>
              </div>
            </div>

            <div>
              <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:4px;">Transports</div>
              <div>${transportPills}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Wire copy buttons
    output.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(value).then(() => {
          showToast('Copied to clipboard');
        }).catch(() => {
          showToast('Copy failed', 'error');
        });
      });
    });

    hide('passkeysSkeleton');
    show('passkeysOutput');
  }

  async function init() {
    // Ensure auth state is loaded; requireAuth will redirect to login if needed.
    await window.requireAuth();
    await loadProfile();
    await loadPasskeys();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
