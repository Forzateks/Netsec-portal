// == ROLLOUT TRACKER (v167) ========================================
// Tracks a customer site rollout against its SOW. Distinct from Project
// Tracker, which tracks ENGAGEMENTS through delivery phases — this tracks
// physical SITES against a scope of work.
//
// Design: docs/superpowers/specs/2026-08-24-rollout-tracker-design.md
//
// The core idea: sites are ROWS and every number in the report is a COUNT.
// The source spreadsheet typed its counts, which let the categories drift
// out of step with the totals — KSA read a clean 204 of 204 while four of
// its six categories were wrong and it carried 4 DC/DR sites the SOW never
// scoped. Deriving every figure from the rows makes that impossible.

var ROLLOUT_PROJECT_ID = null;
var ROLLOUT_PROJECT    = null;
var ROLLOUT_SITES      = [];
var _rolloutImportRows = null;   // parsed CSV awaiting column mapping + commit

// Column order here drives the report and the export, so it matches the
// source sheet exactly. Keys are the lowercase DB values.
var ROLLOUT_TYPES = [
  { key:'store',       label:'Stores'      },
  { key:'office',      label:'Offices'     },
  { key:'warehouse',   label:'Warehouse'   },
  { key:'interlinked', label:'Interlinked' },
  { key:'dc_dr',       label:'DC/DR'       },
  { key:'cloud',       label:'Cloud'       }
];
var ROLLOUT_TYPE_LABEL = {};
ROLLOUT_TYPES.forEach(function(t){ ROLLOUT_TYPE_LABEL[t.key] = t.label; });

function _rolloutTypeFromText(s) {
  var v = String(s||'').toLowerCase().replace(/[\s\-\/]+/g,'_');
  if (v.indexOf('store') === 0)   return 'store';
  if (v.indexOf('office') === 0)  return 'office';
  if (v.indexOf('warehouse') === 0 || v === 'wh') return 'warehouse';
  if (v.indexOf('interlink') === 0) return 'interlinked';
  if (v.indexOf('dc') === 0 || v.indexOf('dr') === 0) return 'dc_dr';
  if (v.indexOf('cloud') === 0)   return 'cloud';
  return null;
}

// == TAB SWITCHING =================================================
function showRolloutTab(tab) {
  ['overview','sites','import','log'].forEach(function(t){
    var el = document.getElementById('rotab-'+t);
    if (el) el.style.display = (t === tab) ? 'block' : 'none';
  });
  if (tab === 'overview') renderRolloutOverview();
  if (tab === 'sites')    renderRolloutSites();
  if (tab === 'import')   renderRolloutImport();
  if (tab === 'log')      renderRolloutLog();
  if (typeof setSidebarSubActive === 'function') setSidebarSubActive('rollout', tab);
}

// == DATA ==========================================================
async function loadRollout(force) {
  if (ROLLOUT_SITES.length && !force) return;
  var pRes = await sb.from('rollout_projects').select('*').eq('is_archived', false)
                     .order('id').limit(1);
  if (pRes.error) { showError('Could not load rollout project: ' + pRes.error.message); return; }
  ROLLOUT_PROJECT = (pRes.data || [])[0] || null;
  if (!ROLLOUT_PROJECT) { ROLLOUT_SITES = []; return; }
  ROLLOUT_PROJECT_ID = ROLLOUT_PROJECT.id;

  // fetchAllRows: a rollout can exceed the 1000-row Supabase cap (Landmark
  // alone is 465 and other customers may follow).
  var sRes = await fetchAllRows(function(){
    return sb.from('rollout_sites').select('*')
             .eq('project_id', ROLLOUT_PROJECT_ID)
             .order('country').order('city').order('site_name');
  });
  if (sRes.error) { showError('Could not load sites: ' + sRes.error.message); return; }
  ROLLOUT_SITES = sRes.data || [];
}

// Build a {country: {type: count}} matrix plus per-type and grand totals.
function _rolloutMatrix(rows) {
  var m = {}, colTotals = {}, grand = 0;
  ROLLOUT_TYPES.forEach(function(t){ colTotals[t.key] = 0; });
  rows.forEach(function(r){
    if (!m[r.country]) {
      m[r.country] = {};
      ROLLOUT_TYPES.forEach(function(t){ m[r.country][t.key] = 0; });
    }
    if (m[r.country][r.site_type] === undefined) return;  // unknown type, skip
    m[r.country][r.site_type] += 1;
    colTotals[r.site_type] += 1;
    grand += 1;
  });
  return { m:m, colTotals:colTotals, grand:grand };
}

// Countries in a stable order: Cloud first (it is a pseudo-country in the
// source sheet), then alphabetical — so the export is reproducible.
function _rolloutCountries(rows) {
  var seen = {};
  rows.forEach(function(r){ seen[r.country] = 1; });
  var list = Object.keys(seen).sort();
  var i = list.indexOf('Cloud');
  if (i > 0) { list.splice(i,1); list.unshift('Cloud'); }
  return list;
}

// Render one country x type table. `extra` adds trailing columns.
function _rolloutTable(rows, countries, extraCols) {
  var mx = _rolloutMatrix(rows);
  var h = '<div class="table-wrap"><table><thead><tr><th></th>';
  ROLLOUT_TYPES.forEach(function(t){ h += '<th>'+t.label+'</th>'; });
  h += '<th>Total</th>';
  (extraCols||[]).forEach(function(c){ h += '<th>'+esc2(c.label)+'</th>'; });
  h += '</tr></thead><tbody>';

  countries.forEach(function(c){
    var row = mx.m[c] || {};
    var rowTotal = 0;
    h += '<tr><td style="font-weight:600">'+esc2(c)+'</td>';
    ROLLOUT_TYPES.forEach(function(t){
      var n = row[t.key] || 0; rowTotal += n;
      h += '<td style="font-variant-numeric:tabular-nums">'+(n || '')+'</td>';
    });
    h += '<td style="font-variant-numeric:tabular-nums;font-weight:700">'+rowTotal+'</td>';
    (extraCols||[]).forEach(function(col){
      var v = col.value(c);
      h += '<td style="font-variant-numeric:tabular-nums;font-weight:700;color:'+
           (col.color ? col.color(v) : 'var(--nx-ink)')+'">'+v+'</td>';
    });
    h += '</tr>';
  });

  h += '</tbody><tfoot><tr style="background:var(--nx-canvas)"><td style="font-weight:700">Total</td>';
  ROLLOUT_TYPES.forEach(function(t){
    h += '<td style="font-variant-numeric:tabular-nums;font-weight:700">'+(mx.colTotals[t.key] || '')+'</td>';
  });
  h += '<td style="font-variant-numeric:tabular-nums;font-weight:700">'+mx.grand+'</td>';
  (extraCols||[]).forEach(function(col){
    h += '<td style="font-variant-numeric:tabular-nums;font-weight:700">'+col.total()+'</td>';
  });
  h += '</tr></tfoot></table></div>';
  return h;
}

// == OVERVIEW ======================================================
async function renderRolloutOverview() {
  var host = document.getElementById('ro-overview-content');
  if (!host) return;
  host.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
  await loadRollout();

  if (!ROLLOUT_SITES.length) {
    host.innerHTML = renderEmptyState({
      icon: 'map-pin',
      heading: 'No sites yet',
      sub: 'Import the site list to start tracking this rollout against its SOW.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var all       = ROLLOUT_SITES;
  var sow       = all.filter(function(r){ return r.in_sow; });
  var done      = all.filter(function(r){ return r.status === 'done'; });
  var remaining = all.filter(function(r){ return r.in_sow && r.status !== 'done'; });
  var extraDone = all.filter(function(r){ return !r.in_sow && r.status === 'done'; });
  var countries = _rolloutCountries(all);

  var doneBy = {}, remBy = {};
  countries.forEach(function(c){
    doneBy[c] = done.filter(function(r){ return r.country === c; }).length;
    remBy[c]  = remaining.filter(function(r){ return r.country === c; }).length;
  });

  var pct = sow.length ? Math.round(done.filter(function(r){ return r.in_sow; }).length / sow.length * 100) : 0;

  var h = '';

  // Headline
  h += '<div class="card"><div class="flex-between" style="flex-wrap:wrap;gap:12px">'+
    '<div><div class="card-title" style="margin-bottom:2px">'+esc2(ROLLOUT_PROJECT.name)+' rollout</div>'+
    '<div style="font-size:13px;color:var(--nx-ink-muted)">'+
      fmtCount(done.length)+' of '+fmtCount(sow.length)+' scoped sites complete &middot; '+
      fmtCount(remaining.length)+' remaining</div></div>'+
    '<button class="btn btn-primary" onclick="exportRolloutExcel()">'+
      '<i data-lucide="download" class="btn-icon"></i>Export report</button>'+
    '</div>'+
    '<div class="rankbar" style="margin-top:14px"><div class="rankbar-row">'+
      '<div class="rankbar-head"><span class="rankbar-label">Overall progress</span>'+
      '<span class="rankbar-value">'+pct+'%</span></div>'+
      '<div class="rankbar-track"><div class="rankbar-fill" style="width:'+pct+'%"></div></div>'+
    '</div></div></div>';

  // Sites completed that were never scoped — the thing the spreadsheet hid.
  if (extraDone.length) {
    var byC = {};
    extraDone.forEach(function(r){ byC[r.country] = (byC[r.country]||0)+1; });
    var parts = Object.keys(byC).sort().map(function(c){ return esc2(c)+' '+byC[c]; });
    h += '<div class="card" style="border-color:var(--pill-warn-bd);background:var(--pill-warn-bg)">'+
      '<div style="font-weight:700;color:var(--nx-orange-deep);margin-bottom:4px">'+
      fmtCount(extraDone.length)+' site'+(extraDone.length===1?'':'s')+' completed outside the SOW</div>'+
      '<div style="font-size:13px;color:var(--nx-orange-deep)">'+parts.join(' &middot; ')+
      '. These are done but were never scoped, so they are excluded from the '+
      'progress figures above. Mark them in-SOW if the scope was extended.</div></div>';
  }

  // SOW
  h += '<div class="card"><div class="card-title">Scope of work</div>'+
       _rolloutTable(sow, countries) + '</div>';

  // Completed
  h += '<div class="card"><div class="card-title">Completed till today &mdash; '+
       fmtDate(_rolloutTodayISO()) + '</div>' +
       _rolloutTable(done, countries, [
         { label:'Completed', value:function(c){ return doneBy[c]; },
           total:function(){ return done.length; } },
         { label:'Remaining', value:function(c){ return remBy[c]; },
           total:function(){ return remaining.length; },
           color:function(v){ return v > 0 ? 'var(--nx-orange)' : 'var(--nx-green)'; } }
       ]) + '</div>';

  // Per-country city breakdowns, for any country that records cities.
  countries.forEach(function(c){
    var inC = done.filter(function(r){ return r.country === c && r.city; });
    if (!inC.length) return;
    var cities = _rolloutCountries(inC.map(function(r){ return { country:r.city }; }));
    h += '<div class="card"><div class="card-title">'+esc2(c)+' breakdown &mdash; completed by city</div>'+
         _rolloutTable(inC.map(function(r){
           return { country:r.city, site_type:r.site_type };
         }), cities) + '</div>';
  });

  // MPLS
  var mpls = all.filter(function(r){ return r.mpls_configured; });
  h += '<div class="card"><div class="card-title">MPLS config breakdown</div>' +
       (mpls.length
         ? _rolloutTable(mpls, _rolloutCountries(mpls))
         : '<div style="font-size:13px;color:var(--nx-ink-muted)">No sites marked MPLS configured yet.</div>') +
       '</div>';

  host.innerHTML = h;
  if (typeof renderIcons === 'function') renderIcons();
}

function _rolloutTodayISO() {
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// == AUDIT TRAIL (v171) ============================================
// Every change to a site writes one row here. The table is append-only at the
// database level: it has SELECT and INSERT policies and no UPDATE or DELETE
// policy at all, so RLS denies both by default - to managers too. changed_by
// is bound to current_employee_name() inside the INSERT policy, so a caller
// cannot attribute a change to someone else even by hand-building a REST call.
//
// One row PER SITE even in a bulk action: a bulk update shares a timestamp and
// a person, but "who marked site 31 done" must stay answerable per site.
async function _rolloutLog(site, action, changes) {
  var res = await sb.from('rollout_site_activity_log').insert({
    site_id:    site.id,
    site_name:  site.site_name,
    country:    site.country,
    changed_by: currentUser,
    action:     action,
    field_changes: changes || null
  });
  // A failed audit write must be visible, not silent - but it must not roll
  // back the change the user just made and saw succeed.
  if (res.error) {
    console.warn('rollout audit log insert failed:', res.error.message);
    if (typeof reportSilentFail === 'function') {
      reportSilentFail('rollout_site_activity_log', { op: action, error: res.error.message });
    }
  }
}

// Ids ticked in the Sites list, for the bulk action.
var _rolloutSel = {};
function _rolloutSelCount() { return Object.keys(_rolloutSel).length; }
function toggleRolloutSel(id, on) {
  if (on) _rolloutSel[id] = 1; else delete _rolloutSel[id];
  _rolloutSyncBulkBar();
}
function _rolloutSyncBulkBar() {
  var bar = document.getElementById('ro-bulk-bar');
  var n = _rolloutSelCount();
  if (!bar) return;
  bar.style.display = n ? 'flex' : 'none';
  var lbl = document.getElementById('ro-bulk-count');
  if (lbl) lbl.textContent = n + (n === 1 ? ' site selected' : ' sites selected');
}
function rolloutSelectAllShown(on) {
  var boxes = document.querySelectorAll('.ro-site-check');
  for (var i = 0; i < boxes.length; i++) {
    boxes[i].checked = on;
    var id = parseInt(boxes[i].getAttribute('data-id'), 10);
    if (on) _rolloutSel[id] = 1; else delete _rolloutSel[id];
  }
  _rolloutSyncBulkBar();
}
function rolloutClearSel() {
  _rolloutSel = {};
  var boxes = document.querySelectorAll('.ro-site-check');
  for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
  _rolloutSyncBulkBar();
}

// == SITES LIST ====================================================
async function renderRolloutSites() {
  var host = document.getElementById('ro-sites-content');
  if (!host) return;
  host.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
  await loadRollout();

  if (!ROLLOUT_SITES.length) {
    host.innerHTML = renderEmptyState({
      icon:'map-pin', heading:'No sites yet',
      sub:'Import the site list on the Import tab.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var fC = (document.getElementById('ro-flt-country')||{}).value || '';
  var fT = (document.getElementById('ro-flt-type')||{}).value || '';
  var fS = (document.getElementById('ro-flt-status')||{}).value || '';
  var q  = ((document.getElementById('ro-flt-search')||{}).value || '').toLowerCase().trim();

  var rows = ROLLOUT_SITES.filter(function(r){
    if (fC && r.country !== fC) return false;
    if (fT && r.site_type !== fT) return false;
    if (fS === 'done'    && r.status !== 'done') return false;
    if (fS === 'pending' && r.status === 'done') return false;
    if (fS === 'mpls'    && !r.mpls_configured) return false;
    if (q && String(r.site_name||'').toLowerCase().indexOf(q) === -1 &&
             String(r.city||'').toLowerCase().indexOf(q) === -1) return false;
    return true;
  });

  // Populate the country filter once from the data.
  var cSel = document.getElementById('ro-flt-country');
  if (cSel && cSel.options.length <= 1) {
    _rolloutCountries(ROLLOUT_SITES).forEach(function(c){
      var o = document.createElement('option'); o.value = c; o.textContent = c; cSel.appendChild(o);
    });
  }

  var h = '<div id="ro-bulk-bar" style="display:none;align-items:center;gap:10px;flex-wrap:wrap;'+
          'background:var(--pill-info-bg);border:1px solid var(--pill-info-bd);'+
          'border-radius:var(--radius-md);padding:8px 12px;margin-bottom:10px">'+
          '<span id="ro-bulk-count" style="font-size:13px;font-weight:600;color:var(--pill-info-fg)"></span>'+
          '<button class="btn btn-sm btn-primary" onclick="markRolloutSelectedDone()">Mark selected done</button>'+
          '<button class="btn btn-sm btn-secondary" onclick="rolloutClearSel()">Clear</button>'+
          '</div>';
  h += '<div style="font-size:12px;color:var(--nx-ink-muted);margin-bottom:10px">'+
          fmtCount(rows.length)+' of '+fmtCount(ROLLOUT_SITES.length)+' sites</div>';
  h += '<div class="table-wrap"><table><thead><tr>'+
       '<th style="width:34px"><input type="checkbox" onchange="rolloutSelectAllShown(this.checked)" '+
         'title="Select every row shown" aria-label="Select all shown" style="width:auto"></th>'+
       '<th>Site</th><th>Country</th><th class="hide-mobile">City</th><th>Type</th>'+
       '<th class="hide-mobile">In SOW</th><th>Status</th><th class="hide-mobile">Completed</th>'+
       '<th class="hide-mobile">MPLS</th>'+(isManager?'<th></th>':'')+'</tr></thead><tbody>';

  rows.slice(0, 500).forEach(function(r){
    var isDone = r.status === 'done';
    var isPlaceholder = (r.notes || '').indexOf('placeholder') === 0;
    h += '<tr>'+
      '<td><input type="checkbox" class="ro-site-check" data-id="'+r.id+'" '+
        (_rolloutSel[r.id]?'checked':'')+' onchange="toggleRolloutSel('+r.id+',this.checked)" '+
        'aria-label="Select site" style="width:auto"></td>'+
      '<td style="font-weight:600'+(isPlaceholder?';color:var(--nx-ink-muted);font-style:italic':'')+'">'+
        esc2(r.site_name)+'</td>'+
      '<td>'+esc2(r.country)+'</td>'+
      '<td class="hide-mobile" style="color:var(--nx-ink-muted)">'+esc2(r.city||'—')+'</td>'+
      '<td><span class="badge" style="background:var(--nx-canvas);color:var(--nx-ink-2)">'+
        esc2(ROLLOUT_TYPE_LABEL[r.site_type]||r.site_type)+'</span></td>'+
      '<td class="hide-mobile">'+(r.in_sow ? 'Yes'
        : '<span style="color:var(--nx-orange);font-weight:600">No</span>')+'</td>'+
      '<td><button class="btn btn-sm '+(isDone?'btn-secondary':'btn-primary')+'" '+
        'onclick="toggleRolloutSiteDone('+r.id+')">'+(isDone?'Done':'Mark done')+'</button></td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums;color:var(--nx-ink-muted)">'+
        (r.completed_on ? fmtDate(r.completed_on) : '—')+'</td>'+
      '<td class="hide-mobile"><input type="checkbox" '+(r.mpls_configured?'checked':'')+
        ' onchange="toggleRolloutMpls('+r.id+', this.checked)" aria-label="MPLS configured" style="width:auto"></td>'+
      (isManager
        ? '<td><button class="btn btn-sm btn-secondary" onclick="editRolloutSite('+r.id+')" '+
          'title="Rename or correct this site">Edit</button></td>'
        : '')+
      '</tr>';
  });
  h += '</tbody></table></div>';
  if (rows.length > 500) {
    h += '<div style="font-size:12px;color:var(--nx-ink-muted);margin-top:8px">'+
         'Showing the first 500 of '+fmtCount(rows.length)+'. Narrow the filters to see the rest.</div>';
  }
  host.innerHTML = h;
  // Selections survive a re-render (filters change, list refreshes), so the
  // bulk bar has to be re-shown to match.
  _rolloutSyncBulkBar();
}

// Mark ONE site done / not done. The completion date is editable because
// people update the tracker days after the work; forcing today would quietly
// make the completion history wrong. The audit log separately records when the
// record actually changed, so a backdated completion is still traceable.
async function toggleRolloutSiteDone(id) {
  if (!await requireAuth()) return;
  var row = ROLLOUT_SITES.filter(function(r){ return r.id === id; })[0];
  if (!row) return;

  if (row.status === 'done') {
    if (!await confirmAction({
      title: 'Reopen this site?',
      body: esc2(row.site_name) + ' is marked complete. Reopening clears its completion date '
          + 'and puts it back into the remaining count.',
      confirmText: 'Reopen', danger: false
    })) return;
    var was = row.completed_on;
    var up = await sb.from('rollout_sites').update({
      status:'pending', completed_on:null,
      updated_at:new Date().toISOString(), updated_by:currentUser
    }).eq('id', id);
    if (up.error) { showError('Could not update: ' + up.error.message); return; }
    row.status='pending'; row.completed_on=null;
    await _rolloutLog(row, 'reopened', { status:{from:'done',to:'pending'}, completed_on:{from:was,to:null} });
    showToast('Reopened');
    renderRolloutSites();
    return;
  }

  var date = await promptInput({
    title: 'Mark site complete',
    body: esc2(row.site_name) + ' — ' + esc2(row.country),
    label: 'Completed on', type: 'date',
    defaultValue: _rolloutTodayISO(), confirmText: 'Mark done',
    validate: function(v){ return v ? null : 'Pick the date the work was completed.'; }
  });
  if (!date) return;

  var res = await sb.from('rollout_sites').update({
    status:'done', completed_on:date,
    updated_at:new Date().toISOString(), updated_by:currentUser
  }).eq('id', id);
  if (res.error) { showError('Could not update: ' + res.error.message); return; }
  row.status='done'; row.completed_on=date;
  await _rolloutLog(row, 'completed', { status:{from:'pending',to:'done'}, completed_on:{from:null,to:date} });
  showToast('Marked done ✓');
  renderRolloutSites();
}

// Bulk complete. One database update and one log row PER SITE - they share a
// timestamp and a person, but per-site history stays intact.
async function markRolloutSelectedDone() {
  if (!await requireAuth()) return;
  var ids = Object.keys(_rolloutSel).map(Number);
  var rows = ROLLOUT_SITES.filter(function(r){ return ids.indexOf(r.id) !== -1 && r.status !== 'done'; });
  if (!rows.length) { showError('Nothing selected that is still pending.'); return; }

  var date = await promptInput({
    title: 'Mark ' + rows.length + ' sites complete',
    body: rows.length + ' pending site' + (rows.length===1?'':'s') + ' will be marked done with this date.',
    label: 'Completed on', type: 'date',
    defaultValue: _rolloutTodayISO(), confirmText: 'Mark ' + rows.length + ' done',
    validate: function(v){ return v ? null : 'Pick the date the work was completed.'; }
  });
  if (!date) return;

  var res = await sb.from('rollout_sites').update({
    status:'done', completed_on:date,
    updated_at:new Date().toISOString(), updated_by:currentUser
  }).in('id', rows.map(function(r){ return r.id; }));
  if (res.error) { showError('Bulk update failed: ' + res.error.message); return; }

  for (var i = 0; i < rows.length; i++) {
    rows[i].status='done'; rows[i].completed_on=date;
    await _rolloutLog(rows[i], 'completed', {
      status:{from:'pending',to:'done'}, completed_on:{from:null,to:date}, bulk:{of:rows.length}
    });
  }
  showToast('Marked ' + rows.length + ' sites done ✓');
  rolloutClearSel();
  renderRolloutSites();
}

async function toggleRolloutMpls(id, checked) {
  if (!await requireAuth()) return;
  var row = ROLLOUT_SITES.filter(function(r){ return r.id === id; })[0];
  if (!row) return;
  var on = !!checked, when = on ? _rolloutTodayISO() : null;
  var res = await sb.from('rollout_sites').update({
    mpls_configured:on, mpls_on:when,
    updated_at:new Date().toISOString(), updated_by:currentUser
  }).eq('id', id);
  if (res.error) { showError('Could not update: ' + res.error.message); return; }
  var wasOn = row.mpls_configured, wasWhen = row.mpls_on;
  row.mpls_configured = on; row.mpls_on = when;
  await _rolloutLog(row, on ? 'mpls_configured' : 'mpls_removed',
    { mpls_configured:{from:wasOn,to:on}, mpls_on:{from:wasWhen,to:when} });
}

// Rename a placeholder, or correct a site's details. Manager-only, because
// this is the SOW baseline - see the design doc. Renaming is the main use:
// placeholders carry a generated name until the real one is known.
async function editRolloutSite(id) {
  if (!await requireAuth()) return;
  if (!isManager) { showError('Editing sites is manager-only.'); return; }
  var row = ROLLOUT_SITES.filter(function(r){ return r.id === id; })[0];
  if (!row) return;

  var name = await promptInput({
    title: 'Edit site name',
    body: 'Country: ' + esc2(row.country) + '  ·  Type: '
        + esc2(ROLLOUT_TYPE_LABEL[row.site_type] || row.site_type),
    label: 'Site name', defaultValue: row.site_name, confirmText: 'Save',
    validate: function(v){ return v ? null : 'A site needs a name.'; }
  });
  if (!name || name === row.site_name) return;

  var res = await sb.from('rollout_sites').update({
    site_name: name,
    // A renamed placeholder is no longer a placeholder.
    notes: (row.notes === 'placeholder - real site name pending') ? null : row.notes,
    updated_at:new Date().toISOString(), updated_by:currentUser
  }).eq('id', id);
  if (res.error) { showError('Could not rename: ' + res.error.message); return; }
  var was = row.site_name;
  row.site_name = name;
  await _rolloutLog(row, 'renamed', { site_name:{from:was,to:name} });
  showToast('Renamed ✓');
  renderRolloutSites();
}

// == IMPORT ========================================================
// Column MAPPING rather than a fixed format: the source file's headers are
// not known in advance, and guessing them is how an import fails on first
// contact with the real data.
function renderRolloutImport() {
  var host = document.getElementById('ro-import-content');
  if (!host) return;
  if (!isManager) {
    host.innerHTML = '<div class="alert alert-error show">Importing sites is manager-only.</div>';
    return;
  }
  if (!_rolloutImportRows) {
    host.innerHTML =
      '<div class="card"><div class="card-title">Import site list</div>'+
      '<div style="font-size:13px;color:var(--nx-ink-muted);margin-bottom:12px">'+
        'Paste your site list including its header row — comma or tab separated, '+
        'straight from Excel. You will map the columns on the next step, so the '+
        'header names do not need to match anything.</div>'+
      '<textarea id="ro-import-text" rows="10" placeholder="Site Name,Country,City,Type&#10;'+
        'Landmark Dubai Mall,UAE,Dubai,Store&#10;Riyadh DC,KSA,Riyadh,DC"></textarea>'+
      '<div style="margin-top:12px"><button class="btn btn-primary" onclick="rolloutParsePaste()">'+
        'Next: map columns</button></div></div>';
    return;
  }
  // Mapping step
  var headers = _rolloutImportRows.headers;
  function sel(id, label, hint) {
    var h = '<div class="form-group"><label>'+label+'</label><select id="'+id+'">'+
            '<option value="">— not in my file —</option>';
    headers.forEach(function(hd,i){
      var guess = hint && hd.toLowerCase().indexOf(hint) !== -1 ? ' selected' : '';
      h += '<option value="'+i+'"'+guess+'>'+esc2(hd)+'</option>';
    });
    return h + '</select></div>';
  }
  host.innerHTML =
    '<div class="card"><div class="card-title">Map your columns</div>'+
    '<div style="font-size:13px;color:var(--nx-ink-muted);margin-bottom:14px">'+
      fmtCount(_rolloutImportRows.rows.length)+' rows found. Tell the app which of '+
      'your columns is which.</div>'+
    '<div class="form-grid">'+
      sel('ro-map-name','Site name *','name')+
      sel('ro-map-country','Country *','countr')+
      sel('ro-map-city','City','city')+
      sel('ro-map-type','Site type *','type')+
    '</div>'+
    '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn btn-primary" onclick="rolloutCommitImport()">Import sites</button>'+
      '<button class="btn btn-secondary" onclick="_rolloutImportRows=null;renderRolloutImport()">Start over</button>'+
    '</div></div>';
}

function rolloutParsePaste() {
  var txt = (document.getElementById('ro-import-text')||{}).value || '';
  var lines = txt.split(/\r?\n/).filter(function(l){ return l.trim(); });
  if (lines.length < 2) { showError('Paste a header row plus at least one site.'); return; }
  var delim = (lines[0].indexOf('\t') !== -1) ? '\t' : ',';
  function split(l){ return l.split(delim).map(function(c){ return c.trim().replace(/^"|"$/g,''); }); }
  _rolloutImportRows = { headers: split(lines[0]), rows: lines.slice(1).map(split) };
  renderRolloutImport();
}

async function rolloutCommitImport() {
  if (!await requireAuth()) return;
  if (!isManager) { showError('Importing sites is manager-only.'); return; }
  var iName = (document.getElementById('ro-map-name')||{}).value;
  var iCty  = (document.getElementById('ro-map-country')||{}).value;
  var iCity = (document.getElementById('ro-map-city')||{}).value;
  var iType = (document.getElementById('ro-map-type')||{}).value;
  if (iName === '' || iCty === '' || iType === '') {
    showError('Site name, country and site type are all required.'); return;
  }
  await loadRollout();
  if (!ROLLOUT_PROJECT_ID) { showError('No rollout project found.'); return; }

  var payload = [], bad = [];
  _rolloutImportRows.rows.forEach(function(r, n){
    var name = r[iName], country = r[iCty];
    var type = _rolloutTypeFromText(r[iType]);
    if (!name || !country || !type) { bad.push(n + 2); return; }
    payload.push({
      project_id: ROLLOUT_PROJECT_ID,
      site_name: name, country: country,
      city: (iCity !== '' ? (r[iCity] || null) : null),
      site_type: type, in_sow: true, status: 'pending',
      updated_by: currentUser
    });
  });
  if (!payload.length) {
    showError('Nothing importable — check the Site type column maps to Store/Office/Warehouse/Interlinked/DC/Cloud.');
    return;
  }
  if (!await confirmAction({
    title: 'Import ' + payload.length + ' sites?',
    body: 'They will be added to ' + ROLLOUT_PROJECT.name + ' as scoped (in SOW) and pending.' +
          (bad.length ? '\n\n' + bad.length + ' row(s) will be skipped — missing name, country or an unrecognised type: lines ' + bad.slice(0,10).join(', ') + (bad.length>10?'…':'') : ''),
    confirmText: 'Import', danger: false
  })) return;

  // upsert on the unique (project, name, type) index so a re-run cannot
  // silently duplicate the list.
  var res = await sb.from('rollout_sites')
    .upsert(payload, { onConflict: 'project_id,site_name,site_type', ignoreDuplicates: true });
  if (res.error) { showError('Import failed: ' + res.error.message); return; }
  showToast('Imported ' + payload.length + ' sites ✓');
  _rolloutImportRows = null;
  await loadRollout(true);
  showRolloutTab('overview');
}

// == ACTIVITY LOG (v171) ===========================================
// Read-only view of rollout_site_activity_log. Mirrors the AMC and PS logs:
// relative "when", exact date/time, who, what, and a before -> after diff.
var ROLLOUT_ACTION_META = {
  completed:       { icon:'✅', label:'Completed',      color:'var(--nx-green)' },
  reopened:        { icon:'↩️', label:'Reopened',       color:'var(--nx-orange)' },
  mpls_configured: { icon:'🔗', label:'MPLS configured',color:'var(--nx-primary)' },
  mpls_removed:    { icon:'🔌', label:'MPLS removed',   color:'var(--nx-ink-muted)' },
  renamed:         { icon:'✏️', label:'Renamed',        color:'var(--nx-primary)' },
  imported:        { icon:'📥', label:'Imported',       color:'var(--nx-ink-muted)' }
};

async function renderRolloutLog() {
  var host = document.getElementById('ro-log-content');
  if (!host) return;
  host.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  var res = await sb.from('rollout_site_activity_log')
    .select('*').order('changed_at', { ascending:false }).limit(300);
  if (res.error) {
    host.innerHTML = '<div class="alert alert-error show">Error: '+esc2(res.error.message)+'</div>';
    return;
  }
  var data = res.data || [];
  if (!data.length) {
    host.innerHTML = renderEmptyState({
      icon:'history', heading:'No activity yet',
      sub:'Marking a site done, renaming one, or changing its MPLS flag is recorded here — who, what and when.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var rows = '';
  data.forEach(function(l){
    var meta = ROLLOUT_ACTION_META[l.action] ||
               { icon:'•', label:cap(String(l.action||'').replace(/_/g,' ')), color:'var(--nx-ink-muted)' };
    var changes = '—';
    if (l.field_changes && typeof l.field_changes === 'object') {
      var parts = [];
      Object.keys(l.field_changes).forEach(function(f){
        if (f === 'bulk') return;   // rendered as a badge instead
        var c = l.field_changes[f];
        if (!c || typeof c !== 'object') return;
        parts.push('<span style="color:var(--nx-ink-muted)">'+esc2(f.replace(/_/g,' '))+':</span> '+
          '<span style="color:var(--danger);text-decoration:line-through">'+
            esc2(String(c.from == null ? '—' : c.from))+'</span> → '+
          '<span style="color:var(--nx-green)">'+
            esc2(String(c.to == null ? '—' : c.to))+'</span>');
      });
      if (parts.length) changes = parts.join('<br>');
    }
    var bulk = (l.field_changes && l.field_changes.bulk)
      ? ' <span class="badge" style="background:var(--pill-info-bg);color:var(--pill-info-fg)">'+
        'bulk of '+fmtCount(l.field_changes.bulk.of)+'</span>' : '';
    rows +=
      '<tr>'+
      '<td class="hide-mobile" style="white-space:nowrap;font-size:12px;color:var(--nx-ink-muted)">'+
        relativeTime(l.changed_at)+'</td>'+
      '<td style="white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px;color:var(--nx-ink-muted)">'+
        (l.changed_at ? fmtDateTime(l.changed_at) : '—')+'</td>'+
      '<td style="font-weight:600">'+esc2(l.site_name||'')+bulk+'</td>'+
      '<td class="hide-mobile">'+esc2(l.country||'—')+'</td>'+
      '<td><span style="color:'+meta.color+';font-weight:600">'+meta.icon+' '+esc2(meta.label)+'</span></td>'+
      '<td>'+esc2(l.changed_by||'')+'</td>'+
      '<td style="font-size:12px;line-height:1.7">'+changes+'</td>'+
      '</tr>';
  });

  host.innerHTML =
    '<div style="font-size:12px;color:var(--nx-ink-muted);margin-bottom:10px">'+
      'Showing the '+fmtCount(data.length)+' most recent changes. This log is append-only — '+
      'entries cannot be edited or deleted by anyone, including managers.</div>'+
    '<div class="table-wrap"><table><thead><tr>'+
    '<th class="hide-mobile">When</th><th>Date &amp; Time</th><th>Site</th>'+
    '<th class="hide-mobile">Country</th><th>Action</th><th>Changed By</th><th>Changes</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
}

// == EXPORT ========================================================
// Reproduces the source spreadsheet's layout so the exported file can be
// sent on without reformatting.
async function exportRolloutExcel() {
  try {
    await ensureXlsxLoaded();
  } catch (e) { showError('Could not load the Excel library.'); return; }
  await loadRollout();
  if (!ROLLOUT_SITES.length) { showError('No sites to export.'); return; }

  var all       = ROLLOUT_SITES;
  var sow       = all.filter(function(r){ return r.in_sow; });
  var done      = all.filter(function(r){ return r.status === 'done'; });
  var remaining = all.filter(function(r){ return r.in_sow && r.status !== 'done'; });
  var countries = _rolloutCountries(all);
  var today     = _rolloutTodayISO();
  var aoa       = [];

  function block(title, rows, countryList, extra) {
    var mx = _rolloutMatrix(rows);
    aoa.push([title]);
    var head = [''].concat(ROLLOUT_TYPES.map(function(t){ return t.label; })).concat(['Total']);
    if (extra) head = head.concat(extra.labels);
    aoa.push(head);
    countryList.forEach(function(c){
      var row = mx.m[c] || {}, tot = 0;
      var line = [c];
      ROLLOUT_TYPES.forEach(function(t){ var n = row[t.key]||0; tot += n; line.push(n||''); });
      line.push(tot);
      if (extra) extra.values(c).forEach(function(v){ line.push(v); });
      aoa.push(line);
    });
    var footer = ['Total'];
    ROLLOUT_TYPES.forEach(function(t){ footer.push(mx.colTotals[t.key]||''); });
    footer.push(mx.grand);
    if (extra) extra.totals().forEach(function(v){ footer.push(v); });
    aoa.push(footer);
    aoa.push([]);
  }

  aoa.push([ROLLOUT_PROJECT.name + ' — Rollout report']);
  aoa.push(['Generated', fmtDate(today)]);
  aoa.push([]);

  block('SOW', sow, countries);
  block('COMPLETED till Today-' + today.split('-').reverse().join('/'), done, countries, {
    labels: ['Completed', 'Remaining Sites'],
    values: function(c){
      return [ done.filter(function(r){ return r.country===c; }).length,
               remaining.filter(function(r){ return r.country===c; }).length ];
    },
    totals: function(){ return [done.length, remaining.length]; }
  });

  countries.forEach(function(c){
    var inC = done.filter(function(r){ return r.country===c && r.city; });
    if (!inC.length) return;
    var mapped = inC.map(function(r){ return { country:r.city, site_type:r.site_type }; });
    block(c + ' Breakdown', mapped, _rolloutCountries(mapped));
  });

  var mpls = all.filter(function(r){ return r.mpls_configured; });
  block('MPLS Config Breakdown', mpls, _rolloutCountries(mpls));

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Rollout');

  // Second sheet: the raw sites, so the numbers can always be traced back.
  var sites = [['Site','Country','City','Type','In SOW','Status','Completed','MPLS','MPLS on']];
  all.forEach(function(r){
    sites.push([r.site_name, r.country, r.city||'', ROLLOUT_TYPE_LABEL[r.site_type]||r.site_type,
                r.in_sow?'Yes':'No', r.status, r.completed_on||'',
                r.mpls_configured?'Yes':'No', r.mpls_on||'']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sites), 'Sites');

  var slug = String(ROLLOUT_PROJECT.name||'rollout').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  XLSX.writeFile(wb, slug + '-rollout-' + today + '.xlsx');
  showToast('Report exported ✓');
}
