/*════════════════════════════════════════════════════════════════════════════
SecureTMS — World-Class Customer View
Features: status stepper, ETA countdown, share tracking link, star rating,
in-app messaging, dark mode, live map, 30s auto-refresh.
═══════════════════════════════════════════════════════════════════════════*/
'use strict';

(function () {
  const S = window.SecureTMS || {};
  const esc   = S.escapeHtml   || ((x) => String(x == null ? '' : x));
  const Fmt   = S.fmtDate      || ((s) => s ? new Date(s).toLocaleDateString() : '—');
  const cell  = S.cell         || function () { return ''; };
  const empty = S.emptyState   || function () { return ''; };
  const initials = S.initials  || ((s) => (s || 'CU').split(/\s+/).map(p => p && p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase());

  let currentRatingShipmentId = null;

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

  /* ── Status Stepper ────────────────────────────────────────────── */
  function renderStatusStepper(shipment) {
    if (!shipment) return '';
    const steps = ['Created', 'Picked Up', 'In Transit', 'Delivered'];
    const currentIdx = steps.indexOf(shipment.status);
    return `
      <div class="status-stepper">
        ${steps.map((s, i) => {
          let cls = '';
          if (i < currentIdx) cls = 'completed';
          else if (i === currentIdx) cls = 'active';
          return `<div class="step ${cls}">
            <div class="step-circle">${i < currentIdx ? '✓' : i + 1}</div>
            <div class="step-label">${s}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  /* ── ETA Countdown ──────────────────────────────────────────────── */
  function renderETACountdown(shipment) {
    if (!shipment || !shipment.eta || shipment.eta === 'Pending' || shipment.eta === 'Delivered') return '';
    const etaText = shipment.eta;
    const isNumeric = /^\d/.test(etaText);
    return `
      <div class="eta-countdown">
        <div class="eta-icon">⏱</div>
        <div>
          <div class="eta-timer">${isNumeric ? (etaText.includes('h') ? etaText : '~' + etaText) : etaText}</div>
          <div class="eta-label">Estimated time to delivery · ${shipment.currentLocation || 'In transit'}</div>
        </div>
      </div>`;
  }

  /* ── Rating Stars ──────────────────────────────────────────────── */
  function renderRating(shipment) {
    if (!shipment || shipment.status !== 'Delivered') return '';
    if (shipment.rating) {
      const stars = '★'.repeat(shipment.rating) + '☆'.repeat(5 - shipment.rating);
      return `<div style="margin-top:8px;color:var(--amber-500);font-size:16px;">${stars} ${shipment.ratingComment ? '— ' + esc(shipment.ratingComment) : ''}</div>`;
    }
    return `<button class="btn btn-sm" onclick="window.customerPage.openRating('${esc(shipment._id)}')" style="margin-top:8px;">⭐ Rate this delivery</button>`;
  }

  function openRating(shipmentId) {
    currentRatingShipmentId = shipmentId;
    const starsEl = document.getElementById('ratingStars');
    if (starsEl) {
      starsEl.innerHTML = [1,2,3,4,5].map(i => `<span class="star" data-v="${i}">☆</span>`).join('');
      starsEl.querySelectorAll('.star').forEach(s => {
        s.addEventListener('click', () => { starsEl.querySelectorAll('.star').forEach((el, idx) => el.textContent = idx < parseInt(s.dataset.v) ? '★' : '☆'); });
        s.addEventListener('mouseenter', () => { starsEl.querySelectorAll('.star').forEach((el, idx) => el.textContent = idx < parseInt(s.dataset.v) ? '★' : '☆'); });
      });
    }
    document.getElementById('ratingModal').style.display = '';
  }
  window.customerPage = window.customerPage || {};
  window.customerPage.openRating = openRating;

  async function submitRating() {
    const starsEl = document.getElementById('ratingStars');
    const commentEl = document.getElementById('ratingComment');
    const rating = starsEl ? [...starsEl.querySelectorAll('.star')].filter(s => s.textContent === '★').length : 0;
    if (!rating || !currentRatingShipmentId) return;
    const res = await window.api('/api/shipments/' + currentRatingShipmentId + '/status', 'PATCH', { rating, ratingComment: commentEl?.value || '' }, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify('Rating failed', { kind: 'error' }); return; }
    document.getElementById('ratingModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Rating submitted!', { kind: 'success' });
    loadDeliveries(true);
  }

  /* ── Share Tracking ─────────────────────────────────────────────── */
  function shareTracking(trackingId) {
    const url = window.location.origin + '/customer.html?track=' + encodeURIComponent(trackingId);
    navigator.clipboard.writeText(url).then(() => {
      const toast = document.getElementById('copyToast');
      if (toast) { toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2000); }
    }).catch(() => { window.prompt('Copy this tracking link:', url); });
  }

  /* ── Load Deliveries ───────────────────────────────────────────── */
  function setKPIs(active, transit, delivered) {
    const k = id => document.getElementById(id);
    if (k('kpiActive')) k('kpiActive').textContent = active;
    if (k('kpiTransit')) k('kpiTransit').textContent = transit;
    if (k('kpiDelivered')) k('kpiDelivered').textContent = delivered;
  }

  async function loadDeliveries(manual) {
    const skel = document.getElementById('deliveriesSkeleton');
    const out  = document.getElementById('deliveriesOutput');
    const banner = document.getElementById('demoBanner');
    if (!skel || !out) return;
    if (manual) { skel.style.display = 'flex'; out.style.display = 'none'; }

    const [bookings, shipments] = await Promise.all([
      window.api('/api/bookings', 'GET', null, true).catch(() => ({data:[]})),
      window.api('/api/shipments', 'GET', null, true).catch(() => ({data:[]})),
    ]);
    const bArr = Array.isArray(bookings) ? bookings : (bookings.data) || [];
    const sArr = Array.isArray(shipments) ? shipments : (shipments.data) || [];

    const byBooking = new Map();
    sArr.forEach(s => { if (s && s.bookingId) byBooking.set(String(s.bookingId), s); });

    setKPIs(bArr.length,
      sArr.filter(s => ['Picked Up', 'In Transit', 'Created'].includes(s && s.status)).length,
      sArr.filter(s => s && s.status === 'Delivered').length);

    if (banner) banner.style.display = bArr.length > 0 ? 'none' : 'flex';
    skel.style.display = 'none'; out.style.display = '';

    if (!bArr.length) {
      out.innerHTML = empty({ title: 'No deliveries yet', message: 'Book a pickup and the operations team will assign a driver in seconds.',
        hint: 'Tip: use <code>customer@securetms.com</code> to see seeded sample deliveries.', cta: 'Book your first pickup' });
      const cta = out.querySelector('[data-empty-cta]');
      if (cta) cta.addEventListener('click', () => showTab('bookTab'));
      return;
    }

    const pillMap = { 'Created':'is-pending','Picked Up':'is-pending','In Transit':'is-in-transit','Delivered':'is-delivered','Cancelled':'is-cancelled','Pending':'is-pending','Confirmed':'is-in-transit','Completed':'is-delivered' };

    out.innerHTML = bArr.map(b => {
      const shipment = byBooking.get(String(b._id));
      const status = (shipment && shipment.status) || 'Awaiting assignment';
      const cls = pillMap[status] || 'is-pending';
      const trackingSafe = (shipment && shipment.trackingId) ? shipment.trackingId : String(b._id || '').slice(-8).toUpperCase();
      return `
        <article class="card" style="margin-bottom:14px;">
          <div class="card-header">
            <div><div class="card-title">From ${esc(b.origin)} → ${esc(b.destination)}</div>
              <div class="card-sub">Booking <span class="font-mono">${String(b._id || '').slice(-8).toUpperCase()}</span> · ${Fmt(b.createdAt)} · Priority: <strong>${esc(b.priority||'Standard')}</strong></div>
            </div>
            <span class="pill ${cls}">${esc(status)}</span>
          </div>
          ${shipment ? renderStatusStepper(shipment) : ''}
          ${shipment ? renderETACountdown(shipment) : ''}
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:10px;">
            ${cell('Vehicle', shipment && shipment.vehicleNumber)}
            ${cell('Driver', shipment && shipment.driverName)}
            ${cell('Status', b.status || 'Pending', { bold: true })}
            ${cell('Current loc.', shipment && shipment.currentLocation)}
            ${cell('ETA', shipment && shipment.eta)}
            ${cell('Tracking ID', trackingSafe, { mono: true })}
          </div>
          ${shipment ? renderRating(shipment) : ''}
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            ${shipment ? `<button class="btn btn-secondary btn-sm share-btn" onclick="window.customerPage.shareTracking('${esc(shipment.trackingId)}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>` : ''}
            ${shipment && shipment.status === 'Delivered' && shipment.podSignature ? '<span class="pill is-delivered">✓ POD Signed</span>' : ''}
          </div>
        </article>`;
    }).join('');
  }

  /* ── Messages ───────────────────────────────────────────────────── */
  async function loadMessages() {
    const res = await window.api('/api/messages', 'GET', null, true).catch(() => ({data:[]}));
    const msgs = res.data || [];
    const el = document.getElementById('messagesOutput');
    if (!el) return;
    if (!msgs.length) { el.innerHTML = '<div class="empty-state">No messages yet. Send one below!</div>'; return; }
    el.innerHTML = msgs.map(m => `
      <div class="card" style="margin-bottom:8px;${m.read?'':'border-left:3px solid var(--navy-700);'}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><strong>${esc(m.subject || 'No subject')}</strong> · ${esc(m.fromEmail)} → ${esc(m.toEmail||'')}</div>
          <span style="font-size:11px;color:var(--text-dim);">${Fmt(m.createdAt)}</span>
        </div>
        <div style="margin-top:6px;font-size:13px;">${esc(m.body)}</div>
      </div>`).join('');
  }

  async function sendMessage() {
    const to = document.getElementById('msgTo')?.value || '';
    const subject = document.getElementById('msgSubject')?.value || '';
    const body = document.getElementById('msgBody')?.value || '';
    if (!to || !body) return;
    const res = await window.api('/api/messages', 'POST', { toEmail: to, subject, body }, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('msgCompose').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Message sent', { kind: 'success' });
    loadMessages();
  }

  /* ── Tab + Button Wiring ────────────────────────────────────────── */
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
      ['deliveriesTab','bookTab','mapTab','messagesTab'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = (id === t) ? '' : 'none'; });
      if (t === 'mapTab') setTimeout(() => initCustomerMap(), 80);
      if (t === 'messagesTab') loadMessages();
    });
  }

  function wireQuickButtons() {
    const main = document.querySelector('.main');
    const bookingForm = document.getElementById('bookingForm');
    const bookingMsg = document.getElementById('bookingMsg');
    const modal = document.getElementById('bookingModal');
    const modalForm = document.getElementById('modalBookingForm');
    const modalMsg = document.getElementById('modalBookingMsg');

    if (main && main.dataset.quickBound !== '1') {
      main.dataset.quickBound = '1';
      main.addEventListener('click', (e) => {
        const t = e.target; if (!t || !t.closest) return;
        if (t.closest('#newBookingBtn')) { if (modal) { modal.style.display = ''; const ci = document.getElementById('modalBookingCustomer'); if (ci && window.authUser) ci.value = window.authUser.name || ''; } else showTab('bookTab'); }
        else if (t.closest('#closeBookingModal') || t.closest('#cancelBookingModalBtn')) { if (modal) modal.style.display = 'none'; }
        else if (t.closest('#cancelBookingBtn')) showTab('deliveriesTab');
        else if (t.closest('#refreshBtn')) loadDeliveries(true);
        else if (t.closest('#newMsgBtn')) { document.getElementById('msgCompose').style.display = ''; }
        else if (t.closest('#cancelMsgBtn')) { document.getElementById('msgCompose').style.display = 'none'; }
        else if (t.closest('#sendMsgBtn')) sendMessage();
        else if (t.closest('#submitRating')) submitRating();
      });
    }

    async function submitBooking(payload, msgEl, formEl) {
      if (!msgEl) return;
      msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = 'Creating…';
      const res = await window.api('/api/bookings', 'POST', payload, true);
      if (res && res.error) { msgEl.style.color = 'var(--red-600)'; msgEl.textContent = res.message || 'Could not create booking.'; if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
      msgEl.style.color = 'var(--green-700)'; msgEl.textContent = 'Booking created!';
      if (typeof window.notify === 'function') window.notify('Booking created', { kind: 'success' });
      if (formEl) formEl.reset();
      if (modal) modal.style.display = 'none';
      setTimeout(() => { showTab('deliveriesTab'); loadDeliveries(true); }, 600);
    }

    if (bookingForm && bookingForm.dataset.submitBound !== '1') {
      bookingForm.dataset.submitBound = '1';
      bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          customerName: (document.getElementById('bookingCustomer')?.value || '').trim(),
          origin: (document.getElementById('bookingOrigin')?.value || '').trim(),
          destination: (document.getElementById('bookingDestination')?.value || '').trim(),
          serviceZone: document.getElementById('bookingZone')?.value || 'Central',
          priority: document.getElementById('bookingPriority')?.value || 'Standard',
          notes: document.getElementById('bookingNotes')?.value || ''
        };
        if (!payload.origin || !payload.destination) { bookingMsg.style.color = 'var(--red-600)'; bookingMsg.textContent = 'Pickup and drop-off addresses are required.'; return; }
        await submitBooking(payload, bookingMsg, bookingForm);
      });
    }

    if (modalForm && modalForm.dataset.submitBound !== '1') {
      modalForm.dataset.submitBound = '1';
      modalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          customerName: (document.getElementById('modalBookingCustomer')?.value || '').trim(),
          origin: (document.getElementById('modalBookingOrigin')?.value || '').trim(),
          destination: (document.getElementById('modalBookingDestination')?.value || '').trim(),
          serviceZone: document.getElementById('modalBookingZone')?.value || 'Central',
          priority: document.getElementById('modalBookingPriority')?.value || 'Standard'
        };
        if (!payload.origin || !payload.destination) { modalMsg.style.color = 'var(--red-600)'; modalMsg.textContent = 'Pickup and drop-off addresses are required.'; return; }
        await submitBooking(payload, modalMsg, modalForm);
      });
    }
  }

  function fillIdentity(user) {
    const dn = (user && (user.name || user.email)) || 'Customer';
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    const ci = document.getElementById('bookingCustomer');
    const roleBadge = document.querySelector('.user-chip-role');
    const greeting = document.getElementById('pageGreeting');
    if (nameEl) nameEl.textContent = dn;
    if (avatarEl) avatarEl.textContent = initials(dn, 'CU');
    if (roleBadge && user && user.role) roleBadge.textContent = user.role;
    if (ci) ci.value = (user && user.name) || '';
    if (greeting) {
      const hr = new Date().getHours();
      const slot = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
      const first = user && user.name ? user.name.split(/\s+/)[0] : '';
      greeting.textContent = first ? (slot + ', ' + first) : slot;
    }
  }

  /* ── Map ────────────────────────────────────────────────────────── */
  let customerMap = null, customerLayers = [];
  async function initCustomerMap() {
    const container = document.getElementById('customerMap');
    if (!container) return;
    if (typeof window.L === 'undefined') { container.innerHTML = empty({ title: 'Map failed to load', message: 'Check your network.' }); return; }
    if (!customerMap) { customerMap = window.L.map('customerMap').setView([0,0],2); window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap',maxZoom:19}).addTo(customerMap); }
    else customerMap.invalidateSize();
    customerLayers.forEach(l => customerMap.removeLayer(l)); customerLayers = [];

    const [bData, sData] = await Promise.all([
      window.api('/api/bookings','GET',null,true).catch(()=>({data:[]})),
      window.api('/api/shipments','GET',null,true).catch(()=>({data:[]}))
    ]);
    const bArr = Array.isArray(bData) ? bData : (bData.data) || [];
    async function locate(text) { if (!text || text.length < 3) return null; try { const r = await fetch('/api/geocode/search?q='+encodeURIComponent(text)+'&limit=1'); const j = await r.json(); if (j && j.length) return [parseFloat(j[0].lat), parseFloat(j[0].lon)]; } catch (_e) {} return null; }
    const pts = [];
    for (const b of bArr) {
      const o = await locate(b.origin); const d = await locate(b.destination);
      if (o) { const m = window.L.circleMarker(o,{radius:8,color:'#FF6B35',fillColor:'#FF6B35',fillOpacity:0.9}).addTo(customerMap); m.bindPopup('<strong>Pickup:</strong> '+esc(b.origin)); customerLayers.push(m); pts.push(o); }
      if (d) { const m = window.L.circleMarker(d,{radius:8,color:'#0F4C81',fillColor:'#0F4C81',fillOpacity:0.9}).addTo(customerMap); m.bindPopup('<strong>Drop-off:</strong> '+esc(b.destination)); customerLayers.push(m); pts.push(d); if (o) customerLayers.push(window.L.polyline([o,d],{color:'#0F4C81',weight:2,opacity:0.6,dashArray:'4 6'}).addTo(customerMap)); }
    }
    if (pts.length) customerMap.fitBounds(window.L.latLngBounds(pts).pad(0.2)); else customerMap.setView([20,0],2);
  }

  /* ── Address Autocomplete ──────────────────────────────────────── */
  function wireAddressAutocomplete() {
    var autocomplete = window.setupAddressAutocomplete;
    if (typeof autocomplete !== 'function') return;
    var ids = ['bookingOrigin', 'bookingDestination', 'modalBookingOrigin', 'modalBookingDestination'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) autocomplete(el);
    });
  }

  /* ── Bootstrap ─────────────────────────────────────────────────── */
  window.addEventListener('pagehide', () => { if (window.__customerTicker) { clearInterval(window.__customerTicker); window.__customerTicker = null; } });
  async function bootCustomerPage() {
    if (window.__customerTicker) { clearInterval(window.__customerTicker); window.__customerTicker = null; }
    const user = await window.requireAuth('Customer');
    if (!user) return;
    window.authUser = user;
    initTheme();
    initModalClosers();
    fillIdentity(user);
    wireNavLinks();
    wireQuickButtons();
    wireAddressAutocomplete();
    await loadDeliveries(false);
    window.__customerTicker = setInterval(() => loadDeliveries(false), 30000);
  }
  window.onReady(bootCustomerPage);
  window.customerPage.loadDeliveries = loadDeliveries;
  window.customerPage.initCustomerMap = initCustomerMap;
  window.customerPage.shareTracking = shareTracking;
})();
