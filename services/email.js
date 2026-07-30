const nodemailer = require('nodemailer');
const logger = require('winston');

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

async function sendEmail({ to, subject, text, html }) {
  if (!transporter) { logger.info('[email] Transporter not ready, logging: ' + subject); return null; }
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"SecureTMS" <noreply@securetms.com>',
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
    logger.error('[email] Failed: ' + err.message);
    return null;
  }
}

// Convenience functions
async function notifyBookingCreated(booking, customerEmail) {
  return sendEmail({
    to: customerEmail,
    subject: `Booking Confirmed — ${booking.origin} → ${booking.destination}`,
    text: `Your booking has been created!\n\nFrom: ${booking.origin}\nTo: ${booking.destination}\nStatus: ${booking.status}\n\nTrack your shipment in the SecureTMS customer portal.`,
    html: `<h2>Booking Confirmed!</h2><p><strong>From:</strong> ${booking.origin}<br><strong>To:</strong> ${booking.destination}<br><strong>Status:</strong> ${booking.status}</p><p>Track your shipment in the <a href="#">SecureTMS customer portal</a>.</p>`
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

async function notifyDeliveryConfirmed(shipment, customerEmail, adminEmail) {
  const recipients = [customerEmail];
  if (adminEmail) recipients.push(adminEmail);
  return sendEmail({
    to: recipients.join(', '),
    subject: `✅ Delivered! — ${shipment.trackingId}`,
    text: `Delivery confirmed!\n\nTracking: ${shipment.trackingId}\nDelivered at: ${shipment.currentLocation || 'Destination'}\n\nThank you for using SecureTMS.`,
    html: `<h2>✅ Delivery Confirmed!</h2><p><strong>Tracking:</strong> ${shipment.trackingId}<br><strong>Delivered to:</strong> ${shipment.currentLocation || 'Destination'}</p><p>Thank you for using SecureTMS!</p>`
  });
}

module.exports = { initTransporter, sendEmail, notifyBookingCreated, notifyStatusChange, notifyDeliveryConfirmed };
