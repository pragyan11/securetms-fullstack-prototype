/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — Live GPS Simulation (smooth, realistic fleet tracking)

   Old behaviour: vehicles teleported between a handful of waypoints every 5s
   with random jitter — the "dots jumping around" the map.

   New behaviour: every vehicle is advanced along a dense route polyline at a
   realistic road speed (with gentle jitter and deceleration near towns). Its
   position is interpolated every tick, so the client can glide the marker
   continuously — exactly how real transport-company live tracking looks.

   Emits `gps:update` every TICK_MS with:
     { vehicleNumber, vehicleType, driverName, lat, lng, label, heading,
       speedKmh, status, progress, distanceTravelledKm, distanceRemainingKm,
       etaMinutes, routeId, path }
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const Vehicle = require('../models/Vehicle');
const Shipment = require('../models/Shipment');
const logger = require('../lib/logger');

// Dense, highway-style waypoint routes. Segments are short enough that linear
// interpolation between adjacent points looks like road travel.
const SIMULATED_ROUTES = {
  // Sydney → Melbourne down the Hume Highway (M31)
  'TRK-001': {
    vehicleType: 'Truck',
    baseSpeedKmh: 80,
    startFraction: 0.15,
    waypoints: [
      { lat: -33.8688, lng: 151.2093, label: 'Sydney CBD' },
      { lat: -34.0667, lng: 150.8167, label: 'Campbelltown' },
      { lat: -34.18,   lng: 150.61,   label: 'Picton' },
      { lat: -34.45,   lng: 150.45,   label: 'Mittagong' },
      { lat: -34.4775, lng: 150.418,  label: 'Bowral' },
      { lat: -34.7517, lng: 149.7189, label: 'Goulburn' },
      { lat: -34.84,   lng: 148.91,   label: 'Yass' },
      { lat: -35.066,  lng: 148.108,  label: 'Gundagai' },
      { lat: -36.0737, lng: 146.9135, label: 'Albury' },
      { lat: -36.358,  lng: 146.323,  label: 'Wangaratta' },
      { lat: -36.551,  lng: 145.982,  label: 'Benalla' },
      { lat: -37.025,  lng: 145.135,  label: 'Seymour' },
      { lat: -37.601,  lng: 144.725,  label: 'Craigieburn' },
      { lat: -37.8136, lng: 144.9631, label: 'Melbourne CBD' }
    ]
  },
  // Melbourne → Sydney (return leg of the same corridor, so the two vehicles
  // pass each other on the road — a lively, realistic fleet view)
  'VAN-214': {
    vehicleType: 'Van',
    baseSpeedKmh: 62,
    startFraction: 0.3,
    waypoints: [
      { lat: -37.8136, lng: 144.9631, label: 'Melbourne CBD' },
      { lat: -37.601,  lng: 144.725,  label: 'Craigieburn' },
      { lat: -37.025,  lng: 145.135,  label: 'Seymour' },
      { lat: -36.551,  lng: 145.982,  label: 'Benalla' },
      { lat: -36.358,  lng: 146.323,  label: 'Wangaratta' },
      { lat: -36.0737, lng: 146.9135, label: 'Albury' },
      { lat: -35.066,  lng: 148.108,  label: 'Gundagai' },
      { lat: -34.84,   lng: 148.91,   label: 'Yass' },
      { lat: -34.7517, lng: 149.7189, label: 'Goulburn' },
      { lat: -34.4775, lng: 150.418,  label: 'Bowral' },
      { lat: -34.45,   lng: 150.45,   label: 'Mittagong' },
      { lat: -34.18,   lng: 150.61,   label: 'Picton' },
      { lat: -34.0667, lng: 150.8167, label: 'Campbelltown' },
      { lat: -33.8688, lng: 151.2093, label: 'Sydney CBD' }
    ]
  },
  // Courier bike — parked at the depot (Maintenance), rendered stationary.
  'BIK-047': {
    vehicleType: 'Bike',
    baseSpeedKmh: 30,
    startFraction: 0,
    stationary: true,
    waypoints: [
      { lat: -33.8688, lng: 151.2093, label: 'Sydney CBD' },
      { lat: -33.858,  lng: 151.13,   label: 'Inner West' }
    ]
  }
};

const TICK_MS = 2000;          // emit cadence (matches the client glide)
const PAUSE_MS = 25000;        // dwell time at each end of the run
const STATUS_REFRESH_TICKS = 15; // re-read fleet status from DB every ~30s
const MOVING_STATUSES = ['In Transit', 'Available'];

let gpsInterval = null;
let vehicles = {}; // vehicleNumber -> live sim state

/* ── Geo helpers ─────────────────────────────────────────────────── */
function toRad(d) { return d * Math.PI / 180; }
function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function buildRoute(waypoints) {
  const pts = waypoints.map(w => ({ lat: w.lat, lng: w.lng, label: w.label }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
  return { pts, cum, totalKm: cum[cum.length - 1] };
}

/* Position + heading at distance `km` along the route polyline. */
function pointAt(route, km) {
  const { pts, cum } = route;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] <= km) i++;
  const segLen = cum[i + 1] - cum[i] || 1;
  const t = Math.max(0, Math.min(1, (km - cum[i]) / segLen));
  const a = pts[i], b = pts[i + 1];
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    heading: bearingDeg(a, b),
    label: (km - cum[i] < cum[i + 1] - km) ? a.label : b.label
  };
}

/* Nearest waypoint label to a route distance (used for the DB location field). */
function labelAt(route, km) {
  const { pts, cum } = route;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(cum[i] - km);
    if (d < bestD) { bestD = d; best = i; }
  }
  return pts[best].label;
}

async function initGPSSimulation(io) {
  if (gpsInterval) clearInterval(gpsInterval);
  vehicles = {};

  // Pull live vehicle docs so we know current status/driver and only animate
  // vehicles that actually exist in the fleet.
  let docs = [];
  try {
    docs = await Vehicle.find({ vehicleNumber: { $in: Object.keys(SIMULATED_ROUTES) } }).lean();
  } catch (_e) { /* fleet may be empty on a fresh install */ }

  for (const [vn, def] of Object.entries(SIMULATED_ROUTES)) {
    const route = buildRoute(def.waypoints);
    const doc = docs.find(d => d.vehicleNumber === vn);
    const moving = !def.stationary && !!doc && MOVING_STATUSES.includes(doc.status);
    const startKm = route.totalKm * (def.startFraction || 0);
    vehicles[vn] = {
      vn,
      def,
      route,
      progressKm: startKm,
      direction: 1,
      speedKmh: def.baseSpeedKmh,
      pauseUntil: 0,
      moving,
      label: labelAt(route, startKm),
      odometerKm: (doc && doc.odometerKm) || 0,
      driverName: (doc && doc.driverName) || null,
      status: moving ? 'In Transit' : (def.stationary ? 'Parked' : 'Idle'),
      tickCount: 0
    };
  }

  // Sync initial positions so the fleet table isn't stale before the first
  // label crossing (keeps odometer/location correct right after boot).
  for (const v of Object.values(vehicles)) {
    await Vehicle.updateOne(
      { vehicleNumber: v.vn },
      { $set: { location: v.label, odometerKm: Math.round(v.odometerKm), updatedAt: new Date() } }
    ).catch(() => {});
  }

  gpsInterval = setInterval(() => {
    tick(io).catch(e => logger.warn('[gps] tick failed: ' + (e && e.message)));
  }, TICK_MS);

  logger.info('[gps] Live GPS simulation started (' + Object.keys(vehicles).length +
    ' vehicles, ' + TICK_MS + 'ms tick)');
  return gpsInterval;
}

async function tick(io) {
  const updates = [];
  const now = Date.now();
  const dtSec = TICK_MS / 1000;

  // Periodically honour fleet-status changes made in the admin dashboard
  // (e.g. marking a vehicle Available stops it, In Transit starts it).
  for (const v of Object.values(vehicles)) {
    if (++v.tickCount >= STATUS_REFRESH_TICKS) {
      v.tickCount = 0;
      try {
        const doc = await Vehicle.findOne({ vehicleNumber: v.vn }).select('status driverName').lean();
        if (doc) {
          v.moving = !v.def.stationary && MOVING_STATUSES.includes(doc.status);
          v.driverName = doc.driverName || v.driverName;
        }
      } catch (_e) { /* keep last known state */ }
    }
  }

  for (const v of Object.values(vehicles)) {
    const { route, def } = v;
    const total = route.totalKm || 1;

    // ── Advance the vehicle along the route at its current speed ──
    if (v.moving) {
      if (v.pauseUntil && now < v.pauseUntil) {
        v.speedKmh = 0;
        v.status = 'At destination';
      } else {
        if (v.pauseUntil && now >= v.pauseUntil) {
          v.pauseUntil = 0;
          v.direction *= -1; // begin the return leg
        }
        const distToEnd = v.direction > 0 ? total - v.progressKm : v.progressKm;
        if (distToEnd <= 0.05) {
          // Arrived — dwell before heading back.
          v.progressKm = v.direction > 0 ? total : 0;
          v.pauseUntil = now + PAUSE_MS;
          v.speedKmh = 0;
          v.status = 'At destination';
        } else {
          // Realistic speed: base + small jitter, gentle slowdown near towns.
          const jitter = (Math.random() - 0.5) * 10;
          const nearEnd = Math.min(1, distToEnd / 40);
          v.speedKmh = Math.max(8, def.baseSpeedKmh * (0.55 + 0.45 * nearEnd) + jitter);
          v.progressKm += (v.speedKmh / 3600) * dtSec * v.direction;
          if (v.progressKm < 0) v.progressKm = 0;
          if (v.progressKm > total) v.progressKm = total;
          v.status = 'In Transit';
        }
      }
    } else {
      v.speedKmh = 0;
      v.status = v.def.stationary ? 'Parked' : 'Idle';
    }

    const km = Math.max(0, Math.min(total, v.progressKm));
    v.progressKm = km;
    const pos = pointAt(route, km);
    const legProgress = v.direction > 0 ? km / total : 1 - (km / total);
    const distanceTravelledKm = v.direction > 0 ? km : total - km;
    const distanceRemainingKm = Math.max(0, total - distanceTravelledKm);
    const etaMinutes = v.speedKmh > 3 ? Math.round((distanceRemainingKm / v.speedKmh) * 60) : null;
    const label = labelAt(route, km);

    // Odometer accumulates real distance travelled.
    if (v.moving && v.speedKmh > 3) v.odometerKm += (v.speedKmh / 3600) * dtSec;

    // Persist to DB only when the town label changes (keeps writes cheap).
    if (label !== v.label) {
      v.label = label;
      await Vehicle.updateOne(
        { vehicleNumber: v.vn },
        { $set: { location: label, odometerKm: Math.round(v.odometerKm), updatedAt: new Date() } }
      ).catch(() => {});
      await Shipment.updateMany(
        { vehicleNumber: v.vn, status: { $in: ['Picked Up', 'In Transit'] } },
        { $set: { currentLocation: label, updatedAt: new Date() } }
      ).catch(() => {});
    }

    updates.push({
      vehicleNumber: v.vn,
      vehicleType: def.vehicleType,
      driverName: v.driverName,
      lat: +pos.lat.toFixed(5),
      lng: +pos.lng.toFixed(5),
      label,
      heading: Math.round((pos.heading + (v.direction < 0 ? 180 : 0)) % 360),
      speedKmh: Math.round(v.speedKmh),
      status: v.status,
      progress: +legProgress.toFixed(4),
      distanceTravelledKm: +distanceTravelledKm.toFixed(1),
      distanceRemainingKm: +distanceRemainingKm.toFixed(1),
      etaMinutes,
      routeId: v.vn + (v.direction > 0 ? ':fwd' : ':rev'),
      path: route.pts.map(p => [p.lat, p.lng])
    });
  }

  if (io && updates.length) io.emit('gps:update', updates);
}

function stopGPSSimulation() {
  if (gpsInterval) { clearInterval(gpsInterval); gpsInterval = null; }
}

module.exports = { initGPSSimulation, stopGPSSimulation, SIMULATED_ROUTES };
