const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const MaintenanceLog = require('../models/MaintenanceLog');
const AuditLog = require('../models/AuditLog');
const router = express.Router();

router.use(auth);

// Get all maintenance logs with optional filters
router.get('/', async (req, res) => {
  try {
    const filter = {};
    const { vehicleId, status, type } = req.query;
    if (vehicleId) filter.vehicleId = vehicleId;
    if (status) filter.status = status;
    if (type) filter.type = type;
    const logs = await MaintenanceLog.find(filter).sort({ scheduledDate: -1 }).limit(100);
    const overdue = await MaintenanceLog.countDocuments({ status: 'Overdue' });
    const scheduled = await MaintenanceLog.countDocuments({ status: 'Scheduled' });
    res.json({ data: logs, overdue, scheduled });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create maintenance log
router.post('/', [
  body('vehicleId').notEmpty(),
  body('vehicleNumber').notEmpty().trim().escape(),
  body('type').optional().isIn(['Scheduled', 'Unscheduled', 'Inspection', 'Repair', 'Oil Change', 'Tire Rotation', 'Brake Service', 'Other']),
  body('status').optional().isIn(['Scheduled', 'In Progress', 'Completed', 'Overdue']),
  body('description').notEmpty().trim().escape(),
  body('scheduledDate').optional().isISO8601(),
  body('cost').optional().isNumeric(),
  body('odometer').optional().isNumeric(),
  body('notes').optional().trim().escape()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const log = await MaintenanceLog.create({
      ...req.body,
      createdBy: req.user.email,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await AuditLog.create({
      userEmail: req.user.email, action: 'MAINTENANCE_CREATE',
      details: `Maintenance logged for ${log.vehicleNumber}: ${log.type}`, ipAddress: req.ip
    });
    if (req.io) req.io.emit('maintenance:created', log);
    res.status(201).json({ message: 'Maintenance log created', data: log });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update maintenance log (Admin or creator)
router.patch('/:id', async (req, res) => {
  try {
    const log = await MaintenanceLog.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Maintenance log not found' });
    if (req.user.role !== 'Admin' && log.createdBy !== req.user.email) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    Object.assign(log, req.body, { updatedAt: new Date() });
    await log.save();
    if (req.io) req.io.emit('maintenance:updated', log);
    res.json({ message: 'Updated', data: log });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Forbidden' });
    const log = await MaintenanceLog.findByIdAndDelete(req.params.id);
    if (!log) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
