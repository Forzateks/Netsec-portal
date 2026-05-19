// == PROJECT / POC TRACKER ==========================================
// Read-only list view of engagements with their tracker-level metadata
// (country, partner, owner, status, versions, license expiry, etc.).
// Phase 4 will add the edit form + milestone management.

var _trkData      = [];
var _trkActiveTab = 'all';   // 'all' | 'projects' | 'pocs' | 'amc' | 'support'

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
  // Reset the strip's animation gate so the count-up plays again on
  // every fresh navigation to the tracker (per spec: "navigating away
  // and back triggers the animation again").
  var strip = document.getElementById('trk-stat-row');
  if (strip) strip._stripAnimated = false;

  // Fetch engagements and customers separately, then join client-side.
  // Avoids relying on Supabase nested-select FK metadata.
  var engRes = await fetchAllRows(function(){
    return sb.from('engagements')
      .select('id,customer_id,name,type,status,vendor,product_line,country,partner,category,project_order_no,start_date,end_date,tracker_status,orch_version,ec_version,license_expiry,signed_off_on,owner_employee,tracker_remarks,tracker_updated_at,updated_by,created_at,converted_to_project,is_archived')
      .eq('is_archived', false)
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
  // Deep-link support: seed the search input from ?customer=<name> BEFORE
  // the first render so the filter is applied on first paint — avoids the
  // brief flash of unfiltered rows users would otherwise see after clicking
  // a customer chip in Manage Engagements. _trkApplyUrlParams returns early
  // when no ?customer= is set, so non-deep-link loads pay no cost.
  _trkApplyUrlParams();
  renderTracker();
}

function populateTrackerFilters() {
  var countries = {}, partners = {}, owners = {}, vendors = {}, productLines = {};
  _trkData.forEach(function(r){
    if (r.country)        countries[r.country] = 1;
    if (r.partner)        partners[r.partner] = 1;
    if (r.owner_employee) owners[r.owner_employee] = 1;
    if (r.vendor)         vendors[r.vendor] = 1;
    if (r.product_line)   productLines[r.product_line] = 1;
  });
  var toItems = function(obj){
    return Object.keys(obj).sort().map(function(v){return {value:v,label:v};});
  };
  // Multi-select dropdowns; selection persists across re-init via the
  // element's _selected Set (msInit drops values no longer present).
  msInit('trk-filter-country', toItems(countries), applyTrackerFilters);
  msInit('trk-filter-partner', toItems(partners),  applyTrackerFilters);
  msInit('trk-filter-owner',   toItems(owners),    applyTrackerFilters);
  msInit('trk-filter-vendor',  toItems(vendors),   applyTrackerFilters);
  msInit('trk-filter-product-line', toItems(productLines), applyTrackerFilters);
  // Top-level status filter — the fixed 6-value enum (active, sign-off,
  // completed, on-hold, dormant, cancelled). Hardcoded from TRK_TOP_STATUS_MAP
  // so the dropdown never drifts with data. Labels carry the emoji so the
  // option list matches the status badge in the table. The workflow Phase
  // (tracker_status) is a separate concept and is filtered inside the
  // detail/edit modal, not from this bar.
  msInit('trk-filter-status',
    TRK_TOP_STATUS_ORDER.map(function(k){
      var def = TRK_TOP_STATUS_MAP[k];
      var glyph = TRK_STATUS_OPTION_GLYPH[k] || '';
      return { value:k, label: (glyph ? glyph + ' ' : '') + def.label };
    }),
    applyTrackerFilters);
}

function clearTrackerFilters() {
  var search = document.getElementById('trk-search'); if (search) search.value = '';
  ['trk-filter-country','trk-filter-partner','trk-filter-status','trk-filter-owner','trk-filter-vendor','trk-filter-product-line'].forEach(function(id){
    msSetValues(id, []);
  });
  var sf = document.getElementById('trk-filter-start-from'); if (sf) sf.value = '';
  var st = document.getElementById('trk-filter-start-to');   if (st) st.value = '';
  _trkUpdateUrlFromSearch();
  renderTracker();
}

function applyTrackerFilters() { renderTracker(); }

// Search input change handler — keeps the URL ?customer= param in sync with
// the live search value so the current view is deep-linkable / shareable.
// replaceState (not pushState) so we don't pile up history entries on every
// keystroke; back button still returns the user to wherever they came from.
function _trkOnSearchInput() {
  applyTrackerFilters();
  _trkUpdateUrlFromSearch();
}

function _trkUpdateUrlFromSearch() {
  try {
    var v = ((document.getElementById('trk-search')||{}).value || '').trim();
    var url = new URL(window.location.href);
    if (v) url.searchParams.set('customer', v);
    else   url.searchParams.delete('customer');
    history.replaceState(history.state, '', url.toString());
  } catch (e) { /* no-op on older browsers */ }
}

// Read ?customer= from the URL and seed the tracker search input. The
// original chip-wall navigator that set this param is gone, but the
// handler stays so other deep-links (manual URLs, future entry points)
// keep working. Seed-only — the caller renders. loadTracker calls this
// BEFORE renderTracker so the first paint already carries the filter (no
// flash of unfiltered rows). popstate calls this then renders explicitly
// because the screen is already loaded by then.
function _trkApplyUrlParams() {
  try {
    var params = new URLSearchParams(window.location.search);
    var customer = params.get('customer');
    if (!customer) return;
    var s = document.getElementById('trk-search');
    if (s && s.value !== customer) s.value = customer;
  } catch (e) { /* no-op */ }
}

// Back/forward button → re-read the URL and re-sync the search input.
// Only acts when we're actually on the tracker screen; otherwise leaves the
// browser default behaviour alone.
window.addEventListener('popstate', function(){
  var tracker = document.getElementById('screen-tracker');
  if (!tracker || !tracker.classList.contains('active')) return;
  var params = new URLSearchParams(window.location.search);
  var customer = params.get('customer') || '';
  var s = document.getElementById('trk-search');
  if (s && s.value !== customer) {
    s.value = customer;
    applyTrackerFilters();
  }
});

function _trkFilteredRows() {
  var search    = ((document.getElementById('trk-search')||{}).value||'').toLowerCase().trim();
  var countries    = msGetValues('trk-filter-country');
  var partners     = msGetValues('trk-filter-partner');
  var statuses     = msGetValues('trk-filter-status');   // top-level status
  var owners       = msGetValues('trk-filter-owner');
  var vendors      = msGetValues('trk-filter-vendor');
  var productLines = msGetValues('trk-filter-product-line');
  var startFrom = ((document.getElementById('trk-filter-start-from')||{}).value || '');
  var startTo   = ((document.getElementById('trk-filter-start-to')||{}).value   || '');

  var filtered = _trkData.filter(function(r){
    if (_trkActiveTab === 'projects' && r.type !== 'project') return false;
    if (_trkActiveTab === 'pocs'     && r.type !== 'poc')     return false;
    if (_trkActiveTab === 'amc'      && r.type !== 'amc')     return false;
    if (_trkActiveTab === 'support'  && r.type !== 'support') return false;
    if (countries.length    && countries.indexOf(r.country)        === -1) return false;
    if (partners.length     && partners.indexOf(r.partner)         === -1) return false;
    if (vendors.length      && vendors.indexOf(r.vendor)           === -1) return false;
    if (productLines.length && productLines.indexOf(r.product_line) === -1) return false;
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
    'active':    0, 'sign-off':  0, 'payment-pending': 0,  // live work / needs follow-up
    'on-hold':   1,                                        // paused, expected to resume
    'closed':    2, 'dormant':   2, 'cancelled': 2         // concluded
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
// Lifecycle order: Active → Sign-off → Payment Pending → Closed, with
// On Hold / Dormant / Cancelled as off-ramp states after the happy path.
// (Status 'closed' is the post-v56 rename of the old 'completed' value —
// the row is finished regardless of POC-conversion outcome, which now
// lives in its own engagements.converted_to_project boolean.)
var TRK_TOP_STATUS_ORDER = [
  'active','sign-off','payment-pending','closed','on-hold','dormant','cancelled'
];
// Icon column carries a LUCIDE name (rendered as <i data-lucide>) for the
// badge / strip / detail-modal surfaces. Filter dropdown options can't render
// SVG (the .ms widget escapes labels), so populateTrackerFilters() uses a
// short Unicode glyph for those — see the EMOJI_FOR_OPTION map below.
var TRK_TOP_STATUS_MAP = {
  'active':          { label:'Active',          icon:'circle',         cls:'trk-st-active' },
  'sign-off':        { label:'Sign-off',        icon:'pen-tool',       cls:'trk-st-signoff' },
  'payment-pending': { label:'Payment Pending', icon:'wallet',         cls:'trk-st-paypending' },
  'closed':          { label:'Closed',          icon:'check-circle-2', cls:'trk-st-closed' },
  'on-hold':   { label:'On Hold',   icon:'pause-circle',   cls:'trk-st-onhold' },
  'dormant':   { label:'Dormant',   icon:'moon',           cls:'trk-st-dormant' },
  'cancelled': { label:'Cancelled', icon:'x-circle',       cls:'trk-st-cancelled' }
};
// Unicode glyphs for the multi-select dropdown labels only — those go
// through esc2() so they can't render an SVG tag. Same six statuses.
var TRK_STATUS_OPTION_GLYPH = {
  'active':'🟢','sign-off':'✍️','payment-pending':'💰','closed':'✅','on-hold':'⏸️','dormant':'💤','cancelled':'❌'
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
  return '<span class="badge '+def.cls+'"><i data-lucide="'+def.icon+'" class="trk-st-icon"></i> '+def.label+'</span>';
}

// Conversion badge — only rendered for closed POCs. Green "Converted" when
// the customer adopted the POC into a paid engagement, grey "Not converted"
// otherwise. For active / dormant POCs the outcome is undefined, so callers
// should pass an empty string and we render nothing.
function trkConvertedBadge(row) {
  if (!row || row.type !== 'poc') return '';
  if (row.status !== 'closed') return '';
  return row.converted_to_project
    ? '<span class="badge trk-conv trk-conv-won"><i data-lucide="check" class="trk-st-icon"></i> Converted</span>'
    : '<span class="badge trk-conv trk-conv-none">Not converted</span>';
}

function trkTypeBadge(t) {
  if (t === 'poc')     return '<span class="badge trk-type trk-type-poc">POC</span>';
  if (t === 'project') return '<span class="badge trk-type trk-type-project">Project</span>';
  if (t === 'amc')     return '<span class="badge trk-type trk-type-amc">AMC</span>';
  if (t === 'support') return '<span class="badge trk-type trk-type-support">Support</span>';
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
    'active':          rows.filter(function(r){return statusKey(r)==='active';}).length,
    'sign-off':        rows.filter(function(r){return statusKey(r)==='sign-off';}).length,
    'payment-pending': rows.filter(function(r){return statusKey(r)==='payment-pending';}).length,
    'closed':          rows.filter(function(r){return statusKey(r)==='closed';}).length,
    'on-hold':         rows.filter(function(r){return statusKey(r)==='on-hold';}).length,
    'dormant':         rows.filter(function(r){return statusKey(r)==='dormant';}).length,
    'cancelled':       rows.filter(function(r){return statusKey(r)==='cancelled';}).length
  };
  // Mirror the badge palette so the strip reads as a colour key for the table.
  var THEME = {
    'active':          {bg:'#DCFCE7', fg:'#166534'},
    'sign-off':        {bg:'#FEF3C7', fg:'#92400E'},
    'payment-pending': {bg:'#FEF9C3', fg:'#854D0E'},
    'closed':          {bg:'#E0F2FE', fg:'#075985'},
    'on-hold':         {bg:'#FED7AA', fg:'#9A3412'},
    'dormant':         {bg:'#F3F4F6', fg:'#4B5563'},
    'cancelled':       {bg:'#FEE2E2', fg:'#991B1B'}
  };
  // Multi-select highlight — any segment whose key is in the current filter
  // array reads as selected. Empty array = no filter; every segment subtle.
  var selected = msGetValues('trk-filter-status');

  var segs = ['active','sign-off','payment-pending','closed','on-hold','dormant','cancelled'].map(function(k){
    var def = TRK_TOP_STATUS_MAP[k];
    var th  = THEME[k];
    var isSel = (selected.indexOf(k) !== -1);
    // Selected: full status color + 2px solid border + checkmark prefix.
    // Unselected: muted neutral pill so selected ones pop visually.
    var style = isSel
      ? 'background:'+th.bg+';color:'+th.fg+';border:2px solid '+th.fg+';padding:3px 9px'
      : 'background:#F3F4F6;color:#6B7280;border:1px solid transparent';
    var checkIcon = isSel
      ? '<i data-lucide="check" class="trk-strip-check"></i>'
      : '';
    return '<button class="trk-strip-seg'+(isSel?' is-selected':'')+'" '+
      'data-key="'+k+'" '+
      'role="button" aria-pressed="'+isSel+'" '+
      'aria-label="'+(isSel?'Remove ':'Add ')+def.label+' filter" '+
      'style="'+style+'" '+
      'onclick="trkSelectStatusSegment(\''+k+'\')" '+
      'title="'+(isSel?'Remove ':'Filter by ')+def.label+'">'+
      checkIcon+
      '<i data-lucide="'+def.icon+'" class="trk-strip-ico"></i>'+
      '<span class="trk-strip-num num" data-counter="'+counts[k]+'">'+counts[k]+'</span>'+
      '<span class="trk-strip-lbl">'+def.label+'</span>'+
    '</button>';
  }).join('<span class="trk-strip-dot">•</span>');

  wrap.innerHTML =
    '<div class="trk-strip-total"><span class="num" data-counter="'+rows.length+'">'+rows.length+'</span> Total</div>'+
    '<span class="trk-strip-dot">•</span>'+
    segs;
  // Animate only on the FIRST strip render after a fresh loadTracker.
  // Filter clicks rebuild this innerHTML on every render — re-animating
  // every click would feel chaotic — so we gate on a wrap-level flag
  // that loadTracker resets when the user navigates back to the tracker.
  if (!wrap._stripAnimated) {
    wrap._stripAnimated = true;
    if (typeof animateCountersIn === 'function') animateCountersIn(wrap);
  }
}

// Click a status segment → toggle it in the status filter array. Lets the
// user build up a multi-status filter by clicking several segments (e.g.
// Active + Sign-off + On Hold to see all live work). Clicking an already-
// selected segment removes just that one. The .ms multi-select widget is
// the single source of truth for filter state; this function just edits
// its underlying array.
function trkSelectStatusSegment(key) {
  var current = msGetValues('trk-filter-status');
  var idx = current.indexOf(key);
  if (idx === -1) {
    current.push(key);
  } else {
    current.splice(idx, 1);
  }
  msSetValues('trk-filter-status', current);
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

// Primary CTA on the tracker page. Opens the shared Add Engagement modal
// — no screen navigation needed since the modal overlays whatever page
// the user is currently on.
function trkOpenNew() {
  if (typeof openAddEngagementModal === 'function') openAddEngagementModal();
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
  var nA   = _trkData.filter(function(r){return r.type==='amc';}).length;
  var nS   = _trkData.filter(function(r){return r.type==='support';}).length;
  var tabBtn = function(key, label, count) {
    var active = (_trkActiveTab===key);
    return '<button class="trk-tab'+(active?' active':'')+'" onclick="showTrackerTab(\''+key+'\')">'+
      label+' <span class="trk-tab-count">'+count+'</span></button>';
  };
  // AMC / Support tabs only surface once at least one engagement of that
  // type exists. Keeps the strip uncluttered while the team ramps up the
  // split categorisation.
  var tabBar = '<div class="trk-tab-bar">'+
    tabBtn('all','All',nAll)+
    tabBtn('projects','Projects',nP)+
    tabBtn('pocs','POCs',nQ)+
    (nA ? tabBtn('amc','AMC',nA) : '')+
    (nS ? tabBtn('support','Support',nS) : '')+
  '</div>';

  if (!rows.length) {
    content.innerHTML = tabBar + renderEmptyState({
      icon: 'search-x',
      heading: 'No engagements match your filters',
      sub: 'Try removing some filters or searching for a different keyword.',
      btnText: 'Clear all filters',
      btnIcon: 'x',
      btnOnclick: 'clearTrackerFilters()'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Type-label icon + text. Lucide icons rendered as <i data-lucide>, sized
  // small via .trk-cell-type [data-lucide] in CSS.
  var TYPE_DEF = {
    'poc':      { icon:'target', text:'POC' },
    'amc':      { icon:'wrench', text:'AMC' },
    'support':  { icon:'life-buoy', text:'Support' },
    'presales': { icon:'briefcase', text:'Pre-sales' },
    'project':  { icon:'folder', text:'Project' }
  };

  // Viewport-aware: <768px renders a card list (vertical stack) instead of a
  // wide horizontally-scrolling table. The card surface is the same row
  // tappable target, so tap → openTrackerDetail just like the table rows.
  var isMobile = window.innerWidth < 768;
  var listHtml = isMobile
    ? _trkRenderCards(rows, TYPE_DEF)
    : _trkRenderTable(rows, TYPE_DEF);

  content.innerHTML = tabBar +
    listHtml +
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+_trkData.length+' engagements</div>';
  if (typeof renderIcons === 'function') renderIcons();
  if (!isMobile && typeof attachTopScroll === 'function') {
    var wrap = content.querySelector('.table-wrap');
    if (wrap) attachTopScroll(wrap);
  }
}

// Desktop layout — Engagement + Vendor/Product (one stacked column,
// hidden on small screens), Customer, Owner, Status, Updated, Actions.
function _trkRenderTable(rows, TYPE_DEF) {
  var th =
    '<tr>'+
      '<th>Engagement</th>'+
      '<th class="hide-mobile">Vendor / Product</th>'+
      '<th>Customer</th>'+
      '<th class="hide-mobile">Owner</th>'+
      '<th>Status</th>'+
      '<th class="hide-mobile">Updated</th>'+
      '<th></th>'+
    '</tr>';
  var body = rows.map(function(r){
    var sk = _trkTopStatusKey(r.status);
    var muted = (sk === 'closed' || sk === 'cancelled' || sk === 'dormant');
    var td = TYPE_DEF[r.type] || TYPE_DEF['project'];
    var remarksFull = (r.tracker_remarks || '').replace(/\s+/g,' ').trim();
    var remarksLine = remarksFull
      ? '<div class="trk-cell-remarks" title="'+esc2(remarksFull)+'">'+esc2(remarksFull)+'</div>'
      : '';
    var vendorCell = r.vendor
      ? '<div>'+esc2(r.vendor)+'</div>'+
        (r.product_line?'<div class="trk-cell-sub">'+esc2(r.product_line)+'</div>':'')
      : '<span class="dim">—</span>';
    return '<tr class="trk-row'+(muted?' trk-row-muted':'')+'" onclick="openTrackerDetail('+r.id+')">'+
      '<td>'+
        '<div class="trk-cell-type"><i data-lucide="'+td.icon+'"></i>'+td.text+'</div>'+
        '<div class="trk-cell-name">'+esc2(r.name||'—')+'</div>'+
        (r.project_order_no?'<div class="trk-cell-sub num">PO: '+esc2(r.project_order_no)+'</div>':'')+
        remarksLine+
      '</td>'+
      '<td class="hide-mobile" style="font-size:12px">'+vendorCell+'</td>'+
      '<td>'+
        '<div>'+esc2(r.customer_name||'—')+'</div>'+
        (r.country?'<div class="trk-cell-sub">'+esc2(r.country)+'</div>':'')+
      '</td>'+
      '<td class="hide-mobile">'+esc2(r.owner_employee||'—')+'</td>'+
      '<td>'+trkTopStatusBadge(r.status)+trkConvertedBadge(r)+'</td>'+
      '<td class="hide-mobile dim num" style="font-size:12px"'+(r.tracker_updated_at?' title="'+relativeTimeTitle(r.tracker_updated_at)+'"':'')+'>'+(r.tracker_updated_at?relativeTime(r.tracker_updated_at):'—')+'</td>'+
      '<td><button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openTrackerDetail('+r.id+')"><i data-lucide="eye" class="btn-icon"></i><span class="hide-mobile">View</span></button></td>'+
    '</tr>';
  }).join('');
  return '<div class="card trk-table-card" style="padding:0">'+
    '<div class="table-wrap"><table class="trk-table"><thead>'+th+'</thead><tbody>'+body+'</tbody></table></div>'+
  '</div>';
}

// Mobile layout — each engagement becomes a tappable card. Same data, more
// breathable vertical stack. Whole card is the tap target (no "View" button).
function _trkRenderCards(rows, TYPE_DEF) {
  var cards = rows.map(function(r){
    var sk = _trkTopStatusKey(r.status);
    var muted = (sk === 'closed' || sk === 'cancelled' || sk === 'dormant');
    var td = TYPE_DEF[r.type] || TYPE_DEF['project'];
    var remarksFull = (r.tracker_remarks || '').replace(/\s+/g,' ').trim();
    var customerLine = esc2(r.customer_name||'—') + (r.country ? ' · '+esc2(r.country) : '');
    var updated = r.tracker_updated_at ? relativeTime(r.tracker_updated_at) : '—';
    var updatedTitle = r.tracker_updated_at ? ' title="'+relativeTimeTitle(r.tracker_updated_at)+'"' : '';
    return '<div class="trk-card'+(muted?' trk-row-muted':'')+'" onclick="openTrackerDetail('+r.id+')">'+
      '<div class="trk-card-head">'+
        '<span class="trk-card-type"><i data-lucide="'+td.icon+'"></i>'+td.text+'</span>'+
      '</div>'+
      '<div class="trk-card-name">'+esc2(r.name||'—')+'</div>'+
      '<div class="trk-card-meta">'+customerLine+'</div>'+
      (r.vendor?'<div class="trk-card-meta">'+esc2(r.vendor)+(r.product_line?' · '+esc2(r.product_line):'')+'</div>':'')+
      (r.owner_employee?'<div class="trk-card-meta">Owner: '+esc2(r.owner_employee)+'</div>':'')+
      '<div class="trk-card-foot">'+
        trkTopStatusBadge(r.status)+trkConvertedBadge(r)+
        '<span class="trk-card-date num"'+updatedTitle+'>'+updated+'</span>'+
      '</div>'+
      (remarksFull?'<div class="trk-cell-remarks" title="'+esc2(remarksFull)+'">'+esc2(remarksFull)+'</div>':'')+
    '</div>';
  }).join('');
  return '<div class="trk-cards">'+cards+'</div>';
}

// Re-render the tracker if the viewport crosses the 768px mobile breakpoint.
// Debounced so dragging a window edge doesn't thrash. _trkData is already in
// memory, so re-render is free (no refetch).
// Initialise from the current viewport at module load so the first resize
// event across the 768px breakpoint actually triggers a re-render. The
// previous `null` sentinel short-circuited the first crossing.
var _trkLastIsMobile = (typeof window !== 'undefined' && window.innerWidth < 768);
var _trkResizeTimer = null;
window.addEventListener('resize', function(){
  if (_trkResizeTimer) clearTimeout(_trkResizeTimer);
  _trkResizeTimer = setTimeout(function(){
    var nowMobile = window.innerWidth < 768;
    if (_trkLastIsMobile !== nowMobile) {
      var content = document.getElementById('trk-content');
      if (content && _trkData && _trkData.length) renderTracker();
    }
    _trkLastIsMobile = nowMobile;
  }, 150);
});

function openTrackerDetail(id) {
  var r = _trkData.find(function(x){return x.id===id;});
  if (!r) return;

  document.getElementById('trk-detail-type').innerHTML = trkTypeBadge(r.type) + ' ' + trkTopStatusBadge(r.status) + trkConvertedBadge(r);
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
    {label:'Last Updated',     value: r.tracker_updated_at ? (relativeTime(r.tracker_updated_at) + (r.updated_by ? ' · by '+r.updated_by : '')) : '', mono:true, titleAttr: r.tracker_updated_at ? relativeTimeTitle(r.tracker_updated_at) : ''}
  ];
  var fieldHtml = fields.map(function(f){
    var v = f.value;
    if (!v && v !== 0) return '';
    var cls = f.mono ? ' num' : '';
    var flagCss = '';
    if (f.flag === 'expired') flagCss = 'color:var(--danger);font-weight:600';
    else if (f.flag === 'soon') flagCss = 'color:#D97706;font-weight:600';
    var hint = f.hint ? '<div class="trk-field-hint">'+esc2(f.hint)+'</div>' : '';
    var titleAttr = f.titleAttr ? ' title="'+esc2(f.titleAttr)+'"' : '';
    return '<div class="trk-field"><div class="trk-field-label">'+esc2(f.label)+'</div>'+
      '<div class="trk-field-value'+cls+'" style="'+flagCss+'"'+titleAttr+'>'+esc2(String(v))+'</div>'+hint+'</div>';
  }).join('');

  var remarks = (r.tracker_remarks||'').trim();
  var remarksHtml = remarks
    ? '<div class="trk-remarks-block"><div class="trk-field-label" style="margin-bottom:6px">Remarks</div>'+
      '<div style="font-size:13px;line-height:1.6;color:#1F2937;white-space:pre-wrap">'+esc2(remarks)+'</div></div>'
    : '';

  // Manager-only: surface Professional Services deals linked to this engagement so commercial
  // context is one click away. Helper returns '' for non-managers + no-link.
  var linkedPsHtml = (typeof renderLinkedPsDealsForEngagement === 'function')
    ? renderLinkedPsDealsForEngagement(r.id)
    : '';

  document.getElementById('trk-detail-body').innerHTML =
    '<div class="trk-detail-grid">'+fieldHtml+'</div>'+
    remarksHtml +
    linkedPsHtml +
    '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn btn-primary" onclick="openTrackerEditModal('+r.id+')"><i data-lucide="pencil" class="btn-icon"></i>Edit</button>'+
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

// POC conversion toggle row visibility + disabled state:
//   - Hidden entirely when engagement type !== 'poc' (other types never see it)
//   - Visible but DISABLED while POC status is 'active' — converted/not is
//     only a meaningful decision after the POC has concluded.
function _trkRefreshConvertedToggle() {
  var row = document.getElementById('trk-edit-converted-row');
  var cb  = document.getElementById('trk-edit-converted');
  var lbl = document.getElementById('trk-edit-converted-label');
  if (!row || !cb) return;
  var engType = cb.dataset.engType || '';
  if (engType !== 'poc') {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  var topStatus = (document.getElementById('trk-edit-status')||{}).value || 'active';
  var isActive  = (topStatus === 'active' || topStatus === '');
  cb.disabled = isActive;
  if (lbl) lbl.title = isActive ? 'Available once POC is no longer active' : '';
  row.classList.toggle('poc-conv-disabled', isActive);
}

function openTrackerEditModal(id) {
  // Employees can now open this modal to edit a limited field set
  // (Remarks / Phase / Versions / Category). The DB trigger
  // enforce_engagement_employee_edit_perms reverts any manager-only
  // column to its OLD value for non-managers, so this gate is no longer
  // load-bearing — _trkApplyEmployeeLocks() at the bottom of this
  // function disables the manager-only inputs in the UI as well.
  var r = _trkData.find(function(x){return x.id===id;});
  if (!r) return;
  closeTrackerDetail();
  // Defense-in-depth: _trkData already filters out archived rows at
  // load time, but a stale tab or a direct URL could still land here.
  // Show the banner and disable the form.
  if (typeof setModalArchivedBanner === 'function') {
    var modalBox = document.querySelector('#trk-edit-modal .modal');
    setModalArchivedBanner(modalBox, r.is_archived ? 'engagement' : null);
  }
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
  // POC conversion toggle — only meaningful for type='poc'. Seed from the
  // row's current converted_to_project value (false on legacy rows), then
  // _trkRefreshConvertedToggle handles visibility + the active-status lock.
  var convCb = document.getElementById('trk-edit-converted');
  if (convCb) {
    convCb.checked  = !!r.converted_to_project;
    convCb.dataset.engType = r.type || '';
  }
  // Apply the Phase enable/disable rule based on the just-set top status.
  _trkUpdatePhaseEnabledState();
  _trkRefreshConvertedToggle();
  document.getElementById('trk-edit-info').style.display = 'none';

  _trkApplyEmployeeLocks();

  document.getElementById('trk-edit-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

// Disable manager-only fields + hide the Delete button when the current
// user isn't a manager. Spec: employees can edit Remarks, Current Phase,
// Orch Version, EC Version, Category. Everything else stays locked. The
// DB trigger (enforce_engagement_employee_edit_perms) is the authoritative
// enforcement; this is the matching UI cue so employees know which fields
// they own. Idempotent — safe to call on every modal open.
function _trkApplyEmployeeLocks() {
  // Field IDs that are locked for non-managers. Current Phase / Orch /
  // EC / Category / Remarks stay editable and aren't in this list.
  // Phase has its own workflow-aware disable in _trkUpdatePhaseEnabledState
  // (disabled when Status isn't 'active') — that's independent of role.
  var MANAGER_ONLY_FIELDS = [
    'trk-edit-status',
    'trk-edit-owner',
    'trk-edit-country',
    'trk-edit-partner',
    'trk-edit-start-date',
    'trk-edit-end-date',
    'trk-edit-license-expiry',
    'trk-edit-signed-off-on',
    'trk-edit-project-order-no',
    'trk-edit-converted'
  ];
  var locked = !isManager;

  MANAGER_ONLY_FIELDS.forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = locked;
    el.classList.toggle('trk-locked', locked);

    // Attach a lock icon to the label + a helper line under the input.
    // Wipe previous markers so toggling role (rare, but possible if the
    // modal is re-opened after a session change) doesn't accumulate.
    var group = el.closest('.form-group');
    if (!group) return;
    var label = group.querySelector('label');
    if (label) {
      var prevIcon = label.querySelector('.trk-field-lock');
      if (prevIcon) prevIcon.remove();
      if (locked) {
        var ic = document.createElement('i');
        ic.setAttribute('data-lucide', 'lock');
        ic.className = 'trk-field-lock';
        label.appendChild(ic);
      }
    }
    var prevHelper = group.querySelector('.trk-field-locked-helper');
    if (prevHelper) prevHelper.remove();
    if (locked) {
      var hint = document.createElement('div');
      hint.className = 'trk-field-locked-helper';
      hint.textContent = 'Manager-editable only';
      group.appendChild(hint);
    }
  });

  // Delete is manager-only at the DB level too — hide the button entirely
  // for non-managers rather than show a disabled state, since employees
  // shouldn't be reminded that delete exists.
  var delBtn = document.getElementById('trk-edit-delete-btn');
  if (delBtn) delBtn.style.display = locked ? 'none' : '';
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
    topStat !== 'closed' && topStat !== 'cancelled' &&
    topStat !== 'sign-off' && topStat !== 'payment-pending';
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
  // Employees can save their allowed fields; the DB trigger reverts
  // every manager-only column to its OLD value, so the patch built
  // below is safe to send wholesale either way.
  var btn = document.getElementById('trk-edit-save-btn');
  var id  = parseInt(_trkGet('trk-edit-id'), 10);
  if (!id) { showError('Missing engagement id.'); return; }

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

  // POC conversion toggle — only sent in the patch when the row is type='poc'
  // (the toggle row is hidden otherwise and we don't want to overwrite the
  // existing column on non-POC rows). The DB trigger reverts the field for
  // non-managers; here we just send the desired value, the trigger handles
  // the rest.
  var convCb = document.getElementById('trk-edit-converted');
  if (convCb && convCb.dataset.engType === 'poc') {
    patch.converted_to_project = !!convCb.checked;
  }

  // A sign-off date flips engagement.status to 'sign-off' unless the user
  // has already chosen an end state (cancelled / closed / sign-off).
  // 'archived' is no longer a valid status after v22 so it's dropped from
  // the guard. ('completed' was renamed to 'closed' in v56.)
  if (signedOn &&
      patch.status !== 'closed' && patch.status !== 'cancelled' &&
      patch.status !== 'sign-off' && patch.status !== 'payment-pending') {
    patch.status = 'sign-off';
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Saving…';
  var { error } = await sb.from('engagements').update(patch).eq('id', id);
  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';
  if (typeof renderIcons === 'function') renderIcons();

  if (error) { showError('Error saving: ' + error.message); return; }

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
  showToast('Engagement updated ✓');
  await loadTracker();
}

async function deleteTrackerEngagement() {
  if (!isManager) { showError('Manager access only.'); return; }
  var id = parseInt(_trkGet('trk-edit-id'), 10);
  if (!id) return;
  var r = _trkData.find(function(x){return x.id===id;});
  if (!r) return;
  // Soft-delete: archive. Milestones stay (no cascade until permanent
  // delete from the Archived view). Sessions remain with their
  // snapshot text untouched.
  if (!await confirmAction({
    title: 'Archive engagement "'+r.name+'"?',
    body:  'This will move the engagement to the Archived view. It will no longer appear in active lists, dropdowns, or the tracker, but can be restored later.\n\nLinked milestones and sessions stay intact.',
    confirmText: 'Archive'
  })) return;
  var btn = document.getElementById('trk-edit-delete-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Archiving…'; }
  var { error } = await sb.from('engagements').update({
    is_archived: true,
    archived_at: new Date().toISOString()
  }).eq('id', id);
  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="archive" class="btn-icon"></i>Archive Engagement'; if (typeof renderIcons === 'function') renderIcons(); }
  if (error) { showError('Could not archive: '+error.message); return; }
  showToast('Archived ✓');
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
  document.getElementById('trk-ms-progress-pct').textContent   = fmtPct(pct);
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
          '<div class="trk-ms-count-text"><span class="num">'+actual+' / '+m.target_count+'</span> <span class="dim">('+fmtPct(countPct)+')</span></div>'+
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
  if (!isManager) { showError('Manager access only.'); return; }
  var name = (document.getElementById('trk-ms-new-name').value||'').trim();
  if (!name) { showError('Milestone name is required.'); return; }
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
  if (error) { showError('Error: '+error.message); return; }
  resetMilestoneForm();
  showToast('Milestone added ✓');
  await loadMilestones();
}

async function markMilestoneComplete(id) {
  if (!isManager) return;
  var today = new Date().toISOString().split('T')[0];
  var { error } = await sb.from('engagement_milestones').update({
    status: 'completed', completed_date: today, updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { showError('Error: '+error.message); return; }
  showToast('Milestone marked complete ✓');
  await loadMilestones();
}

async function reopenMilestone(id) {
  if (!isManager) return;
  var { error } = await sb.from('engagement_milestones').update({
    status: 'in_progress', completed_date: null, updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { showError('Error: '+error.message); return; }
  showToast('Milestone reopened ✓');
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
  // Locals deliberately NOT named r1/r2 — `r2` is a global rounding helper
  // (see CLAUDE.md "Critical Quirks") and shadowing it has bitten us before.
  var resA = await sb.from('engagement_milestones').update({sequence:bSeq, updated_at:ts}).eq('id', a.id);
  if (resA.error) { showError('Error: '+resA.error.message); return; }
  var resB = await sb.from('engagement_milestones').update({sequence:aSeq, updated_at:ts}).eq('id', b.id);
  if (resB.error) { showError('Error: '+resB.error.message); return; }
  await loadMilestones();
}

async function deleteMilestone(id) {
  if (!isManager) return;
  var m = _msData.find(function(x){return x.id===id;});
  if (!m) return;
  if (!await confirmAction({
    title: 'Delete milestone "'+m.name+'"?',
    body: 'This cannot be undone.',
    confirmText: 'Delete milestone'
  })) return;
  var { error } = await sb.from('engagement_milestones').delete().eq('id', id);
  if (error) { showError('Error: '+error.message); return; }
  showToast('Milestone deleted ✓');
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
  if (!name) { showError('Name is required.'); return; }
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
  if (error) { showError('Error: '+error.message); return; }
  showToast('Milestone updated ✓');
  await loadMilestones();
}
