const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, enum: ['Admin', 'Driver', 'Customer'], default: 'Customer' },
  authMethod: { type: String, default: 'Passkey' },
  publicKey: { type: String },
  credentialId: { type: String },
  credentialPublicKey: { type: String },
  credentialCounter: { type: Number, default: 0 },
  recoveryEmail: { type: String },
  createdAt: { type: Date, default: Date.now },
  credentials: {
    type: [{
      credentialID: { type: String, required: true },
      credentialPublicKey: { type: String, required: true },
      counter: { type: Number, default: 0 },
      transports: [String]
    }],
    default: []
  },

  // ── Hardening (Phase A) ─────────────────────────────────────────
  emailVerified: { type: Boolean, default: false },
  // Account lockout: failed attempts accumulate; once >= LOCKOUT_THRESHOLD
  // (routes/auth.js) the account rejects further WebAuthn challenges until
  // lockedUntil passes.
  failedLoginCount: { type: Number, default: 0 },
  lockedUntil: { type: Date },
  lastLoginAt: { type: Date },
  // One-time recovery codes (SHA-256 hashed; plaintext shown exactly once).
  recoveryCodes: {
    type: [{
      hash: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
      usedAt: { type: Date }
    }],
    default: []
  }
});
module.exports = mongoose.model('User', UserSchema);
