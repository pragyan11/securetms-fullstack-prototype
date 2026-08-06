'use strict';

/**
 * Unified notification fan-out:
 *   1. Persist an in-app Notification for the recipient (when a User exists)
 *   2. Emit a socket event `notification:new` to the user's room
 *   3. Hand the same event to the webhook dispatcher for external systems
 *
 * Used by routes/bookings, routes/shipments, routes/maintenance,
 * routes/messages and auth flows.
 */

const User = require('../models/User');
const Notification = require('../models/Notification');
const webhooks = require('./webhooks');

/**
 * @param {string|object} recipient  user email (string) or { _id, email } object
 * @param {object} opts  { title, body, type, link, event, data, io }
 */
async function notifyUser(recipient, opts) {
  const title = opts.title || 'Notification';
  const event = opts.event || 'notification';
  try {
    let user = recipient;
    if (typeof recipient === 'string') {
      user = await User.findOne({ email: recipient.toLowerCase().trim() }).select('_id email');
    }
    if (!user || !user._id) return null;

    const notif = await Notification.create({
      userId: user._id,
      title,
      body: opts.body || '',
      type: opts.type || 'info',
      link: opts.link || '',
      data: opts.data || null
    });

    // Live push to any connected client of this user.
    if (opts.io) {
      const room = 'user:' + String(user._id);
      opts.io.to(room).emit('notification:new', {
        _id: notif._id,
        title: notif.title,
        body: notif.body,
        type: notif.type,
        link: notif.link,
        createdAt: notif.createdAt
      });
    }

    // External integrations.
    webhooks.dispatch(event, {
      title: notif.title,
      body: notif.body,
      type: notif.type,
      link: notif.link,
      userId: String(user._id),
      userEmail: user.email,
      data: opts.data || null
    }).catch(() => {});

    return notif;
  } catch (_e) {
    // Notifications are best-effort — never break the primary action.
    return null;
  }
}

/** Notify every user with the given role (e.g. all Admins). */
async function notifyRole(role, opts) {
  try {
    const users = await User.find({ role }).select('_id email').limit(100);
    for (const u of users) {
      await notifyUser(u, opts);
    }
  } catch (_e) { /* best-effort */ }
}

module.exports = { notifyUser, notifyRole };
