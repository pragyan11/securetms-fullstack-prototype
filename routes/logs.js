const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const AuditLog = require('../models/AuditLog');
const router = express.Router();

router.use(auth, requireRole('Admin'));

// GET with search / action filter / user filter / date range / pagination
router.get('/', async (req, res) => {
  try {
    const { search, action, user, from, to, page, limit } = req.query;
    const filter = {};

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ action: re }, { userEmail: re }, { details: re }];
    }
    if (action) filter.action = action;
    if (user) filter.userEmail = new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
      if (to) filter.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      AuditLog.countDocuments(filter)
    ]);

    // Distinct actions for the filter dropdown.
    const actions = await AuditLog.distinct('action');

    res.json({ data: logs, total, page: pageNum, pages: Math.ceil(total / limitNum), actions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CSV export of the audit trail
router.get('/export', async (req, res) => {
  try {
    const { search, action, user, from, to } = req.query;
    const filter = {};
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ action: re }, { userEmail: re }, { details: re }];
    }
    if (action) filter.action = action;
    if (user) filter.userEmail = new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
      if (to) filter.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
    }
    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
    const header = 'When,Action,User,Details,IP\n';
    const rows = logs.map(l => `"${l.createdAt || ''}","${l.action || ''}","${l.userEmail || ''}","${(l.details || '').replace(/"/g, '""')}","${l.ipAddress || ''}"`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/all', async (req, res) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
