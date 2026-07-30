const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true },
  vehicleType: { type: String, required: true },
  driverName: { type: String, default: 'Unassigned' },
  location: { type: String, default: 'Hub' },
  status: { type: String, enum: ['Available', 'In Transit', 'Maintenance'], default: 'Available' },
  serviceZone: { type: String, enum: ['North', 'South', 'East', 'West', 'Central', 'Downtown'], default: 'Central' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Vehicle', VehicleSchema);
