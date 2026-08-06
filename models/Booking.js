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
  createdAt: { type: Date, default: Date.now },

  // ── Pricing / invoicing (Phase C) ───────────────────────────────
  requestedPickupDate: { type: Date },
  price: { type: Number },
  currency: { type: String, default: 'USD' },
  invoiceNumber: { type: String },
  paymentStatus: { type: String, enum: ['Unpaid', 'Paid', 'Refunded'], default: 'Unpaid' },
  paymentUpdatedAt: { type: Date },
  cancelReason: { type: String },
  cancelledAt: { type: Date },
  rescheduledTo: { type: Date },
  rescheduleReason: { type: String }
});
module.exports = mongoose.model('Booking', BookingSchema);
