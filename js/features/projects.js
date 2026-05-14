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
    sb.from('product_lines').select('id,vendor_id,name,display_order,is_active').order('display_order').order('name')
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

// ── ADD ENGAGEMENT (Project / POC / AMC) ────────────────────────
async function addEngagement() {
  const customer = document.getElementById('pj-new-customer').value;
  const type     = document.getElementById('pj-new-type').value;
  const name     = (document.getElementById('pj-new-name').value||'').trim().toUpperCase();
  const status   = document.getElementById('pj-new-status').value;
  var errEl = document.getElementById('pj-manage-error');

  if (!customer) { errEl.textContent = '⚠️ Please select a customer.';            showAlert('pj-manage-error'); return; }
  if (!type)     { errEl.textContent = '⚠️ Please select an engagement type.';    showAlert('pj-manage-error'); return; }
  if (!name)     { errEl.textContent = '⚠️ Please enter an engagement name.';     showAlert('pj-manage-error'); return; }

  var custRow = CUSTOMERS.find(function(c){ return c.name === customer; });
  var customer_id = custRow ? custRow.id : null;

  // Duplicate within (customer, name, type)
  var dup = ENGAGEMENTS.some(function(e){
    return e.customer_id === customer_id && e.name === name && e.type === type;
  });
  if (dup) {
    errEl.textContent = '⚠️ A '+type.toUpperCase()+' engagement named "'+name+'" already exists for this customer.';
    showAlert('pj-manage-error'); return;
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
  if (!vendorVal) { errEl.textContent = '⚠️ Please select a vendor.';        showAlert('pj-manage-error'); return; }
  if (!plVal)     { errEl.textContent = '⚠️ Please select a product line.'; showAlert('pj-manage-error'); return; }

  const {error} = await sb.from('engagements').insert({
    customer_id:  customer_id,
    name:         name,
    type:         type,
    status:       status,
    vendor:       vendorVal,
    product_line: plVal,
    created_by:   currentUser
  });
  if (error) { showError('Error: '+error.message); return; }

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

  document.getElementById('pj-new-name').value = '';
  document.getElementById('pj-new-status').value = 'active';
  document.getElementById('pj-new-customer').value = '';
  document.getElementById('pj-new-type').value = '';
  // Reset vendor/product-line + their Other inputs
  if (vendorSel) vendorSel.value = '';
  if (plSel) { plSel.value = ''; plSel.disabled = true; plSel.innerHTML = '<option value="">-- Select Vendor first --</option>'; }
  ['pj-new-vendor-other','pj-new-product-line-other'].forEach(function(id){
    var el = document.getElementById(id); if (el) { el.value = ''; el.style.display = 'none'; }
  });
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

// ─── MANAGE CUSTOMERS TABLE ──────────────────────────────────────
// Searchable + sortable table inside Sessions → Manage. Replaces the old
// chip wall. Edit reuses the existing edit-customer modal; Delete blocks
// when engagement_count > 0.
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

  // Engagement counts per customer (shown in the table + used by sort + delete-guard).
  var counts = {};
  (ENGAGEMENTS||[]).forEach(function(e){ counts[e.customer_id] = (counts[e.customer_id]||0) + 1; });

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

  var rows = filtered.map(function(c){
    var n = counts[c.id] || 0;
    var safeName = (c.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<tr>'+
      '<td><strong style="color:var(--navy)">'+esc2(c.name)+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;color:'+(n?'var(--navy)':'var(--muted)')+'">'+fmtCount(n)+'</td>'+
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
  // Refusal path: delete is BLOCKED when the customer still has engagements.
  // The old chip-wall flow cascade-deleted everything; the new Manage Customers
  // table is intentionally stricter — managers must reassign or remove the
  // child engagements first. This keeps accidental data loss off the table.
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
async function renderManageProjects() {
  document.getElementById('pj-manage-loading').style.display = 'flex';
  document.getElementById('pj-manage-content').innerHTML = '';
  const statusFilter = document.getElementById('pj-manage-filter').value;
  const typeFilter   = (document.getElementById('pj-manage-type-filter')||{}).value || '';

  let q = sb.from('engagements').select('*').order('type').order('name');
  if (statusFilter) q = q.eq('status', statusFilter);
  if (typeFilter)   q = q.eq('type',   typeFilter);
  const {data} = await q;
  document.getElementById('pj-manage-loading').style.display = 'none';

  const rows = data || [];
  if (!rows.length) {
    document.getElementById('pj-manage-content').innerHTML = renderEmptyState({
      icon: 'folder-open',
      heading: 'No engagements found',
      sub: 'Adjust the filters above, or create a new engagement.'
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
    'completed':       {bg:'#E0F2FE',color:'#075985',icon:'check-circle-2', label:'Completed'},
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

  var custById = {}; (CUSTOMERS||[]).forEach(function(c){ custById[c.id] = c.name; });

  document.getElementById('pj-manage-content').innerHTML =
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>#</th><th>Customer</th><th>Type</th><th>Engagement Name</th><th>Status</th><th>Actions</th></tr></thead>'+
    '<tbody>'+
    rows.map(function(p,i){
      var sc = STATUS_COLORS[p.status] || STATUS_COLORS['active'];
      var tb = TYPE_BADGES[p.type] || {bg:'#F3F4F6',color:'#6B7280',label:(p.type||'-').toUpperCase()};
      var custName = custById[p.customer_id] || PROJECT_CUSTOMER[p.name] || '-';
      return '<tr>'+
        '<td style="color:var(--muted);font-size:12px">'+(i+1)+'</td>'+
        '<td style="font-size:13px;color:var(--navy);font-weight:600">'+custName+'</td>'+
        '<td><span style="background:'+tb.bg+';color:'+tb.color+';padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600">'+tb.label+'</span></td>'+
        '<td><strong>'+p.name+'</strong></td>'+
        '<td><span class="pj-status-badge" style="background:'+sc.bg+';color:'+sc.color+'"><i data-lucide="'+sc.icon+'"></i>'+sc.label+'</span></td>'+
        '<td style="white-space:nowrap">'+
          '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="openEditProject('+p.id+')" title="Edit" style="margin-right:4px"><i data-lucide="pencil"></i></button>'+
          '<button class="btn btn-sm btn-danger btn-icon-only" onclick="deleteProject('+p.id+',\''+ (p.name||'').replace(/'/g,"\\'") +'\')" title="Delete"><i data-lucide="trash-2"></i></button>'+
        '</td>'+
        '</tr>';
    }).join('')+
    '</tbody></table></div>';
  if (typeof renderIcons === 'function') renderIcons();
}

// ── EDIT PROJECT (manager) ────────────────────────────────────────
async function openEditProject(id) {
  var {data, error} = await sb.from('engagements').select('*').eq('id', id).single();
  if (error || !data) { showError('Could not load engagement.'); return; }
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
  document.getElementById('edit-project-modal').classList.add('show');
}

function closeEditProjectModal() {
  document.getElementById('edit-project-modal').classList.remove('show');
}

async function saveEditProject() {
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

  var {error} = await sb.from('engagements').update({
    name: name, status: status, customer_id: customer_id, type: type,
    vendor:       vendorVal || null,
    product_line: plVal     || null
  }).eq('id', id);
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
  }

  closeEditProjectModal();
  showToast('Engagement updated ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

async function deleteProject(id, name) {
  if (!await confirmAction({
    title: 'Delete engagement "'+name+'"?',
    body: 'This only removes it from the Projects registry. Existing OT/Project sessions that referenced it remain unchanged (they keep their snapshot text).\n\nThis cannot be undone.',
    requireTyping: name,
    confirmText: 'Delete engagement'
  })) return;
  var {error} = await sb.from('engagements').delete().eq('id', id);
  if (error) { showError('Error: '+error.message); return; }
  showToast('Engagement deleted ✓');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

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

const ACTIVITY_TYPES = [
  'HLD Discussion','HLD Documentation','LLD Discussion','LLD Documentation',
  'Pilot Sites Rollout','As-Built Documentation','KT / Training','Migration',
  'Troubleshooting','Initial Configuration'
];

const DEVICE_MODELS = ['EC-XS','EC-SP','EC-M','EC-10104','EC-10106'];

function fillActivitySelect(selectId) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  el.innerHTML = '<option value="">-- Select --</option>'
    + ACTIVITY_TYPES.map(function(a){ return '<option>'+a+'</option>'; }).join('');
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
  ['pj-eng-year','pj-emp-year'].forEach(function(id) {
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
    empData[e] = { total:0, sessions:0, project:0, poc:0, amc:0, support:0, presales:0, internal:0, engagements:{} };
  });

  rows.forEach(function(r) {
    var hrs = parseFloat(r.total_hours || 0);
    // Credit every team member (not just the logger). Internal sessions
    // have no team_members → credit just the logger. For Project/POC/AMC,
    // match each comma-separated name against the EMPLOYEES list (exact
    // or first-name). Fall back to the logger if no name matched.
    var participants = [];
    if (!r.team_members || r.session_type === 'internal') {
      if (r.employee) participants.push(r.employee);
    } else {
      var names = r.team_members.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
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
      '<th><span class="pj-th-ico"><i data-lucide="cog"></i>Internal</span></th>'+
      '<th>Working Days</th><th>Top Engagements</th></tr></thead>'+
    '<tbody>'+tableRows+
    '<tr style="background:#f8fafc;font-weight:600"><td>TOTAL</td><td>-</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--navy);font-size:16px">'+fmtHours(totalHours)+'</td>'+
    '<td colspan="6">-</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--muted)">'+fmtDays(totalHours/8)+'</td><td>-</td></tr>'+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Year: '+(year==='all'?'All Years':year)+' | Working days = hours / 8 | Hours are credited to every team member on a session (so a 4h session with 3 members shows 4h on each row, summing to 12h in TOTAL).</div>';
  if (typeof renderIcons === 'function') renderIcons();
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

  // Legend
  html += '<div style="display:flex;flex-direction:column;gap:8px">';
  data.forEach(function(d) {
    var pct = Math.round(d.value/total*100);
    html += '<div style="display:flex;align-items:center;gap:8px">'+
      '<div style="width:12px;height:12px;border-radius:3px;background:'+d.color+';flex-shrink:0"></div>'+
      '<div style="font-size:12px"><span style="font-weight:600">'+d.label+'</span> '+
      '<span style="color:var(--muted)">'+(unit==='h' ? fmtHours(d.value) : (fmtNumber(d.value,1)+(unit||'')))+' ('+pct+'%)</span></div>'+
      '</div>';
  });
  html += '</div></div>';
  return html;
}


function showProjectTab(tab) {
  // Backward-compat: redirect the old per-type summaries to the unified
  // Engagement Summary, pre-selecting the type.
  var typePreset = null;
  if (tab==='project' || tab==='poc' || tab==='amc' || tab==='support' || tab==='presales') {
    typePreset = tab; tab = 'engagement';
  }
  ['uslog','ussess','otsessions','otsummary','engagement','employee','otpolicy','otmanager','manage','vendors'].forEach(function(t) {
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
  if (tab==='employee')   { initProjectTab(); renderPjEmployeeSummary(); }
  if (tab==='otmanager')  { renderManager(); }
  if (tab==='manage')     { populateProjectDropdowns(); renderCustomersTable(); renderManageProjects(); }
  if (tab==='vendors')    { renderVendorsManage(); }
  setSidebarSubActive('projects', tab);
}

// ── MANAGE VENDORS & PRODUCT LINES (manager-only) ────────────────
// Left column lists vendors with a + Add Vendor button. Selecting a vendor
// expands its product lines on the right with a + Add Product Line button.
// Disable instead of delete to preserve historical references on engagements.
var _vendorActiveId = null;

async function renderVendorsManage() {
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
    sb.from('product_lines').select('id,vendor_id,name,display_order,is_active').order('display_order').order('name')
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
        '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="toggleProductLineActive('+p.id+')" title="'+(p.is_active?'Disable':'Re-enable')+'"><i data-lucide="'+(p.is_active?'eye-off':'eye')+'"></i></button>';
      return '<div class="vendor-row'+disabledCls+(isOther?' vendor-row-fallback':'')+'">'+
        '<i data-lucide="layers" class="vendor-row-icon"></i>'+
        '<div class="vendor-row-main">'+
          '<div class="vendor-row-name">'+esc2(p.name)+disabledBadge+otherBadge+'</div>'+
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
  var v = (VENDORS||[]).find(function(x){ return x.id === id; });
  if (!v) return;
  var {error} = await sb.from('vendors').update({ is_active: !v.is_active }).eq('id', id);
  if (error) { showError('Could not toggle: ' + error.message); return; }
  showToast(v.is_active ? 'Vendor disabled ✓' : 'Vendor re-enabled ✓');
  await loadProjects();
  renderVendorsManage();
}

async function addProductLinePrompt(vendorId) {
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
  var p = (PRODUCT_LINES||[]).find(function(x){ return x.id === id; });
  if (!p) return;
  var {error} = await sb.from('product_lines').update({ is_active: !p.is_active }).eq('id', id);
  if (error) { showError('Could not toggle: ' + error.message); return; }
  showToast(p.is_active ? 'Product line disabled ✓' : 'Product line re-enabled ✓');
  await loadProjects();
  renderVendorsManage();
}

