const express = require('express');
const Vehicle = require('../models/Vehicle');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const vehicles = await Vehicle.find().sort({ updatedAt: -1 });
    res.json(vehicles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', requireRole('Admin'), async (req, res) => {
  try {
    const vehicle = await Vehicle.create({ ...req.body, updatedAt: new Date() });
    await AuditLog.create({
      userEmail: req.user.email,
      action: 'VEHICLE_CREATE',
      details: `Added ${vehicle.vehicleNumber}`,
      ipAddress: req.ip
    });
    res.status(201).json({ message: 'Vehicle added', vehicle });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    await AuditLog.create({
      userEmail: req.user.email,
      action: 'VEHICLE_UPDATE',
      details: `Updated ${vehicle.vehicleNumber}`,
      ipAddress: req.ip
    });
    res.json({ message: 'Vehicle updated', vehicle });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    await AuditLog.create({
      userEmail: req.user.email,
      action: 'VEHICLE_DELETE',
      details: `Deleted ${vehicle.vehicleNumber}`,
      ipAddress: req.ip
    });
    res.json({ message: 'Vehicle deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
