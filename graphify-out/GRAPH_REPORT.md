# Graph Report - .  (2026-07-29)

## Corpus Check
- 75 files · ~51,003 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 442 nodes · 673 edges · 34 communities (29 shown, 5 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- NPM Dependencies
- Servesry Bootstrapping
- Leaflet Map Library (min)
- Shared Auth Client
- Auth Challenges & Dev Mode
- Admin Dashboard Page
- Invite Token Crypto
- Minified Bundle Chunks
- Minified Bundle Chunks
- Landing Page (index)
- SimpleWebAuthn Browser (min)
- Vehicles & Admin Routes
- Shipments Schema & API
- Driver Page UI
- Admin Frontend Loader
- Admin Invites API
- Role Middleware / Fleet
- Bookings Schema & API
- Customer Page UI
- JWT Auth Middleware
- Minified Bundle Chunks
- UI Utility Helpers
- Ambient Visual Effects
- Admin Onboarding Page
- Minified Bundle Chunks
- Minified Bundle Chunks
- Register Page UI
- AuditLog Mongo Model
- FaceData Mongo Model
- Fleet Mongo Model
- User Details Page

## God Nodes (most connected - your core abstractions)
1. `boot()` - 13 edges
2. `refreshAll()` - 11 edges
3. `bindSocketHandlers()` - 11 edges
4. `api()` - 10 edges
5. `arr()` - 10 edges
6. `wireQuickButtons()` - 10 edges
7. `onTabVisible()` - 10 edges
8. `e()` - 9 edges
9. `m()` - 8 edges
10. `persistAuth()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `devLoginEnabled()` --calls--> `isDevMode()`  [EXTRACTED]
  routes/auth.js → lib/devMode.js
- `seedDemoData()` --calls--> `isDevMode()`  [EXTRACTED]
  server.js → lib/devMode.js
- `boot()` --indirect_call--> `p()`  [INFERRED]
  public/index-modern.js → public/libs/leaflet/leaflet.js
- `zi()` --indirect_call--> `n()`  [INFERRED]
  public/libs/leaflet/leaflet.js → public/libs/simplewebauthn-browser.umd.min.js

## Import Cycles
- None detected.

## Communities (34 total, 5 thin omitted)

### Community 0 - "NPM Dependencies"
Cohesion: 0.05
Nodes (40): cookie-parser, cors, dotenv, express, express-rate-limit, express-validator, helmet, jsonwebtoken (+32 more)

### Community 1 - "Servesry Bootstrapping"
Cohesion: 0.05
Nodes (37): express, geocodeLimiter, rateLimit, router, adminInviteRoutes, adminRoutes, app, attachSkeletonShipment() (+29 more)

### Community 2 - "Leaflet Map Library (min)"
Cohesion: 0.07
Nodes (7): a(), Ci(), ei(), ii(), l(), ri(), x()

### Community 3 - "Shared Auth Client"
Cohesion: 0.15
Nodes (29): api(), checkWebAuthnOrigin(), dashboardForRole(), decodeJwt(), devLogin(), ensureSimpleWebAuthnBrowser(), ensureToastContainer(), get() (+21 more)

### Community 4 - "Auth Challenges & Dev Mode"
Cohesion: 0.07
Nodes (23): isDevMode(), ChallengeSchema, mongoose, AuditLog, auth, { body, validationResult }, Challenge, crypto (+15 more)

### Community 5 - "Admin Dashboard Page"
Cohesion: 0.22
Nodes (26): arr(), bindSocketHandlers(), bootAdminPage(), clearSkeleton(), createInvite(), debouncedLoad(), fillIdentity(), fillIdentityBanner() (+18 more)

### Community 6 - "Invite Token Crypto"
Cohesion: 0.09
Nodes (17): crypto, InviteSchema, mongoose, mongoose, UserSchema, express, router, User (+9 more)

### Community 7 - "Minified Bundle Chunks"
Cohesion: 0.14
Nodes (15): Ae(), be(), h(), Ie(), j(), Jt(), ke(), Le() (+7 more)

### Community 8 - "Minified Bundle Chunks"
Cohesion: 0.20
Nodes (15): at(), c(), d(), e(), F(), hi(), m(), p() (+7 more)

### Community 9 - "Landing Page (index)"
Cohesion: 0.27
Nodes (13): boot(), fadeInNow(), initDeepDiveReveals(), initEasterEgg(), initFeatureTilt(), initHero(), initMagneticButtons(), initNavbarScrollState() (+5 more)

### Community 10 - "SimpleWebAuthn Browser (min)"
Cohesion: 0.16
Nodes (5): h(), i(), n(), r(), s

### Community 11 - "Vehicles & Admin Routes"
Cohesion: 0.15
Nodes (11): mongoose, VehicleSchema, AuditLog, auth, Booking, express, requireRole, router (+3 more)

### Community 12 - "Shipments Schema & API"
Cohesion: 0.17
Nodes (10): mongoose, ShipmentSchema, AuditLog, auth, { body, validationResult }, Booking, express, mongoose (+2 more)

### Community 13 - "Driver Page UI"
Cohesion: 0.32
Nodes (10): bootDriverPage(), clearDriverTicker(), fillIdentity(), initDriverMap(), loadRoutes(), pillForStatus(), renderRouteCard(), wireNavLinks() (+2 more)

### Community 14 - "Admin Frontend Loader"
Cohesion: 0.25
Nodes (6): hideAllAdminSections(), loadAdminBookings(), loadAdminShipments(), loadAdminUsers(), loadUserLogs(), showAdminSection()

### Community 15 - "Admin Invites API"
Cohesion: 0.18
Nodes (9): AuditLog, auth, { body, validationResult }, crypto, express, Invite, requireRole, router (+1 more)

### Community 16 - "Role Middleware / Fleet"
Cohesion: 0.20
Nodes (7): AuditLog, auth, { body, validationResult }, express, requireRole, router, Vehicle

### Community 17 - "Bookings Schema & API"
Cohesion: 0.20
Nodes (8): BookingSchema, mongoose, AuditLog, auth, { body, validationResult }, Booking, express, router

### Community 18 - "Customer Page UI"
Cohesion: 0.42
Nodes (9): bootCustomerPage(), clearCustomerTicker(), fillIdentity(), initCustomerMap(), loadDeliveries(), setKPIs(), showTab(), wireNavLinks() (+1 more)

### Community 19 - "JWT Auth Middleware"
Cohesion: 0.22
Nodes (6): jwt, AuditLog, auth, express, requireRole, router

### Community 20 - "Minified Bundle Chunks"
Cohesion: 0.28
Nodes (9): G(), i(), k(), me(), Mi(), Oe(), Se(), ze() (+1 more)

### Community 21 - "UI Utility Helpers"
Cohesion: 0.28
Nodes (3): cell(), emptyState(), escapeHtml()

### Community 23 - "Admin Onboarding Page"
Cohesion: 0.70
Nodes (4): checkInvite(), registerAdmin(), setMsg(), showInvalid()

### Community 24 - "Minified Bundle Chunks"
Cohesion: 0.50
Nodes (4): bi(), Pi(), Ti(), u()

### Community 25 - "Minified Bundle Chunks"
Cohesion: 0.67
Nodes (4): Je(), ni(), oi(), si()

### Community 26 - "Register Page UI"
Cohesion: 1.00
Nodes (3): bootRegisterPage(), select(), wire()

## Knowledge Gaps
- **148 isolated node(s):** `jwt`, `mongoose`, `AuditLogSchema`, `mongoose`, `BookingSchema` (+143 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `p()` connect `Minified Bundle Chunks` to `Landing Page (index)`, `Leaflet Map Library (min)`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `zi()` connect `Minified Bundle Chunks` to `Leaflet Map Library (min)`, `SimpleWebAuthn Browser (min)`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `boot()` connect `Landing Page (index)` to `Minified Bundle Chunks`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `refreshAll()` (e.g. with `loadBookings()` and `loadFleet()`) actually correct?**
  _`refreshAll()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `bindSocketHandlers()` (e.g. with `loadBookings()` and `loadFleet()`) actually correct?**
  _`bindSocketHandlers()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `jwt`, `mongoose`, `AuditLogSchema` to the rest of the system?**
  _148 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `NPM Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._