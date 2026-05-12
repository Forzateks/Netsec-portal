// == PROJECT / POC TRACKER ==========================================
// Read-only list view of engagements with their tracker-level metadata
// (country, partner, owner, status, versions, license expiry, etc.).
// Phase 4 will add the edit form + milestone management.

var _trkData      = [];
var _trkActiveTab = 'all';   // 'all' | 'projects' | 'pocs'

// Type-aware status options. Projects flow through delivery phases (HLD →
// LLD → Pilot Sites Rollout → Migration → KT → Sign-off) so the project
// status set mirrors the activity types + a few terminal states. POCs follow
// a simpler sales-cycle vocabulary.
var TRK_PROJECT_STATUSES = [
  'Yet to start','Kick-off',
  'HLD Discussion','HLD Documentation',
  'LLD Discussion','LLD Documentation',
  'Initial Configuration','Pilot Sites Rollout',
  'Migration','KT / Training','As-Built Documentation','Troubleshooting',
  'Onhold','On demand request',
  'Completed'
];
var TRK_POC_STATUSES = [
  'Yet to start','Initial Phase','Ongoing','Pilot','Onhold',
  'Budgetary Phase','On demand request',
  'Completed','Ended','Cancelled','Lost'
];
function trkStatusesFor(type) {
  if (type === 'project') return TRK_PROJECT_STATUSES.slice();
  if (type === 'poc')     return TRK_POC_STATUSES.slice();
  // 'all' (or unspecified) → union, preserving project ordering first
  var seen = {};
  var union = [];
  TRK_PROJECT_STATUSES.concat(TRK_POC_STATUSES).forEach(function(s){
    if (!seen[s]) { seen[s] = 1; union.push(s); }
  });
  return union;
}

function showTrackerTab(tab) {
  _trkActiveTab = tab;
  setSidebarSubActive('tracker', tab);
  // Refresh the status filter so its option list matches the tab. Selection
  // values that aren't valid for the new type are dropped automatically by
  // msInit's validity filter.
  if (typeof msInit === 'function' && document.getElementById('trk-filter-status')) {
    var items = trkStatusesFor(tab === 'projects' ? 'project' : (tab === 'pocs' ? 'poc' : 'all'))
      .map(function(v){return {value:v,label:v};});
    msInit('trk-filter-status', items, applyTrackerFilters);
  }
  renderTracker();
}

async function loadTracker() {
  var load    = document.getElementById('trk-load');
  var content = document.getElementById('trk-content');
  if (load)    load.style.display    = 'flex';
  if (content) content.innerHTML     = '';

  // Fetch engagements and customers separately, then join client-side.
  // Avoids relying on Supabase nested-select FK metadata.
  var engRes = await fetchAllRows(function(){
    return sb.from('engagements')
      .select('id,customer_id,name,type,status,country,partner,category,project_order_no,start_date,end_date,tracker_status,orch_version,ec_version,license_expiry,signed_off_on,owner_employee,tracker_remarks,tracker_updated_at,created_at')
      .order('tracker_updated_at',{ascending:false,nullsFirst:false});
  });
  var custRes = await fetchAllRows(function(){
    return sb.from('customers').select('id,name');
  });

  if (load) load.style.display = 'none';
  if (engRes.error || custRes.error) {
    var msg = (engRes.error||custRes.error).message;
    if (content) content.innerHTML = '<div class="alert alert-error show">Error: '+esc2(msg)+'</div>';
    return;
  }
  var custMap = {};
  (custRes.data||[]).forEach(function(c){ custMap[c.id] = c.name; });
  _trkData = (engRes.data||[]).map(function(r){
    r.customer_name = custMap[r.customer_id] || '';
    return r;
  });
  populateTrackerFilters();
  renderTracker();
}

function populateTrackerFilters() {
  var countries = {}, partners = {}, owners = {};
  _trkData.forEach(function(r){
    if (r.country) countries[r.country] = 1;
    if (r.partner) partners[r.partner] = 1;
    if (r.owner_employee) owners[r.owner_employee] = 1;
  });
  var toItems = function(obj){
    return Object.keys(obj).sort().map(function(v){return {value:v,label:v};});
  };
  // Multi-select dropdowns; selection persists across re-init via the
  // element's _selected Set (msInit drops values no longer present).
  msInit('trk-filter-country', toItems(countries), applyTrackerFilters);
  msInit('trk-filter-partner', toItems(partners),  applyTrackerFilters);
  msInit('trk-filter-owner',   toItems(owners),    applyTrackerFilters);
  // Top-level status filter — 8 coarse-grained values, same across all
  // tabs. The fine-grained tracker_status (Phase) is no longer filtered
  // from this dropdown; it now lives inside the detail/edit modal.
  msInit('trk-filter-status',
    TRK_TOP_STATUS_ORDER.map(function(k){return {value:k, label:TRK_TOP_STATUS_MAP[k].label};}),
    applyTrackerFilters);
}

function clearTrackerFilters() {
  var search = document.getElementById('trk-search'); if (search) search.value = '';
  ['trk-filter-country','trk-filter-partner','trk-filter-status','trk-filter-owner'].forEach(function(id){
    msSetValues(id, []);
  });
  var sf = document.getElementById('trk-filter-start-from'); if (sf) sf.value = '';
  var st = document.getElementById('trk-filter-start-to');   if (st) st.value = '';
  renderTracker();
}

function applyTrackerFilters() { renderTracker(); }

function _trkFilteredRows() {
  var search    = ((document.getElementById('trk-search')||{}).value||'').toLowerCase().trim();
  var countries = msGetValues('trk-filter-country');
  var partners  = msGetValues('trk-filter-partner');
  var statuses  = msGetValues('trk-filter-status');   // now filters TOP-LEVEL status
  var owners    = msGetValues('trk-filter-owner');
  var startFrom = ((document.getElementById('trk-filter-start-from')||{}).value || '');
  var startTo   = ((document.getElementById('trk-filter-start-to')||{}).value   || '');

  var filtered = _trkData.filter(function(r){
    if (_trkActiveTab === 'projects' && r.type !== 'project') return false;
    if (_trkActiveTab === 'pocs'     && r.type !== 'poc')     return false;
    if (countries.length && countries.indexOf(r.country)        === -1) return false;
    if (partners.length  && partners.indexOf(r.partner)         === -1) return false;
    // Compare against the NORMALIZED top-level status key so 'ongoing' /
    // null / 'on hold' all bucket correctly even when the dropdown user
    // picked 'active' or 'on-hold'.
    if (statuses.length  && statuses.indexOf(_trkTopStatusKey(r.status)) === -1) return false;
    if (owners.length    && owners.indexOf(r.owner_employee)    === -1) return false;
    // Start-date range: empty inputs skip the filter. ISO YYYY-MM-DD
    // string compare is correct lexicographically for dates.
    if (startFrom && (r.start_date == null || r.start_date < startFrom)) return false;
    if (startTo   && (r.start_date == null || r.start_date > startTo))   return false;
    if (search) {
      var hay = [r.name, r.customer_name, r.partner, r.country, r.owner_employee, r.tracker_remarks, r.category, r.project_order_no]
        .map(function(x){return (x||'').toLowerCase();}).join(' ');
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });

  // Active engagements bubble to the top so day-to-day work is visible
  // first; concluded/dormant rows fall below. Within each band we keep the
  // tracker_updated_at-desc order from the initial fetch.
  var activeStatusOrder = {
    'Ongoing': 0,
    'Pilot Sites Rollout': 1,
    'Migration': 2,
    'KT / Training': 3,
    'Initial Configuration': 4,
    'HLD Documentation': 5, 'HLD Discussion': 5,
    'LLD Documentation': 6, 'LLD Discussion': 6,
    'As-Built Documentation': 7,
    'Troubleshooting': 8,
    'Kick-off': 9,
    'Initial Phase': 10,
    'Pilot': 11,
    'Yet to start': 20,
    'Onhold': 21,
    'Budgetary Phase': 22,
    'On demand request': 23,
    'Completed': 50,
    'Ended': 51,
    'Cancelled': 52,
    'Lost': 53
  };
  filtered.sort(function(a,b){
    var ao = activeStatusOrder[a.tracker_status] != null ? activeStatusOrder[a.tracker_status] : 99;
    var bo = activeStatusOrder[b.tracker_status] != null ? activeStatusOrder[b.tracker_status] : 99;
    if (ao !== bo) return ao - bo;
    // Same band → most recently updated first
    var at = a.tracker_updated_at ? new Date(a.tracker_updated_at).getTime() : 0;
    var bt = b.tracker_updated_at ? new Date(b.tracker_updated_at).getTime() : 0;
    return bt - at;
  });
  return filtered;
}

function trkStatusBadge(s) {
  if (!s) return '<span style="font-size:11px;color:var(--muted)">—</span>';
  var cls = 'trk-status-' + s.toLowerCase().replace(/[^a-z]+/g,'-');
  return '<span class="badge trk-status '+cls+'">'+esc2(s)+'</span>';
}

// ── TOP-LEVEL ENGAGEMENT STATUS (engagement.status) ─────────────────
// 8 coarse-grained states — what a manager scans the tracker list for.
// Distinct from tracker_status (the fine-grained workflow phase shown in
// the detail/edit modal as "Current Phase"). null/empty status renders as
// Active per spec — legacy imports / freshly-inserted rows shouldn't read
// as a blank cell.
var TRK_TOP_STATUS_ORDER = [
  'active','ongoing','sign-off','completed','on-hold','dormant','cancelled','archived'
];
var TRK_TOP_STATUS_MAP = {
  'active':    { label:'Active',    icon:'🟢', cls:'trk-st-active' },
  'ongoing':   { label:'Ongoing',   icon:'🔵', cls:'trk-st-ongoing' },
  'sign-off':  { label:'Sign-off',  icon:'✍️', cls:'trk-st-signoff' },
  'completed': { label:'Completed', icon:'✅', cls:'trk-st-completed' },
  'on-hold':   { label:'On Hold',   icon:'⏸️', cls:'trk-st-onhold' },
  'dormant':   { label:'Dormant',   icon:'💤', cls:'trk-st-dormant' },
  'cancelled': { label:'Cancelled', icon:'❌', cls:'trk-st-cancelled' },
  'archived':  { label:'Archived',  icon:'📦', cls:'trk-st-archived' }
};
function _trkTopStatusKey(raw) {
  var v = (raw == null ? '' : String(raw)).trim().toLowerCase();
  if (!v) return 'active';
  if (TRK_TOP_STATUS_MAP[v]) return v;
  // Accept a couple of historical aliases the data may carry.
  if (v === 'on hold' || v === 'onhold') return 'on-hold';
  if (v === 'sign off' || v === 'signoff') return 'sign-off';
  return v; // unknown — let the renderer fall back to muted
}
function trkTopStatusBadge(raw) {
  var key = _trkTopStatusKey(raw);
  var def = TRK_TOP_STATUS_MAP[key];
  if (!def) return '<span class="badge" style="background:#F3F4F6;color:#6B7280">'+esc2(raw||'—')+'</span>';
  return '<span class="badge '+def.cls+'"><span class="trk-st-icon">'+def.icon+'</span> '+def.label+'</span>';
}

function trkTypeBadge(t) {
  if (t === 'poc')     return '<span class="badge trk-type trk-type-poc">POC</span>';
  if (t === 'project') return '<span class="badge trk-type trk-type-project">Project</span>';
  return '<span class="badge">'+esc2((t||'').toUpperCase())+'</span>';
}

function trkLicenseCell(d) {
  if (!d) return '<span class="dim">—</span>';
  var today = new Date();
  var exp   = new Date(d);
  var days  = Math.floor((exp - today) / 86400000);
  var label = fmtDate(d);
  if (days < 0)        return '<span class="num" style="color:var(--danger);font-weight:600">'+label+' (expired)</span>';
  if (days <= 30)      return '<span class="num" style="color:#D97706;font-weight:600">'+label+' ('+days+'d)</span>';
  return '<span class="num">'+label+'</span>';
}

function renderTrackerStatRow() {
  var wrap = document.getElementById('trk-stat-row');
  if (!wrap) return;
  var rows = _trkData;
  var nProj = rows.filter(function(r){return r.type==='project';}).length;
  var nPoc  = rows.filter(function(r){return r.type==='poc';}).length;
  var nOngoing = rows.filter(function(r){return r.tracker_status==='Ongoing';}).length;
  var nCompleted = rows.filter(function(r){return r.tracker_status==='Completed';}).length;
  var nOnhold = rows.filter(function(r){return r.tracker_status==='Onhold';}).length;
  var stats = [
    {label:'Projects',  value:nProj,      icon:'folder-kanban', tab:'projects'},
    {label:'POCs',      value:nPoc,       icon:'target',        tab:'pocs'},
    {label:'Ongoing',   value:nOngoing,   icon:'play-circle'},
    {label:'On Hold',   value:nOnhold,    icon:'pause-circle'},
    {label:'Completed', value:nCompleted, icon:'check-circle-2'}
  ];
  wrap.innerHTML = stats.map(function(s){
    var click = s.tab ? ' onclick="showTrackerTab(\''+s.tab+'\')" style="cursor:pointer"' : '';
    return '<div class="trk-stat-card"'+click+'>'+
      '<div class="trk-stat-icon"><i data-lucide="'+s.icon+'"></i></div>'+
      '<div class="trk-stat-text">'+
        '<div class="trk-stat-value num">'+s.value+'</div>'+
        '<div class="trk-stat-label">'+s.label+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

function renderTracker() {
  renderTrackerStatRow();

  var content = document.getElementById('trk-content');
  if (!content) return;
  var rows = _trkFilteredRows();

  // Tab strip (count per tab from full dataset, not filtered)
  var nAll = _trkData.length;
  var nP   = _trkData.filter(function(r){return r.type==='project';}).length;
  var nQ   = _trkData.filter(function(r){return r.type==='poc';}).length;
  var tabBtn = function(key, label, count) {
    var active = (_trkActiveTab===key);
    return '<button class="trk-tab'+(active?' active':'')+'" onclick="showTrackerTab(\''+key+'\')">'+
      label+' <span class="trk-tab-count">'+count+'</span></button>';
  };
  var tabBar = '<div class="trk-tab-bar">'+
    tabBtn('all','All',nAll)+
    tabBtn('projects','Projects',nP)+
    tabBtn('pocs','POCs',nQ)+
  '</div>';

  if (!rows.length) {
    content.innerHTML = tabBar +
      '<div class="empty-state"><i data-lucide="folder-search" class="empty-icon-svg"></i>'+
      '<div class="empty-title">No engagements match the current filters</div>'+
      '<div>Adjust filters or clear them to see everything.</div></div>';
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var showLicense = (_trkActiveTab !== 'projects'); // POC + All show license col
  var showCategory = (_trkActiveTab !== 'projects');

  var th =
    '<tr>'+
      '<th>Type</th>'+
      '<th>Engagement</th>'+
      '<th>Customer</th>'+
      '<th class="hide-mobile">Country</th>'+
      '<th class="hide-mobile">Partner</th>'+
      (showCategory ? '<th class="hide-mobile">Category</th>' : '')+
      '<th>Status</th>'+
      '<th class="hide-mobile">Owner</th>'+
      (showLicense ? '<th class="hide-mobile">License Expiry</th>' : '')+
      '<th class="hide-mobile">Updated</th>'+
      '<th></th>'+
    '</tr>';

  var body = rows.map(function(r){
    return '<tr class="trk-row" onclick="openTrackerDetail('+r.id+')">'+
      '<td>'+trkTypeBadge(r.type)+'</td>'+
      '<td><div style="font-weight:600;color:var(--navy)">'+esc2(r.name)+'</div>'+
        (r.project_order_no?'<div style="font-size:11px;color:var(--muted)" class="num">PO: '+esc2(r.project_order_no)+'</div>':'')+
      '</td>'+
      '<td>'+esc2(r.customer_name||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(r.country||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(r.partner||'—')+'</td>'+
      (showCategory ? '<td class="hide-mobile">'+esc2(r.category||'—')+'</td>' : '')+
      '<td>'+trkTopStatusBadge(r.status)+'</td>'+
      '<td class="hide-mobile">'+esc2(r.owner_employee||'—')+'</td>'+
      (showLicense ? '<td class="hide-mobile">'+trkLicenseCell(r.license_expiry)+'</td>' : '')+
      '<td class="hide-mobile dim num" style="font-size:12px">'+(r.tracker_updated_at?fmtDate(r.tracker_updated_at):'—')+'</td>'+
      '<td><button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openTrackerDetail('+r.id+')"><i data-lucide="eye" class="btn-icon"></i>View</button></td>'+
    '</tr>';
  }).join('');

  content.innerHTML = tabBar +
    '<div class="card trk-table-card" style="padding:0">'+
      '<div class="table-wrap"><table class="trk-table"><thead>'+th+'</thead><tbody>'+body+'</tbody></table></div>'+
    '</div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+_trkData.length+' engagements</div>';
  if (typeof renderIcons === 'function') renderIcons();
  // Add a synced top scrollbar so users see horizontal overflow without
  // having to scroll to the bottom of long tables.
  if (typeof attachTopScroll === 'function') {
    var wrap = content.querySelector('.table-wrap');
    if (wrap) attachTopScroll(wrap);
  }
}

function openTrackerDetail(id) {
  var r = _trkData.find(function(x){return x.id===id;});
  if (!r) return;

  document.getElementById('trk-detail-type').innerHTML = trkTypeBadge(r.type) + ' ' + trkTopStatusBadge(r.status);
  document.getElementById('trk-detail-name').textContent = r.name || '';
  document.getElementById('trk-detail-customer').textContent = (r.customer_name||'—') +
    (r.country?(' · '+r.country):'') +
    (r.partner?(' · '+r.partner):'');

  var fields = [
    {label:'Customer',         value: r.customer_name},
    {label:'Country',          value: r.country},
    {label:'Partner',          value: r.partner},
    {label:'Category',         value: r.category},
    {label:'Current Phase',    value: r.tracker_status, hint:'Workflow phase within an active project'},
    {label:'Project Order No', value: r.project_order_no, mono:true},
    {label:'Owner',            value: r.owner_employee},
    {label:'Start Date',       value: r.start_date ? fmtDate(r.start_date) : '', mono:true},
    {label:'End Date',         value: r.end_date   ? fmtDate(r.end_date)   : '', mono:true},
    {label:'License Expiry',   value: r.license_expiry ? fmtDate(r.license_expiry) : '', mono:true,
      flag: r.license_expiry ? (function(){
        var d = Math.floor((new Date(r.license_expiry) - new Date())/86400000);
        if (d<0) return 'expired';
        if (d<=30) return 'soon';
        return '';
      })() : ''},
    {label:'Sign Off',         value: r.signed_off_on ? fmtDate(r.signed_off_on) : '', mono:true},
    {label:'Orch. Version',    value: r.orch_version, mono:true},
    {label:'EC Version',       value: r.ec_version,   mono:true},
    {label:'Last Updated',     value: r.tracker_updated_at ? fmtDate(r.tracker_updated_at) : '', mono:true}
  ];
  var fieldHtml = fields.map(function(f){
    var v = f.value;
    if (!v && v !== 0) return '';
    var cls = f.mono ? ' num' : '';
    var flagCss = '';
    if (f.flag === 'expired') flagCss = 'color:var(--danger);font-weight:600';
    else if (f.flag === 'soon') flagCss = 'color:#D97706;font-weight:600';
    var hint = f.hint ? '<div class="trk-field-hint">'+esc2(f.hint)+'</div>' : '';
    return '<div class="trk-field"><div class="trk-field-label">'+esc2(f.label)+'</div>'+
      '<div class="trk-field-value'+cls+'" style="'+flagCss+'">'+esc2(String(v))+'</div>'+hint+'</div>';
  }).join('');

  var remarks = (r.tracker_remarks||'').trim();
  var remarksHtml = remarks
    ? '<div class="trk-remarks-block"><div class="trk-field-label" style="margin-bottom:6px">Remarks</div>'+
      '<div style="font-size:13px;line-height:1.6;color:#1F2937;white-space:pre-wrap">'+esc2(remarks)+'</div></div>'
    : '';

  document.getElementById('trk-detail-body').innerHTML =
    '<div class="trk-detail-grid">'+fieldHtml+'</div>'+
    remarksHtml +
    '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">'+
      (isManager ? '<button class="btn btn-primary" onclick="openTrackerEditModal('+r.id+')"><i data-lucide="pencil" class="btn-icon"></i>Edit</button>' : '')+
      '<button class="btn btn-ghost" onclick="openMilestonesModal('+r.id+')"><i data-lucide="list-checks" class="btn-icon"></i>Milestones</button>'+
      '<button class="btn btn-ghost" onclick="closeTrackerDetail()" style="margin-left:auto">Close</button>'+
    '</div>';

  document.getElementById('trk-detail-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeTrackerDetail() {
  document.getElementById('trk-detail-modal').classList.remove('show');
}

// Open the tracker screen and immediately surface a specific engagement's
// detail modal — used by the dashboard license-expiry banner.
async function openEngagementInTracker(id) {
  showScreen('tracker');
  // showScreen kicks off loadTracker but doesn't return its promise; await
  // a fresh load here so _trkData is populated before opening the modal.
  await loadTracker();
  openTrackerDetail(id);
}

// ── EDIT MODAL ─────────────────────────────────────────────────────

function _trkPopulateOwnerOptions() {
  var sel = document.getElementById('trk-edit-owner');
  if (!sel) return;
  var current = sel.value;
  var html = '<option value="">— None —</option>';
  (typeof EMPLOYEES !== 'undefined' ? EMPLOYEES : []).forEach(function(e){
    html += '<option value="'+esc2(e)+'">'+esc2(e)+'</option>';
  });
  sel.innerHTML = html;
  sel.value = current;
}

function _trkSet(id, val) {
  var el = document.getElementById(id);
  if (!el) return;
  el.value = (val == null) ? '' : val;
}
function _trkGet(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}
function _trkDateOrNull(v) { return v ? v : null; }
function _trkTextOrNull(v) { var t = (v||'').trim(); return t || null; }

function _trkPopulateStatusOptions(type, currentValue) {
  var sel = document.getElementById('trk-edit-tracker-status');
  if (!sel) return;
  var preserve = (typeof currentValue === 'string' && currentValue) ? currentValue : sel.value;
  var statuses = trkStatusesFor(type);
  var html = '<option value="">— None —</option>';
  // If the engagement is already on a status that's no longer in the standard
  // list (e.g. a legacy 'Ongoing' on a project), keep it as a selectable
  // "(legacy)" option so the row stays editable without forcing reclassification.
  if (preserve && statuses.indexOf(preserve) === -1) {
    html += '<option value="'+esc2(preserve)+'" selected>'+esc2(preserve)+' (legacy)</option>';
  }
  statuses.forEach(function(v){
    html += '<option>'+esc2(v)+'</option>';
  });
  sel.innerHTML = html;
  if (preserve && statuses.indexOf(preserve) !== -1) sel.value = preserve;
}

function openTrackerEditModal(id) {
  if (!isManager) { alert('Manager access only.'); return; }
  var r = _trkData.find(function(x){return x.id===id;});
  if (!r) return;
  closeTrackerDetail();
  _trkPopulateOwnerOptions();
  _trkPopulateStatusOptions(r.type, r.tracker_status);

  document.getElementById('trk-edit-title').textContent    = r.name || 'Edit Engagement';
  document.getElementById('trk-edit-subtitle').textContent =
    (r.customer_name||'—') + ' · ' + (r.type||'').toUpperCase();
  _trkSet('trk-edit-id',                String(r.id));
  // Top-level status — normalize null/empty/legacy 'ongoing' to a valid
  // key from the 8-option dropdown so the select doesn't blank out.
  _trkSet('trk-edit-status',            _trkTopStatusKey(r.status));
  _trkSet('trk-edit-country',           r.country);
  _trkSet('trk-edit-partner',           r.partner);
  _trkSet('trk-edit-category',          r.category);
  _trkSet('trk-edit-project-order-no',  r.project_order_no);
  _trkSet('trk-edit-start-date',        r.start_date);
  _trkSet('trk-edit-end-date',          r.end_date);
  _trkSet('trk-edit-tracker-status',    r.tracker_status);
  _trkSet('trk-edit-owner',             r.owner_employee);
  _trkSet('trk-edit-orch-version',      r.orch_version);
  _trkSet('trk-edit-ec-version',        r.ec_version);
  _trkSet('trk-edit-license-expiry',    r.license_expiry);
  _trkSet('trk-edit-signed-off-on',     r.signed_off_on);
  _trkSet('trk-edit-remarks',           r.tracker_remarks);
  document.getElementById('trk-edit-info').style.display = 'none';

  document.getElementById('trk-edit-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeTrackerEditModal() {
  document.getElementById('trk-edit-modal').classList.remove('show');
}

// Show a hint when status 'Completed' or sign-off date is set, since both
// auto-flip the engagement.status field to 'completed' on save.
function _trkRefreshAutoCompleteHint() {
  var status   = _trkGet('trk-edit-tracker-status');
  var signedOn = _trkGet('trk-edit-signed-off-on');
  var box = document.getElementById('trk-edit-info');
  if (!box) return;
  if (status === 'Completed' || signedOn) {
    box.style.display = 'block';
    box.innerHTML = '<i data-lucide="info" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>'+
      'Saving will mark this engagement as <strong>Completed</strong> across the app (status flips to <code>completed</code>).';
    if (typeof renderIcons === 'function') renderIcons();
  } else {
    box.style.display = 'none';
  }
}
function onTrackerStatusChange() { _trkRefreshAutoCompleteHint(); }
function onTrackerSignOffChange() {
  // If user picks a sign-off date and status isn't already Completed, prefill
  // the status select so the intent is explicit before saving.
  if (_trkGet('trk-edit-signed-off-on') && _trkGet('trk-edit-tracker-status') !== 'Completed') {
    _trkSet('trk-edit-tracker-status', 'Completed');
  }
  _trkRefreshAutoCompleteHint();
}

async function saveTrackerEdit() {
  if (!isManager) { alert('Manager access only.'); return; }
  var btn = document.getElementById('trk-edit-save-btn');
  var id  = parseInt(_trkGet('trk-edit-id'), 10);
  if (!id) { alert('Missing engagement id.'); return; }

  var trackerStatus = _trkGet('trk-edit-tracker-status');
  var topStatus     = _trkGet('trk-edit-status'); // one of the 8 top-level values
  var signedOn      = _trkGet('trk-edit-signed-off-on');

  var patch = {
    status:            topStatus || 'active',
    country:           _trkTextOrNull(_trkGet('trk-edit-country')),
    partner:           _trkTextOrNull(_trkGet('trk-edit-partner')),
    category:          _trkTextOrNull(_trkGet('trk-edit-category')),
    project_order_no:  _trkTextOrNull(_trkGet('trk-edit-project-order-no')),
    start_date:        _trkDateOrNull(_trkGet('trk-edit-start-date')),
    end_date:          _trkDateOrNull(_trkGet('trk-edit-end-date')),
    tracker_status:    trackerStatus || null,
    orch_version:      _trkTextOrNull(_trkGet('trk-edit-orch-version')),
    ec_version:        _trkTextOrNull(_trkGet('trk-edit-ec-version')),
    license_expiry:    _trkDateOrNull(_trkGet('trk-edit-license-expiry')),
    signed_off_on:     _trkDateOrNull(signedOn),
    owner_employee:    _trkTextOrNull(_trkGet('trk-edit-owner')),
    tracker_remarks:   _trkTextOrNull(_trkGet('trk-edit-remarks')),
    tracker_updated_at: new Date().toISOString()
  };

  // Sign-off OR tracker_status='Completed' flips engagement.status. We
  // override the user's top-status pick only if the user hasn't already
  // chosen an end state (cancelled / archived / completed / sign-off).
  if ((trackerStatus === 'Completed' || signedOn) &&
      patch.status !== 'completed' && patch.status !== 'cancelled' &&
      patch.status !== 'archived'  && patch.status !== 'sign-off') {
    patch.status = signedOn ? 'sign-off' : 'completed';
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Saving…';
  var { error } = await sb.from('engagements').update(patch).eq('id', id);
  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';
  if (typeof renderIcons === 'function') renderIcons();

  if (error) { alert('Error saving: ' + error.message); return; }

  // Invalidate the projects cache so engagement dropdowns + Manage Engagements
  // reflect the change without a full reload.
  if (typeof _projectsLoaded !== 'undefined') {
    _projectsLoaded = false;
    if (typeof loadProjects === 'function') {
      try { await loadProjects(); } catch(e){}
      if (typeof populateProjectDropdowns === 'function') populateProjectDropdowns();
    }
  }

  closeTrackerEditModal();
  await loadTracker();
}

async function deleteTrackerEngagement() {
  if (!isManager) { alert('Manager access only.'); return; }
  var id = parseInt(_trkGet('trk-edit-id'), 10);
  if (!id) return;
  var r = _trkData.find(function(x){return x.id===id;});
  if (!r) return;
  // Two-step confirm: this also cascade-deletes any milestones via the FK.
  var msg = 'Delete engagement "'+r.name+'"?\n\nThis will also delete its milestones (cascade) and cannot be undone.\n\nNote: any logged sessions referencing this engagement keep their snapshotted name and remain intact.';
  if (!confirm(msg)) return;
  var btn = document.getElementById('trk-edit-delete-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Deleting…'; }
  var { error } = await sb.from('engagements').delete().eq('id', id);
  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="trash-2" class="btn-icon"></i>Delete Engagement'; if (typeof renderIcons === 'function') renderIcons(); }
  if (error) { alert('Error deleting: '+error.message); return; }
  // Invalidate the projects cache so the deleted engagement disappears from
  // session dropdowns / Manage Engagements / Engagement Summary everywhere.
  if (typeof _projectsLoaded !== 'undefined') {
    _projectsLoaded = false;
    if (typeof loadProjects === 'function') {
      try { await loadProjects(); } catch(e){}
      if (typeof populateProjectDropdowns === 'function') populateProjectDropdowns();
    }
  }
  closeTrackerEditModal();
  await loadTracker();
}

// ── MILESTONES MODAL ───────────────────────────────────────────────

var _msEngagementId = null;
var _msData         = [];

async function openMilestonesModal(engagementId) {
  var eng = _trkData.find(function(x){return x.id===engagementId;});
  if (!eng) return;
  _msEngagementId = engagementId;
  closeTrackerDetail();

  document.getElementById('trk-ms-eng-name').textContent = eng.name || '';
  document.getElementById('trk-ms-eng-meta').textContent =
    (eng.customer_name||'—') + ' · ' + (eng.type||'').toUpperCase() +
    (eng.tracker_status?(' · '+eng.tracker_status):'');
  document.getElementById('trk-ms-eng-id').value = String(engagementId);
  document.getElementById('trk-ms-add-card').style.display = isManager ? 'block' : 'none';
  resetMilestoneForm();

  document.getElementById('trk-ms-modal').classList.add('show');
  await loadMilestones();
}

function closeMilestonesModal() {
  document.getElementById('trk-ms-modal').classList.remove('show');
  _msEngagementId = null;
  _msData = [];
}

async function loadMilestones() {
  var load = document.getElementById('trk-ms-load');
  var list = document.getElementById('trk-ms-list');
  load.style.display = 'flex';
  list.innerHTML = '';
  var { data, error } = await sb.from('engagement_milestones')
    .select('*')
    .eq('engagement_id', _msEngagementId)
    .order('sequence', {ascending:true})
    .order('id',       {ascending:true});
  load.style.display = 'none';
  if (error) {
    list.innerHTML = '<div class="alert alert-error show">Error: '+esc2(error.message)+'</div>';
    return;
  }
  _msData = data || [];
  renderMilestones();
}

function _msStatusBadge(s) {
  var map = {
    pending:     {label:'Pending',     cls:'trk-ms-st-pending'},
    in_progress: {label:'In Progress', cls:'trk-ms-st-progress'},
    completed:   {label:'Completed',   cls:'trk-ms-st-completed'},
    blocked:     {label:'Blocked',     cls:'trk-ms-st-blocked'}
  };
  var m = map[s] || {label:s||'—', cls:''};
  return '<span class="trk-ms-status '+m.cls+'">'+esc2(m.label)+'</span>';
}

function renderMilestones() {
  var list = document.getElementById('trk-ms-list');
  var prog = document.getElementById('trk-ms-progress');
  if (!_msData.length) {
    prog.style.display = 'none';
    list.innerHTML =
      '<div class="empty-state" style="padding:32px 16px">'+
        '<i data-lucide="list-checks" class="empty-icon-svg"></i>'+
        '<div class="empty-title">No milestones yet</div>'+
        '<div>'+(isManager?'Add your first milestone below.':'A manager can add milestones.')+'</div>'+
      '</div>';
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Top-level progress: ratio of completed milestones.
  var done = _msData.filter(function(m){return m.status==='completed';}).length;
  var pct  = Math.round((done / _msData.length) * 100);
  document.getElementById('trk-ms-progress-label').textContent = done+' of '+_msData.length+' milestones complete';
  document.getElementById('trk-ms-progress-pct').textContent   = pct+'%';
  document.getElementById('trk-ms-progress-fill').style.width  = pct+'%';
  prog.style.display = 'block';

  list.innerHTML = _msData.map(function(m, idx){
    var hasCount = (m.target_count!=null && m.target_count>0);
    var actual   = m.actual_count||0;
    var countPct = hasCount ? Math.min(100, Math.round((actual/m.target_count)*100)) : 0;
    var target   = m.target_date ? fmtDate(m.target_date) : '';
    var doneDate = m.completed_date ? fmtDate(m.completed_date) : '';
    var canEdit  = isManager;
    var sequence = m.sequence || (idx+1);

    var countBlock = hasCount
      ? '<div class="trk-ms-count">'+
          '<div class="trk-ms-count-text"><span class="num">'+actual+' / '+m.target_count+'</span> <span class="dim">('+countPct+'%)</span></div>'+
          '<div class="trk-ms-count-bar"><div class="trk-ms-count-fill" style="width:'+countPct+'%"></div></div>'+
        '</div>'
      : '';

    var notesBlock = m.notes
      ? '<div class="trk-ms-notes">'+esc2(m.notes)+'</div>'
      : '';

    var actions = canEdit
      ? '<div class="trk-ms-actions">'+
          (m.status!=='completed'
            ? '<button class="btn btn-sm" style="background:var(--success);color:white;border:none" onclick="markMilestoneComplete('+m.id+')" title="Mark Complete"><i data-lucide="check" class="btn-icon" style="margin-right:0"></i></button>'
            : '<button class="btn btn-sm btn-ghost" onclick="reopenMilestone('+m.id+')" title="Reopen"><i data-lucide="rotate-ccw" class="btn-icon" style="margin-right:0"></i></button>')+
          '<button class="btn btn-sm btn-ghost" onclick="editMilestoneInline('+m.id+')" title="Edit"><i data-lucide="pencil" class="btn-icon" style="margin-right:0"></i></button>'+
          '<button class="btn btn-sm btn-ghost" onclick="moveMilestone('+m.id+',-1)" title="Move up" '+(idx===0?'disabled':'')+'><i data-lucide="arrow-up" class="btn-icon" style="margin-right:0"></i></button>'+
          '<button class="btn btn-sm btn-ghost" onclick="moveMilestone('+m.id+',1)" title="Move down" '+(idx===_msData.length-1?'disabled':'')+'><i data-lucide="arrow-down" class="btn-icon" style="margin-right:0"></i></button>'+
          '<button class="btn btn-sm btn-danger" onclick="deleteMilestone('+m.id+')" title="Delete"><i data-lucide="trash-2" class="btn-icon" style="margin-right:0"></i></button>'+
        '</div>'
      : '';

    return '<div class="trk-ms-card '+(m.status==='completed'?'is-done':'')+'" id="trk-ms-card-'+m.id+'">'+
      '<div class="trk-ms-card-head">'+
        '<div class="trk-ms-seq num">'+sequence+'</div>'+
        '<div class="trk-ms-name">'+esc2(m.name)+'</div>'+
        _msStatusBadge(m.status)+
      '</div>'+
      '<div class="trk-ms-meta">'+
        (target   ? '<span><i data-lucide="calendar" class="trk-ms-meta-icon"></i>Target: <span class="num">'+target+'</span></span>'   : '')+
        (doneDate ? '<span><i data-lucide="check-circle-2" class="trk-ms-meta-icon"></i>Completed: <span class="num">'+doneDate+'</span></span>' : '')+
      '</div>'+
      countBlock +
      notesBlock +
      actions +
    '</div>';
  }).join('');
  if (typeof renderIcons === 'function') renderIcons();
}

function resetMilestoneForm() {
  ['trk-ms-new-name','trk-ms-new-target-date','trk-ms-new-target-count','trk-ms-new-actual-count','trk-ms-new-notes'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var st = document.getElementById('trk-ms-new-status'); if (st) st.value = 'pending';
}

async function addMilestone() {
  if (!isManager) { alert('Manager access only.'); return; }
  var name = (document.getElementById('trk-ms-new-name').value||'').trim();
  if (!name) { alert('Milestone name is required.'); return; }
  var btn = document.getElementById('trk-ms-add-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Adding…';

  var status = document.getElementById('trk-ms-new-status').value || 'pending';
  var targetDate  = document.getElementById('trk-ms-new-target-date').value || null;
  var targetCount = parseInt(document.getElementById('trk-ms-new-target-count').value, 10);
  var actualCount = parseInt(document.getElementById('trk-ms-new-actual-count').value, 10);
  var notes = (document.getElementById('trk-ms-new-notes').value||'').trim() || null;
  var nextSeq = _msData.length
    ? Math.max.apply(null, _msData.map(function(m){return m.sequence||0;})) + 1
    : 1;

  var payload = {
    engagement_id: _msEngagementId,
    sequence:      nextSeq,
    name:          name,
    target_date:   targetDate,
    status:        status,
    target_count:  isNaN(targetCount) ? null : targetCount,
    actual_count:  isNaN(actualCount) ? null : actualCount,
    notes:         notes
  };
  if (status === 'completed') payload.completed_date = new Date().toISOString().split('T')[0];

  var { error } = await sb.from('engagement_milestones').insert(payload);
  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="plus" class="btn-icon"></i>Add Milestone';
  if (typeof renderIcons === 'function') renderIcons();
  if (error) { alert('Error: '+error.message); return; }
  resetMilestoneForm();
  await loadMilestones();
}

async function markMilestoneComplete(id) {
  if (!isManager) return;
  var today = new Date().toISOString().split('T')[0];
  var { error } = await sb.from('engagement_milestones').update({
    status: 'completed', completed_date: today, updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { alert('Error: '+error.message); return; }
  await loadMilestones();
}

async function reopenMilestone(id) {
  if (!isManager) return;
  var { error } = await sb.from('engagement_milestones').update({
    status: 'in_progress', completed_date: null, updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { alert('Error: '+error.message); return; }
  await loadMilestones();
}

async function moveMilestone(id, delta) {
  if (!isManager) return;
  var idx = _msData.findIndex(function(m){return m.id===id;});
  if (idx < 0) return;
  var swapIdx = idx + delta;
  if (swapIdx < 0 || swapIdx >= _msData.length) return;
  var a = _msData[idx], b = _msData[swapIdx];
  // Use distinct sequence values so the order is stable after refresh.
  var aSeq = a.sequence || (idx+1);
  var bSeq = b.sequence || (swapIdx+1);
  if (aSeq === bSeq) { aSeq = idx+1; bSeq = swapIdx+1; }
  var ts = new Date().toISOString();
  var r1 = await sb.from('engagement_milestones').update({sequence:bSeq, updated_at:ts}).eq('id', a.id);
  if (r1.error) { alert('Error: '+r1.error.message); return; }
  var r2 = await sb.from('engagement_milestones').update({sequence:aSeq, updated_at:ts}).eq('id', b.id);
  if (r2.error) { alert('Error: '+r2.error.message); return; }
  await loadMilestones();
}

async function deleteMilestone(id) {
  if (!isManager) return;
  var m = _msData.find(function(x){return x.id===id;});
  if (!m) return;
  if (!confirm('Delete milestone "'+m.name+'"? This cannot be undone.')) return;
  var { error } = await sb.from('engagement_milestones').delete().eq('id', id);
  if (error) { alert('Error: '+error.message); return; }
  await loadMilestones();
}

function editMilestoneInline(id) {
  if (!isManager) return;
  var m = _msData.find(function(x){return x.id===id;});
  if (!m) return;
  var card = document.getElementById('trk-ms-card-'+id);
  if (!card) return;
  // Build markup without user-supplied content; populate values via DOM
  // afterward to sidestep HTML/JS escaping issues for names with quotes.
  card.innerHTML =
    '<div class="form-grid mb-4">'+
      '<div class="form-group full"><label>Name</label><input type="text" id="trk-ms-edit-name-'+id+'"></div>'+
      '<div class="form-group"><label>Target Date</label><input type="date" id="trk-ms-edit-target-'+id+'"></div>'+
      '<div class="form-group"><label>Status</label><select id="trk-ms-edit-status-'+id+'">'+
        ['pending','in_progress','completed','blocked'].map(function(s){
          return '<option value="'+s+'">'+s.replace('_',' ')+'</option>';
        }).join('')+
      '</select></div>'+
      '<div class="form-group"><label>Target Count</label><input type="number" id="trk-ms-edit-target-count-'+id+'" min="0"></div>'+
      '<div class="form-group"><label>Actual Count</label><input type="number" id="trk-ms-edit-actual-count-'+id+'" min="0"></div>'+
      '<div class="form-group full"><label>Notes</label><textarea id="trk-ms-edit-notes-'+id+'" rows="2"></textarea></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button class="btn btn-primary btn-sm" onclick="saveMilestoneInline('+id+')"><i data-lucide="save" class="btn-icon"></i>Save</button>'+
      '<button class="btn btn-ghost btn-sm" onclick="loadMilestones()">Cancel</button>'+
    '</div>';
  document.getElementById('trk-ms-edit-name-'+id).value         = m.name || '';
  document.getElementById('trk-ms-edit-target-'+id).value       = m.target_date || '';
  document.getElementById('trk-ms-edit-status-'+id).value       = m.status || 'pending';
  document.getElementById('trk-ms-edit-target-count-'+id).value = (m.target_count==null?'':m.target_count);
  document.getElementById('trk-ms-edit-actual-count-'+id).value = (m.actual_count==null?'':m.actual_count);
  document.getElementById('trk-ms-edit-notes-'+id).value        = m.notes || '';
  if (typeof renderIcons === 'function') renderIcons();
}

async function saveMilestoneInline(id) {
  if (!isManager) return;
  var name = (document.getElementById('trk-ms-edit-name-'+id).value||'').trim();
  if (!name) { alert('Name is required.'); return; }
  var status = document.getElementById('trk-ms-edit-status-'+id).value;
  var tgt    = document.getElementById('trk-ms-edit-target-'+id).value || null;
  var tc     = parseInt(document.getElementById('trk-ms-edit-target-count-'+id).value, 10);
  var ac     = parseInt(document.getElementById('trk-ms-edit-actual-count-'+id).value, 10);
  var notes  = (document.getElementById('trk-ms-edit-notes-'+id).value||'').trim() || null;
  var patch = {
    name: name, status: status, target_date: tgt,
    target_count: isNaN(tc) ? null : tc,
    actual_count: isNaN(ac) ? null : ac,
    notes: notes,
    updated_at: new Date().toISOString()
  };
  // Auto-stamp completed_date when flipping to completed; clear when leaving.
  var existing = _msData.find(function(x){return x.id===id;});
  if (status === 'completed' && existing && existing.status !== 'completed') {
    patch.completed_date = new Date().toISOString().split('T')[0];
  } else if (status !== 'completed') {
    patch.completed_date = null;
  }
  var { error } = await sb.from('engagement_milestones').update(patch).eq('id', id);
  if (error) { alert('Error: '+error.message); return; }
  await loadMilestones();
}
