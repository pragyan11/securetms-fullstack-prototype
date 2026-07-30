const express = require('express');
const { body, validationResult } = require('express-validator');
const Vehicle = require('../models/Vehicle');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const router = express.Router();

router.use(auth);

// GET with search, sort, filter, pagination
router.get('/', async (req, res) => {
  try {
    const filter = {};
    const { search, status, zone, sort, order, page, limit } = req.query;

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ vehicleNumber: re }, { driverName: re }, { location: re }, { vehicleType: re }];
    }
    if (status) filter.status = status;
    if (zone) filter.serviceZone = zone;

    const sortField = sort || 'updatedAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [vehicles, total] = await Promise.all([
      Vehicle.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(limitNum),
      Vehicle.countDocuments(filter)
    ]);

    res.json({ data: vehicles, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post(
  '/',
  requireRole('Admin'),
  [
    body('vehicleNumber').notEmpty().trim().escape(),
    body('vehicleType').notEmpty().trim().escape(),
    body('driverName').optional().trim().escape(),
    body('location').optional().trim().escape(),
    body('status').optional().isIn(['Available', 'In Transit', 'Maintenance']),
    body('serviceZone').optional().isIn(['North', 'South', 'East', 'West', 'Central', 'Downtown'])
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      let vehicleNumber = req.body.vehicleNumber;
      if (vehicleNumber) {
        const existing = await Vehicle.findOne({ vehicleNumber });
        if (existing) vehicleNumber = `${vehicleNumber}-${Date.now().toString(36)}`;
      }
      const vehicle = await Vehicle.create({ ...req.body, vehicleNumber, updatedAt: new Date() });
      await AuditLog.create({ userEmail: req.user.email, action: 'VEHICLE_CREATE', details: `Added ${vehicle.vehicleNumber}`, ipAddress: req.ip });
      if (req.io) {
        req.io.emit('fleet:created', vehicle);
        req.io.emit('activity:new', { action: 'VEHICLE_CREATE', userEmail: req.user.email, details: `Added ${vehicle.vehicleNumber}`, createdAt: new Date() });
      }
      res.status(201).json({ message: 'Vehicle added', vehicle });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.put('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    await AuditLog.create({ userEmail: req.user.email, action: 'VEHICLE_UPDATE', details: `Updated ${vehicle.vehicleNumber}`, ipAddress: req.ip });
    if (req.io) {
      req.io.emit('fleet:updated', vehicle);
      req.io.emit('activity:new', { action: 'VEHICLE_UPDATE', userEmail: req.user.email, details: `Updated ${vehicle.vehicleNumber}`, createdAt: new Date() });
    }
    res.json({ message: 'Vehicle updated', vehicle });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    await AuditLog.create({ userEmail: req.user.email, action: 'VEHICLE_DELETE', details: `Deleted ${vehicle.vehicleNumber}`, ipAddress: req.ip });
    if (req.io) {
      req.io.emit('fleet:deleted', req.params.id);
      req.io.emit('activity:new', { action: 'VEHICLE_DELETE', userEmail: req.user.email, details: `Deleted ${vehicle.vehicleNumber}`, createdAt: new Date() });
    }
    res.json({ message: 'Vehicle deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
