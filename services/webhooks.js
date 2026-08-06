'use strict';

/**
 * Outgoing webhook dispatcher.
 *
 * POSTs JSON to every enabled Webhook subscribed to the given event.
 * Payloads are signed with HMAC-SHA256 (X-SpeedX-Signature header) when a
 * webhook has a `secret`. Fire-and-forget: failures are recorded on the
 * webhook document and never block the primary request.
 */

const crypto = require('crypto');
const Webhook = require('../models/Webhook');
const logger = require('../lib/logger');

const EVENT_TYPES = [
  'user.registered', 'user.verified',
  'booking.created', 'booking.updated', 'booking.cancelled', 'booking.rescheduled',
  'shipment.created', 'shipment.updated', 'shipment.delivered', 'shipment.cancelled',
  'vehicle.created', 'vehicle.updated', 'vehicle.deleted',
  'maintenance.created', 'message.sent', 'notification'
];

async function dispatch(event, payload) {
  try {
    const hooks = await Webhook.find({ enabled: true, events: event }).lean();
    if (!hooks.length) return;
    const body = JSON.stringify({ event, payload, sentAt: new Date().toISOString() });
    await Promise.all(hooks.map(hook => sendOne(hook, event, body)));
  } catch (_e) { /* best-effort */ }
}

async function sendOne(hook, event, body) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'SpeedX-Webhook/1.0' };
  if (hook.secret) {
    headers['X-SpeedX-Signature'] = 'sha256=' + crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(hook.url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timer);
    const status = res.status;
    await Webhook.updateOne({ _id: hook._id }, {
      $set: { lastStatus: status, lastError: status >= 400 ? ('HTTP ' + status) : null, lastSentAt: new Date() }
    });
  } catch (err) {
    logger.warn('[webhooks] delivery failed for ' + hook.url + ': ' + (err && err.message));
    await Webhook.updateOne({ _id: hook._id }, {
      $set: { lastStatus: 0, lastError: (err && err.message) || 'delivery failed', lastSentAt: new Date() }
    });
  }
}

module.exports = { dispatch, EVENT_TYPES };
