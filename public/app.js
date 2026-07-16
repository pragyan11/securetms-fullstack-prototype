let authToken = localStorage.getItem('secureTmsToken') || '';
// Tracks whether the user has granted webcam permission via the Prepare Camera button
let cameraReady = false;

function persistAuth(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('secureTmsToken', token);
  } else {
    localStorage.removeItem('secureTmsToken');
  }
}

function redirectToDashboard() {
  window.location.href = '/dashboard.html';
}

function redirectToHome() {
  window.location.href = '/index.html';
}

async function api(path, method = 'GET', body = null, useAuth = false) {
  const headers = { 'Content-Type': 'application/json' };

  if (useAuth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const options = {
    method,
    headers,
    credentials: 'include'
  };

  if (body !== null) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(path, options);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      throw new Error(typeof data === 'string' ? data : data.message || 'Request failed');
    }

    return data;
  } catch (error) {
    return { error: true, message: error.message || 'Request failed' };
  }
}

// Verify the stored auth token with the backend and store user info
let authUser = null;
async function verifyAuth() {
  if (!authToken) return false;
  const res = await api('/api/auth/verify', 'GET', null, true);
  if (!res.error && res.valid) {
    authUser = res.user; // store decoded user payload for UI decisions
    return true;
  }
  return false;
}

function showRaw(obj, outputId = 'logsOutput') {
  const output = document.getElementById(outputId);
  if (!output) return;
  output.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

// Capture a single frame from the user's webcam and return a base64 data URL
async function captureFaceImage() {
  const video = document.getElementById('faceVideo');
  if (!video) throw new Error('Face video element not found');

  // Request webcam access
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  video.style.display = 'block';

  // Wait for the video to be ready
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });

  // Capture a frame after a short delay to allow camera to adjust
  await new Promise(r => setTimeout(r, 500));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');

  // Stop all tracks to release the camera
  stream.getTracks().forEach(t => t.stop());
  video.style.display = 'none';
  video.srcObject = null;
  return dataUrl;
}

function activateTab(tabId) {
  const tabs = document.querySelectorAll('.tab-content');
  const buttons = document.querySelectorAll('.inner-tab');

  tabs.forEach((tab) => tab.classList.add('hidden'));
  buttons.forEach((button) => button.classList.remove('active'));

  const activeTab = document.getElementById(tabId);
  if (activeTab) {
    activeTab.classList.remove('hidden');
  }

  buttons.forEach((button) => {
    if (button.dataset.tab === tabId) {
      button.classList.add('active');
    }
  });
}

async function registerUser() {
  // Grab the message element first so we can safely use it throughout the function.
  const msg = document.getElementById('regMsg');

  const data = {
    name: document.getElementById('regName')?.value.trim() || '',
    email: document.getElementById('regEmail')?.value.trim() || '',
    role: document.getElementById('regRole')?.value || 'Customer',
    authMethod: document.getElementById('regMethod')?.value || 'Passkey',
    recoveryEmail: document.getElementById('regRecovery')?.value.trim() || ''
  };

  // If Face authentication is selected, ensure the camera was prepared first.
  if (data.authMethod === 'Face') {
    if (!cameraReady) {
      if (msg) msg.textContent = 'Please click "Prepare Camera" before registering with Face.';
      return;
    }
    try {
      const img = await captureFaceImage();
      data.image = img; // attach base64 PNG
    } catch (e) {
      if (msg) msg.textContent = 'Face capture failed during registration: ' + (e.message || e);
      return;
    }
    // Reset flag after registration so the user must prepare again for next use.
    cameraReady = false;
  }

  if (msg) msg.textContent = 'Creating your account...';

  const res = await api('/api/auth/register', 'POST', data);
  if (msg) {
    msg.textContent = res.message || 'Registration complete.';
  }
}

async function loginUser() {
  const email = document.getElementById('loginEmail')?.value.trim() || '';
  const method = document.getElementById('loginMethod')?.value || 'Passkey';
  const msg = document.getElementById('loginMsg');

  if (!email) {
    if (msg) msg.textContent = 'Please enter your email.';
    return;
  }

  if (msg) msg.textContent = 'Authenticating...';
  // If Face authentication, ensure camera was prepared
  if (method === 'Face' && !cameraReady) {
    if (msg) msg.textContent = 'Please click "Prepare Camera" before signing in with Face.';
    return;
  }

  // Choose endpoint based on authentication method
  const endpoint = method === 'Face' ? '/api/auth/login/face' : '/api/auth/login';
  let payload = { email, authMethod: method };

  // If Face authentication, capture a webcam snapshot and include it
  if (method === 'Face') {
    try {
      const imageData = await captureFaceImage();
      payload.image = imageData; // base64 data URL
    } catch (e) {
      if (msg) msg.textContent = 'Face capture failed: ' + (e.message || e);
      return;
    }
  }

  const res = await api(endpoint, 'POST', payload);

  if (res.token) {
    persistAuth(res.token);
    // Reset camera readiness after a successful login
    cameraReady = false;
    if (msg) msg.textContent = res.message || 'Authenticated';
    redirectToDashboard();
    return;
  }

  if (msg) msg.textContent = res.message || 'Sign-in failed.';
}

async function recoverAccount() {
  const email = document.getElementById('loginEmail')?.value.trim() || '';
  const recoveryEmail = prompt('Enter recovery email');
  const msg = document.getElementById('loginMsg');

  if (!email || !recoveryEmail) {
    if (msg) msg.textContent = 'Recovery cancelled.';
    return;
  }

  const res = await api('/api/auth/recover', 'POST', { email, recoveryEmail });
  if (msg) msg.textContent = res.message || 'Recovery request processed.';
}

async function logoutUser() {
  persistAuth('');
  await api('/api/auth/logout', 'POST', {}, false);
  redirectToHome();
}

function renderBookings(bookingsArray) {
  const output = document.getElementById('bookingsOutput');
  if (!output) return;
  output.innerHTML = '';

  if (!Array.isArray(bookingsArray) || bookingsArray.length === 0) {
    output.innerHTML = '<div class="empty-state">📭 No bookings yet. Create one to get started!</div>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'cards-grid';

  bookingsArray.forEach((booking, idx) => {
    const statusIcon = booking.status === 'Pending' ? '⏳' : booking.status === 'Completed' ? '✅' : '📦';
    const statusColor = booking.status === 'Pending' ? '#ff9f43' : booking.status === 'Completed' ? '#22c55e' : '#94a3b8';
    const shortId = (booking._id || '').substring(0, 8).toUpperCase();
    const createdDate = booking.createdAt ? new Date(booking.createdAt).toLocaleDateString() : 'N/A';

    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${statusIcon} ${booking.customerName || 'Customer'}</div>
        <div class="card-id">ID: ${shortId}</div>
      </div>
      <div class="card-body">
        <div class="card-row">
          <span class="card-label">📍 From</span>
          <span class="card-value">${booking.origin || 'Not specified'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">🎯 To</span>
          <span class="card-value">${booking.destination || 'Not specified'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">📅 Created</span>
          <span class="card-value">${createdDate}</span>
        </div>
        <div class="card-row">
          <span class="card-label">Status</span>
          <span class="card-status" style="background-color: ${statusColor}22; color: ${statusColor}; border-color: ${statusColor}44">${booking.status}</span>
        </div>
      </div>
    `;
    wrapper.appendChild(card);
  });

  output.appendChild(wrapper);
}

function renderShipments(shipmentsArray) {
  const output = document.getElementById('shipmentsOutput');
  if (!output) return;
  output.innerHTML = '';

  if (!Array.isArray(shipmentsArray) || shipmentsArray.length === 0) {
    output.innerHTML = '<div class="empty-state">📦 No shipments yet. Add one to track!</div>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'cards-grid';

  shipmentsArray.forEach((shipment) => {
    const statusIcons = {
      'Created': '📋',
      'In Transit': '🚚',
      'Delivered': '✅',
      'default': '📦'
    };
    const statusIcon = statusIcons[shipment.status] || statusIcons['default'];
    const statusColor = shipment.status === 'In Transit' ? '#ff9f43' : shipment.status === 'Delivered' ? '#22c55e' : '#94a3b8';
    const shortId = (shipment._id || '').substring(0, 8).toUpperCase();
    const updatedDate = shipment.updatedAt ? new Date(shipment.updatedAt).toLocaleTimeString() : 'N/A';

    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${statusIcon} ${shipment.vehicleNumber || 'Shipment'}</div>
        <div class="card-id">ID: ${shortId}</div>
      </div>
      <div class="card-body">
        <div class="card-row">
          <span class="card-label">🚙 Vehicle</span>
          <span class="card-value">${shipment.vehicleNumber || 'N/A'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">👤 Driver</span>
          <span class="card-value">${shipment.driverName || 'N/A'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">📍 Location</span>
          <span class="card-value">${shipment.location || 'Not updated'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">Status</span>
          <span class="card-status" style="background-color: ${statusColor}22; color: ${statusColor}; border-color: ${statusColor}44">${shipment.status}</span>
        </div>
        <div class="card-row">
          <span class="card-label">⏰ Updated</span>
          <span class="card-value">${updatedDate}</span>
        </div>
      </div>
    `;
    wrapper.appendChild(card);
  });

  output.appendChild(wrapper);
}

function renderFleet(fleetArray) {
  const output = document.getElementById('fleetOutput');
  if (!output) return;
  output.innerHTML = '';

  if (!Array.isArray(fleetArray) || fleetArray.length === 0) {
    output.textContent = 'No fleet data available.';
    return;
  }

  const wrapper = document.createElement('div');
  const summary = document.createElement('div');
  summary.className = 'dashboard-summary';

  const total = fleetArray.length;
  const inTransit = fleetArray.filter((vehicle) => vehicle.status === 'In Transit').length;
  const maintenance = fleetArray.filter((vehicle) => vehicle.status === 'Maintenance').length;
  const available = fleetArray.filter((vehicle) => vehicle.status === 'Available').length;

  [
    { label: 'Total vehicles', value: total },
    { label: 'In transit', value: inTransit },
    { label: 'Available', value: available },
    { label: 'In maintenance', value: maintenance }
  ].forEach((item) => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `
      <span class="kpi-label">${item.label}</span>
      <span class="kpi-value">${item.value}</span>
    `;
    summary.appendChild(card);
  });

  wrapper.appendChild(summary);

  const grid = document.createElement('div');
  grid.className = 'fleet-grid';

  fleetArray.forEach((vehicle) => {
    const card = document.createElement('div');
    const statusClass = `status-${String(vehicle.status || '')
      .replace(/\s+/g, '-')
      .toLowerCase()}`;
    card.className = `fleet-card ${statusClass}`;

    card.innerHTML = `
      <div class="fleet-card-header">
        <div class="fleet-title">${vehicle.vehicleNumber || 'Vehicle'}</div>
        <div class="fleet-type">${vehicle.vehicleType || ''}</div>
      </div>
      <div class="fleet-card-body">
        <p><span class="label">Driver</span><span class="value">${vehicle.driverName || 'N/A'}</span></p>
        <p><span class="label">Status</span><span class="value">${vehicle.status || 'Unknown'}</span></p>
        <p><span class="label">Location</span><span class="value">${vehicle.location || 'N/A'}</span></p>
        <p><span class="label">Updated</span><span class="value">${vehicle.updatedAt ? new Date(vehicle.updatedAt).toLocaleString() : 'N/A'}</span></p>
      </div>
    `;

    grid.appendChild(card);
  });

  wrapper.appendChild(grid);
  output.appendChild(wrapper);
}

function renderAdminStats(stats) {
  const output = document.getElementById('adminOutput');
  if (!output) return;
  output.innerHTML = '';

  if (!stats || typeof stats !== 'object') {
    output.textContent = 'No admin stats available.';
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'dashboard-summary';

  [
    { label: 'Users', value: stats.users },
    { label: 'Bookings', value: stats.bookings },
    { label: 'Shipments', value: stats.shipments },
    { label: 'Vehicles', value: stats.vehicles }
  ].forEach((item) => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `
      <span class="kpi-label">${item.label}</span>
      <span class="kpi-value">${item.value ?? 0}</span>
    `;
    summary.appendChild(card);
  });

  output.appendChild(summary);
}

async function addBooking() {
  const customerName = prompt('Customer name:');
  const origin = prompt('Origin:');
  const destination = prompt('Destination:');

  if (!customerName || !origin || !destination) {
    alert('Booking creation cancelled.');
    return;
  }

  const body = { customerName, origin, destination, status: 'Pending' };
  const res = await api('/api/bookings', 'POST', body, true);
  alert(res.message || 'Booking created.');
  await loadBookings();
}

async function addShipment() {
  const vehicleNumber = prompt('Vehicle number:');
  const driverName = prompt('Driver name:');
  const location = prompt('Location:');

  if (!vehicleNumber || !driverName) {
    alert('Shipment creation cancelled.');
    return;
  }

  const body = { vehicleNumber, driverName, location, status: 'Created' };
  const res = await api('/api/shipments', 'POST', body, true);
  alert(res.message || 'Shipment created.');
  await loadShipments();
}

async function addVehicle() {
  const vehicleNumber = prompt('Vehicle number:');
  const vehicleType = prompt('Vehicle type (Truck, Van, etc.):');
  const driverName = prompt('Driver name:');
  const location = prompt('Location:');

  if (!vehicleNumber || !vehicleType) {
    alert('Vehicle creation cancelled.');
    return;
  }

  const body = {
    vehicleNumber,
    vehicleType,
    driverName,
    location,
    status: 'Available'
  };

  const res = await api('/api/fleet', 'POST', body, true);
  alert(res.message || 'Vehicle created.');
  await loadFleet();
}

async function loadBookings() {
  activateTab('bookingsTab');
  const bookings = await api('/api/bookings', 'GET', null, true);
  renderBookings(Array.isArray(bookings) ? bookings : bookings.data || []);
}

async function loadShipments() {
  activateTab('shipmentsTab');
  const shipments = await api('/api/shipments', 'GET', null, true);
  renderShipments(Array.isArray(shipments) ? shipments : shipments.data || []);
}

async function loadFleet() {
  activateTab('fleetTab');
  const fleet = await api('/api/fleet', 'GET', null, true);
  renderFleet(Array.isArray(fleet) ? fleet : fleet.data || []);
}

async function loadLogs() {
  activateTab('logsTab');
  const logs = await api('/api/logs', 'GET', null, true);
  renderLogs(logs);
}

function renderLogs(logsArray) {
  const output = document.getElementById('logsOutput');
  if (!output) return;
  output.innerHTML = '';

  if (!Array.isArray(logsArray) || logsArray.length === 0) {
    output.innerHTML = '<div class="empty-state">📋 No audit logs available.</div>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'logs-list';

  logsArray.forEach((log) => {
    const actionIcons = {
      'REGISTER': '📝',
      'LOGIN': '🔐',
      'LOGOUT': '🚪',
      'BOOKING_CREATE': '📦',
      'BOOKING_UPDATE': '✏️',
      'BOOKING_DELETE': '🗑️',
      'VEHICLE_CREATE': '🚙',
      'VEHICLE_UPDATE': '🔧',
      'VEHICLE_DELETE': '🗑️',
      'SHIPMENT_CREATE': '📮',
      'SHIPMENT_UPDATE': '🚚',
      'default': '📌'
    };
    const icon = actionIcons[log.action] || actionIcons['default'];
    const time = log.createdAt ? new Date(log.createdAt).toLocaleString() : 'N/A';

    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.innerHTML = `
      <div class="log-icon">${icon}</div>
      <div class="log-content">
        <div class="log-action">${log.action.replace(/_/g, ' ')}</div>
        <div class="log-user">User: ${log.userEmail || 'anonymous'}</div>
        <div class="log-details">${log.details || 'No details'}</div>
        <div class="log-meta">
          <span>⏰ ${time}</span>
          <span>📍 ${log.ipAddress || 'Unknown IP'}</span>
        </div>
      </div>
    `;
    wrapper.appendChild(logEntry);
  });

  output.appendChild(wrapper);
}

async function loadAdminStats() {
  activateTab('adminTab');
  const stats = await api('/api/admin/dashboard', 'GET', null, true);
  renderAdminStats(stats);
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.location.pathname.includes('/dashboard.html') && !authToken) {
    window.location.href = '/login.html';
    return;
  }

  if (window.location.pathname.includes('/login.html') && authToken) {
    redirectToDashboard();
    return;
  }

  // Verify token and populate authUser (used for role‑based UI decisions)
  await verifyAuth();

  // Hide admin tab for non‑admin users to avoid unnecessary 403 requests
  if (!authUser || authUser.role !== 'Admin') {
    const adminTabBtn = document.querySelector('button[data-tab="adminTab"]');
    if (adminTabBtn) adminTabBtn.style.display = 'none';
  }

  document.getElementById('registerBtn')?.addEventListener('click', registerUser);
  document.getElementById('loginBtn')?.addEventListener('click', loginUser);
  document.getElementById('recoverBtn')?.addEventListener('click', recoverAccount);
  // Prepare camera button – requests webcam permission ahead of time and sets a flag
  document.getElementById('prepareCamBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('loginMsg');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Immediately stop – we only needed the permission prompt
      stream.getTracks().forEach(t => t.stop());
      // Remember that permission was granted
      cameraReady = true;
      if (msg) msg.textContent = 'Camera ready – you can now sign in with Face.';
    } catch (e) {
      cameraReady = false;
      if (msg) msg.textContent = 'Camera access denied: ' + (e.message || e);
    }
  });
  document.getElementById('logoutBtn')?.addEventListener('click', logoutUser);

  document.querySelectorAll('.inner-tab').forEach((button) => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.tab);
    });
  });

  document.getElementById('refreshBookingsBtn')?.addEventListener('click', loadBookings);
  document.getElementById('refreshShipmentsBtn')?.addEventListener('click', loadShipments);
  document.getElementById('refreshFleetBtn')?.addEventListener('click', loadFleet);
  document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);
  document.getElementById('refreshAdminBtn')?.addEventListener('click', loadAdminStats);

  document.getElementById('addBookingBtn')?.addEventListener('click', addBooking);
  document.getElementById('addShipmentBtn')?.addEventListener('click', addShipment);
  document.getElementById('addVehicleBtn')?.addEventListener('click', addVehicle);

  if (document.getElementById('bookingsOutput')) {
    loadBookings();
  }
  if (document.getElementById('shipmentsOutput')) {
    loadShipments();
  }
  if (document.getElementById('fleetOutput')) {
    loadFleet();
  }
  // Load logs only for admin users (logs endpoint is admin‑only)
  if (document.getElementById('logsOutput')) {
    if (authUser && authUser.role === 'Admin') {
      loadLogs();
    } else {
      document.getElementById('logsOutput').textContent = 'Logs are available to admin users only.';
    }
  }
  // Load admin stats only for admin users to avoid 403 errors for others
  if (document.getElementById('adminOutput') && authUser && authUser.role === 'Admin') {
    loadAdminStats();
  }
});