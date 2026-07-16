const mongoose = require('mongoose');
const ShipmentSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  trackingId: { type: String, required: true },
  status: { type: String, default: 'Created' },
  eta: { type: String, default: 'Unknown' },
  updatedAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Shipment', ShipmentSchema);
