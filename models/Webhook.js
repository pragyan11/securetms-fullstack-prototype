const mongoose = require('mongoose');

/**
 * Outgoing webhook endpoint. When enabled and subscribed to an event,
 * services/webhooks.js POSTs a JSON payload to `url` as events happen —
 * the lightweight "external integration" surface (SMS/push providers can
 * subscribe to the same events without touching SpeedX internals).
 */
const WebhookSchema = new mongoose.Schema({
  url: { type: String, required: true },
  secret: { type: String, default: '' },      // optional HMAC signing secret (sent as X-SpeedX-Signature)
  events: { type: [String], default: [] },    // e.g. ['booking.created', 'shipment.updated']
  enabled: { type: Boolean, default: true },
  description: { type: String, default: '' },
  lastStatus: { type: Number },               // last HTTP status
  lastError: { type: String },
  lastSentAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Webhook', WebhookSchema);
