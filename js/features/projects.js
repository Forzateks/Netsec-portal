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

function calcPjDuration() {
  const start = document.getElementById('pj-start').value;
  const end   = document.getElementById('pj-end').value;
  if (!start || !end) return;
  const [sh,sm] = start.split(':').map(Number);
  const [eh,em] = end.split(':').map(Number);
  const sf = sh + sm/60, ef = eh + em/60;
  const dur = ef < sf ? ef + 24 - sf : ef - sf;
  document.getElementById('pj-duration').value = r2(dur) + ' hrs';
}

async function savePjSession() {
  const customer = document.getElementById('pj-customer').value;
  const proj     = document.getElementById('pj-project').value;
  const date     = document.getElementById('pj-date').value;
  const activity = document.getElementById('pj-activity').value;
  const info     = document.getElementById('pj-info').value.trim();
  const start    = document.getElementById('pj-start').value;
  const end      = document.getElementById('pj-end').value;
  const mode     = document.getElementById('pj-mode').value;
  const stakeH   = document.getElementById('pj-stakeholders').value.trim();
  const remarks  = document.getElementById('pj-remarks').value.trim();

  const teamChecks = document.querySelectorAll('#pj-team-checkboxes input[type=checkbox]:checked');
  const teamMembers = Array.from(teamChecks).map(function(c){return c.value;}).join(', ');

  if (!customer || !proj || !date || !activity || !info || !teamMembers) {
    showAlert('pj-error'); return;
  }

  // Calculate duration
  let duration = 0;
  if (start && end) {
    const [sh,sm] = start.split(':').map(Number);
    const [eh,em] = end.split(':').map(Number);
    const sf = sh+sm/60, ef = eh+em/60;
    duration = r2(ef < sf ? ef+24-sf : ef-sf);
  }

  const btn = document.getElementById('pj-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  const {error} = await sb.from('project_sessions').insert({
    project_name: proj,
    customer_name: customer,
    session_date: date,
    activity_type: activity,
    session_info: info,
    start_time: start || null,
    end_time: end || null,
    duration_hours: duration,
    onsite_remote: mode || null,
    stake_holders: stakeH || null,
    team_members: teamMembers,
    remarks: remarks || null,
    logged_by: currentUser
  });

  btn.disabled = false; btn.innerHTML = '💾 Save Session';
  if (error) { alert('Error: ' + error.message); return; }
  showAlert('pj-success');

  // Reset form
  ['pj-customer','pj-project','pj-activity','pj-mode'].forEach(function(id){document.getElementById(id).value='';});
  ['pj-info','pj-start','pj-end','pj-duration','pj-stakeholders','pj-remarks'].forEach(function(id){document.getElementById(id).value='';});
  fillProjectSelect('pj-project', '', false);
  document.querySelectorAll('#pj-team-checkboxes input').forEach(function(cb){
    cb.checked = cb.value===currentUser;
    const lbl = cb.parentElement;
    lbl.style.background = cb.checked ? '#E0F7FF' : 'white';
    lbl.style.borderColor = cb.checked ? 'var(--teal)' : 'var(--border)';
  });
}

async function renderPjSessions() {
  document.getElementById('pj-sessions-loading').style.display='flex';
  document.getElementById('pj-sessions-table').style.display='none';
  document.getElementById('pj-sessions-empty').style.display='none';
  var topScroll = document.getElementById('pj-scroll-top');
  if (topScroll) topScroll.style.display='none';

  const custFilter   = document.getElementById('pj-filter-customer').value;
  const projFilter   = document.getElementById('pj-filter-project').value;
  const memberFilter = document.getElementById('pj-filter-member').value;
  const fromDate     = document.getElementById('pj-filter-from').value;
  const toDate       = document.getElementById('pj-filter-to').value;

  let q = sb.from('project_sessions').select('*').order('session_date',{ascending:false});
  if (projFilter) q = q.eq('project_name', projFilter);
  if (fromDate)   q = q.gte('session_date', fromDate);
  if (toDate)     q = q.lte('session_date', toDate);

  const {data} = await q;
  document.getElementById('pj-sessions-loading').style.display='none';

  let rows = data || [];
  // Customer filter (client-side: matches customer_name OR by mapped project_name)
  if (custFilter) {
    rows = rows.filter(function(r){
      if (r.customer_name) return r.customer_name === custFilter;
      return PROJECT_CUSTOMER[r.project_name] === custFilter;
    });
  }
  // Filter by team member (client-side since it's free text)
  if (memberFilter) {
    const firstName = memberFilter.split(' ')[0].toLowerCase();
    rows = rows.filter(function(r){ return (r.team_members||'').toLowerCase().includes(firstName); });
  }

  if (!rows.length) { document.getElementById('pj-sessions-empty').style.display='block'; return; }
  document.getElementById('pj-sessions-table').style.display='block';
  window._pjData = rows;

  document.getElementById('pj-sessions-tbody').innerHTML = rows.map(function(r,i){
    const canEdit = isManager || (r.logged_by===currentUser);
    var custDisplay = r.customer_name || PROJECT_CUSTOMER[r.project_name] || '—';
    return '<tr>' +
      '<td style="color:var(--muted)">'+(i+1)+'</td>'+
      '<td style="font-size:12px;color:var(--navy);font-weight:600">'+esc2(custDisplay)+'</td>'+
      '<td><strong style="color:var(--navy)">'+r.project_name+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtDate(r.session_date)+'</td>'+
      '<td><span class="badge" style="background:#f0f4ff;color:var(--navy)">'+(r.activity_type||'—')+'</span></td>'+
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px" title="'+(r.session_info||'')+'">'+( r.session_info||'—')+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:600;color:var(--teal)">'+( r.duration_hours||0)+'h</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+(r.onsite_remote||'—')+'</td>'+
      '<td style="font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+(r.team_members||'')+'">'+( r.team_members||'—')+'</td>'+
      '<td style="font-size:11px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+( r.stake_holders||'—')+'</td>'+
      '<td>'+(canEdit ? '<button class="btn btn-sm btn-ghost" onclick="openEditPJ('+r.id+',\''+esc2(r.project_name)+'\',\''+r.session_date+'\',\''+esc2(r.activity_type)+'\',\''+esc2(r.session_info)+'\',\''+(r.start_time||'')+'\',\''+(r.end_time||'')+'\',\''+esc2(r.onsite_remote||'')+'\',\''+esc2(r.stake_holders||'')+'\',\''+esc2(r.team_members||'')+'\',\''+esc2(custDisplay==='—'?'':custDisplay)+'\')" style="margin-right:4px">✏️</button><button class="btn btn-sm btn-danger" onclick="deletePjSession('+r.id+')">✕</button>' : '')+'</td>'+
    '</tr>';
  }).join('');

  // Wire up top scroll mirror
  setTimeout(syncPjTopScroll, 50);
}

function syncPjTopScroll() {
  var top = document.getElementById('pj-scroll-top');
  var topInner = document.getElementById('pj-scroll-top-inner');
  var bottomWrap = document.querySelector('#pj-sessions-table');
  if (!top || !topInner || !bottomWrap) return;
  var table = bottomWrap.querySelector('table');
  if (!table) return;
  // Mirror the table width into the top scroller's inner div
  topInner.style.width = table.scrollWidth + 'px';
  top.style.display = 'block';
  // Two-way scroll sync (set up once)
  if (!top._wired) {
    top.addEventListener('scroll', function(){ bottomWrap.scrollLeft = top.scrollLeft; });
    bottomWrap.addEventListener('scroll', function(){ top.scrollLeft = bottomWrap.scrollLeft; });
    top._wired = true;
  }
}

function clearPjFilters() {
  ['pj-filter-customer','pj-filter-project','pj-filter-member','pj-filter-from','pj-filter-to'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  fillProjectSelect('pj-filter-project', '', true);
  renderPjSessions();
}

async function deletePjSession(id) {
  if (!confirm('Delete this session?')) return;
  await sb.from('project_sessions').delete().eq('id', id);
  renderPjSessions();
}

async function renderPjProjectSummary() {
  document.getElementById('pj-project-loading').style.display='flex';
  document.getElementById('pj-project-content').innerHTML='';
  const year = document.getElementById('pj-sum-year').value || 'all';

  let q = sb.from('project_sessions').select('*');
  if (year !== 'all') {
    q = q.gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
  }
  const {data} = await q;
  document.getElementById('pj-project-loading').style.display='none';

  const rows = data || [];
  if (!rows.length) {
    document.getElementById('pj-project-content').innerHTML='<div class="empty-state"><div class="empty-icon">📁Š</div><div class="empty-title">No sessions for '+year+'</div></div>';
    return;
  }

  // Group by project
  const byProject = {};
  rows.forEach(function(r) {
    if (!byProject[r.project_name]) byProject[r.project_name] = {sessions:0, hours:0, members:{}};
    byProject[r.project_name].sessions++;
    byProject[r.project_name].hours += parseFloat(r.duration_hours||0);
    // Split team members
    (r.team_members||'').split(',').forEach(function(m) {
      const name = m.trim();
      if (name) byProject[r.project_name].members[name] = (byProject[r.project_name].members[name]||0) + parseFloat(r.duration_hours||0);
    });
  });

  // Sort by hours desc
  const sorted = Object.keys(byProject).sort(function(a,b){ return byProject[b].hours - byProject[a].hours; });

  const tableRows = sorted.map(function(proj) {
    const d = byProject[proj];
    const memberBreakdown = Object.keys(d.members).map(function(m){
      return '<span class="badge" style="background:#f0f4ff;color:var(--navy);margin:1px">'+m.split(' ')[0]+': '+r2(d.members[m])+'h</span>';
    }).join(' ');
    return '<tr>'+
      '<td><strong>'+proj+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:15px">'+r2(d.hours)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px;color:var(--muted)">'+r2(d.hours/8)+' days</td>'+
      '<td style="font-size:12px">'+memberBreakdown+'</td>'+
    '</tr>';
  }).join('');

  // Build pie chart data — top 8 projects by hours
  var PIE_COLORS = ['#0A1F5C','#00A0D2','#C8A832','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444'];
  var pieData = sorted.slice(0,8).map(function(proj,i) {
    return {label:proj, value:byProject[proj].hours, color:PIE_COLORS[i%PIE_COLORS.length]};
  });

  // Build Hours by Customer aggregation (rolls up all projects under each customer name,
  // matching is case-insensitive so LANDMARK and Landmark merge).
  var byCustomer = {};
  rows.forEach(function(r){
    var cust = (r.customer_name || PROJECT_CUSTOMER[r.project_name] || 'Uncategorized');
    var key = cust.trim();
    if (!byCustomer[key]) byCustomer[key] = {hours: 0, sessions: 0};
    byCustomer[key].hours    += parseFloat(r.duration_hours||0);
    byCustomer[key].sessions += 1;
  });
  var sortedCust = Object.keys(byCustomer).sort(function(a,b){ return byCustomer[b].hours - byCustomer[a].hours; });
  var custPieData = sortedCust.slice(0,8).map(function(cust,i){
    return {label: cust, value: byCustomer[cust].hours, color: PIE_COLORS[i%PIE_COLORS.length]};
  });

  document.getElementById('pj-project-content').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by Project (Top 8)</div>'+
    buildPieChart(pieData,'h')+
    '</div>'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by Customer</div>'+
    buildPieChart(custPieData,'h')+
    '</div></div>'+
    '<div class="card" style="margin-bottom:20px"><div class="card-title">Quick Stats</div>'+
    '<div class="summary-grid">'+
    '<div class="stat-card navy"><div class="stat-label">Total Projects</div><div class="stat-value">'+sorted.length+'</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Total Hours</div><div class="stat-value" style="font-size:20px">'+r2(sorted.reduce(function(s,p){return s+byProject[p].hours;},0))+'h</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Total Sessions</div><div class="stat-value">'+sorted.reduce(function(s,p){return s+byProject[p].sessions;},0)+'</div></div>'+
    '<div class="stat-card wknd"><div class="stat-label">Total Customers</div><div class="stat-value">'+sortedCust.length+'</div></div>'+
    '</div></div>'+
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>Project</th><th>Sessions</th><th>Total Hours</th><th>Working Days</th><th>Team Breakdown</th></tr></thead>'+
    '<tbody>'+tableRows+'</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Year: '+(year==='all'?'All Years':year)+' | * Working days = hours ÷ 8</div>';
}

async function renderPjEmployeeSummary() {
  document.getElementById('pj-employee-loading').style.display='flex';
  document.getElementById('pj-employee-content').innerHTML='';
  const year = document.getElementById('pj-emp-year').value || 'all';

  let q = sb.from('project_sessions').select('*');
  if (year !== 'all') {
    q = q.gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
  }
  const {data} = await q;
  document.getElementById('pj-employee-loading').style.display='none';

  const rows = data || [];

  // Build per-employee totals
  const empData = {};
  EMPLOYEES.forEach(function(e){ empData[e] = {hours:0, sessions:0, projects:{}}; });

  rows.forEach(function(r) {
    (r.team_members||'').split(',').forEach(function(m) {
      const name = m.trim();
      // Match against known employees — exact match first, then first-name fallback
      EMPLOYEES.forEach(function(emp) {
        const firstName = emp.split(' ')[0].toLowerCase();
        const nameLower = name.toLowerCase();
        // Exact full name match OR first name match
        if (nameLower === emp.toLowerCase() || nameLower === firstName) {
          empData[emp].hours += parseFloat(r.duration_hours||0);
          empData[emp].sessions++;
          empData[emp].projects[r.project_name] = (empData[emp].projects[r.project_name]||0) + parseFloat(r.duration_hours||0);
        }
      });
    });
  });

  const tableRows = EMPLOYEES.map(function(emp) {
    const d = empData[emp];
    const projCount = Object.keys(d.projects).length;
    const topProjects = Object.keys(d.projects)
      .sort(function(a,b){ return d.projects[b]-d.projects[a]; })
      .slice(0,3)
      .map(function(p){ return p+' ('+r2(d.projects[p])+'h)'; })
      .join(', ');
    return '<tr>'+
      '<td><strong>'+emp+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:16px">'+r2(d.hours)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px;color:var(--muted)">'+r2(d.hours/8)+' days</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+projCount+' projects</td>'+
      '<td style="font-size:11px;color:var(--muted)">'+( topProjects||'—')+'</td>'+
    '</tr>';
  }).join('');

  // Total row
  const totalHours = EMPLOYEES.reduce(function(s,e){ return s+empData[e].hours; },0);

  document.getElementById('pj-employee-content').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Hours Distribution</div>'+
    buildPieChart(EMPLOYEES.map(function(e){ return {label:empShortName(e),value:empData[e].hours,color:empColor(e)}; }).filter(function(d){return d.value>0;}),'h')+
    '</div>'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Sessions Distribution</div>'+
    buildPieChart(EMPLOYEES.map(function(e){ return {label:empShortName(e),value:empData[e].sessions,color:empColor(e)}; }).filter(function(d){return d.value>0;}),'')+
    '</div></div>'+
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>Employee</th><th>Sessions</th><th>Total Hours</th><th>Working Days</th><th>Projects</th><th>Top Projects</th></tr></thead>'+
    '<tbody>'+tableRows+
    '<tr style="background:#f8fafc;font-weight:600"><td>TOTAL</td><td>—</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--navy);font-size:16px">'+r2(totalHours)+'h</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--muted)">'+r2(totalHours/8)+'</td><td>—</td><td>—</td></tr>'+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Year: '+(year==='all'?'All Years':year)+' | Working days = hours ÷ 8</div>';
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

function exportPjCSV() {
  const data = window._pjData||[];
  if (!data.length) return;
  const rows=[['Project','Date','Activity','Session Info','Start','End','Duration(h)','Mode','Team Members','Stake Holders','Remarks','Logged By']];
  data.forEach(function(r){ rows.push([r.project_name,r.session_date,r.activity_type,r.session_info,r.start_time,r.end_time,r.duration_hours,r.onsite_remote,r.team_members,r.stake_holders,r.remarks,r.logged_by]); });
  const csv=rows.map(function(r){return r.map(function(v){return '"'+(v||'')+'"';}).join(',');}).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='GulfIT_Project_Sessions.csv'; a.click();
}

function showProjectTab(tab) {
  ['log','sessions','project','employee','manage'].forEach(function(t) {
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
  if (tab==='log')      initProjectTab();
  if (tab==='sessions') { initProjectTab(); renderPjSessions(); }
  if (tab==='project')  { initProjectTab(); renderPjProjectSummary(); }
  if (tab==='employee') { initProjectTab(); renderPjEmployeeSummary(); }
  if (tab==='manage')   { populateProjectDropdowns(); renderManageProjects(); }
}

