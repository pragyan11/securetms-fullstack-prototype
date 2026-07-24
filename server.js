const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const winston = require('winston');

const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const fleetRoutes = require('./routes/fleet');
const shipmentRoutes = require('./routes/shipments');
const adminRoutes = require('./routes/admin');
const logRoutes = require('./routes/logs');
const Challenge = require('./models/Challenge');
const User = require('./models/User');
const Booking = require('./models/Booking');
const Vehicle = require('./models/Vehicle');
const Shipment = require('./models/Shipment');
const AuditLog = require('./models/AuditLog');

const app = express();
// Winston logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' })
  ]
});
const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  logger.error('MONGO_URI is missing in .env file');
  process.exit(1);
}

// Validate essential environment variables for WebAuthn and JWT
const requiredEnv = ['RP_ID', 'EXPECTED_ORIGIN', 'JWT_SECRET', 'RP_NAME'];
for (const varName of requiredEnv) {
  if (!process.env[varName]) {
    logger.error(`${varName} is missing in .env file`);
    process.exit(1);
  }
}

// Configure Helmet with a relaxed script-src to allow TensorFlow.js which uses eval internally.
// Extend CSP to allow loading external scripts (SimpleWebAuthn) and any required
// connections for fetching those scripts. We keep the default-src restrictive but
// explicitly whitelist the CDN for both script-src and script-src-elem. Adding
// connect-src ensures fetch/XHR requests to the CDN are permitted (useful for
// debugging and future dynamic imports).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://maps.googleapis.com"],
        // Allow script elements from the CDN (required for <script src=...>)
        "script-src-elem": ["'self'", "https://cdn.jsdelivr.net", "https://maps.googleapis.com"],
        // Permit fetching the script via XHR/fetch (used in our diagnostic test)
        connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
        // Keep other defaults unchanged
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);
const FRONTEND_ORIGINS = (process.env.FRONTEND_URL || `http://localhost:${PORT}`).split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || FRONTEND_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};
app.use(cors(corsOptions));

if (process.env.NODE_ENV === 'production') {
  app.enable('trust proxy');
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(`https://${req.hostname}${req.url}`);
    }
    next();
  });
}
// Increase JSON body size limit to handle webcam image data (up to 5MB)
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
// Correct rate limiting configuration: use 'max' to specify the request limit per window.
// The previous 'limit' option was invalid, causing the middleware to block all requests with 429.
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
app.use(express.static('public'));

// Support extensionless auth routes used by dashboard redirects.
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// SecureTMS dashboard entry route.
app.get('/dashboard*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/logs', logRoutes);

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
    logger.info(`Server running on port ${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} is busy. Trying ${port + 1}...`);
      startHttpServer(port + 1);
      return;
    }

    logger.error(`Server startup error: ${err.message}`);
    process.exit(1);
  });
}

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    logger.info('MongoDB connected');
    await seedDemoData();
    startHttpServer(PORT);
  })
  .catch((err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  });