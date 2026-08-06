const express = require('express');
const Shipment = require('../models/Shipment');
const router = express.Router();

/**
 * Public shipment tracking — deliberately unauthenticated so recipients can
 * follow a delivery without an account (C10). Only safe fields are exposed.
 */
router.get('/track/:trackingId', async (req, res) => {
  try {
    const trackingId = String(req.params.trackingId || '').trim();
    if (!trackingId) return res.status(400).json({ message: 'Tracking ID required' });
    const shipment = await Shipment.findOne({ trackingId }).lean();
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    res.json({
      trackingId: shipment.trackingId,
      status: shipment.status,
      currentLocation: shipment.currentLocation,
      eta: shipment.eta,
      pickupAddress: shipment.pickupAddress,
      deliveryAddress: shipment.deliveryAddress,
      customerName: shipment.customerName,
      driverName: shipment.driverName,
      vehicleNumber: shipment.vehicleNumber,
      stops: (shipment.stops || []).sort((a, b) => (a.sequence || 0) - (b.sequence || 0)),
      podTimestamp: shipment.podTimestamp || null,
      deliveredAt: shipment.deliveredAt || null,
      updatedAt: shipment.updatedAt
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
