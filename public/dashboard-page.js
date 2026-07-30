/*════════════════════════════════════════════════════════════════════════════
SecureTMS — World-Class Admin / Operations Console
Full CRUD: Create, Read, Update, Delete on every tab.
Includes: search, sort, pagination, export CSV, analytics charts,
maintenance tracking, notifications, quick actions, theme toggle,
live GPS map, socket.io real-time, drag-and-drop dispatch board.
═══════════════════════════════════════════════════════════════════════════*/
'use strict';

(function () {
  var S = window.SecureTMS || {};
  var esc       = S.escapeHtml  || function(x){ return String(x == null ? '' : x); };
  var FmtDateT  = S.fmtDateTime || function(s){ return s ? new Date(s).toLocaleString() : '—'; };
  var pillClass = S.pillClass   || function(){ return 'is-other'; };
  var initials  = S.initials    || function(s){ return (s || 'A')[0].toUpperCase(); };
  function arr(v) { return (v && v.data) || (Array.isArray(v) ? v : []); }

  var sortState = { bookings: { field: 'createdAt', order: 'desc' }, shipments: { field: 'updatedAt', order: 'desc' }, fleet: { field: 'updatedAt', order: 'desc' } };
  var pageState = { bookings: 1, shipments: 1, fleet: 1 };
  var activeTab = 'overviewTab';
  var notifications = [];
  var rowCache = { bookings: {}, shipments: {}, fleet: {} };

  function clearSkeleton(id) { var el = document.getElementById(id); if (el && el.querySelector) { var sk = el.querySelector('.skeleton'); if (sk) sk.remove(); } }
  function setTileError(id, m) { var el = document.getElementById(id); if (el) el.innerHTML = '<span class="pill is-error" title="' + esc(m||'Failed') + '">Failed</span>'; }
  function setRefreshBusy(busy) { var b = document.getElementById('refreshAllBtn'); if (b) { b.disabled = busy; b.textContent = busy ? 'Refreshing…' : (b.dataset.defaultLabel || 'Refresh all'); } }

  function fillIdentity(user) {
    var dn = (user && (user.name || user.email)) || 'Admin';
    var ne = document.getElementById('userName'), ae = document.getElementById('userAvatar');
    var rb = document.querySelector('.user-chip-role');
    if (ne) ne.textContent = dn; if (ae) ae.textContent = initials(dn, 'A');
    if (rb && user && user.role) rb.textContent = user.role;
  }

  function initTheme() {
    if (localStorage.getItem('secureTmsTheme') === 'dark') document.body.classList.add('dark');
    var btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', function() { document.body.classList.toggle('dark'); localStorage.setItem('secureTmsTheme', document.body.classList.contains('dark') ? 'dark' : 'light'); });
  }

  /* ── Universal Modal Close Handler ─────────────────────────────── */
  var _modalBound = false;
  function initModalClosers() {
    if (_modalBound) return;
    _modalBound = true;
    document.addEventListener('click', function(e) {
      // Close via data-close-modal attribute (✕ and Cancel buttons)
      var closer = e.target && e.target.closest && e.target.closest('[data-close-modal]');
      if (closer) {
        var id = closer.getAttribute('data-close-modal');
        var modal = document.getElementById(id);
        if (modal) modal.style.display = 'none';
        return;
      }
      // Close via clicking the modal backdrop (outside the card)
      if (e.target.classList && e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
        return;
      }
    });
    // ESC key closes any open modal
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var all = document.querySelectorAll('.modal-overlay');
        all.forEach(function(m) { if (m.style.display !== 'none') m.style.display = 'none'; });
      }
    });
  }

  /* ── Notifications ──────────────────────────────────────────────── */
  function addNotification(action, source) { notifications.unshift({action:action,source:source,time:new Date().toISOString()}); if (notifications.length>50) notifications.length=50; renderNotifications(); updateNotifBadge(); }
  function renderNotifications() { var b=document.getElementById('notifBody'); if(!b)return; if(!notifications.length){b.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:24px;">No notifications yet</div>';return;} b.innerHTML=notifications.map(function(n){return'<div class="notif-item"><strong>'+esc(n.action)+'</strong> · '+esc(n.source)+'<div class="notif-time">'+FmtDateT(n.time)+'</div></div>';}).join(''); }
  function updateNotifBadge() { var bell=document.getElementById('notifBell'); if(!bell)return; if(notifications.length>0){bell.classList.add('has-unread');bell.setAttribute('data-count',Math.min(notifications.length,99));}else bell.classList.remove('has-unread'); }
  function wireNotifPanel() { var p=document.getElementById('notifPanel'),bd=document.getElementById('notifBackdrop'),bell=document.getElementById('notifBell'),cl=document.getElementById('closeNotifPanel'); if(!p||!bd)return; function o(){p.classList.add('is-open');bd.classList.add('is-open');notifications=[];updateNotifBadge();} function c(){p.classList.remove('is-open');bd.classList.remove('is-open');} if(bell)bell.addEventListener('click',o); if(cl)cl.addEventListener('click',c); bd.addEventListener('click',c); }

  /* ── Tab Navigation ─────────────────────────────────────────────── */
  var ALL_TABS = ['overviewTab','bookingsTab','shipmentsTab','fleetTab','maintenanceTab','analyticsTab','dispatchTab','mapTab','logsTab','teamTab','invitesTab'];
  function showTab(name) {
    var link = document.querySelector('.nav-link[data-tab="' + name + '"]');
    if (link) link.click();
  }
  function wireNavLinks() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.dataset.navBound === '1') return;
    sidebar.dataset.navBound = '1';
    sidebar.addEventListener('click', function(e) {
      var link = e.target && e.target.closest && e.target.closest('a.nav-link[data-tab]');
      if (!link) return;
      e.preventDefault();
      document.querySelectorAll('.nav-link').forEach(function(x) { x.classList.remove('is-active'); });
      link.classList.add('is-active');
      activeTab = link.dataset.tab;
      ALL_TABS.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = (id === activeTab) ? '' : 'none'; });
      onTabVisible(activeTab);
    });
    var invitesEl = document.getElementById('invitesOutput');
    if (invitesEl && !invitesEl.dataset.inviteBound) {
      invitesEl.dataset.inviteBound = '1';
      invitesEl.addEventListener('click', function(e) { var el = e.target && e.target.closest && e.target.closest('.invite-url-input'); if (el) { try { el.focus(); el.select(); } catch(_e){} } });
    }
  }

  async function onTabVisible(t) {
    if (t === 'overviewTab') await renderOverview();
    else if (t === 'bookingsTab') await loadBookings();
    else if (t === 'shipmentsTab') await loadShipments();
    else if (t === 'fleetTab') await loadFleet();
    else if (t === 'maintenanceTab') await loadMaintenance();
    else if (t === 'analyticsTab') await loadAnalytics();
    else if (t === 'dispatchTab') await renderDispatchBoard();
    else if (t === 'logsTab') await loadLogs();
    else if (t === 'teamTab') await loadUsers();
    else if (t === 'invitesTab') await loadInvites();
    else if (t === 'mapTab') setTimeout(function() { renderAdminMap(); }, 80);
  }

  var _dt = {};
  function debouncedLoad(name, fn) { clearTimeout(_dt[name]); _dt[name] = setTimeout(function() { delete _dt[name]; try { fn(); } catch(_e){} }, 250); }

  function wireSearch(inputId, filterId, loadFn) {
    var input = document.getElementById(inputId), select = document.getElementById(filterId);
    if (input) input.addEventListener('input', function() { pageState[inputId.replace('Search','')] = 1; loadFn(); });
    if (select) select.addEventListener('change', function() { pageState[select.id.replace('StatusFilter','').replace('Search','')] = 1; loadFn(); });
  }
  function wireSort(tableId, type, loadFn) {
    var table = document.querySelector('#' + tableId + ' thead');
    if (!table || table.dataset.sortBound === '1') return;
    table.dataset.sortBound = '1';
    table.addEventListener('click', function(e) {
      var th = e.target && e.target.closest && e.target.closest('th.sortable');
      if (!th) return;
      var field = th.dataset.sort;
      if (sortState[type].field === field) sortState[type].order = sortState[type].order === 'asc' ? 'desc' : 'asc';
      else { sortState[type].field = field; sortState[type].order = 'asc'; }
      table.querySelectorAll('th.sortable').forEach(function(h) { h.classList.remove('sort-asc','sort-desc'); });
      th.classList.add(sortState[type].order === 'asc' ? 'sort-asc' : 'sort-desc');
      pageState[type] = 1; loadFn();
    });
  }

  function renderPagination(containerId, type, total, pages, loadFn) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var page = pageState[type];
    if (pages <= 1) { el.innerHTML = ''; return; }
    var html = '<button ' + (page<=1?'disabled':'') + ' data-p="'+(page-1)+'">←</button>';
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= page - 2 && i <= page + 2)) {
        html += '<button class="' + (i===page?'is-active':'') + '" data-p="' + i + '">' + i + '</button>';
      } else if (i === page - 3 || i === page + 3) html += '<button disabled>…</button>';
    }
    html += '<button ' + (page>=pages?'disabled':'') + ' data-p="'+(page+1)+'">→</button>';
    html += '<span style="font-size:12px;color:var(--text-muted);margin-left:8px;">' + total + ' total</span>';
    el.innerHTML = html;
    el.querySelectorAll('button[data-p]').forEach(function(b) { if (!b.disabled) b.addEventListener('click', function() { pageState[type] = parseInt(b.dataset.p); loadFn(); }); });
  }

  /* ── KPI Loader ─────────────────────────────────────────────────── */
  async function refreshAll() {
    setRefreshBusy(true);
    try { await Promise.all([loadKPIs(), debouncedLoad('bookings',loadBookings), debouncedLoad('shipments',loadShipments), debouncedLoad('fleet',loadFleet)]); var ov=document.getElementById('overviewTab'); if(ov&&ov.style.display!=='none') await renderOverview(); }
    finally { setRefreshBusy(false); }
  }

  async function loadKPIs() {
    var results = await Promise.allSettled([window.api('/api/bookings/stats','GET',null,true), window.api('/api/shipments/stats','GET',null,true), window.api('/api/fleet?limit=1','GET',null,true), window.api('/api/admin/dashboard','GET',null,true)]);
    var setNum = function(id, n) { var e = document.getElementById(id); if (e) { clearSkeleton(id); e.textContent = (typeof n==='number'&&!isNaN(n)) ? n : '—'; } };
    if(results[0].status==='fulfilled') setNum('kpiBookingsValue', results[0].value.total); else { clearSkeleton('kpiBookingsValue'); setTileError('kpiBookingsValue','Bookings unavailable'); }
    if(results[1].status==='fulfilled') setNum('kpiShipmentsValue', results[1].value.total); else { clearSkeleton('kpiShipmentsValue'); setTileError('kpiShipmentsValue','Shipments unavailable'); }
    if(results[2].status==='fulfilled') setNum('kpiFleetValue', results[2].value.total || arr(results[2].value).length); else { clearSkeleton('kpiFleetValue'); setTileError('kpiFleetValue','Fleet unavailable'); }
    if(results[3].status==='fulfilled') setNum('kpiUsersValue', (results[3].value&&results[3].value.users!=null)?results[3].value.users:'—'); else { clearSkeleton('kpiUsersValue'); setTileError('kpiUsersValue','Users unavailable'); }
  }

  async function renderOverview() {
    var b=await window.api('/api/bookings?limit=50','GET',null,true).catch(function(){return {data:[]};});
    var s=await window.api('/api/shipments?limit=50','GET',null,true).catch(function(){return {data:[]};});
    var f=await window.api('/api/fleet?limit=50','GET',null,true).catch(function(){return {data:[]};});
    var ba=arr(b), sa=arr(s), fa=arr(f);
    function col(title,items,fmt) { return '<div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">'+esc(title)+' ('+items.length+')</div>'+(items.length===0?'<div style="font-size:13px;color:var(--text-muted);">No items.</div>':items.slice(0,8).map(fmt).join(''))+'</div>'; }
    var html = col('Pending bookings', ba.filter(function(x){return x.status==='Pending';}), function(b){return'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-soft);font-size:13px;"><span>'+esc(b.customerName||'—')+'</span><span style="color:var(--text-muted);">'+esc(b.origin||'')+' → '+esc(b.destination||'')+'</span></div>';})
      + col('In transit', sa.filter(function(x){return x.status==='In Transit'||x.status==='Picked Up';}), function(x){return'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-soft);font-size:13px;"><span class="font-mono">'+esc(x.trackingId)+'</span><span style="color:var(--text-muted);">'+esc(x.driverName||'')+' · '+esc(x.currentLocation||'')+'</span></div>';})
      + col('Fleet status', fa, function(x){return'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-soft);font-size:13px;"><span>'+esc(x.vehicleNumber)+'</span><span class="pill '+pillClass(x.status)+'" style="font-size:11px;">'+esc(x.status)+'</span></div>';});
    var ov=document.getElementById('overviewOutput'); if(ov){ov.className='';ov.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;">'+html+'</div>';}
  }

  function renderTableRows(tbodyEl, rows, cols, opts) {
    if (!tbodyEl) return;
    if (!rows.length) { tbodyEl.innerHTML = '<tr><td colspan="' + ((cols&&cols.length)||1) + '" class="empty-state" style="border:none;">' + esc((opts&&opts.empty)||'No data yet.') + '</td></tr>'; return; }
    tbodyEl.innerHTML = rows.map(function(row) { return '<tr>' + cols.map(function(c) { return '<td>' + c(row) + '</td>'; }).join('') + '</tr>'; }).join('');
  }

  /* ════════════════════════════════════════════════════════════════════
     CRUD: BOOKINGS
     ════════════════════════════════════════════════════════════════════ */

  async function loadBookings() {
    var search = (document.getElementById('bookingsSearch')||{}).value || '';
    var status = (document.getElementById('bookingsStatusFilter')||{}).value || '';
    var s = sortState.bookings;
    var params = '?page='+pageState.bookings+'&limit=10&sort='+s.field+'&order='+s.order+(search?'&search='+encodeURIComponent(search):'')+(status?'&status='+status:'');
    var res = await window.api('/api/bookings'+params, 'GET', null, true).catch(function(){return {data:[]};});
    var a = arr(res);
    a.forEach(function(b){ rowCache.bookings[b._id] = b; });
    renderTableRows(document.getElementById('bookingsOutput'), a, [
      function(b){return esc(b.customerName||'—');},
      function(b){return esc(b.origin||'—')+' → '+esc(b.destination||'—');},
      function(b){return '<span class="pill '+pillClass(b.status)+'">'+esc(b.status||'Pending')+'</span>';},
      function(b){return esc(b.serviceZone||'—');},
      function(b){return '<span class="font-mono" style="color:var(--text-muted);font-size:12px;">'+FmtDateT(b.createdAt)+'</span>';},
      function(b){return '<div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" onclick="window.adminPage.editBooking(\''+b._id+'\')">✏️</button><button class="btn btn-ghost btn-sm" onclick="window.adminPage.deleteBooking(\''+b._id+'\')">🗑</button></div>';}
    ], { empty: 'No bookings found.' });
    renderPagination('bookingsPagination', 'bookings', res.total||a.length, res.pages||1, loadBookings);
  }

  function editBooking(id) {
    var b = rowCache.bookings[id];
    if (!b) return;
    document.getElementById('ebId').value = id;
    document.getElementById('ebCustomer').value = b.customerName || '';
    document.getElementById('ebOrigin').value = b.origin || '';
    document.getElementById('ebDestination').value = b.destination || '';
    document.getElementById('ebStatus').value = b.status || 'Pending';
    document.getElementById('ebZone').value = b.serviceZone || 'Central';
    document.getElementById('editBookingModal').style.display = '';
  }

  async function updateBooking(e) {
    e.preventDefault();
    var id = document.getElementById('ebId').value;
    var data = {
      customerName: document.getElementById('ebCustomer').value.trim(),
      origin: document.getElementById('ebOrigin').value.trim(),
      destination: document.getElementById('ebDestination').value.trim(),
      status: document.getElementById('ebStatus').value,
      serviceZone: document.getElementById('ebZone').value
    };
    var res = await window.api('/api/bookings/'+id, 'PUT', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('editBookingModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Booking updated', { kind: 'success' });
    loadBookings();
  }

  function createBooking() {
    // Clear form
    document.getElementById('cbCustomer').value = '';
    document.getElementById('cbOrigin').value = '';
    document.getElementById('cbDestination').value = '';
    document.getElementById('cbZone').value = 'Central';
    document.getElementById('cbPriority').value = 'Standard';
    document.getElementById('createBookingModal').style.display = '';
  }

  async function handleCreateBooking(e) {
    e.preventDefault();
    var origin = document.getElementById('cbOrigin').value.trim();
    var dest = document.getElementById('cbDestination').value.trim();
    if (!origin || !dest) { if (typeof window.notify === 'function') window.notify('Pickup and delivery addresses are required', { kind: 'warn' }); return; }
    var data = {
      customerName: document.getElementById('cbCustomer').value.trim(),
      origin: origin,
      destination: dest,
      serviceZone: document.getElementById('cbZone').value,
      priority: document.getElementById('cbPriority').value
    };
    var res = await window.api('/api/bookings', 'POST', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('createBookingModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Booking created!', { kind: 'success' });
    loadBookings();
    loadKPIs();
  }

  async function deleteBooking(id) {
    if (!confirm('Delete this booking?')) return;
    var res = await window.api('/api/bookings/'+id, 'DELETE', null, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    if (typeof window.notify === 'function') window.notify('Booking deleted', { kind: 'success' });
    loadBookings();
    loadKPIs();
  }

  /* ════════════════════════════════════════════════════════════════════
     CRUD: SHIPMENTS
     ════════════════════════════════════════════════════════════════════ */

  async function loadShipments() {
    var search = (document.getElementById('shipmentsSearch')||{}).value || '';
    var status = (document.getElementById('shipmentsStatusFilter')||{}).value || '';
    var s = sortState.shipments;
    var params = '?page='+pageState.shipments+'&limit=10&sort='+s.field+'&order='+s.order+(search?'&search='+encodeURIComponent(search):'')+(status?'&status='+status:'');
    var res = await window.api('/api/shipments'+params, 'GET', null, true).catch(function(){return {data:[]};});
    var a = arr(res);
    a.forEach(function(s){ rowCache.shipments[s._id] = s; });
    renderTableRows(document.getElementById('shipmentsOutput'), a, [
      function(s){return '<span class="font-mono">'+esc(s.trackingId)+'</span>';},
      function(s){return esc(s.pickupAddress||'—')+' → '+esc(s.deliveryAddress||'—');},
      function(s){return esc(s.vehicleNumber||'—');},
      function(s){return esc(s.driverName||'—');},
      function(s){return '<span class="pill '+pillClass(s.status)+'">'+esc(s.status)+'</span>';},
      function(s){return esc(s.eta||'—');},
      function(s){return '<div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" onclick="window.adminPage.editShipment(\''+s._id+'\')">✏️</button><button class="btn btn-ghost btn-sm" onclick="window.adminPage.deleteShipment(\''+s._id+'\')">🗑</button></div>';}
    ], { empty: 'No shipments found.' });
    renderPagination('shipmentsPagination', 'shipments', res.total||a.length, res.pages||1, loadShipments);
  }

  function editShipment(id) {
    var s = rowCache.shipments[id];
    if (!s) return;
    document.getElementById('esId').value = id;
    document.getElementById('esCustomer').value = s.customerName || '';
    document.getElementById('esPickup').value = s.pickupAddress || '';
    document.getElementById('esDelivery').value = s.deliveryAddress || '';
    document.getElementById('esVehicle').value = s.vehicleNumber || '';
    document.getElementById('esDriver').value = s.driverName || '';
    document.getElementById('esStatus').value = s.status || 'Created';
    document.getElementById('esEta').value = s.eta || '';
    document.getElementById('esLocation').value = s.currentLocation || '';
    document.getElementById('editShipmentModal').style.display = '';
  }

  async function updateShipment(e) {
    e.preventDefault();
    var id = document.getElementById('esId').value;
    var data = {
      customerName: document.getElementById('esCustomer').value.trim(),
      pickupAddress: document.getElementById('esPickup').value.trim(),
      deliveryAddress: document.getElementById('esDelivery').value.trim(),
      vehicleNumber: document.getElementById('esVehicle').value.trim(),
      driverName: document.getElementById('esDriver').value.trim(),
      status: document.getElementById('esStatus').value,
      eta: document.getElementById('esEta').value.trim(),
      currentLocation: document.getElementById('esLocation').value.trim()
    };
    var res = await window.api('/api/shipments/'+id, 'PUT', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('editShipmentModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Shipment updated', { kind: 'success' });
    loadShipments();
  }

  function createShipment() {
    // Clear form
    document.getElementById('csCustomer').value = '';
    document.getElementById('csPickup').value = '';
    document.getElementById('csDelivery').value = '';
    document.getElementById('csVehicle').value = '';
    document.getElementById('csDriver').value = '';
    document.getElementById('csStatus').value = 'Created';
    document.getElementById('csEta').value = '';
    document.getElementById('createShipmentModal').style.display = '';
  }

  async function handleCreateShipment(e) {
    e.preventDefault();
    var pickup = document.getElementById('csPickup').value.trim();
    var delivery = document.getElementById('csDelivery').value.trim();
    if (!pickup || !delivery) { if (typeof window.notify === 'function') window.notify('Pickup and delivery addresses are required', { kind: 'warn' }); return; }
    var data = {
      customerName: document.getElementById('csCustomer').value.trim(),
      pickupAddress: pickup,
      deliveryAddress: delivery,
      vehicleNumber: document.getElementById('csVehicle').value.trim(),
      driverName: document.getElementById('csDriver').value.trim(),
      status: document.getElementById('csStatus').value,
      eta: document.getElementById('csEta').value.trim()
    };
    var res = await window.api('/api/shipments', 'POST', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('createShipmentModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Shipment created!', { kind: 'success' });
    loadShipments();
    loadKPIs();
  }

  async function deleteShipment(id) {
    if (!confirm('Delete this shipment?')) return;
    var res = await window.api('/api/shipments/'+id, 'DELETE', null, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    if (typeof window.notify === 'function') window.notify('Shipment deleted', { kind: 'success' });
    loadShipments();
    loadKPIs();
  }

  /* ════════════════════════════════════════════════════════════════════
     CRUD: FLEET
     ════════════════════════════════════════════════════════════════════ */

  async function loadFleet() {
    var search = (document.getElementById('fleetSearch')||{}).value || '';
    var status = (document.getElementById('fleetStatusFilter')||{}).value || '';
    var s = sortState.fleet;
    var params = '?page='+pageState.fleet+'&limit=10&sort='+s.field+'&order='+s.order+(search?'&search='+encodeURIComponent(search):'')+(status?'&status='+status:'');
    var res = await window.api('/api/fleet'+params, 'GET', null, true).catch(function(){return {data:[]};});
    var a = arr(res);
    a.forEach(function(f){ rowCache.fleet[f._id] = f; });
    renderTableRows(document.getElementById('fleetOutput'), a, [
      function(f){return '<span class="font-mono">'+esc(f.vehicleNumber)+'</span>';},
      function(f){return esc(f.vehicleType||'—');},
      function(f){return esc(f.driverName||'—');},
      function(f){return esc(f.location||'—');},
      function(f){return '<span class="pill '+pillClass(f.status)+'">'+esc(f.status)+'</span>';},
      function(f){return esc(f.serviceZone||'—');},
      function(f){return '<div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" onclick="window.adminPage.editVehicle(\''+f._id+'\')">✏️</button><button class="btn btn-ghost btn-sm" onclick="window.adminPage.deleteVehicle(\''+f._id+'\')">🗑</button></div>';}
    ], { empty: 'No vehicles found.' });
    renderPagination('fleetPagination', 'fleet', res.total||a.length, res.pages||1, loadFleet);
  }

  function editVehicle(id) {
    var v = rowCache.fleet[id];
    if (!v) return;
    document.getElementById('evId').value = id;
    document.getElementById('evNumber').value = v.vehicleNumber || '';
    document.getElementById('evType').value = v.vehicleType || '';
    document.getElementById('evDriver').value = v.driverName || '';
    document.getElementById('evLocation').value = v.location || '';
    document.getElementById('evStatus').value = v.status || 'Available';
    document.getElementById('evZone').value = v.serviceZone || 'Central';
    document.getElementById('editVehicleModal').style.display = '';
  }

  async function updateVehicle(e) {
    e.preventDefault();
    var id = document.getElementById('evId').value;
    var data = {
      vehicleNumber: document.getElementById('evNumber').value.trim(),
      vehicleType: document.getElementById('evType').value.trim(),
      driverName: document.getElementById('evDriver').value.trim(),
      location: document.getElementById('evLocation').value.trim(),
      status: document.getElementById('evStatus').value,
      serviceZone: document.getElementById('evZone').value
    };
    var res = await window.api('/api/fleet/'+id, 'PUT', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('editVehicleModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Vehicle updated', { kind: 'success' });
    loadFleet();
  }

  // Add Vehicle (uses existing modal + form)
  async function addVehicle() {
    document.getElementById('addVehicleModal').style.display = '';
  }

  async function handleAddVehicle(e) {
    e.preventDefault();
    var data = {
      vehicleNumber: (document.getElementById('avNumber')||{}).value || '',
      vehicleType: (document.getElementById('avType')||{}).value || 'Truck',
      driverName: (document.getElementById('avDriver')||{}).value || '',
      location: (document.getElementById('avLocation')||{}).value || '',
      status: (document.getElementById('avStatus')||{}).value || 'Available',
      serviceZone: (document.getElementById('avZone')||{}).value || 'Central'
    };
    if (!data.vehicleNumber) return;
    var res = await window.api('/api/fleet', 'POST', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('addVehicleModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Vehicle added', { kind: 'success' });
    loadFleet();
    loadKPIs();
  }

  async function deleteVehicle(id) {
    if (!confirm('Delete this vehicle?')) return;
    var res = await window.api('/api/fleet/'+id, 'DELETE', null, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    if (typeof window.notify === 'function') window.notify('Vehicle deleted', { kind: 'success' });
    loadFleet();
    loadKPIs();
  }

  /* ── Maintenance ───────────────────────────────────────────────── */
  async function loadMaintenance() {
    var res = await window.api('/api/maintenance','GET',null,true).catch(function(){return {data:[]};});
    var a = res.data || (Array.isArray(res) ? res : []);
    var overdueEl = document.getElementById('maintenanceOverdue'), overdueMsg = document.getElementById('maintenanceOverdueMsg');
    if (overdueEl && res.overdue > 0) { overdueEl.style.display = 'flex'; if (overdueMsg) overdueMsg.textContent = res.overdue + ' maintenance task(s) overdue!'; }
    else if (overdueEl) overdueEl.style.display = 'none';
    renderTableRows(document.getElementById('maintenanceOutput'), a, [
      function(m){return '<span class="font-mono">'+esc(m.vehicleNumber)+'</span>';},
      function(m){return '<span class="pill is-other">'+esc(m.type)+'</span>';},
      function(m){return esc(m.description||'—');},
      function(m){return FmtDateT(m.scheduledDate);},
      function(m){return '<span class="pill '+(m.status==='Completed'?'is-delivered':m.status==='Overdue'?'is-cancelled':'is-pending')+'">'+esc(m.status)+'</span>';},
      function(m){return '$'+(m.cost||0).toFixed(2);},
      function(m){return '<button class="btn btn-ghost btn-sm" onclick="window.adminPage.completeMaintenance(\''+m._id+'\')">✓</button>';}
    ], { empty: 'No maintenance records.' });
  }

  async function handleAddMaintenance(e) {
    e.preventDefault();
    var vs=document.getElementById('mntVehicle'),vn=vs&&vs.selectedOptions&&vs.selectedOptions[0]?vs.selectedOptions[0].text:vs?vs.value:'';
    var data={vehicleId:vs?vs.value:'',vehicleNumber:vn,type:(document.getElementById('mntType')||{}).value||'Scheduled',status:(document.getElementById('mntStatus')||{}).value||'Scheduled',description:(document.getElementById('mntDesc')||{}).value||'',scheduledDate:(document.getElementById('mntDate')||{}).value||new Date().toISOString().split('T')[0],cost:parseFloat((document.getElementById('mntCost')||{}).value||'0'),notes:(document.getElementById('mntNotes')||{}).value||''};
    if(!data.vehicleId||!data.description)return;
    var res=await window.api('/api/maintenance','POST',data,true);
    if(res&&res.error){if(typeof window.notify==='function')window.notify(res.message,{kind:'error'});return;}
    document.getElementById('maintenanceModal').style.display='none';
    if(typeof window.notify==='function')window.notify('Maintenance logged',{kind:'success'});
    loadMaintenance();
  }

  async function completeMaintenance(id) { await window.api('/api/maintenance/'+id,'PATCH',{status:'Completed',completedDate:new Date()},true); loadMaintenance(); }
  async function populateMntVehicles() { var sel=document.getElementById('mntVehicle'); if(!sel)return; var res=await window.api('/api/fleet','GET',null,true).catch(function(){return[];}); var a=arr(res); sel.innerHTML=a.map(function(v){return'<option value="'+v._id+'">'+esc(v.vehicleNumber)+' ('+esc(v.vehicleType||'')+')</option>';}).join(''); }

  /* ── Analytics, Dispatch, Logs, Users, Invites ──────────────────── */
  async function loadAnalytics() {
    var bstats=await window.api('/api/bookings/stats','GET',null,true).catch(function(){return {byStatus:[],byZone:[],total:0};});
    var sstats=await window.api('/api/shipments/stats','GET',null,true).catch(function(){return {byStatus:[],total:0};});
    var statsEl=document.getElementById('analyticsStats');
    if(statsEl){
      var m={}; (sstats.byStatus||[]).forEach(function(s){m[s._id]=s.count;});
      var del=m['Delivered']||0, transit=(m['In Transit']||0)+(m['Picked Up']||0)+(m['Created']||0), total=sstats.total||0;
      var onTime=total>0?Math.round((del/total)*100):0;
      statsEl.innerHTML=[
        {label:'Total Shipments',value:total},{label:'Delivered',value:del,trend:'up'},
        {label:'In Transit',value:transit},{label:'On-Time Rate',value:onTime+'%',trend:onTime>=80?'up':'down'}
      ].map(function(s){return'<div class="stat-card"><div class="stat-value">'+s.value+'</div><div class="stat-label">'+s.label+'</div>'+(s.trend?'<div class="stat-trend '+s.trend+'">'+(s.trend==='up'?'↑':'↓')+'</div>':'')+'</div>';}).join('');
    }
    renderBarChart('bookingsBarChart', bstats.byStatus||[]);
    renderBarChart('shipmentsBarChart', sstats.byStatus||[]);
  }
  function renderBarChart(id, data) { var el=document.getElementById(id); if(!el||!data.length){if(el)el.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;">No data</div>';return;} var max=Math.max.apply(null,data.map(function(d){return d.count;}))||1; el.innerHTML=data.map(function(d){var h=Math.round((d.count/max)*100);return'<div class="bar" style="height:'+h+'px;" title="'+d._id+': '+d.count+'"><div class="bar-value">'+d.count+'</div><div class="bar-label">'+d._id+'</div></div>';}).join(''); }

  /* ── Dispatch Board ─────────────────────────────────────────────── */
  var dispatchShipments = [], dispatchVehicles = [];
  async function renderDispatchBoard() {
    var el = document.getElementById('dispatchOutput'); if (!el) return;
    el.innerHTML = '<div class="skeleton" style="height:200px;"></div>';
    var sr = await window.api('/api/shipments?limit=100','GET',null,true).catch(function(){return {data:[]};});
    var vr = await window.api('/api/fleet?limit=100','GET',null,true).catch(function(){return {data:[]};});
    dispatchShipments = arr(sr).filter(function(s){ return s.status !== 'Delivered' && s.status !== 'Cancelled'; });
    dispatchVehicles = arr(vr).filter(function(v){ return v.status !== 'Maintenance'; });
    var unassigned = dispatchShipments.filter(function(s){ return !s.driverName || s.driverName === 'Unassigned'; });
    var assigned = dispatchShipments.filter(function(s){ return s.driverName && s.driverName !== 'Unassigned' && s.status !== 'Delivered'; });
    el.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">'+
      buildDispatchColumn('Unassigned', unassigned, '#FF6B35') +
      buildDispatchColumn('Assigned', assigned, '#0F4C81') +
      buildDispatchColumn('Available Drivers', dispatchVehicles, '#10B981', true) +
      '</div>';
    wireDispatchDrag();
  }
  function buildDispatchColumn(title, items, color, isDriver) {
    var html = '<div style="background:var(--bg-soft);border-radius:12px;padding:12px;min-height:300px;"><div style="font-weight:600;margin-bottom:10px;color:'+color+';">'+esc(title)+' ('+items.length+')</div>';
    items.forEach(function(item) {
      var label = isDriver ? (item.vehicleNumber + ' — ' + (item.driverName||'Unassigned')) : (item.trackingId + ' — ' + esc(item.customerName||'')+'<br><small style="color:var(--text-muted);">'+esc(item.pickupAddress||'')+' → '+esc(item.deliveryAddress||'')+'</small>');
      html += '<div class="dispatch-card" draggable="true" data-id="'+item._id+'" data-type="'+(isDriver?'driver':'shipment')+'" style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:8px;padding:10px;margin-bottom:8px;cursor:grab;font-size:13px;">'+label+'</div>';
    });
    html += '</div>'; return html;
  }
  function wireDispatchDrag() {
    var cards = document.querySelectorAll('.dispatch-card');
    cards.forEach(function(card) {
      card.addEventListener('dragstart', function(e) { e.dataTransfer.setData('text/plain', JSON.stringify({id:card.dataset.id,type:card.dataset.type})); card.style.opacity='0.5'; });
      card.addEventListener('dragend', function(e) { card.style.opacity='1'; });
    });
    var columns = document.querySelectorAll('#dispatchOutput > div > div');
    columns.forEach(function(col) {
      col.addEventListener('dragover', function(e) { e.preventDefault(); col.style.background='rgba(15,76,129,0.08)'; });
      col.addEventListener('dragleave', function(e) { col.style.background=''; });
      col.addEventListener('drop', async function(e) {
        e.preventDefault(); col.style.background='';
        var data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.type === 'driver') return;
        var driverCard = e.target.closest('.dispatch-card');
        var driverId = driverCard ? driverCard.dataset.id : null;
        if (!driverId) return;
        var vehicle = dispatchVehicles.find(function(v){ return v._id === driverId; });
        if (!vehicle || !vehicle.driverName) return;
        await window.api('/api/shipments/'+data.id+'/status', 'PATCH', { driverName: vehicle.driverName, vehicleNumber: vehicle.vehicleNumber, status: 'Picked Up' }, true);
        if (typeof window.notify === 'function') window.notify('Driver assigned!', { kind: 'success' });
        renderDispatchBoard();
      });
    });
  }

  /* ── Export CSV ────────────────────────────────────────────────── */
  async function exportCSV(type) {
    try{var m={bookings:'/api/bookings/export',shipments:'/api/shipments/export'};if(!m[type])return;var r=await fetch(m[type],{headers:{Authorization:'Bearer '+window.authToken},credentials:'include'});var blob=await r.blob();var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=type+'.csv';a.click();URL.revokeObjectURL(url);if(typeof window.notify==='function')window.notify(type.charAt(0).toUpperCase()+type.slice(1)+' exported',{kind:'success'});}
    catch(e){if(typeof window.notify==='function')window.notify('Export failed',{kind:'error'});}
  }

  async function loadLogs() { var res=await window.api('/api/logs','GET',null,true).catch(function(){return[];}); var a=arr(res).slice(0,100); renderTableRows(document.getElementById('logsOutput'),a,[function(l){return'<span class="font-mono" style="color:var(--text-muted);font-size:12px;white-space:nowrap;">'+FmtDateT(l.createdAt)+'</span>';},function(l){return'<strong>'+esc(l.action)+'</strong>';},function(l){return esc(l.userEmail||'—');},function(l){return esc(l.details||'—');}],{empty:'No logs yet.'}); }
  async function loadUsers() { var res=await window.api('/api/admin/users','GET',null,true).catch(function(){return[];}); var a=arr(res); renderTableRows(document.getElementById('usersOutput'),a,[function(u){return esc(u.name||'—');},function(u){return esc(u.email);},function(u){return'<span class="pill '+(u.role==='Admin'?'is-info':'is-other')+'">'+esc(u.role)+'</span>';},function(u){return'<span class="font-mono" style="color:var(--text-muted);font-size:12px;">'+FmtDateT(u.createdAt)+'</span>';}]); }
  async function loadInvites() { var res=await window.api('/api/admin/invites','GET',null,true).catch(function(){return[];}); var a=arr(res); var origin=window.location.origin; renderTableRows(document.getElementById('invitesOutput'),a,[function(i){return'<span class="font-mono" style="color:var(--text-muted);font-size:12px;white-space:nowrap;">'+FmtDateT(i.createdAt)+'</span>';},function(i){return'<span class="pill is-info">'+esc(i.role)+'</span>';},function(i){return esc(i.email||'<any>');},function(i){return'<span class="font-mono" style="color:var(--text-muted);font-size:12px;">'+FmtDateT(i.expiresAt)+'</span>';},function(i){return i.used?'<span class="pill is-other">Used</span>':'<span class="pill is-other">Open</span>';},function(i){return i.used?'<span style="color:var(--text-muted);font-size:12px;">'+esc(i.usedByEmail||'')+'</span>':'<input type="text" readonly value="'+origin+'/admin-onboard.html?token='+esc(i.token)+'" class="invite-url-input" style="font-family:var(--font-mono);font-size:11px;height:30px;width:380px;max-width:100%;" />';}],{empty:'No invites yet.'}); }
  async function createInvite() { var email=window.prompt('Optional: lock invite to a specific email.'); var res=await window.api('/api/admin/invites','POST',{email:email||undefined},true); if(res&&res.error){alert('Could not create invite: '+(res.message||'unknown'));return;} await loadInvites(); }

  /* ── Live Map + GPS ─────────────────────────────────────────────── */
  var adminMap=null, adminLayers=[], gpsMarkers={};
  async function renderAdminMap() {
    var c=document.getElementById('liveMap'); if(!c||typeof window.L==='undefined')return;
    if(!adminMap){adminMap=window.L.map('liveMap').setView([0,0],2);window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap',maxZoom:19}).addTo(adminMap);}else adminMap.invalidateSize();
    adminLayers.forEach(function(l){adminMap.removeLayer(l);});adminLayers=[];
    async function locate(text){if(!text||text.length<3)return null;try{var r=await fetch('/api/geocode/search?q='+encodeURIComponent(text)+'&limit=1');var j=await r.json();if(j&&j.length)return[parseFloat(j[0].lat),parseFloat(j[0].lon)];}catch(_e){}return null;}
    var res=await window.api('/api/bookings?limit=50','GET',null,true).catch(function(){return{};});var a=arr(res);var pts=[];
    for(var i=0;i<a.length;i++){var b=a[i];var o=await locate(b.origin),d=await locate(b.destination);
      if(o){var m=window.L.circleMarker(o,{radius:7,color:'#0F4C81',fillColor:'#0F4C81',fillOpacity:0.85}).addTo(adminMap);m.bindPopup('<strong>Pickup</strong><br>'+esc(b.origin||''));adminLayers.push(m);pts.push(o);}
      if(d){var m2=window.L.circleMarker(d,{radius:7,color:'#FF6B35',fillColor:'#FF6B35',fillOpacity:0.85}).addTo(adminMap);m2.bindPopup('<strong>Drop-off</strong><br>'+esc(b.destination||''));adminLayers.push(m2);pts.push(d);if(o)adminLayers.push(window.L.polyline([o,d],{color:'#0F4C81',weight:2,dashArray:'4 6',opacity:0.6}).addTo(adminMap));}
    }
    if(pts.length)adminMap.fitBounds(window.L.latLngBounds(pts).pad(0.2));
    for(var vn in gpsMarkers){if(gpsMarkers[vn])adminMap.removeLayer(gpsMarkers[vn]);}
    gpsMarkers={};
    for(var key in window._gpsPositions){
      var p=window._gpsPositions[key];
      var truckIcon=window.L.divIcon({className:'gps-truck-icon',html:'<div style="background:#10B981;width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 8px rgba(16,185,129,0.6);"></div>',iconSize:[16,16]});
      var mk=window.L.marker([p.lat,p.lng],{icon:truckIcon}).addTo(adminMap);mk.bindPopup('<strong>'+key+'</strong><br>'+esc(p.label||''));gpsMarkers[key]=mk;
    }
  }

  window._gpsPositions = {};
  function handleGPSUpdate(updates) { updates.forEach(function(u) { window._gpsPositions[u.vehicleNumber] = u; }); if (activeTab === 'mapTab') renderAdminMap(); }

  /* ── Socket.io ─────────────────────────────────────────────────── */
  var adminSocket=null, socketBound=false;
  function bindSocketHandlers(socket) {
    socket.on('connect',function(){try{refreshAll();}catch(_e){}});
    socket.on('disconnect',function(){try{if(typeof window.notify==='function')window.notify('Live connection lost',{kind:'warn',timeoutMs:3000});}catch(_e){}});
    socket.on('fleet:created',function(){debouncedLoad('fleet',loadFleet);debouncedLoad('kpis',loadKPIs);addNotification('Vehicle added','fleet');});
    socket.on('fleet:updated',function(){debouncedLoad('fleet',loadFleet);addNotification('Vehicle updated','fleet');});
    socket.on('fleet:deleted',function(){debouncedLoad('fleet',loadFleet);addNotification('Vehicle removed','fleet');});
    socket.on('booking:created',function(){debouncedLoad('bookings',loadBookings);debouncedLoad('kpis',loadKPIs);addNotification('Booking created','bookings');});
    socket.on('booking:updated',function(){debouncedLoad('bookings',loadBookings);addNotification('Booking updated','bookings');});
    socket.on('shipment:created',function(){debouncedLoad('shipments',loadShipments);debouncedLoad('kpis',loadKPIs);addNotification('Shipment created','shipments');});
    socket.on('shipment:updated',function(){debouncedLoad('shipments',loadShipments);addNotification('Shipment updated','shipments');});
    socket.on('activity:new',function(){debouncedLoad('logs',loadLogs);});
    socket.on('maintenance:created',function(){addNotification('Maintenance logged','maintenance');});
    socket.on('gps:update', function(updates) { handleGPSUpdate(updates); });
  }
  function setupRealtime() { if(typeof window.io!=='function'||socketBound)return; try{adminSocket=window.io({withCredentials:true,transports:['websocket','polling']});bindSocketHandlers(adminSocket);socketBound=true;}catch(e){try{console.warn('[dashboard] socket.io init failed:',e&&e.message);}catch(_e){}} }

  /* ── Wire All Buttons ──────────────────────────────────────────── */
  function wireQuickButtons() {
    var main=document.querySelector('.main'); if(!main||main.dataset.quickBound==='1')return;main.dataset.quickBound='1';
    function h(id,fn){return function(e){var t=e.target;if(t&&t.closest&&t.closest('#'+id))fn();};}

    // Tab header buttons
    main.addEventListener('click',h('refreshAllBtn',refreshAll));
    main.addEventListener('click',h('refreshBookingsBtn',loadBookings));
    main.addEventListener('click',h('refreshShipmentsBtn',loadShipments));
    main.addEventListener('click',h('refreshFleetBtn',loadFleet));
    main.addEventListener('click',h('refreshLogsBtn',loadLogs));
    main.addEventListener('click',h('refreshUsersBtn',loadUsers));
    main.addEventListener('click',h('refreshDispatchBtn',function(){renderDispatchBoard();}));

    // Create buttons
    main.addEventListener('click',h('createBookingBtn',createBooking));
    main.addEventListener('click',h('createShipmentBtn',createShipment));
    main.addEventListener('click',h('addVehicleQuickBtn',addVehicle));

    // Quick action buttons
    main.addEventListener('click',h('quickNewBookingBtn',function(){showTab('bookingsTab');createBooking();}));
    main.addEventListener('click',h('quickNewShipmentBtn',function(){showTab('shipmentsTab');createShipment();}));
    main.addEventListener('click',h('quickAddVehicleBtn',function(){showTab('fleetTab');addVehicle();}));

    // Invites
    main.addEventListener('click',h('newInviteBtn',createInvite));
    main.addEventListener('click',h('newInviteBtn2',createInvite));

    // Maintenance
    main.addEventListener('click',h('addMaintenanceBtn',function(){populateMntVehicles();document.getElementById('maintenanceModal').style.display='';}));

    // Export
    main.addEventListener('click',h('exportBookingsBtn',function(){exportCSV('bookings');}));
    main.addEventListener('click',h('exportShipmentsBtn',function(){exportCSV('shipments');}));
    main.addEventListener('click',h('exportCurrentBtn',function(){if(activeTab==='bookingsTab')exportCSV('bookings');else if(activeTab==='shipmentsTab')exportCSV('shipments');}));

    // Forms
    var avForm=document.getElementById('addVehicleForm');if(avForm&&avForm.dataset.bound!=='1'){avForm.dataset.bound='1';avForm.addEventListener('submit',handleAddVehicle);}
    var mntForm=document.getElementById('maintenanceForm');if(mntForm&&mntForm.dataset.bound!=='1'){mntForm.dataset.bound='1';mntForm.addEventListener('submit',handleAddMaintenance);}
    var ebForm=document.getElementById('editBookingForm');if(ebForm&&ebForm.dataset.bound!=='1'){ebForm.dataset.bound='1';ebForm.addEventListener('submit',updateBooking);}
    var esForm=document.getElementById('editShipmentForm');if(esForm&&esForm.dataset.bound!=='1'){esForm.dataset.bound='1';esForm.addEventListener('submit',updateShipment);}
    var evForm=document.getElementById('editVehicleForm');if(evForm&&evForm.dataset.bound!=='1'){evForm.dataset.bound='1';evForm.addEventListener('submit',updateVehicle);}
    var cbForm=document.getElementById('createBookingForm');if(cbForm&&cbForm.dataset.bound!=='1'){cbForm.dataset.bound='1';cbForm.addEventListener('submit',handleCreateBooking);}
    var csForm=document.getElementById('createShipmentForm');if(csForm&&csForm.dataset.bound!=='1'){csForm.dataset.bound='1';csForm.addEventListener('submit',handleCreateShipment);}
  }

  /* ── Address Autocomplete ──────────────────────────────────────── */
  function wireAddressAutocomplete() {
    var autocomplete = window.setupAddressAutocomplete;
    if (typeof autocomplete !== 'function') return;
    // Create Booking / Edit Booking / Create Shipment / Edit Shipment / Add Vehicle / Edit Vehicle
    var ids = [
      'cbOrigin', 'cbDestination',
      'ebOrigin', 'ebDestination',
      'csPickup', 'csDelivery',
      'esPickup', 'esDelivery',
      'avLocation', 'evLocation'
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) autocomplete(el);
    });
  }

  /* ── Bootstrap ─────────────────────────────────────────────────── */
  async function bootAdminPage() {
    var user=await window.requireAuth('Admin');if(!user)return;window.authUser=user;
    fillIdentity(user);
    document.querySelectorAll('.admin-only').forEach(function(el){el.style.display='';});
    var mnl=document.getElementById('maintenanceNavLink');if(mnl)mnl.style.display='';
    var disl=document.getElementById('dispatchNavLink');if(disl)disl.style.display='';
    var qa=document.getElementById('quickActions');if(qa)qa.style.display='flex';
    document.getElementById('headerSub').textContent='Full command center — bookings, shipments, fleet, analytics, and real-time monitoring.';
    initTheme();initModalClosers();wireNavLinks();    wireQuickButtons();wireNotifPanel();
    wireAddressAutocomplete();
    wireSearch('bookingsSearch','bookingsStatusFilter',loadBookings);
    wireSearch('shipmentsSearch','shipmentsStatusFilter',loadShipments);
    wireSearch('fleetSearch','fleetStatusFilter',loadFleet);
    wireSort('bookingsTab','bookings',loadBookings);
    wireSort('shipmentsTab','shipments',loadShipments);
    wireSort('fleetTab','fleet',loadFleet);
    await refreshAll();setupRealtime();
  }
  window.onReady(bootAdminPage);
  window.adminPage={refreshAll:refreshAll,loadInvites:loadInvites,createInvite:createInvite,deleteBooking:deleteBooking,deleteShipment:deleteShipment,deleteVehicle:deleteVehicle,editBooking:editBooking,editShipment:editShipment,editVehicle:editVehicle,completeMaintenance:completeMaintenance,loadBookings:loadBookings,loadShipments:loadShipments,loadFleet:loadFleet,loadMaintenance:loadMaintenance,loadLogs:loadLogs,loadUsers:loadUsers};
})();
