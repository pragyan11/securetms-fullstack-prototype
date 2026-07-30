const mongoose = require('mongoose');
const MaintenanceLogSchema = new mongoose.Schema({
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
  vehicleNumber: { type: String, required: true },
  type: { type: String, enum: ['Scheduled', 'Unscheduled', 'Inspection', 'Repair', 'Oil Change', 'Tire Rotation', 'Brake Service', 'Other'], default: 'Scheduled' },
  status: { type: String, enum: ['Scheduled', 'In Progress', 'Completed', 'Overdue'], default: 'Scheduled', index: true },
  description: { type: String, required: true },
  scheduledDate: { type: Date, index: true },
  completedDate: { type: Date },
  cost: { type: Number, default: 0 },
  odometer: { type: Number },
  notes: { type: String },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('MaintenanceLog', MaintenanceLogSchema);
