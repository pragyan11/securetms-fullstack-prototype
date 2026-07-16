const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const fleetRoutes = require('./routes/fleet');
const shipmentRoutes = require('./routes/shipments');
const adminRoutes = require('./routes/admin');
const logRoutes = require('./routes/logs');
const debugRoutes = require('./routes/debug');
const User = require('./models/User');
const Booking = require('./models/Booking');
const Vehicle = require('./models/Vehicle');
const Shipment = require('./models/Shipment');
const AuditLog = require('./models/AuditLog');

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MONGO_URI is missing in .env file');
  process.exit(1);
}

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
// Increase JSON body size limit to handle webcam image data (up to 5MB)
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 200 }));
app.use(express.static('public'));

app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/debug', debugRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SecureTMS API' });
});

async function seedDemoData() {
  const [userCount, bookingCount, shipmentCount, vehicleCount, logCount] = await Promise.all([
    User.countDocuments(),
    Booking.countDocuments(),
    Shipment.countDocuments(),
    Vehicle.countDocuments(),
    AuditLog.countDocuments()
  ]);

  if (userCount === 0) {
    const admin = await User.create({
      name: 'Ava Reynolds',
      email: 'admin@securetms.com',
      role: 'Admin',
      authMethod: 'Passkey',
      recoveryEmail: 'recovery@securetms.com'
    });
    await User.create({
      name: 'Liam Carter',
      email: 'customer@securetms.com',
      role: 'Customer',
      authMethod: 'Passkey',
      recoveryEmail: 'customer-recovery@securetms.com'
    });
    await AuditLog.create({
      userEmail: admin.email,
      action: 'REGISTER',
      details: 'Demo admin seeded for SecureTMS operations',
      ipAddress: '127.0.0.1'
    });
  }

  if (bookingCount === 0) {
    await Booking.create([
      {
        userId: (await User.findOne({ role: 'Customer' }))?._id,
        customerName: 'Liam Carter',
        origin: 'Chicago, IL',
        destination: 'Detroit, MI',
        status: 'Pending'
      },
      {
        userId: (await User.findOne({ role: 'Customer' }))?._id,
        customerName: 'Liam Carter',
        origin: 'Milwaukee, WI',
        destination: 'Cleveland, OH',
        status: 'Completed'
      }
    ]);
  }

  if (vehicleCount === 0) {
    await Vehicle.create([
      {
        vehicleNumber: 'TRK-001',
        vehicleType: 'Truck',
        driverName: 'Marcus Lee',
        location: 'Chicago Yard',
        status: 'In Transit',
        updatedAt: new Date()
      },
      {
        vehicleNumber: 'VAN-214',
        vehicleType: 'Van',
        driverName: 'Sofia Cruz',
        location: 'Detroit Hub',
        status: 'Available',
        updatedAt: new Date()
      },
      {
        vehicleNumber: 'BIK-047',
        vehicleType: 'Bike',
        driverName: 'Noah Brooks',
        location: 'Maintenance Bay',
        status: 'Maintenance',
        updatedAt: new Date()
      }
    ]);
  }

  if (shipmentCount === 0) {
    await Shipment.create([
      {
        shipmentId: 'SHP-1001',
        vehicleNumber: 'TRK-001',
        driverName: 'Marcus Lee',
        status: 'In Transit',
        location: 'Indiana Corridor',
        updatedAt: new Date()
      },
      {
        shipmentId: 'SHP-1002',
        vehicleNumber: 'VAN-214',
        driverName: 'Sofia Cruz',
        status: 'Delivered',
        location: 'Detroit Hub',
        updatedAt: new Date()
      }
    ]);
  }

  if (logCount === 0) {
    await AuditLog.create([
      {
        userEmail: 'admin@securetms.com',
        action: 'LOGIN',
        details: 'Admin console accessed',
        ipAddress: '127.0.0.1'
      },
      {
        userEmail: 'customer@securetms.com',
        action: 'BOOKING_CREATE',
        details: 'Demo booking created for transport coordination',
        ipAddress: '127.0.0.1'
      }
    ]);
  }
}

function startHttpServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is busy. Trying ${port + 1}...`);
      startHttpServer(port + 1);
      return;
    }

    console.error('Server startup error:', err.message);
    process.exit(1);
  });
}

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    console.log('MongoDB connected');
    await seedDemoData();
    startHttpServer(PORT);
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });