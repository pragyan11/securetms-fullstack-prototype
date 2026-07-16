const mongoose = require('mongoose');
const FleetSchema = new mongoose.Schema({
  vehicleNumber: String,
  vehicleType: String,
  driverName: String,
  status: { type: String, default: 'Available' },
  location: String,
  updatedAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Fleet', FleetSchema);
