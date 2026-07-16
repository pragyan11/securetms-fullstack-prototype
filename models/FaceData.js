const mongoose = require('mongoose');

// Stores a reference to a user's facial image for authentication.
// In a production system this would likely be a hashed representation
// or a reference to a vector stored in a dedicated service. For this
// prototype we keep the raw base64 PNG data.
const FaceDataSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  image: { type: String, required: true } // base64 data URL
});

module.exports = mongoose.model('FaceData', FaceDataSchema);
