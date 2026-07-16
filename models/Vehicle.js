const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true, unique: true },
  vehicleType: { type: String, required: true },
  driverName: { type: String, default: 'Unassigned' },
  location: { type: String, default: 'Hub' },
  status: { type: String, enum: ['Available', 'In Transit', 'Maintenance'], default: 'Available' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Vehicle', VehicleSchema);
