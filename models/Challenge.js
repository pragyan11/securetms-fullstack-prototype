const mongoose = require('mongoose');

const ChallengeSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  challenge: { type: String, required: true },
  type: { type: String, enum: ['register', 'login'], required: true },
}, { timestamps: true });

ChallengeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

module.exports = mongoose.model('Challenge', ChallengeSchema);
