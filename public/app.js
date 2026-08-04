/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — shared client helpers.
   Loaded by every page. Exposes window.requireAuth, window.api, window.authUser,
   window.loginUser, window.logoutUser, SimpleWebAuthn wrappers and toast helper.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── LocalStorage token ──────────────────────────────────────────
  let authToken = localStorage.getItem('secureTmsToken') || '';

  function persistAuth(token) {
    authToken = token;
    if (token) localStorage.setItem('secureTmsToken', token);
    else localStorage.removeItem('secureTmsToken');
  }

  // ── Auth user (set after verifyAuth runs) ──────────────────────────
  let authUser = null;

  // ── Role → landing page map ─────────────────────────────────────
  // Admin is checked FIRST so admins cannot accidentally fall through to
  // /customer.html because of a stale JWT, a partially seeded DB, or any
  // caller passing the wrong field. The catch-all also lands admins safely.
  function dashboardForRole(role) {
    if (role === 'Admin')    return '/dashboard.html';
    if (role === 'Customer') return '/customer.html';
    if (role === 'Driver')   return '/driver.html';
    return '/dashboard.html';
  }

  // ── fetch helper ──────────────────────────────────────────────────
  async function api(path, method = 'GET', body = null, useAuth = false) {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (useAuth && authToken) headers.Authorization = `Bearer ${authToken}`;
    const options = { method, headers, credentials: 'include' };
    if (body !== null) options.body = JSON.stringify(body);
    try {
      const res = await fetch(path, options);
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const data = isJson ? await res.json() : await res.text();
      if (!res.ok) {
        const message = (isJson && data && (data.message || data.error)) ||
                        (typeof data === 'string' && data) ||
                        ('HTTP ' + res.status);
        throw new Error(message);
      }
      return data;
    } catch (err) {
      return { error: true, status: err.status || 0, message: err.message || 'Request failed' };
    }
  }

  // ── verifyAuth: refreshing token + role at every page load ────────
  // Two strategies are tried, in order:
  //   1. Bearer token from localStorage (app's preferred source).
  //   2. httpOnly cookie (handles the case where the user logged in earlier
  //      but localStorage was cleared, e.g. browser privacy mode restart).
  // We never throw here — every failure mode collapses to a clean false so
  // requireAuth redirects to /login.html.
  //
  // IMPORTANT: once *any* strategy returns a verified user, we DO NOT then
  // let a stale localStorage token mutate that freshly-validated user. The
  // JWT-payload fallback is restricted to cosmetic gaps (`name`, `email`)
  // that the verify endpoint didn't return, and it can NEVER overwrite an
  // already-known role. This avoids a real correctness regression where a
  // leftover Customer JWT (from a previous session) could demote a freshly-
  // logged-in Admin to "Customer".
  async function verifyAuth() {
    if (!authToken && !hasCookie('auth_token')) return false;

    const tryCall = async (authHeaderValue) => {
      const headers = { 'Accept': 'application/json' };
      if (authHeaderValue) headers.Authorization = authHeaderValue;
      try {
        const r = await fetch('/api/auth/verify', {
          method: 'GET',
          headers,
          credentials: 'include'
        });
        const isJson = (r.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? await r.json() : null;
        return { ok: r.ok && data && data.valid && data.user, user: data && data.user, error: data && data.message };
      } catch (e) {
        return { ok: false, user: null, error: e.message || 'Network error' };
      }
    };

    // First attempt: bearer from localStorage.
    let r = (authToken) ? await tryCall('Bearer ' + authToken) : { ok: false, user: null };

    // Second attempt: cookie only (no localStorage token).
    if (!r.ok) {
      const cookieOnly = await tryCall(null);
      if (cookieOnly.ok) r = cookieOnly;
    }

    if (r.ok && r.user) {
      // Start with the fresh server response; never let the cookie call
      // be overwritten by an unrelated localStorage token.
      const verified = Object.assign({ name: '', email: '', role: '' }, r.user);
      authUser = Object.assign({}, verified); // spreads every server-returned field; future fields stay intact

      // Cosmetic fallback for displayable fields that the verify response
      // omitted (rare; only when the schema is changed mid-flight). Role
      // is intentionally NOT touched here, so a stale localStorage JWT
      // from a previous session can NEVER demote a freshly-verified user.
      if ((!authUser.name || !authUser.email) && authToken) {
        const payload = decodeJwt(authToken);
        if (payload) {
          if (!authUser.name)  authUser.name  = payload.name  || '';
          if (!authUser.email) authUser.email = payload.email || '';
        }
      }
      return true;
    }

    // Token invalid → wipe the local copy so we don't loop on next page load.
    if (r.error && /token|unauthor|invalid/i.test(r.error || '')) {
      persistAuth('');
    }
    return false;
  }

  function decodeJwt(t) {
    try {
      const [, payload] = t.split('.');
      if (!payload) return null;
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_e) { return null; }
  }

  function hasCookie(name) {
    return document.cookie.split(';').some(c => c.trim().startsWith(name + '='));
  }

  /** Gate a page by role. Redirect on failure. Returns the user object. */
  async function requireAuth(role) {
    const ok = await verifyAuth();
    if (!ok || !authUser) {
      window.location.href = '/login.html';
      return null;
    }
    if (role && authUser.role && authUser.role !== role) {
      window.location.href = dashboardForRole(authUser.role);
      return null;
    }
    // Soft-touch: ping the backend so demo accounts are seed-deduped and a
    // /api/auth/me call always runs after verifyAuth. Wrapped in try/catch so
    // a transient network failure here never breaks the page load.
    try { await api('/api/auth/me', 'GET', null, true); } catch (_e) { /* ignore */ }
    return authUser;
  }

  // ── Logout ─────────────────────────────────────────────────────────
  async function logoutUser() {
    persistAuth('');
    try { await api('/api/auth/logout', 'POST', null, false); } catch (e) { /* ignore */ }
    window.location.href = '/login.html';
  }

  // ── WebAuthn origin support guard ──────────────────────────────────
  function checkWebAuthnOrigin() {
    const host = window.location.hostname;
    if (host === '127.0.0.1' || host === '0.0.0.0') {
      const m = document.getElementById('loginMsg') || document.getElementById('regMsg');
      if (m) { m.style.display = 'block'; m.textContent = 'WebAuthn requires a valid domain. Please open http://localhost:4000 instead of http://127.0.0.1:4000'; }
      return false;
    }
    return true;
  }

  async function ensureSimpleWebAuthnBrowser() {
    if (typeof SimpleWebAuthnBrowser !== 'undefined') return;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/libs/simplewebauthn-browser.umd.min.js';
      s.onload = () => (typeof SimpleWebAuthnBrowser === 'undefined' ? reject(new Error('SimpleWebAuthnBrowser failed to initialise')) : resolve());
      s.onerror = () => reject(new Error('Failed to load SimpleWebAuthnBrowser'));
      document.head.appendChild(s);
    });
  }

  /** Registers the new account's passkey and returns the server's verified payload. */
  async function registerPasskey() {
    if (!checkWebAuthnOrigin()) throw new Error('WebAuthn origin unsupported on this address');
    const email = (document.getElementById('regEmail')?.value || document.getElementById('admEmail')?.value || '').trim();
    if (!email) throw new Error('Enter an email first');
    const optsRes = await api('/api/auth/webauthn/register/options', 'POST', { email }, false);
    if (optsRes.error) throw new Error(optsRes.message || 'Failed to get registration options');
    await ensureSimpleWebAuthnBrowser();
    let att;
    try { att = await SimpleWebAuthnBrowser.startRegistration(optsRes); }
    catch (e) { throw new Error('Passkey registration failed: ' + e.message); }
    const verify = await api('/api/auth/webauthn/register', 'POST', { email, attestationResponse: att }, false);
    if (verify.error || !verify.verified) throw new Error(verify.message || 'Server verification failed');
    if (verify.token) persistAuth(verify.token);
    if (verify.user) authUser = verify.user;
    return verify;
  }

  async function loginPasskey() {
    if (!checkWebAuthnOrigin()) throw new Error('WebAuthn origin unsupported on this address');
    const email = document.getElementById('loginEmail')?.value.trim();
    if (!email) throw new Error('Enter your email first');
    const optsRes = await api('/api/auth/webauthn/login/options', 'POST', { email }, false);
    if (optsRes.error) throw new Error(optsRes.message || 'Failed to get login options');
    await ensureSimpleWebAuthnBrowser();
    let assertion;
    try { assertion = await SimpleWebAuthnBrowser.startAuthentication(optsRes); }
    catch (e) { throw new Error('Passkey authentication failed: ' + e.message); }
    const verify = await api('/api/auth/webauthn/login', 'POST', { email, assertionResponse: assertion }, false);
    if (verify.error || !verify.verified) throw new Error(verify.message || 'Login verification failed');
    persistAuth(verify.token);
    authUser = verify.user || null;
    return verify;
  }

  /**
   * Single source of truth for "after a successful login, where do I go?".
   * Falls back from server-supplied redirect → authUser.role → v.user.role.
   *
   * Hard guarantee built in: if the fresh server response says the user
   * is an Admin, they ALWAYS land on /dashboard.html — even if a stale
   * JWT or a partially populated user object tried to send them to
   * /customer.html. This is the single hardening that makes the
   * "Admin login must go to dashboard, never to customer page" requirement
   * unmissable.
   */
  function resolveRedirect(v) {
    // Strongest signal: the server response tells us directly.
    if (v && v.user && v.user.role === 'Admin') return '/dashboard.html';

    const fallback = (v && v.redirect) ||
      dashboardForRole((authUser && authUser.role) || (v && v.user && v.user.role));
    // Belt-and-braces: also honour a stale authUser.role of 'Admin'.
    if (authUser && authUser.role === 'Admin' && fallback === '/customer.html') {
      return '/dashboard.html';
    }
    return fallback;
  }

  function redirectToDashboard() { window.location.href = resolveRedirect(authUser); }

  // ── Legacy register/login wrappers used by register & login pages ─
  async function registerUser() {
    const msg = document.getElementById('regMsg');
    const role = document.getElementById('regRole')?.value || 'Customer';
    const data = {
      name: document.getElementById('regName')?.value.trim() || '',
      email: document.getElementById('regEmail')?.value.trim() || '',
      role,
      recoveryEmail: document.getElementById('regRecovery')?.value.trim() || ''
    };
    if (role === 'Admin') {
      data.inviteToken = document.getElementById('regInviteToken')?.value.trim() || '';
    }
    if (role === 'Admin' && !data.inviteToken) {
      if (msg) { msg.style.color = 'var(--red-600, #DC2626)'; msg.textContent = 'An invitation token is required for admin registration.'; }
      return;
    }
    if (!data.name || !data.email || !data.recoveryEmail) {
      if (msg) {
        msg.textContent = 'Please fill in all fields.';
        msg.style.color = 'var(--red-600, #DC2626)';
      }
      return;
    }
    if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = 'Creating your account…'; }
    const reg = await api('/api/auth/register', 'POST', data, false);
    if (reg.error) {
      if (msg) { msg.style.color = 'var(--red-600, #DC2626)'; msg.textContent = reg.message || 'Registration failed.'; }
      return;
    }
    if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = 'Account created. Enrolling your passkey…'; }
    try {
      const v = await registerPasskey();
      if (msg) { msg.style.color = 'var(--green-700, #047857)'; msg.textContent = 'Account created and passkey registered — redirecting…'; }
      setTimeout(() => { window.location.href = resolveRedirect(v); }, 600);
    } catch (e) {
      if (msg) { msg.style.color = 'var(--amber-700, #B45309)'; msg.textContent = 'Account created, but passkey registration failed: ' + (e.message || e) + '. Please try signing in.'; }
    }
  }

  async function loginUser() {
    const email = document.getElementById('loginEmail')?.value.trim() || '';
    const msg = document.getElementById('loginMsg');
    if (!email) { if (msg) msg.textContent = 'Please enter your email.'; return; }
    if (msg) msg.textContent = 'Authenticating with your passkey…';
    try {
      const v = await loginPasskey();
      window.location.href = resolveRedirect(v);
    } catch (e) {
      if (msg) { msg.textContent = e.message || 'Authentication failed.'; msg.style.color = 'var(--red-600, #DC2626)'; }
    }
  }

  async function recoverAccount() {
    const email = document.getElementById('loginEmail')?.value.trim() || '';
    const recoveryEmail = prompt('Enter recovery email');
    const msg = document.getElementById('loginMsg');
    if (!email || !recoveryEmail) { if (msg) msg.textContent = 'Recovery cancelled.'; return; }
    const res = await api('/api/auth/recover', 'POST', { email, recoveryEmail }, false);
    if (msg) msg.textContent = res.message || 'Recovery request processed.';
  }

  // ── Wire common UI elements ───────────────────────────────────────
  /* Run the given init function now if the DOM is already parsed, or on
     next DOMContentLoaded otherwise. Also re-run when the page is restored
     from bfcache (back/forward navigation, especially on Chrome/Safari) so
     our auth check, data refresh and event wiring are not skipped on the
     restored blob. Without this, a user can sit on a frozen skeleton page
     after using the Back button. */
  function onReady(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      try { fn(); } catch (_e) { /* keep going */ }
    }
    window.addEventListener('pageshow', (e) => {
      if (e && e.persisted) {
        try { fn(); } catch (_e) { /* keep going */ }
      }
    });
  }
  window.onReady = onReady;

  function wireGlobalButtons() {
    document.getElementById('logoutBtn')?.addEventListener('click', logoutUser);
    document.getElementById('registerBtn')?.addEventListener('click', registerUser);
    document.getElementById('loginBtn')?.addEventListener('click', loginUser);
    document.getElementById('recoverBtn')?.addEventListener('click', recoverAccount);
  }
  onReady(wireGlobalButtons);

  // ── Login page: reveal the auth shell (or auto-forward logged-in users) ─
  // Previously this only forwarded verified Admins; it now forwards ANY
  // signed-in user to their canonical dashboard so a Customer or Driver
  // revisiting /login.html doesn't briefly see the passkey form. The
  // shell ships with visibility:hidden in the markup so the form never
  // flashes before the redirect fires.
  //
  // History: this logic used to live as an inline <script> at the bottom
  // of login.html, but server.js's strict CSP forbids inline scripts
  // (scriptSrc has no 'unsafe-inline'), so the inline block was silently
  // blocked and the page rendered as a blank body. Moving it here (an
  // external 'self' script, allowed by CSP) restored the reveal. Login-
  // only: returns early if #authShell isn't on the page so this runs
  // safely on every page that loads app.js.
  async function loginSkip() {
    const shell = document.getElementById('authShell');
    if (!shell) return;
    try {
      const ok = await verifyAuth();
      if (ok && authUser && authUser.role && typeof redirectToDashboard === 'function') {
        // Admins, Drivers, and Customers each go to their own dashboard;
        // no role gets the chance to land on /customer.html by mistake.
        redirectToDashboard();
        return;
      }
    } catch (_e) { /* network blip → fall through to reveal */ }
    shell.style.visibility = 'visible';
  }
  onReady(loginSkip);

  // ── Spinner helpers ────────────────────────────────────────────────
  function showSpinner() { const el = document.getElementById('spinner'); if (el) el.style.display = 'block'; }
  function hideSpinner() { const el = document.getElementById('spinner'); if (el) el.style.display = 'none'; }
  function withSpinner(promise) { showSpinner(); return promise.finally(hideSpinner); }

  // ── Geocoding helpers (used by driver + customer pages) ───────────
  async function geocodeAddress(query) {
    if (!query || query.length < 3) return [];
    try {
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}&limit=3`);
      const data = await res.json();
      return (data || []).map(item => ({ display: item.display_name, lat: parseFloat(item.lat), lon: parseFloat(item.lon) }));
    } catch (e) { return []; }
  }

  // Small HTML escaper used by autocomplete template rendering.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Inject autocomplete CSS once, regardless of which stylesheet the page loads.
  var _autocompleteCssInjected = false;
  function injectAutocompleteCSS() {
    if (_autocompleteCssInjected) return;
    _autocompleteCssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.autocomplete-suggestions{position:absolute;top:100%;left:0;right:0;z-index:9999;',
      'max-height:132px;overflow-y:auto;overflow-x:hidden;background:#0f172a;',
      'border:1px solid rgba(148,163,184,0.3);border-radius:8px;margin-top:2px;',
      'box-shadow:0 8px 24px rgba(0,0,0,0.6);}',
      '.autocomplete-item{padding:7px 10px;color:#cbd5e1;font-size:0.8rem;line-height:1.35;',
      'cursor:pointer;border-bottom:1px solid rgba(148,163,184,0.08);',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s;}',
      '.autocomplete-item:last-child{border-bottom:none;}',
      '.autocomplete-item:hover,.autocomplete-item.is-highlighted{background:rgba(34,211,238,0.12);color:#22d3ee;outline:none;}'
    ].join('');
    document.head.appendChild(style);
  }

  /**
   * setupAddressAutocomplete(inputEl) — attaches real-address autocomplete
   * to a text input. Creates a suggestion dropdown dynamically below the
   * input, fetches results from Nominatim (via /api/geocode/search), and
   * supports keyboard navigation (ArrowDown/Up/Enter/Escape) plus click.
   *
   * Usage:
   *   setupAddressAutocomplete(document.getElementById('bookingOrigin'));
   */
  function setupAddressAutocomplete(input) {
    injectAutocompleteCSS();
    if (!input || input.dataset.autocompleteBound === '1') return;
    input.dataset.autocompleteBound = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-autocomplete', 'list');

    var debugId = input.id || ('el-' + Math.random().toString(36).slice(2, 6));
    console.log('[autocomplete] binding to', debugId);

    // Wrap input in a position:relative container so the absolutely-positioned
    // dropdown stays anchored to the input regardless of grid/flex parent layout.
    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '100%';
    input.parentNode.insertBefore(container, input);
    container.appendChild(input);

    // Create suggestion dropdown inside the container
    const wrapper = document.createElement('div');
    wrapper.className = 'autocomplete-suggestions';
    wrapper.style.display = 'none';
    wrapper.setAttribute('role', 'listbox');
    container.appendChild(wrapper);
    input.setAttribute('aria-expanded', 'false');

    let debounceTimer = null;
    let activeIndex = -1;
    let results = [];

    function hideSuggestions() {
      wrapper.style.display = 'none';
      wrapper.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
      results = [];
    }

    function highlightItem(index) {
      const items = wrapper.querySelectorAll('.autocomplete-item');
      items.forEach((el, i) => {
        el.classList.toggle('is-highlighted', i === index);
        el.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
      if (index >= 0 && items[index]) {
        items[index].scrollIntoView({ block: 'nearest' });
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (query.length < 3) { hideSuggestions(); return; }

      debounceTimer = setTimeout(async () => {
        console.log('[autocomplete] searching "'+query+'" via '+debugId);
        results = await geocodeAddress(query);
        console.log('[autocomplete] got '+results.length+' results for "'+query+'"');
        if (!results.length) {
          wrapper.innerHTML = '<div class="autocomplete-item" style="color:var(--text-muted);cursor:default;">No results found</div>';
          wrapper.style.display = 'block';
          input.setAttribute('aria-expanded', 'true');
          activeIndex = -1;
          return;
        }
        wrapper.innerHTML = results.map(function (r, i) {
          var short = (r.display || '').length > 70 ? (r.display || '').slice(0, 67) + '…' : r.display;
          return '<div class="autocomplete-item" role="option" data-index="'+i+'" data-lat="'+r.lat+'" data-lon="'+r.lon+'">'+escapeHtml(short)+'</div>';
        }).join('');
        wrapper.style.display = 'block';
        input.setAttribute('aria-expanded', 'true');
        activeIndex = -1;
      }, 300);
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      if (wrapper.style.display === 'none') return;
      const items = wrapper.querySelectorAll('.autocomplete-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        highlightItem(activeIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        highlightItem(activeIndex);
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && items[activeIndex]) {
          e.preventDefault();
          items[activeIndex].click();
        }
      } else if (e.key === 'Escape') {
        hideSuggestions();
      }
    });

    // Click to select
    wrapper.addEventListener('click', (e) => {
      const item = e.target && e.target.closest && e.target.closest('.autocomplete-item');
      if (!item || item.dataset.index === undefined) return;
      const r = results[parseInt(item.dataset.index)];
      if (r) {
        input.value = r.display;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      hideSuggestions();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !wrapper.contains(e.target)) {
        hideSuggestions();
      }
    });

    // Close on blur (delayed so click can register)
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) hideSuggestions();
      }, 150);
    });
  }

  // ── Toast / snackbar ───────────────────────────────────────────────
  // Use notify('message', { kind: 'success' | 'error' | 'info', timeoutMs: 3500 })
  function ensureToastContainer() {
    let c = document.getElementById('ssToastContainer');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'ssToastContainer';
    c.className = 'ss-toast-container';
    document.body.appendChild(c);
    return c;
  }
  function notify(message, opts = {}) {
    const kind = opts.kind || 'info';
    const time = opts.timeoutMs ?? 3500;
    const c = ensureToastContainer();
    const el = document.createElement('div');
    el.className = 'ss-toast ss-toast--' + kind;
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <span class="ss-toast-icon">${{success:'✓',error:'!',info:'i',warn:'!'}[kind] || 'i'}</span>
      <span class="ss-toast-text"></span>
      <button class="ss-toast-close" type="button" aria-label="Dismiss">×</button>`;
    el.querySelector('.ss-toast-text').textContent = message;
    el.querySelector('.ss-toast-close')?.addEventListener('click', () => el.remove());
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    if (time > 0) setTimeout(() => { el.classList.remove('is-visible'); setTimeout(() => el.remove(), 220); }, time);
    return el;
  }

  // ── Expose ────────────────────────────────────────────────────────
  Object.defineProperty(window, 'authUser', { get() { return authUser; }, set(v) { authUser = (v && typeof v === 'object') ? v : null; } });
  Object.defineProperty(window, 'authToken', { get() { return authToken; }, set(v) { persistAuth(v); } });
  window.verifyAuth = verifyAuth;
  window.requireAuth = requireAuth;
  window.api = api;
  window.redirectToDashboard = redirectToDashboard;
  window.logoutUser = logoutUser;
  window.loginUser = loginUser;
  window.registerUser = registerUser;
  window.recoverAccount = recoverAccount;
  window.registerPasskey = registerPasskey;
  window.loginPasskey = loginPasskey;
  window.dashboardForRole = dashboardForRole;
  window.geocodeAddress = geocodeAddress;
  window.setupAddressAutocomplete = setupAddressAutocomplete;
  window.showSpinner = showSpinner;
  window.hideSpinner = hideSpinner;
  window.withSpinner = withSpinner;
  window.notify = notify;
})();
