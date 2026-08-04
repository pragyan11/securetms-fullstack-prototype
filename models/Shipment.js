const mongoose = require('mongoose');
const ShipmentSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  trackingId: { type: String, required: true, unique: true, index: true },
  vehicleNumber: { type: String },
  driverName: { type: String },
  assignedDriverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  driverEmail: { type: String, index: true },
  customerEmail: { type: String },
  pickupAddress: { type: String },
  deliveryAddress: { type: String },
  customerName: { type: String },
  eta: { type: String, default: 'Pending' },
  status: { type: String, enum: ['Created', 'Picked Up', 'In Transit', 'Delivered', 'Cancelled'], default: 'Created' },
  currentLocation: { type: String, default: 'Awaiting pickup' },
  podSignature: { type: String },
  podPhoto: { type: String },
  podNotes: { type: String },
  podTimestamp: { type: Date },
  rating: { type: Number, min: 1, max: 5 },
  ratingComment: { type: String },
  stops: [{ address: String, status: { type: String, default: 'Pending' }, sequence: Number }],
  updatedAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Shipment', ShipmentSchema);
