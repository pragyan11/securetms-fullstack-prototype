const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Challenge = require('../models/Challenge');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'auth_token';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const EXPECTED_ORIGINS = (process.env.EXPECTED_ORIGIN || `http://localhost:${process.env.PORT || 4000}`).split(',').map(s => s.trim()).filter(Boolean);

function getAllowedOrigin(req) {
  const origin = req.get('origin');
  if (origin && EXPECTED_ORIGINS.includes(origin)) {
    return origin;
  }
  return EXPECTED_ORIGINS[0];
}

const webauthnLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.body.email || req.ip });

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

router.post('/register', [
  body('name').notEmpty().trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('role').optional().isIn(['Customer', 'Driver', 'Admin']),
  body('recoveryEmail').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, email, role, recoveryEmail } = req.body;
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email,
      role: role || 'Customer',
      authMethod: 'Passkey',
      recoveryEmail
    });

    await AuditLog.create({
      userEmail: email,
      action: 'REGISTER',
      details: 'Account created',
      ipAddress: req.ip
    });

    res.status(201).json({
      message: 'Account created. Please register your passkey.',
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ message: 'No account found for that email.' });
    }

    if (!user.credentials || user.credentials.length === 0) {
      return res.status(400).json({ message: 'No passkey registered. Please register a passkey before logging in.' });
    }

    res.json({
      message: 'Passkey login initiated',
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login/face', async (req, res) => {
  res.status(501).json({ message: 'Face authentication is deprecated and no longer supported.' });
});

async function getOrCreateChallenge(email, type) {
  const rpName = process.env.RP_NAME || 'SecureTMS';
  const rpID = process.env.RP_ID;
  const origin = process.env.EXPECTED_ORIGIN;

  const existing = await Challenge.findOne({ email, type });
  if (existing) {
    await existing.deleteOne();
  }

  let options;
  if (type === 'register') {
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('User not found');
    }
    options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(user._id.toString()),
      userName: user.email,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials: user.credentials.map(cred => ({ id: cred.credentialID.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), type: 'public-key', transports: cred.transports || ['usb', 'ble', 'nfc', 'internal'] })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required'
      },
    });
  } else {
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.credentials || user.credentials.length === 0) {
      throw new Error('No passkeys registered for this account.');
    }
    options = await generateAuthenticationOptions({
      timeout: 60000,
      rpID,
      allowCredentials: user.credentials.map(cred => ({ id: cred.credentialID.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), type: 'public-key', transports: cred.transports || ['usb', 'ble', 'nfc', 'internal'] })),
      userVerification: 'required'
    });
  }

  await Challenge.create({ email, challenge: options.challenge, type });
  return options;
}

router.post('/webauthn/register/options', webauthnLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const options = await getOrCreateChallenge(normalizedEmail, 'register');
    res.json(options);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ message: err.message });
  }
});

router.post('/webauthn/register', async (req, res) => {
  try {
    const { email, attestationResponse } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();

    const expectedChallenge = await Challenge.findOne({ email: normalizedEmail, type: 'register' });
    if (!expectedChallenge) {
      return res.status(400).json({ message: 'No registration challenge pending' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!attestationResponse || typeof attestationResponse !== 'object' || !attestationResponse.id || !attestationResponse.response) {
      console.error('Invalid attestation response structure:', JSON.stringify(attestationResponse, null, 2));
      return res.status(400).json({ message: 'Invalid attestation response. Please try again and use a supported passkey.' });
    }

    console.error('Attestation response received:', JSON.stringify({
      id: attestationResponse.id,
      type: attestationResponse.type,
      responseKeys: attestationResponse.response ? Object.keys(attestationResponse.response) : 'missing',
      hasAttestationObject: !!attestationResponse.response?.attestationObject,
      hasClientDataJSON: !!attestationResponse.response?.clientDataJSON,
      transports: attestationResponse.transports,
    }));

    const verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge: expectedChallenge.challenge,
      expectedOrigin: getAllowedOrigin(req),
      expectedRPID: process.env.RP_ID,
    }).catch((err) => {
      console.error('Registration verification error:', err);
      console.error('Attestation response keys:', attestationResponse ? Object.keys(attestationResponse) : 'null/undefined');
      if (attestationResponse && attestationResponse.response) {
        console.error('Response keys:', Object.keys(attestationResponse.response));
      }
      throw err;
    });

    if (!verification.verified) {
      await expectedChallenge.deleteOne();
      return res.status(400).json({ message: 'Registration verification failed. Make sure you are using a supported passkey authenticator.' });
    }

    const regInfo = verification.registrationInfo || {};
    const credential = regInfo.credential || {};
    const credentialID = credential.id;
    const credentialPublicKey = credential.publicKey;
    const counter = credential.counter;

    if (!credentialID || !credentialPublicKey) {
      await expectedChallenge.deleteOne();
      return res.status(400).json({ message: 'Registration verification returned incomplete credential data.' });
    }

    user.credentials.push({
      credentialID: credentialID,
      credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64'),
      counter,
      transports: attestationResponse.transports || []
    });

    await expectedChallenge.deleteOne();
    await user.save();

    const token = createToken(user);
    setAuthCookie(res, token);

    await AuditLog.create({
      userEmail: normalizedEmail,
      action: 'PASSKEY_REGISTER',
      details: `Passkey registered (${user.credentials.length} credential(s))`,
      ipAddress: req.ip
    });

    res.json({ verified: true, token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/webauthn/login/options', webauthnLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const options = await getOrCreateChallenge(normalizedEmail, 'login');
    res.json(options);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ message: err.message });
  }
});

router.post('/webauthn/login', async (req, res) => {
  try {
    const { email, assertionResponse } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();

    const expectedChallenge = await Challenge.findOne({ email: normalizedEmail, type: 'login' });
    if (!expectedChallenge) {
      return res.status(400).json({ message: 'No login challenge pending' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const dbCred = user.credentials.find(c => c.credentialID === assertionResponse.id);
    if (!dbCred) {
      await expectedChallenge.deleteOne();
      return res.status(400).json({ message: 'Unknown credential' });
    }

    const verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge: expectedChallenge.challenge,
      expectedOrigin: getAllowedOrigin(req),
      expectedRPID: process.env.RP_ID,
      credential: {
        id: dbCred.credentialID,
        publicKey: Buffer.from(dbCred.credentialPublicKey, 'base64'),
        counter: dbCred.counter,
      },
    });

    if (!verification.verified) {
      await expectedChallenge.deleteOne();
      return res.status(400).json({ message: 'Authentication verification failed' });
    }

    dbCred.counter = verification.authenticationInfo.newCounter;
    await expectedChallenge.deleteOne();
    await user.save();

    const token = createToken(user);
    setAuthCookie(res, token);

    await AuditLog.create({
      userEmail: normalizedEmail,
      action: 'LOGIN',
      details: 'Passkey authentication successful',
      ipAddress: req.ip
    });

    res.json({ verified: true, token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/webauthn/credentials', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user.credentials.map(c => ({
      id: c.credentialID,
      transports: c.transports,
      createdAt: user.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/webauthn/credentials/:credentialId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const initialCount = user.credentials.length;
    user.credentials = user.credentials.filter(c => c.credentialID !== req.params.credentialId);
    if (user.credentials.length === initialCount) {
      return res.status(404).json({ message: 'Credential not found' });
    }
    await user.save();

    await AuditLog.create({
      userEmail: user.email,
      action: 'PASSKEY_DELETE',
      details: `Deleted credential ${req.params.credentialId}`,
      ipAddress: req.ip
    });

    res.json({ message: 'Credential deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.auth_token || req.cookies?.token;
  if (token) {
    invalidatedTokens.add(token);
  }
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
