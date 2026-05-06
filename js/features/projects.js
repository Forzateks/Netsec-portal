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
let ENGAGEMENTS = []; // [{id, customer_id, name, type, status, ...}] — full new model
let PROJECT_CUSTOMER = {}; // { engagementName: customerName }

async function loadProjects() {
  const cRes = await sb.from('customers').select('id,name,status').order('name');
  if (!cRes.error && cRes.data) {
    CUSTOMERS = cRes.data.filter(function(c){ return c.status !== 'archived'; });
  }
  // Engagements is the new source of truth (replaces projects)
  const eRes = await sb.from('engagements').select('id,customer_id,name,type,status,created_by,created_at').order('name');
  if (!eRes.error && eRes.data) {
    ENGAGEMENTS = eRes.data;
    // PROJECTS array keeps backward-compat with existing OT/Project log forms —
    // it now contains only type='project' engagement names (active ones).
    PROJECTS = ENGAGEMENTS
      .filter(function(e){ return e.type === 'project' && e.status !== 'archived'; })
      .map(function(e){ return e.name; });
    PROJECT_CUSTOMER = {};
    var byId = {}; CUSTOMERS.forEach(function(c){ byId[c.id] = c.name; });
    ENGAGEMENTS.forEach(function(e){ if (e.customer_id) PROJECT_CUSTOMER[e.name] = byId[e.customer_id]; });
    _projectsLoaded = true;
  }
}

// Get projects under a given customer (by name). Empty customer -> all.
function projectsForCustomer(customerName) {
  if (!customerName) return PROJECTS.slice();
  return PROJECTS.filter(function(p){ return PROJECT_CUSTOMER[p] === customerName; });
}

// Populate a customer <select> by id
function fillCustomerSelect(selectId, includeAll) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  el.innerHTML = (includeAll ? '<option value="">All Customers</option>' : '<option value="">-- Select Customer --</option>')
    + CUSTOMERS.map(function(c){ return '<option>'+c.name+'</option>'; }).join('');
  if (cur) el.value = cur;
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

  const {error} = await sb.from('engagements').insert({
    customer_id: customer_id, name: name, type: type, status: status, created_by: currentUser
  });
  if (error) { alert('Error: '+error.message); return; }

  document.getElementById('pj-new-name').value = '';
  document.getElementById('pj-new-status').value = 'active';
  document.getElementById('pj-new-customer').value = '';
  document.getElementById('pj-new-type').value = '';
  showAlert('pj-manage-success');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

// Backward-compat alias (anything still referencing addProject keeps working)
var addProject = addEngagement;

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
  if (error) { alert('Error: '+error.message); return; }
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}


// === CUSTOMERS CRUD (manager only) ==============================
async function addCustomer() {
  var nameEl = document.getElementById('cust-new-name');
  var name = (nameEl.value||'').trim();
  var errEl = document.getElementById('pj-manage-error');
  if (!name) { errEl.textContent = 'Please enter a customer name.'; showAlert('pj-manage-error'); return; }
  // Duplicate check (case-insensitive)
  var dup = (CUSTOMERS||[]).some(function(c){ return c.name.toLowerCase() === name.toLowerCase(); });
  if (dup) { errEl.textContent = 'A customer named "'+name+'" already exists.'; showAlert('pj-manage-error'); return; }

  var {error} = await sb.from('customers').insert({ name: name, status: 'active' });
  if (error) { alert('Error: '+error.message); return; }
  nameEl.value = '';
  showAlert('pj-manage-success');
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderCustomersList();
  renderManageProjects();
}

function renderCustomersList() {
  var el = document.getElementById('cust-list-content');
  if (!el) return;
  var rows = CUSTOMERS || [];
  if (!rows.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px">No customers yet.</div>'; return; }
  // Count engagements per customer for delete-blocking display
  var counts = {};
  (ENGAGEMENTS||[]).forEach(function(e){ counts[e.customer_id] = (counts[e.customer_id]||0) + 1; });
  el.innerHTML = rows.map(function(c){
    var n = counts[c.id] || 0;
    var archived = c.status === 'archived';
    return '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid var(--border);border-radius:20px;background:'+(archived?'#F3F4F6':'white')+';font-size:13px">'
      + '<strong style="'+(archived?'color:var(--muted);text-decoration:line-through':'color:var(--navy)')+'">'+esc2(c.name)+'</strong>'
      + (n ? '<span style="font-size:11px;color:var(--muted)">('+n+')</span>' : '')
      + '<button class="btn btn-sm btn-ghost" onclick="openEditCustomer('+c.id+')" title="Edit" style="padding:2px 6px;min-height:0">✏</button>'
      + '<button class="btn btn-sm btn-danger" onclick="deleteCustomer('+c.id+",'"+c.name.replace(/'/g,"'")+"'"+')" title="Delete" style="padding:2px 6px;min-height:0">×</button>'
      + '</div>';
  }).join('');
}

async function openEditCustomer(id) {
  var {data, error} = await sb.from('customers').select('*').eq('id', id).single();
  if (error || !data) { alert('Could not load customer.'); return; }
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

  // If renamed, cascade to session tables that snapshot customer_name
  if (oldName && oldName !== name) {
    await sb.from('project_sessions').update({ customer_name: name }).eq('customer_name', oldName);
    await sb.from('ot_sessions').update({ customer_name: name }).eq('customer_name', oldName);
  }
  closeEditCustomerModal();
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderCustomersList();
  renderManageProjects();
}

async function deleteCustomer(id, name) {
  var inUse = (ENGAGEMENTS||[]).filter(function(e){ return e.customer_id === id; }).length;
  if (inUse) {
    alert('Cannot delete "'+name+'" - it has '+inUse+' engagement(s) attached. Edit or remove those engagements first, or set the customer to Archived to hide it.');
    return;
  }
  if (!confirm('Delete customer "'+name+'"?\n\nThis is permanent. Existing OT/Project sessions that referenced it stay unchanged (the snapshot text remains).')) return;
  var {error} = await sb.from('customers').delete().eq('id', id);
  if (error) { alert('Error: '+error.message); return; }
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderCustomersList();
  renderManageProjects();
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
    document.getElementById('pj-manage-content').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📁</div><div class="empty-title">No engagements found</div></div>';
    return;
  }

  const STATUS_COLORS = {
    'active':    {bg:'#ECFDF5',color:'#059669',label:'🟢 Active'},
    'completed': {bg:'#EFF6FF',color:'#2563EB',label:'✅ Completed'},
    'on-hold':   {bg:'#FEF9C3',color:'#B45309',label:'⏸️ On Hold'},
    'archived':  {bg:'#F3F4F6',color:'#6B7280',label:'🗃️ Archived'},
  };
  const TYPE_BADGES = {
    'project': {bg:'#EFF6FF',color:'#2563EB',label:'PROJECT'},
    'poc':     {bg:'#F5F3FF',color:'#7C3AED',label:'POC'},
    'amc':     {bg:'#FFFBEB',color:'#B45309',label:'AMC'},
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
        '<td><span style="background:'+sc.bg+';color:'+sc.color+';padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">'+sc.label+'</span></td>'+
        '<td style="white-space:nowrap">'+
          '<button class="btn btn-sm btn-ghost" onclick="openEditProject('+p.id+')" style="margin-right:4px">✏️</button>'+
          '<button class="btn btn-sm btn-danger" onclick="deleteProject('+p.id+',\''+ (p.name||'').replace(/'/g,"\\'") +'\')">🗑</button>'+
        '</td>'+
        '</tr>';
    }).join('')+
    '</tbody></table></div>';
}

// ── EDIT PROJECT (manager) ────────────────────────────────────────
async function openEditProject(id) {
  var {data, error} = await sb.from('engagements').select('*').eq('id', id).single();
  if (error || !data) { alert('Could not load engagement.'); return; }
  document.getElementById('edit-project-id').value = data.id;
  document.getElementById('edit-project-name').value = data.name || '';
  document.getElementById('edit-project-status').value = data.status || 'active';
  var typeEl = document.getElementById('edit-project-type');
  if (typeEl) typeEl.value = data.type || 'project';
  fillCustomerSelect('edit-project-customer', false);
  var custById = {}; (CUSTOMERS||[]).forEach(function(c){ custById[c.id] = c.name; });
  document.getElementById('edit-project-customer').value = custById[data.customer_id] || '';
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
  if (!customer || !name || !type) { alert('Customer, Type and Engagement Name are required.'); return; }
  var custRow = (CUSTOMERS||[]).find(function(c){ return c.name === customer; });
  var customer_id = custRow ? custRow.id : null;

  // Read OLD name so we can cascade renames to session tables
  var oldRes = await sb.from('engagements').select('name').eq('id', id).single();
  var oldName = oldRes.data ? oldRes.data.name : null;

  var {error} = await sb.from('engagements').update({ name: name, status: status, customer_id: customer_id, type: type }).eq('id', id);
  if (error) { alert('Error: '+error.message); return; }

  // If renamed, cascade to session tables so historical rows match
  if (oldName && oldName !== name) {
    var pjRes = await sb.from('project_sessions').update({ project_name: name }).eq('project_name', oldName);
    var otRes = await sb.from('ot_sessions').update({ project_name: name }).eq('project_name', oldName);
    if (pjRes.error) console.error('project_sessions cascade failed:', pjRes.error);
    if (otRes.error) console.error('ot_sessions cascade failed:', otRes.error);
  }

  closeEditProjectModal();
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

async function deleteProject(id, name) {
  if (!confirm('Delete engagement "'+name+'"?\n\nThis only removes it from the Projects registry — existing OT/Project sessions that referenced it remain unchanged.')) return;
  var {error} = await sb.from('engagements').delete().eq('id', id);
  if (error) { alert('Error: '+error.message); return; }
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
  fillCustomerSelect('log-customer', false);
  fillCustomerSelect('edit-ot-customer', false);
  fillCustomerSelect('edit-pj-customer', false);
  fillCustomerSelect('pj-filter-customer', true);

  // Project selects — log/OT forms start unfiltered (until user picks customer)
  fillProjectSelect('pj-project', '', false);
  fillProjectSelect('log-project', '', false);
  fillProjectSelect('edit-ot-project', '', false);
  fillProjectSelect('edit-pj-project', '', false);
  fillProjectSelect('pj-filter-project', '', true);

  // Activity type selects
  fillActivitySelect('pj-activity');
  fillActivitySelect('log-activity-type');
  fillActivitySelect('edit-pj-activity');
  fillActivitySelect('edit-ot-activity-type');
}

// Customer-change handlers — re-filter project dropdown to only that customer
function onPjCustomerChange() {
  fillProjectSelect('pj-project', document.getElementById('pj-customer').value, false);
}
function onLogCustomerChange() {
  fillProjectSelect('log-project', document.getElementById('log-customer').value, false);
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
  // Show Manage Projects tab for manager only
  const manageTab = document.getElementById('pjsub-manage');
  if (manageTab) manageTab.style.display = isManager ? '' : 'none';

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
  ['pj-sum-year','pj-emp-year'].forEach(function(id) {
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

async function renderPjEmployeeSummary() {
  document.getElementById('pj-employee-loading').style.display='flex';
  document.getElementById('pj-employee-content').innerHTML='';
  const year = document.getElementById('pj-emp-year').value || 'all';

  // Reads unified_sessions (Phase 6 cutover). Aggregates by employee
  // (the `employee` column on the unified row, which is the logger),
  // with a per-type breakdown column.
  let q = sb.from('unified_sessions').select('*');
  if (year !== 'all') {
    q = q.gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
  }
  const {data} = await q;
  document.getElementById('pj-employee-loading').style.display='none';

  const rows = data || [];

  const empData = {};
  EMPLOYEES.forEach(function(e){
    empData[e] = { total:0, sessions:0, project:0, poc:0, amc:0, internal:0, engagements:{} };
  });

  rows.forEach(function(r) {
    var emp = r.employee;
    if (!empData[emp]) return; // skip rows from unknown employees
    var hrs = parseFloat(r.total_hours || 0);
    empData[emp].total    += hrs;
    empData[emp].sessions += 1;
    if (empData[emp][r.session_type] !== undefined) empData[emp][r.session_type] += hrs;
    var key = r.engagement_name || (r.session_type==='internal' ? '(internal)' : '(unspecified)');
    empData[emp].engagements[key] = (empData[emp].engagements[key]||0) + hrs;
  });

  const tableRows = EMPLOYEES.map(function(emp) {
    const d = empData[emp];
    const engCount = Object.keys(d.engagements).length;
    const topEngs = Object.keys(d.engagements)
      .sort(function(a,b){ return d.engagements[b]-d.engagements[a]; })
      .slice(0,3)
      .map(function(p){ return p+' ('+r2(d.engagements[p])+'h)'; })
      .join(', ');
    return '<tr>'+
      '<td><strong>'+emp+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:16px">'+r2(d.total)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+r2(d.project)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+r2(d.poc)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+r2(d.amc)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+r2(d.internal)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px;color:var(--muted)">'+r2(d.total/8)+' days</td>'+
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
    '<thead><tr><th>Employee</th><th>Sessions</th><th>Total</th><th>📁 Project</th><th>🎯 POC</th><th>🛠️ AMC</th><th>🔧 Internal</th><th>Working Days</th><th>Top Engagements</th></tr></thead>'+
    '<tbody>'+tableRows+
    '<tr style="background:#f8fafc;font-weight:600"><td>TOTAL</td><td>-</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--navy);font-size:16px">'+r2(totalHours)+'h</td>'+
    '<td colspan="4">-</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--muted)">'+r2(totalHours/8)+'</td><td>-</td></tr>'+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Year: '+(year==='all'?'All Years':year)+' | Working days = hours / 8 | Reads unified_sessions (sessions logged via the new Log Session form)</div>';
}

// ── PIE CHART HELPERS ────────────────────────────────────────────
function empShortName(emp) {
  var parts = emp.split(' ');
  if (parts.length > 2) return parts[parts.length-1]; // Last name for Mohammed X
  return parts[0]; // First name for others
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
      '<span style="color:var(--muted)">'+r2(d.value)+(unit||'')+' ('+pct+'%)</span></div>'+
      '</div>';
  });
  html += '</div></div>';
  return html;
}


function showProjectTab(tab) {
  ['uslog','ussess','project','poc','amc','employee','manage'].forEach(function(t) {
    const el  = document.getElementById('pjtab-'+t);
    const sub = document.getElementById('pjsub-'+t);
    if (!el) return;
    el.style.display = t===tab ? 'block' : 'none';
    if (!sub) return;
    if (t===tab) {
      sub.classList.add('active');
      sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';
    } else {
      sub.classList.remove('active');
      sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';
    }
  });
  if (tab==='uslog')    { initProjectTab(); initUSLogForm(); }
  if (tab==='ussess')   { initProjectTab(); populateUSFilters(); renderUSSessions(); }
  if (tab==='project')  { initProjectTab(); renderUnifiedTypeSummary('project'); }
  if (tab==='poc')      { initProjectTab(); renderUnifiedTypeSummary('poc'); }
  if (tab==='amc')      { initProjectTab(); renderUnifiedTypeSummary('amc'); }
  if (tab==='employee') { initProjectTab(); renderPjEmployeeSummary(); }
  if (tab==='manage')   { populateProjectDropdowns(); renderCustomersList(); renderManageProjects(); }
}

