// Admin UI helper functions

// Load detailed admin user management UI (list, edit, delete, view logs)
async function loadAdminUsers() {
  // For demo purposes, bypass auth to fetch user list
  const users = await api('/api/admin/users', 'GET', null, false);
  const container = document.getElementById('adminUsers');
  if (!container) return;
  container.innerHTML = '';

  if (!Array.isArray(users) || users.length === 0) {
    container.textContent = 'No users found.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'admin-user-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.name || ''}</td>
      <td>${u.email || ''}</td>
        <td>${u.role || ''}</td>
        <td>
          <button class="btn btn-secondary btn-sm edit-user" data-id="${u._id}">Edit</button>
          <button class="btn btn-danger btn-sm delete-user" data-id="${u._id}">Delete</button>
          <button class="btn btn-primary btn-sm view-logs" data-email="${u.email}">Logs</button>
          <a class="btn btn-info btn-sm" href="user_details.html?id=${u._id}">Details</a>
        </td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  // Attach action listeners
  container.querySelectorAll('.edit-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      // Toggle role between Admin and Customer for simplicity (no prompt support)
      const currentRow = btn.closest('tr');
      const currentRoleCell = currentRow?.querySelector('td:nth-child(3)');
      const currentRole = currentRoleCell?.textContent.trim();
      const makeAdmin = confirm(`Current role is "${currentRole}". Switch to Admin?`);
      const newRole = makeAdmin ? 'Admin' : 'Customer';
      await api(`/api/admin/users/${id}`, 'PUT', { role: newRole }, true);
      loadAdminUsers();
    });
  });

  container.querySelectorAll('.delete-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this user?')) return;
      const id = btn.dataset.id;
      await api(`/api/admin/users/${id}`, 'DELETE', null, true);
      loadAdminUsers();
    });
  });


// Attach listeners for refresh buttons (if present)
document.getElementById('refreshAdminBookingsBtn')?.addEventListener('click', loadAdminBookings);
document.getElementById('refreshAdminShipmentsBtn')?.addEventListener('click', loadAdminShipments);
  container.querySelectorAll('.view-logs').forEach((btn) => {
    btn.addEventListener('click', () => {
      const email = btn.dataset.email;
      loadUserLogs(email);
    });
  });
}

// Load logs for a specific user and display them
async function loadUserLogs(email) {
  const logs = await api(`/api/admin/logs?email=${encodeURIComponent(email)}`, 'GET', null, true);
  const logContainer = document.getElementById('adminUserLogs');
  if (!logContainer) return;
  logContainer.innerHTML = '';
  if (!Array.isArray(logs) || logs.length === 0) {
    logContainer.textContent = `No logs for ${email}`;
    return;
  }
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(logs, null, 2);
  logContainer.appendChild(pre);
}

// Load admin bookings list with edit/delete actions
async function loadAdminBookings() {
  // Bypass auth for demo; in production this would require a valid token
  const bookings = await api('/api/bookings', 'GET', null, false);
  const container = document.getElementById('adminBookings');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(bookings) || bookings.length === 0) {
    container.textContent = 'No bookings found.';
    return;
  }
  const table = document.createElement('table');
  table.className = 'admin-booking-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Customer</th><th>Origin</th><th>Destination</th><th>Status</th><th>Actions</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  bookings.forEach((b) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${b.customerName || ''}</td>
      <td>${b.origin || ''}</td>
      <td>${b.destination || ''}</td>
      <td>${b.status || ''}</td>
      <td>
        <button class="btn btn-secondary btn-sm edit-booking" data-id="${b._id}">Edit</button>
        <button class="btn btn-danger btn-sm delete-booking" data-id="${b._id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  // Edit booking (simple status change via prompt)
  container.querySelectorAll('.edit-booking').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      // Determine current status from the row and toggle between Pending and Completed
      const row = btn.closest('tr');
      const statusCell = row?.querySelector('td:nth-child(4)');
      const currentStatus = statusCell?.textContent.trim();
      const newStatus = currentStatus === 'Pending' ? 'Completed' : 'Pending';
      await api(`/api/bookings/${id}`, 'PUT', { status: newStatus }, true);
      loadAdminBookings();
    });
  });

  // Delete booking
  container.querySelectorAll('.delete-booking').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this booking?')) return;
      const id = btn.dataset.id;
      await api(`/api/bookings/${id}`, 'DELETE', null, true);
      loadAdminBookings();
    });
  });
}

// Load admin shipments list with edit/delete actions
async function loadAdminShipments() {
  // Bypass auth for demo purposes
  const shipments = await api('/api/shipments', 'GET', null, false);
  const container = document.getElementById('adminShipments');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(shipments) || shipments.length === 0) {
    container.textContent = 'No shipments found.';
    return;
  }
  const table = document.createElement('table');
  table.className = 'admin-shipment-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Shipment ID</th><th>Vehicle</th><th>Driver</th><th>Status</th><th>Actions</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  shipments.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.shipmentId || ''}</td>
      <td>${s.vehicleNumber || ''}</td>
      <td>${s.driverName || ''}</td>
      <td>${s.status || ''}</td>
      <td>
        <button class="btn btn-secondary btn-sm edit-shipment" data-id="${s._id}">Edit</button>
        <button class="btn btn-danger btn-sm delete-shipment" data-id="${s._id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  // Edit shipment status
  container.querySelectorAll('.edit-shipment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      // Toggle status between In Transit and Delivered for demo purposes
      const row = btn.closest('tr');
      const statusCell = row?.querySelector('td:nth-child(4)');
      const currentStatus = statusCell?.textContent.trim();
      const newStatus = currentStatus === 'In Transit' ? 'Delivered' : 'In Transit';
      await api(`/api/shipments/${id}`, 'PUT', { status: newStatus }, true);
      loadAdminShipments();
    });
  });

  // Delete shipment
  container.querySelectorAll('.delete-shipment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this shipment?')) return;
      const id = btn.dataset.id;
      await api(`/api/shipments/${id}`, 'DELETE', null, true);
      loadAdminShipments();
    });
  });
}

// Ensure admin UI loads when admin tab is activated via loadAdminStats
// renderAdminStats (in app.js) already calls loadAdminUsers after rendering summary.
// ---------------------------------------------------------------------
// Admin section toggle helpers (show only one section at a time)
// ---------------------------------------------------------------------
function hideAllAdminSections() {
  const ids = ['adminUsers', 'adminUserLogs', 'adminBookings', 'adminShipments', 'adminVehicles'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showAdminSection(id) {
  hideAllAdminSections();
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

// Attach listeners for the toggle buttons added in dashboard.html
document.getElementById('showAdminUsersBtn')?.addEventListener('click', () => {
  showAdminSection('adminUsers');
  loadAdminUsers();
});
document.getElementById('showAdminBookingsBtn')?.addEventListener('click', () => {
  showAdminSection('adminBookings');
  loadAdminBookings();
});
document.getElementById('showAdminShipmentsBtn')?.addEventListener('click', () => {
  showAdminSection('adminShipments');
  loadAdminShipments();
});
document.getElementById('showAdminVehiclesBtn')?.addEventListener('click', () => {
  // Load fleet data into the admin vehicles section
  showAdminSection('adminVehicles');
  loadAdminVehicles();
});

// Load fleet data for admin view (vehicles list)
async function loadAdminVehicles() {
  // Bypass auth for demo; admin UI can fetch fleet data without token
  const vehicles = await api('/api/fleet', 'GET', null, false);
  const container = document.getElementById('adminVehicles');
  if (!container) return;
  container.innerHTML = '';

  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    container.textContent = 'No vehicles found.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'admin-vehicle-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Number</th><th>Type</th><th>Driver</th><th>Status</th><th>Location</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  vehicles.forEach((v) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${v.vehicleNumber || ''}</td>
      <td>${v.vehicleType || ''}</td>
      <td>${v.driverName || ''}</td>
      <td>${v.status || ''}</td>
      <td>${v.location || ''}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ---------------------------------------------------------------------
// Dashboard Add Form Handlers (Booking, Shipment, Vehicle)
// ---------------------------------------------------------------------

function toggleVisibility(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof show === 'boolean') {
    el.classList.toggle('hidden', !show);
  } else {
    el.classList.toggle('hidden');
  }
}

/** Utility: show loading state on a button */
function setButtonLoading(btn, loading = true) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.original = btn.textContent;
    btn.innerHTML = `${btn.textContent}<span class="loading-spinner"></span>`;
  } else {
    btn.disabled = false;
    if (btn.dataset.original) {
      btn.textContent = btn.dataset.original;
      delete btn.dataset.original;
    }
  }
}

/** Centralized API error handling */
function handleApiError(err) {
  console.error(err);
  const msg = err && err.message ? err.message : 'An error occurred';
  alert(msg);
}

// Booking form handlers
// Use capture phase and stop propagation to prevent the legacy addBooking handler in app.js from executing
document.getElementById('addBookingBtn')?.addEventListener('click', (e) => {
  e.stopImmediatePropagation();
  // Show the booking form
  toggleVisibility('bookingFormContainer', true);
}, true);
document.getElementById('cancelBookingBtn')?.addEventListener('click', () => {
  toggleVisibility('bookingFormContainer', false);
});
document.getElementById('bookingForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  // Simple client‑side validation
  if (!form.customerName.value || !form.origin.value || !form.destination.value) {
    alert('Please fill in all required fields.');
    return;
  }
  const submitBtn = form.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true);
  const data = {
    customerName: form.customerName.value,
    origin: form.origin.value,
    destination: form.destination.value,
    status: form.status.value
  };
  try {
    const res = await api('/api/bookings', 'POST', data, true);
    alert(res.message || 'Booking created');
    toggleVisibility('bookingFormContainer', false);
    loadBookings();
  } catch (err) {
    handleApiError(err);
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

// Shipment form handlers
document.getElementById('addShipmentBtn')?.addEventListener('click', (e) => {
  e.stopImmediatePropagation();
  // Show the shipment form
  toggleVisibility('shipmentFormContainer', true);
}, true);
document.getElementById('cancelShipmentBtn')?.addEventListener('click', () => {
  toggleVisibility('shipmentFormContainer', false);
});
document.getElementById('shipmentForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.vehicleNumber.value || !form.driverName.value || !form.location.value) {
    alert('Please fill in all required fields.');
    return;
  }
  const submitBtn = form.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true);
  const data = {
    trackingId: form.shipmentId.value || undefined,
    vehicleNumber: form.vehicleNumber.value,
    driverName: form.driverName.value,
    status: form.status.value,
    location: form.location.value
  };
  try {
    const res = await api('/api/shipments', 'POST', data, true);
    alert(res.message || 'Shipment created');
    toggleVisibility('shipmentFormContainer', false);
    loadShipments();
  } catch (err) {
    handleApiError(err);
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

// Vehicle form handlers
document.getElementById('addVehicleBtn')?.addEventListener('click', (e) => {
  e.stopImmediatePropagation();
  // Show the vehicle form
  toggleVisibility('vehicleFormContainer', true);
}, true);
document.getElementById('cancelVehicleBtn')?.addEventListener('click', () => {
  toggleVisibility('vehicleFormContainer', false);
});
document.getElementById('vehicleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.vehicleNumber.value || !form.vehicleType.value) {
    alert('Vehicle number and type are required.');
    return;
  }
  const submitBtn = form.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true);
  const data = {
    vehicleNumber: form.vehicleNumber.value,
    vehicleType: form.vehicleType.value,
    driverName: form.driverName.value,
    location: form.location.value,
    status: form.status.value
  };
  try {
    const res = await api('/api/fleet', 'POST', data, true);
    alert(res.message || 'Vehicle added');
    toggleVisibility('vehicleFormContainer', false);
    loadFleet();
  } catch (err) {
    handleApiError(err);
  } finally {
    setButtonLoading(submitBtn, false);
  }
});
