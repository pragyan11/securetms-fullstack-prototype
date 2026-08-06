const jwt = require('jsonwebtoken');
const { isTokenInvalidated } = require('../lib/tokenStore');
const { sha256 } = require('../lib/authTokens');
const Session = require('../models/Session');

/**
 * Authentication middleware.
 *
 * Verifies the JWT (cookie or Bearer) and then validates the persistent
 * Session row keyed by the token's SHA-256 hash:
 *   - revoked sessions → 401
 *   - expired sessions → 401
 *   - legacy tokens minted before the Session model existed → a Session row
 *     is upserted best-effort so existing logins keep working.
 * `req.session` is attached for logout / sign-out-all-devices.
 */
async function auth(req, res, next) {
  const token = req.cookies.auth_token || req.cookies.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }

  if (isTokenInvalidated(token)) {
    return res.status(401).json({ message: 'Session has been revoked' });
  }

  try {
    const tokenHash = sha256(token);
    let session = await Session.findOne({ tokenHash });
    if (!session) {
      // Legacy token (pre-Session) — silently upgrade so nothing breaks.
      session = await Session.create({
        userId: decoded.id,
        tokenHash,
        label: 'Legacy session',
        userAgent: (req.headers['user-agent'] || '').slice(0, 200),
        ip: req.ip,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000)
      });
    }

    if (session.revokedAt) {
      return res.status(401).json({ message: 'Session has been revoked' });
    }
    if (session.expiresAt && session.expiresAt < new Date()) {
      await Session.deleteOne({ _id: session._id }).catch(() => {});
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    // Refresh lastSeenAt at most every 5 minutes per session.
    if (Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60 * 1000) {
      Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    }

    req.user = decoded;
    req.session = session;
    return next();
  } catch (err) {
    return res.status(500).json({ message: 'Authentication error' });
  }
}

module.exports = auth;
