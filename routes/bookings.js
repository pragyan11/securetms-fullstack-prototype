const express = require('express');
const { body, validationResult } = require('express-validator');
const Booking = require('../models/Booking');
const Shipment = require('../models/Shipment');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const emailService = require('../services/email');
const notify = require('../services/notify');
const webhooks = require('../services/webhooks');
const { computeQuote, estimateDistanceKm, makeInvoiceNumber } = require('../services/quote');
const { canBookingTransition } = require('../services/statusTransitions');
const User = require('../models/User');
const router = express.Router();

router.use(auth);

// GET with search, sort, filter, pagination
router.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'Customer' ? { userId: req.user.id } : {};
    const { search, status, zone, sort, order, page, limit } = req.query;

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ customerName: re }, { origin: re }, { destination: re }];
    }
    if (status) filter.status = status;
    if (zone) filter.serviceZone = zone;

    const sortField = sort || 'createdAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(limitNum),
      Booking.countDocuments(filter)
    ]);

    res.json({ data: bookings, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Live price estimate (Phase C3)
router.post('/quote', [
  body('serviceZone').optional().isIn(['North', 'South', 'East', 'West', 'Central', 'Downtown']),
  body('priority').optional().isIn(['Standard', 'Express', 'Priority']),
  body('distanceKm').optional().isNumeric(),
  body('weightKg').optional().isNumeric()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { serviceZone, priority, distanceKm, weightKg } = req.body;
    const quote = await computeQuote({
      serviceZone: serviceZone || 'Central',
      priority: priority || 'Standard',
      distanceKm: distanceKm || estimateDistanceKm(req.body.origin || '', req.body.destination || ''),
      weightKg
    });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Export CSV (optionally filtered by from/to date range)
router.get('/export', async (req, res) => {
  try {
    const filter = req.user.role === 'Customer' ? { userId: req.user.id } : {};
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
    if (from || to) filter.createdAt = range;

    const bookings = await Booking.find(filter).sort({ createdAt: -1 }).lean();
    const header = 'ID,Invoice,Customer,Origin,Destination,Status,Zone,Price,Payment,Created\n';
    const rows = bookings.map(b =>
      `"${b._id}","${b.invoiceNumber || ''}","${b.customerName || ''}","${b.origin || ''}","${b.destination || ''}","${b.status || ''}","${b.serviceZone || ''}","${b.price || ''}","${b.paymentStatus || ''}","${b.createdAt || ''}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    const rangeLabel = (from || to) ? `_${from || 'start'}_${to || 'now'}` : '';
    res.setHeader('Content-Disposition', `attachment; filename=bookings${rangeLabel}.csv`);
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Stats for analytics
router.get('/stats', async (req, res) => {
  try {
    const filter = req.user.role === 'Customer' ? { userId: req.user.id } : {};
    const [total, byStatus, byZone] = await Promise.all([
      Booking.countDocuments(filter),
      Booking.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Booking.aggregate([{ $match: filter }, { $group: { _id: '$serviceZone', count: { $sum: 1 } } }])
    ]);
    res.json({ total, byStatus, byZone });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post(
  '/',
  [
    body('customerName').optional().trim().escape(),
    body('customerEmail').optional().isEmail().normalizeEmail(),
    body('origin').notEmpty().trim().escape(),
    body('destination').notEmpty().trim().escape(),
    body('status').optional().isIn(['Pending', 'Confirmed', 'Completed', 'Cancelled', 'Rescheduled']),
    body('serviceZone').optional().trim().escape(),
    body('priority').optional().isIn(['Standard', 'Express', 'Priority']),
    body('requestedPickupDate').optional().isISO8601(),
    body('price').optional().isNumeric()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { customerName, customerEmail, origin, destination, status, serviceZone, priority, requestedPickupDate, price } = req.body;

      // Auto-price when not supplied (Phase C3).
      let finalPrice = price != null ? Number(price) : null;
      if (finalPrice == null) {
        const q = await computeQuote({
          serviceZone: serviceZone || 'Central',
          priority: priority || 'Standard',
          distanceKm: estimateDistanceKm(origin, destination)
        });
        finalPrice = q.price;
      }

      const booking = await Booking.create({
        userId: req.user.id,
        customerName: customerName || req.user.name,
        customerEmail: customerEmail || null,
        origin, destination,
        status: status || 'Pending',
        serviceZone: serviceZone || 'Central',
        priority: priority || 'Standard',
        requestedPickupDate: requestedPickupDate ? new Date(requestedPickupDate) : undefined,
        price: finalPrice
      });

      // Invoice number after create (id exists).
      booking.invoiceNumber = makeInvoiceNumber(booking._id);
      await booking.save();

      let shipment = null;
      try {
        const attach = req.app.get('attachSkeletonShipment');
        if (typeof attach === 'function') shipment = await attach(booking);
      } catch (e) { console.warn('[bookings] attachSkeletonShipment failed:', e && e.message); }

      await AuditLog.create({ userEmail: req.user.email, action: 'BOOKING_CREATE', details: `${origin} -> ${destination}`, ipAddress: req.ip });

      if (req.io) {
        req.io.emit('booking:created', booking);
        if (shipment) req.io.emit('shipment:created', shipment);
        req.io.emit('activity:new', { action: 'BOOKING_CREATE', userEmail: req.user.email, details: `${origin} -> ${destination}`, createdAt: new Date() });
      }
      webhooks.dispatch('booking.created', { bookingId: String(booking._id), origin, destination, price: finalPrice }).catch(() => {});

      // Email confirmation + persisted in-app notification to the customer.
      try {
        const emailTarget = booking.customerEmail || req.user.email;
        if (emailTarget) emailService.notifyBookingCreated(booking, emailTarget).catch(() => {});
        const cust = await User.findOne({ email: (booking.customerEmail || req.user.email).toLowerCase() }).select('_id');
        if (cust) {
          notify.notifyUser(cust, {
            title: 'Booking confirmed',
            body: `${origin} → ${destination} · ${booking.invoiceNumber || ''}`,
            type: 'success',
            link: '/customer.html',
            event: 'booking.created',
            io: req.io
          }).catch(() => {});
        }
      } catch (_) { /* best-effort */ }

      res.status(201).json({ message: 'Booking created', booking, shipment: shipment || null });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// Status lifecycle: cancel / reschedule / complete (Phase C5) + payment updates
router.patch('/:id/status', [
  body('status').optional().isIn(['Pending', 'Confirmed', 'Completed', 'Cancelled', 'Rescheduled']),
  body('cancelReason').optional().trim().escape().isLength({ max: 300 }),
  body('rescheduleReason').optional().trim().escape().isLength({ max: 300 }),
  body('requestedPickupDate').optional().isISO8601(),
  body('paymentStatus').optional().isIn(['Unpaid', 'Paid', 'Refunded'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    const isOwner = String(booking.userId) === String(req.user.id);
    if (req.user.role !== 'Admin' && !isOwner) return res.status(403).json({ message: 'Forbidden' });

    const { status, cancelReason, rescheduleReason, requestedPickupDate, paymentStatus } = req.body;

    if (status && status !== booking.status) {
      if (!canBookingTransition(booking.status, status)) {
        return res.status(400).json({ message: `Cannot change a ${booking.status} booking to ${status}.` });
      }
      if (status === 'Cancelled') {
        if (!cancelReason) return res.status(400).json({ message: 'A cancel reason is required.' });
        booking.cancelReason = cancelReason;
        booking.cancelledAt = new Date();
      }
      if (status === 'Rescheduled') {
        if (!requestedPickupDate) return res.status(400).json({ message: 'A new pickup date is required to reschedule.' });
        booking.rescheduledTo = new Date(requestedPickupDate);
        booking.rescheduleReason = rescheduleReason || '';
        booking.requestedPickupDate = new Date(requestedPickupDate);
      }
      booking.status = status;
    }

    if (paymentStatus) {
      if (req.user.role !== 'Admin' && !(booking.paymentStatus === 'Unpaid' && paymentStatus === 'Paid')) {
        return res.status(403).json({ message: 'Only admins can change payment status.' });
      }
      booking.paymentStatus = paymentStatus;
      booking.paymentUpdatedAt = new Date();
    }

    await booking.save();

    await AuditLog.create({ userEmail: req.user.email, action: 'BOOKING_UPDATE', details: `Booking ${booking._id} → ${booking.status}`, ipAddress: req.ip });
    if (req.io) {
      req.io.emit('booking:updated', booking);
      req.io.emit('activity:new', { action: 'BOOKING_UPDATE', userEmail: req.user.email, details: `Updated booking ${req.params.id}`, createdAt: new Date() });
    }
    webhooks.dispatch(status === 'Cancelled' ? 'booking.cancelled' : (status === 'Rescheduled' ? 'booking.rescheduled' : 'booking.updated'), { bookingId: String(booking._id), status: booking.status }).catch(() => {});

    // Notify the customer of a cancellation / reschedule.
    if ((status === 'Cancelled' || status === 'Rescheduled') && booking.customerEmail) {
      const cust = await User.findOne({ email: booking.customerEmail.toLowerCase() }).select('_id');
      if (cust) {
        notify.notifyUser(cust, {
          title: status === 'Cancelled' ? 'Booking cancelled' : 'Booking rescheduled',
          body: status === 'Cancelled' ? (cancelReason || 'No reason given') : `New pickup: ${booking.requestedPickupDate ? booking.requestedPickupDate.toLocaleDateString() : 'TBD'}`,
          type: status === 'Cancelled' ? 'error' : 'info',
          link: '/customer.html',
          event: status === 'Cancelled' ? 'booking.cancelled' : 'booking.rescheduled',
          io: req.io
        }).catch(() => {});
      }
    }

    res.json({ message: 'Booking updated', booking });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (req.user.role !== 'Admin' && String(booking.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const updated = await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await AuditLog.create({ userEmail: req.user.email, action: 'BOOKING_UPDATE', details: `Updated booking ${req.params.id}`, ipAddress: req.ip });
    if (req.io) {
      req.io.emit('booking:updated', updated);
      req.io.emit('activity:new', { action: 'BOOKING_UPDATE', userEmail: req.user.email, details: `Updated booking ${req.params.id}`, createdAt: new Date() });
    }
    res.json({ message: 'Booking updated', booking: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (req.user.role !== 'Admin' && String(booking.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await Booking.findByIdAndDelete(req.params.id);
    await AuditLog.create({ userEmail: req.user.email, action: 'BOOKING_DELETE', details: `Deleted booking ${req.params.id}`, ipAddress: req.ip });
    if (req.io) {
      req.io.emit('booking:deleted', req.params.id);
      req.io.emit('activity:new', { action: 'BOOKING_DELETE', userEmail: req.user.email, details: `Deleted booking ${req.params.id}`, createdAt: new Date() });
    }
    res.json({ message: 'Booking deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
