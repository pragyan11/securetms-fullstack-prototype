'use strict';

/**
 * Quote / pricing engine.
 *
 * Pure-ish calculator (async because it reads admin settings with defaults)
 * used by:
 *   - POST /api/bookings/quote        → instant customer estimate
 *   - POST /api/bookings (create)     → auto-priced when price not supplied
 *
 * Rates come from admin Settings when configured, otherwise the defaults
 * below. Priority multipliers scale the zone base rate.
 */

const Setting = require('../models/Setting');

const DEFAULT_ZONES = ['North', 'South', 'East', 'West', 'Central', 'Downtown'];

const DEFAULT_SETTINGS = {
  zones: DEFAULT_ZONES,
  baseRate: 25,                       // flat base per booking
  ratePerKm: 0.9,                     // per distance unit (prototype: per km)
  priorityMultipliers: { Standard: 1, Express: 1.5, Priority: 2 },
  currency: 'USD'
};

/** Approximate "distance" between two zones: the farther apart, the higher the price. */
const ZONE_DISTANCE = { North: 1, South: 1, East: 1, West: 1, Central: 0.5, Downtown: 0.5 };

async function getSettings() {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  try {
    const rows = await Setting.find({ key: { $in: ['quote', 'serviceZones', 'currency'] } }).lean();
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    if (map.quote && typeof map.quote === 'object') {
      Object.assign(defaults, map.quote);
    }
    if (Array.isArray(map.serviceZones) && map.serviceZones.length) defaults.zones = map.serviceZones;
    if (map.currency) defaults.currency = map.currency;
  } catch (_e) { /* keep defaults */ }
  return defaults;
}

/**
 * Pure price calculation given a settings object — unit-testable without a DB.
 * @param {object} s settings (baseRate, ratePerKm, priorityMultipliers, currency)
 * @param {object} opts { serviceZone, priority, distanceKm?, weightKg? }
 */
function calculatePrice(s, { serviceZone, priority = 'Standard', distanceKm = 1, weightKg = 0 }) {
  const mult = (s.priorityMultipliers && s.priorityMultipliers[priority]) || 1;
  const zoneFactor = (ZONE_DISTANCE[serviceZone] != null ? ZONE_DISTANCE[serviceZone] : 0.75) + 1; // 1.5–2.0
  const distance = Math.max(1, Number(distanceKm) || 1);
  const weight = Math.max(0, Number(weightKg) || 0);
  const weightSurcharge = weight > 100 ? Math.round((weight - 100) / 100) * 8 : 0;

  const subtotal = s.baseRate * zoneFactor + s.ratePerKm * distance + weightSurcharge;
  const price = Math.round(subtotal * mult * 100) / 100;

  return {
    price,
    currency: s.currency || 'USD',
    breakdown: {
      baseRate: s.baseRate,
      zoneFactor,
      distanceKm: distance,
      ratePerKm: s.ratePerKm,
      weightKg: weight,
      weightSurcharge,
      priorityMultiplier: mult
    }
  };
}

/**
 * Compute a quote for a booking.
 * @param {object} opts { serviceZone, priority, distanceKm?, weightKg? }
 * @returns {Promise<{ price, currency, breakdown }>}
 */
async function computeQuote(opts) {
  const s = await getSettings();
  return calculatePrice(s, opts || {});
}

/** Deterministic-ish "distance" between two plain-text addresses (0–10). */
function estimateDistanceKm(origin, destination) {
  const a = String(origin || '').toLowerCase();
  const b = String(destination || '').toLowerCase();
  if (!a || !b) return 1;
  // Share a coarse hash-based spread so the same route always quotes the same.
  let h1 = 0, h2 = 0;
  for (let i = 0; i < a.length; i++) h1 = (h1 * 31 + a.charCodeAt(i)) % 997;
  for (let i = 0; i < b.length; i++) h2 = (h2 * 31 + b.charCodeAt(i)) % 997;
  return Math.max(1, ((Math.abs(h1 - h2) % 40) + 8)); // 8–47 km
}

/** Generate a human-friendly invoice number, e.g. INV-2026-8A3F2C. */
function makeInvoiceNumber(id) {
  const suffix = String(id || '').slice(-6).toUpperCase() || Math.random().toString(36).slice(2, 8).toUpperCase();
  const year = new Date().getFullYear();
  return `INV-${year}-${suffix}`;
}

module.exports = { computeQuote, calculatePrice, getSettings, estimateDistanceKm, makeInvoiceNumber, DEFAULT_ZONES, DEFAULT_SETTINGS };
