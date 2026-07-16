const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const AuditLog = require('../models/AuditLog');
const router = express.Router();

router.use(auth);

router.get('/', requireRole('Admin'), async (req, res) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/all', requireRole('Admin'), async (req, res) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
