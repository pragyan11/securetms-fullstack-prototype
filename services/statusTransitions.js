'use strict';

/**
 * Status transition rules.
 *
 * Central place for "what statuses can a shipment/booking legally move to".
 * Enforced by the PATCH endpoints so a Created shipment can't jump straight
 * to Delivered, a Completed booking can't be un-completed, etc.
 */

const SHIPMENT_TRANSITIONS = {
  'Created':    ['Picked Up', 'Cancelled'],
  'Picked Up':  ['In Transit', 'Cancelled'],
  'In Transit': ['Delivered', 'Cancelled'],
  'Delivered':  [],
  'Cancelled':  []
};

// Bookings are looser (admins manage them), but still guarded.
const BOOKING_TRANSITIONS = {
  'Pending':    ['Confirmed', 'Cancelled', 'Rescheduled'],
  'Confirmed':  ['Completed', 'Cancelled', 'Rescheduled'],
  'Completed':  ['Cancelled'], // refund path
  'Cancelled':  [],
  'Rescheduled': ['Confirmed', 'Pending', 'Cancelled', 'Completed']
};

function canShipmentTransition(from, to) {
  if (!from || !to) return false;
  if (from === to) return true; // idempotent updates are fine
  const allowed = SHIPMENT_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function canBookingTransition(from, to) {
  if (!from || !to) return false;
  if (from === to) return true;
  const allowed = BOOKING_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

module.exports = { SHIPMENT_TRANSITIONS, BOOKING_TRANSITIONS, canShipmentTransition, canBookingTransition };
