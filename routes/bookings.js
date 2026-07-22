const express = require('express');
const { body, validationResult } = require('express-validator');
const Booking = require('../models/Booking');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'Customer' ? { userId: req.user.id } : {};
    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    res.json(bookings);
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
    body('status').optional().isIn(['Pending', 'Confirmed', 'Completed'])
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const { customerName, origin, destination, status } = req.body;
      const booking = await Booking.create({
        userId: req.user.id,
        customerName: customerName || req.user.name,
        origin,
        destination,
        status: status || 'Pending'
      });

      await AuditLog.create({
        userEmail: req.user.email,
        action: 'BOOKING_CREATE',
        details: `${origin} -> ${destination}`,
        ipAddress: req.ip
      });

      res.status(201).json({ message: 'Booking created', booking });
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
      userEmail: req.user.email,
      action: 'BOOKING_UPDATE',
      details: `Updated booking ${req.params.id}`,
      ipAddress: req.ip
    });
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
      userEmail: req.user.email,
      action: 'BOOKING_DELETE',
      details: `Deleted booking ${req.params.id}`,
      ipAddress: req.ip
    });
    res.json({ message: 'Booking deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
