const nodemailer = require('nodemailer');
const logger = require('../lib/logger');

let transporter = null;

function initTransporter() {
  // Use Ethereal (test SMTP) in dev, or real SMTP in production
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  } else {
    // Dev fallback: log emails to console and optionally create Ethereal account
    logger.info('[email] No SMTP configured — emails will be logged to console only.');
    // Create a test Ethereal account for dev
    nodemailer.createTestAccount().then(account => {
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass }
      });
      logger.info('[email] Ethereal test account created: ' + account.user);
    }).catch(() => {
      transporter = { sendMail: (opts, cb) => { logger.info('[email] Would send: ' + JSON.stringify(opts)); if (cb) cb(null, { messageId: 'dev-' + Date.now() }); } };
    });
  }
}

async function sendEmail({ to, subject, text, html }, attempts = 2) {
  if (!transporter) { logger.info('[email] Transporter not ready, logging: ' + subject); return null; }
  for (let i = 0; i < attempts; i++) {
    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"SpeedX" <noreply@speedx.com>',
        to, subject, text, html
      });
      logger.info('[email] Sent: ' + info.messageId);
      // Ethereal preview URL
      if (info.messageId && nodemailer.getTestMessageUrl) {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) logger.info('[email] Preview: ' + previewUrl);
      }
      return info;
    } catch (err) {
      logger.error('[email] Attempt ' + (i + 1) + '/' + attempts + ' failed: ' + err.message);
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  return null;
}

const BASE_URL = () => process.env.BASE_URL || 'http://localhost:4000';

// ── Shared HTML shell ──────────────────────────────────────────────
function wrapHtml(title, bodyHtml, ctaLabel, ctaHref) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
    <div style="background:#0F4C81;padding:22px 28px;">
      <div style="color:#fff;font-size:20px;font-weight:700;">⚡ SpeedX</div>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 14px;color:#0f172a;font-size:19px;">${title}</h2>
      ${bodyHtml}
      ${ctaLabel ? `<div style="margin-top:22px;"><a href="${ctaHref}" style="background:#0F4C81;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">${ctaLabel}</a></div>` : ''}
      <p style="color:#64748b;font-size:12px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px;">You received this email because you're involved in a SpeedX transport job. If this wasn't expected, ignore it.</p>
    </div>
  </div>`;
}

function kv(label, value) {
  return `<tr><td style="padding:6px 10px;color:#64748b;font-size:13px;white-space:nowrap;width:140px;">${label}</td><td style="padding:6px 10px;color:#0f172a;font-size:13px;font-weight:600;">${value || '—'}</td></tr>`;
}

function table(rowsHtml) {
  return `<table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:10px;">${rowsHtml}</table>`;
}

function escapeEmail(v) {
  // Fields may already be entity-encoded by express-validator's .escape() in the
  // routes ("O'Brien" → "O&#39;Brien"). Escape the remaining HTML-significant
  // characters without double-encoding existing entities, so names render correctly.
  return String(v == null ? '' : v)
    // Preserve already-encoded entities from express-validator's .escape()
    // (amp, lt, gt, quot, apos, #38, #39, #x26, #x27, …) — escape only the rest.
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#(?:38|39|x26|x27));)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convenience functions
async function notifyBookingCreated(booking, customerEmail) {
  const portal = `${BASE_URL()}/customer.html`;
  const body = table(
    kv('Booking ref', escapeEmail(booking._id)) +
    kv('Customer', escapeEmail(booking.customerName || '—')) +
    kv('Route', `${escapeEmail(booking.origin)} → ${escapeEmail(booking.destination)}`) +
    kv('Service zone', escapeEmail(booking.serviceZone || '—')) +
    kv('Priority', escapeEmail(booking.priority || '—')) +
    kv('Status', escapeEmail(booking.status || 'Pending')) +
    kv('Created', escapeEmail(booking.createdAt ? new Date(booking.createdAt).toLocaleString() : '—'))
  );
  return sendEmail({
    to: customerEmail,
    subject: `✅ Booking Confirmed — ${booking.origin} → ${booking.destination}`,
    text: `Your booking is confirmed!\n\nFrom: ${booking.origin}\nTo: ${booking.destination}\nStatus: ${booking.status}\n\nTrack it at ${portal}`,
    html: wrapHtml('Your booking is confirmed 🎉', `<p style="color:#334155;font-size:14px;margin:0 0 18px;">Hi ${escapeEmail(booking.customerName || 'there')}, your booking has been created. Here's everything you need:</p>${body}`, 'Track in portal', portal)
  });
}

async function notifyShipmentCreated(shipment, customerEmail) {
  const portal = `${BASE_URL()}/customer.html`;
  const body = table(
    kv('Tracking ID', escapeEmail(shipment.trackingId)) +
    kv('Customer', escapeEmail(shipment.customerName || '—')) +
    kv('Pickup', escapeEmail(shipment.pickupAddress || '—')) +
    kv('Delivery', escapeEmail(shipment.deliveryAddress || '—')) +
    kv('Vehicle', escapeEmail(shipment.vehicleNumber || '—')) +
    kv('Driver', escapeEmail(shipment.driverName || '—')) +
    kv('Status', escapeEmail(shipment.status || 'Created')) +
    kv('ETA', escapeEmail(shipment.eta || '—')) +
    kv('Current location', escapeEmail(shipment.currentLocation || '—'))
  );
  return sendEmail({
    to: customerEmail,
    subject: `🚚 Shipment Confirmed — ${shipment.trackingId}`,
    text: `Your shipment is confirmed!\n\nTracking: ${shipment.trackingId}\nPickup: ${shipment.pickupAddress}\nDelivery: ${shipment.deliveryAddress}\nDriver: ${shipment.driverName}\nStatus: ${shipment.status}\n\nTrack it at ${portal}`,
    html: wrapHtml('Your shipment is confirmed 🚚', `<p style="color:#334155;font-size:14px;margin:0 0 18px;">Hi ${escapeEmail(shipment.customerName || 'there')}, your shipment has been confirmed. Here's everything you need:</p>${body}`, 'Track in portal', portal)
  });
}

async function notifyDriverAssigned(shipment, driverEmail) {
  const portal = `${BASE_URL()}/driver.html`;
  const body = table(
    kv('Tracking ID', escapeEmail(shipment.trackingId)) +
    kv('Pickup', escapeEmail(shipment.pickupAddress || '—')) +
    kv('Delivery', escapeEmail(shipment.deliveryAddress || '—')) +
    kv('Vehicle', escapeEmail(shipment.vehicleNumber || '—')) +
    kv('ETA', escapeEmail(shipment.eta || '—')) +
    kv('Status', escapeEmail(shipment.status || 'Created'))
  );
  return sendEmail({
    to: driverEmail,
    subject: `🛻 New Run Assigned — ${shipment.trackingId}`,
    text: `You've been assigned a new run!\n\nTracking: ${shipment.trackingId}\nPickup: ${shipment.pickupAddress}\nDelivery: ${shipment.deliveryAddress}\nVehicle: ${shipment.vehicleNumber}\n\nOpen it in the driver app: ${portal}`,
    html: wrapHtml('New run assigned to you 🛻', `<p style="color:#334155;font-size:14px;margin:0 0 18px;">Hi ${escapeEmail(shipment.driverName || 'driver')}, a new run has been assigned to you:</p>${body}`, 'Open driver app', portal)
  });
}

async function notifyStatusChange(shipment, recipientEmail) {
  const emoji = { 'Picked Up': '📦', 'In Transit': '🚚', 'Delivered': '✅', 'Cancelled': '❌' }[shipment.status] || '📋';
  return sendEmail({
    to: recipientEmail,
    subject: `${emoji} Shipment Update — ${shipment.trackingId} is now ${shipment.status}`,
    text: `Your shipment ${shipment.trackingId} status has changed.\n\nNew Status: ${shipment.status}\nCurrent Location: ${shipment.currentLocation || 'N/A'}\nETA: ${shipment.eta || 'N/A'}\n\nTrack: ${process.env.BASE_URL || 'http://localhost:4000'}/customer.html`,
    html: `<h2>${emoji} Shipment Update</h2><p><strong>Tracking:</strong> ${shipment.trackingId}<br><strong>New Status:</strong> ${shipment.status}<br><strong>Location:</strong> ${shipment.currentLocation || 'N/A'}<br><strong>ETA:</strong> ${shipment.eta || 'N/A'}</p>`
  });
}

async function notifyEmailVerification(toEmail, verifyUrl) {
  return sendEmail({
    to: toEmail,
    subject: 'Verify your SpeedX email',
    text: 'Confirm your email address to finish setting up your SpeedX account.\n\n' + verifyUrl,
    html: wrapHtml('Confirm your email address ✉️', `<p style="color:#334155;font-size:14px;margin:0 0 18px;">Click the button below to verify <strong>${escapeEmail(toEmail)}</strong> on your SpeedX account. The link expires in 24 hours.</p>`, 'Verify email', verifyUrl)
  });
}

async function notifyRecoveryLink(toEmail, recoveryUrl, minutes = 15) {
  return sendEmail({
    to: toEmail,
    subject: 'SpeedX account recovery',
    text: 'Use this link to reset your passkeys. It expires in ' + minutes + ' minutes.\n\n' + recoveryUrl,
    html: wrapHtml('Recover your SpeedX account 🔑', `<p style="color:#334155;font-size:14px;margin:0 0 18px;">We received a request to recover the SpeedX account for <strong>${escapeEmail(toEmail)}</strong>. This link lets you remove the lost passkeys and enroll a new one. It expires in ${minutes} minutes.</p><p style="color:#64748b;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>`, 'Recover account', recoveryUrl)
  });
}

async function notifyRecoveryCodes(toEmail, codes) {
  const list = Array.isArray(codes) && codes.length
    ? `<div style="background:#0f172a;border-radius:10px;padding:14px 16px;font-family:monospace;font-size:13px;color:#67e8f9;line-height:1.9;">${codes.map(c => escapeEmail(c)).join('<br>')}</div>`
    : '';
  return sendEmail({
    to: toEmail,
    subject: 'Your SpeedX recovery codes',
    text: 'Store these one-time recovery codes somewhere safe. Each can be used once if you lose your passkeys:\n\n' + (Array.isArray(codes) ? codes.join('\n') : ''),
    html: wrapHtml('Your one-time recovery codes 🔐', `<p style="color:#334155;font-size:14px;margin:0 0 14px;">Each code below can be used <strong>once</strong> to unlock your account and enroll a new passkey if you lose your device. Keep them somewhere safe and never share them.</p>${list}`, 'Open SpeedX', BASE_URL())
  });
}

async function notifyDeliveryConfirmed(shipment, customerEmail, adminEmail) {
  const recipients = [customerEmail];
  if (adminEmail) recipients.push(adminEmail);
  return sendEmail({
    to: recipients.join(', '),
    subject: `✅ Delivered! — ${shipment.trackingId}`,
    text: `Delivery confirmed!\n\nTracking: ${shipment.trackingId}\nDelivered at: ${shipment.currentLocation || 'Destination'}\n\nThank you for using SpeedX.`,
    html: `<h2>✅ Delivery Confirmed!</h2><p><strong>Tracking:</strong> ${shipment.trackingId}<br><strong>Delivered to:</strong> ${shipment.currentLocation || 'Destination'}</p><p>Thank you for using SpeedX!</p>`
  });
}

module.exports = {
  initTransporter, sendEmail,
  notifyBookingCreated, notifyShipmentCreated, notifyDriverAssigned,
  notifyStatusChange, notifyDeliveryConfirmed,
  notifyEmailVerification, notifyRecoveryLink, notifyRecoveryCodes
};
