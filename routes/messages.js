const express = require('express');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');
const notify = require('../services/notify');
const webhooks = require('../services/webhooks');
const router = express.Router();

router.use(auth);

// Get messages for current user (inbox)
router.get('/', async (req, res) => {
  try {
    const filter = { $or: [{ toEmail: req.user.email }, { fromEmail: req.user.email }] };
    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(100);
    const unread = await Message.countDocuments({ toEmail: req.user.email, read: false });
    res.json({ data: messages, unread });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Send message
router.post('/', async (req, res) => {
  try {
    const { toEmail, subject, body, shipmentId } = req.body;
    if (!toEmail || !body) return res.status(400).json({ message: 'toEmail and body are required' });
    const msg = await Message.create({
      fromUserId: req.user.id, fromEmail: req.user.email,
      toEmail, subject: subject || '', body, shipmentId: shipmentId || undefined
    });
    if (req.io) req.io.emit('message:new', msg);
    webhooks.dispatch('message.sent', { from: req.user.email, to: toEmail, subject: subject || '' }).catch(() => {});
    const recipient = await User.findOne({ email: toEmail.toLowerCase().trim() }).select('_id');
    if (recipient) {
      notify.notifyUser(recipient, {
        title: 'New message from ' + (req.user.name || req.user.email),
        body: subject || body.slice(0, 80),
        type: 'info',
        link: req.user.role === 'Driver' ? '/customer.html' : '/driver.html',
        event: 'message.sent',
        io: req.io
      }).catch(() => {});
    }
    res.status(201).json({ message: 'Sent', data: msg });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark as read
router.patch('/:id/read', async (req, res) => {
  try {
    await Message.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
