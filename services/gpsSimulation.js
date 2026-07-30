/* ═══════════════════════════════════════════════════════════════════════════
   SecureTMS — Live GPS Simulation
   Periodically updates vehicle and shipment locations, emitting socket.io
   events so maps on all dashboards animate markers in real time.
   ═══════════════════════════════════════════════════════════════════════════ */

const Vehicle = require('../models/Vehicle');
const Shipment = require('../models/Shipment');
const logger = require('winston');

// Simulated GPS waypoints for each vehicle (lat, lng, label)
const SIMULATED_ROUTES = {
  'TRK-001': [
    { lat: -33.8688, lng: 151.2093, label: 'Sydney CBD' },
    { lat: -34.0, lng: 150.5, label: 'Southern Highlands' },
    { lat: -35.0, lng: 149.0, label: 'Canberra Region' },
    { lat: -36.0, lng: 147.0, label: 'Alpine Region' },
    { lat: -37.0, lng: 145.0, label: 'Melbourne Approach' },
    { lat: -37.8136, lng: 144.9631, label: 'Melbourne CBD' }
  ],
  'VAN-214': [
    { lat: -37.8136, lng: 144.9631, label: 'Melbourne CBD' },
    { lat: -35.5, lng: 149.5, label: 'Canberra' },
    { lat: -33.5, lng: 151.0, label: 'Central Coast' },
    { lat: -27.4698, lng: 153.0251, label: 'Brisbane CBD' }
  ],
  'BIK-047': [
    { lat: -33.8688, lng: 151.2093, label: 'Sydney' },
    { lat: -33.85, lng: 151.1, label: 'Inner West' }
  ]
};

let gpsInterval = null;
let vehiclePositions = {}; // vehicleNumber -> { lat, lng, step, route }

function initGPSSimulation(io) {
  if (gpsInterval) clearInterval(gpsInterval);

  // Initialise positions
  Object.keys(SIMULATED_ROUTES).forEach(vn => {
    const route = SIMULATED_ROUTES[vn];
    vehiclePositions[vn] = { step: 0, route, lat: route[0].lat, lng: route[0].lng };
  });

  gpsInterval = setInterval(async () => {
    try {
      const updates = [];
      for (const [vehicleNumber, pos] of Object.entries(vehiclePositions)) {
        // Advance step
        pos.step = (pos.step + 1) % pos.route.length;
        const wp = pos.route[pos.step];
        pos.lat = wp.lat + (Math.random() - 0.5) * 0.02;
        pos.lng = wp.lng + (Math.random() - 0.5) * 0.02;

        // Update vehicle in DB
        await Vehicle.findOneAndUpdate(
          { vehicleNumber },
          { location: wp.label, updatedAt: new Date() }
        ).catch(() => {});

        // Update linked shipments
        await Shipment.updateMany(
          { vehicleNumber, status: { $in: ['Picked Up', 'In Transit'] } },
          { currentLocation: wp.label, updatedAt: new Date() }
        ).catch(() => {});

        updates.push({ vehicleNumber, lat: pos.lat, lng: pos.lng, label: wp.label });
      }

      if (io && updates.length) {
        io.emit('gps:update', updates);
      }
    } catch (e) {
      logger.warn('[gps] Simulation tick failed: ' + (e && e.message));
    }
  }, 5000); // Update every 5 seconds

  logger.info('[gps] Live GPS simulation started (' + Object.keys(SIMULATED_ROUTES).length + ' vehicles)');
  return gpsInterval;
}

function stopGPSSimulation() {
  if (gpsInterval) { clearInterval(gpsInterval); gpsInterval = null; }
}

module.exports = { initGPSSimulation, stopGPSSimulation, SIMULATED_ROUTES };
