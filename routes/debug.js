const express = require('express');
const User = require('../models/User');
const router = express.Router();

// Debug-only: list users when not in production
router.get('/users', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  try {
    const users = await User.find({}, '-credentialPublicKey -credentialPublicKey -publicKey');
    res.json({ count: users.length, users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
