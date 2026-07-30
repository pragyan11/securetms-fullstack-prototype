/**
 * Shared in-memory token revocation store.
 *
 * NOTE: This is intentionally in-memory only. In a scaled deployment this
 * should be backed by Redis or a database so revocation survives process
 * restarts and works across multiple server instances. For the current
 * SecureTMS prototype it prevents a logged-out token from being used until
 * its natural JWT expiry.
 */
const invalidatedTokens = new Set();

function addInvalidatedToken(token) {
  if (token) invalidatedTokens.add(token);
}

function isTokenInvalidated(token) {
  return token ? invalidatedTokens.has(token) : false;
}

module.exports = { invalidatedTokens, addInvalidatedToken, isTokenInvalidated };
