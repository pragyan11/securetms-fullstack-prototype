const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true },
  vehicleType: { type: String, required: true },
  driverName: { type: String, default: 'Unassigned' },
  location: { type: String, default: 'Hub' },
  status: { type: String, enum: ['Available', 'In Transit', 'Maintenance'], default: 'Available' },
  serviceZone: { type: String, enum: ['North', 'South', 'East', 'West', 'Central', 'Downtown'], default: 'Central' },
  updatedAt: { type: Date, default: Date.now },

  // ── Fleet telemetry (Phase D) ───────────────────────────────────
  odometerKm: { type: Number, default: 0 },
  fuelLevel: { type: Number, min: 0, max: 100, default: 100 }, // percent
  capacityKg: { type: Number, default: 1000 }
});

module.exports = mongoose.model('Vehicle', VehicleSchema);
