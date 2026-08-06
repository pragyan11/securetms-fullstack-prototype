const mongoose = require('mongoose');

/**
 * Simple key/value store for admin-configurable platform settings
 * (service zones, base rates, priority multipliers, branding footer, etc).
 * Values are arbitrary JSON — validated/coerced by routes/admin.js before
 * being written.
 */
const SettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Setting', SettingSchema);
