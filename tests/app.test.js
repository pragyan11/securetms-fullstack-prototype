/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX unit tests — pure logic only (no DB, no network).
   Run with: npm test   (node --test tests/)
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calculatePrice, estimateDistanceKm, makeInvoiceNumber, DEFAULT_SETTINGS } = require('../services/quote');
const { canShipmentTransition, canBookingTransition, SHIPMENT_TRANSITIONS, BOOKING_TRANSITIONS } = require('../services/statusTransitions');
const { sha256, createSignedToken, verifySignedToken } = require('../lib/authTokens');

/* ── Quote engine (C3) ──────────────────────────────────────────── */
test('quote: standard priority, central zone, 1km', () => {
  const r = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'Central', priority: 'Standard', distanceKm: 1 });
  assert.equal(r.currency, 'USD');
  assert.ok(r.price > 0, 'price must be positive');
  assert.equal(r.breakdown.priorityMultiplier, 1);
});

test('quote: priority multipliers scale the price', () => {
  const base = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'Central', priority: 'Standard', distanceKm: 10 });
  const exp = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'Central', priority: 'Express', distanceKm: 10 });
  const pri = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'Central', priority: 'Priority', distanceKm: 10 });
  assert.ok(exp.price > base.price, 'Express > Standard');
  assert.ok(pri.price > exp.price, 'Priority > Express');
});

test('quote: distance increases price monotonically', () => {
  const near = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'North', distanceKm: 1 });
  const far = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'North', distanceKm: 50 });
  assert.ok(far.price > near.price);
});

test('quote: weight surcharge applies above 100kg', () => {
  const light = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'Central', weightKg: 50 });
  const heavy = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'Central', weightKg: 350 });
  assert.ok(heavy.price > light.price, 'heavy shipments cost more');
});

test('quote: negative or missing inputs are clamped', () => {
  const r = calculatePrice(DEFAULT_SETTINGS, { serviceZone: 'Central', distanceKm: -5, weightKg: -1 });
  assert.equal(r.breakdown.distanceKm, 1);
  assert.equal(r.breakdown.weightKg, 0);
});

test('estimateDistanceKm is deterministic and >= 1', () => {
  const a = estimateDistanceKm('Sydney, Australia', 'Melbourne, Australia');
  const b = estimateDistanceKm('Sydney, Australia', 'Melbourne, Australia');
  assert.equal(a, b, 'same route must quote the same distance');
  assert.ok(a >= 1);
  assert.equal(estimateDistanceKm('', ''), 1);
});

test('makeInvoiceNumber has the INV-YYYY-XXXXXX shape', () => {
  const n = makeInvoiceNumber('64c9a1b2c3d4e5f6a7b8c9d0');
  assert.match(n, /^INV-\d{4}-[A-F0-9]{6}$/);
});

/* ── Status transitions (D3) ────────────────────────────────────── */
test('shipment transitions: valid moves', () => {
  assert.equal(canShipmentTransition('Created', 'Picked Up'), true);
  assert.equal(canShipmentTransition('Picked Up', 'In Transit'), true);
  assert.equal(canShipmentTransition('In Transit', 'Delivered'), true);
  assert.equal(canShipmentTransition('Created', 'Cancelled'), true);
});

test('shipment transitions: illegal jumps rejected', () => {
  assert.equal(canShipmentTransition('Created', 'Delivered'), false);
  assert.equal(canShipmentTransition('Delivered', 'In Transit'), false);
  assert.equal(canShipmentTransition('Cancelled', 'In Transit'), false);
  assert.equal(canShipmentTransition('Delivered', 'Cancelled'), false);
});

test('shipment transitions: idempotent same-state allowed', () => {
  assert.equal(canShipmentTransition('Created', 'Created'), true);
  assert.equal(canShipmentTransition('Delivered', 'Delivered'), true);
});

test('booking transitions: cancel and reschedule allowed from active states', () => {
  assert.equal(canBookingTransition('Pending', 'Cancelled'), true);
  assert.equal(canBookingTransition('Confirmed', 'Rescheduled'), true);
  assert.equal(canBookingTransition('Pending', 'Completed'), false, 'Pending cannot jump to Completed');
  assert.equal(canBookingTransition('Cancelled', 'Confirmed'), false, 'Cancelled bookings are final');
});

test('transition tables cover every defined status', () => {
  for (const from of Object.keys(SHIPMENT_TRANSITIONS)) {
    for (const to of Object.keys(SHIPMENT_TRANSITIONS)) {
      assert.equal(typeof canShipmentTransition(from, to), 'boolean');
    }
  }
  for (const from of Object.keys(BOOKING_TRANSITIONS)) {
    for (const to of Object.keys(BOOKING_TRANSITIONS)) {
      assert.equal(typeof canBookingTransition(from, to), 'boolean');
    }
  }
});

/* ── Signed tokens + hashing (A1/A2) ────────────────────────────── */
test('sha256 is stable and 64 hex chars', () => {
  assert.equal(sha256('hello').length, 64);
  assert.equal(sha256('hello'), sha256('hello'));
  assert.notEqual(sha256('hello'), sha256('hello!'));
});

test('signed tokens verify with the right type', () => {
  const tok = createSignedToken('recover', { email: 'a@b.com' }, 60);
  const decoded = verifySignedToken('recover', tok);
  assert.ok(decoded);
  assert.equal(decoded.email, 'a@b.com');
  assert.equal(decoded.type, 'recover');
});

test('signed tokens reject a wrong purpose type', () => {
  const tok = createSignedToken('recover', { email: 'a@b.com' }, 60);
  assert.equal(verifySignedToken('verify-email', tok), null);
});

test('signed tokens reject expired tokens', () => {
  const tok = createSignedToken('recover', { email: 'a@b.com' }, -1); // already expired
  assert.equal(verifySignedToken('recover', tok), null);
});

test('signed tokens reject garbage', () => {
  assert.equal(verifySignedToken('recover', 'not.a.token'), null);
});
