const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const User = require('../models/User');
const Invite = require('../models/Invite');
const AuditLog = require('../models/AuditLog');

const router = express.Router();

/**
 * All routes below are admin-only. Existing admins generate invitations that
 * produce a single-use ticket. The token in the invite URL is unguessable
 * (32 bytes of cryptographically random data → 64 hex chars).
 */
router.use(auth, requireRole('Admin'));

function publicInviteShape(invite) {
  return {
    id: invite._id,
    token: invite.token,
    email: invite.email || null,
    note: invite.note || null,
    role: invite.role,
    expiresAt: invite.expiresAt,
    used: invite.used,
    usedAt: invite.usedAt || null,
    usedByEmail: invite.usedByEmail || null,
    invitedByEmail: invite.invitedByEmail || null,
    createdAt: invite.createdAt
  };
}

router.get('/', async (req, res) => {
  try {
    const invites = await Invite.find().sort({ createdAt: -1 }).limit(100);
    res.json(invites.map(publicInviteShape));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post(
  '/',
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('note').optional().isString().isLength({ max: 200 }),
    body('ttlDays').optional().isInt({ min: 1, max: 30 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const ttlDays = req.body.ttlDays || 7;
      const invite = await Invite.create({
        role: 'Admin',
        email: req.body.email || null,
        note: req.body.note || null,
        invitedBy: req.user.id,
        invitedByEmail: req.user.email,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      });

      await AuditLog.create({
        userEmail: req.user.email,
        action: 'INVITE_CREATE',
        details: `Admin invite created (expires ${invite.expiresAt.toISOString().slice(0,10)})`,
        ipAddress: req.ip
      });

      res.status(201).json(publicInviteShape(invite));
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.delete('/:id', async (req, res) => {
  try {
    const invite = await Invite.findById(req.params.id);
    if (!invite) return res.status(404).json({ message: 'Invite not found' });
    await invite.deleteOne();
    await AuditLog.create({
      userEmail: req.user.email,
      action: 'INVITE_REVOKE',
      details: `Admin invite revoked`,
      ipAddress: req.ip
    });
    res.json({ message: 'Invite revoked' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
