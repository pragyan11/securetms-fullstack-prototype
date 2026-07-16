const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const FaceData = require('../models/FaceData');
const auth = require('../middleware/auth');
const router = express.Router();

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'auth_token';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function createToken(user) {
  return jwt.sign({ id: user._id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: process.env.SESSION_EXPIRES_IN || '8h' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production'
  });
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, role, authMethod, recoveryEmail, image } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const normalizedRole = ['Customer', 'Driver', 'Admin'].includes(role) ? role : 'Customer';

    if (!name || !normalizedEmail || !recoveryEmail) {
      return res.status(400).json({ message: 'Name, email, and recovery email are required.' });
    }

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      role: normalizedRole,
      authMethod: authMethod || 'Passkey',
      recoveryEmail
    });

    // If a face image was supplied during registration, store it in a separate collection.
    if (image && typeof image === 'string' && image.startsWith('data:image/png;base64,')) {
      try {
        await FaceData.create({ userId: user._id, image });
      } catch (e) {
        // Log but do not fail registration – face data is optional.
        console.error('Failed to store face data during registration:', e);
      }
    }

    await AuditLog.create({
      userEmail: normalizedEmail,
      action: 'REGISTER',
      details: 'Account created',
      ipAddress: req.ip
    });

    const token = createToken(user);
    setAuthCookie(res, token);

    res.status(201).json({
        message: 'Account created successfully',
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role, authMethod: user.authMethod }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, authMethod } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ message: 'No account found for that email.' });
    }

    const token = createToken(user);
    setAuthCookie(res, token);

    await AuditLog.create({
      userEmail: normalizedEmail,
      action: 'LOGIN',
      details: `${authMethod || 'Passkey'} authentication successful`,
      ipAddress: req.ip
    });

    res.json({
      message: 'Authenticated using Passkey',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Face authentication endpoint (placeholder implementation)
router.post('/login/face', async (req, res) => {
  try {
    const { email, authMethod, image } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ message: 'No account found for that email.' });
    }

    // ---- Face verification against stored image ----
    // Basic sanity checks for the incoming image.
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) {
      return res.status(400).json({ message: 'Face image missing or invalid.' });
    }
    const base64Part = image.split(',')[1] || '';
    if (base64Part.length < 1000) {
      return res.status(400).json({ message: 'Face image too small – please allow camera access.' });
    }

    // Retrieve stored face data for this user.
    const stored = await FaceData.findOne({ userId: user._id });
    if (!stored) {
      return res.status(400).json({ message: 'No face data registered for this account.' });
    }
    // For this prototype we accept any captured image as long as a face record exists.
    // In a real system you would run a facial‑recognition model and compare similarity scores.
    console.log('Face data found – proceeding with authentication (exact match disabled for demo)');
    // -----------------------------------------------

    const token = createToken(user);
    setAuthCookie(res, token);

    await AuditLog.create({
      userEmail: normalizedEmail,
      action: 'LOGIN_FACE',
      details: 'Face authentication with image (basic validation)',
      ipAddress: req.ip
    });

    res.json({
      message: 'Authenticated using Face',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, authMethod: user.authMethod }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/logout', async (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.clearCookie('token');
  await AuditLog.create({ userEmail: req.user?.email || 'anonymous', action: 'LOGOUT', details: 'User signed out', ipAddress: req.ip });
  res.json({ message: 'Logged out' });
});

router.post('/recover', async (req, res) => {
  try {
    const { email, recoveryEmail } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user || user.recoveryEmail !== recoveryEmail) {
      return res.status(404).json({ message: 'Recovery details not matched' });
    }

    await AuditLog.create({
      userEmail: normalizedEmail,
      action: 'ACCOUNT_RECOVER',
      details: 'Recovery link simulated for the supplied email',
      ipAddress: req.ip
    });

    res.json({ message: 'Recovery link sent' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/verify', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-recoveryEmail');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ valid: true, user: { id: user._id, name: user.name, email: user.email, role: user.role, authMethod: user.authMethod } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
