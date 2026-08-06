const mongoose = require('mongoose');

/**
 * Persistent session store.
 *
 * Replaces the in-memory only tokenStore for access-token lifecycle: every
 * login mints a Session row keyed by the SHA-256 hash of the access token
 * (raw tokens are never stored). The row also tracks the refresh token hash
 * so "sign out all devices" / logout can revoke the whole chain at once.
 *
 * The auth middleware (`middleware/auth.js`) looks up this collection on
 * every authenticated request and rejects revoked or expired sessions.
 */
const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  refreshHash: { type: String, index: true },
  label: { type: String, default: 'Unknown device' },
  userAgent: { type: String },
  ip: { type: String },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date }
});

// TTL index: fully-expired sessions are cleaned up by Mongo automatically.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', SessionSchema);
