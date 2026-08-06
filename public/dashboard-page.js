/*════════════════════════════════════════════════════════════════════════════
SpeedX — World-Class Admin / Operations Console
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
  var notifItems = [], notifUnread = 0;
  var logActions = [];
  var rowCache = { bookings: {}, shipments: {}, fleet: {}, users: {} };

  function clearSkeleton(id) { var el = document.getElementById(id); if (el && el.querySelector) { var sk = el.querySelector('.skeleton'); if (sk) sk.remove(); } }
  function setTileError(id, m) { var el = document.getElementById(id); if (el) el.innerHTML = '<span class="pill is-error" title="' + esc(m||'Failed') + '">Failed</span>'; }
  function setRefreshBusy(busy) { var b = document.getElementById('refreshAllBtn'); if (b) { b.disabled = busy; b.textContent = busy ? 'Refreshing…' : (b.dataset.defaultLabel || 'Refresh all'); } }

  function fillIdentity(user) {
    var dn = (user && (user.name || user.email)) || 'Admin';
    var ne = document.getElementById('userName'), ae = document.getElementById('userAvatar');
    var rb = document.querySelector('.user-chip-role');
    if (ne) ne.textContent = dn; if (ae) ae.textContent = initials(dn, 'A');
    if (rb && user && user.role) rb.textContent = user.role;
    var ua = document.getElementById('upAvatar'); if (ua) ua.textContent = initials(dn, 'A');
    var un = document.getElementById('upName'); if (un) un.textContent = dn;
    var ur = document.getElementById('upRole'); if (ur && user && user.role) ur.textContent = user.role;
    if (user && user.email) { var ue = document.getElementById('upEmail'); if (ue) ue.textContent = user.email; }
  }

  /* ── User details popover (hover / click the user chip) ────────── */
  var _popoverBound = false;
  function initUserPopover() {
    if (_popoverBound) return;
    _popoverBound = true;
    var chip = document.getElementById('userChip'), pop = document.getElementById('userPopover');
    if (!chip || !pop) return;
    var openTimer = null, closeTimer = null;
    function loadMe() {
      if (pop.dataset.loaded === '1') return;
      pop.dataset.loaded = '1';
      window.api('/api/auth/me', 'GET', null, true).then(function (me) {
        if (!me || me.error || !me.email) return;
        var up = document.getElementById('upAvatar'); if (up) up.textContent = initials(me.name || me.email, 'A');
        var un = document.getElementById('upName'); if (un) un.textContent = me.name || me.email;
        var ur = document.getElementById('upRole'); if (ur) ur.textContent = me.role || '';
        var ue = document.getElementById('upEmail'); if (ue) ue.textContent = me.email;
        var ua = document.getElementById('upAuth'); if (ua) ua.textContent = me.authMethod || 'Passkey';
        var upk = document.getElementById('upPasskeys'); if (upk) upk.textContent = (typeof me.credentialCount === 'number') ? String(me.credentialCount) : '—';
        var us = document.getElementById('upSince');
        if (us) us.textContent = me.createdAt ? FmtDateT(me.createdAt) : '—';
      }).catch(function () {});
    }
    function open() { clearTimeout(closeTimer); loadMe(); pop.classList.add('is-open'); if (chip) chip.setAttribute('aria-expanded', 'true'); }
    function close() { pop.classList.remove('is-open'); if (chip) chip.setAttribute('aria-expanded', 'false'); }
    // Hover (mouse) and click (touch) both reveal the card
    chip.addEventListener('mouseenter', function () { clearTimeout(closeTimer); openTimer = setTimeout(open, 120); });
    chip.addEventListener('mouseleave', function () { clearTimeout(openTimer); closeTimer = setTimeout(close, 250); });
    chip.addEventListener('click', function (e) {
      // Let the account/sign-out links inside the chip work normally
      if (e.target.closest && (e.target.closest('a') || e.target.closest('#logoutBtn'))) return;
      e.preventDefault();
      if (pop.classList.contains('is-open')) close(); else open();
    });
    pop.addEventListener('mouseenter', function () { clearTimeout(closeTimer); });
    pop.addEventListener('mouseleave', function () { closeTimer = setTimeout(close, 250); });
    var pl = document.getElementById('popoverLogoutBtn');
    if (pl) pl.addEventListener('click', function () { if (typeof window.logoutUser === 'function') window.logoutUser(); });
    document.addEventListener('click', function (e) {
      if (pop.classList.contains('is-open') && !pop.contains(e.target) && !chip.contains(e.target)) close();
    });
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

  /* ── Notifications (persisted, B2) ─────────────────────────────── */
  function renderNotifications() {
    var b=document.getElementById('notifBody'); if(!b)return;
    if(!notifItems.length){b.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:24px;">No notifications yet</div>';return;}
    b.innerHTML=notifItems.map(function(n){
      return'<div class="notif-item" data-notif-id="'+esc(n._id||'')+'" style="border-left-color:'+(n.type==='error'?'var(--red-600)':n.type==='warn'?'var(--amber-500)':'var(--navy-700)')+';"><strong>'+esc(n.title)+'</strong> · '+esc(n.body||'')+(n.link?'<div style="margin-top:4px;"><a href="'+esc(n.link)+'" style="font-size:11.5px;">View →</a></div>':'')+'<div class="notif-time">'+FmtDateT(n.createdAt||n.time)+'</div></div>';
    }).join('');
    b.querySelectorAll('.notif-item').forEach(function(item){
      item.addEventListener('click', function(){ if(!item.dataset.read){ item.dataset.read='1'; window.api('/api/notifications/read','POST',{ids:[item.dataset.notifId]},true); } });
    });
  }
  function updateNotifBadge() {
    var bell=document.getElementById('notifBell'); if(!bell)return;
    if(notifUnread>0){bell.classList.add('has-unread');bell.setAttribute('data-count',Math.min(notifUnread,99));} else bell.classList.remove('has-unread');
  }
  async function loadNotifs() {
    var res=await window.api('/api/notifications?limit=50','GET',null,true).catch(function(){return {data:[],unread:0};});
    notifItems=(res.data||[]).map(function(n){n.createdAt=n.createdAt||n.time;return n;});
    notifUnread=res.unread||0;
    renderNotifications(); updateNotifBadge();
  }
  function wireNotifPanel() {
    var p=document.getElementById('notifPanel'),bd=document.getElementById('notifBackdrop'),bell=document.getElementById('notifBell'),cl=document.getElementById('closeNotifPanel'),mark=document.getElementById('markAllReadBtn');
    if(!p||!bd)return;
    function o(){ p.classList.add('is-open');bd.classList.add('is-open'); loadNotifs(); }
    function c(){ p.classList.remove('is-open');bd.classList.remove('is-open'); }
    if(bell)bell.addEventListener('click',o); if(cl)cl.addEventListener('click',c); bd.addEventListener('click',c);
    if(mark)mark.addEventListener('click',async function(){ await window.api('/api/notifications/read','POST',{all:true},true); notifUnread=0; notifItems.forEach(function(n){n.read=true;}); updateNotifBadge(); if(typeof window.notify==='function')window.notify('All notifications marked read',{kind:'success'}); });
  }

  /* ── Tab Navigation ─────────────────────────────────────────────── */
  var ALL_TABS = ['overviewTab','bookingsTab','shipmentsTab','fleetTab','maintenanceTab','analyticsTab','dispatchTab','mapTab','logsTab','teamTab','invitesTab','settingsTab'];
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
    else if (t === 'settingsTab') { await loadSettings(); await loadWebhooks(); }
    else if (t === 'mapTab') setTimeout(function() { initAdminMap(); }, 80);
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
    if(results[1].status==='fulfilled') {
      var st = results[1].value || {};
      var e = document.getElementById('kpiShipmentsValue');
      if (e) {
        clearSkeleton('kpiShipmentsValue');
        e.textContent = (typeof st.active==='number'&&!isNaN(st.active)) ? st.active : ((typeof st.total==='number') ? st.total : '—');
        e.title = 'Active: ' + ((st.active!=null)?st.active:'—') + ' · In transit: ' + ((st.inTransit!=null)?st.inTransit:'—') + ' · Total: ' + ((st.total!=null)?st.total:'—');
      }
    } else { clearSkeleton('kpiShipmentsValue'); setTileError('kpiShipmentsValue','Shipments unavailable'); }
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
      + col('Active shipments', sa.filter(function(x){ return x.status && x.status!=='Delivered' && x.status!=='Cancelled'; }), function(x){return'<div style="padding:7px 0;border-bottom:1px solid var(--border-soft);"><div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span class="font-mono" style="font-size:12px;">'+esc(x.trackingId||'—')+'</span><span class="pill '+pillClass(x.status)+'" style="font-size:10.5px;margin-left:auto;">'+esc(x.status||'')+'</span></div><div style="font-size:12px;color:var(--text-muted);margin-top:2px;">'+esc(x.vehicleNumber||x.driverName||'Unassigned')+' · '+esc(x.currentLocation||x.pickupAddress||'Awaiting pickup')+'</div></div>';})
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
      function(b){return '<span class="font-mono" style="font-size:12px;">'+esc(b.invoiceNumber||'—')+'</span>';},
      function(b){return b.price!=null?'<span style="font-weight:600;">'+esc(b.currency||'')+' '+Number(b.price).toFixed(2)+'</span>':'—';},
      function(b){return '<span class="pill '+(b.paymentStatus==='Paid'?'is-delivered':b.paymentStatus==='Refunded'?'is-cancelled':'is-pending')+'">'+esc(b.paymentStatus||'Unpaid')+'</span>';},
      function(b){return '<span class="font-mono" style="color:var(--text-muted);font-size:12px;">'+FmtDateT(b.createdAt)+'</span>';},
      function(b){return '<div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" data-action="edit-booking" data-id="'+b._id+'" title="Edit">✏️</button><button class="btn btn-ghost btn-sm" data-action="delete-booking" data-id="'+b._id+'" title="Delete">🗑</button></div>';}
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
    document.getElementById('ebPrice').value = b.price != null ? b.price : '';
    document.getElementById('ebPayment').value = b.paymentStatus || 'Unpaid';
    document.getElementById('ebPickupDate').value = b.requestedPickupDate ? new Date(b.requestedPickupDate).toISOString().slice(0,10) : '';
    document.getElementById('ebCancelReason').value = '';
    document.getElementById('editBookingModal').style.display = '';
  }

  async function updateBooking(e) {
    e.preventDefault();
    var id = document.getElementById('ebId').value;
    // Status / payment / reschedule go through the transition-enforcing PATCH.
    var patch = {};
    var status = document.getElementById('ebStatus').value;
    var reason = document.getElementById('ebCancelReason').value.trim();
    var pickup = document.getElementById('ebPickupDate').value;
    var payment = document.getElementById('ebPayment').value;
    if (status) patch.status = status;
    if (reason) patch.cancelReason = reason;
    if (pickup) patch.requestedPickupDate = pickup;
    if (payment) patch.paymentStatus = payment;
    var patchRes = null;
    if (Object.keys(patch).length) {
      patchRes = await window.api('/api/bookings/'+id+'/status', 'PATCH', patch, true);
      if (patchRes && patchRes.error) { if (typeof window.notify === 'function') window.notify(patchRes.message, { kind: 'error' }); return; }
    }
    var data = {
      customerName: document.getElementById('ebCustomer').value.trim(),
      origin: document.getElementById('ebOrigin').value.trim(),
      destination: document.getElementById('ebDestination').value.trim(),
      serviceZone: document.getElementById('ebZone').value,
      price: document.getElementById('ebPrice').value ? Number(document.getElementById('ebPrice').value) : undefined
    };
    var res = await window.api('/api/bookings/'+id, 'PUT', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('editBookingModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Booking updated', { kind: 'success' });
    loadBookings(); loadKPIs();
  }

  function createBooking() {
    // Clear form
    document.getElementById('cbCustomer').value = '';
    document.getElementById('cbCustomerEmail').value = '';
    document.getElementById('cbOrigin').value = '';
    document.getElementById('cbDestination').value = '';
    document.getElementById('cbZone').value = 'Central';
    document.getElementById('cbPriority').value = 'Standard';
    document.getElementById('cbPickupDate').value = '';
    var qo = document.getElementById('quoteOutput'); if (qo) qo.textContent = '';
    document.getElementById('createBookingModal').style.display = '';
  }

  async function getEstimate() {
    var qo = document.getElementById('quoteOutput'); if (!qo) return;
    qo.textContent = 'Calculating…';
    var res = await window.api('/api/bookings/quote', 'POST', {
      serviceZone: document.getElementById('cbZone').value,
      priority: document.getElementById('cbPriority').value,
      origin: document.getElementById('cbOrigin').value.trim(),
      destination: document.getElementById('cbDestination').value.trim()
    }, true);
    if (res && res.error) { qo.textContent = res.message || 'Estimate failed'; qo.style.color = 'var(--red-600)'; return; }
    qo.textContent = 'Estimate: ' + (res.currency || 'USD') + ' ' + Number(res.price).toFixed(2);
    qo.style.color = 'var(--green-700, #047857)';
  }

  async function handleCreateBooking(e) {
    e.preventDefault();
    var origin = document.getElementById('cbOrigin').value.trim();
    var dest = document.getElementById('cbDestination').value.trim();
    if (!origin || !dest) { if (typeof window.notify === 'function') window.notify('Pickup and delivery addresses are required', { kind: 'warn' }); return; }
    var data = {
      customerName: document.getElementById('cbCustomer').value.trim(),
      customerEmail: document.getElementById('cbCustomerEmail').value.trim(),
      origin: origin,
      destination: dest,
      serviceZone: document.getElementById('cbZone').value,
      priority: document.getElementById('cbPriority').value,
      requestedPickupDate: document.getElementById('cbPickupDate').value || undefined
    };
    if (!data.customerEmail) { if (typeof window.notify === 'function') window.notify('Customer email is required so a confirmation can be sent', { kind: 'warn' }); return; }
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
      function(s){return '<div style="display:flex;gap:4px;">'+(s.status!=='Delivered'&&s.status!=='Cancelled'?'<button class="btn btn-ghost btn-sm" data-action="assign-shipment" data-id="'+s._id+'" title="Assign driver/vehicle">🚚</button>':'')+'<button class="btn btn-ghost btn-sm" data-action="edit-shipment" data-id="'+s._id+'" title="Edit">✏️</button><button class="btn btn-ghost btn-sm" data-action="delete-shipment" data-id="'+s._id+'" title="Delete">🗑</button></div>';}
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
    var stopsEl = document.getElementById('esStops');
    if (stopsEl) stopsEl.value = (s.stops || []).map(function(st){ return st.address; }).join('\n');
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
    // Multi-stop route (C4): one address per line in the textarea.
    var stopsEl = document.getElementById('esStops');
    var lines = stopsEl ? stopsEl.value.split(/\n+/).map(function(l){return l.trim();}).filter(Boolean) : [];
    if (lines.length) {
      var stops = lines.map(function(a, i){ return { address: a, sequence: i + 1 }; });
      await window.api('/api/shipments/'+id+'/stops', 'PUT', { stops: stops }, true);
    }
    document.getElementById('editShipmentModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('Shipment updated', { kind: 'success' });
    loadShipments();
  }

  function createShipment() {
    // Clear form
    document.getElementById('csCustomer').value = '';
    document.getElementById('csCustomerEmail').value = '';
    document.getElementById('csPickup').value = '';
    document.getElementById('csDelivery').value = '';
    document.getElementById('csVehicle').value = '';
    document.getElementById('csDriver').value = '';
    document.getElementById('csDriverEmail').value = '';
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
      customerEmail: document.getElementById('csCustomerEmail').value.trim(),
      pickupAddress: pickup,
      deliveryAddress: delivery,
      vehicleNumber: document.getElementById('csVehicle').value.trim(),
      driverName: document.getElementById('csDriver').value.trim(),
      driverEmail: document.getElementById('csDriverEmail').value.trim(),
      status: document.getElementById('csStatus').value,
      eta: document.getElementById('csEta').value.trim()
    };
    if (!data.customerEmail) { if (typeof window.notify === 'function') window.notify('Customer email is required so a confirmation can be sent', { kind: 'warn' }); return; }
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
      function(f){return (f.odometerKm!=null)?Number(f.odometerKm).toLocaleString()+' km':'—';},
      function(f){return f.fuelLevel!=null?'<div style="display:flex;align-items:center;gap:6px;"><div style="width:36px;height:6px;border-radius:3px;background:var(--border);overflow:hidden;"><div style="width:'+Math.max(0,Math.min(100,f.fuelLevel))+'%;height:100%;background:'+(f.fuelLevel<20?'var(--red-600)':f.fuelLevel<40?'var(--amber-500)':'var(--green-500)')+';"></div></div><span style="font-size:11px;color:var(--text-muted);">'+Math.round(f.fuelLevel)+'%</span></div>':'—';},
      function(f){return '<div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" data-action="edit-vehicle" data-id="'+f._id+'" title="Edit">✏️</button><button class="btn btn-ghost btn-sm" data-action="delete-vehicle" data-id="'+f._id+'" title="Delete">🗑</button></div>';}
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
    document.getElementById('evOdo').value = v.odometerKm || 0;
    document.getElementById('evFuel').value = v.fuelLevel != null ? v.fuelLevel : 100;
    document.getElementById('evCapacity').value = v.capacityKg || '';
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
      serviceZone: document.getElementById('evZone').value,
      odometerKm: document.getElementById('evOdo').value ? Number(document.getElementById('evOdo').value) : 0,
      fuelLevel: document.getElementById('evFuel').value !== '' ? Number(document.getElementById('evFuel').value) : 100,
      capacityKg: document.getElementById('evCapacity').value ? Number(document.getElementById('evCapacity').value) : undefined
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
      serviceZone: (document.getElementById('avZone')||{}).value || 'Central',
      odometerKm: Number((document.getElementById('avOdo')||{}).value || 0),
      fuelLevel: (document.getElementById('avFuel')||{}).value !== '' && (document.getElementById('avFuel')||{}).value != null ? Number((document.getElementById('avFuel')||{}).value) : 100,
      capacityKg: Number((document.getElementById('avCapacity')||{}).value || 1000)
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
      function(m){return '<button class="btn btn-ghost btn-sm" data-action="complete-maintenance" data-id="'+m._id+'" title="Mark complete">✓</button>';}
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
  var lastAnalytics = null;
  async function loadAnalytics() {
    var days = parseInt((document.getElementById('analyticsPeriod')||{}).value || '30', 10);
    var to = new Date();
    var from = new Date(); from.setDate(from.getDate() - days);
    var iso = function(d){ return d.toISOString().slice(0,10); };
    var res = await window.api('/api/admin/analytics?from='+iso(from)+'&to='+iso(to),'GET',null,true).catch(function(){return {};});
    lastAnalytics = res;
    var statsEl=document.getElementById('analyticsStats');
    if(statsEl){
      var fmtMoney = function(n){ return (res.currency||'') + ' ' + Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); };
      statsEl.innerHTML=[
        {label:'Revenue (paid)',value:fmtMoney(res.revenue),trend:(res.revenue||0)>0?'up':''},
        {label:'Bookings',value:res.bookings||0},
        {label:'Shipments',value:res.shipments||0},
        {label:'On-Time Rate',value:(res.onTimeRate||0)+'%',trend:(res.onTimeRate||0)>=80?'up':'down'},
        {label:'Vehicles',value:res.vehicles||0}
      ].map(function(s){return'<div class="stat-card"><div class="stat-value">'+s.value+'</div><div class="stat-label">'+s.label+'</div>'+(s.trend?'<div class="stat-trend '+s.trend+'">'+(s.trend==='up'?'↑':'↓')+'</div>':'')+'</div>';}).join('');
    }
    renderDayChart('bookingsDayChart', (res.bookingsByDay||[]).map(function(d){return {label:d.day,value:d.count};}));
    renderDayChart('revenueDayChart', (res.bookingsByDay||[]).map(function(d){return {label:d.day,value:(d.revenue!=null?d.revenue:0)};}));
    var bstats=await window.api('/api/bookings/stats','GET',null,true).catch(function(){return {byStatus:[],total:0};});
    var sstats=await window.api('/api/shipments/stats','GET',null,true).catch(function(){return {byStatus:[],total:0};});
    renderBarChart('bookingsBarChart', bstats.byStatus||[]);
    renderBarChart('shipmentsBarChart', sstats.byStatus||[]);
    // Top routes + utilisation
    var tr = document.getElementById('topRoutesOutput');
    if (tr) {
      var routes = res.topRoutes||[];
      tr.innerHTML = routes.length ? routes.map(function(r){return'<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px;"><span>'+esc(r.route)+'</span><span style="color:var(--text-muted);white-space:nowrap;">'+r.count+' · '+fmtMoney(r.revenue)+'</span></div>';}).join('') : '<div style="color:var(--text-muted);font-size:13px;">No routes in this period.</div>';
    }
    var ut = document.getElementById('utilizationOutput');
    if (ut) {
      var util = res.utilization||[];
      ut.innerHTML = util.length ? util.map(function(u){return'<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px;"><span class="font-mono">'+esc(u.vehicle)+'</span><span style="color:var(--text-muted);">'+u.shipments+' shipment(s)</span></div>';}).join('') : '<div style="color:var(--text-muted);font-size:13px;">No utilisation data in this period.</div>';
    }
  }
  function renderDayChart(id, data) {
    var el=document.getElementById(id); if(!el)return;
    if(!data.length){el.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;">No data</div>';return;}
    var max=Math.max.apply(null,data.map(function(d){return d.value;}))||1;
    el.innerHTML=data.map(function(d){var h=Math.max(4,Math.round((d.value/max)*100));return'<div class="bar" style="height:'+h+'px;" title="'+esc(d.label)+': '+d.value+'"><div class="bar-value">'+d.value+'</div><div class="bar-label">'+esc(String(d.label).slice(5))+'</div></div>';}).join('');
  }
  function exportAnalyticsCsv() {
    if (!lastAnalytics) return;
    var lines = ['Metric,Value'];
    lines.push('Revenue,' + (lastAnalytics.revenue||0));
    lines.push('Bookings,' + (lastAnalytics.bookings||0));
    lines.push('Shipments,' + (lastAnalytics.shipments||0));
    lines.push('OnTimeRate,' + (lastAnalytics.onTimeRate||0));
    lines.push(''); lines.push('Day,Bookings');
    (lastAnalytics.bookingsByDay||[]).forEach(function(d){ lines.push(d.day + ',' + d.count); });
    lines.push(''); lines.push('Route,Count,Revenue');
    (lastAnalytics.topRoutes||[]).forEach(function(r){ lines.push('"' + r.route.replace(/"/g,'""') + '",' + r.count + ',' + (r.revenue||0)); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'analytics.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
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
        // Server-side dispatch assignment (D3) — validates the driver + vehicle.
        var res = await window.api('/api/shipments/'+data.id+'/assign', 'POST', { vehicleNumber: vehicle.vehicleNumber }, true);
        if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
        if (typeof window.notify === 'function') window.notify('Driver assigned!', { kind: 'success' });
        renderDispatchBoard();
        loadShipments(); loadKPIs();
      });
    });
  }

  /* ── Export CSV (asks for date range first) ──────────────────── */
  var _pendingExportType = null;
  function openExportModal(type, label) {
    _pendingExportType = type;
    var m = document.getElementById('exportModal');
    var sub = document.getElementById('exportModalSub');
    if (sub) sub.textContent = 'Choose the date range to export ' + (label || '') + '.';
    // Default range: last 30 days → today
    var to = new Date();
    var from = new Date(); from.setDate(from.getDate() - 30);
    var iso = function(d){ return d.toISOString().slice(0,10); };
    var f = document.getElementById('exportFrom'); if (f) f.value = iso(from);
    var t = document.getElementById('exportTo'); if (t) t.value = iso(to);
    if (m) m.style.display = '';
  }
  function closeExportModal() { var m = document.getElementById('exportModal'); if (m) m.style.display = 'none'; }

  async function doExport(type, from, to) {
    var m = { bookings: '/api/bookings/export', shipments: '/api/shipments/export' };
    if (!m[type]) return;
    try {
      var qs = '';
      if (from) qs += (qs ? '&' : '?') + 'from=' + encodeURIComponent(from);
      if (to)   qs += (qs ? '&' : '?') + 'to=' + encodeURIComponent(to);
      var r = await fetch(m[type] + qs, { headers: { Authorization: 'Bearer ' + window.authToken }, credentials: 'include' });
      if (!r.ok) { if (typeof window.notify === 'function') window.notify('Export failed (' + r.status + ')', { kind: 'error' }); return; }
      var blob = await r.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = type + '_' + from + '_' + to + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      if (typeof window.notify === 'function') window.notify(type.charAt(0).toUpperCase() + type.slice(1) + ' exported', { kind: 'success' });
    } catch (e) { if (typeof window.notify === 'function') window.notify('Export failed', { kind: 'error' }); }
  }

  function handleExportSubmit(e) {
    e.preventDefault();
    if (!_pendingExportType) { closeExportModal(); return; }
    var from = (document.getElementById('exportFrom') || {}).value || '';
    var to = (document.getElementById('exportTo') || {}).value || '';
    if (!from || !to) { if (typeof window.notify === 'function') window.notify('Please pick both dates', { kind: 'warn' }); return; }
    if (from > to) { if (typeof window.notify === 'function') window.notify('"From" must be before "To"', { kind: 'warn' }); return; }
    closeExportModal();
    doExport(_pendingExportType, from, to);
  }

  async function loadLogs() {
    var search=(document.getElementById('logsSearch')||{}).value||'';
    var action=(document.getElementById('logsActionFilter')||{}).value||'';
    var params='?page='+(pageState.logs||1)+'&limit=25'+(search?'&search='+encodeURIComponent(search):'')+(action?'&action='+encodeURIComponent(action):'');
    var res=await window.api('/api/logs'+params,'GET',null,true).catch(function(){return {data:[],actions:[]};});
    var a=arr(res);
    // Populate the action filter once.
    if (res.actions && res.actions.length) {
      var sel=document.getElementById('logsActionFilter');
      if (sel && !sel.dataset.built) { sel.dataset.built='1'; sel.innerHTML='<option value="">All actions</option>'+res.actions.map(function(x){return '<option value="'+esc(x)+'">'+esc(x)+'</option>';}).join(''); }
    }
    renderTableRows(document.getElementById('logsOutput'),a,[
      function(l){return'<span class="font-mono" style="color:var(--text-muted);font-size:12px;white-space:nowrap;">'+FmtDateT(l.createdAt)+'</span>';},
      function(l){return'<strong>'+esc(l.action)+'</strong>';},
      function(l){return esc(l.userEmail||'—');},
      function(l){return esc(l.details||'—');},
      function(l){return'<span class="font-mono" style="font-size:11px;color:var(--text-faint);">'+esc(l.ipAddress||'—')+'</span>';}
    ],{empty:'No logs yet.'});
    renderPagination('logsPagination','logs',res.total||a.length,res.pages||1,loadLogs);
  }
  function exportLogsCsv() {
    var search=(document.getElementById('logsSearch')||{}).value||'';
    var action=(document.getElementById('logsActionFilter')||{}).value||'';
    var qs=''+(search?'?search='+encodeURIComponent(search):'')+(action?((search?'&':'?')+'action='+encodeURIComponent(action)):'');
    fetch('/api/logs/export'+qs,{headers:{Authorization:'Bearer '+(window.authToken||'')},credentials:'include'}).then(function(r){if(!r.ok){if(typeof window.notify==='function')window.notify('Export failed ('+r.status+')',{kind:'error'});return;}return r.blob();}).then(function(blob){if(!blob)return;var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='audit-logs.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);}).catch(function(){if(typeof window.notify==='function')window.notify('Export failed',{kind:'error'});});
  }
  async function loadUsers() {
    var search=(document.getElementById('usersSearch')||{}).value||'';
    var role=(document.getElementById('usersRoleFilter')||{}).value||'';
    var params='?page='+(pageState.users||1)+'&limit=25'+(search?'&search='+encodeURIComponent(search):'')+(role?'&role='+encodeURIComponent(role):'');
    var res = await window.api('/api/admin/users'+params, 'GET', null, true).catch(function(){ return {data:[]}; });
    var a = arr(res);
    a.forEach(function(u){ rowCache.users[u._id] = u; });
    renderTableRows(document.getElementById('usersOutput'), a, [
      function(u){ return esc(u.name || '—'); },
      function(u){ return esc(u.email); },
      function(u){ return '<span class="pill '+(u.role==='Admin'?'is-info':'is-other')+'">'+esc(u.role)+'</span>'; },
      function(u){ return u.emailVerified ? '<span class="pill is-delivered" style="font-size:10px;">Verified</span>' : '<span class="pill is-pending" style="font-size:10px;">Unverified</span>'; },
      function(u){ return '<span class="font-mono" style="color:var(--text-muted);font-size:12px;">'+FmtDateT(u.createdAt)+'</span>'; },
      function(u){ var selfId = window.authUser && (window.authUser.id || window.authUser._id); if (selfId && String(u._id) === String(selfId)) return '<span class="pill is-other" style="font-size:11px;">You</span>'; return '<div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-sm" data-action="edit-user" data-id="'+u._id+'" title="Edit">✏️</button><button class="btn btn-ghost btn-sm" data-action="delete-user" data-id="'+u._id+'" title="Delete">🗑</button></div>'; }
    ], { empty: 'No users yet.' });
    renderPagination('usersPagination','users',res.total||a.length,res.pages||1,loadUsers);
  }

  function editUser(id) {
    var u = rowCache.users[id];
    if (!u) return;
    document.getElementById('euId').value = id;
    document.getElementById('euName').value = u.name || '';
    document.getElementById('euEmail').value = u.email || '';
    document.getElementById('euRole').value = u.role || 'Customer';
    document.getElementById('editUserModal').style.display = '';
  }

  async function updateUser(e) {
    e.preventDefault();
    var id = document.getElementById('euId').value;
    var data = {
      name: document.getElementById('euName').value.trim(),
      email: document.getElementById('euEmail').value.trim(),
      role: document.getElementById('euRole').value
    };
    if (!data.name || !data.email) { if (typeof window.notify === 'function') window.notify('Name and email are required', { kind: 'warn' }); return; }
    var res = await window.api('/api/admin/users/' + id, 'PUT', data, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    document.getElementById('editUserModal').style.display = 'none';
    if (typeof window.notify === 'function') window.notify('User updated', { kind: 'success' });
    loadUsers();
    loadKPIs();
  }

  async function deleteUser(id) {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    var res = await window.api('/api/admin/users/' + id, 'DELETE', null, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    if (typeof window.notify === 'function') window.notify('User deleted', { kind: 'success' });
    loadUsers();
    loadKPIs();
  }
  async function loadInvites() { var res=await window.api('/api/admin/invites','GET',null,true).catch(function(){return[];}); var a=arr(res); var origin=window.location.origin; renderTableRows(document.getElementById('invitesOutput'),a,[function(i){return'<span class="font-mono" style="color:var(--text-muted);font-size:12px;white-space:nowrap;">'+FmtDateT(i.createdAt)+'</span>';},function(i){return'<span class="pill is-info">'+esc(i.role)+'</span>';},function(i){return esc(i.email||'<any>');},function(i){return'<span class="font-mono" style="color:var(--text-muted);font-size:12px;">'+FmtDateT(i.expiresAt)+'</span>';},function(i){return i.used?'<span class="pill is-other">Used</span>':'<span class="pill is-other">Open</span>';},function(i){return i.used?'<span style="color:var(--text-muted);font-size:12px;">'+esc(i.usedByEmail||'')+'</span>':'<input type="text" readonly value="'+origin+'/admin-onboard.html?token='+esc(i.token)+'" class="invite-url-input" style="font-family:var(--font-mono);font-size:11px;height:30px;width:380px;max-width:100%;" />';}],{empty:'No invites yet.'}); }
  async function createInvite() { var email=window.prompt('Optional: lock invite to a specific email.'); var res=await window.api('/api/admin/invites','POST',{email:email||undefined},true); if(res&&res.error){alert('Could not create invite: '+(res.message||'unknown'));return;} await loadInvites(); }

  /* ── Settings (D5) + Webhooks (B3) ────────────────────────────── */
  async function loadSettings() {
    var res = await window.api('/api/admin/settings', 'GET', null, true).catch(function(){return {};});
    if (res.error) return;
    var q = (res.quote && typeof res.quote === 'object') ? res.quote : {};
    var set = function(id, v) { var el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    set('stOrgName', res.orgName);
    set('stCurrency', res.currency);
    set('stZones', Array.isArray(res.serviceZones) ? res.serviceZones.join(', ') : '');
    set('stBaseRate', q.baseRate);
    set('stRateKm', q.ratePerKm);
    set('stMultStd', q.priorityMultipliers && q.priorityMultipliers.Standard);
    set('stMultExp', q.priorityMultipliers && q.priorityMultipliers.Express);
    set('stMultPri', q.priorityMultipliers && q.priorityMultipliers.Priority);
  }

  async function saveSettings(e) {
    e.preventDefault();
    var msg = document.getElementById('settingsMsg'); if (msg) msg.textContent = 'Saving…';
    var q = {
      baseRate: parseFloat((document.getElementById('stBaseRate')||{}).value || '25'),
      ratePerKm: parseFloat((document.getElementById('stRateKm')||{}).value || '0.9'),
      priorityMultipliers: {
        Standard: parseFloat((document.getElementById('stMultStd')||{}).value || '1'),
        Express: parseFloat((document.getElementById('stMultExp')||{}).value || '1.5'),
        Priority: parseFloat((document.getElementById('stMultPri')||{}).value || '2')
      }
    };
    var zones = String((document.getElementById('stZones')||{}).value || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var body = { quote: q };
    if (zones.length) body.serviceZones = zones;
    var org = (document.getElementById('stOrgName')||{}).value; if (org) body.orgName = org;
    var cur = (document.getElementById('stCurrency')||{}).value; if (cur) body.currency = cur;
    var res = await window.api('/api/admin/settings', 'PUT', body, true);
    if (res && res.error) { if (msg) { msg.textContent = res.message || 'Save failed.'; msg.style.color = 'var(--red-600)'; } return; }
    if (msg) { msg.textContent = 'Saved ✓'; msg.style.color = 'var(--green-700, #047857)'; }
    if (typeof window.notify === 'function') window.notify('Settings saved', { kind: 'success' });
  }

  async function loadWebhooks() {
    var el = document.getElementById('webhooksList'); if (!el) return;
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Loading…</div>';
    var res = await window.api('/api/admin/webhooks', 'GET', null, true).catch(function(){return {data:[]};});
    var hooks = res.data || [];
    if (!hooks.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No webhooks configured.</div>'; return; }
    el.innerHTML = hooks.map(function(h){
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-soft);">' +
        '<span class="pill '+(h.enabled?'is-delivered':'is-other')+'" style="font-size:10px;">'+(h.enabled?'On':'Off')+'</span>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:600;color:var(--text-hi);word-break:break-all;">'+esc(h.url)+'</div>' +
        '<div style="font-size:11px;color:var(--text-muted);">'+(h.events||[]).join(', ')+(h.lastStatus?' · last: '+h.lastStatus:'')+'</div></div>' +
        '<button class="btn btn-ghost btn-sm" data-webhook-del="'+esc(h._id)+'" type="button">✕</button></div>';
    }).join('');
    el.querySelectorAll('[data-webhook-del]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        await window.api('/api/admin/webhooks/'+btn.dataset.webhookDel, 'DELETE', null, true);
        loadWebhooks();
      });
    });
  }

  async function handleAddWebhook(e) {
    e.preventDefault();
    var msg = document.getElementById('whMsg'); if (msg) msg.textContent = '';
    var events = String((document.getElementById('whEvents')||{}).value || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var body = {
      url: (document.getElementById('whUrl')||{}).value.trim(),
      secret: (document.getElementById('whSecret')||{}).value.trim(),
      events: events
    };
    var res = await window.api('/api/admin/webhooks', 'POST', body, true);
    if (res && res.error) { if (msg) { msg.textContent = res.message || 'Failed.'; msg.style.color = 'var(--red-600)'; } return; }
    if (msg) { msg.textContent = 'Webhook added ✓'; msg.style.color = 'var(--green-700, #047857)'; }
    document.getElementById('whUrl').value = ''; document.getElementById('whSecret').value = ''; document.getElementById('whEvents').value = '';
    loadWebhooks();
  }

  /* ── Quick dispatch (D3) — prompt-based assign ─────────────────── */
  async function assignShipment(id) {
    var vehicleNumber = prompt('Vehicle number to assign (e.g. TRK-001):');
    if (vehicleNumber === null) return;
    var res = await window.api('/api/shipments/'+id+'/assign', 'POST', { vehicleNumber: vehicleNumber.trim() }, true);
    if (res && res.error) { if (typeof window.notify === 'function') window.notify(res.message, { kind: 'error' }); return; }
    if (typeof window.notify === 'function') window.notify('Shipment assigned!', { kind: 'success' });
    loadShipments(); loadKPIs();
  }

  /* ── Live Map + GPS ─────────────────────────────────────────────── */
  /* ── Admin live map (professional fleet view) ───────────────────
     The old implementation re-geocoded every booking and rebuilt every layer
     on each 5s GPS tick, which made markers flicker and jump. Now the map and
     route lines are drawn once, and GPS updates only glide the vehicle
     markers — smooth, like real fleet tracking. */
  var adminMap = null;
  var adminRoutesDrawn = false;
  var adminVehicleLayers = {}; // vehicleNumber -> { marker }
  var adminRouteLines = [];
  var adminAnim = {};          // vehicleNumber -> { from, to, start }
  var adminAnimId = null;
  var _adminMapCssInjected = false;

  function injectAdminMapCSS() {
    if (_adminMapCssInjected) return;
    _adminMapCssInjected = true;
    var s = document.createElement('style');
    s.textContent = [
      '.adm-truck{display:block;filter:drop-shadow(0 2px 3px rgba(15,23,42,0.4));transition:transform 0.5s ease;}',
      '.adm-truck svg{display:block;}',
      '.adm-ping{position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2.5px solid rgba(16,185,129,0.75);animation:adm-ping 1.7s ease-out infinite;pointer-events:none;}',
      '.adm-ping.parked{border-color:rgba(100,116,139,0.55);animation:none;}',
      '@keyframes adm-ping{0%{transform:scale(0.35);opacity:1}100%{transform:scale(1.7);opacity:0}}',
      '.adm-legend{background:rgba(255,255,255,0.93);border:1px solid var(--border,#DDE2EC);border-radius:10px;padding:8px 11px;font-size:11px;color:var(--text,#1F2937);box-shadow:0 6px 18px rgba(15,23,42,0.14);line-height:1.75;}',
      'body.dark .adm-legend{background:rgba(30,41,59,0.93);border-color:#334155;color:#E2E8F0;}',
      '.adm-legend b{display:block;margin-bottom:2px;}',
      '.adm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px;}'
    ].join('');
    document.head.appendChild(s);
  }

  function adminTruckIcon(heading, moving) {
    var h = Math.round(heading || 0);
    var ping = moving ? '<span class="adm-ping"></span>' : '<span class="adm-ping parked"></span>';
    return window.L.divIcon({
      className: '',
      html: '<div class="adm-truck" style="transform:rotate(' + h + 'deg)">' +
        '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="1" y="6" width="13" height="10" rx="1.2" fill="#0F4C81" stroke="#0F4C81"/>' +
        '<path d="M14 9h4l3 3v4h-7z" fill="#FF6B35" stroke="#FF6B35"/>' +
        '<circle cx="6.5" cy="17.5" r="1.8" fill="#fff" stroke="#0F4C81" stroke-width="1.2"/>' +
        '<circle cx="16.5" cy="17.5" r="1.8" fill="#fff" stroke="#FF6B35" stroke-width="1.2"/>' +
        '</svg>' + ping + '</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  function adminVehiclePopup(u) {
    var moving = u.speedKmh > 5;
    return '<strong>' + esc(u.vehicleNumber || '') + '</strong>' +
      (u.driverName ? ' · ' + esc(u.driverName) : '') + '<br>' +
      '<span style="color:' + (moving ? '#059669' : '#64748B') + ';font-weight:600;">' + esc(u.status || '') + '</span>' +
      (u.speedKmh != null ? ' · ' + Math.round(u.speedKmh) + ' km/h' : '') + '<br>' +
      esc(u.label || '') + '<br>' +
      (u.etaMinutes != null ? 'ETA ~' + u.etaMinutes + ' min' : '') +
      (u.distanceRemainingKm != null ? ' · ' + u.distanceRemainingKm.toFixed(1) + ' km left' : '');
  }

  function adminTick(ts) {
    for (var vn in adminAnim) {
      var a = adminAnim[vn];
      var layer = adminVehicleLayers[vn];
      if (!layer) { delete adminAnim[vn]; continue; }
      var p = Math.min(1, (ts - a.start) / 1500);
      var e = 1 - Math.pow(1 - p, 3);
      layer.marker.setLatLng([a.from[0] + (a.to[0] - a.from[0]) * e, a.from[1] + (a.to[1] - a.from[1]) * e]);
      if (p >= 1) delete adminAnim[vn];
    }
    adminAnimId = Object.keys(adminAnim).length ? requestAnimationFrame(adminTick) : null;
  }

  function updateAdminFleetMeta(updates) {
    var meta = document.getElementById('liveFleetCount');
    if (!meta) return;
    var moving = 0, parked = 0;
    (updates || []).forEach(function (u) { if (u.speedKmh > 5) moving++; else parked++; });
    meta.textContent = (updates || []).length + ' vehicles · ' + moving + ' moving' + (parked ? ' · ' + parked + ' parked' : '');
  }

  function updateAdminVehicles(updates) {
    if (!adminMap || !updates || !updates.length) return;
    (updates || []).forEach(function (u) {
      if (!u || u.lat == null || u.lng == null) return;
      var moving = u.speedKmh > 5;
      var layer = adminVehicleLayers[u.vehicleNumber];
      if (!layer) {
        var mk = window.L.marker([u.lat, u.lng], { icon: adminTruckIcon(u.heading, moving) }).addTo(adminMap);
        mk.bindPopup(adminVehiclePopup(u));
        layer = adminVehicleLayers[u.vehicleNumber] = { marker: mk };
      } else {
        layer.marker.setIcon(adminTruckIcon(u.heading, moving));
        layer.marker.setPopupContent(adminVehiclePopup(u));
      }
      var cur = layer.marker.getLatLng();
      adminAnim[u.vehicleNumber] = { from: [cur.lat, cur.lng], to: [u.lat, u.lng], start: performance.now() };
      if (!adminAnimId) adminAnimId = requestAnimationFrame(adminTick);
    });
    updateAdminFleetMeta(updates);
  }

  function locate(text) {
    if (!text || text.length < 3) return Promise.resolve(null);
    return fetch('/api/geocode/search?q=' + encodeURIComponent(text) + '&limit=1')
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.length) ? [parseFloat(j[0].lat), parseFloat(j[0].lon)] : null; })
      .catch(function () { return null; });
  }

  async function drawAdminRoutes() {
    var res = await window.api('/api/bookings?limit=30', 'GET', null, true).catch(function () { return {}; });
    var a = arr(res);
    var pts = [];
    for (var i = 0; i < a.length; i++) {
      var b = a[i];
      var o = await locate(b.origin), d = await locate(b.destination);
      if (!o || !d) continue;
      adminRouteLines.push(window.L.polyline([o, d], { color: '#0F4C81', weight: 2, dashArray: '4 6', opacity: 0.5 }).addTo(adminMap));
      var m = window.L.circleMarker(o, { radius: 6, color: '#0F4C81', fillColor: '#0F4C81', fillOpacity: 0.85 }).addTo(adminMap);
      m.bindPopup('<strong>Pickup</strong><br>' + esc(b.origin || ''));
      adminRouteLines.push(m); pts.push(o);
      var m2 = window.L.circleMarker(d, { radius: 6, color: '#FF6B35', fillColor: '#FF6B35', fillOpacity: 0.85 }).addTo(adminMap);
      m2.bindPopup('<strong>Drop-off</strong><br>' + esc(b.destination || ''));
      adminRouteLines.push(m2); pts.push(d);
    }
    if (pts.length) { try { adminMap.fitBounds(window.L.latLngBounds(pts).pad(0.2)); } catch (_e) {} }
  }

  async function initAdminMap() {
    var c = document.getElementById('liveMap');
    if (!c || typeof window.L === 'undefined') return;
    if (!adminMap) {
      adminMap = window.L.map('liveMap').setView([-34.0, 149.5], 5);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(adminMap);
      injectAdminMapCSS();
      var legend = window.L.control({ position: 'bottomleft' });
      legend.onAdd = function () {
        var d = document.createElement('div');
        d.className = 'adm-legend';
        d.innerHTML = '<b>Fleet status</b>' +
          '<div><span class="adm-dot" style="background:#10B981"></span>Moving (In transit)</div>' +
          '<div><span class="adm-dot" style="background:#64748B"></span>Parked / idle</div>' +
          '<div><span class="adm-dot" style="background:#0F4C81"></span>Pickup</div>' +
          '<div><span class="adm-dot" style="background:#FF6B35"></span>Drop-off</div>';
        return d;
      };
      legend.addTo(adminMap);
      adminMap.on('resize', function () { try { adminMap.invalidateSize(); } catch (_e) {} });
    } else {
      adminMap.invalidateSize();
    }
    if (!adminRoutesDrawn) {
      adminRoutesDrawn = true;
      await drawAdminRoutes();
    }
    // Vehicles may already be visible from earlier socket updates.
    for (var vn in window._gpsPositions) {
      updateAdminVehicles([window._gpsPositions[vn]]);
    }
  }

  window._gpsPositions = {};
  function handleGPSUpdate(updates) {
    (updates || []).forEach(function (u) { window._gpsPositions[u.vehicleNumber] = u; });
    if (adminMap) updateAdminVehicles(updates);
  }

  /* ── Socket.io ─────────────────────────────────────────────────── */
  var adminSocket=null, socketBound=false;
  function bindSocketHandlers(socket) {
    socket.on('connect',function(){try{refreshAll();}catch(_e){}});
    socket.on('disconnect',function(){try{if(typeof window.notify==='function')window.notify('Live connection lost',{kind:'warn',timeoutMs:3000});}catch(_e){}});
    socket.on('fleet:created',function(){debouncedLoad('fleet',loadFleet);debouncedLoad('kpis',loadKPIs);loadNotifs();});
    socket.on('fleet:updated',function(){debouncedLoad('fleet',loadFleet);loadNotifs();});
    socket.on('fleet:deleted',function(){debouncedLoad('fleet',loadFleet);loadNotifs();});
    socket.on('booking:created',function(){debouncedLoad('bookings',loadBookings);debouncedLoad('kpis',loadKPIs);loadNotifs();});
    socket.on('booking:updated',function(){debouncedLoad('bookings',loadBookings);loadNotifs();});
    socket.on('shipment:created',function(){debouncedLoad('shipments',loadShipments);debouncedLoad('kpis',loadKPIs);loadNotifs();});
    socket.on('shipment:updated',function(){debouncedLoad('shipments',loadShipments);loadNotifs();});
    socket.on('activity:new',function(){debouncedLoad('logs',loadLogs);});
    socket.on('maintenance:created',function(){ if(typeof window.notify==='function')window.notify('Maintenance logged',{kind:'info'}); });
    socket.on('notification:new',function(n){ notifItems.unshift(n); notifUnread++; renderNotifications(); updateNotifBadge(); if(typeof window.notify==='function')window.notify(n.title||'Notification',{kind:n.type==='error'?'error':n.type==='warn'?'warn':'info'}); });
    socket.on('gps:update', function(updates) { handleGPSUpdate(updates); });
  }
  function setupRealtime() { if(typeof window.io!=='function'||socketBound)return; try{adminSocket=window.io({withCredentials:true,transports:['websocket','polling']});bindSocketHandlers(adminSocket);socketBound=true;adminSocket.on('connect',function(){ var uid=window.authUser&&(window.authUser.id||window.authUser._id); if(uid)adminSocket.emit('join:user',String(uid)); });}catch(e){try{console.warn('[dashboard] socket.io init failed:',e&&e.message);}catch(_e){}} }

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

    // Invites (button lives in the Overview tab only)
    main.addEventListener('click',h('newInviteBtn',createInvite));

    // Maintenance
    main.addEventListener('click',h('addMaintenanceBtn',function(){populateMntVehicles();document.getElementById('maintenanceModal').style.display='';}));

    // Export (all open the date-range modal first)
    main.addEventListener('click',h('exportBookingsBtn',function(){openExportModal('bookings','bookings');}));
    main.addEventListener('click',h('exportShipmentsBtn',function(){openExportModal('shipments','shipments');}));
    main.addEventListener('click',h('exportCurrentBtn',function(){if(activeTab==='bookingsTab')openExportModal('bookings','bookings');else if(activeTab==='shipmentsTab')openExportModal('shipments','shipments');else if(typeof window.notify==='function')window.notify('No CSV export for this tab',{kind:'warn'});}));

    // Delegated action-column clicks (data-action buttons) — avoids inline onclick,
    // which the Content-Security-Policy blocks (no 'unsafe-inline' in script-src).
    main.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest && e.target.closest('button[data-action]');
      if (!btn || !btn.dataset || !btn.dataset.action) return;
      var id = btn.dataset.id;
      var action = btn.dataset.action;
      if (action === 'edit-booking') editBooking(id);
      else if (action === 'delete-booking') deleteBooking(id);
      else if (action === 'edit-shipment') editShipment(id);
      else if (action === 'delete-shipment') deleteShipment(id);
      else if (action === 'assign-shipment') assignShipment(id);
      else if (action === 'edit-vehicle') editVehicle(id);
      else if (action === 'delete-vehicle') deleteVehicle(id);
      else if (action === 'complete-maintenance') completeMaintenance(id);
      else if (action === 'edit-user') editUser(id);
      else if (action === 'delete-user') deleteUser(id);
    });

    // Forms
    var avForm=document.getElementById('addVehicleForm');if(avForm&&avForm.dataset.bound!=='1'){avForm.dataset.bound='1';avForm.addEventListener('submit',handleAddVehicle);}
    var mntForm=document.getElementById('maintenanceForm');if(mntForm&&mntForm.dataset.bound!=='1'){mntForm.dataset.bound='1';mntForm.addEventListener('submit',handleAddMaintenance);}
    var ebForm=document.getElementById('editBookingForm');if(ebForm&&ebForm.dataset.bound!=='1'){ebForm.dataset.bound='1';ebForm.addEventListener('submit',updateBooking);}
    var esForm=document.getElementById('editShipmentForm');if(esForm&&esForm.dataset.bound!=='1'){esForm.dataset.bound='1';esForm.addEventListener('submit',updateShipment);}
    var evForm=document.getElementById('editVehicleForm');if(evForm&&evForm.dataset.bound!=='1'){evForm.dataset.bound='1';evForm.addEventListener('submit',updateVehicle);}
    var exForm=document.getElementById('exportForm');if(exForm&&exForm.dataset.bound!=='1'){exForm.dataset.bound='1';exForm.addEventListener('submit',handleExportSubmit);}
    var euForm=document.getElementById('editUserForm');if(euForm&&euForm.dataset.bound!=='1'){euForm.dataset.bound='1';euForm.addEventListener('submit',updateUser);}
    var cbForm=document.getElementById('createBookingForm');if(cbForm&&cbForm.dataset.bound!=='1'){cbForm.dataset.bound='1';cbForm.addEventListener('submit',handleCreateBooking);}
    var csForm=document.getElementById('createShipmentForm');if(csForm&&csForm.dataset.bound!=='1'){csForm.dataset.bound='1';csForm.addEventListener('submit',handleCreateShipment);}
    var stForm=document.getElementById('settingsForm');if(stForm&&stForm.dataset.bound!=='1'){stForm.dataset.bound='1';stForm.addEventListener('submit',saveSettings);}
    var whForm=document.getElementById('webhookForm');if(whForm&&whForm.dataset.bound!=='1'){whForm.dataset.bound='1';whForm.addEventListener('submit',handleAddWebhook);}

    // Extra header/toolbar buttons
    main.addEventListener('click',h('quoteBtn',getEstimate));
    main.addEventListener('click',h('exportLogsBtn',exportLogsCsv));
    main.addEventListener('click',h('exportAnalyticsBtn',exportAnalyticsCsv));
    var ap = document.getElementById('analyticsPeriod'); if (ap && !ap.dataset.bound) { ap.dataset.bound='1'; ap.addEventListener('change', loadAnalytics); }
    var ls = document.getElementById('logsSearch'); if (ls && !ls.dataset.bound) { ls.dataset.bound='1'; ls.addEventListener('input', function(){ pageState.logs=1; loadLogs(); }); }
    var laf = document.getElementById('logsActionFilter'); if (laf && !laf.dataset.bound) { laf.dataset.bound='1'; laf.addEventListener('change', function(){ pageState.logs=1; loadLogs(); }); }
    var us = document.getElementById('usersSearch'); if (us && !us.dataset.bound) { us.dataset.bound='1'; us.addEventListener('input', function(){ pageState.users=1; loadUsers(); }); }
    var urf = document.getElementById('usersRoleFilter'); if (urf && !urf.dataset.bound) { urf.dataset.bound='1'; urf.addEventListener('change', function(){ pageState.users=1; loadUsers(); }); }
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
    initTheme();initModalClosers();wireNavLinks();    wireQuickButtons();wireNotifPanel();initUserPopover();
    wireAddressAutocomplete();
    wireSearch('bookingsSearch','bookingsStatusFilter',loadBookings);
    wireSearch('shipmentsSearch','shipmentsStatusFilter',loadShipments);
    wireSearch('fleetSearch','fleetStatusFilter',loadFleet);
    wireSort('bookingsTab','bookings',loadBookings);
    loadNotifs();
    wireSort('shipmentsTab','shipments',loadShipments);
    wireSort('fleetTab','fleet',loadFleet);
    await refreshAll();setupRealtime();
  }
  window.onReady(bootAdminPage);
  window.adminPage={refreshAll:refreshAll,loadInvites:loadInvites,createInvite:createInvite,deleteBooking:deleteBooking,deleteShipment:deleteShipment,deleteVehicle:deleteVehicle,editBooking:editBooking,editShipment:editShipment,editVehicle:editVehicle,completeMaintenance:completeMaintenance,loadBookings:loadBookings,loadShipments:loadShipments,loadFleet:loadFleet,loadMaintenance:loadMaintenance,loadLogs:loadLogs,loadUsers:loadUsers,editUser:editUser,deleteUser:deleteUser};
})();
