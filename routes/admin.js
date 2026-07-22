const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Shipment = require('../models/Shipment');
const Vehicle = require('../models/Vehicle');
const AuditLog = require('../models/AuditLog');
const router = express.Router();

// Disabled authentication for demo purposes; in production, enforce auth and role checks.
// router.use(auth, requireRole('Admin'));

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

    res.json({
      users,
      bookings,
      shipments,
      vehicles,
      bookingsByStatus,
      shipmentsByStatus,
      vehiclesByStatus
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------
// Admin user management routes (demo – no auth for simplicity)
// ---------------------------------------------------------------------
// Get list of all users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get a single user by ID (including public key and other details)
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update a user's role (admin only in production)
router.put('/users/:id', async (req, res) => {
  try {
    const { role } = req.body;
    const updated = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!updated) return res.status(404).json({ message: 'User not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete a user
router.delete('/users/:id', async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get audit logs for a specific user (by email query param)
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

module.exports = router;
