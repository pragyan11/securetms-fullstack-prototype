/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — public shipment tracking (no login required).
   /track.html?trackingId=SHP-1001 (or search by ID)
   Shows a status stepper, shipment details, stops, and a live map with the
   vehicle marker when the GPS simulation is broadcasting it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  const STATUS_STEPS = ['Created', 'Picked Up', 'In Transit', 'Delivered'];

  function stepIndex(status) {
    const i = STATUS_STEPS.indexOf(status);
    return i === -1 ? (status === 'Cancelled' ? -1 : 0) : i;
  }

  function renderStepper(shipment) {
    const idx = stepIndex(shipment.status);
    const cancelled = shipment.status === 'Cancelled';
    const lis = STATUS_STEPS.map((label, i) => {
      const cls = cancelled ? '' : (i < idx ? 'completed' : (i === idx ? 'active' : ''));
      return `<li class="${cls}"><span class="step-dot"></span><span class="step-text">${label}</span></li>`;
    }).join('');
    return `<ul class="status-timeline" style="margin:14px 0 6px;">${lis}</ul>
      ${cancelled ? '<p style="color:var(--red-600);font-size:13px;margin-top:8px;">This shipment was cancelled.</p>' : ''}`;
  }

  function renderCard(shipment) {
    const out = byId('trackOutput');
    const mapHost = `
      <div class="map-shell"><div id="trackMap" class="map-canvas" style="height:260px;"></div></div>`;
    out.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
        <div class="card">
          <div class="card-header"><div><div class="card-title">Shipment ${esc(shipment.trackingId)}</div><div class="card-sub">Status: <span class="pill ${shipment.status === 'Delivered' ? 'is-delivered' : shipment.status === 'Cancelled' ? 'is-cancelled' : shipment.status === 'In Transit' || shipment.status === 'Picked Up' ? 'is-in-transit' : 'is-pending'}">${esc(shipment.status)}</span></div></div></div>
          ${renderStepper(shipment)}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:16px;">
            <div><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Pickup</div><div style="margin-top:4px;font-weight:600;color:var(--text-hi);">${esc(shipment.pickupAddress || '—')}</div></div>
            <div><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Delivery</div><div style="margin-top:4px;font-weight:600;color:var(--text-hi);">${esc(shipment.deliveryAddress || '—')}</div></div>
            <div><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Current location</div><div style="margin-top:4px;font-weight:600;color:var(--text-hi);">${esc(shipment.currentLocation || '—')}</div></div>
            <div><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">ETA</div><div style="margin-top:4px;font-weight:600;color:var(--text-hi);">${esc(shipment.eta || '—')}</div></div>
            <div><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Carrier</div><div style="margin-top:4px;font-weight:600;color:var(--text-hi);">${esc(shipment.driverName || '—')}${shipment.vehicleNumber ? ' · ' + esc(shipment.vehicleNumber) : ''}</div></div>
            <div><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Last update</div><div style="margin-top:4px;font-weight:600;color:var(--text-hi);">${shipment.updatedAt ? new Date(shipment.updatedAt).toLocaleString() : '—'}</div></div>
          </div>
          ${shipment.stops && shipment.stops.length ? `
            <div style="margin-top:18px;">
              <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:8px;">Route stops</div>
              ${shipment.stops.map(st => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-soft);font-size:13px;"><span style="width:20px;height:20px;border-radius:50%;background:${st.status === 'Visited' ? 'var(--green-500)' : st.status === 'Skipped' ? 'var(--red-600)' : 'var(--border-strong)'};color:white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;">${st.sequence || '•'}</span><span style="color:${st.status === 'Visited' ? 'var(--text-hi)' : 'var(--text-muted)'};">${esc(st.address)}</span>${st.status ? `<span class="pill is-other" style="font-size:10px;margin-left:auto;">${esc(st.status)}</span>` : ''}</div>`).join('')}
            </div>` : ''}
        </div>
        <div class="card">
          <div class="card-header"><div><div class="card-title">Route map</div><div class="card-sub">Pickup to delivery, live when the vehicle is moving.</div></div></div>
          ${mapHost}
        </div>
      </div>`;

    // Live vehicle marker via the GPS simulation stream.
    let liveMarker = null;
    if (typeof window.io === 'function') {
      const socket = window.io({ transports: ['websocket', 'polling'] });
      socket.on('gps:update', (updates) => {
        const u = (updates || []).find(x => x.vehicleNumber === shipment.vehicleNumber);
        if (u && liveMarker) { liveMarker.setLatLng([u.lat, u.lng]); return; }
        if (u && !liveMarker && window.L) {
          liveMarker = window.L.marker([u.lat, u.lng], { icon: window.L.divIcon({ className: '', html: '<div style="background:#10B981;width:18px;height:18px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(16,185,129,0.7);"></div>', iconSize: [18, 18] }) }).addTo(window.trackMap);
        }
      });
      setTimeout(() => socket.close(), 60000); // don't hold the connection forever
    }

    drawMap(shipment);
  }

  async function drawMap(shipment) {
    if (typeof window.L === 'undefined' || !byId('trackMap')) return;
    const map = window.L.map('trackMap').setView([0, 0], 2);
    window.trackMap = map;
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map);
    async function locate(text) {
      if (!text || text.length < 3) return null;
      try {
        const r = await fetch('/api/geocode/search?q=' + encodeURIComponent(text) + '&limit=1');
        const j = await r.json();
        if (j && j.length) return [parseFloat(j[0].lat), parseFloat(j[0].lon)];
      } catch (_e) { /* ignore */ }
      return null;
    }
    const o = await locate(shipment.pickupAddress);
    const d = await locate(shipment.deliveryAddress);
    const pts = [];
    if (o) { window.L.circleMarker(o, { radius: 8, color: '#0F4C81', fillColor: '#0F4C81', fillOpacity: 0.9 }).addTo(map).bindPopup('Pickup<br>' + esc(shipment.pickupAddress)); pts.push(o); }
    if (d) { window.L.circleMarker(d, { radius: 8, color: '#FF6B35', fillColor: '#FF6B35', fillOpacity: 0.9 }).addTo(map).bindPopup('Delivery<br>' + esc(shipment.deliveryAddress)); pts.push(d); }
    if (o && d) window.L.polyline([o, d], { color: '#0F4C81', weight: 2, dashArray: '4 6', opacity: 0.6 }).addTo(map);
    if (pts.length) map.fitBounds(window.L.latLngBounds(pts).pad(0.3));
  }

  async function load(id) {
    const out = byId('trackOutput');
    if (!id) {
      out.innerHTML = '<div class="empty-state is-illustrated"><div class="empty-state-title">Enter a tracking ID</div><div class="empty-state-msg">e.g. SHP-1001 or the share link you received.</div></div>';
      return;
    }
    out.innerHTML = '<div class="skeleton" style="height:180px;"></div>';
    const res = await window.api('/api/public/track/' + encodeURIComponent(id), 'GET', null, false);
    if (res.error || !res.trackingId) {
      out.innerHTML = `<div class="empty-state is-illustrated"><div class="empty-state-title">Shipment not found</div><div class="empty-state-msg">${esc(res.message || 'Check the tracking ID and try again.')}</div></div>`;
      return;
    }
    renderCard(res);
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('trackingId') || params.get('id') || params.get('track') || '';
    if (q) byId('trackInput').value = q;
    byId('trackForm').addEventListener('submit', (e) => { e.preventDefault(); load(byId('trackInput').value.trim()); });
    load(q);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
