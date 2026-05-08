// == PROJECT / POC TRACKER ==========================================
// Read-only list view of engagements with their tracker-level metadata
// (country, partner, owner, status, versions, license expiry, etc.).
// Phase 4 will add the edit form + milestone management.

var _trkData      = [];
var _trkActiveTab = 'all';   // 'all' | 'projects' | 'pocs'

function showTrackerTab(tab) {
  _trkActiveTab = tab;
  setSidebarSubActive('tracker', tab);
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
  var fillSelect = function(id, values) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var current = sel.value;
    var html = '<option value="">All</option>';
    Object.keys(values).sort().forEach(function(v){
      html += '<option value="'+esc2(v)+'">'+esc2(v)+'</option>';
    });
    sel.innerHTML = html;
    sel.value = current;
  };
  fillSelect('trk-filter-country', countries);
  fillSelect('trk-filter-partner', partners);
  fillSelect('trk-filter-owner',   owners);
}

function clearTrackerFilters() {
  ['trk-search','trk-filter-country','trk-filter-partner','trk-filter-status','trk-filter-owner'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderTracker();
}

function applyTrackerFilters() { renderTracker(); }

function _trkFilteredRows() {
  var search   = ((document.getElementById('trk-search')||{}).value||'').toLowerCase().trim();
  var country  = (document.getElementById('trk-filter-country')||{}).value || '';
  var partner  = (document.getElementById('trk-filter-partner')||{}).value || '';
  var status   = (document.getElementById('trk-filter-status')||{}).value  || '';
  var owner    = (document.getElementById('trk-filter-owner')||{}).value   || '';

  return _trkData.filter(function(r){
    if (_trkActiveTab === 'projects' && r.type !== 'project') return false;
    if (_trkActiveTab === 'pocs'     && r.type !== 'poc')     return false;
    if (country && r.country !== country) return false;
    if (partner && r.partner !== partner) return false;
    if (status  && r.tracker_status !== status) return false;
    if (owner   && r.owner_employee !== owner) return false;
    if (search) {
      var hay = [r.name, r.customer_name, r.partner, r.country, r.owner_employee, r.tracker_remarks, r.category, r.project_order_no]
        .map(function(x){return (x||'').toLowerCase();}).join(' ');
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });
}

function trkStatusBadge(s) {
  if (!s) return '<span style="font-size:11px;color:var(--muted)">—</span>';
  var cls = 'trk-status-' + s.toLowerCase().replace(/[^a-z]+/g,'-');
  return '<span class="badge trk-status '+cls+'">'+esc2(s)+'</span>';
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
      '<td>'+trkStatusBadge(r.tracker_status)+'</td>'+
      '<td class="hide-mobile">'+esc2(r.owner_employee||'—')+'</td>'+
      (showLicense ? '<td class="hide-mobile">'+trkLicenseCell(r.license_expiry)+'</td>' : '')+
      '<td class="hide-mobile dim num" style="font-size:12px">'+(r.tracker_updated_at?fmtDate(r.tracker_updated_at):'—')+'</td>'+
      '<td><button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openTrackerDetail('+r.id+')"><i data-lucide="eye" class="btn-icon"></i>View</button></td>'+
    '</tr>';
  }).join('');

  content.innerHTML = tabBar +
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div class="table-wrap"><table class="trk-table"><thead>'+th+'</thead><tbody>'+body+'</tbody></table></div>'+
    '</div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+_trkData.length+' engagements</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function openTrackerDetail(id) {
  var r = _trkData.find(function(x){return x.id===id;});
  if (!r) return;

  document.getElementById('trk-detail-type').innerHTML = trkTypeBadge(r.type) + ' ' + trkStatusBadge(r.tracker_status);
  document.getElementById('trk-detail-name').textContent = r.name || '';
  document.getElementById('trk-detail-customer').textContent = (r.customer_name||'—') +
    (r.country?(' · '+r.country):'') +
    (r.partner?(' · '+r.partner):'');

  var fields = [
    {label:'Customer',         value: r.customer_name},
    {label:'Country',          value: r.country},
    {label:'Partner',          value: r.partner},
    {label:'Category',         value: r.category},
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
    return '<div class="trk-field"><div class="trk-field-label">'+esc2(f.label)+'</div>'+
      '<div class="trk-field-value'+cls+'" style="'+flagCss+'">'+esc2(String(v))+'</div></div>';
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
      (isManager ? '<button class="btn btn-ghost" onclick="alert(\'Edit form coming in Phase 4.\')"><i data-lucide="pencil" class="btn-icon"></i>Edit</button>' : '')+
      '<button class="btn btn-ghost" onclick="alert(\'Milestones coming in Phase 5.\')"><i data-lucide="list-checks" class="btn-icon"></i>Milestones</button>'+
      '<button class="btn btn-ghost" onclick="closeTrackerDetail()" style="margin-left:auto">Close</button>'+
    '</div>';

  document.getElementById('trk-detail-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeTrackerDetail() {
  document.getElementById('trk-detail-modal').classList.remove('show');
}
