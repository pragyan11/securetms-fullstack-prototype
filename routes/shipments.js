const express = require('express');
const Shipment = require('../models/Shipment');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const shipments = await Shipment.find().sort({ updatedAt: -1 });
    res.json(shipments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { shipmentId, vehicleNumber, driverName, status, location } = req.body;
    const shipment = await Shipment.create({
      shipmentId: shipmentId || `SHP-${Date.now()}`,
      vehicleNumber,
      driverName,
      status: status || 'Created',
      location,
      updatedAt: new Date()
    });

    await AuditLog.create({
      userEmail: req.user.email,
      action: 'SHIPMENT_CREATE',
      details: `Created shipment ${shipment.shipmentId}`,
      ipAddress: req.ip
    });

    res.status(201).json({ message: 'Shipment created', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    await AuditLog.create({
      userEmail: req.user.email,
      action: 'SHIPMENT_UPDATE',
      details: `Updated shipment ${shipment.shipmentId}`,
      ipAddress: req.ip
    });
    res.json({ message: 'Shipment updated', shipment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findByIdAndDelete(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    await AuditLog.create({
      userEmail: req.user.email,
      action: 'SHIPMENT_DELETE',
      details: `Deleted shipment ${shipment.shipmentId}`,
      ipAddress: req.ip
    });
    res.json({ message: 'Shipment deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
