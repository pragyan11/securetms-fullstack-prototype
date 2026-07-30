const express = require('express');
const { body, validationResult } = require('express-validator');
const Booking = require('../models/Booking');
const Shipment = require('../models/Shipment');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const emailService = require('../services/email');
const User = require('../models/User');
const router = express.Router();

router.use(auth);

// GET with search, sort, filter, pagination
router.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'Customer' ? { userId: req.user.id } : {};
    const { search, status, zone, sort, order, page, limit } = req.query;

    // Search: match customerName, origin, or destination
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { customerName: re },
        { origin: re },
        { destination: re }
      ];
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

// Export CSV
router.get('/export', async (req, res) => {
  try {
    const filter = req.user.role === 'Customer' ? { userId: req.user.id } : {};
    const bookings = await Booking.find(filter).sort({ createdAt: -1 }).lean();
    const header = 'ID,Customer,Origin,Destination,Status,Zone,Created\n';
    const rows = bookings.map(b =>
      `"${b._id}","${b.customerName || ''}","${b.origin || ''}","${b.destination || ''}","${b.status || ''}","${b.serviceZone || ''}","${b.createdAt || ''}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=bookings.csv');
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
    body('origin').notEmpty().trim().escape(),
    body('destination').notEmpty().trim().escape(),
    body('status').optional().isIn(['Pending', 'Confirmed', 'Completed']),
    body('serviceZone').optional().trim().escape(),
    body('priority').optional().isIn(['Standard', 'Express', 'Priority'])
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { customerName, origin, destination, status, serviceZone, priority } = req.body;
      const booking = await Booking.create({
        userId: req.user.id,
        customerName: customerName || req.user.name,
        origin, destination,
        status: status || 'Pending',
        serviceZone: serviceZone || 'Central',
        priority: priority || 'Standard'
      });

      let shipment = null;
      try {
        const attach = req.app.get('attachSkeletonShipment');
        if (typeof attach === 'function') shipment = await attach(booking);
      } catch (e) { console.warn('[bookings] attachSkeletonShipment failed:', e && e.message); }

      await AuditLog.create({
        userEmail: req.user.email, action: 'BOOKING_CREATE',
        details: `${origin} -> ${destination}`, ipAddress: req.ip
      });

      if (req.io) {
        req.io.emit('booking:created', booking);
        if (shipment) req.io.emit('shipment:created', shipment);
        req.io.emit('activity:new', { action: 'BOOKING_CREATE', userEmail: req.user.email, details: `${origin} -> ${destination}`, createdAt: new Date() });
      }

      // Send email notification
      try {
        const customer = await User.findById(req.user.id);
        if (customer && customer.email) {
          emailService.notifyBookingCreated(booking, customer.email).catch(() => {});
        }
      } catch (_) { /* email is best-effort */ }

      res.status(201).json({ message: 'Booking created', booking, shipment: shipment || null });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.put('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (req.user.role !== 'Admin' && String(booking.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const updated = await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await AuditLog.create({
      userEmail: req.user.email, action: 'BOOKING_UPDATE',
      details: `Updated booking ${req.params.id}`, ipAddress: req.ip
    });
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
    await AuditLog.create({
      userEmail: req.user.email, action: 'BOOKING_DELETE',
      details: `Deleted booking ${req.params.id}`, ipAddress: req.ip
    });
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
