const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Shipment = require('../models/Shipment');
const Vehicle = require('../models/Vehicle');
const AuditLog = require('../models/AuditLog');
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

const VALID_ROLES = ['Admin', 'Customer', 'Driver'];

// Update a user's profile (name / email / role) — admin only
router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'Name is required' });
      }
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
    }
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
      }
      updates.role = role;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    // Safety: don't let an admin demote or rename the last remaining admin,
    // and don't let an admin demote their own account (locks the console).
    if (updates.role && updates.role !== 'Admin' && target.role === 'Admin') {
      if (String(target._id) === String(req.user.id)) {
        return res.status(400).json({ message: 'You cannot change your own role' });
      }
      const adminCount = await User.countDocuments({ role: 'Admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot demote the last admin' });
      }
    }

    Object.assign(target, updates);
    await target.save();

    await AuditLog.create({
      userEmail: req.user.email,
      action: 'USER_UPDATE',
      details: `Updated user ${target.email} (role: ${target.role})`,
      ipAddress: req.ip
    });

    res.json(target);
  } catch (err) {
    if (err && err.code === 11000) return res.status(400).json({ message: 'That email is already in use' });
    res.status(500).json({ message: err.message });
  }
});

// Delete a user — admin only
router.delete('/users/:id', async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    // Safety: never allow self-deletion, and never delete the last admin.
    if (String(target._id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    if (target.role === 'Admin') {
      const adminCount = await User.countDocuments({ role: 'Admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last admin' });
      }
    }

    await User.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      userEmail: req.user.email,
      action: 'USER_DELETE',
      details: `Deleted user ${target.email} (role: ${target.role})`,
      ipAddress: req.ip
    });

    res.json({ message: 'User deleted', deleted: { id: target._id, email: target.email } });
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
