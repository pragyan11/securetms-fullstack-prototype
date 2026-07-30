const mongoose = require('mongoose');
const crypto = require('crypto');

const InviteSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },
  role: {
    type: String,
    enum: ['Admin'],
    required: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    index: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  invitedByEmail: { type: String },
  note: { type: String },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)  // 7 days
  },
  used: { type: Boolean, default: false },
  usedAt: { type: Date },
  usedByEmail: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// TTL index: Mongo will auto-clean up fully expired unused invites after their date.
InviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Invite', InviteSchema);
