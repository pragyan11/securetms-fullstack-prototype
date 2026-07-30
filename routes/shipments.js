const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Shipment = require('../models/Shipment');
const Booking = require('../models/Booking');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const emailService = require('../services/email');
const router = express.Router();

router.use(auth);

// GET with search, sort, filter, pagination
router.get('/', async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Customer') {
      const bookingIds = await Booking.find({ userId: req.user.id }).distinct('_id');
      filter.bookingId = { $in: bookingIds };
    } else if (req.user.role === 'Driver') {
      const emailFilter = req.user.email;
      const nameFilter = req.user.name;
      const $or = [{ driverEmail: emailFilter }];
      if (nameFilter) $or.push({ driverName: nameFilter });
      filter.$or = $or;
    }

    const { search, status, vehicle, sort, order, page, limit } = req.query;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const searchOr = [
        { trackingId: re }, { customerName: re }, { driverName: re },
        { pickupAddress: re }, { deliveryAddress: re }, { vehicleNumber: re }
      ];
      filter.$and = (filter.$and || []).concat([{ $or: searchOr }]);
    }
    if (status) filter.status = status;
    if (vehicle) filter.vehicleNumber = new RegExp(vehicle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const sortField = sort || 'updatedAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [shipments, total] = await Promise.all([
      Shipment.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(limitNum),
      Shipment.countDocuments(filter)
    ]);

    res.json({ data: shipments, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Export CSV
router.get('/export', async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Customer') {
      const bookingIds = await Booking.find({ userId: req.user.id }).distinct('_id');
      filter.bookingId = { $in: bookingIds };
    } else if (req.user.role === 'Driver') {
      filter.driverEmail = req.user.email;
    }
    const shipments = await Shipment.find(filter).sort({ updatedAt: -1 }).lean();
    const header = 'Tracking ID,Customer,Pickup,Delivery,Vehicle,Driver,Status,ETA,Location,Updated\n';
    const rows = shipments.map(s =>
      `"${s.trackingId}","${s.customerName || ''}","${s.pickupAddress || ''}","${s.deliveryAddress || ''}","${s.vehicleNumber || ''}","${s.driverName || ''}","${s.status}","${s.eta || ''}","${s.currentLocation || ''}","${s.updatedAt}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=shipments.csv');
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Stats
router.get('/stats', async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Customer') {
      const bookingIds = await Booking.find({ userId: req.user.id }).distinct('_id');
      filter.bookingId = { $in: bookingIds };
    } else if (req.user.role === 'Driver') {
      filter.driverEmail = req.user.email;
    }
    const [total, byStatus] = await Promise.all([
      Shipment.countDocuments(filter),
      Shipment.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);
    res.json({ total, byStatus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post(
  '/',
  [
    body('trackingId').optional().trim().escape(),
    body('shipmentId').optional().trim().escape(),
    body('vehicleNumber').optional().trim().escape(),
    body('driverName').optional().trim().escape(),
    body('driverEmail').optional().isEmail().normalizeEmail(),
    body('assignedDriverId').optional().isString(),
    body('bookingId').optional().isString(),
    body('customerId').optional().isString(),
    body('pickupAddress').optional().trim().escape(),
    body('deliveryAddress').optional().trim().escape(),
    body('customerName').optional().trim().escape(),
    body('status').optional().isIn(['Created', 'Picked Up', 'In Transit', 'Delivered', 'Cancelled']),
    body('currentLocation').optional().trim().escape(),
    body('eta').optional().trim().escape(),
    body('location').optional().trim().escape(),
    body('podSignature').optional().isString(),
    body('podPhoto').optional().isString(),
    body('podNotes').optional().trim().escape()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const {
        trackingId, shipmentId, vehicleNumber, driverName, driverEmail,
        assignedDriverId, bookingId, customerId, pickupAddress, deliveryAddress,
        customerName, status, currentLocation, eta, location, podSignature, podPhoto, podNotes
      } = req.body;

      const shipment = await Shipment.create({
        trackingId: trackingId || shipmentId || `TRK-${Date.now()}`,
        vehicleNumber, driverName, driverEmail,
        assignedDriverId: assignedDriverId && mongoose.isValidObjectId(assignedDriverId) ? assignedDriverId : undefined,
        bookingId: bookingId && mongoose.isValidObjectId(bookingId) ? bookingId : undefined,
        customerId: customerId && mongoose.isValidObjectId(customerId) ? customerId : undefined,
        pickupAddress: pickupAddress || (location && !deliveryAddress ? location : undefined),
        deliveryAddress, customerName,
        status: status || 'Created',
        currentLocation: currentLocation || location || 'Awaiting pickup',
        eta: eta || 'Pending',
        podSignature, podPhoto, podNotes,
        updatedAt: new Date()
      });

      await AuditLog.create({
        userEmail: req.user.email, action: 'SHIPMENT_CREATE',
        details: `Created shipment ${shipment.trackingId}`, ipAddress: req.ip
      });

      if (req.io) {
        req.io.emit('shipment:created', shipment);
        req.io.emit('activity:new', { action: 'SHIPMENT_CREATE', userEmail: req.user.email, details: `Created shipment ${shipment.trackingId}`, createdAt: new Date() });
      }

      res.status(201).json({ message: 'Shipment created', shipment });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch('/:id/status', [
  body('status').optional().isIn(['Created', 'Picked Up', 'In Transit', 'Delivered', 'Cancelled']),
  body('currentLocation').optional().trim().escape(),
  body('eta').optional().trim().escape(),
  body('podSignature').optional().isString(),
  body('podPhoto').optional().isString(),
  body('podNotes').optional().trim().escape(),
  body('podTimestamp').optional()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (req.user.role !== 'Admin' && req.user.role !== 'Driver') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (req.user.role === 'Driver' && shipment.driverEmail !== req.user.email && shipment.driverName !== req.user.name) {
      return res.status(403).json({ message: 'You can only update shipments assigned to you' });
    }
    if (req.body.status) shipment.status = req.body.status;
    if (req.body.currentLocation) shipment.currentLocation = req.body.currentLocation;
    if (req.body.eta) shipment.eta = req.body.eta;
    if (req.body.podSignature !== undefined) shipment.podSignature = req.body.podSignature;
    if (req.body.podPhoto !== undefined) shipment.podPhoto = req.body.podPhoto;
    if (req.body.podNotes !== undefined) shipment.podNotes = req.body.podNotes;
    if (req.body.podTimestamp) shipment.podTimestamp = req.body.podTimestamp;
    shipment.updatedAt = new Date();
    await shipment.save();

    await AuditLog.create({
      userEmail: req.user.email, action: 'SHIPMENT_UPDATE',
      details: `Updated shipment ${shipment.trackingId} → ${shipment.status}`, ipAddress: req.ip
    });

    if (req.io) {
      req.io.emit('shipment:updated', shipment);
      req.io.emit('activity:new', { action: 'SHIPMENT_UPDATE', userEmail: req.user.email, details: `Updated shipment ${shipment.trackingId}`, createdAt: new Date() });
    }
    res.json({ message: 'Shipment updated', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Forbidden' });
    Object.assign(shipment, req.body, { updatedAt: new Date() });
    await shipment.save();
    await AuditLog.create({
      userEmail: req.user.email, action: 'SHIPMENT_UPDATE',
      details: `Updated shipment ${shipment.trackingId}`, ipAddress: req.ip
    });
    if (req.io) {
      req.io.emit('shipment:updated', shipment);
      req.io.emit('activity:new', { action: 'SHIPMENT_UPDATE', userEmail: req.user.email, details: `Updated shipment ${shipment.trackingId}`, createdAt: new Date() });
    }
    res.json({ message: 'Shipment updated', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Forbidden' });
    const shipment = await Shipment.findByIdAndDelete(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    await AuditLog.create({
      userEmail: req.user.email, action: 'SHIPMENT_DELETE',
      details: `Deleted shipment ${shipment.trackingId}`, ipAddress: req.ip
    });
    if (req.io) {
      req.io.emit('shipment:deleted', req.params.id);
      req.io.emit('activity:new', { action: 'SHIPMENT_DELETE', userEmail: req.user.email, details: `Deleted shipment ${shipment.trackingId}`, createdAt: new Date() });
    }
    res.json({ message: 'Shipment deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
