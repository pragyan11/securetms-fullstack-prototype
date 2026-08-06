'use strict';

/**
 * Double-submit-cookie CSRF protection.
 *
 * Every auth response sets a readable `csrf_token` cookie (sameSite lax,
 * NOT httpOnly so the SPA can read it) alongside the httpOnly auth cookie.
 * State-changing requests that rely on cookie authentication must echo that
 * token back in the `X-CSRF-Token` header. Requests authenticated with a
 * Bearer Authorization header are inherently CSRF-immune (an attacker can't
 * set that header cross-origin), so they are skipped.
 *
 * Safe methods (GET/HEAD/OPTIONS) are never blocked.
 */

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const AUTH_COOKIES = ['auth_token', 'token'];

function getAuthCookie(req) {
  if (!req.cookies) return null;
  for (const name of AUTH_COOKIES) {
    if (req.cookies[name]) return name;
  }
  return null;
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Ensure a csrf_token cookie exists on the response (call on auth responses). */
function attachCsrf(req, res, next) {
  const token = req.cookies[CSRF_COOKIE] || require('crypto').randomBytes(24).toString('hex');
  if (!req.cookies[CSRF_COOKIE]) {
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  }
  res.locals.csrfToken = token;
  next();
}

/** Enforce the double-submit check. Mount AFTER cookie-parser. */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.includes(req.method)) return next();
  // Bearer-token requests are not CSRF-able.
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) return next();
  // No auth cookie → nothing to protect.
  if (!getAuthCookie(req)) return next();

  const expected = req.cookies && req.cookies[CSRF_COOKIE];
  const provided = req.headers[CSRF_HEADER];
  if (!expected || !provided || expected !== provided) {
    return res.status(403).json({ message: 'CSRF validation failed — refresh the page and try again.', csrfError: true });
  }
  return next();
}

module.exports = { csrfProtection, attachCsrf, CSRF_COOKIE, CSRF_HEADER };
