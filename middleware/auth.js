const jwt = require('jsonwebtoken');
const { isTokenInvalidated } = require('../lib/tokenStore');

function auth(req, res, next) {
  const token = req.cookies.auth_token || req.cookies.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    if (isTokenInvalidated(token)) {
      return res.status(401).json({ message: 'Session has been revoked' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }
}

module.exports = auth;
