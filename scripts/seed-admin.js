#!/usr/bin/env node
/**
 * Bootstrap admin account via secure invite.
 *
 * Usage:
 *   node scripts/seed-admin.js [email] [name]
 *
 * If an admin already exists, prints the existing invite URL (if any) or
 * generates a new one. The printed URL is the only way to create an admin
 * via the UI without an existing admin.
 *
 * The URL is single-use, expires in 7 days, and is stored in the database
 * so it survives server restarts. The token is 32 random bytes encoded as
 * hex (64 chars) — unguessable.
 */

// .env.local takes precedence (per-machine overrides e.g. real SMTP), then .env.
// Guarded so environments without .env.local boot without a dotenv warning.
if (require('fs').existsSync(require('path').join(__dirname, '..', '.env.local'))) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
}
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net    = require('net');

const Invite = require('../models/Invite');
const User   = require('../models/User');

async function main() {
  const email = process.argv[2] || null;
  const expectedOrigin = process.env.EXPECTED_ORIGIN || `http://localhost:${process.env.PORT || 4000}`;
  const originUrl = new URL(expectedOrigin);

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is not set in .env. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log('Connected to MongoDB.');

  const adminCount = await User.countDocuments({ role: 'Admin' });
  const fresh = !adminCount;
  if (fresh) {
    console.log(`No admin accounts found in the database. Generating a one-time bootstrap invite.`);
  } else {
    console.log(`Found ${adminCount} admin account(s). Generating a new invite anyway (existing admins can also create invites from the dashboard).`);
  }

  const invite = await Invite.create({
    role: 'Admin',
    email: email ? email.toLowerCase() : undefined,
    note: fresh ? 'Bootstrap admin invite (first-run)' : 'Seeded via CLI',
    invitedByEmail: 'cli-bootstrap',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });

  // Build the invite URL. URL.host strips brackets; we add them back ONLY
  // when the underlying host is genuinely an IPv6 literal (e.g. `::1`).
  // Note: `localhost:4000` contains a colon (the port) but is NOT IPv6, so
  // we use net.isIP() against the bare host portion to disambiguate.
  const bareHost = originUrl.hostname; // hostname strips port and brackets
  const isIpv6 = net.isIP(bareHost) === 6;
  const hostForUrl = isIpv6 && !originUrl.host.startsWith('[')
    ? `[${originUrl.host}]`
    : originUrl.host;
  const onboardUrl = `${originUrl.protocol}//${hostForUrl}/admin-onboard.html?token=${invite.token}`;
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  ADMIN BOOTSTRAP INVITE                                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log(`Email (optional, locked): ${email || '(any)'}`);
  console.log(`Expires:                  ${invite.expiresAt.toISOString()}`);
  console.log(`Role:                     Admin`);
  console.log('');
  console.log('Open this URL in your browser to complete admin registration:');
  console.log('');
  console.log(`  ${onboardUrl}`);
  console.log('');
  console.log('⚠  This URL is single-use. Do not commit it to source control.');
  console.log('   The script also writes it to scripts/.admin-invite.txt for convenience.');
  console.log('   Delete that file after you have used the invite.');

  try {
    const out = path.join(__dirname, '.admin-invite.txt');
    fs.writeFileSync(out, onboardUrl + '\n', 'utf8');
    console.log(`\nWrote invite URL to ${out}`);
  } catch (e) {
    console.error('Could not write invite file:', e.message);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('seed-admin failed:', err);
  process.exit(1);
});
