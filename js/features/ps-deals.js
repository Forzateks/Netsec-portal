// == PROFESSIONAL SERVICES DEALS ===================================
// Manager-only commercial register of PS deals quoted/sold to clients.
//
// Two tables back this:
//   ps_deals       — one row per deal (header info, financials, status)
//   ps_milestones  — discrete project phases per deal. Each row carries
//                    the milestone's amount, payment received, status,
//                    and dates. Replaces the v60 split (year-bucket
//                    milestones + year-bucket payments) with one row
//                    per real-world phase.
//
// RLS keeps these manager-only at the DB layer; this module also guards
// at the UI layer (Manager-section sidebar hidden for employees).
//
// Currency model: USD is stored, AED is derived via usdToAed() at
// display time. Never persist AED.

var PS_DEALS      = [];
var PS_MILESTONES = [];
var _psEditingId  = null;          // null = create, number = edit
var _psSubrowSeq  = 0;             // monotonic id for in-form sub-rows
// Auto-split flag per modal session. False on modal open → "+ Add
// milestone" recomputes an even split. The flag flips to true on the
// first manual amount edit so subsequent adds don't silently overwrite
// the user's numbers. "Re-balance evenly" resets it back to false.
var _psMilestonesUserEdited = false;

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

// Per-milestone status (separate vocabulary from deal status). Five
// states from "Not Started" through "Completed".
var PS_MS_STATUSES = ['not_started','active','awaiting_signoff','awaiting_payment','completed'];
var PS_MS_STATUS_META = {
  not_started:       { label:'Not Started',        cls:'ps-msst-notstarted' },
  active:            { label:'Active',             cls:'ps-msst-active' },
  awaiting_signoff:  { label:'Awaiting Sign-off',  cls:'ps-msst-signoff' },
  awaiting_payment:  { label:'Awaiting Payment',   cls:'ps-msst-payment' },
  completed:         { label:'Completed',          cls:'ps-msst-done' }
};

// ── LOAD ──────────────────────────────────────────────────────────
async function loadPsDeals() {
  var loadEl = document.getElementById('ps-load');
  if (loadEl) loadEl.style.display = 'flex';
  var [dRes, mRes] = await Promise.all([
    sb.from('ps_deals').select('*').order('quoted_year',{ascending:false,nullsFirst:false}).order('quoted_month',{ascending:false,nullsFirst:false}),
    sb.from('ps_milestones').select('*').order('sequence_order',{ascending:true})
  ]);
  if (loadEl) loadEl.style.display = 'none';
  if (dRes.error) { showError('Could not load PS deals: '+dRes.error.message); return; }
  if (mRes.error) { showError('Could not load milestones: '+mRes.error.message); return; }
  PS_DEALS      = dRes.data || [];
  PS_MILESTONES = mRes.data || [];
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

// Roll up milestone counts + payment totals for a deal. Returns an
// object the list view and tracker integration both consume.
function _psDealProgress(dealId) {
  var ms = (PS_MILESTONES||[]).filter(function(m){ return m.deal_id === dealId; });
  var doneCount = 0;
  var paidTotal = 0;
  ms.forEach(function(m){
    if (m.status === 'completed') doneCount += 1;
    paidTotal += Number(m.payment_received_usd) || 0;
  });
  return { total: ms.length, done: doneCount, paid: paidTotal };
}

// "3 / 5 done · $6,000 / $10,000 paid" — list view summary cell.
function _psProgressCell(deal) {
  var p = _psDealProgress(deal.id);
  if (!p.total) return '<span class="dim">—</span>';
  var final = deal.final_ps_value_usd;
  var paidLabel = (final != null && final !== '')
    ? (fmtUsd(p.paid, false) + ' / ' + fmtUsd(final, false) + ' paid')
    : (fmtUsd(p.paid, false) + ' paid');
  return '<div class="num" style="font-size:11px;line-height:1.4">'+
    p.done + ' / ' + p.total + ' done · ' + paidLabel +
  '</div>';
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
      '<td class="hide-mobile">'+_psProgressCell(d)+'</td>'+
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
        '<th class="hide-mobile">Progress</th>'+
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

// Rebuild the milestone rows when the modal opens. For a new deal,
// leaves the table empty (user clicks "+ Add milestone" once Final
// Value is entered). For an edit, replays each persisted row in
// sequence_order with its DB id stashed so save can do an UPDATE
// vs INSERT diff.
function _psRebuildSubrows(deal) {
  var wrap = document.getElementById('ps-milestones-wrap');
  if (wrap) wrap.innerHTML = '';
  _psMilestonesUserEdited = false;
  if (!deal) {
    _psRefreshMilestoneToolbar();
    return;
  }
  var ms = PS_MILESTONES.filter(function(r){ return r.deal_id === deal.id; })
                        .sort(function(a,b){ return (a.sequence_order||0) - (b.sequence_order||0); });
  ms.forEach(function(r){
    _psAppendMilestoneRow({
      id: r.id,
      title: r.title,
      amount: r.amount_usd,
      payment: r.payment_received_usd,
      status: r.status,
      expected: r.expected_completion_date,
      actual: r.actual_completion_date,
      notes: r.notes
    });
  });
  // Existing rows count as "user edited" content — don't silently
  // overwrite them on the first "+ Add milestone" click.
  if (ms.length) _psMilestonesUserEdited = true;
  _psRefreshMilestoneToolbar();
  _psRecalcMilestoneTotal();
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

// ── MODAL: MILESTONE ROWS ─────────────────────────────────────────
// Each row is a single self-contained block. data-row-id is a synthetic
// monotonic id for DOM lookups; data-db-id (when set) carries the
// persisted ps_milestones.id so save can UPDATE vs INSERT.

function _psFinalValue() {
  var raw = (document.getElementById('ps-final-usd')||{}).value;
  if (raw === '' || raw == null || isNaN(raw)) return null;
  return Number(raw);
}

function _psBuildMilestoneRow(seed) {
  var seq = ++_psSubrowSeq;
  seed = seed || {};
  var rowId = 'ps-ms-row-' + seq;
  var amtId = 'ps-ms-amt-' + seq;
  var payId = 'ps-ms-pay-' + seq;
  var aedAmtId = 'ps-ms-aed-amt-' + seq;
  var aedPayId = 'ps-ms-aed-pay-' + seq;
  var pctId = 'ps-ms-pct-' + seq;
  var statusId = 'ps-ms-st-' + seq;
  var statusOpts = PS_MS_STATUSES.map(function(s){
    var meta = PS_MS_STATUS_META[s];
    var sel = (seed.status === s) ? ' selected' : '';
    return '<option value="'+s+'"'+sel+'>'+meta.label+'</option>';
  }).join('');
  // Empty status default = 'not_started' if seed has nothing.
  if (!seed.status) statusOpts = statusOpts.replace('value="not_started"', 'value="not_started" selected');

  var dbAttr = seed.id ? ' data-db-id="'+seed.id+'"' : '';
  var amtVal = (seed.amount  != null && seed.amount  !== '') ? String(seed.amount)  : '';
  var payVal = (seed.payment != null && seed.payment !== '') ? String(seed.payment) : '';

  return '<div class="ps-mile-row" id="'+rowId+'"'+dbAttr+'>'+
    '<div class="ps-mile-cell ps-mile-num"></div>'+
    '<div class="ps-mile-cell ps-mile-cell-title"><input type="text" class="ps-mile-title" placeholder="e.g. Kick-off &amp; design" value="'+esc2(seed.title||'')+'"></div>'+
    '<div class="ps-mile-cell ps-mile-cell-amount">'+
      '<input type="number" class="ps-mile-amount" id="'+amtId+'" min="0" step="0.01" placeholder="0.00" value="'+amtVal+'" oninput="_psOnMilestoneAmountInput(\''+rowId+'\',\''+amtId+'\',\''+aedAmtId+'\',\''+pctId+'\')">'+
      '<div class="ps-mile-aed" id="'+aedAmtId+'">≈ —</div>'+
      '<div class="ps-mile-pct" id="'+pctId+'">—</div>'+
    '</div>'+
    '<div class="ps-mile-cell ps-mile-cell-pay">'+
      '<input type="number" class="ps-mile-pay" id="'+payId+'" min="0" step="0.01" placeholder="0.00" value="'+payVal+'" oninput="_psUpdateAed(\''+payId+'\',\''+aedPayId+'\');_psRecalcMilestoneTotal();_psRefreshRowFlags(\''+rowId+'\')">'+
      '<div class="ps-mile-aed" id="'+aedPayId+'">≈ —</div>'+
    '</div>'+
    '<div class="ps-mile-cell ps-mile-cell-status">'+
      '<select class="ps-mile-status" id="'+statusId+'" onchange="_psOnMilestoneStatusChange(\''+rowId+'\')">'+statusOpts+'</select>'+
    '</div>'+
    '<div class="ps-mile-cell ps-mile-cell-date"><input type="date" class="ps-mile-expected" value="'+esc2(seed.expected||'')+'"></div>'+
    '<div class="ps-mile-cell ps-mile-cell-date"><input type="date" class="ps-mile-actual" value="'+esc2(seed.actual||'')+'"></div>'+
    '<div class="ps-mile-cell ps-mile-cell-notes"><input type="text" class="ps-mile-notes" placeholder="Notes" value="'+esc2(seed.notes||'')+'"></div>'+
    '<div class="ps-mile-cell ps-mile-cell-remove"><button type="button" class="btn btn-sm btn-ghost btn-icon-only" onclick="_psRemoveMilestoneRow(\''+rowId+'\')" title="Remove"><i data-lucide="x"></i></button></div>'+
  '</div>';
}

// Append a milestone row from a seed object. Used by _psRebuildSubrows
// (replay from DB) and the auto-split + add flow.
function _psAppendMilestoneRow(seed) {
  var wrap = document.getElementById('ps-milestones-wrap');
  if (!wrap) return null;
  wrap.insertAdjacentHTML('beforeend', _psBuildMilestoneRow(seed));
  var row = wrap.lastElementChild;
  // Seed live AED display + % cell from the inserted values.
  var amt = row.querySelector('.ps-mile-amount');
  var aedAmt = row.querySelector('.ps-mile-aed');
  if (amt && aedAmt && amt.value !== '' && !isNaN(amt.value)) {
    aedAmt.textContent = '≈ ' + fmtAed(usdToAed(amt.value), true);
  }
  var pay = row.querySelector('.ps-mile-pay');
  var aedPay = row.querySelector('.ps-mile-cell-pay .ps-mile-aed');
  if (pay && aedPay && pay.value !== '' && !isNaN(pay.value)) {
    aedPay.textContent = '≈ ' + fmtAed(usdToAed(pay.value), true);
  }
  if (typeof renderIcons === 'function') renderIcons();
  return row;
}

// "+ Add milestone" handler. If the user hasn't manually edited any
// amount yet, spread Final Value evenly across all rows including the
// new one. Otherwise add a blank row and let the user type a number.
function _psAddMilestoneRow() {
  var V = _psFinalValue();
  if (V == null || V <= 0) {
    showError('Enter Final PS Value before adding milestones.');
    return;
  }
  var wrap = document.getElementById('ps-milestones-wrap');
  if (!wrap) return;
  if (!_psMilestonesUserEdited) {
    // Auto-split: redistribute evenly across existing + 1 new row.
    var existing = wrap.querySelectorAll('.ps-mile-row');
    var newN = existing.length + 1;
    var per = Math.round((V / newN) * 100) / 100;
    // Update existing rows
    existing.forEach(function(row){
      var amtEl = row.querySelector('.ps-mile-amount');
      var aedEl = row.querySelector('.ps-mile-aed');
      var pctEl = row.querySelector('.ps-mile-pct');
      if (amtEl) amtEl.value = per;
      if (aedEl) aedEl.textContent = '≈ ' + fmtAed(usdToAed(per), true);
      if (pctEl) pctEl.textContent = _psPct(per, V);
    });
    _psAppendMilestoneRow({ amount: per });
    // Apply rounding remainder to the last row so the total matches exactly.
    _psApplyRoundingRemainder(V);
  } else {
    _psAppendMilestoneRow({});
  }
  _psRefreshMilestoneToolbar();
  _psRecalcMilestoneTotal();
}

// Re-balance button → reset auto-split flag + evenly distribute Final
// Value across the current set of rows, with any rounding delta on the
// last row so the totals tie exactly.
function _psRebalanceMilestones() {
  var V = _psFinalValue();
  if (V == null || V <= 0) {
    showError('Enter Final PS Value before re-balancing.');
    return;
  }
  var wrap = document.getElementById('ps-milestones-wrap');
  if (!wrap) return;
  var rows = wrap.querySelectorAll('.ps-mile-row');
  if (!rows.length) return;
  var per = Math.round((V / rows.length) * 100) / 100;
  rows.forEach(function(row){
    var amtEl = row.querySelector('.ps-mile-amount');
    var aedEl = row.querySelector('.ps-mile-aed');
    var pctEl = row.querySelector('.ps-mile-pct');
    if (amtEl) amtEl.value = per;
    if (aedEl) aedEl.textContent = '≈ ' + fmtAed(usdToAed(per), true);
    if (pctEl) pctEl.textContent = _psPct(per, V);
  });
  _psApplyRoundingRemainder(V);
  _psMilestonesUserEdited = false;
  _psRecalcMilestoneTotal();
}

// Float math leaves pennies on the table; dump the delta on the last
// row so 5 × $1,666.66 + remainder = $10,000 exactly.
function _psApplyRoundingRemainder(target) {
  var wrap = document.getElementById('ps-milestones-wrap');
  if (!wrap) return;
  var rows = wrap.querySelectorAll('.ps-mile-row');
  if (!rows.length) return;
  var sum = 0;
  rows.forEach(function(row){
    var v = row.querySelector('.ps-mile-amount').value;
    sum += (v === '' || isNaN(v)) ? 0 : Number(v);
  });
  sum = Math.round(sum * 100) / 100;
  var delta = Math.round((target - sum) * 100) / 100;
  if (Math.abs(delta) < 0.01) return;
  var last = rows[rows.length - 1];
  var amtEl = last.querySelector('.ps-mile-amount');
  var aedEl = last.querySelector('.ps-mile-aed');
  var pctEl = last.querySelector('.ps-mile-pct');
  var fixed = (Math.round(((Number(amtEl.value)||0) + delta) * 100) / 100);
  amtEl.value = fixed;
  if (aedEl) aedEl.textContent = '≈ ' + fmtAed(usdToAed(fixed), true);
  if (pctEl) pctEl.textContent = _psPct(fixed, target);
}

function _psRemoveMilestoneRow(rowId) {
  var el = document.getElementById(rowId);
  if (!el) return;
  var pay = Number((el.querySelector('.ps-mile-pay')||{}).value || 0);
  // Soft confirm when removing a row that has recorded payment — the
  // payment number disappears with the row; user should know.
  if (pay > 0) {
    confirmAction({
      title: 'Remove this milestone?',
      body:  'This milestone has '+fmtUsd(pay, false)+' recorded as payment received. Removing it will drop that record on save.\n\nContinue?',
      confirmText: 'Remove milestone'
    }).then(function(ok){
      if (!ok) return;
      el.parentNode.removeChild(el);
      _psRenumberMilestones();
      _psRefreshMilestoneToolbar();
      _psRecalcMilestoneTotal();
    });
    return;
  }
  el.parentNode.removeChild(el);
  _psRenumberMilestones();
  _psRefreshMilestoneToolbar();
  _psRecalcMilestoneTotal();
}

// Update the leading "1." / "2." numbers so removal renumbers cleanly.
function _psRenumberMilestones() {
  var wrap = document.getElementById('ps-milestones-wrap');
  if (!wrap) return;
  var rows = wrap.querySelectorAll('.ps-mile-row');
  rows.forEach(function(row, i){
    var n = row.querySelector('.ps-mile-num');
    if (n) n.textContent = (i+1) + '.';
  });
}

// Refresh the toolbar — enable/disable Add + Re-balance based on
// Final Value presence and row count.
function _psRefreshMilestoneToolbar() {
  var V = _psFinalValue();
  var has = V != null && V > 0;
  var addBtn = document.getElementById('ps-add-milestone-btn');
  var rebBtn = document.getElementById('ps-rebalance-btn');
  var wrap   = document.getElementById('ps-milestones-wrap');
  var rowN   = wrap ? wrap.querySelectorAll('.ps-mile-row').length : 0;
  if (addBtn) {
    addBtn.disabled = !has;
    addBtn.title = has ? 'Add a milestone' : 'Enter Final PS Value first';
  }
  if (rebBtn) {
    rebBtn.disabled = !has || rowN === 0;
    rebBtn.title = !has ? 'Enter Final PS Value first' : (rowN === 0 ? 'Add milestones first' : 'Split Final PS Value evenly across all milestones');
  }
  _psRenumberMilestones();
}

// Recompute the running total. Sum every row's amount; compare to
// Final Value. Updates the indicator text + colour class.
function _psRecalcMilestoneTotal() {
  var V = _psFinalValue();
  var wrap = document.getElementById('ps-milestones-wrap');
  var ind = document.getElementById('ps-mile-total');
  if (!ind) return;
  var rows = wrap ? wrap.querySelectorAll('.ps-mile-row') : [];
  if (!rows.length) {
    ind.textContent = 'No milestones yet';
    ind.className = 'ps-mile-total';
    return;
  }
  var sum = 0;
  rows.forEach(function(row){
    var v = row.querySelector('.ps-mile-amount').value;
    if (v !== '' && !isNaN(v)) sum += Number(v);
    // Also refresh the % cell here so it follows Final-Value changes.
    var pctEl = row.querySelector('.ps-mile-pct');
    if (pctEl) pctEl.textContent = (V != null && V > 0) ? _psPct(v, V) : '—';
  });
  sum = Math.round(sum * 100) / 100;
  if (V == null) {
    ind.textContent = 'Milestones total: ' + fmtUsd(sum, false) + ' · Final Value not set';
    ind.className = 'ps-mile-total ps-mile-total-warn';
    return;
  }
  var delta = Math.round((sum - V) * 100) / 100;
  var label = 'Milestones total: ' + fmtUsd(sum, false) + ' of ' + fmtUsd(V, false);
  if (Math.abs(delta) < 0.01) {
    ind.textContent = label;
    ind.className = 'ps-mile-total ps-mile-total-ok';
  } else if (delta < 0) {
    ind.textContent = label + ' · ' + fmtUsd(-delta, false) + ' unallocated';
    ind.className = 'ps-mile-total ps-mile-total-warn';
  } else {
    ind.textContent = label + ' · ' + fmtUsd(delta, false) + ' over';
    ind.className = 'ps-mile-total ps-mile-total-warn';
  }
}

function _psPct(amt, total) {
  if (total == null || total <= 0 || amt === '' || amt == null || isNaN(amt)) return '—';
  var pct = (Number(amt) / Number(total)) * 100;
  return (Math.round(pct * 10) / 10).toFixed(1) + '%';
}

// Per-row payment-vs-amount overcharge flag (amber row outline).
function _psRefreshRowFlags(rowId) {
  var row = document.getElementById(rowId);
  if (!row) return;
  var amt = Number((row.querySelector('.ps-mile-amount')||{}).value || 0);
  var pay = Number((row.querySelector('.ps-mile-pay')||{}).value || 0);
  row.classList.toggle('ps-mile-row-overpaid', pay > amt && amt > 0);
}

// Amount input handler — flips auto-split off, refreshes AED + %.
function _psOnMilestoneAmountInput(rowId, amtId, aedId, pctId) {
  _psMilestonesUserEdited = true;
  _psUpdateAed(amtId, aedId);
  var V = _psFinalValue();
  var pctEl = document.getElementById(pctId);
  var amtEl = document.getElementById(amtId);
  if (pctEl && amtEl) pctEl.textContent = (V != null && V > 0) ? _psPct(amtEl.value, V) : '—';
  _psRecalcMilestoneTotal();
  _psRefreshRowFlags(rowId);
}

// Status change handler — auto-fill actual_completion_date when
// transitioning to "completed" and the field is empty. Doesn't
// overwrite a value the user already set.
function _psOnMilestoneStatusChange(rowId) {
  var row = document.getElementById(rowId);
  if (!row) return;
  var statusEl = row.querySelector('.ps-mile-status');
  if (!statusEl) return;
  if (statusEl.value === 'completed') {
    var actEl = row.querySelector('.ps-mile-actual');
    if (actEl && !actEl.value) {
      actEl.value = new Date().toISOString().slice(0,10);
    }
  }
}

// Final PS Value change → refresh toolbar (enables Add), refresh %
// columns, refresh total indicator. Does NOT auto-rebalance.
function _psOnFinalValueChange() {
  _psRefreshMilestoneToolbar();
  _psRecalcMilestoneTotal();
}

// Collect every milestone row in the form into a payload the save flow
// can act on. Preserves DB id when present so save can do diff-update.
function _psCollectMilestoneRows() {
  var wrap = document.getElementById('ps-milestones-wrap');
  if (!wrap) return [];
  var rows = wrap.querySelectorAll('.ps-mile-row');
  var out = [];
  rows.forEach(function(row, i){
    var title = (row.querySelector('.ps-mile-title').value||'').trim();
    var amt   = row.querySelector('.ps-mile-amount').value;
    var pay   = row.querySelector('.ps-mile-pay').value;
    var st    = row.querySelector('.ps-mile-status').value || 'not_started';
    var exp   = row.querySelector('.ps-mile-expected').value || null;
    var act   = row.querySelector('.ps-mile-actual').value || null;
    var notes = (row.querySelector('.ps-mile-notes').value||'').trim();
    var dbId  = row.dataset.dbId ? parseInt(row.dataset.dbId, 10) : null;
    out.push({
      dbId:                 dbId,
      sequence_order:       i + 1,
      title:                title,
      amount_usd:           (amt === '' || isNaN(amt)) ? null : Number(amt),
      payment_received_usd: (pay === '' || isNaN(pay)) ? 0    : Number(pay),
      status:               st,
      expected_completion_date: exp,
      actual_completion_date:   act,
      notes:                notes || null
    });
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

  var milestones = _psCollectMilestoneRows();
  // Hard validation per spec Part 5
  for (var i = 0; i < milestones.length; i++) {
    var m = milestones[i];
    if (!m.title) {
      _psShowModalError('Milestone #'+(i+1)+' is missing a title.');
      return;
    }
    if (m.amount_usd !== null && m.amount_usd < 0) {
      _psShowModalError('Milestone #'+(i+1)+' has a negative amount.');
      return;
    }
    if (m.payment_received_usd < 0) {
      _psShowModalError('Milestone #'+(i+1)+' has a negative payment amount.');
      return;
    }
  }

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

  // Id-preserving diff-update for milestones:
  //   - Rows with dbId → UPDATE that row in place (keeps timestamps + id).
  //   - Rows without dbId → INSERT new.
  //   - DB rows linked to this deal NOT in the form → DELETE (user
  //     removed them). Compare by id; we already loaded the existing
  //     set in PS_MILESTONES.
  var existingIds = (PS_MILESTONES||[])
    .filter(function(m){ return m.deal_id === dealId; })
    .map(function(m){ return m.id; });
  var keepIds = milestones.filter(function(m){ return m.dbId; }).map(function(m){ return m.dbId; });
  var toDelete = existingIds.filter(function(id){ return keepIds.indexOf(id) === -1; });

  // Updates first (so a unique-style constraint on sequence_order in
  // the future wouldn't trip on overlapping numbers). Then deletes.
  // Then inserts. Each step short-circuits on error.
  for (var ui = 0; ui < milestones.length; ui++) {
    var mi = milestones[ui];
    if (!mi.dbId) continue;
    var patch = {
      sequence_order:           mi.sequence_order,
      title:                    mi.title,
      amount_usd:               mi.amount_usd,
      payment_received_usd:     mi.payment_received_usd,
      status:                   mi.status,
      expected_completion_date: mi.expected_completion_date,
      actual_completion_date:   mi.actual_completion_date,
      notes:                    mi.notes,
      updated_at:               new Date().toISOString()
    };
    var u = await sb.from('ps_milestones').update(patch).eq('id', mi.dbId);
    if (u.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Milestone update failed: '+u.error.message); return; }
  }
  if (toDelete.length) {
    var d = await sb.from('ps_milestones').delete().in('id', toDelete);
    if (d.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Milestone cleanup failed: '+d.error.message); return; }
  }
  var inserts = milestones.filter(function(m){ return !m.dbId; }).map(function(m){
    return {
      deal_id:                  dealId,
      sequence_order:           m.sequence_order,
      title:                    m.title,
      amount_usd:               m.amount_usd,
      payment_received_usd:     m.payment_received_usd,
      status:                   m.status,
      expected_completion_date: m.expected_completion_date,
      actual_completion_date:   m.actual_completion_date,
      notes:                    m.notes
    };
  });
  if (inserts.length) {
    var ins2 = await sb.from('ps_milestones').insert(inserts);
    if (ins2.error) { _psResetSaveBtn(btn, orig); _psShowModalError('Milestone insert failed: '+ins2.error.message); return; }
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

// ── DELETE ────────────────────────────────────────────────────────
async function deletePsDealFromModal() {
  if (!_psEditingId) return;
  var d = (PS_DEALS||[]).find(function(x){ return x.id === _psEditingId; });
  if (!d) return;
  if (!await confirmAction({
    title: 'Delete deal "'+(d.client_name||'')+'"?',
    body: 'This removes the deal and all linked milestones.\n\nThis cannot be undone.',
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
    var p = _psDealProgress(d.id);
    var msSuffix = p.total
      ? '<span class="ps-linked-progress dim">'+p.done+' / '+p.total+' milestones done</span>'
      : '';
    return '<div class="ps-linked-row" onclick="event.stopPropagation();openPsDealModal('+d.id+')">'+
      '<span class="ps-linked-client">'+esc2(d.client_name||'—')+'</span>'+
      '<span class="ps-linked-val num">'+fmtUsd(d.final_ps_value_usd, false)+'</span>'+
      _psStatusBadge(d.status)+
      msSuffix+
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
    'Status','Milestones Done','Total Milestones','Paid USD','Milestones',
    'Linked Engagement','Consulted','Remarks'
  ];
  function esc(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/"/g, '""');
    return '"' + s + '"';
  }
  // Per-deal milestone breakdown, formatted as
  //   "Phase 1: $2K Completed | Phase 2: $2K Active | ..."
  // pipe-separated so it survives the comma-split inside one CSV cell.
  function milestoneSummary(dealId) {
    var arr = (PS_MILESTONES||[])
      .filter(function(r){ return r.deal_id === dealId; })
      .sort(function(a,b){ return (a.sequence_order||0) - (b.sequence_order||0); });
    return arr.map(function(m){
      var meta = PS_MS_STATUS_META[m.status] || { label: m.status || '' };
      return (m.title||'') + ': ' + fmtUsd(m.amount_usd, false) + ' ' + meta.label;
    }).join(' | ');
  }
  var lines = [ header.map(esc).join(',') ];
  rows.forEach(function(d, i){
    var eng = (ENGAGEMENTS||[]).find(function(e){ return e.id === d.linked_engagement_id; });
    var p = _psDealProgress(d.id);
    lines.push([
      i+1, d.client_name, d.partner, d.region, d.mode, d.supplier,
      d.quoted_year, d.quoted_month, d.awarded_year, d.man_days,
      d.ps_quoted_tech_usd, d.ps_quoted_sales_usd, d.final_ps_value_usd,
      d.status,
      p.done, p.total, p.paid,
      milestoneSummary(d.id),
      eng ? eng.name : '',
      d.consulted_with_tech, d.remarks
    ].map(esc).join(','));
  });
  if (rows.length === 0) lines.push(esc('No data') + ',,,,,,,,,,,,,,,,,,,,'); // header + 1 row so the file isn't empty
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
