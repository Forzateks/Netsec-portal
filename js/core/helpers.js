// == HELPERS =======================================================
// ── Animated number counters ────────────────────────────────────────
// Tiny perceptual upgrade: stats count up from 0 to their final value
// on initial render. Declarative — emit markup with `data-counter="N"`
// (plus optional data-counter-decimals / -suffix / -prefix), then call
// animateCountersIn(scopeEl) right after the innerHTML assignment. The
// utility synchronously sets textContent to "0" before the first paint
// so the final value never flashes. easeOutQuart, ~600ms duration,
// 80ms stagger between siblings inside the same scope.
function _counterFormat(value, opts) {
  opts = opts || {};
  if (typeof value !== 'number' || !isFinite(value)) return String(value);
  var precision;
  if (opts.decimals != null) {
    precision = opts.decimals;
  } else if (Number.isInteger(value)) {
    precision = 0;
  } else {
    var s = String(value);
    var dot = s.indexOf('.');
    precision = dot === -1 ? 0 : Math.min(2, s.length - dot - 1);
  }
  // Locale-aware so animated counters get the same thousands separators
  // as the rest of the app's fmtNum-formatted numbers (e.g. "2,287.44").
  var n = value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
  return (opts.prefix || '') + n + (opts.suffix || '');
}
function animateCounter(el, value, opts) {
  if (!el) return;
  opts = opts || {};
  // Cancel any in-flight animation on this element so a fast re-render
  // can't leave two RAFs racing each other to write the textContent.
  if (el._counterRAF)   { cancelAnimationFrame(el._counterRAF); el._counterRAF = null; }
  if (el._counterTimer) { clearTimeout(el._counterTimer); el._counterTimer = null; }
  // Non-numeric / placeholder ('N/A', '—'): display as-is.
  if (typeof value !== 'number' || !isFinite(value)) {
    el.textContent = String(value);
    return;
  }
  // Respect prefers-reduced-motion — write the final value and exit.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = _counterFormat(value, opts);
    return;
  }
  var duration = opts.duration || 600;
  var delay    = opts.delay || 0;
  // Immediate sync paint to "0" so the final value never flashes between
  // markup insertion and the first RAF tick.
  el.textContent = _counterFormat(0, opts);
  function start() {
    var startTs = null;
    function tick(ts) {
      if (startTs === null) startTs = ts;
      var t = Math.min(1, (ts - startTs) / duration);
      var eased = 1 - Math.pow(1 - t, 4); // easeOutQuart
      el.textContent = _counterFormat(value * eased, opts);
      if (t < 1) {
        el._counterRAF = requestAnimationFrame(tick);
      } else {
        el._counterRAF = null;
        el.textContent = _counterFormat(value, opts);  // settle to exact value
      }
    }
    el._counterRAF = requestAnimationFrame(tick);
  }
  if (delay > 0) el._counterTimer = setTimeout(start, delay);
  else start();
}
// Scan a container for data-counter elements and animate them with a
// staggered start. _counterAnimated guards against re-animating the
// same element so calling on a stable DOM is a no-op (only freshly-
// inserted markup ever animates).
function animateCountersIn(root, opts) {
  if (!root) return;
  opts = opts || {};
  var stagger  = opts.stagger != null ? opts.stagger : 80;
  var duration = opts.duration || 600;
  var els = root.querySelectorAll('[data-counter]');
  Array.prototype.forEach.call(els, function(el, i) {
    if (el._counterAnimated) return;
    el._counterAnimated = true;
    var raw    = el.getAttribute('data-counter');
    var target = parseFloat(raw);
    var decAttr= el.getAttribute('data-counter-decimals');
    var suffix = el.getAttribute('data-counter-suffix') || '';
    var prefix = el.getAttribute('data-counter-prefix') || '';
    if (isNaN(target)) { el.textContent = raw; return; }
    animateCounter(el, target, {
      duration: duration,
      delay:    i * stagger,
      decimals: decAttr != null ? parseInt(decAttr, 10) : undefined,
      suffix:   suffix,
      prefix:   prefix
    });
  });
}

function showAlert(id){
  const el=document.getElementById(id);
  if(!el) return false;
  el.classList.add('show');
  setTimeout(function(){el.classList.remove('show');},3500);
  return true;
}

// ── Toast notifications ───────────────────────────────────────────
// Single source of truth for "action result" feedback. Success toasts
// auto-dismiss in 3s, errors in 5s (longer because the user may need to
// read the message). Position is top-right on desktop, bottom-center on
// mobile — handled by CSS so JS doesn't need viewport detection.
function _toastContainer() {
  var el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(el);
  }
  return el;
}
function showToast(message, opts) {
  opts = opts || {};
  var type = opts.type || 'success';
  var duration = opts.duration != null ? opts.duration : (type === 'error' ? 5000 : 3000);
  var t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  var msgSpan = document.createElement('span');
  msgSpan.className = 'toast-msg';
  msgSpan.textContent = message;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-close';
  btn.setAttribute('aria-label', 'Dismiss');
  btn.textContent = '×';
  t.appendChild(msgSpan);
  t.appendChild(btn);
  var dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    t.classList.add('toast-leaving');
    setTimeout(function(){ if (t.parentNode) t.parentNode.removeChild(t); }, 220);
  }
  btn.addEventListener('click', dismiss);
  _toastContainer().appendChild(t);
  setTimeout(dismiss, duration);
  return dismiss;
}
function showError(message) {
  return showToast(message || 'Something went wrong — please try again', { type:'error' });
}

// ── Relative time ────────────────────────────────────────────────
// "just now" / "5 minutes ago" / "yesterday" / "3 days ago" /
// "last week" — falls back to fmtDate after 14 days. For "when did
// this happen" timestamps only; never use for work dates.
function relativeTime(iso) {
  if (!iso) return '';
  var t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  var diffMs = Date.now() - t;
  if (diffMs < 0) return fmtDate(iso); // future — fall back to absolute
  if (diffMs < 60000) return 'just now';
  var min = Math.floor(diffMs / 60000);
  if (min < 60) return min + ' minute' + (min===1?'':'s') + ' ago';
  var hrs = Math.floor(min / 60);
  if (hrs < 24) return hrs + ' hour' + (hrs===1?'':'s') + ' ago';
  var days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)   return days + ' days ago';
  if (days < 14)  return 'last week';
  return fmtDate(iso);
}
// Hover tooltip showing the raw timestamp (YYYY-MM-DD HH:MM) for precision.
function relativeTimeTitle(iso) {
  if (!iso) return '';
  return String(iso).replace('T', ' ').slice(0, 16);
}

// ── Confirmation modal ───────────────────────────────────────────
// Replaces window.confirm() across the app. Returns a Promise<boolean>.
// opts:
//   title          — modal title (required)
//   body           — body text; \n preserved via white-space:pre-wrap
//   confirmText    — button label (default 'Delete')
//   danger         — red Delete button (default true)
//   requireTyping  — if set, user must type this exact string before
//                    the confirm button enables. Used for high-stakes
//                    cascading deletes (engagement/customer/purge).
function confirmAction(opts) {
  opts = opts || {};
  return new Promise(function(resolve) {
    var modal       = document.getElementById('confirm-modal');
    var titleEl     = document.getElementById('confirm-modal-title');
    var bodyEl      = document.getElementById('confirm-modal-body');
    var typingWrap  = document.getElementById('confirm-modal-typing-wrap');
    var typingTgt   = document.getElementById('confirm-modal-typing-target');
    var typingInput = document.getElementById('confirm-modal-typing-input');
    var cancelBtn   = document.getElementById('confirm-modal-cancel');
    var okBtn       = document.getElementById('confirm-modal-ok');
    if (!modal || !okBtn) { resolve(window.confirm(opts.body || opts.title || 'Are you sure?')); return; }

    titleEl.textContent = opts.title || 'Are you sure?';
    bodyEl.textContent  = opts.body || '';
    okBtn.textContent   = opts.confirmText || 'Delete';
    var danger = opts.danger !== false;
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');

    if (opts.requireTyping) {
      typingTgt.textContent = opts.requireTyping;
      typingInput.value = '';
      typingWrap.style.display = 'block';
      okBtn.disabled = true;
      typingInput.oninput = function() {
        okBtn.disabled = typingInput.value !== opts.requireTyping;
      };
    } else {
      typingWrap.style.display = 'none';
      okBtn.disabled = false;
      typingInput.oninput = null;
    }

    function close(result) {
      modal.classList.remove('show');
      cancelBtn.onclick = null;
      okBtn.onclick = null;
      typingInput.oninput = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter' && !okBtn.disabled && document.activeElement !== typingInput) close(true);
    }
    cancelBtn.onclick = function(){ close(false); };
    okBtn.onclick     = function(){ if (!okBtn.disabled) close(true); };
    document.addEventListener('keydown', onKey);
    modal.classList.add('show');
    if (opts.requireTyping) setTimeout(function(){ typingInput.focus(); }, 80);
  });
}

// ── Empty-state HTML helper ────────────────────────────────────────
// Single source of truth for empty-state markup so every list/table/
// section uses the same icon + heading + subtext + optional CTA shape.
// opts:
//   icon       — Lucide name (string), default 'inbox'
//   heading    — short title, 4-8 words
//   sub        — descriptive sentence explaining the section's purpose
//   btnText    — primary CTA label; omit for no button
//   btnOnclick — string of JS to run on click (caller controls escaping)
//   btnIcon    — Lucide name for the button glyph, default 'plus'
//   padding    — override inline padding (e.g. '32px 16px' for tight cards)
// Caller must run renderIcons() (or lucide.createIcons()) after inserting
// the returned HTML into the DOM so the Lucide tags hydrate.
function renderEmptyState(opts) {
  opts = opts || {};
  var icon       = opts.icon || 'inbox';
  var heading    = opts.heading || '';
  var sub        = opts.sub || '';
  var btnText    = opts.btnText || '';
  var btnOnclick = opts.btnOnclick || '';
  var btnIcon    = opts.btnIcon || 'plus';
  var padding    = opts.padding ? ' style="padding:'+opts.padding+'"' : '';
  return '<div class="empty-state"'+padding+'>' +
    '<i data-lucide="'+icon+'" class="empty-icon-svg"></i>' +
    (heading ? '<div class="empty-title">'+heading+'</div>' : '') +
    (sub     ? '<div class="empty-sub">'+sub+'</div>'       : '') +
    (btnText ? '<button class="btn btn-primary" onclick="'+btnOnclick+'"><i data-lucide="'+btnIcon+'" class="btn-icon"></i>'+btnText+'</button>' : '') +
    '</div>';
}
// Display format: 01-Jan-2026. Accepts ISO (YYYY-MM-DD) or ISO timestamps.
function fmtDate(str){
  if(!str) return '';
  const s = String(str).split('T')[0].split('-');
  if (s.length !== 3) return String(str);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = parseInt(s[1],10);
  const monthName = (m>=1 && m<=12) ? months[m-1] : s[1];
  return s[2]+'-'+monthName+'-'+s[0];
}
// Trim a Postgres TIME (HH:MM:SS) or HH:MM string to HH:MM. Returns '' for null.
function fmtTime(t){
  if(!t) return '';
  return String(t).slice(0,5);
}
function r2(n){return Math.round((n||0)*100)/100;}
function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):'';}
function statusIcon(s){return s==='approved'?'✅':s==='rejected'?'❌':'🟡';}
function esc2(s){return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');}

// Render the band badge(s) for an OT session row. Stored band is one of the
// five enum values (Eve / Early / Mid / Wknd / Day), but a session that
// covers BOTH morning Early OT and evening Eve OT is stored as 'Eve' for
// schema simplicity — calcOT() picks Eve as the umbrella label and credits
// both portions correctly. Recompute morningOT/eveningOT here so mixed
// sessions render as TWO badges (Early + Eve) instead of hiding the morning
// part behind a single Eve label. Stored .credited_hours is unaffected.
function bandBadge(s) {
  if (!s) return '';
  var b = s.band || '';
  if (b !== 'Eve') return '<span class="badge badge-'+b+'">'+b+'</span>';
  if (!s.start_time || !s.end_time) return '<span class="badge badge-Eve">Eve</span>';
  var emp = s.employee || '';
  var t = (typeof getOTThresholds === 'function') ? getOTThresholds(emp) : { eveStart: 18.5, morningBlock: 7.5 };
  var sp = String(s.start_time).split(':').map(Number);
  var ep = String(s.end_time).split(':').map(Number);
  var sf = sp[0] + (sp[1]||0)/60;
  var ef = ep[0] + (ep[1]||0)/60;
  if (ef <= sf) return '<span class="badge badge-Eve">Eve</span>';
  var morningOT = (sf < t.morningBlock) ? Math.max(0, Math.min(ef, t.morningBlock) - sf) : 0;
  var eveningOT = (ef > t.eveStart)     ? Math.max(0, ef - Math.max(sf, t.eveStart))     : 0;
  if (morningOT > 0 && eveningOT > 0) {
    return '<span class="badge badge-Early">Early</span> <span class="badge badge-Eve">Eve</span>';
  }
  return '<span class="badge badge-Eve">Eve</span>';
}

// Paginate through a Supabase query in chunks of 1000 to work around the
// platform's server-side row cap. Pass a function that builds a fresh query
// (with filters/orders applied) — we append .range() per page and concat.
async function fetchAllRows(buildQuery) {
  var pageSize = 1000;
  var page = 0;
  var all = [];
  while (true) {
    var res = await buildQuery().range(page * pageSize, (page + 1) * pageSize - 1);
    if (res.error) return res;
    var rows = res.data || [];
    all = all.concat(rows);
    if (rows.length < pageSize) break;
    page++;
    if (page > 100) { console.warn('fetchAllRows: 100k-row safety cap hit'); break; }
  }
  return { data: all, error: null };
}

// Wrap a Supabase-style promise (resolves to {data, error, count}) with a
// timeout. If the network call doesn't return in `ms` milliseconds, resolve
// with the supplied fallback so the caller can still render something
// instead of hanging indefinitely. Logs to console so we can spot which
// query is slow.
function withTimeout(promise, ms, fallback, label) {
  return new Promise(function(resolve) {
    var done = false;
    var timer = setTimeout(function(){
      if (done) return;
      done = true;
      if (label) console.warn('Query timeout (' + ms + 'ms):', label);
      resolve(fallback);
    }, ms);
    Promise.resolve(promise).then(function(v){
      if (done) return; done = true; clearTimeout(timer); resolve(v);
    }).catch(function(err){
      if (done) return; done = true; clearTimeout(timer);
      if (label) console.warn('Query failed:', label, err);
      resolve(fallback);
    });
  });
}

// Reusable multi-select dropdown. Wrap an empty <div class="ms" id="..."></div>
// then call msInit(id, items, onChange). items is [{value,label}]; the chosen
// values are stored on the element as a Set. Read via msGetValues(id), reset
// via msSetValues(id, values). A global click handler closes any open ms when
// the user clicks outside of it.
function msInit(id, items, onChange) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.add('ms');
  el.innerHTML = '<button class="ms-btn" type="button">'+
      '<span class="ms-label">All</span>'+
      '<span class="ms-caret">▾</span>'+
    '</button>'+
    '<div class="ms-pop">'+
      '<div class="ms-pop-head">'+
        '<input class="ms-search" placeholder="Search...">'+
        '<button class="ms-clear" type="button">Clear</button>'+
      '</div>'+
      '<div class="ms-list"></div>'+
    '</div>';
  el._items = items || [];
  if (!el._selected) el._selected = new Set();
  // Drop selections that are no longer in the items list (e.g. after a data
  // refresh removes a partner from the universe of values).
  var validValues = new Set(el._items.map(function(i){return i.value;}));
  Array.from(el._selected).forEach(function(v){ if (!validValues.has(v)) el._selected.delete(v); });
  el._onChange = onChange;

  el.querySelector('.ms-btn').addEventListener('click', function(e){
    e.stopPropagation();
    var wasOpen = el.classList.contains('open');
    document.querySelectorAll('.ms.open').forEach(function(o){ o.classList.remove('open'); });
    if (!wasOpen) el.classList.add('open');
  });
  el.querySelector('.ms-search').addEventListener('input', function(){ msRenderList(el); });
  el.querySelector('.ms-search').addEventListener('click', function(e){ e.stopPropagation(); });
  el.querySelector('.ms-clear').addEventListener('click', function(e){
    e.stopPropagation();
    el._selected.clear();
    msRenderList(el);
    msUpdateLabel(el);
    if (el._onChange) el._onChange();
  });
  msRenderList(el);
  msUpdateLabel(el);
}

function msRenderList(el) {
  var search = ((el.querySelector('.ms-search')||{}).value||'').toLowerCase();
  var list = el.querySelector('.ms-list');
  var filtered = el._items.filter(function(it){
    return !search || (String(it.label||'').toLowerCase().indexOf(search) !== -1);
  });
  if (!filtered.length) { list.innerHTML = '<div class="ms-empty">No matches</div>'; return; }
  list.innerHTML = filtered.map(function(it){
    var checked = el._selected.has(it.value) ? 'checked' : '';
    var v = String(it.value).replace(/"/g,'&quot;');
    return '<label class="ms-opt"><input type="checkbox" '+checked+' value="'+v+'"> <span>'+esc2(it.label)+'</span></label>';
  }).join('');
  list.querySelectorAll('input[type="checkbox"]').forEach(function(cb){
    cb.addEventListener('change', function(){
      if (cb.checked) el._selected.add(cb.value);
      else            el._selected.delete(cb.value);
      msUpdateLabel(el);
      if (el._onChange) el._onChange();
    });
  });
}

function msUpdateLabel(el) {
  var label = el.querySelector('.ms-label');
  var n = el._selected.size;
  if (n === 0)      label.textContent = 'All';
  else if (n === 1) label.textContent = Array.from(el._selected)[0];
  else              label.textContent = n + ' selected';
}

function msGetValues(id) {
  var el = document.getElementById(id);
  return (el && el._selected) ? Array.from(el._selected) : [];
}

function msSetValues(id, values) {
  var el = document.getElementById(id);
  if (!el) return;
  el._selected = new Set(values || []);
  if (el.querySelector('.ms-list')) msRenderList(el);
  if (el.querySelector('.ms-label')) msUpdateLabel(el);
}

// Close any open multi-select when the user clicks outside it.
document.addEventListener('click', function(e){
  document.querySelectorAll('.ms.open').forEach(function(el){
    if (!el.contains(e.target)) el.classList.remove('open');
  });
});

// Attach a synced horizontal scrollbar above a .table-wrap so users don't
// have to scroll to the bottom of a long table to find the native scrollbar.
// No-op when the inner table fits without overflow.
function attachTopScroll(wrap) {
  if (!wrap) return;
  var inner = wrap.querySelector('table');
  if (!inner) return;
  var sw = inner.scrollWidth;
  var cw = wrap.clientWidth;

  // Existing top mirror? Resize its spacer (e.g. after a re-render or filter).
  var prev = wrap.previousElementSibling;
  if (prev && prev.classList && prev.classList.contains('table-wrap-top-scroll')) {
    if (sw <= cw + 4) { prev.parentNode.removeChild(prev); return; }
    if (prev.firstElementChild) prev.firstElementChild.style.width = sw + 'px';
    return;
  }

  // Only add when the table actually overflows
  if (sw <= cw + 4) return;

  var top = document.createElement('div');
  top.className = 'table-wrap-top-scroll';
  var spacer = document.createElement('div');
  spacer.className = 'table-wrap-top-scroll-spacer';
  spacer.style.width = sw + 'px';
  top.appendChild(spacer);
  wrap.parentNode.insertBefore(top, wrap);

  // Two-way sync with re-entrancy guard
  var lock = false;
  top.addEventListener('scroll', function(){
    if (lock) return; lock = true;
    wrap.scrollLeft = top.scrollLeft;
    requestAnimationFrame(function(){ lock = false; });
  });
  wrap.addEventListener('scroll', function(){
    if (lock) return; lock = true;
    top.scrollLeft = wrap.scrollLeft;
    requestAnimationFrame(function(){ lock = false; });
  });
}



// == WEEKLY BACKUP ================================================
function checkBackupReminder() {
  if (!isManager) return;
  const last = parseInt(localStorage.getItem('gulfit_last_backup')||'0');
  const sevenDays = 7*24*60*60*1000;
  if (Date.now() - last > sevenDays) {
    const banner = document.getElementById('backup-banner');
    if (banner) banner.style.display='flex';
  }
}

function dismissBackup() {
  const banner = document.getElementById('backup-banner');
  if (banner) banner.style.display='none';
  localStorage.setItem('gulfit_last_backup_dismissed', Date.now().toString());
}

async function downloadBackup(btnEl) {
  const btn = btnEl || document.querySelector('#backup-banner button');
  if (!btn) return;
  btn.textContent = '⏳ Preparing...';
  btn.disabled = true;

  try {
    // Fetch all data
    const [
      {data:otSessions},
      {data:compoffReg},
      {data:compoffReqs},
      {data:leaveReg},
      {data:leaveReqs},
      {data:projSessions}
    ] = await Promise.all([
      sb.from('ot_sessions').select('*').order('ot_date',{ascending:false}),
      sb.from('comp_off_register').select('*').order('date_taken',{ascending:false}),
      sb.from('comp_off_requests').select('*').order('created_at',{ascending:false}),
      sb.from('annual_leave').select('*').order('start_date',{ascending:false}),
      sb.from('leave_requests').select('*').order('created_at',{ascending:false}),
      sb.from('project_sessions').select('*').order('session_date',{ascending:false})
    ]);

    // Build CSV sections
    function toCSV(headers, rows) {
      const all = [headers].concat(rows);
      return all.map(function(r){ return r.map(function(v){ return '"'+(v==null?'':v)+'"'; }).join(','); }).join('\n');
    }

    const sections = [
      { name:'OT_Sessions', csv: toCSV(
        ['Employee','Activity','Date','Day','Start','End','Duration(h)','Band','Rate','Credited(h)'],
        (otSessions||[]).map(function(r){return [r.employee,r.activity,r.ot_date,r.day_name,r.start_time,r.end_time,r.duration_hours,r.band,r.rate,r.credited_hours];})
      )},
      { name:'CompOff_Register', csv: toCSV(
        ['Employee','Date Taken','Type','Days','Approved By','Remarks'],
        (compoffReg||[]).map(function(r){return [r.employee,r.date_taken,r.type,r.days,r.approved_by,r.remarks];})
      )},
      { name:'CompOff_Requests', csv: toCSV(
        ['Employee','Request Date','Type','Days','Status','Manager Comment','Reviewed By'],
        (compoffReqs||[]).map(function(r){return [r.employee,r.request_date,r.type,r.days,r.status,r.manager_comment,r.reviewed_by];})
      )},
      { name:'Annual_Leave', csv: toCSV(
        ['Employee','Start Date','End Date','Working Days','Reason','Approved By'],
        (leaveReg||[]).map(function(r){return [r.employee,r.start_date,r.end_date,r.working_days,r.reason,r.approved_by];})
      )},
      { name:'Leave_Requests', csv: toCSV(
        ['Employee','Start Date','End Date','Days','Status','Manager Comment','Reviewed By'],
        (leaveReqs||[]).map(function(r){return [r.employee,r.start_date,r.end_date,r.working_days,r.status,r.manager_comment,r.reviewed_by];})
      )},
      { name:'Project_Sessions', csv: toCSV(
        ['Project','Date','Activity','Session Info','Start','End','Duration(h)','Mode','Team','Stake Holders','Remarks','Logged By'],
        (projSessions||[]).map(function(r){return [r.project_name,r.session_date,r.activity_type,r.session_info,r.start_time,r.end_time,r.duration_hours,r.onsite_remote,r.team_members,r.stake_holders,r.remarks,r.logged_by];})
      )}
    ];

    // Combine all sections into one CSV with headers
    const today = new Date().toLocaleDateString('en-GB').replace(/\//g,'-');
    let fullCsv = 'NetSec Portal — Full Data Backup — ' + today + '\n\n';
    sections.forEach(function(s) {
      fullCsv += '=== ' + s.name + ' ===\n' + s.csv + '\n\n';
    });

    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(fullCsv);
    a.download = 'GulfIT_Portal_Backup_' + today + '.csv';
    a.click();

    // Save backup timestamp
    localStorage.setItem('gulfit_last_backup', Date.now().toString());
    const banner = document.getElementById('backup-banner');
    if (banner) banner.style.display='none';
    btn.textContent = '✅ Downloaded!';
    setTimeout(function(){ btn.innerHTML='<i data-lucide="download" class="btn-icon"></i>Download Backup Now'; btn.disabled=false; if (typeof renderIcons === 'function') renderIcons(); }, 2000);

  } catch(e) {
    btn.textContent = '❌ Error';
    btn.disabled = false;
    showError('Backup failed: ' + e.message);
  }
}

