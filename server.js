const dotenv = require('dotenv');
// .env.local (real Gmail SMTP creds, per-machine overrides) takes precedence,
// then .env fills in anything else. dotenv does not overwrite already-set vars,
// so loading .env.local first keeps its values. Guarded so environments without
// .env.local (CI, teammates, prod) boot without a dotenv warning.
if (require('fs').existsSync('./.env.local')) dotenv.config({ path: './.env.local' });
dotenv.config({ path: './.env' });

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const logger = require('./lib/logger'); // Winston logger shared with services (lib/logger.js)

const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const fleetRoutes = require('./routes/fleet');
const shipmentRoutes = require('./routes/shipments');
const adminRoutes = require('./routes/admin');
const adminInviteRoutes = require('./routes/admin-invites');
const logRoutes = require('./routes/logs');
const geocodeRoutes = require('./routes/geocode');
const messageRoutes = require('./routes/messages');
const maintenanceRoutes = require('./routes/maintenance');
const emailService = require('./services/email');
const gpsSim = require('./services/gpsSimulation');
const Challenge = require('./models/Challenge');
const User = require('./models/User');
const Booking = require('./models/Booking');
const Vehicle = require('./models/Vehicle');
const Shipment = require('./models/Shipment');
const AuditLog = require('./models/AuditLog');

const app = express();
const { Server } = require('socket.io');

// io is initialised inside startHttpServer; this middleware gives every
// route handler access to the live Socket.io instance via req.io.
// It is safe that `io` is null here: no routes are mounted (or reachable)
// until after startHttpServer() assigns it, so `req.io` is always truthy
// by the time a route handler runs.
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Make the skeleton-shipment helper available to route handlers.
app.set('attachSkeletonShipment', attachSkeletonShipment);
const { isDevMode } = require('./lib/devMode');
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
        imgSrc: ["'self'", "data:", "https://a.tile.openstreetmap.org", "https://b.tile.openstreetmap.org", "https://c.tile.openstreetmap.org"],
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

// Static assets with strict no-cache for HTML and JS. We pass a
// `cacheControl` option to express.static so its `send` library emits our
// header instead of its built-in `public, max-age=0`. The setHeaders hook
// still runs and we use it to upgrade caching for non-code static assets.
app.use(express.static('public', {
  etag: true,
  lastModified: true,
  cacheControl: 'no-cache, no-store, must-revalidate',
  setHeaders: (res, filePath) => {
    // Long-lived caching only for genuine static assets (fonts, images,
    // vendor JS under /libs/). HTML, JS bundles and CSS keep the strict
    // no-store default above so style/layout changes never linger in the
    // browser cache during development (stale CSS is the #1 cause of
    // 'I don't see the change' after editing stylesheets).
    const lower = String(filePath || '').toLowerCase();
    if (!lower.endsWith('.html') && !lower.endsWith('.js') && !lower.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// Clean routes for the role-based pages. express.static('public') already
// serves these by name; the explicit handlers just guarantee stable URLs.
// Cache-Control headers come from the wrapper above (setHeader interceptor).
const pageHandlers = ['login', 'register', 'dashboard', 'customer', 'driver', 'admin-onboard', 'user_details'];
pageHandlers.forEach((name) => {
  app.get('/' + name, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${name}.html`));
  });
  app.get('/' + name + '.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${name}.html`));
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/invites', adminInviteRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/geocode', geocodeRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/maintenance', maintenanceRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SpeedX API' });
});

async function seedDemoData() {
  const [userCount, bookingCount, shipmentCount, vehicleCount, logCount] = await Promise.all([
    User.countDocuments(),
    Booking.countDocuments(),
    Shipment.countDocuments(),
    Vehicle.countDocuments(),
    AuditLog.countDocuments()
  ]);

  // Seed the canonical demo accounts idempotently (create-if-missing) but
  // ONLY in dev mode. Production deployments stay empty until real users
  // register (Customer/Driver) or are invited (Admin). Avoids polluting
  // production user lists with dangling Passkey-but-no-credentials accounts.
  // isDevMode() is shared with routes/auth.js — see lib/devMode.js.
  const devMode = isDevMode();
  if (devMode) {
    const demoAccounts = [
      {
        name: 'Liam Carter',
        email: 'customer@securetms.com',
        role: 'Customer',
        authMethod: 'Passkey',
        recoveryEmail: 'customer-recovery@securetms.com'
      },
      {
        name: 'Marcus Lee',
        email: 'driver@securetms.com',
        role: 'Driver',
        authMethod: 'Passkey',
        recoveryEmail: 'driver-recovery@securetms.com'
      }
    ];
    const createdNow = [];
    for (const acc of demoAccounts) {
      if (!(await User.findOne({ email: acc.email }))) {
        await User.create(acc);
        createdNow.push(acc.email);
      }
    }
    if (createdNow.length) {
      logger.info('Seeded demo accounts: ' + createdNow.join(', ') + ' (sign in via the dev login panel when ALLOW_DEV_LOGIN=1 and NODE_ENV != production).');
    }

    // Demo admin: same gate as the customer/driver seeds above. Without an
    // admin identity in dev mode there is nothing for the dev-login bypass
    // to authenticate as for the admin role.
    //
    // We use findOneAndUpdate so the seed is idempotent across server
    // restarts AND repairs stale databases that already had the
    // admin@securetms.com account from an earlier code path with the wrong
    // role. Without the repair branch, a database created before the admin
    // seed was added — or hand-edited during testing — would silently keep
    // role="Customer" forever, the dev-login panel would mint a Customer
    // JWT for it, and /dashboard.html's user-chip would render the chip
    // as if a customer were logged in. role is in $set (always correct
    // after the call), while name/authMethod/recoveryEmail live in
    // $setOnInsert so a future rename via the admin UI is never clobbered
    // by the next server boot. WebAuthn credentials are not touched.
    const devAdminEmail = 'admin@securetms.com';
    const devAdmin = await User.findOneAndUpdate(
      { email: devAdminEmail },
      {
        $set: { role: 'Admin' },
        $setOnInsert: {
          name: 'Demo Admin',
          email: devAdminEmail,
          authMethod: 'Passkey',
          recoveryEmail: 'admin-recovery@securetms.com'
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select('email role name');
    logger.info('Dev admin ready: ' + devAdmin.email + ' \u2014 role=' + devAdmin.role + ', name="' + devAdmin.name + '"');
  } else {
    // Production / ambiguous boot: log the skip so operators can confirm a
    // fresh production DB is intentionally empty.
    logger.info('Demo seed accounts skipped (NODE_ENV=' + (process.env.NODE_ENV || 'unset') + '; ALLOW_DEV_LOGIN=' + (process.env.ALLOW_DEV_LOGIN || 'unset') + ') — production starts empty until users register or are invited.');
  }

  // Demo accounts + admin seeding consolidated into the `if (devMode)` block
  // above to avoid any cross-block-scope variables.

  // The demo bookings, vehicles, shipments and logs below should only be
  // created on a fresh dev-mode install so production starts empty.
  if (!devMode) {
    logger.info('Demo data seeding skipped (NODE_ENV=' + (process.env.NODE_ENV || 'unset') + '; ALLOW_DEV_LOGIN=' + (process.env.ALLOW_DEV_LOGIN || 'unset') + ')');
    return;
  }

  if (bookingCount === 0) {
    await Booking.create([
      {
        userId: (await User.findOne({ role: 'Customer' }))?._id,
        customerName: 'Liam Carter',
        origin: 'Sydney, Australia',
        destination: 'Melbourne, Australia',
        status: 'Pending'
      },
      {
        userId: (await User.findOne({ role: 'Customer' }))?._id,
        customerName: 'Liam Carter',
        origin: 'Melbourne, Australia',
        destination: 'Brisbane, Australia',
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
        location: 'Sydney, Australia',
        status: 'In Transit',
        updatedAt: new Date()
      },
      {
        vehicleNumber: 'VAN-214',
        vehicleType: 'Van',
        driverName: 'Sofia Cruz',
        location: 'Melbourne, Australia',
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
    // Seed shipments are linked to the demo driver so the driver dashboard
    // has data on a fresh install. driverEmail + driverName both set so the
    // shipments.js driver filter matches either field.
    const driver = await User.findOne({ role: 'Driver' });
    await Shipment.create([
      {
        trackingId: 'SHP-1001',
        bookingId: (await Booking.findOne({ status: 'Pending' }))?._id,
        customerId: (await User.findOne({ role: 'Customer' }))?._id,
        customerName: 'Liam Carter',
        vehicleNumber: 'TRK-001',
        driverName: driver ? driver.name : 'Marcus Lee',
        driverEmail: driver ? driver.email : null,
        assignedDriverId: driver ? driver._id : undefined,
        pickupAddress: 'Sydney, Australia',
        deliveryAddress: 'Melbourne, Australia',
        status: 'In Transit',
        currentLocation: 'Alpine Route',
        eta: '4h 30m',
        updatedAt: new Date()
      },
      {
        trackingId: 'SHP-1002',
        bookingId: (await Booking.findOne({ status: 'Completed' }))?._id,
        customerId: (await User.findOne({ role: 'Customer' }))?._id,
        customerName: 'Liam Carter',
        vehicleNumber: 'VAN-214',
        driverName: 'Sofia Cruz',
        driverEmail: 'sofia@securetms.com',
        pickupAddress: 'Melbourne, Australia',
        deliveryAddress: 'Brisbane, Australia',
        status: 'Delivered',
        currentLocation: 'Brisbane Hub',
        eta: 'Delivered',
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

async function attachSkeletonShipment(bookingDoc) {
  try {
    const driver = await User.findOne({ role: 'Driver' });
    const vehicle = await Vehicle.findOne({ status: 'Available' });
    const trackingId = 'SHP-' + String(bookingDoc._id).slice(-6).toUpperCase();
    // Atomic upsert keyed on bookingId so concurrent POSTs from a double-submit
    // are idempotent: a second call gets the same shipment back instead of
    // creating a duplicate with the same trackingId.
    return await Shipment.findOneAndUpdate(
      { bookingId: bookingDoc._id },
      {
        $setOnInsert: {
          trackingId,
          bookingId: bookingDoc._id,
          customerId: bookingDoc.userId,
          customerName: bookingDoc.customerName,
          vehicleNumber: vehicle ? vehicle.vehicleNumber : undefined,
          driverName: driver ? driver.name : undefined,
          driverEmail: driver ? driver.email : undefined,
          assignedDriverId: driver ? driver._id : undefined,
          pickupAddress: bookingDoc.origin,
          deliveryAddress: bookingDoc.destination,
          status: 'Created',
          currentLocation: 'Awaiting dispatch',
          eta: 'Pending',
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    logger.warn('attachSkeletonShipment failed: ' + e.message);
    return null;
  }
}

function startHttpServer(port) {
  const server = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });

  io = new Server(server, {
    cors: {
      origin: FRONTEND_ORIGINS,
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });

  // Start live GPS simulation
  emailService.initTransporter();
  gpsSim.initGPSSimulation(io);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} is busy.`);
      // Do not auto-retry: a retry would start a second server while the
      // first is still bound, and callers expect a predictable port. The
      // operator should free the port or set PORT explicitly.
      process.exit(1);
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