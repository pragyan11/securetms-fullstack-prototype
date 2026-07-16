const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/securetms', { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to MongoDB');
    const res = await User.deleteMany({ email: { $in: ['test@example.com', 'customer@securetms.com'] } });
    console.log('Deleted users:', res.deletedCount);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();