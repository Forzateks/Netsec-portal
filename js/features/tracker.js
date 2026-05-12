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
// Phase = workflow step within an ACTIVE project. Lifecycle states like
// Completed / Cancelled / Dormant / Sign-off live exclusively on
// engagement.status (the top-level Status field). The 13 phase values
// here are enforced by the CHECK constraint on engagements.tracker_status.
var TRK_PHASES = [
  'Yet to start',
  'Kick-off',
  'HLD Discussion',
  'HLD Documentation',
  'LLD Discussion',
  'LLD Documentation',
  'Initial Configuration',
  'Pilot Sites Rollout',
  'Migration',
  'KT / Training',
  'As-Built Documentation',
  'Troubleshooting',
  'On demand request'
];
// Phase dropdown is only enabled when the top-level status is exactly
// 'active'. Every other status (sign-off, completed, on-hold, dormant,
// cancelled) means the project isn't currently in a workflow phase, so
// the Phase select is disabled and force-cleared.
var TRK_PHASE_ALLOWED_STATUSES = ['active'];

// Legacy compat — Phase list is now the same regardless of type.
function trkStatusesFor(/*type*/) { return TRK_PHASES.slice(); }

function showTrackerTab(tab) {
  _trkActiveTab = tab;
  setSidebarSubActive('tracker', tab);
  // The Status filter is the 6-value top-level enum and is the same for
  // every tab — it's populated once by populateTrackerFilters() and must
  // NOT be re-initialised here. Older code reseeded it with TRK_PHASES
  // (the workflow phase list), which is what produced phase values in the
  // Status dropdown after the v21 Status/Phase split.
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
  // Top-level status filter — the fixed 6-value enum (active, sign-off,
  // completed, on-hold, dormant, cancelled). Hardcoded from TRK_TOP_STATUS_MAP
  // so the dropdown never drifts with data. Labels carry the emoji so the
  // option list matches the status badge in the table. The workflow Phase
  // (tracker_status) is a separate concept and is filtered inside the
  // detail/edit modal, not from this bar.
  msInit('trk-filter-status',
    TRK_TOP_STATUS_ORDER.map(function(k){
      var def = TRK_TOP_STATUS_MAP[k];
      return { value:k, label: def.icon + ' ' + def.label };
    }),
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

  // Live work bubbles to the top, paused next, concluded last — so day-to-day
  // engagements are visible without scrolling. Sort key is the TOP-LEVEL
  // status (engagement.status), normalised through _trkTopStatusKey so legacy
  // 'ongoing' / null values still bucket correctly.
  var STATUS_TIER = {
    'active':    0, 'sign-off':  0,    // live work
    'on-hold':   1,                    // paused, expected to resume
    'completed': 2, 'dormant':   2, 'cancelled': 2  // concluded
  };
  filtered.sort(function(a,b){
    var at = STATUS_TIER[_trkTopStatusKey(a.status)];
    var bt = STATUS_TIER[_trkTopStatusKey(b.status)];
    if (at == null) at = 1;
    if (bt == null) bt = 1;
    if (at !== bt) return at - bt;
    var au = a.tracker_updated_at ? new Date(a.tracker_updated_at).getTime() : 0;
    var bu = b.tracker_updated_at ? new Date(b.tracker_updated_at).getTime() : 0;
    return bu - au;
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
  'active','sign-off','completed','on-hold','dormant','cancelled'
];
var TRK_TOP_STATUS_MAP = {
  'active':    { label:'Active',    icon:'🟢', cls:'trk-st-active' },
  'sign-off':  { label:'Sign-off',  icon:'✍️', cls:'trk-st-signoff' },
  'completed': { label:'Completed', icon:'✅', cls:'trk-st-completed' },
  'on-hold':   { label:'On Hold',   icon:'⏸️', cls:'trk-st-onhold' },
  'dormant':   { label:'Dormant',   icon:'💤', cls:'trk-st-dormant' },
  'cancelled': { label:'Cancelled', icon:'❌', cls:'trk-st-cancelled' }
};
function _trkTopStatusKey(raw) {
  var v = (raw == null ? '' : String(raw)).trim().toLowerCase();
  if (!v) return 'active';
  if (TRK_TOP_STATUS_MAP[v]) return v;
  // Historical aliases — if any legacy / hand-inserted data ever surfaces
  // with the old keys, route it to the closest current bucket so the
  // renderer doesn't fall back to an unknown grey badge.
  if (v === 'on hold' || v === 'onhold')   return 'on-hold';
  if (v === 'sign off' || v === 'signoff') return 'sign-off';
  if (v === 'ongoing')                     return 'active';   // retired in v22
  if (v === 'archived')                    return 'dormant';  // retired in v22
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

// Thin horizontal status strip — replaces the 7-card grid. Each segment is
// clickable: clicking sets the status filter to that single value (toggle off
// to clear). The Total segment is non-interactive and resets nothing.
function renderTrackerStatRow() {
  var wrap = document.getElementById('trk-stat-row');
  if (!wrap) return;
  var rows = _trkData;
  function statusKey(r){ return _trkTopStatusKey(r.status); }
  var counts = {
    'active':    rows.filter(function(r){return statusKey(r)==='active';}).length,
    'sign-off':  rows.filter(function(r){return statusKey(r)==='sign-off';}).length,
    'on-hold':   rows.filter(function(r){return statusKey(r)==='on-hold';}).length,
    'completed': rows.filter(function(r){return statusKey(r)==='completed';}).length,
    'dormant':   rows.filter(function(r){return statusKey(r)==='dormant';}).length,
    'cancelled': rows.filter(function(r){return statusKey(r)==='cancelled';}).length
  };
  // Mirror the badge palette so the strip reads as a colour key for the table.
  var THEME = {
    'active':    {bg:'#DCFCE7', fg:'#166534'},
    'sign-off':  {bg:'#FEF3C7', fg:'#92400E'},
    'on-hold':   {bg:'#FED7AA', fg:'#9A3412'},
    'completed': {bg:'#E0F2FE', fg:'#075985'},
    'dormant':   {bg:'#F3F4F6', fg:'#4B5563'},
    'cancelled': {bg:'#FEE2E2', fg:'#991B1B'}
  };
  // Current single-value selection (if any) so we can highlight that segment.
  var selected = msGetValues('trk-filter-status');
  var soleSel  = (selected.length === 1) ? selected[0] : null;

  var segs = ['active','sign-off','on-hold','completed','dormant','cancelled'].map(function(k){
    var def = TRK_TOP_STATUS_MAP[k];
    var th  = THEME[k];
    var isSel = (soleSel === k);
    var style = 'background:'+th.bg+';color:'+th.fg+';'+(isSel?'box-shadow:inset 0 0 0 2px '+th.fg:'');
    return '<button class="trk-strip-seg'+(isSel?' is-selected':'')+'" '+
      'style="'+style+'" '+
      'onclick="trkSelectStatusSegment(\''+k+'\')" '+
      'title="Filter by '+def.label+'">'+
      '<span class="trk-strip-ico">'+def.icon+'</span>'+
      '<span class="trk-strip-num num">'+counts[k]+'</span>'+
      '<span class="trk-strip-lbl">'+def.label+'</span>'+
    '</button>';
  }).join('<span class="trk-strip-dot">•</span>');

  wrap.innerHTML =
    '<div class="trk-strip-total"><span class="num">'+rows.length+'</span> Total</div>'+
    '<span class="trk-strip-dot">•</span>'+
    segs;
}

// Click a status segment → set the status filter to that single value (or
// clear if the same segment was already selected). Keeps the multi-select
// widget as the single source of truth for filter state.
function trkSelectStatusSegment(key) {
  var current = msGetValues('trk-filter-status');
  if (current.length === 1 && current[0] === key) {
    msSetValues('trk-filter-status', []);
  } else {
    msSetValues('trk-filter-status', [key]);
  }
  renderTracker();
}

// Toggle the collapsible filter panel and update the toggle button label.
function trkToggleFilters() {
  var panel = document.getElementById('trk-filter-panel');
  var btn   = document.getElementById('trk-filter-toggle');
  if (!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (btn) btn.classList.toggle('is-open', !open);
}

// Render removable chips for every non-empty filter so the user always knows
// what's applied without having to expand the panel. Status chips use the
// badge label for readability.
function trkRenderActiveChips() {
  var host = document.getElementById('trk-active-chips');
  if (!host) return;
  var chips = [];
  function push(group, label, onRemove){
    chips.push('<span class="trk-chip">'+
      '<span class="trk-chip-group">'+esc2(group)+':</span> '+esc2(label)+
      '<button class="trk-chip-x" onclick="'+onRemove+'" title="Remove">×</button>'+
    '</span>');
  }
  msGetValues('trk-filter-country').forEach(function(v){
    push('Country', v, "trkRemoveMsValue('trk-filter-country','"+_escAttr(v)+"')");
  });
  msGetValues('trk-filter-partner').forEach(function(v){
    push('Partner', v, "trkRemoveMsValue('trk-filter-partner','"+_escAttr(v)+"')");
  });
  msGetValues('trk-filter-status').forEach(function(v){
    var def = TRK_TOP_STATUS_MAP[v];
    push('Status', def ? def.label : v, "trkRemoveMsValue('trk-filter-status','"+_escAttr(v)+"')");
  });
  msGetValues('trk-filter-owner').forEach(function(v){
    push('Owner', v, "trkRemoveMsValue('trk-filter-owner','"+_escAttr(v)+"')");
  });
  var sf = (document.getElementById('trk-filter-start-from')||{}).value || '';
  var st = (document.getElementById('trk-filter-start-to')  ||{}).value || '';
  if (sf) push('Start from', sf, "trkClearDateInput('trk-filter-start-from')");
  if (st) push('Start to',   st, "trkClearDateInput('trk-filter-start-to')");

  host.style.display = chips.length ? 'flex' : 'none';
  if (chips.length) {
    host.innerHTML = chips.join('') +
      '<button class="trk-chip-clear" onclick="clearTrackerFilters()">Clear all</button>';
  } else {
    host.innerHTML = '';
  }
}
function _escAttr(s){ return String(s==null?'':s).replace(/'/g,"\\'"); }
function trkRemoveMsValue(id, value) {
  var cur = msGetValues(id).filter(function(v){return v !== value;});
  msSetValues(id, cur);
  renderTracker();
}
function trkClearDateInput(id) {
  var el = document.getElementById(id);
  if (el) el.value = '';
  renderTracker();
}

// Primary CTA on the tracker page. Engagements are created from the Manage
// Engagements sub-tab (the single source of truth — no duplicate form here).
function trkOpenNew() {
  if (typeof showScreen === 'function') showScreen('projects');
  if (typeof showProjectsTab === 'function') showProjectsTab('manage');
}

function renderTracker() {
  renderTrackerStatRow();
  trkRenderActiveChips();

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
      '<div class="empty-title">No engagements match your filters</div>'+
      '<div style="margin-bottom:14px">Try removing a filter or clearing them all.</div>'+
      '<button class="btn btn-primary" onclick="clearTrackerFilters()"><i data-lucide="x" class="btn-icon"></i>Clear filters</button>'+
      '</div>';
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // 6-column layout (was 9): Engagement / Customer / Owner / Status / Updated / Action.
  // Type rolls into the Engagement cell as a tiny label; Country folds under
  // Customer as muted small text; Partner, Category and License Expiry move
  // out of the row entirely — still available via the detail modal + filters.
  var th =
    '<tr>'+
      '<th>Engagement</th>'+
      '<th>Customer</th>'+
      '<th class="hide-mobile">Owner</th>'+
      '<th>Status</th>'+
      '<th class="hide-mobile">Updated</th>'+
      '<th></th>'+
    '</tr>';

  var body = rows.map(function(r){
    // Concluded work gets muted text so managers' eyes naturally land on live rows.
    var sk = _trkTopStatusKey(r.status);
    var muted = (sk === 'completed' || sk === 'cancelled' || sk === 'dormant');
    var typeLabel = r.type === 'poc'      ? '🎯 POC'
                  : r.type === 'amc'      ? '🛠️ AMC'
                  : r.type === 'presales' ? '💼 Pre-sales'
                  :                         '📁 Project';
    // Remarks preview — Gmail/Linear-style snippet under the name. Collapse
    // newlines to spaces so multi-line remarks render as one line, trim,
    // then truncate at 60 chars with an ellipsis. Empty remarks → no line.
    var remarksRaw  = (r.tracker_remarks || '').replace(/\s+/g,' ').trim();
    var remarksLine = '';
    if (remarksRaw) {
      var snippet = remarksRaw.length > 60 ? remarksRaw.slice(0,60).replace(/\s+$/,'') + '…' : remarksRaw;
      remarksLine = '<div class="trk-cell-remarks" title="'+esc2(remarksRaw)+'">'+esc2(snippet)+'</div>';
    }
    return '<tr class="trk-row'+(muted?' trk-row-muted':'')+'" onclick="openTrackerDetail('+r.id+')">'+
      '<td>'+
        '<div class="trk-cell-type">'+typeLabel+'</div>'+
        '<div class="trk-cell-name">'+esc2(r.name||'—')+'</div>'+
        (r.project_order_no?'<div class="trk-cell-sub num">PO: '+esc2(r.project_order_no)+'</div>':'')+
        remarksLine+
      '</td>'+
      '<td>'+
        '<div>'+esc2(r.customer_name||'—')+'</div>'+
        (r.country?'<div class="trk-cell-sub">'+esc2(r.country)+'</div>':'')+
      '</td>'+
      '<td class="hide-mobile">'+esc2(r.owner_employee||'—')+'</td>'+
      '<td>'+trkTopStatusBadge(r.status)+'</td>'+
      '<td class="hide-mobile dim num" style="font-size:12px">'+(r.tracker_updated_at?fmtDate(r.tracker_updated_at):'—')+'</td>'+
      '<td><button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openTrackerDetail('+r.id+')"><i data-lucide="eye" class="btn-icon"></i><span class="hide-mobile">View</span></button></td>'+
    '</tr>';
  }).join('');

  content.innerHTML = tabBar +
    '<div class="card trk-table-card" style="padding:0">'+
      '<div class="table-wrap"><table class="trk-table"><thead>'+th+'</thead><tbody>'+body+'</tbody></table></div>'+
    '</div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+_trkData.length+' engagements</div>';
  if (typeof renderIcons === 'function') renderIcons();
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
  var html = '<option value="">— None —</option>';
  // Defensive legacy preservation — should be rare after the v20 cleanup
  // migration but if any row slips through with an out-of-list value,
  // surface it as "(legacy)" so the manager can re-select correctly.
  if (preserve && TRK_PHASES.indexOf(preserve) === -1) {
    html += '<option value="'+esc2(preserve)+'" selected>'+esc2(preserve)+' (legacy)</option>';
  }
  TRK_PHASES.forEach(function(v){
    html += '<option>'+esc2(v)+'</option>';
  });
  sel.innerHTML = html;
  if (preserve && TRK_PHASES.indexOf(preserve) !== -1) sel.value = preserve;
}

// When the user picks a terminal/paused top-level status (completed,
// sign-off, cancelled, dormant, archived) the Phase field becomes
// meaningless — disable it and force-clear the value. Re-running on
// every form-load + Status-change keeps the two fields in sync.
function _trkUpdatePhaseEnabledState() {
  var statusSel = document.getElementById('trk-edit-status');
  var phaseSel  = document.getElementById('trk-edit-tracker-status');
  var helper    = document.getElementById('trk-edit-phase-helper');
  if (!statusSel || !phaseSel) return;
  var topStatus = statusSel.value || 'active';
  var allowed = TRK_PHASE_ALLOWED_STATUSES.indexOf(topStatus) !== -1;
  if (!allowed) {
    phaseSel.value = '';
    phaseSel.disabled = true;
    if (helper) helper.textContent = 'Phase only applies to active projects';
  } else {
    phaseSel.disabled = false;
    if (helper) helper.textContent = 'Workflow phase within an active project';
  }
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
  // Apply the Phase enable/disable rule based on the just-set top status.
  _trkUpdatePhaseEnabledState();
  document.getElementById('trk-edit-info').style.display = 'none';

  document.getElementById('trk-edit-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeTrackerEditModal() {
  document.getElementById('trk-edit-modal').classList.remove('show');
}

// Show a hint when a sign-off date is set — saving will auto-flip the
// top-level engagement.status to 'sign-off' (unless the user has already
// picked a terminal state). Phase no longer has a 'Completed' value
// after the v20 cleanup so it can't trigger the auto-flip on its own.
function _trkRefreshAutoCompleteHint() {
  var signedOn = _trkGet('trk-edit-signed-off-on');
  var topStat  = _trkGet('trk-edit-status') || 'active';
  var box = document.getElementById('trk-edit-info');
  if (!box) return;
  var willAutoFlip = signedOn &&
    topStat !== 'completed' && topStat !== 'cancelled' &&
    topStat !== 'sign-off';
  if (willAutoFlip) {
    box.style.display = 'block';
    box.innerHTML = '<i data-lucide="info" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>'+
      'Saving will set <strong>Status = Sign-off</strong> across the app because a sign-off date is recorded.';
    if (typeof renderIcons === 'function') renderIcons();
  } else {
    box.style.display = 'none';
  }
}
function onTrackerStatusChange() {
  // Phase select onchange — only meaningful for the auto-complete hint
  // refresh. The disable/enable rule keys off the top-level Status field
  // and is handled by _trkUpdatePhaseEnabledState.
  _trkRefreshAutoCompleteHint();
}
function onTrackerSignOffChange() { _trkRefreshAutoCompleteHint(); }

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

  // A sign-off date flips engagement.status to 'sign-off' unless the user
  // has already chosen an end state (cancelled / completed / sign-off).
  // 'archived' is no longer a valid status after v22 so it's dropped from
  // the guard.
  if (signedOn &&
      patch.status !== 'completed' && patch.status !== 'cancelled' &&
      patch.status !== 'sign-off') {
    patch.status = 'sign-off';
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
