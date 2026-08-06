const express = require('express');
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');
const router = express.Router();

router.use(auth);

// List notifications for the current user (newest first) + unread count.
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const [items, unread] = await Promise.all([
      Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({ userId: req.user.id, read: false })
    ]);
    res.json({ data: items, unread });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark one or all notifications as read. Body: { ids?: string[] } | { all: true }
router.post('/read', async (req, res) => {
  try {
    const { ids, all } = req.body || {};
    let filter = { userId: req.user.id, read: false };
    if (all) {
      await Notification.updateMany(filter, { $set: { read: true } });
    } else if (Array.isArray(ids) && ids.length) {
      filter._id = { $in: ids };
      await Notification.updateMany(filter, { $set: { read: true } });
    } else {
      return res.status(400).json({ message: 'Provide ids[] or all:true' });
    }
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
