const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Shipment = require('../models/Shipment');
const Vehicle = require('../models/Vehicle');
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

module.exports = router;
