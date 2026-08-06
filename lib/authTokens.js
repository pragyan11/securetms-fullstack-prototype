'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

/** Access token — the thing that authenticates API calls. */
function createAccessToken(user, ttl) {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role, name: user.name, type: 'access' },
    JWT_SECRET,
    { expiresIn: ttl || process.env.SESSION_EXPIRES_IN || '8h' }
  );
}

/** Refresh token — long-lived, rotates on every use. Stored hashed in the Session row. */
function createRefreshToken(user, ttl) {
  return jwt.sign(
    { id: user._id, email: user.email, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: ttl || process.env.REFRESH_EXPIRES_IN || '14d' }
  );
}

/**
 * Signed one-time token for flows that arrive by email/URL:
 * email verification, passkey recovery, etc.
 * `payload` is a plain object merged into the JWT claims; `type` names the flow.
 */
function createSignedToken(type, payload, ttlSeconds) {
  return jwt.sign(
    Object.assign({ type, purpose: type }, payload || {}),
    JWT_SECRET,
    { expiresIn: ttlSeconds }
  );
}

/** Verify a signed one-time token; returns the decoded payload or null. */
function verifySignedToken(type, token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== type) return null;
    return decoded;
  } catch (_e) {
    return null;
  }
}

module.exports = { sha256, createAccessToken, createRefreshToken, createSignedToken, verifySignedToken };
