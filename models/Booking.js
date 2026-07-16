const mongoose = require('mongoose');
const BookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pickup: String,
  drop: String,
  vehicleType: String,
  priority: String,
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Booking', BookingSchema);
