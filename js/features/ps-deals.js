// == PROFESSIONAL SERVICES DEALS ===================================
// Manager-only commercial register of PS deals quoted/sold to clients.
//
// Three tables back this:
//   ps_deals       — one row per deal (header info, financials, status)
//   ps_milestones  — per-year work completed against a deal
//   ps_payments    — per-year cash received against a deal
//
// RLS keeps these manager-only at the DB layer; this module also guards
// at the UI layer (Manager-section sidebar hidden for employees).
//
// Currency model: USD is stored, AED is derived via usdToAed() at
// display time. Never persist AED.

var PS_DEALS      = [];
var PS_MILESTONES = [];
var PS_PAYMENTS   = [];
var _psEditingId  = null;          // null = create, number = edit
var _psSubrowSeq  = 0;             // monotonic id for in-form sub-rows

var PS_REGIONS = ['UAE','KSA','Qatar','Oman','Bahrain','Kuwait','Other'];
var PS_MODES   = ['Remote','Remote+Onsite','Onsite','Shared (GulfIT-Partner)'];
var PS_STATUS_META = {
  quoted:      { label:'Quoted',      cls:'ps-st-quoted' },
  won:         { label:'Won',         cls:'ps-st-won' },
  in_progress: { label:'In Progress', cls:'ps-st-inprog' },
  completed:   { label:'Completed',   cls:'ps-st-done' },
  lost:        { label:'Lost',        cls:'ps-st-lost' },
  cancelled:   { label:'Cancelled',   cls:'ps-st-cancelled' }
};

// ── LOAD ──────────────────────────────────────────────────────────
async function loadPsDeals() {
  var loadEl = document.getElementById('ps-load');
  if (loadEl) loadEl.style.display = 'flex';
  var [dRes, mRes, pRes] = await Promise.all([
    sb.from('ps_deals').select('*').order('quoted_year',{ascending:false,nullsFirst:false}).order('quoted_month',{ascending:false,nullsFirst:false}),
    sb.from('ps_milestones').select('*'),
    sb.from('ps_payments').select('*')
  ]);
  if (loadEl) loadEl.style.display = 'none';
  if (dRes.error) { showError('Could not load PS deals: '+dRes.error.message); return; }
  if (mRes.error) { showError('Could not load milestones: '+mRes.error.message); return; }
  if (pRes.error) { showError('Could not load payments: '+pRes.error.message); return; }
  PS_DEALS      = dRes.data || [];
  PS_MILESTONES = mRes.data || [];
  PS_PAYMENTS   = pRes.data || [];
  _psPopulateFilters();
  renderPsDeals();
}

// ── FILTERS ───────────────────────────────────────────────────────
function _psPopulateFilters() {
  // Each filter dropdown only lists values that actually exist in the
  // current dataset — keeps the bar tidy as the register grows.
  var clientSel = document.getElementById('ps-filter-client');
  var regionSel = document.getElementById('ps-filter-region');
  var yearSel   = document.getElementById('ps-filter-year');

  if (clientSel) {
    var prev = clientSel.value;
    var seen = {}, names = [];
    PS_DEALS.forEach(function(d){
      if (d.client_name && !seen[d.client_name]) { seen[d.client_name] = 1; names.push(d.client_name); }
    });
    names.sort(function(a,b){ return a.localeCompare(b); });
    clientSel.innerHTML = '<option value="">All Clients</option>' +
      names.map(function(n){ return '<option value="'+esc2(n)+'">'+esc2(n)+'</option>'; }).join('');
    if (prev) clientSel.value = prev;
  }
  if (regionSel) {
    var prev2 = regionSel.value;
    var rSeen = {}, regions = [];
    PS_DEALS.forEach(function(d){ if (d.region && !rSeen[d.region]) { rSeen[d.region]=1; regions.push(d.region); } });
    regions.sort();
    regionSel.innerHTML = '<option value="">All Regions</option>' +
      regions.map(function(r){ return '<option value="'+esc2(r)+'">'+esc2(r)+'</option>'; }).join('');
    if (prev2) regionSel.value = prev2;
  }
  if (yearSel) {
    var prev3 = yearSel.value;
    var ySeen = {};
    PS_DEALS.forEach(function(d){ if (d.quoted_year) ySeen[d.quoted_year] = 1; });
    var years = Object.keys(ySeen).sort(function(a,b){ return Number(b)-Number(a); });
    yearSel.innerHTML = '<option value="">All Years</option>' +
      years.map(function(y){ return '<option value="'+y+'">'+y+'</option>'; }).join('');
    if (prev3) yearSel.value = prev3;
  }
}

function clearPsFilters() {
  ['ps-search','ps-filter-client','ps-filter-region','ps-filter-year'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  renderPsDeals();
}

function _psFilteredDeals() {
  var search = (((document.getElementById('ps-search')||{}).value)||'').toLowerCase().trim();
  var client = ((document.getElementById('ps-filter-client')||{}).value)||'';
  var region = ((document.getElementById('ps-filter-region')||{}).value)||'';
  var year   = ((document.getElementById('ps-filter-year')||{}).value)||'';
  var rows = (PS_DEALS||[]).slice();
  if (client) rows = rows.filter(function(d){ return d.client_name === client; });
  if (region) rows = rows.filter(function(d){ return d.region === region; });
  if (year)   rows = rows.filter(function(d){ return String(d.quoted_year) === String(year); });
  if (search) {
    rows = rows.filter(function(d){
      return [d.client_name, d.partner, d.remarks, d.supplier, d.consulted_with_tech]
        .some(function(f){ return f && String(f).toLowerCase().indexOf(search) !== -1; });
    });
  }
  return rows;
}

// ── HELPERS ───────────────────────────────────────────────────────
function _psStatusBadge(status) {
  var meta = PS_STATUS_META[status] || { label: status || '—', cls: 'ps-st-quoted' };
  return '<span class="badge '+meta.cls+'">'+esc2(meta.label)+'</span>';
}

function _psQuotedLabel(d) {
  if (!d.quoted_year) return '—';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (d.quoted_month && d.quoted_month >= 1 && d.quoted_month <= 12) {
    return d.quoted_year + '-' + months[d.quoted_month-1];
  }
  return String(d.quoted_year);
}

// Build "2024: $20K · 2025: $22K" summary from child rows.
function _psChildSummary(dealId, source) {
  var rows = source.filter(function(r){ return r.deal_id === dealId; });
  if (!rows.length) return '<span class="dim">—</span>';
  rows.sort(function(a,b){ return a.year - b.year; });
  return rows.map(function(r){
    return r.year + ': ' + fmtUsd(r.amount_usd, false);
  }).join(' · ');
}

function _psUsdCell(usd) {
  if (usd === null || usd === undefined || usd === '') return '<span class="dim">—</span>';
  return '<div class="num" style="font-weight:600;color:var(--navy)">'+fmtUsd(usd, false)+'</div>'+
         '<div class="num" style="font-size:11px;color:var(--muted)">'+fmtAed(usdToAed(usd), false)+'</div>';
}

function _psLinkedEngagementLabel(engId) {
  if (!engId) return '<span class="dim">—</span>';
  var eng = (ENGAGEMENTS||[]).find(function(e){ return e.id === engId; });
  if (!eng) return '<span class="dim">(deleted)</span>';
  return '<span class="ps-eng-link" title="Linked engagement"><i data-lucide="link-2" style="width:11px;height:11px;vertical-align:-1px"></i> '+esc2(eng.name)+'</span>';
}

// ── RENDER ────────────────────────────────────────────────────────
function renderPsDeals() {
  var content = document.getElementById('ps-content');
  if (!content) return;
  var rows = _psFilteredDeals();
  if (!rows.length) {
    var total = (PS_DEALS||[]).length;
    content.innerHTML = renderEmptyState({
      icon: total === 0 ? 'briefcase' : 'search-x',
      heading: total === 0 ? 'No PS deals yet' : 'No deals match the current filters',
      sub: total === 0
        ? 'Manager-only register. Click + New Deal to add the first one.'
        : 'Try adjusting or clearing the filters.',
      btnText: total === 0 ? '+ New Deal' : (total > 0 ? 'Clear filters' : ''),
      btnOnclick: total === 0 ? 'openPsDealModal()' : (total > 0 ? 'clearPsFilters()' : '')
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  var isMobile = window.innerWidth < 768;
  content.innerHTML = (isMobile ? _psRenderCards(rows) : _psRenderTable(rows)) +
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+(PS_DEALS||[]).length+' deals</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function _psRenderTable(rows) {
  var body = rows.map(function(d, i){
    return '<tr class="ps-row" onclick="openPsDealModal('+d.id+')">'+
      '<td style="color:var(--muted);font-size:12px">'+(i+1)+'</td>'+
      '<td><strong style="color:var(--navy)">'+esc2(d.client_name||'—')+'</strong></td>'+
      '<td class="hide-mobile" style="font-size:12px">'+esc2(d.partner||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:12px">'+esc2(d.region||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:12px">'+esc2(d.mode||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:12px">'+esc2(d.supplier||'—')+'</td>'+
      '<td class="num" style="font-size:12px">'+_psQuotedLabel(d)+'</td>'+
      '<td class="num hide-mobile" style="font-size:12px">'+(d.awarded_year||'—')+'</td>'+
      '<td class="num hide-mobile">'+(d.man_days!=null?d.man_days:'—')+'</td>'+
      '<td>'+_psUsdCell(d.ps_quoted_tech_usd)+'</td>'+
      '<td class="hide-mobile">'+_psUsdCell(d.ps_quoted_sales_usd)+'</td>'+
      '<td>'+_psUsdCell(d.final_ps_value_usd)+'</td>'+
      '<td>'+_psStatusBadge(d.status)+'</td>'+
      '<td class="hide-mobile" style="font-size:11px">'+_psChildSummary(d.id, PS_MILESTONES)+'</td>'+
      '<td class="hide-mobile" style="font-size:11px">'+_psChildSummary(d.id, PS_PAYMENTS)+'</td>'+
      '<td class="hide-mobile" style="font-size:12px">'+_psLinkedEngagementLabel(d.linked_engagement_id)+'</td>'+
      '<td style="white-space:nowrap;text-align:right" onclick="event.stopPropagation()">'+
        '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="openPsDealModal('+d.id+')" title="Edit"><i data-lucide="pencil"></i></button>'+
      '</td>'+
    '</tr>';
  }).join('');
  return '<div class="card" style="padding:0">'+
    '<div class="table-wrap"><table class="ps-table">'+
      '<thead><tr>'+
        '<th>#</th>'+
        '<th>Client</th>'+
        '<th class="hide-mobile">Partner</th>'+
        '<th class="hide-mobile">Region</th>'+
        '<th class="hide-mobile">Mode</th>'+
        '<th class="hide-mobile">Supplier</th>'+
        '<th>Quoted</th>'+
        '<th class="hide-mobile">Awarded</th>'+
        '<th class="hide-mobile">Man&nbsp;Days</th>'+
        '<th>PS Tech</th>'+
        '<th class="hide-mobile">PS Sales</th>'+
        '<th>Final</th>'+
        '<th>Status</th>'+
        '<th class="hide-mobile">Milestones</th>'+
        '<th class="hide-mobile">Payments</th>'+
        '<th class="hide-mobile">Engagement</th>'+
        '<th></th>'+
      '</tr></thead><tbody>'+body+'</tbody></table></div>'+
  '</div>';
}

function _psRenderCards(rows) {
  return '<div class="ps-cards">' + rows.map(function(d){
    return '<div class="ps-card" onclick="openPsDealModal('+d.id+')">'+
      '<div class="ps-card-head">'+
        '<div class="ps-card-client">'+esc2(d.client_name||'—')+'</div>'+
        _psStatusBadge(d.status)+
      '</div>'+
      '<div class="ps-card-meta">'+esc2(d.partner||'—')+' · '+esc2(d.region||'—')+' · '+esc2(d.mode||'—')+'</div>'+
      '<div class="ps-card-row">'+
        '<span class="num" style="font-weight:600">'+fmtUsd(d.final_ps_value_usd, false)+'</span>'+
        '<span class="ps-card-sep">·</span>'+
        '<span class="num" style="font-size:11px;color:var(--muted)">'+fmtAed(usdToAed(d.final_ps_value_usd), false)+'</span>'+
      '</div>'+
      '<div class="ps-card-row dim" style="font-size:11px">'+
        '<span>Quoted '+_psQuotedLabel(d)+'</span>'+
        '<span>Tap to edit</span>'+
      '</div>'+
    '</div>';
  }).join('') + '</div>';
}

// ── MODAL: OPEN ───────────────────────────────────────────────────
function openPsDealModal(id) {
  if (!isManager) { showError('Manager access only.'); return; }
  var modal = document.getElementById('ps-deal-modal');
  if (!modal) return;
  _psEditingId = id || null;
  var d = id ? (PS_DEALS||[]).find(function(x){ return x.id === id; }) : null;
  document.getElementById('ps-modal-title').textContent = d ? 'Edit PS Deal' : 'New PS Deal';
  var delBtn = document.getElementById('ps-delete-btn');
  if (delBtn) delBtn.style.display = d ? '' : 'none';
  var errEl = document.getElementById('ps-modal-error');
  if (errEl) errEl.style.display = 'none';

  _psPopulateSelects();
  _psPopulateDatalists();
  _psPopulateLinkedEngagementSelect(d ? d.linked_engagement_id : null, d ? d.client_name : '');
  _psSeedForm(d);
  _psRebuildSubrows(d);

  modal.classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
  // Live re-filter the linked-engagement dropdown when client changes
  var clientEl = document.getElementById('ps-client');
  if (clientEl) clientEl.oninput = function(){
    _psPopulateLinkedEngagementSelect(null, clientEl.value);
  };
}

function closePsDealModal() {
  var modal = document.getElementById('ps-deal-modal');
  if (modal) modal.classList.remove('show');
  _psEditingId = null;
}

function _psPopulateSelects() {
  var rSel = document.getElementById('ps-region');
  rSel.innerHTML = '<option value="">—</option>' +
    PS_REGIONS.map(function(r){ return '<option value="'+r+'">'+r+'</option>'; }).join('');
  var mSel = document.getElementById('ps-mode');
  mSel.innerHTML = '<option value="">—</option>' +
    PS_MODES.map(function(m){ return '<option value="'+esc2(m)+'">'+esc2(m)+'</option>'; }).join('');
}

function _psPopulateDatalists() {
  // Client autocomplete = union of CUSTOMERS + every distinct ps_deals.client_name
  var clientList = document.getElementById('ps-client-list');
  if (clientList) {
    var seen = {};
    (CUSTOMERS||[]).forEach(function(c){ if (c.name) seen[c.name] = 1; });
    PS_DEALS.forEach(function(d){ if (d.client_name) seen[d.client_name] = 1; });
    var names = Object.keys(seen).sort();
    clientList.innerHTML = names.map(function(n){ return '<option value="'+esc2(n)+'">'; }).join('');
  }
  var partnerList = document.getElementById('ps-partner-list');
  if (partnerList) {
    var pSeen = {};
    PS_DEALS.forEach(function(d){ if (d.partner) pSeen[d.partner] = 1; });
    partnerList.innerHTML = Object.keys(pSeen).sort().map(function(n){ return '<option value="'+esc2(n)+'">'; }).join('');
  }
  var supplierList = document.getElementById('ps-supplier-list');
  if (supplierList) {
    var sSeen = {};
    (typeof VENDORS !== 'undefined' && VENDORS || []).forEach(function(v){ if (v && v.name) sSeen[v.name] = 1; });
    PS_DEALS.forEach(function(d){ if (d.supplier) sSeen[d.supplier] = 1; });
    supplierList.innerHTML = Object.keys(sSeen).sort().map(function(n){ return '<option value="'+esc2(n)+'">'; }).join('');
  }
}

// Filter linked-engagement dropdown to engagements of the selected client.
// If no client typed yet, show ALL engagements (sorted). Always include any
// existing link so edit doesn't silently lose the reference.
function _psPopulateLinkedEngagementSelect(currentEngId, clientName) {
  var sel = document.getElementById('ps-linked-eng');
  if (!sel) return;
  var custRow = (CUSTOMERS||[]).find(function(c){ return clientName && c.name === clientName; });
  var custId  = custRow ? custRow.id : null;
  var list = (ENGAGEMENTS||[]).slice();
  if (custId) list = list.filter(function(e){ return e.customer_id === custId; });
  list.sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||'')); });
  // Make sure the current link is in the list even if filter would drop it
  if (currentEngId && !list.some(function(e){ return e.id === currentEngId; })) {
    var match = (ENGAGEMENTS||[]).find(function(e){ return e.id === currentEngId; });
    if (match) list.unshift(match);
  }
  sel.innerHTML = '<option value="">— None / Standalone —</option>' +
    list.map(function(e){
      var custLbl = '';
      var cust = (CUSTOMERS||[]).find(function(c){ return c.id === e.customer_id; });
      if (cust) custLbl = ' — '+cust.name;
      return '<option value="'+e.id+'">'+esc2(e.name||'')+esc2(custLbl)+'</option>';
    }).join('');
  if (currentEngId) sel.value = String(currentEngId);
}

function _psSeedForm(d) {
  var cur = new Date().getFullYear();
  document.getElementById('ps-client').value         = d ? (d.client_name||'') : '';
  document.getElementById('ps-partner').value        = d ? (d.partner||'') : '';
  document.getElementById('ps-region').value         = d ? (d.region||'') : '';
  document.getElementById('ps-mode').value           = d ? (d.mode||'') : '';
  document.getElementById('ps-supplier').value       = d ? (d.supplier||'') : '';
  document.getElementById('ps-quoted-year').value    = d ? (d.quoted_year||cur) : cur;
  document.getElementById('ps-quoted-month').value   = d ? (d.quoted_month||'') : '';
  document.getElementById('ps-awarded-year').value   = d ? (d.awarded_year||'') : '';
  document.getElementById('ps-man-days').value       = d ? (d.man_days!=null?d.man_days:'') : '';
  document.getElementById('ps-tech-usd').value       = d ? (d.ps_quoted_tech_usd!=null?d.ps_quoted_tech_usd:'') : '';
  document.getElementById('ps-sales-usd').value      = d ? (d.ps_quoted_sales_usd!=null?d.ps_quoted_sales_usd:'') : '';
  document.getElementById('ps-final-usd').value      = d ? (d.final_ps_value_usd!=null?d.final_ps_value_usd:'') : '';
  document.getElementById('ps-status').value         = d ? (d.status||'quoted') : 'quoted';
  document.getElementById('ps-consulted').value      = d ? (d.consulted_with_tech||'') : '';
  document.getElementById('ps-remarks').value        = d ? (d.remarks||'') : '';
  // Refresh the live AED labels next to each USD input
  _psUpdateAed('ps-tech-usd','ps-tech-aed');
  _psUpdateAed('ps-sales-usd','ps-sales-aed');
  _psUpdateAed('ps-final-usd','ps-final-aed');
}

function _psRebuildSubrows(deal) {
  var mWrap = document.getElementById('ps-milestones-wrap');
  var pWrap = document.getElementById('ps-payments-wrap');
  if (mWrap) mWrap.innerHTML = '';
  if (pWrap) pWrap.innerHTML = '';
  if (!deal) return;
  var ms = PS_MILESTONES.filter(function(r){ return r.deal_id === deal.id; })
                        .sort(function(a,b){ return a.year - b.year; });
  ms.forEach(function(r){ _psAddMilestoneRow(r.year, r.amount_usd, r.notes); });
  var py = PS_PAYMENTS.filter(function(r){ return r.deal_id === deal.id; })
                      .sort(function(a,b){ return a.year - b.year; });
  py.forEach(function(r){ _psAddPaymentRow(r.year, r.amount_usd, r.notes); });
}

// ── MODAL: USD ↔ AED LIVE READOUT ─────────────────────────────────
function _psUpdateAed(inputId, spanId) {
  var input = document.getElementById(inputId);
  var span  = document.getElementById(spanId);
  if (!input || !span) return;
  var v = input.value;
  if (v === '' || isNaN(v)) { span.textContent = '≈ —'; return; }
  span.textContent = '≈ ' + fmtAed(usdToAed(v), true);
}

// ── MODAL: SUB-ROWS (milestones + payments share the row template) ─
function _psBuildSubrow(kind, year, amount, notes) {
  var id = ++_psSubrowSeq;
  var rowId = 'ps-'+kind+'-row-'+id;
  var aedId = 'ps-'+kind+'-aed-'+id;
  var amtId = 'ps-'+kind+'-amt-'+id;
  var yrEl = (year != null) ? String(year) : '';
  var amtEl = (amount != null) ? String(amount) : '';
  var notesEl = notes != null ? esc2(notes) : '';
  return '<div class="ps-subrow" id="'+rowId+'" data-kind="'+kind+'">'+
    '<input type="number" class="ps-year-input" min="2000" max="2100" placeholder="Year" value="'+yrEl+'">'+
    '<div class="ps-usd-row">'+
      '<input type="number" class="ps-amount-input" id="'+amtId+'" min="0" step="0.01" placeholder="0.00" value="'+amtEl+'" oninput="_psUpdateAed(\''+amtId+'\',\''+aedId+'\')">'+
      '<span class="ps-aed-display" id="'+aedId+'">≈ —</span>'+
    '</div>'+
    '<input type="text" class="ps-notes-input" placeholder="Notes" value="'+notesEl+'">'+
    '<button type="button" class="btn btn-sm btn-ghost btn-icon-only" onclick="_psRemoveSubrow(\''+rowId+'\')" title="Remove"><i data-lucide="x"></i></button>'+
  '</div>';
}

function _psAddMilestoneRow(year, amount, notes) {
  var wrap = document.getElementById('ps-milestones-wrap');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', _psBuildSubrow('m', year, amount, notes));
  // Seed AED next to the amount we just inserted
  var lastAmt = wrap.lastElementChild.querySelector('.ps-amount-input');
  var lastAed = wrap.lastElementChild.querySelector('.ps-aed-display');
  if (lastAmt && lastAed) {
    var v = lastAmt.value;
    if (v !== '' && !isNaN(v)) lastAed.textContent = '≈ ' + fmtAed(usdToAed(v), true);
  }
  if (typeof renderIcons === 'function') renderIcons();
}

function _psAddPaymentRow(year, amount, notes) {
  var wrap = document.getElementById('ps-payments-wrap');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', _psBuildSubrow('p', year, amount, notes));
  var lastAmt = wrap.lastElementChild.querySelector('.ps-amount-input');
  var lastAed = wrap.lastElementChild.querySelector('.ps-aed-display');
  if (lastAmt && lastAed) {
    var v = lastAmt.value;
    if (v !== '' && !isNaN(v)) lastAed.textContent = '≈ ' + fmtAed(usdToAed(v), true);
  }
  if (typeof renderIcons === 'function') renderIcons();
}

function _psRemoveSubrow(rowId) {
  var el = document.getElementById(rowId);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function _psCollectSubrows(wrapId) {
  var wrap = document.getElementById(wrapId);
  if (!wrap) return [];
  var out = [];
  wrap.querySelectorAll('.ps-subrow').forEach(function(row){
    var year = row.querySelector('.ps-year-input').value;
    var amt  = row.querySelector('.ps-amount-input').value;
    var nt   = row.querySelector('.ps-notes-input').value;
    if (!year || amt === '' || isNaN(amt)) return; // skip blank/incomplete rows
    out.push({ year: parseInt(year,10), amount_usd: Number(amt), notes: nt || null });
  });
  return out;
}

// ── MODAL: SAVE ───────────────────────────────────────────────────
function _psShowModalError(msg) {
  var el = document.getElementById('ps-modal-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
}

async function savePsDeal() {
  if (!isManager) { showError('Manager access only.'); return; }
  var errEl = document.getElementById('ps-modal-error');
  if (errEl) errEl.style.display = 'none';

  var client    = (document.getElementById('ps-client').value||'').trim();
  var partner   = (document.getElementById('ps-partner').value||'').trim();
  var region    = document.getElementById('ps-region').value || null;
  var mode      = document.getElementById('ps-mode').value || null;
  var supplier  = (document.getElementById('ps-supplier').value||'').trim();
  var qYear     = document.getElementById('ps-quoted-year').value;
  var qMonth    = document.getElementById('ps-quoted-month').value;
  var aYear     = document.getElementById('ps-awarded-year').value;
  var manDays   = document.getElementById('ps-man-days').value;
  var techUsd   = document.getElementById('ps-tech-usd').value;
  var salesUsd  = document.getElementById('ps-sales-usd').value;
  var finalUsd  = document.getElementById('ps-final-usd').value;
  var status    = document.getElementById('ps-status').value;
  var consulted = (document.getElementById('ps-consulted').value||'').trim();
  var remarks   = (document.getElementById('ps-remarks').value||'').trim();
  var linkedEng = document.getElementById('ps-linked-eng').value;

  if (!client)    { _psShowModalError('Client is required.'); return; }
  if (!status)    { _psShowModalError('Status is required.'); return; }
  if (status !== 'quoted' && status !== 'lost' && (finalUsd === '' || isNaN(finalUsd))) {
    _psShowModalError('Final PS Value is required once the deal is past Quoted/Lost.');
    return;
  }

  var milestones = _psCollectSubrows('ps-milestones-wrap');
  var payments   = _psCollectSubrows('ps-payments-wrap');
  // UNIQUE(deal_id, year) — catch duplicate years in the UI so the user
  // sees a friendly message instead of a Postgres constraint error.
  if (_psHasDupYear(milestones)) { _psShowModalError('Two milestone rows share the same year — please consolidate.'); return; }
  if (_psHasDupYear(payments))   { _psShowModalError('Two payment rows share the same year — please consolidate.'); return; }

  var btn = document.getElementById('ps-save-btn');
  var orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Saving…'; }

  var payload = {
    client_name:          client,
    partner:              partner || null,
    region:               region,
    mode:                 mode,
    supplier:             supplier || null,
    quoted_year:          qYear  ? parseInt(qYear,10)  : null,
    quoted_month:         qMonth ? parseInt(qMonth,10) : null,
    awarded_year:         aYear  ? parseInt(aYear,10)  : null,
    man_days:             manDays  !== '' ? Number(manDays)  : null,
    ps_quoted_tech_usd:   techUsd  !== '' ? Number(techUsd)  : null,
    ps_quoted_sales_usd:  salesUsd !== '' ? Number(salesUsd) : null,
    final_ps_value_usd:   finalUsd !== '' ? Number(finalUsd) : null,
    status:               status,
    consulted_with_tech:  consulted || null,
    remarks:              remarks   || null,
    linked_engagement_id: linkedEng ? parseInt(linkedEng,10) : null,
    updated_at:           new Date().toISOString()
  };

  var dealId = _psEditingId;
  if (dealId) {
    var upd = await sb.from('ps_deals').update(payload).eq('id', dealId);
    if (upd.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Save failed: '+upd.error.message); return; }
  } else {
    payload.created_by = currentUser || null;
    var ins = await sb.from('ps_deals').insert(payload).select().single();
    if (ins.error || !ins.data) { _psResetSaveBtn(btn, orig); _psShowModalError('Save failed: '+((ins.error&&ins.error.message)||'no row returned')); return; }
    dealId = ins.data.id;
  }

  // Wipe-and-replace strategy for children. Cleaner than diff logic for the
  // tiny row counts here (≤10 milestones, ≤10 payments per deal). UNIQUE
  // constraint protects against duplicates.
  var delM = await sb.from('ps_milestones').delete().eq('deal_id', dealId);
  var delP = await sb.from('ps_payments').delete().eq('deal_id', dealId);
  if (delM.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Milestone wipe failed: '+delM.error.message); return; }
  if (delP.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Payment wipe failed: '+delP.error.message); return; }

  if (milestones.length) {
    var msRows = milestones.map(function(m){ return { deal_id: dealId, year: m.year, amount_usd: m.amount_usd, notes: m.notes }; });
    var insM = await sb.from('ps_milestones').insert(msRows);
    if (insM.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Milestones save failed: '+insM.error.message); return; }
  }
  if (payments.length) {
    var pyRows = payments.map(function(p){ return { deal_id: dealId, year: p.year, amount_usd: p.amount_usd, notes: p.notes }; });
    var insP = await sb.from('ps_payments').insert(pyRows);
    if (insP.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Payments save failed: '+insP.error.message); return; }
  }

  _psResetSaveBtn(btn, orig);
  closePsDealModal();
  showToast('Deal saved ✓');
  await loadPsDeals();
}

function _psResetSaveBtn(btn, orig) {
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = orig || '<i data-lucide="check" class="btn-icon"></i>Save Deal';
  if (typeof renderIcons === 'function') renderIcons();
}

function _psHasDupYear(rows) {
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    if (seen[rows[i].year]) return true;
    seen[rows[i].year] = 1;
  }
  return false;
}

// ── DELETE ────────────────────────────────────────────────────────
async function deletePsDealFromModal() {
  if (!_psEditingId) return;
  var d = (PS_DEALS||[]).find(function(x){ return x.id === _psEditingId; });
  if (!d) return;
  if (!await confirmAction({
    title: 'Delete deal "'+(d.client_name||'')+'"?',
    body: 'This removes the deal and all linked milestones + payments.\n\nThis cannot be undone.',
    requireTyping: d.client_name,
    confirmText: 'Delete deal'
  })) return;
  var res = await sb.from('ps_deals').delete().eq('id', _psEditingId);
  if (res.error) { showError('Delete failed: '+res.error.message); return; }
  closePsDealModal();
  showToast('Deal deleted ✓');
  await loadPsDeals();
}

// ── TRACKER INTEGRATION ───────────────────────────────────────────
// Called by tracker.js openTrackerDetail to surface deals linked to the
// engagement currently in view. Manager-only; returns empty string for
// employees so the "Linked PS Deals" header doesn't render.
function renderLinkedPsDealsForEngagement(engagementId) {
  if (!isManager) return '';
  if (!engagementId) return '';
  var linked = (PS_DEALS||[]).filter(function(d){ return d.linked_engagement_id === engagementId; });
  if (!linked.length) return '';
  var rows = linked.map(function(d){
    return '<div class="ps-linked-row" onclick="event.stopPropagation();openPsDealModal('+d.id+')">'+
      '<span class="ps-linked-client">'+esc2(d.client_name||'—')+'</span>'+
      '<span class="ps-linked-val num">'+fmtUsd(d.final_ps_value_usd, false)+'</span>'+
      _psStatusBadge(d.status)+
    '</div>';
  }).join('');
  return '<div class="ps-linked-block">'+
    '<div class="ps-linked-head"><i data-lucide="briefcase" style="width:13px;height:13px;vertical-align:-2px"></i> Linked PS Deals <span class="dim">('+linked.length+')</span></div>'+
    rows+
  '</div>';
}

// ── CSV EXPORT ────────────────────────────────────────────────────
function downloadPsDealsCsv() {
  if (!isManager) { showError('Manager access only.'); return; }
  var rows = _psFilteredDeals();
  var header = [
    'S.No','Client','Partner','Region','Mode','Supplier',
    'Quoted Year','Quoted Month','Awarded Year','Man Days',
    'PS Tech USD','PS Sales USD','Final USD',
    'Status','Milestones','Payments','Linked Engagement','Consulted','Remarks'
  ];
  function esc(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/"/g, '""');
    return '"' + s + '"';
  }
  function summarise(dealId, src) {
    var arr = src.filter(function(r){ return r.deal_id === dealId; })
                 .sort(function(a,b){ return a.year - b.year; });
    return arr.map(function(r){ return r.year + ':' + r.amount_usd; }).join(',');
  }
  var lines = [ header.map(esc).join(',') ];
  rows.forEach(function(d, i){
    var eng = (ENGAGEMENTS||[]).find(function(e){ return e.id === d.linked_engagement_id; });
    lines.push([
      i+1, d.client_name, d.partner, d.region, d.mode, d.supplier,
      d.quoted_year, d.quoted_month, d.awarded_year, d.man_days,
      d.ps_quoted_tech_usd, d.ps_quoted_sales_usd, d.final_ps_value_usd,
      d.status,
      summarise(d.id, PS_MILESTONES),
      summarise(d.id, PS_PAYMENTS),
      eng ? eng.name : '',
      d.consulted_with_tech, d.remarks
    ].map(esc).join(','));
  });
  if (rows.length === 0) lines.push(esc('No data') + ',,,,,,,,,,,,,,,,,,'); // header + 1 row so the file isn't empty
  var blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = 'ps-deals-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Re-render on viewport crossing 768px so table↔cards swap doesn't get
// stuck on the wrong layout when the user rotates / resizes mid-session.
var _psLastIsMobile = (typeof window !== 'undefined' && window.innerWidth < 768);
window.addEventListener('resize', function(){
  var nowMobile = window.innerWidth < 768;
  if (_psLastIsMobile !== nowMobile && PS_DEALS && PS_DEALS.length) {
    var screenEl = document.getElementById('screen-psdeals');
    if (screenEl && screenEl.classList.contains('active')) renderPsDeals();
  }
  _psLastIsMobile = nowMobile;
});
