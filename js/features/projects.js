// == PROJECTS MODULE ==============================================
// Projects loaded dynamically from Supabase (not hardcoded)
let PROJECTS = [
  'ABK','QDSBG','DH-NONCORP','MASHREQ-DCDR','MASHREQ-IBG','ADAA','NBO-MSOT',
  'ASIC','ARO-KSA','ENBD-OCI-KSA','ENBD-MIGRATION','ATMC-ASIC','QIDDIYA',
  'ENBD-MEYDAN','DUBAI-PETROLEUM','DUBAI-HOLDING','FAB-MISR','LANDMARK','RTA',
  'ASTER-OMAN','ASTER-DUBAI','FAB','MAGNATI-FISERV','ARO-DRILLING',
  'TAAGEER-FINANCE','DFM','NAIVAS','NAIVAS-PHASE2','ARABIAN-SHIELD',
  'DERAYA-FINANCE','MOH','QASSIM-UNIVERSITY','OLD-DUBAI-HOLDING',
  'OLD-MASHREQ','MASHREQ-IBG-OLD'
]; // fallback — overwritten by loadProjects()

let _projectsLoaded = false;

// Customer & engagement lookup
let CUSTOMERS = []; // [{id, name}]
let ENGAGEMENTS = []; // [{id, customer_id, name, type, status, vendor, product_line, ...}]
let PROJECT_CUSTOMER = {}; // { engagementName: customerName }

// Vendor + Product line catalog — manager-managed lists used for engagement
// classification. Stored as text on engagements (snapshot pattern) so a
// renamed/disabled vendor still surfaces correctly on historical rows.
let VENDORS       = []; // [{id, name, display_order, is_active}]
let PRODUCT_LINES = []; // [{id, vendor_id, name, display_order, is_active}]

function _applyProjectsData(customers, engagements, vendors, productLines) {
  if (customers && customers.length) {
    CUSTOMERS = customers.filter(function(c){ return c.status !== 'archived'; });
  }
  if (engagements && engagements.length) {
    ENGAGEMENTS = engagements;
    PROJECTS = ENGAGEMENTS
      .filter(function(e){ return e.type === 'project' && e.status !== 'archived'; })
      .map(function(e){ return e.name; });
    PROJECT_CUSTOMER = {};
    var byId = {}; (CUSTOMERS||[]).forEach(function(c){ byId[c.id] = c.name; });
    ENGAGEMENTS.forEach(function(e){ if (e.customer_id) PROJECT_CUSTOMER[e.name] = byId[e.customer_id]; });
    _projectsLoaded = true;
  }
  if (vendors)       VENDORS       = vendors;
  if (productLines)  PRODUCT_LINES = productLines;
}

async function loadProjects() {
  // 1) Warm up from localStorage so session-log dropdowns work instantly on
  //    repeat logins. The fresh fetch below replaces this with current data.
  try {
    var cached = localStorage.getItem('netsec.projectsCache');
    if (cached) {
      var c = JSON.parse(cached);
      _applyProjectsData(c.customers, c.engagements, c.vendors, c.productLines);
    }
  } catch (e) { /* corrupt cache, ignore */ }

  // 2) Fresh fetch — customers + engagements + vendor catalog in parallel.
  const [cRes, eRes, vRes, plRes] = await Promise.all([
    sb.from('customers').select('id,name,status').order('name'),
    sb.from('engagements').select('id,customer_id,name,type,status,vendor,product_line,created_by,created_at').order('name'),
    sb.from('vendors').select('id,name,display_order,is_active').order('display_order').order('name'),
    sb.from('product_lines').select('id,vendor_id,name,display_order,is_active,is_gulfit_relevant').order('display_order').order('name')
  ]);
  if (cRes.error || eRes.error) return; // keep cached data on error
  // Vendor catalog errors are non-fatal — the dropdowns will just be empty
  // (engagements still save fine since vendor/product_line are nullable text).
  _applyProjectsData(cRes.data, eRes.data, vRes.error ? null : vRes.data, plRes.error ? null : plRes.data);

  // 3) Update localStorage for next login.
  try {
    localStorage.setItem('netsec.projectsCache', JSON.stringify({
      customers: cRes.data,
      engagements: eRes.data,
      vendors: vRes.error ? [] : vRes.data,
      productLines: plRes.error ? [] : plRes.data,
      savedAt: Date.now()
    }));
  } catch (e) { /* quota or disabled, ignore */ }
}

// ── Vendor + Product Line dropdown helpers ────────────────────────
// Populates a vendor <select> with active vendors plus an "Other (specify)"
// entry. Inactive vendors only surface when the engagement already references
// them (so historical data stays accurate without re-introducing the disabled
// option as a choice for new picks).
function fillVendorSelect(selectId, currentValue) {
  var el = document.getElementById(selectId);
  if (!el) return;
  var cur = (currentValue !== undefined) ? currentValue : el.value;
  var active = (VENDORS||[]).filter(function(v){ return v.is_active; });
  var html = '<option value="">-- Select Vendor --</option>'
    + active.map(function(v){
        return '<option value="'+esc2(v.name)+'">'+esc2(v.name)+'</option>';
      }).join('')
    + '<option value="__other__">+ Other (specify)</option>';
  // Preserve a pre-existing value even if the vendor is now inactive
  if (cur && !active.some(function(v){ return v.name === cur; }) && cur !== '__other__') {
    var stillExists = (VENDORS||[]).some(function(v){ return v.name === cur; });
    html = html.replace('-- Select Vendor --</option>',
      '-- Select Vendor --</option><option value="'+esc2(cur)+'" selected>'+esc2(cur)+(stillExists?' (inactive)':' (custom)')+'</option>');
  }
  el.innerHTML = html;
  if (cur) el.value = cur;
}

// Populates a product line <select> filtered by vendor name. Disabled when
// no vendor selected. "Other (specify)" entry always present per vendor.
function fillProductLineSelect(selectId, vendorName, currentValue) {
  var el = document.getElementById(selectId);
  if (!el) return;
  var cur = (currentValue !== undefined) ? currentValue : el.value;
  if (!vendorName || vendorName === '__other__') {
    el.innerHTML = '<option value="">-- Select Vendor first --</option>';
    el.disabled = true;
    return;
  }
  var vendor = (VENDORS||[]).find(function(v){ return v.name === vendorName; });
  if (!vendor) {
    // Custom vendor — no preset product lines, only Other-specify
    el.innerHTML = '<option value="">-- Select --</option><option value="__other__">+ Other (specify)</option>';
    el.disabled = false;
    if (cur) el.value = cur;
    return;
  }
  var lines = (PRODUCT_LINES||[])
    .filter(function(p){ return p.vendor_id === vendor.id && p.is_active && p.name !== 'Other (specify)'; });
  var html = '<option value="">-- Select Product Line --</option>'
    + lines.map(function(p){
        return '<option value="'+esc2(p.name)+'">'+esc2(p.name)+'</option>';
      }).join('')
    + '<option value="__other__">+ Other (specify)</option>';
  if (cur && !lines.some(function(p){ return p.name === cur; }) && cur !== '__other__') {
    html = html.replace('-- Select Product Line --</option>',
      '-- Select Product Line --</option><option value="'+esc2(cur)+'" selected>'+esc2(cur)+' (custom)</option>');
  }
  el.innerHTML = html;
  el.disabled = false;
  if (cur) el.value = cur;
}

// Get projects under a given customer (by name). Empty customer -> all.
function projectsForCustomer(customerName) {
  if (!customerName) return PROJECTS.slice();
  return PROJECTS.filter(function(p){ return PROJECT_CUSTOMER[p] === customerName; });
}

// Populate a customer <select> by id. The Add Engagement form's picker
// (#pj-new-customer) is the ONE place we surface a "+ Add new customer…"
// sentinel — other dropdowns (filters + edit modals) already have their
// own inline onchange handlers, and adding a customer from a filter / edit
// context would be confusing.
function fillCustomerSelect(selectId, includeAll) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  var showAddNew = (selectId === 'pj-new-customer');
  el.dataset.includeAll = includeAll ? 'true' : 'false';
  el.innerHTML = (includeAll ? '<option value="">All Customers</option>' : '<option value="">-- Select Customer --</option>')
    + CUSTOMERS.map(function(c){ return '<option>'+esc2(c.name)+'</option>'; }).join('')
    + (showAddNew ? '<option value="__add_new__">+ Add new customer…</option>' : '');
  if (cur) el.value = cur;
  // Attach the sentinel handler only on the Add Engagement dropdown.
  // _prevValue tracks the last "real" pick so onCustomerSelectAdd can roll
  // back when the user cancels the prompt.
  if (showAddNew) {
    el._prevValue = el.value;
    el.onchange = function() {
      if (el.value === '__add_new__') onCustomerSelectAdd(selectId);
      else el._prevValue = el.value;
    };
  }
}

// Populate a project <select> filtered by a customer name
function fillProjectSelect(selectId, customerName, includeAll) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  var list = projectsForCustomer(customerName);
  el.innerHTML = (includeAll ? '<option value="">All Projects</option>' : '<option value="">-- Select Project --</option>')
    + list.map(function(p){ return '<option>'+p+'</option>'; }).join('');
  if (cur && list.indexOf(cur) >= 0) el.value = cur;
}

// ── ADD ENGAGEMENT MODAL ────────────────────────────────────────
// Single source of truth for creating engagements. Two entry points:
//   1. Tracker "+ New Engagement" button (trkOpenNew)
//   2. Sessions → Manage Engagements page CTA
// Both call openAddEngagementModal which resets the fields, refreshes the
// dropdowns from the latest CUSTOMERS/VENDORS caches, shows the modal,
// and focuses the Customer field.
function openAddEngagementModal() {
  var modal = document.getElementById('add-engagement-modal');
  if (!modal) return;
  // Reset every field so a previous open doesn't bleed in. Defaults:
  // status=active, type empty (forces user to pick).
  document.getElementById('pj-new-name').value = '';
  document.getElementById('pj-new-type').value = '';
  document.getElementById('pj-new-customer').value = '';
  document.getElementById('pj-new-status').value = 'active';
  ['pj-new-vendor-other','pj-new-product-line-other'].forEach(function(id){
    var el = document.getElementById(id); if (el) { el.value = ''; el.style.display = 'none'; }
  });
  // Refresh dropdowns from current caches (vendors/customers may have changed
  // since the page first loaded).
  fillCustomerSelect('pj-new-customer', false);
  fillVendorSelect('pj-new-vendor', '');
  fillProductLineSelect('pj-new-product-line', '', '');
  var errEl = document.getElementById('add-eng-error');
  if (errEl) errEl.style.display = 'none';
  modal.classList.add('show');
  // Focus the Customer dropdown after the modal animation has started.
  setTimeout(function(){
    var first = document.getElementById('pj-new-customer');
    if (first && first.focus) first.focus();
  }, 80);
  if (typeof renderIcons === 'function') renderIcons();
}

function closeAddEngagementModal() {
  var modal = document.getElementById('add-engagement-modal');
  if (modal) modal.classList.remove('show');
}

// Surfaces a validation error inside the modal (instead of the old inline
// banner on the Manage page). Falls back to showError toast when the modal
// isn't mounted (defensive — addEngagement could in theory be invoked
// outside the modal flow).
function _addEngError(msg) {
  var errEl = document.getElementById('add-eng-error');
  if (errEl) {
    errEl.textContent = '⚠️ ' + msg;
    errEl.style.display = 'block';
  } else {
    showError(msg);
  }
}

async function addEngagement() {
  if (!await requireAuth()) return;
  const customer = document.getElementById('pj-new-customer').value;
  const type     = document.getElementById('pj-new-type').value;
  const name     = (document.getElementById('pj-new-name').value||'').trim().toUpperCase();
  const status   = document.getElementById('pj-new-status').value;
  // Hide any lingering error before re-validating
  var errEl = document.getElementById('add-eng-error');
  if (errEl) errEl.style.display = 'none';

  if (!customer) { _addEngError('Please select a customer.');         return; }
  if (!type)     { _addEngError('Please select an engagement type.'); return; }
  if (!name)     { _addEngError('Please enter an engagement name.');  return; }

  var custRow = CUSTOMERS.find(function(c){ return c.name === customer; });
  var customer_id = custRow ? custRow.id : null;

  // Duplicate within (customer, name, type)
  var dup = ENGAGEMENTS.some(function(e){
    return e.customer_id === customer_id && e.name === name && e.type === type;
  });
  if (dup) {
    _addEngError('A '+type.toUpperCase()+' engagement named "'+name+'" already exists for this customer.');
    return;
  }

  // Vendor + product line — required for NEW engagements. "Other (specify)"
  // routes through the inline text input which stores the literal custom name.
  var vendorSel = document.getElementById('pj-new-vendor');
  var plSel     = document.getElementById('pj-new-product-line');
  var vendorVal = vendorSel ? vendorSel.value : '';
  var plVal     = plSel ? plSel.value : '';
  if (vendorVal === '__other__') {
    vendorVal = ((document.getElementById('pj-new-vendor-other')||{}).value||'').trim();
  }
  if (plVal === '__other__') {
    plVal = ((document.getElementById('pj-new-product-line-other')||{}).value||'').trim();
  }
  if (!vendorVal) { _addEngError('Please select a vendor.');       return; }
  if (!plVal)     { _addEngError('Please select a product line.'); return; }

  const {error} = await sb.from('engagements').insert({
    customer_id:  customer_id,
    name:         name,
    type:         type,
    status:       status,
    vendor:       vendorVal,
    product_line: plVal,
    created_by:   currentUser
  });
  if (error) { _addEngError('Error: '+error.message); return; }

  // Adopt any orphan sessions that share this engagement name.
  // Strategy:
  //   - customer_name: only fill where it's currently null (don't overwrite real data)
  //   - session_type (unified_sessions only): align unconditionally — registering an
  //     orphan as TYPE means TYPE is now authoritative for those rows.
  // Errors are logged so the engagement insert above isn't rolled back if backfill fails.
  var pjB   = await sb.from('project_sessions').update({ customer_name: customer }).eq('project_name', name).is('customer_name', null);
  var otB   = await sb.from('ot_sessions').update({ customer_name: customer }).eq('project_name', name).is('customer_name', null);
  var usCB  = await sb.from('unified_sessions').update({ customer_name: customer }).eq('engagement_name', name).is('customer_name', null);
  var usTB  = await sb.from('unified_sessions').update({ session_type: type }).eq('engagement_name', name);
  if (pjB.error)  console.error('project_sessions backfill failed:', pjB.error);
  if (otB.error)  console.error('ot_sessions backfill failed:', otB.error);
  if (usCB.error) console.error('unified_sessions customer backfill failed:', usCB.error);
  if (usTB.error) console.error('unified_sessions type backfill failed:', usTB.error);

  // Close the modal on success — openAddEngagementModal resets fields on
  // next open, so we don't need to clear them here.
  closeAddEngagementModal();
  showToast('Engagement created ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

// Backward-compat alias (anything still referencing addProject keeps working)
var addProject = addEngagement;

// ── Vendor / Product Line dropdown handlers ──────────────────────
// Wire the "Other (specify)" toggle behaviour: picking "Other" surfaces an
// inline text input, picking anything else hides it.
function onNewVendorChange() {
  var sel = document.getElementById('pj-new-vendor');
  var other = document.getElementById('pj-new-vendor-other');
  if (!sel) return;
  if (other) other.style.display = (sel.value === '__other__') ? '' : 'none';
  fillProductLineSelect('pj-new-product-line', sel.value === '__other__' ? '__other__' : sel.value, '');
  var plOther = document.getElementById('pj-new-product-line-other');
  if (plOther) { plOther.style.display = 'none'; plOther.value = ''; }
}
function onNewProductLineChange() {
  var sel = document.getElementById('pj-new-product-line');
  var other = document.getElementById('pj-new-product-line-other');
  if (!sel || !other) return;
  other.style.display = (sel.value === '__other__') ? '' : 'none';
}
function onEditEngVendorChange() {
  var sel = document.getElementById('edit-project-vendor');
  var other = document.getElementById('edit-project-vendor-other');
  if (!sel) return;
  if (other) other.style.display = (sel.value === '__other__') ? '' : 'none';
  fillProductLineSelect('edit-project-product-line', sel.value === '__other__' ? '__other__' : sel.value, '');
  var plOther = document.getElementById('edit-project-product-line-other');
  if (plOther) { plOther.style.display = 'none'; plOther.value = ''; }
}
function onEditEngProductLineChange() {
  var sel = document.getElementById('edit-project-product-line');
  var other = document.getElementById('edit-project-product-line-other');
  if (!sel || !other) return;
  other.style.display = (sel.value === '__other__') ? '' : 'none';
}

// ── UPDATE PROJECT STATUS ────────────────────────────────────────
async function updateProjectStatus(idOrName, newStatus) {
  if (!await requireAuth()) return;
  // Backward-compat: callers may pass either an id (new) or a name (old).
  var query = sb.from('engagements').update({status: newStatus});
  if (typeof idOrName === 'number' || /^\d+$/.test(String(idOrName))) {
    query = query.eq('id', Number(idOrName));
  } else {
    query = query.eq('name', idOrName);
  }
  const {error} = await query;
  if (error) { showError('Error: '+error.message); return; }
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
  showToast('Status updated ✓');
}


// === CUSTOMERS CRUD (manager only) ==============================
// addCustomer accepts an optional name argument so it can be invoked
// programmatically (from the inline +Add new customer dropdown flow).
// Without an argument it returns false instead of throwing — the caller
// decides how to surface the error.
async function addCustomer(nameArg) {
  if (!await requireAuth()) return;
  var name = (nameArg !== undefined ? nameArg : '').trim();
  if (!name) return null;
  // Duplicate check (case-insensitive). Caller's validator usually catches
  // this first; keep the guard so direct calls stay safe.
  var dup = (CUSTOMERS||[]).some(function(c){ return c.name.toLowerCase() === name.toLowerCase(); });
  if (dup) { showError('A customer named "'+name+'" already exists.'); return null; }

  var res = await sb.from('customers').insert({ name: name, status: 'active' }).select().single();
  if (res.error) { showError('Error: '+res.error.message); return null; }
  showToast('Customer added ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  if (typeof renderCustomersTable === 'function') renderCustomersTable();
  renderManageProjects();
  return res.data; // {id, name, status}
}

// Inline "+ Add new customer..." flow — called from the Customer dropdown
// sentinel option. Opens promptInput, inserts the customer, then re-fills
// the dropdown and selects the new row.
async function onCustomerSelectAdd(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  // Roll back the sentinel selection BEFORE the modal opens so the dropdown
  // doesn't sit on "__add_new__" if the user cancels.
  sel.value = sel._prevValue || '';
  var name = await promptInput({
    title: 'Add Customer',
    label: 'Customer name',
    placeholder: 'e.g. Etisalat',
    confirmText: 'Add Customer',
    validate: function(v){
      var dup = (CUSTOMERS||[]).some(function(c){ return c.name.toLowerCase() === v.toLowerCase(); });
      return dup ? 'A customer named "'+v+'" already exists.' : null;
    }
  });
  if (!name) return;
  var created = await addCustomer(name);
  if (!created) return;
  // Re-fill the dropdown so the new customer is in the option list, then
  // select it. populateProjectDropdowns above already re-fills, but we
  // explicitly set the value here in case the caller's onchange uses it.
  fillCustomerSelect(selectId, sel.dataset.includeAll === 'true');
  sel.value = name;
  // Fire change so any dependent UI (engagement dropdown filter) updates.
  if (typeof sel.onchange === 'function') sel.onchange();
  else sel.dispatchEvent(new Event('change'));
  sel._prevValue = name;
}

// ─── MANAGE CUSTOMERS / MANAGE ENGAGEMENTS CROSS-NAV ─────────────
// The two manager pages share a customer dimension. Clicking an
// engagement count on the Customers page deep-links into the
// Engagements page filtered to that customer; clicking a customer
// name on the Engagements page deep-links back to the matching row
// on the Customers page with a brief pulse animation.

function _pjGetUrlParam(key) {
  try { return (new URLSearchParams(window.location.search)).get(key) || ''; }
  catch (e) { return ''; }
}
function _pjSetUrlParam(key, value) {
  try {
    var url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else       url.searchParams.delete(key);
    history.pushState(history.state, '', url.toString());
  } catch (e) { /* old browser */ }
}

// Open the Manage Engagements page pre-filtered to a single customer.
// Uses pushState so the browser back button drops the filter naturally.
function navigateToManageEngagementsForCustomer(name) {
  _pjSetUrlParam('customer', name || '');
  showScreen('projects');
  showProjectTab('manage');
}

// Open Manage Customers and scroll/pulse the matching row. ?highlight=
// is consumed by renderCustomersTable on render.
function navigateToManageCustomersHighlight(name) {
  _pjSetUrlParam('highlight', name || '');
  showScreen('projects');
  showProjectTab('custmgr');
}

function clearManageEngagementsCustomerFilter() {
  _pjSetUrlParam('customer', '');
  renderManageProjects();
}

// Back/forward → re-render whichever pj manager page is currently on
// screen so URL params stay in sync with the UI. Mirrors the tracker's
// popstate handler.
window.addEventListener('popstate', function(){
  var proj = document.getElementById('screen-projects');
  if (!proj || !proj.classList.contains('active')) return;
  var custTab = document.getElementById('pjtab-custmgr');
  var mgrTab  = document.getElementById('pjtab-manage');
  if (custTab && custTab.style.display !== 'none' && typeof renderCustomersTable === 'function') renderCustomersTable();
  if (mgrTab  && mgrTab.style.display  !== 'none' && typeof renderManageProjects   === 'function') renderManageProjects();
});

// Dedicated "+ Add Customer" entry point for the new Manage Customers
// page. Reuses the same promptInput + addCustomer flow as the inline
// dropdown sentinel, so duplicate-prevention stays single-sourced.
async function addCustomerPrompt() {
  var name = await promptInput({
    title: 'Add Customer',
    label: 'Customer name',
    placeholder: 'e.g. Etisalat',
    confirmText: 'Add Customer',
    validate: function(v){
      var dup = (CUSTOMERS||[]).some(function(c){ return c.name.toLowerCase() === v.toLowerCase(); });
      return dup ? 'A customer named "'+v+'" already exists.' : null;
    }
  });
  if (!name) return;
  await addCustomer(name);
}

// ─── MANAGE CUSTOMERS TABLE ──────────────────────────────────────
// Searchable + sortable table on its own page. Edit reuses the
// existing edit-customer modal; Delete blocks when engagement_count > 0.
var _custMgrSort   = { by: 'name', dir: 'asc' }; // by: 'name' | 'count'
function _custMgrSetSort(by) {
  if (_custMgrSort.by === by) {
    _custMgrSort.dir = (_custMgrSort.dir === 'asc') ? 'desc' : 'asc';
  } else {
    _custMgrSort.by = by;
    _custMgrSort.dir = (by === 'count') ? 'desc' : 'asc';
  }
  renderCustomersTable();
}

function renderCustomersTable() {
  var el = document.getElementById('cust-mgr-content');
  if (!el) return;

  var allRows = (CUSTOMERS||[]).slice();
  var search  = ((document.getElementById('cust-mgr-search')||{}).value||'').toLowerCase().trim();

  // Header total
  var totalEl = document.getElementById('cust-mgr-count');
  if (totalEl) totalEl.textContent = allRows.length ? '('+allRows.length+')' : '';

  // Empty data state
  if (!allRows.length) {
    el.innerHTML = renderEmptyState({
      icon: 'building-2',
      heading: 'No customers yet',
      sub: 'Add the first customer from the Add Engagement form below.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Engagement counts per customer (shown in the table + used by sort
  // + delete-guard). Archived engagements are excluded so the count
  // reflects what's actually visible in Manage Engagements.
  var counts = {};
  (ENGAGEMENTS||[]).forEach(function(e){
    if (e.is_archived) return;
    counts[e.customer_id] = (counts[e.customer_id]||0) + 1;
  });

  // Filter
  var filtered = search
    ? allRows.filter(function(c){ return String(c.name||'').toLowerCase().indexOf(search) !== -1; })
    : allRows;

  if (!filtered.length) {
    el.innerHTML = renderEmptyState({
      icon: 'search-x',
      heading: 'No customers match "'+esc2(search)+'"',
      sub: 'Try a different keyword.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Sort
  filtered.sort(function(a,b){
    var av, bv;
    if (_custMgrSort.by === 'count') {
      av = counts[a.id] || 0;
      bv = counts[b.id] || 0;
    } else {
      av = String(a.name||'').toLowerCase();
      bv = String(b.name||'').toLowerCase();
    }
    if (av < bv) return _custMgrSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return _custMgrSort.dir === 'asc' ?  1 : -1;
    return 0;
  });

  var sortArrow = function(col){
    if (_custMgrSort.by !== col) return '<i data-lucide="chevrons-up-down" class="cust-mgr-sort-ico"></i>';
    return _custMgrSort.dir === 'asc'
      ? '<i data-lucide="arrow-up" class="cust-mgr-sort-ico cust-mgr-sort-active"></i>'
      : '<i data-lucide="arrow-down" class="cust-mgr-sort-ico cust-mgr-sort-active"></i>';
  };

  var highlightName = _pjGetUrlParam('highlight');

  var rows = filtered.map(function(c){
    var n = counts[c.id] || 0;
    var safeName = (c.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var rowCls = (highlightName && c.name === highlightName) ? ' cust-row-highlight' : '';
    // Engagement count is a clickable link to Manage Engagements filtered
    // to this customer. Zero-count rows still navigate (filter shows empty
    // state on the engagements side rather than being silently inert).
    var countCell = n
      ? '<button type="button" class="cust-count-link" onclick="navigateToManageEngagementsForCustomer(\''+safeName+'\')" title="View engagements">'+fmtCount(n)+'</button>'
      : '<span class="dim">'+fmtCount(n)+'</span>';
    return '<tr class="cust-mgr-row'+rowCls+'" data-cust-name="'+esc2(c.name||'')+'">'+
      '<td><strong style="color:var(--navy)">'+esc2(c.name)+'</strong></td>'+
      '<td class="num">'+countCell+'</td>'+
      '<td style="white-space:nowrap;text-align:right">'+
        '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="openEditCustomer('+c.id+')" title="Rename"><i data-lucide="pencil"></i></button>'+
        '<button class="btn btn-sm btn-danger btn-icon-only" onclick="deleteCustomer('+c.id+",'"+safeName+"'"+')" title="Delete"><i data-lucide="trash-2"></i></button>'+
      '</td>'+
    '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="table-wrap"><table class="cust-mgr-table">'+
      '<thead><tr>'+
        '<th><button class="cust-mgr-sort-btn" onclick="_custMgrSetSort(\'name\')">Customer Name'+sortArrow('name')+'</button></th>'+
        '<th><button class="cust-mgr-sort-btn" onclick="_custMgrSetSort(\'count\')">Engagements'+sortArrow('count')+'</button></th>'+
        '<th style="text-align:right">Actions</th>'+
      '</tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
    '</table></div>';
  if (typeof renderIcons === 'function') renderIcons();

  // If we landed here via "highlight a customer" deep link, scroll the
  // matching row into view and trigger the brief pulse animation.
  if (highlightName) {
    setTimeout(function(){
      var row = el.querySelector('.cust-row-highlight');
      if (row && row.scrollIntoView) row.scrollIntoView({ behavior:'smooth', block:'center' });
      // The CSS animation fires on the class itself; clear the URL param
      // after a beat so a manual reload doesn't re-pulse forever.
      setTimeout(function(){ _pjSetUrlParam('highlight', ''); }, 1800);
    }, 60);
  }
}

async function openEditCustomer(id) {
  var {data, error} = await sb.from('customers').select('*').eq('id', id).single();
  if (error || !data) { showError('Could not load customer.'); return; }
  document.getElementById('edit-cust-id').value = data.id;
  document.getElementById('edit-cust-name').value = data.name || '';
  document.getElementById('edit-cust-status').value = data.status || 'active';
  document.getElementById('edit-cust-error').style.display = 'none';
  document.getElementById('edit-customer-modal').classList.add('show');
}
function closeEditCustomerModal() {
  document.getElementById('edit-customer-modal').classList.remove('show');
}
async function saveEditCustomer() {
  if (!await requireAuth()) return;
  var id = document.getElementById('edit-cust-id').value;
  var name = (document.getElementById('edit-cust-name').value||'').trim();
  var status = document.getElementById('edit-cust-status').value;
  var errEl = document.getElementById('edit-cust-error');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent='Customer name is required.'; errEl.style.display='block'; return; }

  // Read OLD name for cascade
  var oldRes = await sb.from('customers').select('name').eq('id', id).single();
  var oldName = oldRes.data ? oldRes.data.name : null;
  // Duplicate (other rows with same name)
  var dup = (CUSTOMERS||[]).some(function(c){ return String(c.id) !== String(id) && c.name.toLowerCase() === name.toLowerCase(); });
  if (dup) { errEl.textContent='Another customer is already named "'+name+'".'; errEl.style.display='block'; return; }

  var {error} = await sb.from('customers').update({ name: name, status: status }).eq('id', id);
  if (error) { errEl.textContent='Error: '+error.message; errEl.style.display='block'; return; }

  // If renamed, cascade to every session table that snapshots customer_name
  if (oldName && oldName !== name) {
    await sb.from('project_sessions').update({ customer_name: name }).eq('customer_name', oldName);
    await sb.from('ot_sessions').update({ customer_name: name }).eq('customer_name', oldName);
    await sb.from('unified_sessions').update({ customer_name: name }).eq('customer_name', oldName);
  }
  closeEditCustomerModal();
  showToast('Customer saved ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  if (typeof renderCustomersTable === 'function') renderCustomersTable();
  renderManageProjects();
  if (typeof loadTracker === 'function' && document.getElementById('screen-tracker') && document.getElementById('screen-tracker').classList.contains('active')) {
    loadTracker();
  }
}

async function deleteCustomer(id, name) {
  if (!await requireAuth()) return;
  // Refusal path: delete is BLOCKED when the customer still has engagements.
  // The old chip-wall flow cascade-deleted everything; the new Manage Customers
  // table is intentionally stricter — managers must reassign or remove the
  // child engagements first. This keeps accidental data loss off the table.
  // Include archived engagements in the reference check — even an
  // archived engagement should keep its customer around (the customer
  // name is snapshotted on sessions, but the FK to customers still
  // exists on the engagement row).
  var custEngagements = (ENGAGEMENTS||[]).filter(function(e){ return e.customer_id === id; });
  if (custEngagements.length) {
    await confirmAction({
      title: 'Can’t delete customer "'+name+'" yet',
      body: 'This customer has '+custEngagements.length+' engagement'+(custEngagements.length===1?'':'s')+' attached.\n\nRemove or reassign those engagements first, then come back and delete the customer.',
      confirmText: 'OK',
      danger: false
    });
    return;
  }

  if (!await confirmAction({
    title: 'Delete customer "'+name+'"?',
    body: 'This customer has no engagements attached. It will be removed from the database.\n\nThis cannot be undone.',
    requireTyping: name,
    confirmText: 'Delete customer'
  })) return;

  var {error} = await sb.from('customers').delete().eq('id', id);
  if (error) { showError('Error: '+error.message); return; }

  showToast('Customer deleted ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  if (typeof renderCustomersTable === 'function') renderCustomersTable();
  renderManageProjects();
  // Refresh tracker too if it has been viewed in this session
  if (typeof loadTracker === 'function' && document.getElementById('screen-tracker') && document.getElementById('screen-tracker').classList.contains('active')) {
    loadTracker();
  }
}

// ── RENDER MANAGE ENGAGEMENTS LIST ───────────────────────────────
var _pjShowArchived = false;     // false = active engagements, true = Archived view
function _pjToggleArchivedView() { _pjShowArchived = !_pjShowArchived; renderManageProjects(); }

async function renderManageProjects() {
  document.getElementById('pj-manage-loading').style.display = 'flex';
  document.getElementById('pj-manage-content').innerHTML = '';
  const statusFilter = document.getElementById('pj-manage-filter').value;
  const typeFilter   = (document.getElementById('pj-manage-type-filter')||{}).value || '';
  const searchRaw    = ((document.getElementById('pj-manage-search')||{}).value || '').trim().toLowerCase();
  const custParam    = _pjGetUrlParam('customer');

  // Refresh the Archived toggle button — count + label reflect current view.
  var archivedCount = (ENGAGEMENTS||[]).filter(function(e){return !!e.is_archived;}).length;
  var togBtn = document.getElementById('pj-archived-toggle');
  if (togBtn) {
    togBtn.style.display = (archivedCount === 0 && !_pjShowArchived) ? 'none' : '';
    togBtn.classList.toggle('archived-toggle-on', _pjShowArchived);
    togBtn.innerHTML = _pjShowArchived
      ? '<i data-lucide="arrow-left" class="btn-icon"></i>Back to Active'
      : '<i data-lucide="archive" class="btn-icon"></i>Archived ('+archivedCount+')';
    if (typeof renderIcons === 'function') renderIcons();
  }

  // Filter banner reflects the URL state — keeps deep links and back/
  // forward in sync with the visible UI.
  var banner = document.getElementById('pj-manage-filter-banner');
  var bannerTxt = document.getElementById('pj-manage-filter-banner-text');
  if (banner && bannerTxt) {
    if (custParam) {
      banner.style.display = '';
      bannerTxt.textContent = 'Showing engagements for ' + custParam;
    } else {
      banner.style.display = 'none';
      bannerTxt.textContent = '';
    }
    if (typeof renderIcons === 'function') renderIcons();
  }

  // Archived view splits the list — archived rows are only visible
  // when the manager explicitly opens the Archived view. Every other
  // filter still applies within the chosen side.
  let q = sb.from('engagements').select('*').eq('is_archived', _pjShowArchived).order('type').order('name');
  if (statusFilter) q = q.eq('status', statusFilter);
  if (typeFilter)   q = q.eq('type',   typeFilter);
  const {data} = await q;
  document.getElementById('pj-manage-loading').style.display = 'none';

  var custById = {}; (CUSTOMERS||[]).forEach(function(c){ custById[c.id] = c.name; });

  // Build the row set:
  //   - apply ?customer= filter (exact name match against snapshot)
  //   - apply free-text search across customer + engagement + type + status
  var rows = (data || []).filter(function(p){
    var cn = custById[p.customer_id] || '';
    if (custParam && cn !== custParam) return false;
    if (!searchRaw) return true;
    return [cn, p.name, p.type, p.status]
      .some(function(s){ return s && String(s).toLowerCase().indexOf(searchRaw) !== -1; });
  });

  if (!rows.length) {
    var heading, sub;
    if (custParam) {
      // Customer filter active but no match — likely a stale deep link
      // after a rename. Surface that hypothesis so the manager isn't
      // confused.
      heading = 'No engagements for ' + custParam;
      sub     = 'The customer may have been renamed since this link was created, or simply has no engagements yet.';
    } else if (searchRaw || statusFilter || typeFilter) {
      heading = 'No engagements match the current filters';
      sub     = 'Try clearing the search or adjusting the filters above.';
    } else {
      heading = 'No engagements found';
      sub     = 'Adjust the filters above, or create a new engagement.';
    }
    document.getElementById('pj-manage-content').innerHTML = renderEmptyState({
      icon: custParam ? 'search-x' : 'folder-open',
      heading: heading,
      sub: sub
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Lucide icon name + plain label per status. Renderer wraps the icon as
  // <i data-lucide> so the badge picks up an SVG glyph after lucide.createIcons().
  const STATUS_COLORS = {
    'active':    {bg:'#DCFCE7',color:'#166534',icon:'circle',         label:'Active'},
    'sign-off':        {bg:'#FEF3C7',color:'#92400E',icon:'pen-tool',       label:'Sign-off'},
    'payment-pending': {bg:'#FEF9C3',color:'#854D0E',icon:'wallet',         label:'Payment Pending'},
    'closed':          {bg:'#E0F2FE',color:'#075985',icon:'check-circle-2', label:'Closed'},
    'on-hold':   {bg:'#FED7AA',color:'#9A3412',icon:'pause-circle',   label:'On Hold'},
    'dormant':   {bg:'#F3F4F6',color:'#4B5563',icon:'moon',           label:'Dormant'},
    'cancelled': {bg:'#FEE2E2',color:'#991B1B',icon:'x-circle',       label:'Cancelled'},
  };
  const TYPE_BADGES = {
    'project':  {bg:'#EFF6FF',color:'#2563EB',label:'PROJECT'},
    'poc':      {bg:'#F5F3FF',color:'#7C3AED',label:'POC'},
    'amc':      {bg:'#FFFBEB',color:'#B45309',label:'AMC'},
    'support':  {bg:'#FFF1F2',color:'#9F1239',label:'SUPPORT'},
    'presales': {bg:'#FDF2F8',color:'#BE185D',label:'PRE-SALES-TASK'},
  };

  document.getElementById('pj-manage-content').innerHTML =
    '<div class="table-wrap"><table class="pj-manage-table">'+
    '<thead><tr><th>#</th><th>Customer</th><th>Type</th><th>Engagement Name</th><th>Status</th><th>Actions</th></tr></thead>'+
    '<tbody>'+
    rows.map(function(p,i){
      var sc = STATUS_COLORS[p.status] || STATUS_COLORS['active'];
      var tb = TYPE_BADGES[p.type] || {bg:'#F3F4F6',color:'#6B7280',label:(p.type||'-').toUpperCase()};
      var custName = custById[p.customer_id] || PROJECT_CUSTOMER[p.name] || '-';
      var safeCust = String(custName).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      var custCell = (custName && custName !== '-')
        ? '<button type="button" class="pj-cust-link" onclick="navigateToManageCustomersHighlight(\''+safeCust+'\')" title="View this customer">'+esc2(custName)+'</button>'
        : '<span class="dim">—</span>';
      var safeNameEsc = (p.name||'').replace(/'/g,"\\'");
      var actions = _pjShowArchived
        ? '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="restoreEngagement('+p.id+')" title="Restore" style="margin-right:4px"><i data-lucide="rotate-ccw"></i></button>'+
          (isManager ? '<button class="btn btn-sm btn-danger btn-icon-only" onclick="permanentlyDeleteEngagement('+p.id+',\''+safeNameEsc+'\')" title="Permanently Delete (cannot be undone)"><i data-lucide="trash-2"></i></button>' : '')
        : '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="openEditProject('+p.id+')" title="Edit" style="margin-right:4px"><i data-lucide="pencil"></i></button>'+
          '<button class="btn btn-sm btn-danger btn-icon-only" onclick="archiveEngagement('+p.id+',\''+safeNameEsc+'\')" title="Archive"><i data-lucide="trash-2"></i></button>';
      return '<tr>'+
        '<td style="color:var(--muted);font-size:12px">'+(i+1)+'</td>'+
        '<td>'+custCell+'</td>'+
        '<td><span style="background:'+tb.bg+';color:'+tb.color+';padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600">'+tb.label+'</span></td>'+
        '<td><strong>'+esc2(p.name||'')+'</strong></td>'+
        '<td><span class="pj-status-badge" style="background:'+sc.bg+';color:'+sc.color+'"><i data-lucide="'+sc.icon+'"></i>'+sc.label+'</span></td>'+
        '<td style="white-space:nowrap">'+actions+'</td>'+
        '</tr>';
    }).join('')+
    '</tbody></table></div>';
  if (typeof renderIcons === 'function') renderIcons();
}

// ── EDIT PROJECT (manager) ────────────────────────────────────────
async function openEditProject(id) {
  var {data, error} = await sb.from('engagements').select('*').eq('id', id).single();
  if (error || !data) { showError('Could not load engagement.'); return; }
  // Defense-in-depth: if the engagement is archived, show the banner
  // and disable the form. Archived rows shouldn't normally reach here
  // (Archived view's action column shows Restore + Permanent Delete).
  if (typeof setModalArchivedBanner === 'function') {
    var modalBox = document.querySelector('#edit-project-modal .modal');
    setModalArchivedBanner(modalBox, data.is_archived ? 'engagement' : null);
  }
  document.getElementById('edit-project-id').value = data.id;
  document.getElementById('edit-project-name').value = data.name || '';
  document.getElementById('edit-project-status').value = data.status || 'active';
  var typeEl = document.getElementById('edit-project-type');
  if (typeEl) typeEl.value = data.type || 'project';
  fillCustomerSelect('edit-project-customer', false);
  var custById = {}; (CUSTOMERS||[]).forEach(function(c){ custById[c.id] = c.name; });
  document.getElementById('edit-project-customer').value = custById[data.customer_id] || '';
  // Seed vendor + product line. Existing engagements with NULL stay blank —
  // edit flow stays forgiving so users can save without backfilling.
  fillVendorSelect('edit-project-vendor', data.vendor || '');
  fillProductLineSelect('edit-project-product-line', data.vendor || '', data.product_line || '');
  ['edit-project-vendor-other','edit-project-product-line-other'].forEach(function(otherId){
    var el = document.getElementById(otherId); if (el) { el.value = ''; el.style.display = 'none'; }
  });
  // POC conversion toggle — seed checkbox + stash engagement type for visibility logic
  var epConv = document.getElementById('edit-project-converted');
  if (epConv) {
    epConv.checked = !!data.converted_to_project;
    epConv.dataset.engType = data.type || '';
  }
  _epRefreshConvertedToggle();
  document.getElementById('edit-project-modal').classList.add('show');
}

// Show/hide + enable/disable the POC conversion toggle in the legacy
// edit-project-modal based on current type + status. Mirrors the tracker
// modal's _trkRefreshConvertedToggle so behaviour stays consistent.
function _epRefreshConvertedToggle() {
  var row = document.getElementById('edit-project-converted-row');
  var cb  = document.getElementById('edit-project-converted');
  var lbl = document.getElementById('edit-project-converted-label');
  if (!row || !cb) return;
  var engType = cb.dataset.engType || '';
  if (engType !== 'poc') {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  var topStatus = (document.getElementById('edit-project-status')||{}).value || 'active';
  var isActive  = (topStatus === 'active' || topStatus === '');
  cb.disabled = isActive;
  if (lbl) lbl.title = isActive ? 'Available once POC is no longer active' : '';
  row.classList.toggle('poc-conv-disabled', isActive);
}

function closeEditProjectModal() {
  document.getElementById('edit-project-modal').classList.remove('show');
}

async function saveEditProject() {
  if (!await requireAuth()) return;
  var id = document.getElementById('edit-project-id').value;
  var customer = document.getElementById('edit-project-customer').value;
  var name = (document.getElementById('edit-project-name').value||'').trim();
  var status = document.getElementById('edit-project-status').value;
  var typeEl = document.getElementById('edit-project-type');
  var type   = typeEl ? typeEl.value : 'project';
  if (!customer || !name || !type) { showError('Customer, Type and Engagement Name are required.'); return; }
  var custRow = (CUSTOMERS||[]).find(function(c){ return c.name === customer; });
  var customer_id = custRow ? custRow.id : null;

  // Vendor + Product Line — edit flow stays forgiving for existing engagements
  // (NULL allowed). Resolve "Other (specify)" through the inline text input.
  var vendorVal = (document.getElementById('edit-project-vendor')||{}).value || '';
  var plVal     = (document.getElementById('edit-project-product-line')||{}).value || '';
  if (vendorVal === '__other__') {
    vendorVal = ((document.getElementById('edit-project-vendor-other')||{}).value||'').trim();
  }
  if (plVal === '__other__') {
    plVal = ((document.getElementById('edit-project-product-line-other')||{}).value||'').trim();
  }

  // Read OLD row so we can cascade renames / customer / type changes to session tables
  var oldRes = await sb.from('engagements').select('name,customer_id,type').eq('id', id).single();
  var oldName = oldRes.data ? oldRes.data.name : null;
  var oldCustomerId = oldRes.data ? oldRes.data.customer_id : null;
  var oldType = oldRes.data ? oldRes.data.type : null;

  // POC conversion toggle — only include in the patch when this row is a POC,
  // matches the visibility rule on the form. DB trigger blocks employees from
  // changing it server-side; the form also disables it for non-managers.
  var updatePayload = {
    name: name, status: status, customer_id: customer_id, type: type,
    vendor:       vendorVal || null,
    product_line: plVal     || null
  };
  var epConvSave = document.getElementById('edit-project-converted');
  if (epConvSave && epConvSave.dataset.engType === 'poc') {
    updatePayload.converted_to_project = !!epConvSave.checked;
  }
  var {error} = await sb.from('engagements').update(updatePayload).eq('id', id);
  if (error) { showError('Error: '+error.message); return; }

  // If renamed, cascade the new name to every session table that snapshots it
  if (oldName && oldName !== name) {
    var pjRes  = await sb.from('project_sessions').update({ project_name: name }).eq('project_name', oldName);
    var otRes  = await sb.from('ot_sessions').update({ project_name: name }).eq('project_name', oldName);
    var usRes  = await sb.from('unified_sessions').update({ engagement_name: name }).eq('engagement_name', oldName);
    if (pjRes.error) console.error('project_sessions cascade failed:', pjRes.error);
    if (otRes.error) console.error('ot_sessions cascade failed:', otRes.error);
    if (usRes.error) console.error('unified_sessions cascade failed:', usRes.error);
  }

  // If reassigned to a different customer, refresh the snapshotted customer_name too.
  // Match by the (possibly new) engagement name to catch sessions just renamed above.
  if (oldCustomerId !== customer_id) {
    var pjC = await sb.from('project_sessions').update({ customer_name: customer }).eq('project_name', name);
    var otC = await sb.from('ot_sessions').update({ customer_name: customer }).eq('project_name', name);
    var usC = await sb.from('unified_sessions').update({ customer_name: customer }).eq('engagement_name', name);
    if (pjC.error) console.error('project_sessions customer cascade failed:', pjC.error);
    if (otC.error) console.error('ot_sessions customer cascade failed:', otC.error);
    if (usC.error) console.error('unified_sessions customer cascade failed:', usC.error);
  }

  // If type changed (e.g. project -> amc), cascade to unified_sessions.session_type
  // so historical sessions show under the correct summary tab. session_type only
  // exists on unified_sessions; ot_sessions/project_sessions don't carry it.
  if (oldType && oldType !== type) {
    var usT = await sb.from('unified_sessions').update({ session_type: type }).eq('engagement_name', name);
    if (usT.error) console.error('unified_sessions session_type cascade failed:', usT.error);
    // v127: also clear tracker_status. The current phase value is anchored
    // to the old waterfall (project/POC use different phase lists), so a
    // project → poc switch would leave a project phase rendering as
    // "(legacy)" in the tracker dropdown until the manager manually
    // re-picks. Clearing forces a fresh pick on next edit.
    var tsT = await sb.from('engagements').update({ tracker_status: null }).eq('id', id);
    if (tsT.error) console.error('tracker_status clear on type-change failed:', tsT.error);
  }

  closeEditProjectModal();
  showToast('Engagement updated ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

// Soft-delete: archive moves the engagement out of every active list
// but leaves its sessions/links intact. Existing snapshot text on
// session tables is unchanged; the engagement row remains for restore.
async function archiveEngagement(id, name) {
  if (!await requireAuth()) return;
  if (!await confirmAction({
    title: 'Archive engagement "'+name+'"?',
    body:  'This will move the engagement to the Archived view. It will no longer appear in active lists, dropdowns, or the tracker, but can be restored later.\n\nSessions previously logged against it stay intact.',
    confirmText: 'Archive'
  })) return;
  var {error} = await sb.from('engagements').update({
    is_archived: true,
    archived_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { showError('Could not archive: '+error.message); return; }
  showToast('Archived ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

async function restoreEngagement(id) {
  if (!await requireAuth()) return;
  var e = (ENGAGEMENTS||[]).find(function(x){ return x.id === id; });
  if (!e) return;
  if (!await confirmAction({
    title: 'Restore engagement "'+(e.name||'')+'"?',
    body:  'It will return to the active engagements list.',
    confirmText: 'Restore',
    danger: false
  })) return;
  var {error} = await sb.from('engagements').update({
    is_archived: false,
    archived_at: null
  }).eq('id', id);
  if (error) { showError('Could not restore: '+error.message); return; }
  showToast('Restored ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

async function permanentlyDeleteEngagement(id, name) {
  if (!await requireAuth()) return;
  if (!isManager) { showError('Manager access only.'); return; }
  if (!await confirmAction({
    title: 'Permanently delete engagement "'+name+'"?',
    body:  '⚠️ This cannot be undone. The engagement record will be permanently removed. Existing sessions keep their snapshot text but lose any future link.',
    requireTyping: name,
    confirmText: 'Permanently Delete'
  })) return;
  var {error} = await sb.from('engagements').delete().eq('id', id);
  if (error) { showError('Could not delete: '+error.message); return; }
  showToast('Permanently deleted ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

// Back-compat shim — anything that still calls deleteProject (e.g. an
// old onclick somewhere) lands on the new archive flow.
async function deleteProject(id, name) { return archiveEngagement(id, name); }

// ── POPULATE ALL PROJECT DROPDOWNS ───────────────────────────────
function populateProjectDropdowns() {
  // Customer selects (forms + filters)
  fillCustomerSelect('pj-customer', false);
  fillCustomerSelect('pj-new-customer', false);
  fillCustomerSelect('edit-ot-customer', false);
  fillCustomerSelect('edit-pj-customer', false);
  fillCustomerSelect('pj-filter-customer', true);

  // Vendor + Product Line selects on the Add Engagement form. Edit Engagement
  // modal populates its selects on open (openEditProject) since it needs the
  // engagement's current values to seed them.
  fillVendorSelect('pj-new-vendor', '');
  fillProductLineSelect('pj-new-product-line', '', '');

  // Project selects — OT edit forms start unfiltered (until user picks customer)
  fillProjectSelect('pj-project', '', false);
  fillProjectSelect('edit-ot-project', '', false);
  fillProjectSelect('edit-pj-project', '', false);
  fillProjectSelect('pj-filter-project', '', true);

  // Activity type selects
  fillActivitySelect('pj-activity');
  fillActivitySelect('edit-pj-activity');
  fillActivitySelect('edit-ot-activity-type');
}

// Customer-change handlers — re-filter project dropdown to only that customer
function onPjCustomerChange() {
  fillProjectSelect('pj-project', document.getElementById('pj-customer').value, false);
}
function onEditOTCustomerChange() {
  fillProjectSelect('edit-ot-project', document.getElementById('edit-ot-customer').value, false);
}
function onEditPjCustomerChange() {
  fillProjectSelect('edit-pj-project', document.getElementById('edit-pj-customer').value, false);
}
function onPjFilterCustomerChange() {
  fillProjectSelect('pj-filter-project', document.getElementById('pj-filter-customer').value, true);
  renderPjSessions();
}

// Delivery-side activity list — applies to Project / POC / AMC / Support
// sessions. Pre-Sales-Task and Customer Testing sessions get their own
// short lists below; their work isn't delivery-style. Project / POC also
// pick up "Design Discussion" via the project-only branch in
// activityTypesForSession (AMC + Support don't get it).
const ACTIVITY_TYPES = [
  'HLD Discussion','HLD Documentation','LLD Discussion','LLD Documentation',
  'Pilot Sites Rollout','As-Built Documentation','KT / Training','Migration',
  'Troubleshooting','Initial Configuration','Others'
];

// Pre-Sales-Task-specific activity list (session_type='presales').
// Includes "Design Discussion" as of v86 — design conversations during
// pre-sales scoping are a real activity worth tracking. "Tech Review"
// added in v89 — separate from Tech Proposal since reviewing someone
// else's proposal is a distinct activity from drafting one.
const PRESALES_ACTIVITY_TYPES = ['PS Calculation','SOW','Tech Proposal','Design Discussion','Tech Review'];

// Internal-session activity list (session_type='internal'). Distinct
// from delivery work — no customer or engagement attached.
const INTERNAL_ACTIVITY_TYPES = ['Testing for customers','Lab setup','Troubleshooting','Others'];

// Customer Testing activity list (session_type='customer_testing'). Lab
// validations and customer demos against a named customer — no formal
// engagement record. Short list; "Others" covers anything bespoke.
const CUSTOMER_TESTING_ACTIVITY_TYPES = ['Lab Validation','Customer Demo','Others'];

// v118: POC sessions have their own activity vocabulary, distinct from the
// delivery list. Uses a value/label split so "Initial Config" displays to
// the user but stores as the canonical "Initial Configuration" (preserves
// the v109a Activity Matrix bucket — no re-fragmentation). "Design
// Discussion" reuses the existing canonical. The other 5 are POC-specific.
const POC_ACTIVITY_TYPES = [
  { v:'PoC Documentation',          l:'PoC Documentation' },
  { v:'Initial Discussion',         l:'Initial Discussion' },
  { v:'Design Discussion',          l:'Design Discussion' },
  { v:'Initial Configuration',      l:'Initial Config' },
  { v:'PoC Branch Migration',       l:'PoC Branch Migration' },
  { v:'Troubleshooting/Monitoring', l:'Troubleshooting/Monitoring' },
  { v:'PoC Report',                 l:'PoC Report' }
];

const DEVICE_MODELS = ['EC-XS','EC-SP','EC-M','EC-10104','EC-10106'];

// Return the activity-type options that apply for a given session type.
// Future session types can plug in here without touching the call sites.
function activityTypesForSession(sessionType) {
  if (sessionType === 'presales')         return PRESALES_ACTIVITY_TYPES;
  if (sessionType === 'internal')         return INTERNAL_ACTIVITY_TYPES;
  if (sessionType === 'customer_testing') return CUSTOMER_TESTING_ACTIVITY_TYPES;
  // v118: POC sessions get their own vocabulary (POC_ACTIVITY_TYPES),
  // distinct from the delivery list. Split from the previous shared
  // 'project | poc' branch — Project keeps the delivery list + Design
  // Discussion + Daily Sync Call (v86 + v109b) unchanged.
  if (sessionType === 'poc') return POC_ACTIVITY_TYPES;
  if (sessionType === 'project') {
    return ACTIVITY_TYPES.concat(['Design Discussion','Daily Sync Call']);
  }
  // AMC + Support stick to the delivery list as-is (maintenance/firefighting
  // flows don't need the design-conversation extras).
  return ACTIVITY_TYPES;
}

// Populate an Activity Type <select>.
//   sessionType  — optional, picks the right list. Defaults to delivery.
//   legacyValue  — optional, the row's existing activity_type when
//                  editing. If it isn't in the new filtered list (e.g.
//                  an old 'presales' session saved before this filter),
//                  we still surface it as "<value> (legacy)" so the
//                  form doesn't silently drop it.
function fillActivitySelect(selectId, sessionType, legacyValue) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  // v118: accept both plain-string and {v,l}-object entries. POC uses the
  // object form so an option can render one label ("Initial Config") while
  // storing a different canonical value ("Initial Configuration"). All
  // other lists are still plain strings — normalized to {val:s, lbl:s}.
  var list = activityTypesForSession(sessionType);
  var norm = list.map(function(item){
    return (typeof item === 'string')
      ? { val:item, lbl:item }
      : { val:item.v, lbl:item.l };
  });
  var html = '<option value="">-- Select --</option>'
    + norm.map(function(o){
        return '<option value="'+esc2(o.val)+'">'+esc2(o.lbl)+'</option>';
      }).join('');
  // Legacy-value preservation compares against stored values (norm.val), so
  // an existing POC row with activity_type='Initial Configuration' resolves
  // to the canonical option above (not surfaced as legacy), while an old
  // value not in the list still appears as "<value> (legacy)".
  if (legacyValue && !norm.some(function(o){ return o.val === legacyValue; })) {
    html += '<option value="'+esc2(legacyValue)+'">'+esc2(legacyValue)+' (legacy)</option>';
  }
  el.innerHTML = html;
  if (cur) el.value = cur;
}

function initProjectTab() {
  // Show Manage Engagements item for manager only
  const sbiManage = document.getElementById('sbi-projects-manage');
  if (sbiManage) sbiManage.style.display = isManager ? '' : 'none';

  // Populate project dropdowns
  populateProjectDropdowns();

  // Build team checkboxes
  const box = document.getElementById('pj-team-checkboxes');
  if (box && !box.children.length) {
    EMPLOYEES.forEach(function(emp) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;cursor:pointer;padding:6px 12px;border:1.5px solid var(--border);border-radius:20px;background:white;transition:all .15s';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = emp; cb.name = 'pj-team';
      cb.style.accentColor = 'var(--teal)';
      cb.onchange = function() {
        label.style.background = cb.checked ? '#E0F7FF' : 'white';
        label.style.borderColor = cb.checked ? 'var(--teal)' : 'var(--border)';
      };
      // Auto-check current user
      if (emp === currentUser) {
        cb.checked = true;
        label.style.background = '#E0F7FF';
        label.style.borderColor = 'var(--teal)';
      }
      label.appendChild(cb);
      // Show distinct short names — avoid two "Mohammed" labels
      const _shortNames = {
        'Ahmed Ali':'AHMED','Venkatesan':'VENKAT','Prasanth':'PRASANTH',
        'Salman Aziz':'SALMAN','Mohammed Afsal':'AFSAL','Mohammed Nasif':'NASIF'
      };
      const label_text = _shortNames[emp] || emp.split(' ')[0].toUpperCase();
      label.appendChild(document.createTextNode(label_text));
      box.appendChild(label);
    });
  }

  // Populate year selectors
  const currentYear = new Date().getFullYear();
  ['pj-eng-year','pj-cust-year','pj-emp-year'].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el || el.options.length) return;
    // Add "All Years" as first option (default)
    const allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = 'All Years'; allOpt.selected = true;
    el.appendChild(allOpt);
    for (let y = currentYear; y >= 2023; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      el.appendChild(o);
    }
  });

  // Set today's date
  const dateEl = document.getElementById('pj-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
}

function clearEmployeeSummaryFilters() {
  ['pj-emp-from','pj-emp-to'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  renderPjEmployeeSummary();
}

async function renderPjEmployeeSummary() {
  document.getElementById('pj-employee-loading').style.display='flex';
  document.getElementById('pj-employee-content').innerHTML='';
  const year = document.getElementById('pj-emp-year').value || 'all';
  const fFrom = (document.getElementById('pj-emp-from')||{}).value || '';
  const fTo   = (document.getElementById('pj-emp-to')||{}).value   || '';

  // Reads unified_sessions (Phase 6 cutover). Aggregates by employee
  // (the `employee` column on the unified row, which is the logger),
  // with a per-type breakdown column. Date range overrides year.
  // Paginated to bypass the Supabase server-side 1000-row cap.
  const res = await fetchAllRows(function() {
    let q = sb.from('unified_sessions').select('*');
    if (fFrom || fTo) {
      if (fFrom) q = q.gte('session_date', fFrom);
      if (fTo)   q = q.lte('session_date', fTo);
    } else if (year !== 'all') {
      q = q.gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
    }
    return q;
  });
  const data = res.data;
  document.getElementById('pj-employee-loading').style.display='none';

  const rows = data || [];

  const empData = {};
  EMPLOYEES.forEach(function(e){
    empData[e] = { total:0, sessions:0, project:0, poc:0, amc:0, support:0, presales:0, customer_testing:0, internal:0, engagements:{} };
  });

  rows.forEach(function(r) {
    var hrs = parseFloat(r.total_hours || 0);
    // Credit every team member (not just the logger). Internal sessions
    // have no team_members → credit just the logger. For Project/POC/AMC,
    // match each comma-separated name against the EMPLOYEES list (exact
    // or first-name). Fall back to the logger if no name matched.
    var participants = [];
    // v78: dropped the `|| r.session_type === 'internal'` clause. Pre-v77
    // the UI hid team_members for Internal sessions so this was harmless
    // belt-and-braces; after v77 it actively threw away real team-member
    // data. Internal sessions with no team_members still fall through
    // the !r.team_members guard and credit only the logger.
    if (!r.team_members) {
      if (r.employee) participants.push(r.employee);
    } else {
      var names = r.team_members.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      // v119: always include the logger as a match candidate. Previously the
      // logger was credited only as a fallback when team_members matched no
      // known employee — so sessions a user logged but whose own name wasn't
      // in team_members lost their credit (Nasif: 338 sessions / ~633h dropped).
      // Brings Employee Summary into agreement with the Activity Matrix
      // (both = true Model A: logger ∪ team_members). No double-count:
      // EMPLOYEES.forEach credits each employee at most once per session
      // via a single .some() match.
      if (r.employee) names.push(r.employee);
      EMPLOYEES.forEach(function(emp) {
        var firstName = emp.split(' ')[0].toLowerCase();
        var hit = names.some(function(n) {
          var nl = n.toLowerCase();
          return nl === emp.toLowerCase() || nl === firstName;
        });
        if (hit) participants.push(emp);
      });
      if (participants.length === 0 && r.employee) participants.push(r.employee);
    }

    participants.forEach(function(emp) {
      if (!empData[emp]) return;
      empData[emp].total    += hrs;
      empData[emp].sessions += 1;
      if (empData[emp][r.session_type] !== undefined) empData[emp][r.session_type] += hrs;
      var key = r.engagement_name || (r.session_type==='internal' ? '(internal)' : '(unspecified)');
      empData[emp].engagements[key] = (empData[emp].engagements[key]||0) + hrs;
    });
  });

  // v126: cache aggregated rows for exportEmployeeSummaryCsv. Flattens
  // each engagement-map into a "name: hours; name: hours" string.
  window._pjEmpRowsCache = EMPLOYEES.map(function(emp) {
    var d = empData[emp];
    var engs = Object.keys(d.engagements)
      .sort(function(a,b){ return d.engagements[b]-d.engagements[a]; })
      .map(function(p){ return p+': '+fmtHours(d.engagements[p])+'h'; })
      .join('; ');
    return {
      employee: emp,
      sessions: d.sessions,
      total: d.total,
      project: d.project,
      poc: d.poc,
      amc: d.amc,
      support: d.support,
      presales: d.presales,
      customer_testing: d.customer_testing,
      internal: d.internal,
      days: d.total / 8,
      engagements: engs
    };
  });

  const tableRows = EMPLOYEES.map(function(emp) {
    const d = empData[emp];
    const engCount = Object.keys(d.engagements).length;
    const topEngs = Object.keys(d.engagements)
      .sort(function(a,b){ return d.engagements[b]-d.engagements[a]; })
      .slice(0,3)
      .map(function(p){ return p+' ('+fmtHours(d.engagements[p])+')'; })
      .join(', ');
    return '<tr>'+
      '<td><strong>'+emp+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+fmtCount(d.sessions)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:16px">'+fmtHours(d.total)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(d.project)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(d.poc)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(d.amc)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(d.support)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(d.presales)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(d.customer_testing)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(d.internal)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px;color:var(--muted)">'+fmtDays(d.total/8)+'</td>'+
      '<td style="font-size:11px;color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc2(topEngs)+'">'+(topEngs||'-')+'</td>'+
    '</tr>';
  }).join('');

  const totalHours = EMPLOYEES.reduce(function(s,e){ return s+empData[e].total; },0);

  document.getElementById('pj-employee-content').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Total Hours by Employee</div>'+
    buildPieChart(EMPLOYEES.map(function(e){ return {label:empShortName(e),value:empData[e].total,color:empColor(e)}; }).filter(function(d){return d.value>0;}),'h')+
    '</div>'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Sessions by Employee</div>'+
    buildPieChart(EMPLOYEES.map(function(e){ return {label:empShortName(e),value:empData[e].sessions,color:empColor(e)}; }).filter(function(d){return d.value>0;}),'')+
    '</div></div>'+
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>Employee</th><th>Sessions</th><th>Total</th>'+
      '<th><span class="pj-th-ico"><i data-lucide="folder"></i>Project</span></th>'+
      '<th><span class="pj-th-ico"><i data-lucide="target"></i>POC</span></th>'+
      '<th><span class="pj-th-ico"><i data-lucide="wrench"></i>AMC</span></th>'+
      '<th><span class="pj-th-ico"><i data-lucide="life-buoy"></i>Support</span></th>'+
      '<th><span class="pj-th-ico"><i data-lucide="briefcase"></i>Pre-Sales</span></th>'+
      '<th><span class="pj-th-ico"><i data-lucide="flask-conical"></i>Cust Test</span></th>'+
      '<th><span class="pj-th-ico"><i data-lucide="cog"></i>Internal</span></th>'+
      '<th>Working Days</th><th>Top Engagements</th></tr></thead>'+
    '<tbody>'+tableRows+
    '<tr style="background:#f8fafc;font-weight:600"><td>TOTAL</td><td>-</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--navy);font-size:16px">'+fmtHours(totalHours)+'</td>'+
    '<td colspan="7">-</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--muted)">'+fmtDays(totalHours/8)+'</td><td>-</td></tr>'+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Year: '+(year==='all'?'All Years':year)+' | Working days = hours / 8 | Hours are credited to every team member on a session (so a 4h session with 3 members shows 4h on each row, summing to 12h in TOTAL).</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

// ── CUSTOMER SUMMARY (v89) ───────────────────────────────────────
// Aggregates session hours by customer_name across ALL session types,
// including engagement-less Customer Testing. Sister report to Engagement
// Summary (which groups by engagement_name and misses engagement-less
// sessions) and Employee Summary (which fans out to every team member).
//
// Hours counted ONCE per session, attributed to one customer. Wall-clock
// effort, not multiplied by team size — that's what Employee Summary
// does. The spec is explicit about this distinction.
//
// Sortable: state lives in window._pjCustSort (column + direction). Click
// any sortable th to toggle. Initial sort is Total descending so the
// biggest-spend customers surface first.
window._pjCustSort = { col: 'total', dir: 'desc' };
// Cache of last-rendered aggregated rows so the CSV export reflects the
// current view without re-querying.
window._pjCustRowsCache = [];

async function renderPjCustomerSummary() {
  document.getElementById('pj-customer-loading').style.display = 'flex';
  document.getElementById('pj-customer-content').innerHTML = '';
  const year = (document.getElementById('pj-cust-year')||{}).value || 'all';

  // Paginated so unified_sessions > 1000 rows isn't silently truncated.
  const res = await fetchAllRows(function(){
    let q = sb.from('unified_sessions').select('*');
    if (year !== 'all') q = q.gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
    return q;
  });
  document.getElementById('pj-customer-loading').style.display = 'none';
  const rows = res.data || [];

  // Aggregate by customer_name. Rows with null/empty customer_name are
  // skipped entirely — these are Internal sessions that don't belong in
  // a customer-keyed report. They still appear in Employee Summary.
  const byCust = {};
  rows.forEach(function(r){
    const cust = (r.customer_name || '').trim();
    if (!cust) return;
    if (!byCust[cust]) {
      byCust[cust] = {
        customer:         cust,
        sessions:         0,
        total:            0,
        engagementIds:    {},   // distinct engagement_id (skipping nulls)
        project:          0,
        poc:              0,
        amc:              0,
        support:          0,
        presales:         0,
        customer_testing: 0,
        internal:         0,
        engagementHours:  {}    // engagement_name → total hours (for Top Engagement)
      };
    }
    const c = byCust[cust];
    const hrs = parseFloat(r.total_hours || 0);
    c.sessions += 1;
    c.total    += hrs;
    if (r.engagement_id) c.engagementIds[r.engagement_id] = 1;
    if (c[r.session_type] !== undefined) c[r.session_type] += hrs;
    if (r.engagement_name && r.engagement_name.trim()) {
      const e = r.engagement_name.trim();
      c.engagementHours[e] = (c.engagementHours[e] || 0) + hrs;
    }
  });

  // Drop zero-hour customers (none of their sessions ended up matching
  // the year filter). Compute per-row derived fields.
  let aggRows = Object.keys(byCust).map(function(k){
    const c = byCust[k];
    let topEng = '—';
    const engNames = Object.keys(c.engagementHours);
    if (engNames.length) {
      topEng = engNames.reduce(function(best, n){
        return (c.engagementHours[n] > c.engagementHours[best]) ? n : best;
      }, engNames[0]);
    }
    return {
      customer:    c.customer,
      sessions:    c.sessions,
      total:       c.total,
      engagements: Object.keys(c.engagementIds).length,
      project:     c.project,
      poc:         c.poc,
      amc:         c.amc,
      support:     c.support,
      presales:    c.presales,
      customer_testing: c.customer_testing,
      internal:    c.internal,
      top_engagement: topEng
    };
  }).filter(function(r){ return r.total > 0; });

  // Empty state
  if (!aggRows.length) {
    document.getElementById('pj-customer-content').innerHTML = renderEmptyState({
      icon: 'building-2',
      heading: 'No customer activity for '+(year==='all'?'all years':year),
      sub: 'Try a different year or check back once sessions are logged against customers.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Sort by current state
  aggRows = _pjCustApplySort(aggRows);
  window._pjCustRowsCache = aggRows;

  const tableRows = aggRows.map(function(r){
    return '<tr>'+
      '<td><strong>'+esc2(r.customer)+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+fmtCount(r.sessions)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:16px">'+fmtHours(r.total)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+fmtCount(r.engagements)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(r.project)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(r.poc)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(r.amc)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(r.support)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(r.presales)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(r.customer_testing)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(r.internal)+'</td>'+
      '<td style="font-size:12px;color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc2(r.top_engagement)+'">'+esc2(r.top_engagement)+'</td>'+
    '</tr>';
  }).join('');

  // Totals across all displayed customers
  const totals = aggRows.reduce(function(t, r){
    t.sessions += r.sessions;
    t.total    += r.total;
    t.engagements += r.engagements;
    ['project','poc','amc','support','presales','customer_testing','internal'].forEach(function(k){ t[k] += r[k]; });
    return t;
  }, { sessions:0, total:0, engagements:0, project:0, poc:0, amc:0, support:0, presales:0, customer_testing:0, internal:0 });

  function thSort(col, label) {
    const s = window._pjCustSort;
    const arrow = (s.col === col) ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return '<th class="pj-cust-sort-th" style="cursor:pointer;user-select:none;white-space:nowrap" onclick="pjCustToggleSort(\''+col+'\')">'+label+arrow+'</th>';
  }

  document.getElementById('pj-customer-content').innerHTML =
    '<div class="table-wrap"><table>'+
    '<thead><tr>'+
      thSort('customer',         'Customer')+
      thSort('sessions',         'Sessions')+
      thSort('total',            'Total')+
      thSort('engagements',      '# Engagements')+
      thSort('project',          '<span class="pj-th-ico"><i data-lucide="folder"></i>Project</span>')+
      thSort('poc',              '<span class="pj-th-ico"><i data-lucide="target"></i>POC</span>')+
      thSort('amc',              '<span class="pj-th-ico"><i data-lucide="wrench"></i>AMC</span>')+
      thSort('support',          '<span class="pj-th-ico"><i data-lucide="life-buoy"></i>Support</span>')+
      thSort('presales',         '<span class="pj-th-ico"><i data-lucide="briefcase"></i>Pre-Sales</span>')+
      thSort('customer_testing', '<span class="pj-th-ico"><i data-lucide="flask-conical"></i>Cust Test</span>')+
      thSort('internal',         '<span class="pj-th-ico"><i data-lucide="cog"></i>Internal</span>')+
      '<th>Top Engagement</th>'+
    '</tr></thead>'+
    '<tbody>'+tableRows+
      '<tr style="background:#f8fafc;font-weight:600">'+
        '<td>TOTAL ('+aggRows.length+' customer'+(aggRows.length===1?'':'s')+')</td>'+
        '<td style="font-family:DM Mono,monospace">'+fmtCount(totals.sessions)+'</td>'+
        '<td style="font-family:DM Mono,monospace;color:var(--navy);font-size:16px">'+fmtHours(totals.total)+'</td>'+
        '<td style="font-family:DM Mono,monospace">'+fmtCount(totals.engagements)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(totals.project)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(totals.poc)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(totals.amc)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(totals.support)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(totals.presales)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(totals.customer_testing)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtHours(totals.internal)+'</td>'+
        '<td>-</td>'+
      '</tr>'+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">'+
      'Year: '+(year==='all'?'All Years':year)+
      ' | # Engagements counts distinct engagement_id per customer (engagement-less sessions like Customer Testing don\'t add to this number).'+
      ' | Each session credits its customer ONCE — team size doesn\'t multiply hours here. For per-employee credit, see Employee Summary.'+
    '</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

// Sort the in-memory aggregated rows by the current _pjCustSort state.
// Customer + top_engagement are strings (locale-aware compare); everything
// else is numeric.
function _pjCustApplySort(rows) {
  const s = window._pjCustSort;
  const col = s.col, dir = s.dir;
  const isStr = (col === 'customer' || col === 'top_engagement');
  const arr = rows.slice();
  arr.sort(function(a, b){
    const av = a[col], bv = b[col];
    let cmp;
    if (isStr) cmp = String(av||'').localeCompare(String(bv||''));
    else       cmp = (Number(av)||0) - (Number(bv)||0);
    return dir === 'asc' ? cmp : -cmp;
  });
  return arr;
}

// Click handler for the th — toggle direction if clicking the active
// column, otherwise switch column with the type's natural default
// (descending for numeric, ascending for text — matches the rest of
// the codebase's table conventions).
function pjCustToggleSort(col) {
  const s = window._pjCustSort;
  if (s.col === col) {
    s.dir = (s.dir === 'asc') ? 'desc' : 'asc';
  } else {
    s.col = col;
    s.dir = (col === 'customer' || col === 'top_engagement') ? 'asc' : 'desc';
  }
  renderPjCustomerSummary();
}

// CSV export of the current view (post-filter, post-sort). File name
// includes today's date so multiple exports in one session are
// distinguishable by mtime + name.
function exportCustomerSummaryCsv() {
  const rows = window._pjCustRowsCache || [];
  if (!rows.length) { showToast('Nothing to export.'); return; }
  const headers = ['Customer','Sessions','Total Hours','Engagements','Project Hours','POC Hours','AMC Hours','Support Hours','Pre-Sales Hours','Cust Test Hours','Internal Hours','Top Engagement'];
  function csvCell(v) {
    const s = (v == null) ? '' : String(v);
    // Quote only when needed (contains , " or newline); double inner quotes.
    if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(function(r){
    lines.push([
      r.customer, r.sessions, r.total, r.engagements,
      r.project, r.poc, r.amc, r.support, r.presales,
      r.customer_testing, r.internal, r.top_engagement
    ].map(csvCell).join(','));
  });
  const csv = '﻿' + lines.join('\n');  // BOM so Excel opens it as UTF-8
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'customer-summary-' + new Date().toISOString().split('T')[0] + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  showToast('Customer Summary exported ✓');
}

// v126: shared CSV cell formatter — quotes only when needed.
function _pjCsvCell(v) {
  var s = (v == null) ? '' : String(v);
  if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function _pjDownloadCsv(lines, filename) {
  var csv = '﻿' + lines.join('\n');  // BOM so Excel opens it as UTF-8
  var blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

// v126: Engagement Summary export — matches the Customer Summary pattern.
// Pulls from window._pjEngRowsCache populated in renderEngagementSummary
// (unified-sessions.js), so the export reflects the current filter+sort.
function exportEngagementSummaryCsv() {
  var rows = window._pjEngRowsCache || [];
  if (!rows.length) { showToast('Nothing to export.'); return; }
  var headers = ['Engagement','Type','Customer','Sessions','Total Hours','Working Days','Team Breakdown'];
  var lines = [headers.map(_pjCsvCell).join(',')];
  rows.forEach(function(r){
    lines.push([
      r.engagement, r.type, r.customer, r.sessions,
      r.hours.toFixed(2), (r.days).toFixed(2), r.team
    ].map(_pjCsvCell).join(','));
  });
  _pjDownloadCsv(lines, 'engagement-summary-' + new Date().toISOString().split('T')[0] + '.csv');
  showToast('Engagement Summary exported ✓');
}

// v126: Employee Summary export — same shape.
function exportEmployeeSummaryCsv() {
  var rows = window._pjEmpRowsCache || [];
  if (!rows.length) { showToast('Nothing to export.'); return; }
  var headers = ['Employee','Sessions','Total Hours','Project','POC','AMC','Support','Pre-Sales','Customer Testing','Internal','Working Days','Engagements'];
  var lines = [headers.map(_pjCsvCell).join(',')];
  rows.forEach(function(r){
    lines.push([
      r.employee, r.sessions, r.total.toFixed(2),
      r.project.toFixed(2), r.poc.toFixed(2), r.amc.toFixed(2),
      r.support.toFixed(2), r.presales.toFixed(2),
      r.customer_testing.toFixed(2), r.internal.toFixed(2),
      r.days.toFixed(2), r.engagements
    ].map(_pjCsvCell).join(','));
  });
  _pjDownloadCsv(lines, 'employee-summary-' + new Date().toISOString().split('T')[0] + '.csv');
  showToast('Employee Summary exported ✓');
}

// ── PIE CHART HELPERS ────────────────────────────────────────────
// Short label for an employee. Returns "Ahmed" / "Salman" when the first
// name is unique across EMPLOYEES, and "Mohammed A." / "Mohammed N." when
// the first name collides (so the two Mohammeds don't both render as
// "Mohammed"). Falls back to the raw value for unknown / free-text names.
function empShortName(emp) {
  if (!emp) return '';
  var parts = String(emp).trim().split(/\s+/);
  var first = parts[0] || emp;
  var team = (typeof EMPLOYEES !== 'undefined' && EMPLOYEES) ? EMPLOYEES : [];
  var collide = team.some(function(e){ return e !== emp && (e||'').split(/\s+/)[0] === first; });
  if (collide && parts.length > 1) {
    return first + ' ' + parts[parts.length-1].charAt(0).toUpperCase() + '.';
  }
  return first;
}

function empColor(emp) {
  var colors = {
    'Ahmed Ali':      '#3B82F6',
    'Venkatesan':     '#0A1F5C',
    'Prasanth':       '#10B981',
    'Salman Aziz':    '#F59E0B',
    'Mohammed Afsal': '#8B5CF6',
    'Mohammed Nasif': '#00A0D2',
  };
  return colors[emp] || '#6B7280';
}

function buildPieChart(data, unit) {
  if (!data.length) return '<div style="text-align:center;color:var(--muted);padding:20px">No data</div>';
  var total = data.reduce(function(s,d){ return s+d.value; }, 0);
  if (total === 0) return '<div style="text-align:center;color:var(--muted);padding:20px">No data</div>';

  var cx=120, cy=120, r=100, html='';
  var startAngle = -Math.PI/2; // Start from top

  // SVG slices
  html += '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">';
  html += '<svg viewBox="0 0 240 240" style="width:200px;height:200px;flex-shrink:0">';

  data.forEach(function(d) {
    var slice = (d.value / total) * 2 * Math.PI;
    var endAngle = startAngle + slice;
    var x1 = cx + r * Math.cos(startAngle);
    var y1 = cy + r * Math.sin(startAngle);
    var x2 = cx + r * Math.cos(endAngle);
    var y2 = cy + r * Math.sin(endAngle);
    var largeArc = slice > Math.PI ? 1 : 0;

    if (data.length === 1) {
      // Full circle
      html += '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+d.color+'"/>';
    } else {
      html += '<path d="M'+cx+','+cy+' L'+x1.toFixed(2)+','+y1.toFixed(2)+
              ' A'+r+','+r+' 0 '+largeArc+',1 '+x2.toFixed(2)+','+y2.toFixed(2)+
              ' Z" fill="'+d.color+'" stroke="white" stroke-width="2"/>';
    }

    // Percentage label inside slice
    var midAngle = startAngle + slice/2;
    var lx = cx + (r*0.65) * Math.cos(midAngle);
    var ly = cy + (r*0.65) * Math.sin(midAngle);
    var pct = Math.round(d.value/total*100);
    if (pct >= 5) {
      html += '<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="11" font-weight="bold" font-family="DM Sans,Arial">'+pct+'%</text>';
    }
    startAngle = endAngle;
  });

  html += '</svg>';

  // Legend. v101: each row gets min-width:0 so the flex child's min-content
  // can be smaller than its (potentially unbreakable) label. word-break:
  // break-word ensures hyphenated names like "MASHREQ - DC/DR - UAE BRANCHES"
  // wrap on narrow screens instead of pushing the card past viewport.
  html += '<div style="display:flex;flex-direction:column;gap:8px;min-width:0">';
  data.forEach(function(d) {
    var pct = Math.round(d.value/total*100);
    html += '<div style="display:flex;align-items:center;gap:8px;min-width:0">'+
      '<div style="width:12px;height:12px;border-radius:3px;background:'+d.color+';flex-shrink:0"></div>'+
      '<div style="font-size:12px;min-width:0;word-break:break-word"><span style="font-weight:600">'+d.label+'</span> '+
      '<span style="color:var(--muted)">'+(unit==='h' ? fmtHours(d.value) : (fmtNumber(d.value,1)+(unit||'')))+' ('+pct+'%)</span></div>'+
      '</div>';
  });
  html += '</div></div>';
  return html;
}

// == ACTIVITY MATRIX (v109b) ======================================
// Manager-only Reports sub-tab. Hours per employee per activity_type
// with a date-range filter. Built on v109a-cleaned canonical data
// (16 activity_types). Model A crediting: every participant (logger +
// each name in team_members) gets the full session hours, deduped so
// the logger isn't double-counted when they also appear in team_members.
// Layout B: per-employee expandable rows; expanding shows the activity
// breakdown as scaled bars (longest activity = 100% of row width).
async function renderActivityMatrix() {
  if (!isManager) {
    document.getElementById('matrix-body').innerHTML =
      '<div style="color:var(--muted);font-size:13px">Manager access required.</div>';
    return;
  }
  var range = (document.getElementById('matrix-range')||{}).value || 'all';
  var loading = document.getElementById('matrix-loading');
  var body = document.getElementById('matrix-body');
  if (loading) loading.style.display = 'block';
  if (body) body.innerHTML = '';

  // Date bound for the chosen range. UTC math to stay consistent with
  // other dashboard date-window calcs (avoids month-boundary drift).
  var now = new Date(), fromISO = null;
  if (range === 'month')   fromISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0,10);
  if (range === 'quarter') { var q = Math.floor(now.getUTCMonth()/3)*3; fromISO = new Date(Date.UTC(now.getUTCFullYear(), q, 1)).toISOString().slice(0,10); }
  if (range === 'year')    fromISO = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0,10);

  var res = await fetchAllRows(function() {
    var q = sb.from('unified_sessions').select('employee,team_members,activity_type,total_hours,session_date');
    if (fromISO) q = q.gte('session_date', fromISO);
    return q;
  });
  var rows = (res && res.data) || [];

  // Model A fan-out: credit full hours to logger + each team member, deduped.
  // matrix[emp][activity] = hours ; totals per emp ; activity column set.
  var matrix = {}, empTotal = {}, actTotals = {};
  rows.forEach(function(r){
    var hrs = parseFloat(r.total_hours || 0);
    if (!hrs) return;
    var act = r.activity_type || 'Others';
    var people = (r.team_members || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    if (r.employee && people.indexOf(r.employee) === -1) people.push(r.employee);
    if (!people.length && r.employee) people = [r.employee];
    people.forEach(function(p){
      matrix[p] = matrix[p] || {};
      matrix[p][act] = (matrix[p][act] || 0) + hrs;
      empTotal[p] = (empTotal[p] || 0) + hrs;
      actTotals[act] = (actTotals[act] || 0) + hrs;
    });
  });

  if (loading) loading.style.display = 'none';

  // Employees to show: the canonical EMPLOYEES list (live), plus any name
  // that appears in data but isn't in EMPLOYEES (so nothing is hidden).
  var emps = (typeof EMPLOYEES !== 'undefined' && EMPLOYEES.length) ? EMPLOYEES.slice() : Object.keys(matrix);
  Object.keys(matrix).forEach(function(p){ if (emps.indexOf(p) === -1) emps.push(p); });
  // Sort employees by total hours desc; drop zero-hour rows.
  emps = emps.filter(function(e){ return empTotal[e]; }).sort(function(a,b){ return (empTotal[b]||0)-(empTotal[a]||0); });

  if (!emps.length) { body.innerHTML = '<div style="color:var(--muted);font-size:13px">No sessions in this range.</div>'; return; }

  // Layout B: per-employee expandable rows. Each row = name + total hours +
  // a chevron; expanding shows that employee's activity breakdown (desc).
  var html = '';
  emps.forEach(function(e, idx){
    var label = (typeof empShortName === 'function') ? empShortName(e) : e;
    var acts = matrix[e] || {};
    var sorted = Object.keys(acts).sort(function(a,b){ return acts[b]-acts[a]; });
    var rowId = 'matrix-emp-'+idx;
    html += '<div class="matrix-emp-row" onclick="var x=document.getElementById(\''+rowId+'\');x.style.display=x.style.display===\'none\'?\'block\':\'none\'" '+
      'style="cursor:pointer;padding:12px 14px;border:1px solid var(--border,#E5E7EB);border-radius:8px;margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<strong>'+esc2(label)+'</strong>'+
        '<span style="font-family:DM Mono,monospace;color:var(--teal);font-weight:700">'+(empTotal[e]||0).toFixed(1)+'h</span>'+
      '</div>'+
      '<div id="'+rowId+'" style="display:none;margin-top:10px">';
    // Bars, scaled to the employee's own max
    var max = sorted.length ? acts[sorted[0]] : 1;
    sorted.forEach(function(a){
      var pct = Math.round((acts[a]/max)*100);
      html += '<div style="display:flex;align-items:center;gap:10px;margin:4px 0">'+
        '<span style="flex:0 0 180px;font-size:12px">'+esc2(a)+'</span>'+
        '<span style="flex:1;background:#f0f4ff;border-radius:4px;height:14px;position:relative">'+
          '<span style="position:absolute;left:0;top:0;bottom:0;width:'+pct+'%;background:var(--teal);border-radius:4px"></span>'+
        '</span>'+
        '<span style="flex:0 0 56px;text-align:right;font-family:DM Mono,monospace;font-size:12px">'+acts[a].toFixed(1)+'h</span>'+
      '</div>';
    });
    html += '</div></div>';
  });
  body.innerHTML = html;
}


function showProjectTab(tab) {
  // Backward-compat: redirect the old per-type summaries to the unified
  // Engagement Summary, pre-selecting the type.
  var typePreset = null;
  if (tab==='project' || tab==='poc' || tab==='amc' || tab==='support' || tab==='presales') {
    typePreset = tab; tab = 'engagement';
  }
  ['uslog','ussess','otsessions','otsummary','engagement','customer','employee','matrix','otpolicy','otmanager','custmgr','manage','vendors'].forEach(function(t) {
    const el  = document.getElementById('pjtab-'+t);
    const sub = document.getElementById('pjsub-'+t);
    if (!el) return;
    el.style.display = t===tab ? 'block' : 'none';
    if (!sub) return;
    if (t==='otmanager' && !isManager) { sub.style.display='none'; return; }
    if (t===tab) {
      sub.classList.add('active');
      sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';
    } else {
      sub.classList.remove('active');
      sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';
    }
  });
  if (tab==='uslog')      { initProjectTab(); initUSLogForm(); }
  if (tab==='ussess')     { initProjectTab(); populateUSFilters(); renderUSSessions(); }
  if (tab==='otsessions') { renderSessions(); }
  if (tab==='otsummary')  { buildSummaryFilters(); }
  if (tab==='engagement') {
    initProjectTab();
    if (typePreset) {
      var typeEl = document.getElementById('pj-eng-type');
      if (typeEl) typeEl.value = typePreset;
    }
    renderEngagementSummary();
  }
  if (tab==='customer')   { initProjectTab(); renderPjCustomerSummary(); }
  if (tab==='employee')   { initProjectTab(); renderPjEmployeeSummary(); }
  if (tab==='matrix')     { renderActivityMatrix(); }
  // v102: OT summary moved to Leave → Team Overview. otmanager tab now
  // only carries Reports & Backup + admin tools (Recompute/Archive/Purge),
  // so no per-render data fetch is needed — just refresh the backup pill.
  if (tab==='otmanager')  { if (typeof renderLastBackupPill === 'function') renderLastBackupPill(); }
  if (tab==='custmgr')    { populateProjectDropdowns(); renderCustomersTable(); }
  if (tab==='manage')     { populateProjectDropdowns(); renderManageProjects(); }
  if (tab==='vendors')    { renderVendorsManage(); }
  setSidebarSubActive('projects', tab);
}

// ── MANAGE VENDORS & PRODUCT LINES (manager-only) ────────────────
// Left column lists vendors with a + Add Vendor button. Selecting a vendor
// expands its product lines on the right with a + Add Product Line button.
// Disable instead of delete to preserve historical references on engagements.
var _vendorActiveId = null;

async function renderVendorsManage() {
  // Load skills if not cached so the "X skilled" badge appears on
  // first visit. Cheap (a few rows max), idempotent — no-op when cached.
  if (typeof ensureSkillsLoaded === 'function') await ensureSkillsLoaded();
  if (!isManager) {
    document.getElementById('pj-vendors-content').innerHTML = renderEmptyState({
      icon: 'lock',
      heading: 'Managers only',
      sub: 'The vendor / product-line catalog is editable by managers. Ask Venkat if a vendor needs to be added.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  // Always pull fresh — the local cache is dropdown-only and won't reflect
  // edits made in this session until loadProjects() fires again.
  var [vRes, plRes] = await Promise.all([
    sb.from('vendors').select('id,name,display_order,is_active').order('display_order').order('name'),
    sb.from('product_lines').select('id,vendor_id,name,display_order,is_active,is_gulfit_relevant').order('display_order').order('name')
  ]);
  if (vRes.error)  { showError('Could not load vendors: ' + vRes.error.message); return; }
  if (plRes.error) { showError('Could not load product lines: ' + plRes.error.message); return; }
  VENDORS = vRes.data || [];
  PRODUCT_LINES = plRes.data || [];

  // Persist selection across refreshes; fall back to first vendor on first load.
  if (_vendorActiveId == null && VENDORS.length) _vendorActiveId = VENDORS[0].id;

  // Product line counts per vendor for the badge on each row. Excludes the
  // per-vendor "Other (specify)" placeholder from the count — it's an
  // implementation detail, not a real line.
  var lineCountByVendor = {};
  (PRODUCT_LINES||[]).forEach(function(p){
    if (p.name === 'Other (specify)') return;
    lineCountByVendor[p.vendor_id] = (lineCountByVendor[p.vendor_id]||0) + 1;
  });
  var activeVendorCount = (VENDORS||[]).filter(function(v){ return v.is_active; }).length;
  var realLineCount = (PRODUCT_LINES||[]).filter(function(p){ return p.is_active && p.name !== 'Other (specify)'; }).length;

  var vendorList = VENDORS.map(function(v){
    var active = (v.id === _vendorActiveId);
    var count = lineCountByVendor[v.id] || 0;
    var disabledCls = v.is_active ? '' : ' vendor-row-disabled';
    var disabledBadge = v.is_active ? '' :
      '<span class="vendor-pill vendor-pill-muted">disabled</span>';
    return '<div class="vendor-row'+(active?' vendor-row-active':'')+disabledCls+'" onclick="selectVendor('+v.id+')">'+
      '<i data-lucide="package" class="vendor-row-icon"></i>'+
      '<div class="vendor-row-main">'+
        '<div class="vendor-row-name">'+esc2(v.name)+disabledBadge+'</div>'+
        '<div class="vendor-row-sub">'+fmtCount(count)+' product line'+(count===1?'':'s')+'</div>'+
      '</div>'+
      '<div class="vendor-row-actions">'+
        '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="event.stopPropagation();renameVendorPrompt('+v.id+')" title="Rename"><i data-lucide="pencil"></i></button>'+
        '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="event.stopPropagation();toggleVendorActive('+v.id+')" title="'+(v.is_active?'Disable':'Re-enable')+'"><i data-lucide="'+(v.is_active?'eye-off':'eye')+'"></i></button>'+
        '<button class="btn btn-sm btn-danger btn-icon-only" onclick="event.stopPropagation();deleteVendorPrompt('+v.id+')" title="Delete"><i data-lucide="trash-2"></i></button>'+
      '</div>'+
    '</div>';
  }).join('');

  var activeVendor = VENDORS.find(function(v){ return v.id === _vendorActiveId; });
  var rightPanel = '';
  if (!activeVendor) {
    rightPanel = renderEmptyState({
      icon: 'package',
      heading: 'No vendor selected',
      sub: 'Pick a vendor on the left to see and edit its product lines.'
    });
  } else {
    // Sort so real product lines come before "Other (specify)" (display_order
    // 999), then disabled lines drop to the bottom within each group.
    var lines = PRODUCT_LINES
      .filter(function(p){ return p.vendor_id === activeVendor.id; })
      .slice()
      .sort(function(a,b){
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (a.display_order||0) - (b.display_order||0);
      });
    var lineRows = lines.length ? lines.map(function(p){
      var isOther = (p.name === 'Other (specify)');
      var disabledCls = p.is_active ? '' : ' vendor-row-disabled';
      var disabledBadge = p.is_active ? '' :
        '<span class="vendor-pill vendor-pill-muted">disabled</span>';
      var otherBadge = isOther ? '<span class="vendor-pill vendor-pill-fallback" title="Free-text fallback for engagements outside the predefined list">fallback</span>' : '';
      // The auto-seeded "Other (specify)" entry isn't editable — users can't
      // rename or disable it (would break the engagement form's fallback).
      var actions = isOther ? '<span class="vendor-row-locked"><i data-lucide="lock"></i></span>' :
        '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="renameProductLinePrompt('+p.id+')" title="Rename"><i data-lucide="pencil"></i></button>'+
        '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="toggleProductLineActive('+p.id+')" title="'+(p.is_active?'Disable':'Re-enable')+'"><i data-lucide="'+(p.is_active?'eye-off':'eye')+'"></i></button>'+
        '<button class="btn btn-sm btn-danger btn-icon-only" onclick="deleteProductLinePrompt('+p.id+')" title="Delete"><i data-lucide="trash-2"></i></button>';
      var skillBadge = (typeof renderSkillCountBadge === 'function') ? renderSkillCountBadge(p.id) : '';
      return '<div class="vendor-row'+disabledCls+(isOther?' vendor-row-fallback':'')+'">'+
        '<i data-lucide="layers" class="vendor-row-icon"></i>'+
        '<div class="vendor-row-main">'+
          '<div class="vendor-row-name">'+esc2(p.name)+disabledBadge+otherBadge+(skillBadge?' '+skillBadge:'')+'</div>'+
        '</div>'+
        '<div class="vendor-row-actions">'+actions+'</div>'+
      '</div>';
    }).join('') : '<div class="vendor-list-empty">No product lines yet — add the first one below.</div>';

    var inactiveBadge = activeVendor.is_active ? '' :
      '<span class="vendor-pill vendor-pill-muted" style="margin-left:8px">disabled</span>';

    rightPanel =
      '<div class="vendor-panel-head">'+
        '<div class="vendor-panel-title">'+esc2(activeVendor.name)+inactiveBadge+'</div>'+
        '<button class="btn btn-sm btn-primary" onclick="addProductLinePrompt('+activeVendor.id+')"><i data-lucide="plus" class="btn-icon"></i>Add Product Line</button>'+
      '</div>'+
      '<div class="vendor-list">'+lineRows+'</div>';
  }

  document.getElementById('pj-vendors-content').innerHTML =
    '<div class="vendor-stats">'+
      '<div class="vendor-stat"><div class="vendor-stat-num">'+fmtCount(activeVendorCount)+'</div><div class="vendor-stat-label">Active Vendors</div></div>'+
      '<div class="vendor-stat"><div class="vendor-stat-num">'+fmtCount(realLineCount)+'</div><div class="vendor-stat-label">Active Product Lines</div></div>'+
      '<div class="vendor-stat"><div class="vendor-stat-num">'+fmtCount((VENDORS||[]).length - activeVendorCount)+'</div><div class="vendor-stat-label">Disabled</div></div>'+
    '</div>'+
    '<div class="vendor-mgmt-grid">'+
      '<div class="vendor-panel">'+
        '<div class="vendor-panel-head">'+
          '<div class="vendor-panel-title">Vendors</div>'+
          '<button class="btn btn-sm btn-primary" onclick="addVendorPrompt()"><i data-lucide="plus" class="btn-icon"></i>Add Vendor</button>'+
        '</div>'+
        '<div class="vendor-list">'+vendorList+'</div>'+
      '</div>'+
      '<div class="vendor-panel">'+rightPanel+'</div>'+
    '</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function selectVendor(id) {
  _vendorActiveId = id;
  renderVendorsManage();
}

async function addVendorPrompt() {
  if (!await requireAuth()) return;
  var name = await promptInput({
    title: 'Add Vendor',
    label: 'Vendor name',
    placeholder: 'e.g. Check Point',
    confirmText: 'Add Vendor',
    validate: function(v){
      var dup = (VENDORS||[]).some(function(x){ return x.name.toLowerCase() === v.toLowerCase(); });
      return dup ? 'A vendor named "'+v+'" already exists.' : null;
    }
  });
  if (!name) return;
  // Slot the new vendor after the existing entries.
  var maxOrder = (VENDORS||[]).reduce(function(m,v){ return Math.max(m, v.display_order||0); }, 0);
  var {data, error} = await sb.from('vendors').insert({ name: name, display_order: maxOrder + 10 }).select().single();
  if (error) { showError('Could not add vendor: ' + error.message); return; }
  // Seed the per-vendor "Other (specify)" entry so the new vendor immediately
  // works with the engagement form's fallback.
  await sb.from('product_lines').insert({ vendor_id: data.id, name: 'Other (specify)', display_order: 999 });
  _vendorActiveId = data.id;
  showToast('Vendor added ✓');
  await loadProjects();
  renderVendorsManage();
}

async function renameVendorPrompt(id) {
  if (!await requireAuth()) return;
  var v = (VENDORS||[]).find(function(x){ return x.id === id; });
  if (!v) return;
  var newName = await promptInput({
    title: 'Rename Vendor',
    label: 'Vendor name',
    defaultValue: v.name,
    confirmText: 'Save',
    validate: function(val){
      if (val === v.name) return null; // no-op = no validation error
      var dup = (VENDORS||[]).some(function(x){ return x.id !== id && x.name.toLowerCase() === val.toLowerCase(); });
      return dup ? 'A vendor named "'+val+'" already exists.' : null;
    }
  });
  if (!newName || newName === v.name) return;
  var {error} = await sb.from('vendors').update({ name: newName }).eq('id', id);
  if (error) { showError('Could not rename: ' + error.message); return; }
  // Cascade: rename the vendor text on every engagement that references it
  // (snapshot pattern — engagements.vendor is plain text, not FK).
  await sb.from('engagements').update({ vendor: newName }).eq('vendor', v.name);
  showToast('Vendor renamed ✓');
  await loadProjects();
  renderVendorsManage();
}

async function toggleVendorActive(id) {
  if (!await requireAuth()) return;
  var v = (VENDORS||[]).find(function(x){ return x.id === id; });
  if (!v) return;
  var {error} = await sb.from('vendors').update({ is_active: !v.is_active }).eq('id', id);
  if (error) { showError('Could not toggle: ' + error.message); return; }
  showToast(v.is_active ? 'Vendor disabled ✓' : 'Vendor re-enabled ✓');
  await loadProjects();
  renderVendorsManage();
}

// Hard delete a vendor — only allowed when nothing references it.
// References checked:
//   - product_lines under this vendor (excluding the auto-seeded
//     "Other (specify)" placeholder, which we own and clean up here)
//   - engagements.vendor text match (no FK column on engagements)
//   - employee_skills via FK on product_lines.id (defense in depth —
//     the placeholder itself shouldn't carry skills because the skills
//     modal hides "Other (specify)" from its dropdown, but guard anyway)
async function deleteVendorPrompt(id) {
  if (!await requireAuth()) return;
  var v = (VENDORS||[]).find(function(x){ return x.id === id; });
  if (!v) return;

  // Local: count real (non-placeholder) product lines under this vendor.
  var realLines = (PRODUCT_LINES||[]).filter(function(p){
    return p.vendor_id === id && (p.name||'').toLowerCase() !== 'other (specify)';
  });

  // Server: engagement snapshots + total skill rows under ANY line owned
  // by this vendor (so the placeholder doesn't sneak past).
  var allLineIds = (PRODUCT_LINES||[]).filter(function(p){ return p.vendor_id === id; }).map(function(p){ return p.id; });
  var engPromise = sb.from('engagements').select('id', { count:'exact', head:true }).eq('vendor', v.name);
  var skillPromise = allLineIds.length
    ? sb.from('employee_skills').select('id', { count:'exact', head:true }).in('product_line_id', allLineIds)
    : Promise.resolve({ count: 0 });
  var [engRes, skillRes] = await Promise.all([engPromise, skillPromise]);
  if (engRes && engRes.error)    { showError('Reference check failed: '+engRes.error.message); return; }
  if (skillRes && skillRes.error){ showError('Reference check failed: '+skillRes.error.message); return; }
  var lineCount  = realLines.length;
  var engCount   = engRes && engRes.count   ? engRes.count   : 0;
  var skillCount = skillRes && skillRes.count ? skillRes.count : 0;

  if (lineCount > 0 || engCount > 0 || skillCount > 0) {
    var parts = [];
    if (lineCount > 0)  parts.push(lineCount  + ' product line'  + (lineCount===1?'':'s'));
    if (engCount > 0)   parts.push(engCount   + ' engagement'    + (engCount===1?'':'s'));
    if (skillCount > 0) parts.push(skillCount + ' skill record'  + (skillCount===1?'':'s'));
    await confirmAction({
      title: 'Can’t delete "'+v.name+'" yet',
      body:  'This vendor is referenced by '+parts.join(' and ')+'.\n\nRemove or reassign those first, or use Disable to keep the vendor but hide it from new forms.',
      confirmText: 'OK',
      danger: false
    });
    return;
  }

  if (!await confirmAction({
    title: 'Delete vendor "'+v.name+'"?',
    body:  'No products, engagements, or skill records reference this vendor — safe to remove.\n\nThe "Other (specify)" placeholder line under this vendor will also be removed.\n\nThis cannot be undone.',
    requireTyping: v.name,
    confirmText: 'Delete vendor'
  })) return;

  // Drop the auto-seeded "Other (specify)" placeholder line(s) first so
  // the FK on product_lines.vendor_id doesn't block the vendor delete.
  // If the placeholder doesn't exist (legacy vendor, or hand-cleaned),
  // this is a no-op.
  var delLines = await sb.from('product_lines').delete().eq('vendor_id', id);
  if (delLines.error) { showError('Could not remove vendor placeholder line: '+delLines.error.message); return; }

  var {error} = await sb.from('vendors').delete().eq('id', id);
  if (error) { showError('Delete failed: '+error.message); return; }

  // Reset the active-vendor pointer if it was pointing at the row we
  // just removed, otherwise the right panel renders empty.
  if (typeof _vendorActiveId !== 'undefined' && _vendorActiveId === id) {
    _vendorActiveId = null;
  }
  showToast('Vendor deleted ✓');
  await loadProjects();
  renderVendorsManage();
}

async function addProductLinePrompt(vendorId) {
  if (!await requireAuth()) return;
  var v = (VENDORS||[]).find(function(x){ return x.id === vendorId; });
  var name = await promptInput({
    title: 'Add Product Line',
    body: v ? 'Under ' + v.name : '',
    label: 'Product line name',
    placeholder: 'e.g. FortiSASE',
    confirmText: 'Add Product Line',
    validate: function(val){
      var dup = (PRODUCT_LINES||[]).some(function(p){ return p.vendor_id === vendorId && p.name.toLowerCase() === val.toLowerCase(); });
      return dup ? 'This product line already exists under '+(v?v.name:'this vendor')+'.' : null;
    }
  });
  if (!name) return;
  var existing = (PRODUCT_LINES||[]).filter(function(p){ return p.vendor_id === vendorId; });
  var maxOrder = existing.reduce(function(m,p){
    // Skip "Other (specify)" at 999 when computing the next slot.
    return p.display_order < 999 ? Math.max(m, p.display_order||0) : m;
  }, 0);
  var newOrder = Math.min(maxOrder + 10, 990);
  var {error} = await sb.from('product_lines').insert({ vendor_id: vendorId, name: name, display_order: newOrder });
  if (error) { showError('Could not add product line: ' + error.message); return; }
  showToast('Product line added ✓');
  await loadProjects();
  renderVendorsManage();
}

async function renameProductLinePrompt(id) {
  if (!await requireAuth()) return;
  var p = (PRODUCT_LINES||[]).find(function(x){ return x.id === id; });
  if (!p) return;
  var v = (VENDORS||[]).find(function(x){ return x.id === p.vendor_id; });
  var newName = await promptInput({
    title: 'Rename Product Line',
    body: v ? 'Under ' + v.name : '',
    label: 'Product line name',
    defaultValue: p.name,
    confirmText: 'Save',
    validate: function(val){
      if (val === p.name) return null;
      var dup = (PRODUCT_LINES||[]).some(function(x){ return x.id !== id && x.vendor_id === p.vendor_id && x.name.toLowerCase() === val.toLowerCase(); });
      return dup ? 'This product line already exists under '+(v?v.name:'this vendor')+'.' : null;
    }
  });
  if (!newName || newName === p.name) return;
  var {error} = await sb.from('product_lines').update({ name: newName }).eq('id', id);
  if (error) { showError('Could not rename: ' + error.message); return; }
  // Cascade snapshot text on engagements that reference this line under this vendor.
  if (v) {
    await sb.from('engagements').update({ product_line: newName })
      .eq('vendor', v.name).eq('product_line', p.name);
  }
  showToast('Product line renamed ✓');
  await loadProjects();
  renderVendorsManage();
}

async function toggleProductLineActive(id) {
  if (!await requireAuth()) return;
  var p = (PRODUCT_LINES||[]).find(function(x){ return x.id === id; });
  if (!p) return;
  var {error} = await sb.from('product_lines').update({ is_active: !p.is_active }).eq('id', id);
  if (error) { showError('Could not toggle: ' + error.message); return; }
  showToast(p.is_active ? 'Product line disabled ✓' : 'Product line re-enabled ✓');
  await loadProjects();
  renderVendorsManage();
}

// Hard delete with two-pronged reference protection:
//   1. engagements.vendor + engagements.product_line are text snapshots
//      (not FK columns), so the check is a count on the matching pair.
//   2. employee_skills.product_line_id IS an FK with ON DELETE RESTRICT,
//      so an UI bypass still fails at the DB. We pre-check here so the
//      manager gets a friendly message instead of a Postgres constraint
//      error.
// Toggle-disable stays available as a safer alternative; this is only
// for genuinely unused product lines that should disappear.
async function deleteProductLinePrompt(id) {
  if (!await requireAuth()) return;
  var p = (PRODUCT_LINES||[]).find(function(x){ return x.id === id; });
  if (!p) return;
  var v = (VENDORS||[]).find(function(x){ return x.id === p.vendor_id; });
  // Count engagements that snapshot this exact (vendor, product_line) pair.
  var engPromise = v
    ? sb.from('engagements').select('id', { count:'exact', head:true }).eq('vendor', v.name).eq('product_line', p.name)
    : Promise.resolve({ count:0 });
  // Count skill rows referencing this line by FK.
  var skillPromise = sb.from('employee_skills').select('id', { count:'exact', head:true }).eq('product_line_id', id);
  var [engRes, skillRes] = await Promise.all([engPromise, skillPromise]);
  if (engRes && engRes.error)   { showError('Reference check failed: '+engRes.error.message); return; }
  if (skillRes && skillRes.error){ showError('Reference check failed: '+skillRes.error.message); return; }
  var engCount   = engRes && engRes.count   ? engRes.count   : 0;
  var skillCount = skillRes && skillRes.count ? skillRes.count : 0;
  if (engCount > 0 || skillCount > 0) {
    var parts = [];
    if (engCount > 0)   parts.push(engCount   + ' engagement' + (engCount===1?'':'s'));
    if (skillCount > 0) parts.push(skillCount + ' skill record' + (skillCount===1?'':'s'));
    await confirmAction({
      title: 'Can’t delete "'+p.name+'" yet',
      body:  'This product line is referenced by '+parts.join(' and ')+'.\n\nRemove those references first, or use Disable to keep the line but hide it from new forms.',
      confirmText: 'OK',
      danger: false
    });
    return;
  }
  if (!await confirmAction({
    title: 'Delete product line "'+p.name+'"?',
    body:  'No engagements or skill records reference this line — safe to remove.\n\nThis cannot be undone.',
    requireTyping: p.name,
    confirmText: 'Delete product line'
  })) return;
  var {error} = await sb.from('product_lines').delete().eq('id', id);
  if (error) { showError('Delete failed: '+error.message); return; }
  showToast('Product line deleted ✓');
  await loadProjects();
  renderVendorsManage();
}

