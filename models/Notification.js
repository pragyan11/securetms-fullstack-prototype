const mongoose = require('mongoose');

/**
 * Persisted in-app notification. Created by services/notify.js whenever a
 * user-relevant event happens (booking/shipment/status/maintenance/etc).
 * Replaces the ephemeral socket-only notification panel on the dashboards:
 * notifications now survive reloads and can be marked read.
 */
const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  type: { type: String, default: 'info' }, // info | success | warn | error
  link: { type: String, default: '' },     // relative route, e.g. /dashboard.html#shipments
  data: { type: mongoose.Schema.Types.Mixed },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true }
});

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
