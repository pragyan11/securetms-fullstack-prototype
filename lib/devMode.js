/* ═══════════════════════════════════════════════════════════════════════════
   SpeedX — single source of truth for "dev mode is active".

   Two conditions must BOTH hold:
     1. process.env.NODE_ENV is not the literal string 'production'.
     2. process.env.ALLOW_DEV_LOGIN is exactly the literal string '1'.

   Used by:
     - routes/auth.js: gates /api/auth/dev/info + /api/auth/dev-login
     - server.js#seedDemoData: gates idempotent demo-account seeding

   Adding a third condition? Add it here. Both call sites pick it up.
   Stripping NODE_ENV from a deploy? Both call sites lock down together.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

function isDevMode() {
  return process.env.NODE_ENV !== 'production'
      && process.env.ALLOW_DEV_LOGIN === '1';
}

module.exports = { isDevMode };
