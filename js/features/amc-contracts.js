// == AMC CONTRACTS =================================================
// Commercial-side companion to the AMC engagement type. Each contract
// represents a signed commercial deal (SO number, value, dates) that
// covers one or more AMC engagements (the work-tracking side).
//
// Phase 1 (this file): manual entry, listing, filters, detail view.
// Phase 2 (later): renewal alerts, revenue dashboards, hours-vs-value
// margin reports.

// In-memory caches refreshed by loadAMCContracts. Index lookups are
// cheap on the small expected dataset (dozens of contracts).
var AMC_CONTRACTS    = [];               // [{id, customer_id, ...}]
var AMC_CONTRACT_LINKS = [];             // [{contract_id, engagement_id}]
var _amcLastLoaded   = 0;
var _amcStatusFilter = 'all';            // 'all' | 'active' | 'expiring' | 'expired' | 'archived'
var _amcEditingId    = null;             // null = add, number = edit

// Region dropdown is hardcoded — small fixed list, not worth a table.
var AMC_REGIONS = ['UAE', 'KSA', 'Qatar', 'Oman', 'Bahrain', 'Kuwait', 'Kenya', 'Other'];

// Derive status from end_date relative to today. Days-to-end is
// surfaced separately so the badge can read "Expires in 62 days".
function _amcStatusFor(contract) {
  if (!contract || !contract.amc_end_date) return { key:'unknown', label:'—', days:null };
  var today = new Date(); today.setHours(0,0,0,0);
  var end   = new Date(contract.amc_end_date + 'T00:00:00');
  var days  = Math.round((end - today) / 86400000);
  if (days < 0)  return { key:'expired',  label:'Expired',         days:days };
  if (days <= 90) return { key:'expiring', label:'Expiring Soon',  days:days };
  return            { key:'active',   label:'Active',          days:days };
}

// USD formatter — "1,234,567" for table cells, no decimals for clarity
// at scale. Detail view shows the cents.
function _amcFmtUSD(n, withCents) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  var v = Number(n);
  var opts = withCents
    ? { minimumFractionDigits:2, maximumFractionDigits:2 }
    : { minimumFractionDigits:0, maximumFractionDigits:0 };
  return '$' + v.toLocaleString('en-US', opts);
}

async function loadAMCContracts() {
  // Pull contracts + link rows in parallel. The 1000-row Supabase cap
  // is irrelevant here (dozens of contracts expected), so a flat select
  // is fine — no fetchAllRows pagination wrapper needed.
  var [cRes, lRes] = await Promise.all([
    sb.from('amc_contracts').select('*').order('amc_end_date', { ascending:true }),
    sb.from('amc_contract_engagements').select('contract_id,engagement_id,linked_at')
  ]);
  if (cRes.error) { showError('Could not load contracts: ' + cRes.error.message); return; }
  if (lRes.error) { showError('Could not load contract links: ' + lRes.error.message); return; }
  AMC_CONTRACTS      = cRes.data || [];
  AMC_CONTRACT_LINKS = lRes.data || [];
  _amcLastLoaded = Date.now();
  renderAMCContracts();
}

// Apply current status-chip + filter-bar selections to the contracts
// list. Returns the filtered+sorted array.
function _amcFilteredContracts() {
  var search = (((document.getElementById('amc-search')||{}).value)||'').toLowerCase().trim();
  var regions = (typeof msGetValues === 'function') ? msGetValues('amc-filter-region') : [];
  var vendors = (typeof msGetValues === 'function') ? msGetValues('amc-filter-vendor') : [];
  var year    = ((document.getElementById('amc-filter-year')||{}).value)||'';

  // Archived view is its own filter — show archived rows, all other
  // filters still apply within that set. Every other chip hides archived
  // by default (the Archived chip is the only path to them).
  var rows;
  if (_amcStatusFilter === 'archived') {
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !!c.is_archived; });
  } else {
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !c.is_archived; });
    if (_amcStatusFilter !== 'all') {
      rows = rows.filter(function(c){ return _amcStatusFor(c).key === _amcStatusFilter; });
    }
  }
  if (search) {
    rows = rows.filter(function(c){
      return [c.customer_name, c.git_sales_order, c.partner]
        .some(function(f){ return f && f.toLowerCase().indexOf(search) !== -1; });
    });
  }
  if (regions.length) rows = rows.filter(function(c){ return c.region && regions.indexOf(c.region) !== -1; });
  if (vendors.length) rows = rows.filter(function(c){ return c.vendor && vendors.indexOf(c.vendor) !== -1; });
  if (year)           rows = rows.filter(function(c){ return String(c.booking_year) === String(year); });
  return rows;
}

function _amcCountByStatus() {
  // Counts feed the chip badges. "All" + lifecycle counts (active /
  // expiring / expired) include only non-archived rows so the active
  // workflow numbers are honest. "archived" is the separate counter
  // that drives the visibility of the Archived chip.
  var c = { all:0, active:0, expiring:0, expired:0, archived:0 };
  (AMC_CONTRACTS||[]).forEach(function(row){
    if (row.is_archived) { c.archived += 1; return; }
    c.all += 1;
    var k = _amcStatusFor(row).key;
    if (c[k] !== undefined) c[k] += 1;
  });
  return c;
}

function setAMCStatusFilter(key) {
  _amcStatusFilter = key;
  renderAMCContracts();
}

function clearAMCFilters() {
  ['amc-search','amc-filter-year'].forEach(function(id){ var el=document.getElementById(id); if (el) el.value=''; });
  if (typeof msSetValues === 'function') {
    msSetValues('amc-filter-region', []);
    msSetValues('amc-filter-vendor', []);
  }
  _amcStatusFilter = 'all';
  renderAMCContracts();
}

function renderAMCContracts() {
  var loadEl = document.getElementById('amc-load');
  if (loadEl) loadEl.style.display = 'none';
  var content = document.getElementById('amc-content');
  if (!content) return;
  // Lazy multi-select + year-filter wiring on first render
  _amcPopulateFilters();

  var rows = _amcFilteredContracts();
  var counts = _amcCountByStatus();
  _amcRenderTotalCard(rows);

  // Status chip row (lives above the filter bar)
  var chip = function(key, label, count) {
    var active = (_amcStatusFilter === key);
    return '<button class="amc-chip'+(active?' amc-chip-active':'')+' amc-chip-'+key+'" onclick="setAMCStatusFilter(\''+key+'\')">'+
      label+' <span class="amc-chip-count">'+fmtCount(count)+'</span>'+
    '</button>';
  };
  var chipBar =
    '<div class="amc-chip-row">'+
      chip('all',      'All',            counts.all)+
      chip('active',   '🟢 Active',      counts.active)+
      chip('expiring', '🟡 Expiring Soon', counts.expiring)+
      chip('expired',  '🔴 Expired',     counts.expired)+
      // Archived chip only renders if there's at least one archived row
      // — keeps the toolbar clean for fresh installs and after a full
      // restore. Neutral grey to signal "historical, not workflow".
      (counts.archived ? chip('archived', '📦 Archived', counts.archived) : '')+
    '</div>';

  if (!rows.length) {
    content.innerHTML = chipBar + renderEmptyState({
      icon: (counts.all === 0) ? 'file-plus-2' : 'search-x',
      heading: (counts.all === 0) ? 'No AMC contracts yet' : 'No contracts match the current filters',
      sub: (counts.all === 0)
        ? 'Manager-only: click + New Contract to register the first one.'
        : 'Try adjusting the filters or clearing them.',
      btnText: (counts.all === 0 && isManager) ? '+ New Contract' : (counts.all > 0 ? 'Clear filters' : ''),
      btnOnclick: (counts.all === 0 && isManager) ? 'openAMCContractModal()' : (counts.all > 0 ? 'clearAMCFilters()' : '')
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Engagement count per contract via the link table
  var linksByContract = {};
  (AMC_CONTRACT_LINKS||[]).forEach(function(l){
    linksByContract[l.contract_id] = (linksByContract[l.contract_id]||0) + 1;
  });

  var isMobile = window.innerWidth < 768;
  var listHtml = isMobile ? _amcRenderCards(rows, linksByContract) : _amcRenderTable(rows, linksByContract);
  content.innerHTML = chipBar + listHtml +
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+counts.all+' contracts · Sorted by end date</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

// Total AMC Value card — sits above the chip row, recalculates from
// whatever rows the current filter combination produces. NULL/missing
// amc_value_usd values are excluded from the sum but counted; if any
// are excluded a small footnote calls that out.
function _amcRenderTotalCard(rows) {
  var card = document.getElementById('amc-total-card');
  if (!card) return;
  var n = rows ? rows.length : 0;
  var sum = 0;
  var missing = 0;
  (rows||[]).forEach(function(r){
    var v = r.amc_value_usd;
    if (v === null || v === undefined || v === '' || isNaN(v)) missing++;
    else sum += Number(v);
  });
  var foot = missing > 0
    ? '<div class="amc-total-foot">Note: '+missing+' contract'+(missing===1?'':'s')+' excluded from total due to missing value.</div>'
    : '';
  var aed = (typeof usdToAed === 'function') ? usdToAed(sum) : null;
  var aedLine = aed != null
    ? '<div class="amc-total-aed">≈ ' + (typeof fmtAed === 'function' ? fmtAed(aed, true) : 'AED ' + aed.toFixed(2)) + '</div>'
    : '';
  card.innerHTML =
    '<div class="amc-total-label">Total AMC Value</div>'+
    '<div class="amc-total-value">'+_amcFmtUSD(sum, true)+'</div>'+
    aedLine+
    '<div class="amc-total-sub">Across '+n+' contract'+(n===1?'':'s')+'</div>'+
    foot;
  card.style.display = '';
}

function _amcBadge(status) {
  var cls = 'amc-badge amc-badge-'+status.key;
  var label = status.label;
  if (status.key === 'expiring' && status.days != null) {
    label += ' · ' + status.days + 'd';
  } else if (status.key === 'expired' && status.days != null) {
    label += ' · ' + Math.abs(status.days) + 'd ago';
  }
  return '<span class="'+cls+'">'+esc2(label)+'</span>';
}

function _amcRenderTable(rows, linksByContract) {
  var manager = !!isManager;
  var archivedView = (_amcStatusFilter === 'archived');
  var body = rows.map(function(c, i){
    var st  = _amcStatusFor(c);
    var n   = linksByContract[c.id] || 0;
    var safeName = (c.customer_name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var actions = manager
      ? (archivedView
          ? '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="event.stopPropagation();restoreAMCContract('+c.id+')" title="Restore"><i data-lucide="rotate-ccw"></i></button>'+
            '<button class="btn btn-sm btn-danger btn-icon-only" onclick="event.stopPropagation();permanentlyDeleteAMCContract('+c.id+",'"+safeName+"'"+')" title="Permanently Delete (cannot be undone)"><i data-lucide="trash-2"></i></button>'
          : '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="event.stopPropagation();openAMCContractModal('+c.id+')" title="Edit"><i data-lucide="pencil"></i></button>'+
            '<button class="btn btn-sm btn-danger btn-icon-only" onclick="event.stopPropagation();archiveAMCContract('+c.id+",'"+safeName+"'"+')" title="Archive"><i data-lucide="trash-2"></i></button>')
      : '';
    return '<tr class="amc-row" onclick="openAMCContractDetail('+c.id+')">'+
      '<td style="color:var(--muted);font-size:12px">'+(i+1)+'</td>'+
      '<td><strong style="color:var(--navy)">'+esc2(c.customer_name||'—')+'</strong></td>'+
      '<td class="hide-mobile" style="font-size:12px">'+esc2(c.partner||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:12px">'+esc2(c.region||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:12px">'+esc2(c.vendor||'—')+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+esc2(c.git_sales_order||'—')+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:13px">'+_amcFmtUSD(c.amc_value_usd, false)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+(c.amc_start_date?fmtDate(c.amc_start_date):'—')+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+(c.amc_end_date?fmtDate(c.amc_end_date):'—')+'</td>'+
      '<td>'+_amcBadge(st)+'</td>'+
      '<td class="hide-mobile" style="font-family:DM Mono,monospace;font-size:12px">'+(c.booking_year||'—')+'</td>'+
      '<td class="hide-mobile" style="font-family:DM Mono,monospace;font-size:12px;color:var(--muted)">'+fmtCount(n)+'</td>'+
      (manager?'<td style="white-space:nowrap;text-align:right">'+actions+'</td>':'')+
    '</tr>';
  }).join('');
  return '<div class="card" style="padding:0">'+
    '<div class="table-wrap"><table class="amc-table">'+
      '<thead><tr>'+
        '<th>#</th><th>Client</th>'+
        '<th class="hide-mobile">Partner</th>'+
        '<th class="hide-mobile">Region</th>'+
        '<th class="hide-mobile">Vendor</th>'+
        '<th>GIT SO</th>'+
        '<th>AMC (USD)</th>'+
        '<th>Start</th><th>End</th>'+
        '<th>Status</th>'+
        '<th class="hide-mobile">Year</th>'+
        '<th class="hide-mobile">Engagements</th>'+
        (manager?'<th></th>':'')+
      '</tr></thead>'+
      '<tbody>'+body+'</tbody></table></div>'+
  '</div>';
}

function _amcRenderCards(rows, linksByContract) {
  var manager = !!isManager;
  var archivedView = (_amcStatusFilter === 'archived');
  return '<div class="amc-cards">' + rows.map(function(c){
    var st = _amcStatusFor(c);
    var n  = linksByContract[c.id] || 0;
    var safeName = (c.customer_name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<div class="amc-card" onclick="openAMCContractDetail('+c.id+')">'+
      '<div class="amc-card-head">'+
        '<div class="amc-card-customer">'+esc2(c.customer_name||'—')+'</div>'+
        _amcBadge(st)+
      '</div>'+
      '<div class="amc-card-meta">'+esc2(c.partner||'—')+' · '+esc2(c.region||'—')+' · '+esc2(c.vendor||'—')+'</div>'+
      '<div class="amc-card-row">'+
        '<span class="num">'+_amcFmtUSD(c.amc_value_usd, false)+'</span>'+
        '<span class="amc-card-sep">·</span>'+
        '<span class="num">'+(c.amc_start_date?fmtDate(c.amc_start_date):'—')+' → '+(c.amc_end_date?fmtDate(c.amc_end_date):'—')+'</span>'+
      '</div>'+
      '<div class="amc-card-row dim">'+
        '<span>SO: '+esc2(c.git_sales_order||'—')+'</span>'+
        '<span>'+fmtCount(n)+' engagement'+(n===1?'':'s')+'</span>'+
      '</div>'+
      (manager
        ? '<div class="amc-card-actions" onclick="event.stopPropagation()">'+
            (archivedView
              ? '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="restoreAMCContract('+c.id+')" title="Restore"><i data-lucide="rotate-ccw"></i></button>'+
                '<button class="btn btn-sm btn-danger btn-icon-only" onclick="permanentlyDeleteAMCContract('+c.id+",'"+safeName+"'"+')" title="Permanently Delete (cannot be undone)"><i data-lucide="trash-2"></i></button>'
              : '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="openAMCContractModal('+c.id+')" title="Edit"><i data-lucide="pencil"></i></button>'+
                '<button class="btn btn-sm btn-danger btn-icon-only" onclick="archiveAMCContract('+c.id+",'"+safeName+"'"+')" title="Archive"><i data-lucide="trash-2"></i></button>')+
          '</div>'
        : '')+
    '</div>';
  }).join('') + '</div>';
}

// ── FILTERS ──────────────────────────────────────────────────────
function _amcPopulateFilters() {
  if (typeof msInit !== 'function') return;
  msInit('amc-filter-region',
    AMC_REGIONS.map(function(r){ return {value:r,label:r}; }),
    renderAMCContracts);
  // Vendor multi-select sources from the catalog (active vendors first +
  // any vendor that's actually referenced on a contract, including inactive).
  var seen = {}; var items = [];
  (VENDORS||[]).filter(function(v){ return v.is_active; }).forEach(function(v){
    seen[v.name] = 1; items.push({value:v.name, label:v.name});
  });
  (AMC_CONTRACTS||[]).forEach(function(c){
    if (c.vendor && !seen[c.vendor]) { seen[c.vendor] = 1; items.push({value:c.vendor, label:c.vendor+' (legacy)'}); }
  });
  msInit('amc-filter-vendor', items, renderAMCContracts);
  // Year filter — only show years that have at least one contract.
  var yearEl = document.getElementById('amc-filter-year');
  if (yearEl) {
    var prev = yearEl.value;
    var years = {};
    (AMC_CONTRACTS||[]).forEach(function(c){ if (c.booking_year) years[c.booking_year] = 1; });
    var sorted = Object.keys(years).sort(function(a,b){ return Number(b)-Number(a); });
    yearEl.innerHTML = '<option value="">All Years</option>' + sorted.map(function(y){ return '<option value="'+y+'">'+y+'</option>'; }).join('');
    if (prev) yearEl.value = prev;
  }
}

// ── ADD / EDIT MODAL ─────────────────────────────────────────────
function openAMCContractModal(id) {
  if (!isManager) { showError('Manager access only.'); return; }
  var modal = document.getElementById('amc-contract-modal');
  if (!modal) return;
  _amcEditingId = id || null;
  var c = id ? (AMC_CONTRACTS||[]).find(function(x){ return x.id === id; }) : null;
  document.getElementById('amc-modal-title').textContent = c ? 'Edit AMC Contract' : 'New AMC Contract';
  // Defense-in-depth: if the opener was reached on an archived row
  // (stale tab, direct URL, future deep-link), surface a banner and
  // make the form read-only. The Archived view's action column no
  // longer offers Edit, so this is the safety net.
  if (typeof setModalArchivedBanner === 'function') {
    var modalBox = modal.querySelector('.modal');
    setModalArchivedBanner(modalBox, c && c.is_archived ? 'AMC contract' : null);
  }

  // Customer (reuses CUSTOMERS — same select pattern as engagement modal)
  fillCustomerSelect('amc-cust', false);
  // Region dropdown
  var rSel = document.getElementById('amc-region');
  rSel.innerHTML = '<option value="">-- Select Region --</option>' +
    AMC_REGIONS.map(function(r){ return '<option value="'+r+'">'+r+'</option>'; }).join('');
  // Vendor dropdown (active vendors)
  var vSel = document.getElementById('amc-vendor');
  var activeVendors = (VENDORS||[]).filter(function(v){ return v.is_active; });
  vSel.innerHTML = '<option value="">-- Select Vendor --</option>' +
    activeVendors.map(function(v){ return '<option value="'+esc2(v.name)+'">'+esc2(v.name)+'</option>'; }).join('');

  // Seed fields from the existing contract (edit) or sensible defaults (add)
  var cur = new Date().getFullYear();
  document.getElementById('amc-cust').value      = c ? (c.customer_name||'') : '';
  document.getElementById('amc-partner').value   = c ? (c.partner||'') : '';
  document.getElementById('amc-region').value    = c ? (c.region||'') : '';
  document.getElementById('amc-vendor').value    = c ? (c.vendor||'') : '';
  // If c.vendor is an inactive/legacy value, surface it so the manager
  // can keep it on edit without re-typing.
  if (c && c.vendor && !activeVendors.some(function(v){ return v.name === c.vendor; })) {
    var opt = document.createElement('option');
    opt.value = c.vendor; opt.textContent = c.vendor + ' (legacy)'; opt.selected = true;
    vSel.appendChild(opt);
  }
  document.getElementById('amc-so').value        = c ? (c.git_sales_order||'') : '';
  document.getElementById('amc-value').value     = c ? (c.amc_value_usd!=null?c.amc_value_usd:'') : '';
  document.getElementById('amc-start').value     = c ? (c.amc_start_date||'') : '';
  document.getElementById('amc-end').value       = c ? (c.amc_end_date||'') : '';
  document.getElementById('amc-booking-yr').value = c ? (c.booking_year||cur) : cur;
  document.getElementById('amc-notes').value     = c ? (c.notes||'') : '';
  var errEl = document.getElementById('amc-modal-error');
  if (errEl) errEl.style.display = 'none';

  // Build linked-engagements checkbox list. Filtered to AMC engagements
  // first, then re-filtered on customer change by onAMCContractCustomerChange.
  _amcRenderLinkedEngagements(c);

  modal.classList.add('show');
  setTimeout(function(){ var f = document.getElementById('amc-cust'); if (f && f.focus) f.focus(); }, 80);
  if (typeof renderIcons === 'function') renderIcons();
}

function closeAMCContractModal() {
  var modal = document.getElementById('amc-contract-modal');
  if (modal) modal.classList.remove('show');
  _amcEditingId = null;
}

function onAMCContractCustomerChange() {
  // Rebuild the linked-engagements list to only show this customer's
  // AMC engagements (the typical case). User can untick the filter to
  // show all AMC engagements if they need to.
  var c = _amcEditingId ? (AMC_CONTRACTS||[]).find(function(x){ return x.id === _amcEditingId; }) : null;
  _amcRenderLinkedEngagements(c);
}

function _amcRenderLinkedEngagements(contract) {
  var wrap = document.getElementById('amc-linked-engagements');
  if (!wrap) return;
  var custName = document.getElementById('amc-cust').value;
  var custRow  = (CUSTOMERS||[]).find(function(c){ return c.name === custName; });
  var custId   = custRow ? custRow.id : null;
  // Pre-checked: any engagement already linked to THIS contract.
  var alreadyLinked = {};
  if (contract) {
    (AMC_CONTRACT_LINKS||[])
      .filter(function(l){ return l.contract_id === contract.id; })
      .forEach(function(l){ alreadyLinked[l.engagement_id] = 1; });
  }
  // Filter source list: AMC type + non-archived. If a customer is selected,
  // narrow to that customer's engagements; otherwise show all AMC engagements.
  var list = (ENGAGEMENTS||[])
    .filter(function(e){ return e.type === 'amc' && e.status !== 'archived' && !e.is_archived; })
    .filter(function(e){ return !custId || e.customer_id === custId; });
  // Always include any pre-linked engagements even if they don't match
  // the current filter (legacy or cross-customer links).
  Object.keys(alreadyLinked).forEach(function(eid){
    if (!list.some(function(e){ return String(e.id) === String(eid); })) {
      var match = (ENGAGEMENTS||[]).find(function(e){ return String(e.id) === String(eid); });
      if (match) list.push(match);
    }
  });
  list.sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||'')); });

  if (!list.length) {
    wrap.innerHTML = '<div class="amc-linked-empty">No AMC engagements found'+(custName?' for '+esc2(custName):'')+'. Create one from the Tracker first.</div>';
    return;
  }
  wrap.innerHTML = list.map(function(e){
    var checked = alreadyLinked[e.id] ? ' checked' : '';
    var custLabel = '';
    var cust = (CUSTOMERS||[]).find(function(c){ return c.id === e.customer_id; });
    if (cust && cust.name !== custName) custLabel = ' <span class="dim">('+esc2(cust.name)+')</span>';
    return '<label class="amc-linked-row">'+
      '<input type="checkbox" class="amc-linked-cb" value="'+e.id+'"'+checked+'>'+
      '<span class="amc-linked-name">'+esc2(e.name)+custLabel+'</span>'+
    '</label>';
  }).join('');
}

function _amcModalError(msg) {
  var errEl = document.getElementById('amc-modal-error');
  if (errEl) { errEl.textContent = '⚠️ '+msg; errEl.style.display = 'block'; }
  else showError(msg);
}

async function saveAMCContract() {
  if (!isManager) { showError('Manager access only.'); return; }
  if (!await requireAuth()) return;
  var customerName = document.getElementById('amc-cust').value;
  var partner      = (document.getElementById('amc-partner').value||'').trim();
  var region       = document.getElementById('amc-region').value;
  var vendor       = document.getElementById('amc-vendor').value;
  var so           = (document.getElementById('amc-so').value||'').trim();
  var value        = parseFloat(document.getElementById('amc-value').value);
  var start        = document.getElementById('amc-start').value;
  var end          = document.getElementById('amc-end').value;
  var bookYr       = parseInt(document.getElementById('amc-booking-yr').value, 10);
  var notes        = (document.getElementById('amc-notes').value||'').trim();
  var errEl = document.getElementById('amc-modal-error');
  if (errEl) errEl.style.display = 'none';

  if (!customerName) return _amcModalError('Please select a client.');
  if (!partner)      return _amcModalError('Please enter a partner.');
  if (!region)       return _amcModalError('Please select a region.');
  if (!vendor)       return _amcModalError('Please select a vendor.');
  if (isNaN(value) || value <= 0) return _amcModalError('AMC value must be greater than 0.');
  if (!start)        return _amcModalError('Please pick a start date.');
  if (!end)          return _amcModalError('Please pick an end date.');
  if (end <= start)  return _amcModalError('End date must be after start date.');
  if (isNaN(bookYr) || bookYr < 2000 || bookYr > 2100) return _amcModalError('Please enter a valid booking year.');

  var custRow = (CUSTOMERS||[]).find(function(c){ return c.name === customerName; });
  if (!custRow) return _amcModalError('Selected customer could not be resolved. Refresh and try again.');

  var checked = [];
  document.querySelectorAll('.amc-linked-cb:checked').forEach(function(cb){ checked.push(parseInt(cb.value,10)); });

  var payload = {
    customer_id:     custRow.id,
    customer_name:   customerName,
    partner:         partner,
    region:          region,
    vendor:          vendor,
    git_sales_order: so || null,
    amc_value_usd:   value,
    amc_start_date:  start,
    amc_end_date:    end,
    booking_year:    bookYr,
    notes:           notes || null,
    updated_at:      new Date().toISOString()
  };

  var contractId = _amcEditingId;
  if (contractId) {
    var upd = await sb.from('amc_contracts').update(payload).eq('id', contractId);
    if (upd.error) return _amcModalError('Could not save: ' + upd.error.message);
    // Replace link rows wholesale — simpler than diffing.
    var del = await sb.from('amc_contract_engagements').delete().eq('contract_id', contractId);
    if (del.error) return _amcModalError('Could not refresh engagement links: ' + del.error.message);
  } else {
    payload.created_by = currentUser;
    var ins = await sb.from('amc_contracts').insert(payload).select().single();
    if (ins.error) return _amcModalError('Could not create: ' + ins.error.message);
    contractId = ins.data.id;
  }

  if (checked.length) {
    var rows = checked.map(function(eid){ return { contract_id: contractId, engagement_id: eid }; });
    var lins = await sb.from('amc_contract_engagements').insert(rows);
    if (lins.error) return _amcModalError('Saved contract but engagement links failed: ' + lins.error.message);
  }

  closeAMCContractModal();
  showToast(_amcEditingId ? 'Contract updated ✓' : 'Contract created ✓');
  await loadAMCContracts();
}

// Soft-delete: archive moves the contract out of every active list
// but leaves the row + its engagement links intact for restore.
async function archiveAMCContract(id, name) {
  if (!isManager) { showError('Manager access only.'); return; }
  if (!await requireAuth()) return;
  var linkCount = (AMC_CONTRACT_LINKS||[]).filter(function(l){ return l.contract_id === id; }).length;
  var body = 'This will move the contract to the Archived view. It will no longer appear in active lists but can be restored later.';
  if (linkCount) body += '\n\nThe ' + linkCount + ' linked engagement'+(linkCount===1?'':'s')+' will stay linked — restoring the contract brings them back together.';
  if (!await confirmAction({
    title: 'Archive contract for "'+name+'"?',
    body: body,
    confirmText: 'Archive'
  })) return;
  var { error } = await sb.from('amc_contracts').update({
    is_archived: true,
    archived_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { showError('Could not archive: '+error.message); return; }
  showToast('Archived ✓');
  await loadAMCContracts();
}

async function restoreAMCContract(id) {
  if (!isManager) { showError('Manager access only.'); return; }
  if (!await requireAuth()) return;
  var c = (AMC_CONTRACTS||[]).find(function(x){ return x.id === id; });
  if (!c) return;
  if (!await confirmAction({
    title: 'Restore contract for "'+(c.customer_name||'')+'"?',
    body:  'It will return to the active contracts list.',
    confirmText: 'Restore',
    danger: false
  })) return;
  var { error } = await sb.from('amc_contracts').update({
    is_archived: false,
    archived_at: null
  }).eq('id', id);
  if (error) { showError('Could not restore: '+error.message); return; }
  showToast('Restored ✓');
  await loadAMCContracts();
}

// Hard delete from the archive. Requires type-the-name confirmation
// because it really IS gone — cascade-deletes engagement links.
async function permanentlyDeleteAMCContract(id, name) {
  if (!isManager) { showError('Manager access only.'); return; }
  if (!await requireAuth()) return;
  var linkCount = (AMC_CONTRACT_LINKS||[]).filter(function(l){ return l.contract_id === id; }).length;
  var body = '⚠️ This cannot be undone. The contract and all linked data will be permanently removed from the database.';
  if (linkCount) body += '\n\nThe ' + linkCount + ' engagement link'+(linkCount===1?'':'s')+' will be removed; the engagement record'+(linkCount===1?'':'s')+' themselves stay intact.';
  if (!await confirmAction({
    title: 'Permanently delete "'+name+'"?',
    body:  body,
    requireTyping: name,
    confirmText: 'Permanently Delete'
  })) return;
  var { error } = await sb.from('amc_contracts').delete().eq('id', id);
  if (error) { showError('Could not delete: '+error.message); return; }
  showToast('Permanently deleted ✓');
  await loadAMCContracts();
}

// ── DETAIL VIEW ──────────────────────────────────────────────────
async function openAMCContractDetail(id) {
  var modal = document.getElementById('amc-detail-modal');
  if (!modal) return;
  var c = (AMC_CONTRACTS||[]).find(function(x){ return x.id === id; });
  if (!c) { showError('Could not load contract.'); return; }
  var st = _amcStatusFor(c);
  var daysLine = '';
  if (st.key === 'expiring') daysLine = '<div class="amc-detail-days">⚠️ Expires in '+st.days+' day'+(st.days===1?'':'s')+'</div>';
  else if (st.key === 'expired') daysLine = '<div class="amc-detail-days amc-detail-days-expired">Expired '+Math.abs(st.days)+' day'+(Math.abs(st.days)===1?'':'s')+' ago</div>';
  else if (st.key === 'active') daysLine = '<div class="amc-detail-days amc-detail-days-active">'+st.days+' day'+(st.days===1?'':'s')+' remaining</div>';

  // Linked engagements + hours rollup
  var linkedIds = (AMC_CONTRACT_LINKS||[])
    .filter(function(l){ return l.contract_id === id; })
    .map(function(l){ return l.engagement_id; });
  var linkedEngs = (ENGAGEMENTS||[]).filter(function(e){ return linkedIds.indexOf(e.id) !== -1; });
  // Pull hours for the linked engagements in one query (limit to dates
  // within the contract window so totals reflect contract-period work).
  var engRows = '<div class="amc-detail-empty">No engagements linked yet. Edit the contract to add some.</div>';
  if (linkedEngs.length) {
    var sessRes = await sb.from('unified_sessions')
      .select('engagement_id,total_hours,session_date')
      .in('engagement_id', linkedIds)
      .gte('session_date', c.amc_start_date)
      .lte('session_date', c.amc_end_date);
    var byEng = {};
    (sessRes.data||[]).forEach(function(r){
      var b = byEng[r.engagement_id] = byEng[r.engagement_id] || { hours:0, latest:null };
      b.hours += parseFloat(r.total_hours||0);
      if (!b.latest || r.session_date > b.latest) b.latest = r.session_date;
    });
    engRows = linkedEngs.map(function(e){
      var b = byEng[e.id] || { hours:0, latest:null };
      return '<div class="amc-detail-eng-row">'+
        '<div style="flex:1;min-width:0">'+
          '<div class="amc-detail-eng-name">'+esc2(e.name)+'</div>'+
          '<div class="amc-detail-eng-sub">Latest session: '+(b.latest?fmtDate(b.latest):'—')+'</div>'+
        '</div>'+
        '<div class="amc-detail-eng-hours">'+fmtHours(b.hours)+'</div>'+
      '</div>';
    }).join('');
  }

  var f = function(label, val, mono){
    return '<div class="amc-detail-field">'+
      '<div class="amc-detail-label">'+esc2(label)+'</div>'+
      '<div class="amc-detail-value'+(mono?' num':'')+'">'+esc2(val||'—')+'</div>'+
    '</div>';
  };
  document.getElementById('amc-detail-body').innerHTML =
    '<div class="amc-detail-head">'+
      '<div>'+
        '<div class="amc-detail-customer">'+esc2(c.customer_name||'—')+'</div>'+
        '<div class="amc-detail-meta">'+esc2(c.partner||'—')+' · '+esc2(c.region||'—')+' · '+esc2(c.vendor||'—')+'</div>'+
      '</div>'+
      '<div class="amc-detail-status">'+_amcBadge(st)+daysLine+'</div>'+
    '</div>'+
    '<div class="amc-detail-grid">'+
      f('GIT Sales Order', c.git_sales_order, true)+
      f('AMC Value',       _amcFmtUSD(c.amc_value_usd, true), true)+
      f('Start Date',      c.amc_start_date?fmtDate(c.amc_start_date):'—', true)+
      f('End Date',        c.amc_end_date?fmtDate(c.amc_end_date):'—', true)+
      f('Booking Year',    c.booking_year, true)+
      f('Created',         c.created_at?fmtDate(c.created_at)+(c.created_by?' · '+c.created_by:''):'—', false)+
    '</div>'+
    (c.notes ? '<div class="amc-detail-notes"><div class="amc-detail-label">Notes</div><div>'+esc2(c.notes)+'</div></div>' : '')+
    '<div class="amc-detail-section-title">Linked Engagements ('+linkedEngs.length+')</div>'+
    '<div class="amc-detail-engs">'+engRows+'</div>'+
    (isManager ? '<div class="modal-actions" style="margin-top:18px"><button class="btn btn-ghost" onclick="closeAMCContractDetail()">Close</button><button class="btn btn-primary" onclick="closeAMCContractDetail();openAMCContractModal('+c.id+')"><i data-lucide=\"pencil\" class=\"btn-icon\"></i>Edit Contract</button></div>'
                : '<div class="modal-actions" style="margin-top:18px"><button class="btn btn-ghost" onclick="closeAMCContractDetail()">Close</button></div>');

  modal.classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeAMCContractDetail() {
  var modal = document.getElementById('amc-detail-modal');
  if (modal) modal.classList.remove('show');
}
