const mongoose = require('mongoose');
const BookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerName: { type: String, required: true },
  customerEmail: { type: String },
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  status: { type: String, default: 'Pending' },
  serviceZone: { type: String, default: 'Central' },
  priority: { type: String, enum: ['Standard', 'Express', 'Priority'], default: 'Standard' },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Booking', BookingSchema);
