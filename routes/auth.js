const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Invite = require('../models/Invite');
const Challenge = require('../models/Challenge');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const Shipment = require('../models/Shipment');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const { addInvalidatedToken } = require('../lib/tokenStore');
const { sha256, createAccessToken, createRefreshToken, createSignedToken, verifySignedToken } = require('../lib/authTokens');
const { attachCsrf } = require('../middleware/csrf');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { isDevMode } = require('../lib/devMode');
const emailService = require('../services/email');
const webhooks = require('../services/webhooks');

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'auth_token';
const REFRESH_COOKIE = 'auth_refresh';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const EXPECTED_ORIGINS = (process.env.EXPECTED_ORIGIN || `http://localhost:${process.env.PORT || 4000}`).split(',').map(s => s.trim()).filter(Boolean);

function baseUrl() {
  return process.env.BASE_URL || process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 4000}`;
}

// ── Lockout policy ────────────────────────────────────────────────
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const RECOVERY_CODE_TTL_MINUTES = 15;

function isLocked(user) {
  return !!(user && user.lockedUntil && new Date(user.lockedUntil) > new Date());
}
async function recordFailedAttempt(user) {
  const count = (user.failedLoginCount || 0) + 1;
  if (count >= LOCKOUT_THRESHOLD) {
    user.failedLoginCount = 0;
    user.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
  } else {
    user.failedLoginCount = count;
  }
  await user.save().catch(() => {});
  return count;
}
async function clearFailedAttempts(user) {
  if (user.failedLoginCount || user.lockedUntil) {
    user.failedLoginCount = 0;
    user.lockedUntil = null;
  }
  user.lastLoginAt = new Date();
  await user.save().catch(() => {});
}

// ── Token / cookie helpers ────────────────────────────────────────
function ttlToMs(ttl) {
  const m = /^(\d+)([smhd])$/.exec(String(ttl || ''));
  if (!m) return 8 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  return { s: n * 1000, m: n * 60000, h: n * 3600000, d: n * 86400000 }[m[2]];
}

async function createSession(user, req, res, remember = false) {
  const accessTtl = remember ? (process.env.REMEMBER_EXPIRES_IN || '30d') : (process.env.SESSION_EXPIRES_IN || '8h');
  const refreshTtl = process.env.REFRESH_EXPIRES_IN || '14d';
  const access = createAccessToken(user, accessTtl);
  const refresh = createRefreshToken(user, refreshTtl);
  const ua = (req.headers['user-agent'] || '').slice(0, 200);
  const label = (function () {
    const parts = [];
    if (/Android/i.test(ua)) parts.push('Android');
    else if (/iPhone|iPad/i.test(ua)) parts.push('iOS');
    if (/Chrome\//i.test(ua)) parts.push('Chrome');
    else if (/Firefox\//i.test(ua)) parts.push('Firefox');
    else if (/Safari\//i.test(ua)) parts.push('Safari');
    else if (/Edg\//i.test(ua)) parts.push('Edge');
    return parts.join(' ') || 'Unknown device';
  })();

  await Session.create({
    userId: user._id,
    tokenHash: sha256(access),
    refreshHash: sha256(refresh),
    label,
    userAgent: ua,
    ip: req.ip,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + ttlToMs(refreshTtl))
  });

  const maxAge = ttlToMs(accessTtl);
  res.cookie(COOKIE_NAME, access, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge });
  res.cookie(REFRESH_COOKIE, refresh, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ttlToMs(refreshTtl) });
  return access;
}

function getAllowedOrigin(req) {
  const origin = req.get('origin');
  if (origin && EXPECTED_ORIGINS.includes(origin)) return origin;
  return EXPECTED_ORIGINS[0];
}

const webauthnLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.body.email || req.ip });
const recoverLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => (req.body && (req.body.email || req.body.recoveryEmail)) || req.ip });
const resendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 3, keyGenerator: (req) => req.user && req.user.email || req.ip });
const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyGenerator: (req) => req.ip });

function dashboardRouteForRole(role) {
  if (role === 'Admin')    return '/dashboard.html';
  if (role === 'Customer') return '/customer.html';
  if (role === 'Driver')   return '/driver.html';
  return '/dashboard.html';
}

// Every response on this router carries the readable CSRF cookie.
router.use(attachCsrf);

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRATION
   ═══════════════════════════════════════════════════════════════════════════ */
router.post('/register', [
  body('name').notEmpty().trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('role').optional().isIn(['Customer', 'Driver', 'Admin']),
  body('recoveryEmail').isEmail().normalizeEmail(),
  body('inviteToken').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    let { name, email, role, recoveryEmail, inviteToken } = req.body;
    role = role || 'Customer';

    let consumedInvite = null;
    if (role === 'Admin') {
      if (!inviteToken) return res.status(403).json({ message: 'Admin accounts can only be created with a valid invitation.' });
      consumedInvite = await Invite.findOneAndUpdate(
        { token: inviteToken, used: false, role: 'Admin', expiresAt: { $gt: new Date() } },
        { used: true, usedAt: new Date(), usedByEmail: email.toLowerCase() },
        { new: true }
      );
      if (!consumedInvite) return res.status(403).json({ message: 'Invalid or expired invitation token.' });
      if (consumedInvite.email && consumedInvite.email.toLowerCase() !== email.toLowerCase()) {
        await Invite.updateOne({ _id: consumedInvite._id }, { used: false, $unset: { usedAt: 1, usedByEmail: 1 } });
        return res.status(403).json({ message: 'Invitation is for a different email address.' });
      }
    }

    const exists = await User.findOne({ email });
    if (exists) {
      if (consumedInvite) await Invite.updateOne({ _id: consumedInvite._id }, { used: false, $unset: { usedAt: 1, usedByEmail: 1 } });
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name, email, role,
      authMethod: 'Passkey',
      recoveryEmail,
      emailVerified: false
    });

    await AuditLog.create({ userEmail: email, action: 'REGISTER', details: `Account created with role ${role}${role === 'Admin' ? ' via invite' : ''}`, ipAddress: req.ip });
    webhooks.dispatch('user.registered', { email, role, name }).catch(() => {});

    // Email verification (best-effort) — A2.
    try {
      const vtoken = createSignedToken('verify-email', { email }, 24 * 60 * 60);
      emailService.notifyEmailVerification(email, `${baseUrl()}/verify-email?token=${encodeURIComponent(vtoken)}`).catch(() => {});
    } catch (_e) { /* best-effort */ }

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
    res.json({ valid: true, role: invite.role, email: invite.email || null, expiresAt: invite.expiresAt, invitedBy: invite.invitedByEmail || null, note: invite.note || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', (req, res) => {
  res.status(405).json({ message: 'Use the WebAuthn login endpoints instead.' });
});

/* ═══════════════════════════════════════════════════════════════════════════
   EMAIL VERIFICATION (A2)
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/verify-email', async (req, res) => {
  try {
    const payload = verifySignedToken('verify-email', req.query.token);
    if (!payload || !payload.email) return res.status(400).json({ message: 'Invalid or expired verification link.' });
    const user = await User.findOne({ email: payload.email.toLowerCase().trim() });
    if (!user) return res.status(400).json({ message: 'Account not found.' });
    user.emailVerified = true;
    await user.save();
    await AuditLog.create({ userEmail: user.email, action: 'EMAIL_VERIFY', details: 'Email address verified', ipAddress: req.ip });
    webhooks.dispatch('user.verified', { email: user.email }).catch(() => {});
    res.json({ message: 'Email verified. You can close this tab and sign in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/verify-email/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('emailVerified email');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ emailVerified: !!user.emailVerified, email: user.email });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/resend-verification', auth, resendLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.emailVerified) return res.status(400).json({ message: 'Email is already verified.' });
    const vtoken = createSignedToken('verify-email', { email: user.email }, 24 * 60 * 60);
    await emailService.notifyEmailVerification(user.email, `${baseUrl()}/verify-email?token=${encodeURIComponent(vtoken)}`);
    res.json({ message: 'Verification email sent.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ACCOUNT RECOVERY (A1) — real emailed link
   ═══════════════════════════════════════════════════════════════════════════ */
router.post('/recover', recoverLimiter, async (req, res) => {
  const GENERIC = 'If those details match an account, a recovery link has been sent to your recovery email.';
  try {
    const { email, recoveryEmail } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.recoveryEmail || user.recoveryEmail.toLowerCase() !== String(recoveryEmail || '').toLowerCase().trim()) {
      // Do not reveal whether the account exists.
      return res.status(200).json({ message: GENERIC });
    }
    const rtoken = createSignedToken('recover', { email: user.email }, RECOVERY_CODE_TTL_MINUTES * 60);
    await emailService.notifyRecoveryLink(user.recoveryEmail, `${baseUrl()}/recover?token=${encodeURIComponent(rtoken)}`, RECOVERY_CODE_TTL_MINUTES);
    await AuditLog.create({ userEmail: normalizedEmail, action: 'ACCOUNT_RECOVER', details: 'Recovery link emailed', ipAddress: req.ip });
    res.json({ message: GENERIC });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/recover/validate', async (req, res) => {
  try {
    const payload = verifySignedToken('recover', req.query.token);
    if (!payload || !payload.email) return res.status(400).json({ message: 'Invalid or expired recovery link.' });
    res.json({ valid: true, email: payload.email });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Clears all passkeys so the owner can re-enroll (via the register ceremony).
router.post('/recover/complete', async (req, res) => {
  try {
    const { token } = req.body;
    const payload = verifySignedToken('recover', token);
    if (!payload || !payload.email) return res.status(400).json({ message: 'Invalid or expired recovery link.' });
    const user = await User.findOne({ email: payload.email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    user.credentials = [];
    await user.save();
    await Session.deleteMany({ userId: user._id });
    await AuditLog.create({ userEmail: user.email, action: 'PASSKEY_RECOVER', details: 'Passkeys cleared via recovery link — re-enrollment required', ipAddress: req.ip });
    res.json({ ok: true, email: user.email, redirect: '/login.html' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   RECOVERY CODES (A5) — one-time backup codes
   ═══════════════════════════════════════════════════════════════════════════ */
function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5, 10));
  }
  return codes;
}

// How many unused codes remain (auth).
router.get('/recovery-codes', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('recoveryCodes');
    const unused = (user.recoveryCodes || []).filter(c => !c.usedAt).length;
    res.json({ count: unused });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate a fresh batch. Returns plaintext exactly once; hashes are stored.
router.post('/recovery-codes', auth, rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.user.email || req.ip }), async (req, res) => {
  try {
    const force = !!(req.body && req.body.force);
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const unused = (user.recoveryCodes || []).filter(c => !c.usedAt);
    if (unused.length && !force) {
      return res.status(409).json({ message: `${unused.length} recovery code(s) are still active. Regenerating invalidates them — pass force=true to proceed.` });
    }
    const codes = generateRecoveryCodes(8);
    user.recoveryCodes = codes.map(c => ({ hash: sha256(c), createdAt: new Date() }));
    await user.save();
    await AuditLog.create({ userEmail: user.email, action: 'RECOVERY_CODES_GENERATE', details: 'New recovery codes issued', ipAddress: req.ip });
    // Email a copy so codes survive a lost device + a cleared browser.
    emailService.notifyRecoveryCodes(user.email, codes).catch(() => {});
    res.json({ codes, count: codes.length, message: 'Store these codes somewhere safe. They are shown only once.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Redeem a recovery code (public, works even when the account is locked).
router.post('/recover/with-code', recoverLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const cleanCode = String(code || '').toUpperCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    const entry = (user.recoveryCodes || []).find(c => !c.usedAt && c.hash === sha256(cleanCode));
    if (!entry) {
      await recordFailedAttempt(user);
      await AuditLog.create({ userEmail: normalizedEmail, action: 'LOGIN_FAILED', details: 'Invalid recovery code attempt', ipAddress: req.ip });
      return res.status(400).json({ message: 'That recovery code is invalid or already used.' });
    }
    entry.usedAt = new Date();
    user.credentials = [];
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await user.save();
    await Session.deleteMany({ userId: user._id });
    await AuditLog.create({ userEmail: user.email, action: 'ACCOUNT_RECOVER_CODE', details: 'Account unlocked with a recovery code', ipAddress: req.ip });
    res.json({ ok: true, email: user.email, message: 'Account unlocked. Enroll a new passkey to sign in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   DEV LOGIN BYPASS (unchanged behaviour, now with persistent sessions)
   ═══════════════════════════════════════════════════════════════════════════ */
function devLoginEnabled() { return isDevMode(); }

router.get('/dev/info', (_req, res) => {
  if (!devLoginEnabled()) return res.status(404).json({ message: 'Not available' });
  res.json({ devLoginEnabled: true, message: 'Development login shortcut is enabled.' });
});

const devLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyGenerator: (req) => req.body?.email || req.ip });

router.post('/dev-login', devLoginLimiter, async (req, res) => {
  if (!devLoginEnabled()) return res.status(404).json({ message: 'Not available' });
  try {
    const email = ((req.body && req.body.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ message: 'Email is required.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: `No account for ${email}. Try one of the pre-seeded demo accounts.` });
    await clearFailedAttempts(user);
    const token = await createSession(user, req, res, !!(req.body && req.body.remember));
    await AuditLog.create({ userEmail: email, action: 'DEV_LOGIN', details: 'Passwordless bypass used', ipAddress: req.ip });
    res.json({ verified: true, devLogin: true, token, redirect: dashboardRouteForRole(user.role), user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   WEB AUTHN — challenges + ceremonies (with lockout)
   ═══════════════════════════════════════════════════════════════════════════ */
async function getOrCreateChallenge(email, type) {
  const rpName = process.env.RP_NAME || 'SpeedX';
  const rpID = process.env.RP_ID;
  const origin = process.env.EXPECTED_ORIGIN;

  const existing = await Challenge.findOne({ email, type });
  if (existing) await existing.deleteOne();

  const user = await User.findOne({ email });
  if (!user) throw new Error('User not found');

  let options;
  if (type === 'register') {
    options = await generateRegistrationOptions({
      rpName, rpID,
      userID: Buffer.from(user._id.toString()),
      userName: user.email,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials: (user.credentials || []).map(cred => ({ id: cred.credentialID.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), type: 'public-key', transports: cred.transports || ['usb', 'ble', 'nfc', 'internal'] })),
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' }
    });
  } else {
    if (!user.credentials || user.credentials.length === 0) {
      throw new Error('No passkeys registered for this account.');
    }
    options = await generateAuthenticationOptions({
      timeout: 60000, rpID,
      allowCredentials: (user.credentials || []).map(cred => ({ id: cred.credentialID.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), type: 'public-key', transports: cred.transports || ['usb', 'ble', 'nfc', 'internal'] })),
      userVerification: 'required'
    });
  }

  await Challenge.create({ email, challenge: options.challenge, type });
  return options;
}

function assertNotLocked(user) {
  if (isLocked(user)) {
    const mins = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
    throw new Error(`Account temporarily locked due to too many failed attempts. Try again in ${mins} minute(s) or use a recovery code.`);
  }
}

router.post('/webauthn/register/options', webauthnLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: 'User not found' });
    assertNotLocked(user);
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
    if (!expectedChallenge) return res.status(400).json({ message: 'No registration challenge pending' });

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: 'User not found' });
    assertNotLocked(user);

    if (!attestationResponse || typeof attestationResponse !== 'object' || !attestationResponse.id || !attestationResponse.response) {
      return res.status(400).json({ message: 'Invalid attestation response. Please try again and use a supported passkey.' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({ response: attestationResponse, expectedChallenge: expectedChallenge.challenge, expectedOrigin: getAllowedOrigin(req), expectedRPID: process.env.RP_ID });
    } catch (err) {
      return res.status(400).json({ message: 'Registration verification failed: ' + err.message });
    }

    if (!verification.verified) {
      await expectedChallenge.deleteOne();
      return res.status(400).json({ message: 'Registration verification failed. Make sure you are using a supported passkey authenticator.' });
    }

    const regInfo = verification.registrationInfo || {};
    const credential = regInfo.credential || {};
    if (!credential.id || !credential.publicKey) {
      await expectedChallenge.deleteOne();
      return res.status(400).json({ message: 'Registration verification returned incomplete credential data.' });
    }

    user.credentials.push({
      credentialID: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      transports: attestationResponse.transports || []
    });

    await expectedChallenge.deleteOne();
    await clearFailedAttempts(user);
    await user.save();

    const token = await createSession(user, req, res, !!(req.body && req.body.remember));

    await AuditLog.create({ userEmail: normalizedEmail, action: 'PASSKEY_REGISTER', details: `Passkey registered (${user.credentials.length} credential(s))`, ipAddress: req.ip });

    res.json({ verified: true, token, redirect: dashboardRouteForRole(user.role), user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/webauthn/login/options', webauthnLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: 'User not found' });
    assertNotLocked(user);
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
    if (!expectedChallenge) return res.status(400).json({ message: 'No login challenge pending' });

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: 'User not found' });
    assertNotLocked(user);

    const dbCred = user.credentials.find(c => c.credentialID === assertionResponse.id);
    if (!dbCred) {
      await expectedChallenge.deleteOne();
      await recordFailedAttempt(user);
      await AuditLog.create({ userEmail: normalizedEmail, action: 'LOGIN_FAILED', details: 'Unknown credential', ipAddress: req.ip });
      return res.status(400).json({ message: 'Unknown credential' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertionResponse,
        expectedChallenge: expectedChallenge.challenge,
        expectedOrigin: getAllowedOrigin(req),
        expectedRPID: process.env.RP_ID,
        credential: { id: dbCred.credentialID, publicKey: Buffer.from(dbCred.credentialPublicKey, 'base64'), counter: dbCred.counter }
      });
    } catch (err) {
      await recordFailedAttempt(user);
      await AuditLog.create({ userEmail: normalizedEmail, action: 'LOGIN_FAILED', details: 'Assertion verification failed: ' + err.message, ipAddress: req.ip });
      return res.status(400).json({ message: 'Authentication verification failed' });
    }

    if (!verification.verified) {
      await expectedChallenge.deleteOne();
      await recordFailedAttempt(user);
      await AuditLog.create({ userEmail: normalizedEmail, action: 'LOGIN_FAILED', details: 'Authentication failed', ipAddress: req.ip });
      return res.status(400).json({ message: 'Authentication verification failed' });
    }

    dbCred.counter = verification.authenticationInfo.newCounter;
    await expectedChallenge.deleteOne();
    await clearFailedAttempts(user);
    await user.save();

    const token = await createSession(user, req, res, !!(req.body && req.body.remember));

    await AuditLog.create({ userEmail: normalizedEmail, action: 'LOGIN', details: 'Passkey authentication successful', ipAddress: req.ip });

    res.json({ verified: true, token, redirect: dashboardRouteForRole(user.role), user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/webauthn/credentials', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json((user.credentials || []).map(c => ({ id: c.credentialID, transports: c.transports, createdAt: user.createdAt })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/webauthn/credentials/:credentialId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const initialCount = user.credentials.length;
    user.credentials = user.credentials.filter(c => c.credentialID !== req.params.credentialId);
    if (user.credentials.length === initialCount) return res.status(404).json({ message: 'Credential not found' });
    await user.save();
    await AuditLog.create({ userEmail: user.email, action: 'PASSKEY_DELETE', details: `Deleted credential ${req.params.credentialId}`, ipAddress: req.ip });
    res.json({ message: 'Credential deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   SESSIONS (A4) — list / revoke / sign out all devices
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json(sessions.map(s => ({
      id: s._id,
      label: s.label,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      revoked: !!s.revokedAt,
      current: req.session && String(s._id) === String(req.session._id)
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/sessions/:id', auth, async (req, res) => {
  try {
    if (req.session && String(req.session._id) === String(req.params.id)) {
      return res.status(400).json({ message: 'To end the current session, use Sign out.' });
    }
    const r = await Session.updateOne({ _id: req.params.id, userId: req.user.id }, { $set: { revokedAt: new Date() } });
    if (!r.matchedCount) return res.status(404).json({ message: 'Session not found' });
    await AuditLog.create({ userEmail: req.user.email, action: 'SESSION_REVOKE', details: 'A device session was revoked', ipAddress: req.ip });
    res.json({ message: 'Session revoked.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/sessions/revoke-all', auth, async (req, res) => {
  try {
    await Session.updateMany(
      { userId: req.user.id, _id: { $ne: req.session._id } },
      { $set: { revokedAt: new Date() } }
    );
    await AuditLog.create({ userEmail: req.user.email, action: 'SESSIONS_REVOKE_ALL', details: 'Signed out all other devices', ipAddress: req.ip });
    res.json({ message: 'Signed out all other devices.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PROFILE (A3) — self-service edits
   ═══════════════════════════════════════════════════════════════════════════ */
router.put('/me', auth, [
  body('name').optional().trim().escape().isLength({ min: 1, max: 120 }),
  body('recoveryEmail').optional().isEmail().normalizeEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.recoveryEmail !== undefined) user.recoveryEmail = req.body.recoveryEmail;
    await user.save();
    await AuditLog.create({ userEmail: user.email, action: 'PROFILE_UPDATE', details: 'Profile details updated', ipAddress: req.ip });
    res.json({ id: user._id, name: user.name, email: user.email, role: user.role, authMethod: user.authMethod, emailVerified: user.emailVerified, recoveryEmail: user.recoveryEmail, createdAt: user.createdAt });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GDPR (E6) — export / self-service deletion
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/me/export', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const [bookings, shipments, messages, notifications, audit] = await Promise.all([
      Booking.find({ $or: [{ userId: user._id }, { customerEmail: user.email }] }).lean(),
      Shipment.find({ $or: [{ customerId: user._id }, { customerEmail: user.email }, { driverEmail: user.email }, { assignedDriverId: user._id }] }).lean(),
      Message.find({ $or: [{ fromEmail: user.email }, { toEmail: user.email }] }).lean(),
      Notification.find({ userId: user._id }).lean(),
      AuditLog.find({ userEmail: user.email }).lean()
    ]);
    await AuditLog.create({ userEmail: user.email, action: 'DATA_EXPORT', details: 'Personal data exported', ipAddress: req.ip });
    res.json({
      exportedAt: new Date(),
      profile: { id: user._id, name: user.name, email: user.email, role: user.role, authMethod: user.authMethod, emailVerified: user.emailVerified, createdAt: user.createdAt },
      bookings, shipments, messages, notifications, audit
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/me', auth, async (req, res) => {
  try {
    const confirm = req.body && req.body.confirm;
    if (confirm !== 'DELETE') return res.status(400).json({ message: 'Pass { confirm: "DELETE" } to delete your account.' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const email = user.email;
    await Session.deleteMany({ userId: user._id });
    await Notification.deleteMany({ userId: user._id });
    await Challenge.deleteMany({ email });
    await User.findByIdAndDelete(user._id);
    await AuditLog.create({ userEmail: email, action: 'ACCOUNT_DELETE', details: 'Account deleted by owner (GDPR)', ipAddress: req.ip });
    res.clearCookie(COOKIE_NAME); res.clearCookie('token'); res.clearCookie(REFRESH_COOKIE);
    res.json({ message: 'Account deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   LOGOUT / REFRESH
   ═══════════════════════════════════════════════════════════════════════════ */
router.post('/logout', async (req, res) => {
  const token = req.cookies?.auth_token || req.cookies?.token;
  if (token) addInvalidatedToken(token);
  if (req.session && req.session._id) {
    await Session.updateOne({ _id: req.session._id }, { $set: { revokedAt: new Date() } }).catch(() => {});
  }
  res.clearCookie(COOKIE_NAME);
  res.clearCookie('token');
  res.clearCookie(REFRESH_COOKIE);
  await AuditLog.create({ userEmail: req.user?.email || 'anonymous', action: 'LOGOUT', details: 'User signed out', ipAddress: req.ip });
  res.json({ message: 'Logged out' });
});

// Rotating refresh token → new access token (+ new refresh cookie).
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const refresh = req.cookies && req.cookies[REFRESH_COOKIE];
    if (!refresh) return res.status(401).json({ message: 'No refresh token' });
    let decoded;
    try {
      decoded = jwt.verify(refresh, JWT_SECRET);
    } catch (_e) {
      res.clearCookie(REFRESH_COOKIE);
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    if (decoded.type !== 'refresh') return res.status(401).json({ message: 'Invalid refresh token' });
    const refreshHash = sha256(refresh);
    const session = await Session.findOne({ refreshHash });
    if (!session || session.revokedAt || (session.expiresAt && session.expiresAt < new Date())) {
      res.clearCookie(REFRESH_COOKIE);
      return res.status(401).json({ message: 'Session expired or revoked' });
    }
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'Account not found' });

    const accessTtl = process.env.SESSION_EXPIRES_IN || '8h';
    const refreshTtl = process.env.REFRESH_EXPIRES_IN || '14d';
    const newAccess = createAccessToken(user, accessTtl);
    const newRefresh = createRefreshToken(user, refreshTtl);
    await Session.updateOne({ _id: session._id }, {
      $set: {
        tokenHash: sha256(newAccess),
        refreshHash: sha256(newRefresh),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + ttlToMs(refreshTtl))
      }
    });
    res.cookie(COOKIE_NAME, newAccess, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: ttlToMs(accessTtl) });
    res.cookie(REFRESH_COOKIE, newRefresh, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ttlToMs(refreshTtl) });
    res.json({ token: newAccess, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/verify', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-recoveryEmail -recoveryCodes');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      valid: true,
      redirect: dashboardRouteForRole(user.role),
      user: { id: user._id, name: user.name, email: user.email, role: user.role, authMethod: user.authMethod, emailVerified: user.emailVerified }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-recoveryCodes');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      id: user._id, name: user.name, email: user.email, role: user.role,
      authMethod: user.authMethod, emailVerified: user.emailVerified,
      recoveryEmail: user.recoveryEmail,
      credentialCount: (user.credentials || []).length,
      createdAt: user.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/me/credentials', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('credentials createdAt');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ credentials: (user.credentials || []).map(c => ({ credentialID: c.credentialID, credentialPublicKey: c.credentialPublicKey, counter: c.counter, transports: c.transports })) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
