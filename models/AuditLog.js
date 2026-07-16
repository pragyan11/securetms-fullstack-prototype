const mongoose = require('mongoose');
const AuditLogSchema = new mongoose.Schema({
  userEmail: String,
  action: String,
  details: String,
  ipAddress: String,
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('AuditLog', AuditLogSchema);
