/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — Live Track (Uber / DoorDash style)
   Shared by the customer and driver views. Builds on the existing Leaflet +
   socket.io GPS stream (services/gpsSimulation.js emits `gps:update` every 5s).

   What it adds on top of the old static maps:
   • Animated vehicle marker that glides between GPS fixes (rAF interpolation)
   • Route polyline split into travelled (solid) / remaining (dashed)
   • Uber-style live status card: ETA countdown, distance remaining,
     live progress bar, pulsing "LIVE" badge, vehicle + tracking info
   • Auto-fit bounds, smooth re-centre on first fix

   Usage:
     const track = window.LiveTrack.create('customerMap');
     await track.addRoute({ ...routeInfo });          // one per shipment
     track.bindSocket(window.io(...));                // consumes gps:update
     track.updateVehicle('TRK-001', lat, lng, label); // manual override
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  const S = window.SecureTMS || {};
  const esc = S.escapeHtml || (x => String(x == null ? '' : x));

  /* ── Geo helpers ──────────────────────────────────────────────── */
  function toRad(d) { return d * Math.PI / 180; }
  function haversineKm(a, b) {
    const R = 6371;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearingDeg(a, b) {
    const φ1 = toRad(a[0]), φ2 = toRad(b[0]);
    const Δλ = toRad(b[1] - a[1]);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function fmtDist(km) {
    if (km == null || isNaN(km)) return '—';
    return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km';
  }
  function fmtClock(sec) {
    if (sec == null || isNaN(sec) || sec < 0) return '—';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? h + 'h ' + String(m).padStart(2, '0') + 'm'
      : m + ':' + String(s).padStart(2, '0');
  }

  // Average delivery speed used to derive ETA from remaining distance.
  const AVG_SPEED_KMH = 42;
  const ANIM_MS = 3800; // glide time between 5s GPS fixes

  /* ── Truck icon (LIVE pulsing) ────────────────────────────────── */
  function truckIcon(heading) {
    const h = heading == null ? 0 : Math.round(heading);
    return window.L.divIcon({
      className: 'lt-truck-icon',
      html: `<div class="lt-truck" style="transform:rotate(${h}deg)">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1" y="6" width="13" height="10" rx="1.2" fill="#0F4C81" stroke="#0F4C81"/>
          <path d="M14 9h4l3 3v4h-7z" fill="#FF6B35" stroke="#FF6B35"/>
          <circle cx="6.5" cy="17.5" r="1.8" fill="#fff" stroke="#0F4C81" stroke-width="1.2"/>
          <circle cx="16.5" cy="17.5" r="1.8" fill="#fff" stroke="#FF6B35" stroke-width="1.2"/>
        </svg>
        <span class="lt-ping"></span>
      </div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  /* ── Track instances ──────────────────────────────────────────── */
  const tracks = {}; // containerId -> track

  function create(containerId) {
    if (tracks[containerId]) return tracks[containerId];
    const c = document.getElementById(containerId);
    if (!c || typeof window.L === 'undefined') return null;

    const map = window.L.map(containerId, { zoomControl: true }).setView([-28.0, 140.0], 4);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19
    }).addTo(map);

    const track = {
      map,
      routes: [],            // { id, vehicleNumber, marker, line, lineDone, from, to, etaEls, ... }
      byVehicle: {},         // vehicleNumber -> route
      vehicles: {},          // vehicleNumber -> { from, to, start, anim }
      socket: null,
      animId: null,
      containerId
    };

    // One rAF loop drives every marker glide; idles when nothing is moving.
    function tick(ts) {
      const active = Object.keys(track.vehicles);
      for (const vn of active) {
        const v = track.vehicles[vn];
        const r = track.byVehicle[vn];
        if (!v || !v.to || !v.start || !r) continue;
        const p = Math.min(1, (ts - v.start) / ANIM_MS);
        const e = 1 - Math.pow(1 - p, 3); // ease-out
        const lat = v.from[0] + (v.to[0] - v.from[0]) * e;
        const lng = v.from[1] + (v.to[1] - v.from[1]) * e;
        r.marker.setLatLng([lat, lng]);
        if (p >= 1) {
          delete track.vehicles[vn];
          finishMove(track, r, vn);
        }
      }
      if (Object.keys(track.vehicles).length) {
        track.animId = requestAnimationFrame(tick);
      } else {
        track.animId = null;
      }
    }
    track._startLoop = function () {
      if (!track.animId) track.animId = requestAnimationFrame(tick);
    };
    track._stopLoop = function () {
      if (track.animId) { cancelAnimationFrame(track.animId); track.animId = null; }
    };
    window.addEventListener('pagehide', () => track._stopLoop());

    tracks[containerId] = track;
    return track;
  }

  function finishMove(track, r, vn) {
    if (!r || !r.vehicle) return;
    // Arrived at destination?
    if (r.to && haversineKm(r.to, [r.vehicle.lat, r.vehicle.lng]) < 1.2) {
      setStatus(track, r, 'arriving');
    } else if (r.vehicle && r.vehicle.status === 'In Transit') {
      setStatus(track, r, 'live');
    }
  }

  /* ── Live status card markup (Uber style) ─────────────────────── */
  function statusCardHTML(r) {
    return `
      <div class="lt-card" data-lt-card="${esc(r.id)}">
        <div class="lt-card-head">
          <span class="lt-live"><span class="lt-live-dot"></span>LIVE</span>
          <span class="lt-tracking font-mono">${esc(r.trackingId || r.id)}</span>
        </div>
        <div class="lt-legs">
          <div class="lt-leg"><span class="lt-dot lt-dot-a"></span><span class="lt-leg-label">${esc(r.originLabel || 'Pickup')}</span></div>
          <div class="lt-leg"><span class="lt-dot lt-dot-b"></span><span class="lt-leg-label">${esc(r.destLabel || 'Drop-off')}</span></div>
        </div>
        <div class="lt-eta-row">
          <div>
            <div class="lt-eta" data-lt-eta="${esc(r.id)}">…</div>
            <div class="lt-eta-sub" data-lt-etasub="${esc(r.id)}">Estimating arrival…</div>
          </div>
          <div class="lt-vehicle">
            <span class="lt-vehicle-no font-mono">${esc(r.vehicleNumber || '')}</span>
            <span class="lt-vehicle-state" data-lt-state="${esc(r.id)}">${esc(r.initialStatus || '')}</span>
          </div>
        </div>
        <div class="lt-progress"><div class="lt-progress-fill" data-lt-fill="${esc(r.id)}" style="width:0%"></div></div>
        <div class="lt-progress-labels">
          <span data-lt-done="${esc(r.id)}">0% travelled</span>
          <span data-lt-remain="${esc(r.id)}">— left</span>
        </div>
      </div>`;
  }

  function statusCardContainer(map) {
    const shell = map.getContainer().closest('.map-shell') || map.getContainer().parentElement;
    let box = shell && shell.querySelector('.lt-cards');
    if (!box) {
      box = document.createElement('div');
      box.className = 'lt-cards';
      if (shell) shell.appendChild(box);
      else map.getContainer().parentElement.appendChild(box);
    }
    return box;
  }

  function setStatus(track, r, kind, text) {
    const stateEl = r.etaEls.state;
    if (!stateEl) return;
    const map = {
      live: ['In Transit', 'is-live'],
      arriving: ['Arriving now', 'is-arriving'],
      done: ['Delivered', 'is-done']
    }[kind];
    stateEl.textContent = text || (map ? map[0] : '');
    stateEl.className = 'lt-vehicle-state' + (map ? ' ' + map[1] : '');
  }

  /* ── Add a shipment route ─────────────────────────────────────── */
  async function addRoute(track, route) {
    if (!track || !route || !route.from || !route.to) return;
    const L = window.L;
    const id = route.id || (route.trackingId || 'route') + '-' + Date.now();
    const from = [Number(route.from[0]), Number(route.from[1])];
    const to = [Number(route.to[0]), Number(route.to[1])];
    const totalKm = haversineKm(from, to);

    const r = {
      id,
      vehicleNumber: route.vehicleNumber || null,
      trackingId: route.trackingId,
      from,
      to,
      totalKm,
      vehicle: null,
      marker: null,
      line: null,
      lineDone: null,
      etaEls: {},
      initialStatus: route.status || 'Created',
      route
    };

    // Route polyline: dashed remainder + solid travelled overlay
    r.line = L.polyline([from, to], {
      color: '#0F4C81', weight: 4, opacity: 0.55, dashArray: '6 10'
    }).addTo(track.map);
    r.lineDone = L.polyline([from, from], {
      color: '#FF6B35', weight: 4.5, opacity: 0.95, lineCap: 'round'
    }).addTo(track.map);

    // Pickup / drop-off markers
    const pm = L.circleMarker(from, { radius: 8, color: '#FF6B35', fillColor: '#FF6B35', fillOpacity: 0.9 }).addTo(track.map);
    pm.bindPopup('<strong>Pickup</strong><br>' + esc(route.originLabel || ''));
    const dm = L.circleMarker(to, { radius: 8, color: '#0F4C81', fillColor: '#0F4C81', fillOpacity: 0.9 }).addTo(track.map);
    dm.bindPopup('<strong>Drop-off</strong><br>' + esc(route.destLabel || ''));
    dm.bindTooltip('Arrival', { direction: 'top', offset: [0, -10] });

    // Uber-style status card
    const cardBox = statusCardContainer(track.map);
    cardBox.insertAdjacentHTML('beforeend', statusCardHTML(r));
    const selFor = (attr) => {
      const safe = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id.replace(/"/g, '');
      return '[data-' + attr + '="' + safe + '"]';
    };
    const card = cardBox.querySelector(selFor('lt-card'));
    r.etaEls = {
      card,
      eta: card && card.querySelector(selFor('lt-eta')),
      sub: card && card.querySelector(selFor('lt-etasub')),
      fill: card && card.querySelector(selFor('lt-fill')),
      done: card && card.querySelector(selFor('lt-done')),
      remain: card && card.querySelector(selFor('lt-remain')),
      state: card && card.querySelector(selFor('lt-state'))
    };

    // Initial position: assume vehicle starts at pickup
    r.vehicle = { lat: from[0], lng: from[1], status: route.status };
    r.marker = L.marker(from, { icon: truckIcon(0) }).addTo(track.map);
    r.marker.bindPopup(
      '<strong>' + esc(route.vehicleNumber || 'Vehicle') + '</strong><br>' +
      esc(route.status || '') + '<br>' + esc(route.trackingId || '')
    );

    if (route.vehicleNumber) track.byVehicle[route.vehicleNumber] = r;
    track.routes.push(r);

    // Re-fit to show everything
    try { track.map.fitBounds(L.latLngBounds([from, to]).pad(0.25)); } catch (_e) {}

    updateEta(track, r);
    track._startLoop();
    return r;
  }

  /* ── Move a vehicle (from socket or manual) ───────────────────── */
  function updateVehicle(track, vehicleNumber, lat, lng, label) {
    const r = track.byVehicle[vehicleNumber];
    if (!r || !r.marker) return;
    const toPos = [Number(lat), Number(lng)];
    const cur = r.marker.getLatLng();
    const fromPos = [cur.lat, cur.lng];
    // Skip no-ops
    if (fromPos[0] === toPos[0] && fromPos[1] === toPos[1]) return;

    // Rotate icon toward heading
    r.marker.setIcon(truckIcon(bearingDeg(fromPos, toPos)));
    r.vehicle = { lat: toPos[0], lng: toPos[1], status: r.vehicle ? r.vehicle.status : 'In Transit' };
    track.vehicles[vehicleNumber] = { from: fromPos, to: toPos, start: performance.now() };
    track._startLoop();

    // Progress: fraction of straight-line route travelled
    const pct = Math.max(0, Math.min(100, (haversineKm(from, toPos) / r.totalKm) * 100));
    const remainKm = Math.max(0, r.totalKm - haversineKm(from, toPos));
    const etaSec = (remainKm / AVG_SPEED_KMH) * 3600;
    // Advance the orange travelled segment of the route polyline
    if (r.lineDone) r.lineDone.setLatLngs([from, [toPos[0], toPos[1]]]);
    if (r.etaEls.fill) r.etaEls.fill.style.width = pct + '%';
    if (r.etaEls.done) r.etaEls.done.textContent = Math.round(pct) + '% travelled';
    if (r.etaEls.remain) r.etaEls.remain.textContent = fmtDist(remainKm) + ' left';
    r._etaSec = etaSec;
    if (r.etaEls.sub) r.etaEls.sub.textContent = label ? 'Near ' + esc(label) : 'Live tracking';

    if (pct > 97) setStatus(track, r, 'arriving');
    else if (r.vehicle.status === 'In Transit') setStatus(track, r, 'live');
    updateEta(track, r);
  }

  /* ── ETA countdown (ticks each second) ────────────────────────── */
  function updateEta(track, r) {
    if (!r.etaEls.eta) return;
    if (!r._etaSec && !(r.vehicle && r.vehicle.status === 'In Transit')) {
      r.etaEls.eta.textContent = r.initialStatus || '—';
      if (r.etaEls.sub) r.etaEls.sub.textContent = 'Waiting for first GPS fix…';
      return;
    }
    const etaSec = r._etaSec || ((r.totalKm / AVG_SPEED_KMH) * 3600);
    let remaining = etaSec;
    r.etaEls.eta.textContent = '~' + fmtClock(remaining);
    if (r.etaEls.sub) r.etaEls.sub.textContent = 'Estimated arrival';
    clearInterval(r._etaTimer);
    r._etaTimer = setInterval(() => {
      if (!r.etaEls.eta || !document.body.contains(r.etaEls.eta)) { clearInterval(r._etaTimer); return; }
      remaining -= 1;
      if (remaining <= 0) {
        r.etaEls.eta.textContent = 'Arriving';
        clearInterval(r._etaTimer);
        return;
      }
      r.etaEls.eta.textContent = '~' + fmtClock(remaining);
    }, 1000);
  }

  /* ── Socket binding: consume gps:update ───────────────────────── */
  function bindSocket(track, socket) {
    if (!track || !socket || track.socket) return;
    track.socket = socket;
    socket.on('gps:update', (updates) => {
      (updates || []).forEach((u) => {
        updateVehicle(track, u.vehicleNumber, u.lat, u.lng, u.label);
      });
    });
  }

  /* ── CSS (injected once) ──────────────────────────────────────── */
  const CSS_TEXT = `
  .lt-cards { position:absolute; left:10px; right:10px; bottom:10px; z-index:800; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
  .lt-card { pointer-events:auto; background:rgba(255,255,255,0.96); border:1px solid var(--border, #DDE2EC); border-radius:14px; padding:12px 14px; box-shadow:0 12px 32px rgba(15,23,42,0.18); backdrop-filter:blur(6px); }
  body.dark .lt-card { background:rgba(30,41,59,0.96); border-color:#334155; }
  .lt-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
  .lt-live { display:inline-flex; align-items:center; gap:5px; font-size:10.5px; font-weight:700; letter-spacing:0.08em; color:#059669; text-transform:uppercase; }
  .lt-live-dot { width:8px; height:8px; border-radius:50%; background:#10B981; animation:lt-pulse 1.4s infinite; }
  .lt-tracking { font-size:11.5px; color:var(--text-muted, #5C6878); }
  .lt-legs { display:flex; flex-direction:column; gap:5px; margin-bottom:10px; }
  .lt-leg { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text, #1F2937); }
  .lt-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
  .lt-dot-a { background:#FF6B35; box-shadow:0 0 0 3px rgba(255,107,53,0.18); }
  .lt-dot-b { background:#0F4C81; box-shadow:0 0 0 3px rgba(15,76,129,0.18); }
  .lt-eta-row { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; }
  .lt-eta { font-size:22px; font-weight:800; color:var(--text-hi, #0B1220); font-variant-numeric:tabular-nums; line-height:1.1; }
  .lt-eta-sub { font-size:11px; color:var(--text-muted, #5C6878); }
  .lt-vehicle { text-align:right; }
  .lt-vehicle-no { font-size:11px; color:var(--text-muted, #5C6878); display:block; }
  .lt-vehicle-state { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#0F4C81; }
  .lt-vehicle-state.is-live { color:#059669; }
  .lt-vehicle-state.is-arriving { color:#FF6B35; }
  .lt-vehicle-state.is-done { color:#0F4C81; }
  .lt-progress { height:6px; border-radius:999px; background:var(--border, #DDE2EC); overflow:hidden; margin-top:10px; }
  body.dark .lt-progress { background:#334155; }
  .lt-progress-fill { height:100%; border-radius:999px; background:linear-gradient(90deg,#FF6B35,#FF885C); transition:width 0.8s ease; }
  .lt-progress-labels { display:flex; justify-content:space-between; font-size:10.5px; color:var(--text-muted, #5C6878); margin-top:5px; }
  .lt-truck-icon { position:relative; }
  .lt-truck { position:relative; filter:drop-shadow(0 2px 4px rgba(15,23,42,0.35)); transition:transform 0.6s ease; }
  .lt-truck svg { display:block; }
  .lt-ping { position:absolute; left:50%; top:50%; width:34px; height:34px; margin:-17px 0 0 -17px; border-radius:50%; border:3px solid rgba(255,107,53,0.7); animation:lt-ping 1.6s ease-out infinite; pointer-events:none; }
  @keyframes lt-ping { 0% { transform:scale(0.4); opacity:1; } 100% { transform:scale(1.6); opacity:0; } }
  @keyframes lt-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.45; transform:scale(0.85); } }
  @media (min-width:560px) { .lt-cards { left:12px; right:auto; width:320px; bottom:12px; } }
  `;
  let cssInjected = false;
  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const el = document.createElement('style');
    el.textContent = CSS_TEXT;
    document.head.appendChild(el);
  }
  // Inject early so cards never flash unstyled
  if (typeof document !== 'undefined' && document.head) injectCSS();

  window.LiveTrack = { create, addRoute, updateVehicle, bindSocket, haversineKm, fmtDist, fmtClock };
})();
