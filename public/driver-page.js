/*════════════════════════════════════════════════════════════════════════════
SpeedX — World-Class Driver View
Features: POD signature capture, photo upload, inspection checklist,
messaging with dispatch, multi-stop route management, dark mode.
═══════════════════════════════════════════════════════════════════════════*/
'use strict';

(function () {
  const S = window.SecureTMS || {};
  const esc       = S.escapeHtml || ((x) => String(x == null ? '' : x));
  const FmtDate   = S.fmtDate      || ((s) => s ? new Date(s).toLocaleDateString() : '—');
  const FmtDateT  = S.fmtDateTime  || ((s) => s ? new Date(s).toLocaleString()   : '—');
  const cell      = S.cell         || function () { return ''; };
  const empty     = S.emptyState   || function () { return ''; };
  const cssEsc    = S.cssEscape    || ((s) => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\\\' + c));
  const initials  = S.initials     || ((s) => (s || 'DR').split(/\\s+/).map(p => p && p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase());

  let currentPODShipmentId = null;
  let sigCanvas = null;
  let sigCtx = null;
  let isDrawing = false;

  function pillForStatus(s) { return ({'Created':'is-pending','Picked Up':'is-pending','In Transit':'is-in-transit','Delivered':'is-delivered','Cancelled':'is-cancelled'})[s] || 'is-other'; }

  /* ── Theme Toggle ──────────────────────────────────────────────── */
  function initTheme() {
    if (localStorage.getItem('secureTmsTheme') === 'dark') document.body.classList.add('dark');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('secureTmsTheme', document.body.classList.contains('dark') ? 'dark' : 'light'); });
  }

  /* ── Universal Modal Close Handler ─────────────────────────────── */
  var _modalBound = false;
  function initModalClosers() {
    if (_modalBound) return;
    _modalBound = true;
    document.addEventListener('click', function(e) {
      var closer = e.target && e.target.closest && e.target.closest('[data-close-modal]');
      if (closer) {
        var id = closer.getAttribute('data-close-modal');
        var modal = document.getElementById(id);
        if (modal) modal.style.display = 'none';
        return;
      }
      if (e.target.classList && e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
        return;
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var all = document.querySelectorAll('.modal-overlay');
        all.forEach(function(m) { if (m.style.display !== 'none') m.style.display = 'none'; });
      }
    });
  }

  /* ── Pre-Trip Inspection Checklist ─────────────────────────────── */
  function renderChecklist(shipmentId) {
    const items = ['Brakes functioning','Lights working','Tires properly inflated','Mirrors adjusted','Seatbelt functional','Horn working','Windshield clean','No warning lights','Fuel level adequate','Emergency kit present','Cargo properly secured','Paperwork in vehicle'];
    return `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-soft);">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🔍 Pre-Trip Inspection</div>
      ${items.map((item, i) => `<div class="checklist-item" id="check-${cssEsc(shipmentId)}-${i}"><input type="checkbox" onchange="this.parentElement.classList.toggle('checked', this.checked)" /><span>${esc(item)}</span></div>`).join('')}
    </div>`;
  }

  /* ── POD: Signature + Photo ───────────────────────────────────── */
  function openPOD(shipmentId) {
    currentPODShipmentId = shipmentId;
    document.getElementById('podModal').style.display = '';
    // Wait for modal to render before initialising canvas
    requestAnimationFrame(() => {
      requestAnimationFrame(() => initSignaturePad());
    });
  }

  function initSignaturePad() {
    sigCanvas = document.getElementById('sigCanvas');
    if (!sigCanvas || sigCanvas.offsetWidth === 0) return;
    sigCtx = sigCanvas.getContext('2d');
    sigCanvas.width = sigCanvas.offsetWidth;
    sigCanvas.height = sigCanvas.offsetHeight || 150;
    sigCtx.strokeStyle = '#0F4C81';
    sigCtx.lineWidth = 2;
    sigCtx.lineCap = 'round';
    sigCanvas.addEventListener('mousedown', (e) => { isDrawing = true; sigCtx.beginPath(); sigCtx.moveTo(e.offsetX, e.offsetY); });
    sigCanvas.addEventListener('mousemove', (e) => { if (!isDrawing) return; sigCtx.lineTo(e.offsetX, e.offsetY); sigCtx.stroke(); });
    sigCanvas.addEventListener('mouseup', () => { isDrawing = false; });
    sigCanvas.addEventListener('mouseleave', () => { isDrawing = false; });
    sigCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); isDrawing = true; const t = e.touches[0]; const r = sigCanvas.getBoundingClientRect(); sigCtx.beginPath(); sigCtx.moveTo(t.clientX - r.left, t.clientY - r.top); });
    sigCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!isDrawing) return; const t = e.touches[0]; const r = sigCanvas.getBoundingClientRect(); sigCtx.lineTo(t.clientX - r.left, t.clientY - r.top); sigCtx.stroke(); });
    sigCanvas.addEventListener('touchend', () => { isDrawing = false; });
  }

  async function submitPOD() {
    if (!currentPODShipmentId) return;
    const signatureData = sigCanvas ? sigCanvas.toDataURL() : '';
    const photoInput = document.getElementById('podPhoto');
    let photoData = '';
    if (photoInput && photoInput.files && photoInput.files[0]) {
      const reader = new FileReader();
      photoData = await new Promise(resolve => { reader.onload = e => resolve(e.target.result); reader.readAsDataURL(photoInput.files[0]); });
    }
    const notes = document.getElementById('podNotes')?.value || '';
    const res = await window.api('/api/shipments/' + currentPODShipmentId + '/status', 'PATCH', {
      status: 'Delivered', podSignature: signatureData, podPhoto: photoData, podNotes: notes, podTimestamp: new Date()
    }, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('podModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Delivery confirmed! POD captured.', { kind: 'success' });
    loadRoutes(true);
  }

  /* ── Load Routes ───────────────────────────────────────────────── */
  async function loadRoutes(manual) {
    const skel = document.getElementById('routesSkeleton');
    const out  = document.getElementById('routesOutput');
    const banner = document.getElementById('demoBanner');
    if (!skel || !out) return;
    if (manual) { skel.style.display = 'flex'; out.style.display = 'none'; }

    const res = await window.api('/api/shipments', 'GET', null, true).catch(() => ({data:[]}));
    const arr = Array.isArray(res) ? res : (res.data) || [];

    const kActive = document.getElementById('kpiAssigned'), kPickedUp = document.getElementById('kpiPickedUp'), kDelivered = document.getElementById('kpiDelivered');
    if (kActive) kActive.textContent = arr.filter(s => s && s.status !== 'Delivered' && s.status !== 'Cancelled').length;
    if (kPickedUp) kPickedUp.textContent = arr.filter(s => s && ['Picked Up', 'In Transit'].includes(s.status)).length;
    if (kDelivered) kDelivered.textContent = arr.filter(s => s && s.status === 'Delivered').length;
    if (banner) banner.style.display = arr.length ? 'none' : 'flex';

    skel.style.display = 'none'; out.style.display = '';

    if (!arr.length) {
      out.innerHTML = empty({ title: 'No active routes', message: 'Dispatch hasn\'t assigned any shipments to your account yet.', hint: 'Try <code>driver@securetms.com</code> for demo data.' });
      return;
    }

    out.innerHTML = arr.map(renderRouteCard).join('');
    arr.forEach(wireRouteCard);
  }

  function renderRouteCard(s) {
    const status = s.status || 'Created';
    const tracking = s.trackingId || String(s._id || '').slice(-8).toUpperCase();
    const idSafe = cssEsc(String(s._id));
    const isDelivered = status === 'Delivered';
    return `
      <article class="card" style="margin-bottom:14px;" id="route-${esc(String(s._id))}">
        <div class="card-header">
          <div><div class="card-title">${esc(s.pickupAddress || 'Pickup')} → ${esc(s.deliveryAddress || 'Drop-off')}</div>
            <div class="card-sub">Tracking <span class="font-mono">${esc(tracking)}</span> · Vehicle <strong>${esc(s.vehicleNumber || 'TBD')}</strong></div></div>
          <span class="pill ${pillForStatus(status)}">${esc(status)}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:10px;">
          ${cell('Customer', s.customerName)} ${cell('ETA', s.eta)} ${cell('Last update', s.updatedAt ? FmtDateT(s.updatedAt) : null)}
        </div>
        ${!isDelivered ? `
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border-soft);">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <label style="margin:0;font-size:12px;">Update status:</label>
            <select data-id="${esc(String(s._id))}" class="statusSelect" style="width:auto;height:36px;">
              ${['Created','Picked Up','In Transit','Delivered','Cancelled'].map(opt => `<option value="${opt}" ${opt===status?'selected':''}>${opt}</option>`).join('')}
            </select>
            <input type="text" data-id="${esc(String(s._id))}" class="locInput" placeholder="Current location" value="${esc(s.currentLocation||'')}" style="flex:1;height:36px;font-size:13px;" />
            <input type="text" data-id="${esc(String(s._id))}" class="etaInput" placeholder="ETA" value="${esc(s.eta||'')}" style="width:120px;height:36px;font-size:13px;" />
            <button class="btn btn-sm" data-save-btn="${esc(String(s._id))}" type="button">Save</button>
            ${status === 'In Transit' ? `<button class="btn btn-accent btn-sm" data-pod-btn="${esc(String(s._id))}" type="button">✓ Deliver & Sign POD</button>` : ''}
            <span class="saveMsg" data-save-msg="${esc(String(s._id))}" style="font-size:12px;"></span>
          </div>
        </div>` : ''}
        ${isDelivered && s.podSignature ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-soft);"><span class="pill is-delivered">✓ POD Signed</span> ${s.podPhoto ? '<img src="'+esc(s.podPhoto)+'" class="photo-preview" />' : ''} ${s.podNotes ? '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">'+esc(s.podNotes)+'</div>' : ''}</div>` : ''}
        ${!isDelivered ? renderChecklist(String(s._id)) : ''}
      </article>`;
  }

  function wireRouteCard(s) {
    const id = String(s._id);
    const saveBtn = document.querySelector('[data-save-btn="' + cssEsc(id) + '"]');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const statusSel = document.querySelector('.statusSelect[data-id="' + cssEsc(id) + '"]');
      const locInput  = document.querySelector('.locInput[data-id="' + cssEsc(id) + '"]');
      const etaInput  = document.querySelector('.etaInput[data-id="' + cssEsc(id) + '"]');
      const msg       = document.querySelector('[data-save-msg="' + cssEsc(id) + '"]');
      saveBtn.disabled = true;
      if (msg) { msg.textContent = 'Saving…'; msg.style.color = 'var(--text-muted)'; }
      const res = await window.api('/api/shipments/' + encodeURIComponent(id) + '/status', 'PATCH', { status: statusSel?.value, currentLocation: locInput?.value.trim(), eta: etaInput?.value.trim() }, true);
      saveBtn.disabled = false;
      if (res && res.error) { if (msg) { msg.style.color = 'var(--red-600)'; msg.textContent = res.message || 'Could not save.'; } if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
      if (msg) { msg.style.color = 'var(--green-700)'; msg.textContent = 'Saved.'; }
      if (typeof window.notify === 'function') window.notify('Shipment updated', { kind: 'success' });
      setTimeout(() => loadRoutes(true), 400);
    });

    const podBtn = document.querySelector('[data-pod-btn="' + cssEsc(id) + '"]');
    if (podBtn) podBtn.addEventListener('click', () => openPOD(id));
  }

  /* ── Messages ──────────────────────────────────────────────────── */
  async function loadMessages() {
    const res = await window.api('/api/messages', 'GET', null, true).catch(() => ({data:[]}));
    const msgs = res.data || [];
    const el = document.getElementById('driverMessagesOutput');
    if (!el) return;
    if (!msgs.length) { el.innerHTML = '<div class="empty-state">No messages yet.</div>'; return; }
    el.innerHTML = msgs.map(m => `
      <div class="card" style="margin-bottom:8px;${m.read?'':'border-left:3px solid var(--navy-700);'}">
        <div style="display:flex;justify-content:space-between;"><div><strong>${esc(m.subject||'')}</strong> · ${esc(m.fromEmail)}</div><span style="font-size:11px;color:var(--text-dim);">${FmtDate(m.createdAt)}</span></div>
        <div style="margin-top:6px;font-size:13px;">${esc(m.body)}</div>
      </div>`).join('');
  }
  async function sendMessage() {
    const to = document.getElementById('driverMsgTo')?.value || '';
    const subject = document.getElementById('driverMsgSubject')?.value || '';
    const body = document.getElementById('driverMsgBody')?.value || '';
    if (!to || !body) return;
    const res = await window.api('/api/messages', 'POST', { toEmail: to, subject, body }, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('driverMsgCompose').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Message sent', { kind: 'success' });
    loadMessages();
  }

  /* ── Tab + Button Wiring ───────────────────────────────────────── */
  function showTab(name) { const link = document.querySelector('.nav-link[data-tab="' + name + '"]'); if (link) link.click(); }
  function wireNavLinks() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.dataset.navBound === '1') return;
    sidebar.dataset.navBound = '1';
    sidebar.addEventListener('click', (e) => {
      const link = e.target && e.target.closest && e.target.closest('a.nav-link[data-tab]');
      if (!link) return;
      e.preventDefault();
      document.querySelectorAll('.nav-link').forEach(x => x.classList.remove('is-active'));
      link.classList.add('is-active');
      const t = link.dataset.tab;
      ['routesTab','mapTab','messagesTab'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = (id === t) ? '' : 'none'; });
      if (t === 'mapTab') setTimeout(() => initDriverMap(), 80);
      if (t === 'messagesTab') loadMessages();
    });
  }

  function wireQuickButtons() {
    const main = document.querySelector('.main');
    const modal = document.getElementById('shipmentModal');
    const modalForm = document.getElementById('modalShipmentForm');
    const modalMsg = document.getElementById('modalShipmentMsg');

    if (!main || main.dataset.quickBound === '1') return;
    main.dataset.quickBound = '1';
    main.addEventListener('click', (e) => {
      const t = e.target; if (!t || !t.closest) return;
      if (t.closest('#refreshBtn')) loadRoutes(true);
      else if (t.closest('#newShipmentBtn')) { if (modal) modal.style.display = ''; }
      else if (t.closest('#closeShipmentModal') || t.closest('#cancelShipmentModalBtn')) { if (modal) modal.style.display = 'none'; }
      else if (t.closest('#closePodModal')) { document.getElementById('podModal').style.display = 'none'; }
      else if (t.closest('#clearSigBtn')) { if (sigCtx && sigCanvas) sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); }
      else if (t.closest('#submitPOD')) submitPOD();
      else if (t.closest('#newDriverMsgBtn')) { document.getElementById('driverMsgCompose').style.display = ''; }
      else if (t.closest('#cancelDriverMsgBtn')) { document.getElementById('driverMsgCompose').style.display = 'none'; }
      else if (t.closest('#sendDriverMsgBtn')) sendMessage();
    });

    // Photo preview
    const photoInput = document.getElementById('podPhoto');
    if (photoInput && !photoInput.dataset.bound) {
      photoInput.dataset.bound = '1';
      photoInput.addEventListener('change', () => {
        const preview = document.getElementById('podPhotoPreview');
        if (preview && photoInput.files && photoInput.files[0]) {
          const reader = new FileReader();
          reader.onload = e => { preview.src = e.target.result; preview.style.display = ''; };
          reader.readAsDataURL(photoInput.files[0]);
        }
      });
    }

    if (modalForm && modalForm.dataset.submitBound !== '1') {
      modalForm.dataset.submitBound = '1';
      modalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          customerName: (document.getElementById('modalShipmentCustomer')?.value || '').trim(),
          customerEmail: (document.getElementById('modalShipmentCustomerEmail')?.value || '').trim(),
          pickupAddress: (document.getElementById('modalShipmentPickup')?.value || '').trim(),
          deliveryAddress: (document.getElementById('modalShipmentDelivery')?.value || '').trim(),
          vehicleNumber: (document.getElementById('modalShipmentVehicle')?.value || '').trim(),
          driverEmail: (document.getElementById('modalShipmentDriverEmail')?.value || '').trim(),
          status: document.getElementById('modalShipmentStatus')?.value || 'Created',
        };
        if (!payload.pickupAddress || !payload.deliveryAddress) { if (modalMsg) { modalMsg.style.color = 'var(--red-600)'; modalMsg.textContent = 'Pickup and delivery addresses required.'; } return; }
        if (!payload.customerEmail) { if (modalMsg) { modalMsg.style.color = 'var(--red-600)'; modalMsg.textContent = 'Customer email is required so a confirmation can be sent.'; } return; }
        modalMsg.style.color = 'var(--text-muted)'; modalMsg.textContent = 'Creating…';
        const res = await window.api('/api/shipments', 'POST', payload, true);
        if (res && res.error) { modalMsg.style.color = 'var(--red-600)'; modalMsg.textContent = res.message || 'Could not create.'; if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
        modalMsg.style.color = 'var(--green-700)'; modalMsg.textContent = 'Shipment created!';
        if (typeof window.notify === 'function') window.notify('Shipment created', { kind: 'success' });
        if (modalForm) modalForm.reset();
        if (modal) modal.style.display = 'none';
        setTimeout(() => loadRoutes(true), 400);
      });
    }
  }

  function fillIdentity(user) {
    const dn = (user && (user.name || user.email)) || 'Driver';
    const nameEl = document.getElementById('userName'), avatarEl = document.getElementById('userAvatar');
    const roleBadge = document.querySelector('.user-chip-role'), greeting = document.getElementById('pageGreeting');
    if (nameEl) nameEl.textContent = dn;
    if (avatarEl) avatarEl.textContent = initials(dn, 'DR');
    if (roleBadge && user && user.role) roleBadge.textContent = user.role;
    if (greeting) {
      const hr = new Date().getHours();
      const slot = hr < 12 ? 'Drive safely, ' : hr < 18 ? 'Good afternoon, ' : 'Good evening, ';
      const first = user && user.name ? user.name.split(/\s+/)[0] : '';
      greeting.textContent = first ? (slot + first) : (slot + 'driver');
    }
  }

  /* ── Map (Uber / DoorDash style live tracking) ─────────────────── */
  let driverTrack = null, driverSocket = null;
  let driverRoutesDrawn = false;
  async function locate(text) {
    if (!text || text.length < 3) return null;
    try { const r = await fetch('/api/geocode/search?q='+encodeURIComponent(text)+'&limit=1'); const j = await r.json(); if (j && j.length) return [parseFloat(j[0].lat), parseFloat(j[0].lon)]; } catch (_e) {}
    return null;
  }
  async function initDriverMap() {
    const container = document.getElementById('driverMap');
    if (!container) return;
    if (typeof window.L === 'undefined') { container.innerHTML = empty({ title: 'Map failed to load' }); return; }
    if (!driverTrack) driverTrack = window.LiveTrack.create('driverMap');
    else driverTrack.map.invalidateSize();

    const res = await window.api('/api/shipments','GET',null,true).catch(() => ({data:[]}));
    const arr = Array.isArray(res) ? res : (res.data) || [];

    if (!driverRoutesDrawn) {
      driverRoutesDrawn = true;
      for (const s of arr) {
        const a = await locate(s.pickupAddress); const b = await locate(s.deliveryAddress);
        if (!a || !b) continue;
        driverTrack.addRoute({
          id: String(s._id),
          trackingId: s.trackingId,
          from: a,
          to: b,
          originLabel: s.pickupAddress,
          destLabel: s.deliveryAddress,
          vehicleNumber: s.vehicleNumber,
          status: s.status || 'Created'
        });
      }
      if (!arr.length) driverTrack.map.setView([-28.0, 140.0], 4);
    }

    // Live socket: animate the vehicle for every assigned shipment
    if (typeof window.io === 'function' && !driverSocket) {
      try {
        driverSocket = window.io({ withCredentials: true, transports: ['websocket', 'polling'] });
        driverTrack.bindSocket(driverSocket);
      } catch (_e) {}
    }
  }

  /* ── Expose for HTML onclick ──────────────────────────────────── */
  window.driverPage = window.driverPage || {};
  window.driverPage.openPOD = openPOD;

  /* ── Address Autocomplete ──────────────────────────────────────── */
  function wireAddressAutocomplete() {
    var autocomplete = window.setupAddressAutocomplete;
    if (typeof autocomplete !== 'function') return;
    var ids = ['modalShipmentPickup', 'modalShipmentDelivery'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) autocomplete(el);
    });
  }

  /* ── Bootstrap ─────────────────────────────────────────────────── */
  window.addEventListener('pagehide', () => { if (window.__driverTicker) { clearInterval(window.__driverTicker); window.__driverTicker = null; } });
  async function bootDriverPage() {
    if (window.__driverTicker) { clearInterval(window.__driverTicker); window.__driverTicker = null; }
    const user = await window.requireAuth('Driver');
    if (!user) return;
    window.authUser = user;
    initTheme();
    initModalClosers();
    fillIdentity(user);
    wireNavLinks();
    wireQuickButtons();
    wireAddressAutocomplete();
    await loadRoutes(false);
    window.__driverTicker = setInterval(() => loadRoutes(false), 30000);
  }
  window.onReady(bootDriverPage);
  window.driverPage = { loadRoutes, initDriverMap };
})();
