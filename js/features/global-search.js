// ══ GLOBAL SEARCH (v192) ══════════════════════════════════════════
// One search box in the top bar that looks across the portal and jumps
// straight to the record: engagements, devices, tasks, knowledge-base
// articles and certificates for everyone; customers, Professional Services
// deals and AMC contracts for managers.
//
// For managers it also answers the money question without any AI: when the
// search matches a client, a summary line totals what was awarded,
// collected and pending for that client, plus AMC value - using the same
// rules as the revenue chart (collected = Completed milestones only).
//
// Every query runs as the logged-in user, so RLS still decides what comes
// back. Manager-only sources are also skipped in the UI for employees, so
// the search never surfaces something the sidebar hides (AMC contracts are
// readable to every authenticated user at the database level, but the
// screen is manager-only).

// == CONFIG ==
var GS_MIN_CHARS  = 2;
var GS_PER_SOURCE = 6;
var GS_DEBOUNCE   = 250;

// == STATE ==
var _gsTimer   = null;
var _gsSeq     = 0;      // drops responses that arrive after a newer search
var _gsItems   = [];     // flattened result list - index drives keyboard nav
var _gsActive  = -1;
var _gsBound   = false;

// == HELPERS ==

// Text escape for HTML content. esc2() is an attribute/JS escape (it turns
// ' into \') and would print a visible backslash here.
function _gsEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The term goes into PostgREST filters. Characters that are syntax there
// (comma and brackets split an or() list; % and * are wildcards; quotes and
// backslashes) become '_', the single-character wildcard - so "mashreq's"
// still finds "MASHREQ'S" instead of the apostrophe breaking the query.
function _gsFilterTerm(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    .replace(/[,()"'\\%*]/g, '_');
}

// ilike on several columns: "a.ilike.%t%,b.ilike.%t%"
function _gsOr(cols, t) {
  return cols.map(function(c){ return c + '.ilike.%' + t + '%'; }).join(',');
}

// Wraps every case-insensitive occurrence of the typed text in <mark>. The
// pieces are escaped individually so the highlight can never inject markup.
function _gsHighlight(text, raw) {
  var s = String(text == null ? '' : text);
  var q = String(raw || '').trim();
  if (!q) return _gsEsc(s);
  var lower = s.toLowerCase(), ql = q.toLowerCase();
  var out = '', i = 0, j;
  while ((j = lower.indexOf(ql, i)) !== -1) {
    out += _gsEsc(s.slice(i, j)) + '<mark class="gs-hit">' + _gsEsc(s.slice(j, j + q.length)) + '</mark>';
    i = j + q.length;
  }
  return out + _gsEsc(s.slice(i));
}

function _gsJoin(parts) {
  return parts.filter(function(p){ return p !== null && p !== undefined && p !== ''; }).join(' \u00b7 ');
}

function _gsCap(s) {
  s = String(s || '').replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// == SOURCES ==
// Each source returns { key, label, icon, items:[{ title, sub, meta, open }] }.
// open() navigates to the record's screen, waits for that screen's data,
// then opens the record - the same pattern openEngagementInTracker() uses.

var GS_SOURCES = [
  {
    key: 'customers', label: 'Customers', icon: 'building', managerOnly: true,
    query: function(t){
      return sb.from('customers').select('id,name,status,country')
        .ilike('name', '%' + t + '%').order('name').limit(GS_PER_SOURCE);
    },
    item: function(r){
      return {
        title: r.name, sub: _gsJoin([r.country, _gsCap(r.status)]),
        open: async function(){
          navigateSub('projects', 'custmgr');
          await openEditCustomer(r.id);
        }
      };
    }
  },
  {
    key: 'psdeals', label: 'Professional Services', icon: 'briefcase', managerOnly: true,
    query: function(t){
      return sb.from('ps_deals')
        .select('id,client_name,git_ref_no,partner,status,final_ps_value_usd,is_archived')
        .or(_gsOr(['client_name', 'git_ref_no', 'partner', 'remarks'], t))
        .order('client_name').limit(GS_PER_SOURCE);
    },
    item: function(r){
      var st = (typeof PS_STATUS_META !== 'undefined' && PS_STATUS_META[r.status]) ? PS_STATUS_META[r.status].label : _gsCap(r.status);
      return {
        title: r.client_name || 'Unnamed deal',
        sub: _gsJoin([r.git_ref_no, r.partner, st, r.is_archived ? 'Archived' : '']),
        meta: (r.final_ps_value_usd != null && r.final_ps_value_usd !== '') ? fmtUsd(r.final_ps_value_usd, false) : '',
        open: async function(){
          navigateSub('psdeals', 'deals');
          await loadPsDeals();
          openPsDealModal(r.id);
        }
      };
    }
  },
  {
    key: 'amc', label: 'AMC Contracts', icon: 'shield-check', managerOnly: true,
    query: function(t){
      return sb.from('amc_contracts')
        .select('id,customer_name,partner,git_sales_order,amc_value_usd,amc_end_date,is_archived')
        .eq('is_archived', false)
        .or(_gsOr(['customer_name', 'partner', 'git_sales_order', 'notes'], t))
        .order('amc_end_date', { ascending: false }).limit(GS_PER_SOURCE);
    },
    item: function(r){
      return {
        title: r.customer_name || 'Unnamed contract',
        sub: _gsJoin([r.partner, r.git_sales_order, r.amc_end_date ? 'Ends ' + fmtDate(r.amc_end_date) : '']),
        meta: (r.amc_value_usd != null && r.amc_value_usd !== '') ? fmtUsd(r.amc_value_usd, false) : '',
        open: async function(){
          navigateSub('amc', 'contracts');
          await loadAMCContracts();
          openAMCContractDetail(r.id);
        }
      };
    }
  },
  {
    key: 'engagements', label: 'Engagements', icon: 'folder-kanban',
    query: function(t){
      // Archived engagements are left out: the tracker does not load them,
      // so there would be nothing to open.
      return sb.from('engagements')
        .select('id,name,type,status,partner,vendor')
        .eq('is_archived', false)
        .or(_gsOr(['name', 'partner', 'project_order_no', 'vendor', 'tracker_remarks'], t))
        .order('name').limit(GS_PER_SOURCE);
    },
    item: function(r){
      var type = r.type === 'poc' ? 'POC' : r.type === 'amc' ? 'AMC' : _gsCap(r.type);
      return {
        title: r.name, sub: _gsJoin([type, r.partner, r.vendor, _gsCap(r.status)]),
        open: function(){ return openEngagementInTracker(r.id); }
      };
    }
  },
  {
    key: 'inventory', label: 'Inventory', icon: 'server',
    query: function(t){
      return sb.from('inventory')
        .select('id,serial_number,model_no,availability_status,current_location,current_end_user')
        .or(_gsOr(['serial_number', 'model_no', 'current_location', 'current_partner', 'current_end_user', 'remarks'], t))
        .order('serial_number').limit(GS_PER_SOURCE);
    },
    item: function(r){
      return {
        title: r.serial_number,
        sub: _gsJoin([r.model_no, r.availability_status, r.current_location, r.current_end_user]),
        open: async function(){
          navigateSub('inventory', 'devices');
          await loadInventory();
          openEditDeviceModal(r.id);
        }
      };
    }
  },
  {
    key: 'tasks', label: 'Tasks', icon: 'check-square',
    query: function(t){
      return sb.from('tasks').select('id,title,status,priority,eta_date')
        .eq('is_archived', false)
        .or(_gsOr(['title', 'description', 'remarks'], t))
        .order('created_at', { ascending: false }).limit(GS_PER_SOURCE);
    },
    item: function(r){
      return {
        title: r.title,
        sub: _gsJoin([_gsCap(r.status), r.priority ? _gsCap(r.priority) + ' priority' : '', r.eta_date ? 'ETA ' + fmtDate(r.eta_date) : '']),
        open: async function(){
          showScreen('tasks');
          await loadTasks();
          // Only managers and assignees can open a task; for anyone else the
          // Tasks screen itself is the destination.
          var assignees = (typeof _tasksAssigneesByTaskId === 'function' ? _tasksAssigneesByTaskId()[r.id] : null) || [];
          if (isManager || assignees.indexOf(currentUser) !== -1) openEditTaskModal(r.id);
        }
      };
    }
  },
  {
    key: 'kb', label: 'Knowledge Base', icon: 'book-open',
    query: function(t){
      return sb.from('kb_articles').select('id,title,category,submitted_by')
        .or(_gsOr(['title', 'tags', 'category', 'content'], t))
        .order('created_at', { ascending: false }).limit(GS_PER_SOURCE);
    },
    item: function(r){
      return {
        title: r.title, sub: _gsJoin([r.category, r.submitted_by ? 'by ' + r.submitted_by : '']),
        open: async function(){
          navigateSub('kb', 'browse');
          await loadKBArticles();
          openKBArticle(r.id);
        }
      };
    }
  },
  {
    key: 'certs', label: 'Certificates', icon: 'award',
    query: function(t){
      var q = sb.from('certificates').select('id,employee,name,expiry_date')
        .or(_gsOr(['name', 'employee'], t));
      // RLS already limits employees to their own; filtering here as well
      // keeps the result list honest about what they can open.
      if (!isManager) q = q.eq('employee', currentUser);
      return q.order('expiry_date', { ascending: true }).limit(GS_PER_SOURCE);
    },
    item: function(r){
      return {
        title: r.name,
        sub: _gsJoin([isManager ? r.employee : '', r.expiry_date ? 'Expires ' + fmtDate(r.expiry_date) : '']),
        open: async function(){
          navigateSub('certificates', isManager ? 'all' : 'mine');
          await loadCertificates();
          openCertEditModal(r.id);
        }
      };
    }
  }
];

// == CLIENT MONEY SUMMARY (managers) ==
// "How much did we make from Mashreq?" - totals for every client whose name
// matches, across ALL their deals, not just the handful of rows listed.
// Awarded uses the same revenue statuses as the chart; collected / pending
// go through _psSplitPayments, the one place the Completed rule lives.
async function _gsClientSummary(t) {
  var dealsRes = await sb.from('ps_deals')
    .select('id,client_name,status,final_ps_value_usd')
    .eq('is_archived', false).ilike('client_name', '%' + t + '%');
  var amcRes = await sb.from('amc_contracts')
    .select('customer_name,amc_value_usd')
    .eq('is_archived', false).ilike('customer_name', '%' + t + '%');
  if (dealsRes.error || amcRes.error) return { error: true, rows: [] };

  var deals = dealsRes.data || [];
  var revenueStatuses = (typeof PS_REVENUE_STATUSES !== 'undefined') ? PS_REVENUE_STATUSES : ['won', 'in_progress', 'completed'];
  var revenueIds = deals.filter(function(d){ return revenueStatuses.indexOf(d.status) !== -1; })
                        .map(function(d){ return d.id; });
  var msByDeal = {};
  if (revenueIds.length) {
    var msRes = await sb.from('ps_milestones')
      .select('deal_id,payment_received_usd,status').in('deal_id', revenueIds);
    if (msRes.error) return { error: true, rows: [] };
    (msRes.data || []).forEach(function(m){ (msByDeal[m.deal_id] = msByDeal[m.deal_id] || []).push(m); });
  }

  var byClient = {};
  function bucket(name) {
    var label = String(name || '').trim() || 'Unnamed client';
    var k = label.toLowerCase();
    if (!byClient[k]) byClient[k] = { name: label, awarded: 0, collected: 0, pending: 0, quotes: 0, deals: 0, amc: 0, contracts: 0 };
    return byClient[k];
  }
  deals.forEach(function(d){
    var b = bucket(d.client_name);
    if (d.status === 'quoted') { b.quotes += 1; return; }
    if (revenueStatuses.indexOf(d.status) === -1) return;   // lost / cancelled
    b.deals += 1;
    b.awarded += Number(d.final_ps_value_usd) || 0;
    var split = _psSplitPayments(msByDeal[d.id]);
    b.collected += split.collected;
    b.pending   += split.pending;
  });
  (amcRes.data || []).forEach(function(c){
    var b = bucket(c.customer_name);
    b.contracts += 1;
    b.amc += Number(c.amc_value_usd) || 0;
  });

  var rows = Object.keys(byClient).map(function(k){ return byClient[k]; })
    .filter(function(r){ return r.deals || r.quotes || r.contracts; })
    .sort(function(a, b){ return (b.awarded + b.amc) - (a.awarded + a.amc); });
  return { error: false, rows: rows.slice(0, 3), more: Math.max(0, rows.length - 3) };
}

function _gsSummaryHtml(sum, raw) {
  if (!sum || !sum.rows.length) return '';
  var cards = sum.rows.map(function(r){
    var stat = function(label, value, cls) {
      return '<div class="gs-sum-stat' + (cls ? ' ' + cls : '') + '">' +
               '<span class="gs-sum-label">' + label + '</span>' +
               '<span class="gs-sum-val">' + value + '</span>' +
             '</div>';
    };
    var stats = [];
    if (r.deals) {
      stats.push(stat('PS awarded', fmtUsd(r.awarded, false)));
      stats.push(stat('Collected', fmtUsd(r.collected, false), 'gs-sum-good'));
      if (r.pending > 0) stats.push(stat('Pending', fmtUsd(r.pending, false), 'gs-sum-warn'));
    }
    if (r.contracts) stats.push(stat('AMC value', fmtUsd(r.amc, false)));
    if (r.quotes) stats.push(stat('Open quotes', fmtCount(r.quotes)));
    return '<div class="gs-sum">' +
      // One span, so the flex gap sits between the name and the count - not
      // between the highlighted and plain halves of the name.
      '<div class="gs-sum-name"><span>' + _gsHighlight(r.name, raw) + '</span>' +
        '<span class="gs-sum-count">' +
          _gsJoin([r.deals ? r.deals + ' PS deal' + (r.deals === 1 ? '' : 's') : '',
                   r.contracts ? r.contracts + ' AMC' : '']) +
        '</span>' +
      '</div>' +
      '<div class="gs-sum-stats">' + stats.join('') + '</div>' +
    '</div>';
  }).join('');
  return '<div class="gs-summary">' + cards +
    (sum.more ? '<div class="gs-note">' + sum.more + ' more client' + (sum.more === 1 ? '' : 's') + ' match - type more of the name to narrow it.</div>' : '') +
    '<div class="gs-note">Collected counts milestones marked Completed. All years, archived deals excluded.</div>' +
  '</div>';
}

// == SEARCH ==

function _gsRunSearch(raw) {
  var panel = document.getElementById('gs-panel');
  if (!panel) return;
  var term = String(raw || '').trim();
  var seq = ++_gsSeq;

  if (term.length < GS_MIN_CHARS) {
    _gsItems = []; _gsActive = -1;
    panel.innerHTML = term.length
      ? '<div class="gs-empty">Type at least ' + GS_MIN_CHARS + ' characters</div>'
      : '<div class="gs-empty">Search ' + (isManager ? 'customers, deals, AMC contracts, ' : '') +
        'engagements, devices, tasks, articles and certificates.</div>';
    _gsOpenPanel(true);
    return;
  }

  panel.innerHTML = '<div class="gs-empty"><span class="spinner gs-spinner"></span>Searching\u2026</div>';
  _gsOpenPanel(true);

  var t = _gsFilterTerm(term);
  var sources = GS_SOURCES.filter(function(s){ return !s.managerOnly || isManager; });
  var jobs = sources.map(function(s){
    return Promise.resolve(s.query(t)).then(
      function(res){ return { src: s, res: res }; },
      function(err){ return { src: s, res: { error: err } }; }
    );
  });
  var sumJob = isManager
    ? _gsClientSummary(t).catch(function(){ return { error: true, rows: [] }; })
    : Promise.resolve(null);

  Promise.all([Promise.all(jobs), sumJob]).then(function(all){
    if (seq !== _gsSeq) return;            // a newer search has started
    _gsRender(term, all[0], all[1]);
  });
}

function _gsRender(term, results, summary) {
  var panel = document.getElementById('gs-panel');
  if (!panel) return;
  _gsItems = [];
  _gsActive = -1;
  var failed = 0;

  var groups = results.map(function(r){
    if (r.res.error) { failed++; return ''; }
    var rows = r.res.data || [];
    if (!rows.length) return '';
    var html = rows.map(function(row){
      var it = r.src.item(row);
      var idx = _gsItems.push(it) - 1;
      return '<button type="button" class="gs-item" role="option" id="gs-opt-' + idx + '" data-idx="' + idx + '" aria-selected="false">' +
        '<i data-lucide="' + r.src.icon + '" class="gs-item-icon" aria-hidden="true"></i>' +
        '<span class="gs-item-body">' +
          '<span class="gs-item-title">' + _gsHighlight(it.title, term) + '</span>' +
          (it.sub ? '<span class="gs-item-sub">' + _gsHighlight(it.sub, term) + '</span>' : '') +
        '</span>' +
        (it.meta ? '<span class="gs-item-meta">' + _gsEsc(it.meta) + '</span>' : '') +
      '</button>';
    }).join('');
    return '<div class="gs-group" role="group" aria-label="' + _gsEsc(r.src.label) + '">' +
      '<div class="gs-group-label">' + _gsEsc(r.src.label) +
        (rows.length >= GS_PER_SOURCE ? ' <span class="gs-group-more">top ' + GS_PER_SOURCE + '</span>' : '') +
      '</div>' + html + '</div>';
  }).join('');

  var sumHtml = _gsSummaryHtml(summary, term);
  var failNote = (failed || (summary && summary.error))
    ? '<div class="gs-note gs-note-warn">Some results could not be loaded - check your connection and try again.</div>'
    : '';

  if (!_gsItems.length && !sumHtml) {
    panel.innerHTML = '<div class="gs-empty">No matches for \u201c' + _gsEsc(term) + '\u201d</div>' + failNote;
  } else {
    panel.innerHTML = sumHtml + groups + failNote +
      (_gsItems.length ? '<div class="gs-foot hide-mobile">\u2191\u2193 to move \u00b7 Enter to open \u00b7 Esc to close</div>' : '');
  }
  if (typeof renderIcons === 'function') renderIcons();
  if (_gsItems.length) _gsSetActive(0);
}

// == OPEN / KEYBOARD ==

function _gsSetActive(i) {
  var panel = document.getElementById('gs-panel');
  var input = document.getElementById('gs-input');
  if (!panel || !_gsItems.length) return;
  if (i < 0) i = _gsItems.length - 1;
  if (i >= _gsItems.length) i = 0;
  _gsActive = i;
  panel.querySelectorAll('.gs-item').forEach(function(el){
    var on = Number(el.getAttribute('data-idx')) === i;
    el.classList.toggle('gs-item-active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  });
  if (input) input.setAttribute('aria-activedescendant', 'gs-opt-' + i);
}

async function _gsOpenItem(i) {
  var it = _gsItems[i];
  if (!it) return;
  closeGlobalSearch();
  try {
    await it.open();
  } catch (e) {
    showError('Could not open that record: ' + (e && e.message ? e.message : e));
  }
}

function _gsOpenPanel(open) {
  var wrap  = document.getElementById('gsearch');
  var panel = document.getElementById('gs-panel');
  var input = document.getElementById('gs-input');
  if (!wrap || !panel) return;
  panel.hidden = !open;
  wrap.classList.toggle('gs-has-panel', !!open);
  if (input) input.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function focusGlobalSearch() {
  var wrap  = document.getElementById('gsearch');
  var input = document.getElementById('gs-input');
  if (!wrap || wrap.hidden || !input) return;
  wrap.classList.add('open');            // mobile: expands into the overlay
  input.focus();
  input.select();
  _gsRunSearch(input.value);
}

function closeGlobalSearch() {
  var wrap  = document.getElementById('gsearch');
  var input = document.getElementById('gs-input');
  if (_gsTimer) { clearTimeout(_gsTimer); _gsTimer = null; }
  _gsSeq++;                              // ignore any search still in flight
  _gsOpenPanel(false);
  if (wrap) wrap.classList.remove('open');
  if (input) { input.removeAttribute('aria-activedescendant'); input.blur(); }
}

function _gsOnInput(e) {
  var v = e.target.value;
  if (_gsTimer) clearTimeout(_gsTimer);
  // The handle is cleared when it fires: Enter reads a live handle as "a
  // search is still pending", so a stale one made Enter re-search forever
  // instead of opening the highlighted result.
  _gsTimer = setTimeout(function(){ _gsTimer = null; _gsRunSearch(v); }, GS_DEBOUNCE);
}

function _gsOnKeydown(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); _gsSetActive(_gsActive + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _gsSetActive(_gsActive - 1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    // Enter before the debounce fired: search now rather than open a stale row.
    if (_gsTimer) { clearTimeout(_gsTimer); _gsTimer = null; _gsRunSearch(e.target.value); return; }
    if (_gsActive >= 0) _gsOpenItem(_gsActive);
  }
  else if (e.key === 'Escape') { e.preventDefault(); closeGlobalSearch(); }
}

// == LIFECYCLE ==
// Called from initApp() once the user is known; hidden again on logout so
// the public /#/team page and the login screen never show it.
function initGlobalSearch() {
  var wrap = document.getElementById('gsearch');
  if (!wrap) return;
  wrap.hidden = false;
  var input = document.getElementById('gs-input');
  if (input) {
    input.placeholder = isManager
      ? 'Search customers, deals, engagements, devices\u2026'
      : 'Search engagements, devices, tasks, articles\u2026';
  }
  if (_gsBound) return;
  _gsBound = true;

  input.addEventListener('input', _gsOnInput);
  input.addEventListener('keydown', _gsOnKeydown);
  input.addEventListener('focus', function(){ if (wrap.classList.contains('gs-has-panel')) return; _gsRunSearch(input.value); });

  var panel = document.getElementById('gs-panel');
  // mousedown, not click: keeps focus in the input so the panel doesn't
  // close on blur before the click lands.
  panel.addEventListener('mousedown', function(e){
    var btn = e.target.closest && e.target.closest('.gs-item');
    if (!btn) return;
    e.preventDefault();
    _gsOpenItem(Number(btn.getAttribute('data-idx')));
  });
  panel.addEventListener('mousemove', function(e){
    var btn = e.target.closest && e.target.closest('.gs-item');
    if (btn) { var i = Number(btn.getAttribute('data-idx')); if (i !== _gsActive) _gsSetActive(i); }
  });
  // Keyboard users tabbing onto a result.
  panel.addEventListener('keydown', function(e){
    var btn = e.target.closest && e.target.closest('.gs-item');
    if (btn && e.key === 'Enter') { e.preventDefault(); _gsOpenItem(Number(btn.getAttribute('data-idx'))); }
    if (e.key === 'Escape') closeGlobalSearch();
  });

  document.addEventListener('mousedown', function(e){
    if (!wrap.contains(e.target)) closeGlobalSearch();
  });

  // Ctrl/Cmd+K anywhere, or "/" when not already typing in a field.
  document.addEventListener('keydown', function(e){
    if (wrap.hidden) return;
    var k = (e.key || '').toLowerCase();
    var typing = e.target && (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); focusGlobalSearch(); }
    else if (k === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focusGlobalSearch(); }
  });
}

function resetGlobalSearch() {
  closeGlobalSearch();
  var wrap  = document.getElementById('gsearch');
  var input = document.getElementById('gs-input');
  var panel = document.getElementById('gs-panel');
  if (input) input.value = '';
  if (panel) panel.innerHTML = '';
  _gsItems = []; _gsActive = -1;
  if (wrap) wrap.hidden = true;
}
