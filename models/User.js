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
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('User', UserSchema);
