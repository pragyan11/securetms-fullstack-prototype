// Helper to get query parameters
function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadUserDetails() {
  const userId = getQueryParam('id');
  const container = document.getElementById('userDetails');
  if (!userId) {
    container.textContent = 'No user ID provided.';
    return;
  }
  try {
    const user = await api(`/api/admin/users/${userId}`, 'GET', null, true);
    if (!user || typeof user !== 'object') {
      container.textContent = 'User not found.';
      return;
    }
    // Remove sensitive fields before displaying
    const { recoveryEmail, credentialId, credentialPublicKey, credentialCounter, ...safeUser } = user;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(safeUser, null, 2);
    container.innerHTML = '';
    container.appendChild(pre);
  } catch (err) {
    container.textContent = 'Error loading user details.';
    console.error(err);
  }
}

// Run on page load
document.addEventListener('DOMContentLoaded', loadUserDetails);
