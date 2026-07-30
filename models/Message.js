const mongoose = require('mongoose');
const MessageSchema = new mongoose.Schema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  fromEmail: { type: String, required: true },
  toEmail: { type: String },
  subject: { type: String, default: '' },
  body: { type: String, required: true },
  read: { type: Boolean, default: false, index: true },
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', index: true },
  createdAt: { type: Date, default: Date.now, index: true }
});
module.exports = mongoose.model('Message', MessageSchema);
