const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Invite = require('../models/Invite');
const Challenge = require('../models/Challenge');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { addInvalidatedToken } = require('../lib/tokenStore');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { isDevMode } = require('../lib/devMode');

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

/**
 * Returns the role-based redirect path on the client. Admin ->
 * /dashboard.html, Customer -> /customer.html, Driver -> /driver.html.
 *
 * The Admin branch is checked FIRST and unmixed with the others so the
 * catch-all can never accidentally send an Administrator to /customer.html
 * (the single hard guarantee making admins always land on /dashboard.html
 * after login).
 */
function dashboardRouteForRole(role) {
  if (role === 'Admin')    return '/dashboard.html';
  if (role === 'Customer') return '/customer.html';
  if (role === 'Driver')   return '/driver.html';
  return '/dashboard.html';  // unknown role — Admin dashboard is the safest landing
}

router.post('/register', [
  body('name').notEmpty().trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('role').optional().isIn(['Customer', 'Driver', 'Admin']),
  body('recoveryEmail').isEmail().normalizeEmail(),
  body('inviteToken').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    let { name, email, role, recoveryEmail, inviteToken } = req.body;
    role = role || 'Customer';

    // Customer and Driver are public. Admin requires a valid unused invite
    // token. We atomically consume the invite here so two concurrent requests
    // with the same token cannot both create an admin account.
    let consumedInvite = null;
    if (role === 'Admin') {
      if (!inviteToken) {
        return res.status(403).json({ message: 'Admin accounts can only be created with a valid invitation.' });
      }
      consumedInvite = await Invite.findOneAndUpdate(
        {
          token: inviteToken,
          used: false,
          role: 'Admin',
          expiresAt: { $gt: new Date() }
        },
        { used: true, usedAt: new Date(), usedByEmail: email.toLowerCase() },
        { new: true }
      );
      if (!consumedInvite) {
        return res.status(403).json({ message: 'Invalid or expired invitation token.' });
      }
      // If the invite was scoped to a specific email, enforce it.
      if (consumedInvite.email && consumedInvite.email.toLowerCase() !== email.toLowerCase()) {
        // Roll the consume back so the legitimate recipient can still use it.
        await Invite.updateOne({ _id: consumedInvite._id }, { used: false, $unset: { usedAt: 1, usedByEmail: 1 } });
        return res.status(403).json({ message: 'Invitation is for a different email address.' });
      }
    }

    const exists = await User.findOne({ email });
    if (exists) {
      // If we just consumed an invite for a duplicate email, release it.
      if (consumedInvite) {
        await Invite.updateOne({ _id: consumedInvite._id }, { used: false, $unset: { usedAt: 1, usedByEmail: 1 } });
      }
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email,
      role,
      authMethod: 'Passkey',
      recoveryEmail
    });

    await AuditLog.create({
      userEmail: email,
      action: 'REGISTER',
      details: `Account created with role ${role}${role === 'Admin' ? ' via invite' : ''}`,
      ipAddress: req.ip
    });

    res.status(201).json({
      message: 'Account created. Please register your passkey.',
      redirect: dashboardRouteForRole(role),
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/invites/:token', async (req, res) => {
  try {
    const invite = await Invite.findOne({ token: req.params.token });
    if (!invite || invite.used || invite.expiresAt < new Date()) {
      return res.status(404).json({ message: 'Invitation not found, used, or expired' });
    }
    res.json({
      valid: true,
      role: invite.role,
      email: invite.email || null,
      expiresAt: invite.expiresAt,
      invitedBy: invite.invitedByEmail || null,
      note: invite.note || null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', (req, res) => {
  // This endpoint is intentionally disabled. Authentication is performed
  // through the WebAuthn ceremony at /webauthn/login/options and
  // /webauthn/login, not with a simple email lookup.
  res.status(405).json({ message: 'Use the WebAuthn login endpoints instead.' });
});

router.post('/login/face', async (req, res) => {
  res.status(501).json({ message: 'Face authentication is deprecated and no longer supported.' });
});

/* ═══════════════════════════════════════════════════════════════════════════
   DEV-ONLY LOGIN BYPASS

   Why this exists: a fresh install seeds Customer + Driver accounts in
   `server.js#seedDemoData`, but it can never mint real WebAuthn credentials
   server-side (that ceremony requires the browser's authenticator). Result:
   on a vanilla `npm start`, the entire app is un-reachable because no
   account can complete `/webauthn/login/options` — every page redirects to
   /login.html and never renders.

   This endpoint mints the *same* JWT and sets the *same* cookie the passkey
   flow produces, so downstream auth/middleware/UI behave identically. It is
   reachable ONLY when NODE_ENV !== 'production'. In production it answers
   404 so it never leaks — even a leaked URL is harmless.

   This is the canonical fix for the recurring "all pages stuck loading"
   complaint on a fresh install. Switch `NODE_ENV=production` to lock the
   door once real credentials are enrolled.
   ═══════════════════════════════════════════════════════════════════════════ */
function devLoginEnabled() {
  // See lib/devMode.js — single source of truth for the dev-mode gate.
  return isDevMode();
}

router.get('/dev/info', (_req, res) => {
  if (!devLoginEnabled()) return res.status(404).json({ message: 'Not available' });
  res.json({ devLoginEnabled: true, message: 'Development login shortcut is enabled.' });
});

const devLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyGenerator: (req) => req.body?.email || req.ip });

router.post('/dev-login', devLoginLimiter, async (req, res) => {
  if (!devLoginEnabled()) {
    return res.status(404).json({ message: 'Not available' });
  }
  try {
    const email = ((req.body && req.body.email) || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: `No account for ${email}. Try one of the pre-seeded demo accounts.` });
    }
    const token = createToken(user);
    setAuthCookie(res, token);
    await AuditLog.create({
      userEmail: email,
      action: 'DEV_LOGIN',
      details: `Passwordless bypass used (NODE_ENV=${process.env.NODE_ENV || 'unset'}; ALLOW_DEV_LOGIN=${process.env.ALLOW_DEV_LOGIN || 'unset'})`,
      ipAddress: req.ip
    });
    res.json({
      verified: true,
      devLogin: true,
      token,
      redirect: dashboardRouteForRole(user.role),
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
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
      excludeCredentials: (user.credentials || []).map(cred => ({ id: cred.credentialID.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), type: 'public-key', transports: cred.transports || ['usb', 'ble', 'nfc', 'internal'] })),
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
      allowCredentials: (user.credentials || []).map(cred => ({ id: cred.credentialID.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), type: 'public-key', transports: cred.transports || ['usb', 'ble', 'nfc', 'internal'] })),
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

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: attestationResponse,
        expectedChallenge: expectedChallenge.challenge,
        expectedOrigin: getAllowedOrigin(req),
        expectedRPID: process.env.RP_ID,
      });
    } catch (err) {
      console.error('Registration verification error:', err);
      return res.status(400).json({ message: 'Registration verification failed: ' + err.message });
    }

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

    res.json({
      verified: true,
      token,
      redirect: dashboardRouteForRole(user.role),
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Registration endpoint error:', err);
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

    res.json({
      verified: true,
      token,
      redirect: dashboardRouteForRole(user.role),
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
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
    res.json((user.credentials || []).map(c => ({
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
    addInvalidatedToken(token);
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
    res.json({
      valid: true,
      redirect: dashboardRouteForRole(user.role),
      user: { id: user._id, name: user.name, email: user.email, role: user.role, authMethod: user.authMethod }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-recoveryEmail');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      authMethod: user.authMethod,
      credentialCount: (user.credentials || []).length,
      createdAt: user.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/auth/me/credentials
 * Returns the logged-in user's own WebAuthn credentials, including the
 * base64-encoded public key so the user can inspect or back it up. This
 * is intentionally scoped to the current user only.
 */
router.get('/me/credentials', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('credentials createdAt');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      credentials: (user.credentials || []).map(c => ({
        credentialID: c.credentialID,
        credentialPublicKey: c.credentialPublicKey,
        counter: c.counter,
        transports: c.transports
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
