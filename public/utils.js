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

// Detect WebAuthn (Passkey) support. If not supported, hide Passkey UI elements.
function detectWebAuthnSupport() {
  if (!window.PublicKeyCredential) {
    // Hide all elements marked with data-passkey attribute
    document.querySelectorAll('[data-passkey]').forEach(el => el.style.display = 'none');
    alert('Your browser does not support WebAuthn Passkeys. Please use Face login instead.');
  }
}

// Export for potential module usage (not required for script tag)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { showSpinner, hideSpinner, detectWebAuthnSupport };
}
