const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Shipment = require('../models/Shipment');
const Vehicle = require('../models/Vehicle');
const AuditLog = require('../models/AuditLog');
const Setting = require('../models/Setting');
const Webhook = require('../models/Webhook');
const webhooksService = require('../services/webhooks');
const { DEFAULT_ZONES, DEFAULT_SETTINGS } = require('../services/quote');
const router = express.Router();

router.use(auth, requireRole('Admin'));

router.get('/dashboard', async (req, res) => {
  try {
    const [users, bookings, shipments, vehicles] = await Promise.all([
      User.countDocuments(),
      Booking.countDocuments(),
      Shipment.countDocuments(),
      Vehicle.countDocuments()
    ]);

    const bookingsByStatus = await Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const shipmentsByStatus = await Shipment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const vehiclesByStatus = await Vehicle.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);

    res.json({ users, bookings, shipments, vehicles, bookingsByStatus, shipmentsByStatus, vehiclesByStatus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ── Users: paginated + searchable (D1) ─────────────────────────── */
router.get('/users', async (req, res) => {
  try {
    const { search, role, page, limit } = req.query;
    const filter = {};
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { email: re }];
    }
    if (role) filter.role = role;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).select('-credentials -recoveryCodes -publicKey -credentialPublicKey'),
      User.countDocuments(filter)
    ]);
    res.json({ data: users, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const VALID_ROLES = ['Admin', 'Customer', 'Driver'];

router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Name is required' });
      updates.name = name.trim();
    }
    if (email !== undefined) {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ message: 'A valid email is required' });
      }
      const cleanEmail = email.trim().toLowerCase();
      const clash = await User.findOne({ email: cleanEmail, _id: { $ne: req.params.id } });
      if (clash) return res.status(400).json({ message: 'That email is already in use' });
      updates.email = cleanEmail;
      // A changed email must be re-verified.
      updates.emailVerified = false;
    }
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
      updates.role = role;
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'Nothing to update' });

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (updates.role && updates.role !== 'Admin' && target.role === 'Admin') {
      if (String(target._id) === String(req.user.id)) return res.status(400).json({ message: 'You cannot change your own role' });
      const adminCount = await User.countDocuments({ role: 'Admin' });
      if (adminCount <= 1) return res.status(400).json({ message: 'Cannot demote the last admin' });
    }

    Object.assign(target, updates);
    await target.save();

    await AuditLog.create({ userEmail: req.user.email, action: 'USER_UPDATE', details: `Updated user ${target.email} (role: ${target.role})`, ipAddress: req.ip });
    res.json(target);
  } catch (err) {
    if (err && err.code === 11000) return res.status(400).json({ message: 'That email is already in use' });
    res.status(500).json({ message: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (String(target._id) === String(req.user.id)) return res.status(400).json({ message: 'You cannot delete your own account' });
    if (target.role === 'Admin') {
      const adminCount = await User.countDocuments({ role: 'Admin' });
      if (adminCount <= 1) return res.status(400).json({ message: 'Cannot delete the last admin' });
    }

    await User.findByIdAndDelete(req.params.id);
    await AuditLog.create({ userEmail: req.user.email, action: 'USER_DELETE', details: `Deleted user ${target.email} (role: ${target.role})`, ipAddress: req.ip });
    res.json({ message: 'User deleted', deleted: { id: target._id, email: target.email } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: 'email query required' });
    const logs = await AuditLog.find({ userEmail: email }).sort({ createdAt: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ── Analytics depth (D6) ───────────────────────────────────────── */
router.get('/analytics', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
      if (to) filter.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
    }
    const shipmentFilter = {};
    if (from || to) {
      shipmentFilter.updatedAt = {};
      if (from) shipmentFilter.updatedAt.$gte = new Date(from + 'T00:00:00.000Z');
      if (to) shipmentFilter.updatedAt.$lte = new Date(to + 'T23:59:59.999Z');
    }

    const [bookings, shipments, vehicles, revenueAgg, bookingsByDay, revenueByDay, topRoutes, onTime] = await Promise.all([
      Booking.countDocuments(filter),
      Shipment.countDocuments(shipmentFilter),
      Vehicle.countDocuments(),
      Booking.aggregate([
        { $match: { price: { $gt: 0 }, paymentStatus: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$price' }, count: { $sum: 1 } } }
      ]),
      Booking.aggregate([
        { $match: filter },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      Booking.aggregate([
        { $match: { ...filter, price: { $gt: 0 }, paymentStatus: 'Paid' } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$price' } } },
        { $sort: { _id: 1 } }
      ]),
      Booking.aggregate([
        { $match: filter },
        { $group: { _id: { route: { $concat: ['$origin', ' → ', '$destination'] } }, count: { $sum: 1 }, revenue: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, { $ifNull: ['$price', 0] }, 0] } } } },
        { $sort: { count: -1 } },
        { $limit: 8 }
      ]),
      Shipment.aggregate([
        { $match: shipmentFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const statusMap = {};
    (onTime || []).forEach(s => { statusMap[s._id] = s.count; });
    const delivered = statusMap['Delivered'] || 0;
    const totalShipped = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const onTimeRate = totalShipped > 0 ? Math.round((delivered / totalShipped) * 100) : 0;

    // Fleet utilization: shipments per vehicle in the window.
    const utilization = await Shipment.aggregate([
      { $match: shipmentFilter },
      { $match: { vehicleNumber: { $ne: null } } },
      { $group: { _id: '$vehicleNumber', shipments: { $sum: 1 } } },
      { $sort: { shipments: -1 } },
      { $limit: 8 }
    ]);

    res.json({
      bookings,
      shipments,
      vehicles,
      revenue: (revenueAgg[0] && revenueAgg[0].total) || 0,
      paidInvoices: (revenueAgg[0] && revenueAgg[0].count) || 0,
      bookingsByDay: bookingsByDay.map(d => ({ day: d._id, count: d.count })),
      revenueByDay: revenueByDay.map(d => ({ day: d._id, revenue: d.revenue })),
      topRoutes: topRoutes.map(r => ({ route: r._id.route, count: r.count, revenue: r.revenue })),
      shipmentsByStatus: onTime,
      onTimeRate,
      utilization: utilization.map(u => ({ vehicle: u._id, shipments: u.shipments }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ── Settings (D5) ──────────────────────────────────────────────── */
const SETTING_SCHEMA = {
  serviceZones: { type: 'array', default: DEFAULT_ZONES },
  quote: { type: 'object', default: { baseRate: 25, ratePerKm: 0.9, priorityMultipliers: { Standard: 1, Express: 1.5, Priority: 2 } } },
  currency: { type: 'string', default: 'USD' },
  orgName: { type: 'string', default: 'SpeedX' }
};

router.get('/settings', async (req, res) => {
  try {
    const rows = await Setting.find().lean();
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    const merged = {};
    Object.keys(SETTING_SCHEMA).forEach(k => {
      merged[k] = map[k] !== undefined ? map[k] : SETTING_SCHEMA[k].default;
    });
    merged._schema = Object.keys(SETTING_SCHEMA);
    res.json(merged);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = Object.keys(SETTING_SCHEMA);
    const updates = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      const schema = SETTING_SCHEMA[key];
      const value = req.body[key];
      if (schema.type === 'array' && !Array.isArray(value)) return res.status(400).json({ message: `${key} must be an array` });
      if (schema.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) return res.status(400).json({ message: `${key} must be an object` });
      if (schema.type === 'string' && typeof value !== 'string') return res.status(400).json({ message: `${key} must be a string` });
      updates.push(Setting.updateOne(
        { key },
        { $set: { value, updatedBy: req.user.email, updatedAt: new Date() } },
        { upsert: true }
      ));
    }
    await Promise.all(updates);
    await AuditLog.create({ userEmail: req.user.email, action: 'SETTINGS_UPDATE', details: 'Platform settings updated', ipAddress: req.ip });
    res.json({ message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ── Webhooks (B3) ──────────────────────────────────────────────── */
router.get('/webhooks', async (req, res) => {
  try {
    const hooks = await Webhook.find().sort({ createdAt: -1 }).lean();
    res.json({ data: hooks, eventTypes: webhooksService.EVENT_TYPES });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/webhooks', async (req, res) => {
  try {
    const { url, secret, events, enabled, description } = req.body;
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ message: 'A valid http(s) URL is required.' });
    const cleanEvents = (Array.isArray(events) ? events : []).filter(e => webhooksService.EVENT_TYPES.includes(e));
    if (!cleanEvents.length) return res.status(400).json({ message: 'Select at least one event.' });
    const hook = await Webhook.create({ url, secret: secret || '', events: cleanEvents, enabled: enabled !== false, description: description || '' });
    await AuditLog.create({ userEmail: req.user.email, action: 'WEBHOOK_CREATE', details: `Webhook added: ${url}`, ipAddress: req.ip });
    res.status(201).json(hook);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/webhooks/:id', async (req, res) => {
  try {
    const hook = await Webhook.findById(req.params.id);
    if (!hook) return res.status(404).json({ message: 'Webhook not found' });
    const { url, secret, events, enabled, description } = req.body;
    if (url !== undefined) {
      if (!/^https?:\/\//.test(url)) return res.status(400).json({ message: 'A valid http(s) URL is required.' });
      hook.url = url;
    }
    if (secret !== undefined) hook.secret = secret;
    if (events !== undefined) hook.events = (Array.isArray(events) ? events : []).filter(e => webhooksService.EVENT_TYPES.includes(e));
    if (enabled !== undefined) hook.enabled = !!enabled;
    if (description !== undefined) hook.description = description;
    await hook.save();
    await AuditLog.create({ userEmail: req.user.email, action: 'WEBHOOK_UPDATE', details: `Webhook updated: ${hook.url}`, ipAddress: req.ip });
    res.json(hook);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/webhooks/:id', async (req, res) => {
  try {
    const hook = await Webhook.findByIdAndDelete(req.params.id);
    if (!hook) return res.status(404).json({ message: 'Webhook not found' });
    await AuditLog.create({ userEmail: req.user.email, action: 'WEBHOOK_DELETE', details: `Webhook removed: ${hook.url}`, ipAddress: req.ip });
    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
