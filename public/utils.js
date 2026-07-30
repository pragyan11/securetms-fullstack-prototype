// Utility functions for UI feedback and feature detection

// Simple spinner element – expects an element with id="spinner" in the DOM.
function showSpinner() {
  const el = document.getElementById('spinner');
  if (el) el.style.display = 'block';
}
function hideSpinner() {
  const el = document.getElementById('spinner');
  if (el) el.style.display = 'none';
}

// Detect WebAuthn (Passkey) support. If not supported, hide Passkey UI elements
// and surface a clear message instead of falling back to a deprecated flow.
function detectWebAuthnSupport() {
  if (!window.PublicKeyCredential) {
    document.querySelectorAll('[data-passkey]').forEach(el => el.style.display = 'none');
    const m = document.getElementById('loginMsg') || document.getElementById('regMsg');
    if (m) {
      m.textContent = 'This browser does not support WebAuthn / FIDO2 passkeys. Use a modern browser (Chrome, Safari, Firefox, Edge) to authenticate.';
      m.style.color = 'var(--red-600, #DC2626)';
    }
  }
}

// Export for potential module usage (not required for script tag)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { showSpinner, hideSpinner, detectWebAuthnSupport };
}
