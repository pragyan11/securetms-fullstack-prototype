const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Shipment = require('../models/Shipment');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const emailService = require('../services/email');
const notify = require('../services/notify');
const webhooks = require('../services/webhooks');
const { canShipmentTransition } = require('../services/statusTransitions');
const router = express.Router();

router.use(auth);

// Role-scoped filter builder shared by GET / and stats
async function scopeFilter(req) {
  const filter = {};
  if (req.user.role === 'Customer') {
    const bookingIds = await Booking.find({ userId: req.user.id }).distinct('_id');
    filter.bookingId = { $in: bookingIds };
  } else if (req.user.role === 'Driver') {
    const $or = [{ driverEmail: req.user.email }];
    if (req.user.name) $or.push({ driverName: req.user.name });
    filter.$or = $or;
  }
  return filter;
}

// GET with search, sort, filter, pagination
router.get('/', async (req, res) => {
  try {
    const filter = await scopeFilter(req);
    const { search, status, vehicle, sort, order, page, limit } = req.query;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const searchOr = [
        { trackingId: re }, { customerName: re }, { driverName: re },
        { pickupAddress: re }, { deliveryAddress: re }, { vehicleNumber: re }
      ];
      filter.$and = (filter.$and || []).concat([{ $or: searchOr }]);
    }
    if (status) filter.status = status;
    if (vehicle) filter.vehicleNumber = new RegExp(vehicle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const sortField = sort || 'updatedAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [shipments, total] = await Promise.all([
      Shipment.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(limitNum),
      Shipment.countDocuments(filter)
    ]);

    res.json({ data: shipments, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Export CSV (optionally filtered by from/to date range)
router.get('/export', async (req, res) => {
  try {
    const filter = await scopeFilter(req);
    const { from, to } = req.query;
    const range = {};
    if (from) {
      const d = new Date(from + 'T00:00:00.000Z');
      if (isNaN(d)) return res.status(400).json({ message: 'Invalid "from" date' });
      range.$gte = d;
    }
    if (to) {
      const d = new Date(to + 'T23:59:59.999Z');
      if (isNaN(d)) return res.status(400).json({ message: 'Invalid "to" date' });
      range.$lte = d;
    }
    if (from || to) filter.updatedAt = range;

    const shipments = await Shipment.find(filter).sort({ updatedAt: -1 }).lean();
    const header = 'Tracking ID,Customer,Pickup,Delivery,Vehicle,Driver,Status,ETA,Location,Updated\n';
    const rows = shipments.map(s =>
      `"${s.trackingId}","${s.customerName || ''}","${s.pickupAddress || ''}","${s.deliveryAddress || ''}","${s.vehicleNumber || ''}","${s.driverName || ''}","${s.status}","${s.eta || ''}","${s.currentLocation || ''}","${s.updatedAt}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    const rangeLabel = (from || to) ? `_${from || 'start'}_${to || 'now'}` : '';
    res.setHeader('Content-Disposition', `attachment; filename=shipments${rangeLabel}.csv`);
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Stats
router.get('/stats', async (req, res) => {
  try {
    const filter = await scopeFilter(req);
    const [total, byStatus] = await Promise.all([
      Shipment.countDocuments(filter),
      Shipment.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);
    const counts = {};
    (byStatus || []).forEach(g => { counts[g._id] = g.count; });
    const terminal = (counts['Delivered'] || 0) + (counts['Cancelled'] || 0);
    res.json({
      total,
      active: Math.max(0, total - terminal),
      inTransit: (counts['In Transit'] || 0) + (counts['Picked Up'] || 0),
      byStatus
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Single shipment (role-scoped) — deliberately defined AFTER /export and
// /stats so those literal paths aren't swallowed by this :id route.
router.get('/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (req.user.role === 'Customer') {
      const bookingIds = await Booking.find({ userId: req.user.id }).distinct('_id');
      if (!shipment.bookingId || !bookingIds.map(String).includes(String(shipment.bookingId))) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    } else if (req.user.role === 'Driver') {
      if (shipment.driverEmail !== req.user.email && shipment.driverName !== req.user.name) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    }
    res.json(shipment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post(
  '/',
  [
    body('trackingId').optional().trim().escape(),
    body('shipmentId').optional().trim().escape(),
    body('vehicleNumber').optional().trim().escape(),
    body('driverName').optional().trim().escape(),
    body('driverEmail').optional().isEmail().normalizeEmail(),
    body('assignedDriverId').optional().isString(),
    body('bookingId').optional().isString(),
    body('customerId').optional().isString(),
    body('pickupAddress').optional().trim().escape(),
    body('deliveryAddress').optional().trim().escape(),
    body('customerName').optional().trim().escape(),
    body('customerEmail').optional().isEmail().normalizeEmail(),
    body('status').optional().isIn(['Created', 'Picked Up', 'In Transit', 'Delivered', 'Cancelled']),
    body('currentLocation').optional().trim().escape(),
    body('eta').optional().trim().escape(),
    body('location').optional().trim().escape(),
    body('podSignature').optional().isString(),
    body('podPhoto').optional().isString(),
    body('podNotes').optional().trim().escape()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const {
        trackingId, shipmentId, vehicleNumber, driverName, driverEmail,
        assignedDriverId, bookingId, customerId, pickupAddress, deliveryAddress,
        customerName, customerEmail, status, currentLocation, eta, location, podSignature, podPhoto, podNotes
      } = req.body;

      const shipment = await Shipment.create({
        trackingId: trackingId || shipmentId || `TRK-${Date.now()}`,
        vehicleNumber, driverName, driverEmail,
        assignedDriverId: assignedDriverId && mongoose.isValidObjectId(assignedDriverId) ? assignedDriverId : undefined,
        bookingId: bookingId && mongoose.isValidObjectId(bookingId) ? bookingId : undefined,
        customerId: customerId && mongoose.isValidObjectId(customerId) ? customerId : undefined,
        pickupAddress: pickupAddress || (location && !deliveryAddress ? location : undefined),
        deliveryAddress, customerName, customerEmail: customerEmail || null,
        status: status || 'Created',
        currentLocation: currentLocation || location || 'Awaiting pickup',
        eta: eta || 'Pending',
        podSignature, podPhoto, podNotes,
        updatedAt: new Date()
      });

      await AuditLog.create({ userEmail: req.user.email, action: 'SHIPMENT_CREATE', details: `Created shipment ${shipment.trackingId}`, ipAddress: req.ip });

      if (req.io) {
        req.io.emit('shipment:created', shipment);
        req.io.emit('activity:new', { action: 'SHIPMENT_CREATE', userEmail: req.user.email, details: `Created shipment ${shipment.trackingId}`, createdAt: new Date() });
      }
      webhooks.dispatch('shipment.created', { trackingId: shipment.trackingId, status: shipment.status }).catch(() => {});

      try {
        if (shipment.customerEmail) emailService.notifyShipmentCreated(shipment, shipment.customerEmail).catch(() => {});
        if (shipment.driverEmail && shipment.driverEmail !== shipment.customerEmail) emailService.notifyDriverAssigned(shipment, shipment.driverEmail).catch(() => {});
        if (shipment.customerEmail) {
          const cust = await User.findOne({ email: shipment.customerEmail.toLowerCase() }).select('_id');
          if (cust) notify.notifyUser(cust, { title: 'Shipment confirmed', body: `${shipment.trackingId} · ${shipment.pickupAddress || ''} → ${shipment.deliveryAddress || ''}`, type: 'success', link: '/customer.html', event: 'shipment.created', io: req.io }).catch(() => {});
        }
        if (shipment.driverEmail) {
          const drv = await User.findOne({ email: shipment.driverEmail.toLowerCase() }).select('_id');
          if (drv) notify.notifyUser(drv, { title: 'New run assigned', body: `${shipment.trackingId} · ${shipment.pickupAddress || ''} → ${shipment.deliveryAddress || ''}`, type: 'info', link: '/driver.html', event: 'shipment.created', io: req.io }).catch(() => {});
        }
      } catch (_) { /* best-effort */ }

      res.status(201).json({ message: 'Shipment created', shipment });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════════════
   DISPATCH (D3) — assign a driver + vehicle to a shipment (admin only)
   ═══════════════════════════════════════════════════════════════════════════ */
router.post('/:id/assign', requireRole('Admin'), [
  body('driverEmail').optional().isEmail().normalizeEmail(),
  body('vehicleNumber').optional().trim().escape()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status === 'Delivered' || shipment.status === 'Cancelled') {
      return res.status(400).json({ message: 'Cannot assign a finished shipment.' });
    }
    const { driverEmail, vehicleNumber } = req.body;

    let driver = null;
    if (driverEmail) {
      driver = await User.findOne({ email: driverEmail.toLowerCase().trim(), role: 'Driver' });
      if (!driver) return res.status(400).json({ message: 'No driver account found for that email.' });
    }
    let vehicle = null;
    if (vehicleNumber) {
      vehicle = await Vehicle.findOne({ vehicleNumber });
      if (!vehicle) return res.status(400).json({ message: 'No vehicle found with that number.' });
    }

    if (driver) {
      shipment.assignedDriverId = driver._id;
      shipment.driverEmail = driver.email;
      shipment.driverName = driver.name || driver.email;
    }
    if (vehicle) {
      shipment.vehicleNumber = vehicle.vehicleNumber;
    }
    if (driver || vehicle) {
      shipment.dispatchedAt = shipment.dispatchedAt || new Date();
      if (shipment.status === 'Created') shipment.status = 'Picked Up';
      shipment.updatedAt = new Date();
      await shipment.save();

      // Reflect assignment on the vehicle.
      if (vehicle) {
        vehicle.driverName = driver ? driver.name : vehicle.driverName;
        vehicle.status = 'In Transit';
        await vehicle.save().catch(() => {});
      }

      await AuditLog.create({ userEmail: req.user.email, action: 'SHIPMENT_ASSIGN', details: `Assigned ${shipment.trackingId} → ${driver ? driver.name : vehicleNumber || ''}`, ipAddress: req.ip });
      if (req.io) {
        req.io.emit('shipment:updated', shipment);
        req.io.emit('activity:new', { action: 'SHIPMENT_ASSIGN', userEmail: req.user.email, details: `Dispatched ${shipment.trackingId}`, createdAt: new Date() });
      }
      webhooks.dispatch('shipment.updated', { trackingId: shipment.trackingId, status: shipment.status }).catch(() => {});

      try {
        if (driver) {
          emailService.notifyDriverAssigned(shipment, driver.email).catch(() => {});
          notify.notifyUser(driver, { title: 'Run dispatched to you', body: `${shipment.trackingId} · ${shipment.pickupAddress || ''} → ${shipment.deliveryAddress || ''}`, type: 'info', link: '/driver.html', event: 'shipment.updated', io: req.io }).catch(() => {});
        }
        if (shipment.customerEmail) {
          const cust = await User.findOne({ email: shipment.customerEmail.toLowerCase() }).select('_id');
          if (cust) notify.notifyUser(cust, { title: 'Your shipment is on its way', body: `${shipment.trackingId} · Driver: ${shipment.driverName || 'TBD'} · ${shipment.vehicleNumber || ''}`, type: 'success', link: '/customer.html', event: 'shipment.updated', io: req.io }).catch(() => {});
        }
      } catch (_) { /* best-effort */ }
    }

    res.json({ message: 'Shipment assigned', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   MULTI-STOP (C4) — admin manages stops
   ═══════════════════════════════════════════════════════════════════════════ */
router.put('/:id/stops', requireRole('Admin'), [
  body('stops').isArray(),
  body('stops.*.address').notEmpty().trim().escape(),
  body('stops.*.status').optional().isIn(['Pending', 'Visited', 'Skipped']),
  body('stops.*.sequence').optional().isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    shipment.stops = req.body.stops.map((s, i) => ({
      address: s.address,
      status: s.status || 'Pending',
      sequence: s.sequence != null ? s.sequence : i + 1
    }));
    shipment.updatedAt = new Date();
    await shipment.save();
    await AuditLog.create({ userEmail: req.user.email, action: 'SHIPMENT_STOPS', details: `Updated stops on ${shipment.trackingId}`, ipAddress: req.ip });
    res.json({ message: 'Stops updated', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/status', [
  body('status').optional().isIn(['Created', 'Picked Up', 'In Transit', 'Delivered', 'Cancelled']),
  body('currentLocation').optional().trim().escape(),
  body('eta').optional().trim().escape(),
  body('podSignature').optional().isString(),
  body('podPhoto').optional().isString(),
  body('podNotes').optional().trim().escape(),
  body('podTimestamp').optional(),
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('ratingComment').optional().trim().escape().isLength({ max: 500 }),
  body('cancelReason').optional().trim().escape().isLength({ max: 300 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const isDriver = req.user.role === 'Driver' && (shipment.driverEmail === req.user.email || shipment.driverName === req.user.name);

    // Rating: the owning customer may rate a delivered shipment (C2 fix).
    if (req.body.rating !== undefined) {
      if (shipment.status !== 'Delivered') return res.status(400).json({ message: 'Shipments can only be rated after delivery.' });
      const bookingIds = await Booking.find({ userId: req.user.id }).distinct('_id');
      const ownsShipment = shipment.bookingId && bookingIds.map(String).includes(String(shipment.bookingId));
      if (req.user.role !== 'Admin' && !ownsShipment) return res.status(403).json({ message: 'Only the customer of this shipment can rate it.' });
      shipment.rating = req.body.rating;
      shipment.ratingComment = req.body.ratingComment || shipment.ratingComment;
      shipment.updatedAt = new Date();
      await shipment.save();
      await AuditLog.create({ userEmail: req.user.email, action: 'SHIPMENT_RATING', details: `Rated ${shipment.trackingId} ${shipment.rating}★`, ipAddress: req.ip });
      return res.json({ message: 'Rating submitted', shipment });
    }

    // Status updates: admin or assigned driver only.
    if (req.user.role !== 'Admin' && req.user.role !== 'Driver') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (req.user.role === 'Driver' && !isDriver) {
      return res.status(403).json({ message: 'You can only update shipments assigned to you' });
    }

    const previousStatus = shipment.status;
    if (req.body.status) {
      if (!canShipmentTransition(previousStatus, req.body.status)) {
        return res.status(400).json({ message: `Cannot move a ${previousStatus} shipment to ${req.body.status}.` });
      }
      shipment.status = req.body.status;
      if (req.body.status === 'Delivered') {
        shipment.deliveredAt = shipment.deliveredAt || new Date();
        shipment.podTimestamp = shipment.podTimestamp || new Date();
      }
      if (req.body.status === 'Cancelled') {
        shipment.cancelledAt = shipment.cancelledAt || new Date();
        shipment.cancelReason = req.body.cancelReason || shipment.cancelReason || 'Not specified';
      }
    }
    if (req.body.currentLocation) shipment.currentLocation = req.body.currentLocation;
    if (req.body.eta) shipment.eta = req.body.eta;
    if (req.body.podSignature !== undefined) shipment.podSignature = req.body.podSignature;
    if (req.body.podPhoto !== undefined) shipment.podPhoto = req.body.podPhoto;
    if (req.body.podNotes !== undefined) shipment.podNotes = req.body.podNotes;
    if (req.body.podTimestamp) shipment.podTimestamp = req.body.podTimestamp;
    shipment.updatedAt = new Date();
    await shipment.save();

    await AuditLog.create({ userEmail: req.user.email, action: 'SHIPMENT_UPDATE', details: `Updated shipment ${shipment.trackingId} → ${shipment.status}`, ipAddress: req.ip });

    if (req.io) {
      req.io.emit('shipment:updated', shipment);
      req.io.emit('activity:new', { action: 'SHIPMENT_UPDATE', userEmail: req.user.email, details: `Updated shipment ${shipment.trackingId}`, createdAt: new Date() });
    }

    const statusChanged = previousStatus !== shipment.status;
    webhooks.dispatch(statusChanged ? (shipment.status === 'Delivered' ? 'shipment.delivered' : shipment.status === 'Cancelled' ? 'shipment.cancelled' : 'shipment.updated') : 'shipment.updated', { trackingId: shipment.trackingId, status: shipment.status }).catch(() => {});

    // ── B1: status-change + delivery emails (previously dead code) ──
    try {
      const recipients = [];
      if (shipment.customerEmail) recipients.push(shipment.customerEmail);
      if (shipment.driverEmail && shipment.driverEmail !== shipment.customerEmail) recipients.push(shipment.driverEmail);
      if (statusChanged) {
        recipients.forEach(email => emailService.notifyStatusChange(shipment, email).catch(() => {}));
        if (shipment.status === 'Delivered') {
          const admins = await User.find({ role: 'Admin' }).select('email').limit(10);
          const adminEmails = admins.map(a => a.email);
          emailService.notifyDeliveryConfirmed(shipment, shipment.customerEmail, adminEmails.join(', ')).catch(() => {});
        }
      }
      // Persisted in-app notifications.
      const cust = shipment.customerEmail ? await User.findOne({ email: shipment.customerEmail.toLowerCase() }).select('_id') : null;
      const drv = shipment.driverEmail ? await User.findOne({ email: shipment.driverEmail.toLowerCase() }).select('_id') : null;
      if (cust) {
        notify.notifyUser(cust, {
          title: statusChanged ? `Shipment ${shipment.status.toLowerCase()}` : 'Shipment updated',
          body: `${shipment.trackingId} · ${shipment.currentLocation || ''}${shipment.eta ? ' · ETA ' + shipment.eta : ''}`,
          type: shipment.status === 'Delivered' ? 'success' : shipment.status === 'Cancelled' ? 'error' : 'info',
          link: '/customer.html',
          event: statusChanged ? (shipment.status === 'Delivered' ? 'shipment.delivered' : 'shipment.updated') : 'shipment.updated',
          io: req.io
        }).catch(() => {});
      }
      if (drv) {
        notify.notifyUser(drv, {
          title: statusChanged ? `Shipment ${shipment.status.toLowerCase()}` : 'Shipment updated',
          body: `${shipment.trackingId} · ${shipment.currentLocation || ''}`,
          type: 'info',
          link: '/driver.html',
          event: 'shipment.updated',
          io: req.io
        }).catch(() => {});
      }
    } catch (_) { /* best-effort */ }

    res.json({ message: 'Shipment updated', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Forbidden' });
    Object.assign(shipment, req.body, { updatedAt: new Date() });
    await shipment.save();
    await AuditLog.create({ userEmail: req.user.email, action: 'SHIPMENT_UPDATE', details: `Updated shipment ${shipment.trackingId}`, ipAddress: req.ip });
    if (req.io) {
      req.io.emit('shipment:updated', shipment);
      req.io.emit('activity:new', { action: 'SHIPMENT_UPDATE', userEmail: req.user.email, details: `Updated shipment ${shipment.trackingId}`, createdAt: new Date() });
    }
    res.json({ message: 'Shipment updated', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Forbidden' });
    const shipment = await Shipment.findByIdAndDelete(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    await AuditLog.create({ userEmail: req.user.email, action: 'SHIPMENT_DELETE', details: `Deleted shipment ${shipment.trackingId}`, ipAddress: req.ip });
    if (req.io) {
      req.io.emit('shipment:deleted', req.params.id);
      req.io.emit('activity:new', { action: 'SHIPMENT_DELETE', userEmail: req.user.email, details: `Deleted shipment ${shipment.trackingId}`, createdAt: new Date() });
    }
    res.json({ message: 'Shipment deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
