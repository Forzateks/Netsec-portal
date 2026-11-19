// == TEAM LEARNING (v201) ==========================================
// Weekly progress per person per product: course, certification and
// hands-on status, what was done this week, and any roadblock. Three views:
//   My Week   - everyone edits their own week (managers can pick anyone)
//   Team Week - managers: everyone's entries for one week, roadblocks first
//   Compare   - managers: each person against THEIR OWN previous week
// A week is labelled by its Friday (learning_entries.week_date). Opening your
// own current week when it is empty copies your most recent earlier week, so
// you only change what moved. RLS (learning_entries policies) limits
// employees to their own rows; managers can read and edit everyone's.

var LN_STATUS = [
  { k: 'not_started', label: 'Not started' },
  { k: 'in_progress', label: 'In progress' },
  { k: 'completed',   label: 'Completed' }
];
var LN_RANK = { not_started: 0, in_progress: 1, completed: 2 };
var LN_AREAS = [
  { f: 'course_status',   label: 'Course' },
  { f: 'cert_status',     label: 'Certification' },
  { f: 'hands_on_status', label: 'Hands-on' }
];
var LN_COPY_FIELDS = ['vendor', 'technology', 'product_line_id', 'course_status', 'course_date', 'cert_status',
                      'cert_date', 'hands_on_status', 'is_blocked', 'blocker_note', 'next_steps', 'due_date'];

var _lnTab     = 'mine';
var _lnWeek    = null;    // selected week, Friday ISO; shared by all three tabs
var _lnEditEmp = null;    // whose week My Week is editing (managers can switch)
var _lnRows    = [];      // rows in the editor; _dirty / _new / _origCert added
var _lnCatalog = null;    // [{ vendor, lines:[{id,name}] }] from Vendors & Products
var _lnSeq     = 0;       // only the latest load may paint
var _lnSaving  = false;

// == SMALL HELPERS ==
// v202: an update shown point by point - one bullet per line the person typed.
function _lnPoints(text) {
  var lines = String(text || '').split(/\r?\n/).map(function(l){ return l.replace(/^\s*[-*•]\s*/, '').trim(); }).filter(Boolean);
  if (!lines.length) return '';
  return '<ul class="ln-points">' + lines.map(function(l){ return '<li>' + _lnEsc(l) + '</li>'; }).join('') + '</ul>';
}
// v203: earlier weeks' updates (newest first), each under its week - shown
// above this week's update in My Week, Team Week and Compare.
function _lnPrevHtml(list) {
  if (!list || !list.length) return '';
  return '<div class="ln-lastwk">' + list.map(function(h){
    return '<span class="ln-lastwk-h">Week ending ' + fmtDate(h.week) + '</span>' + _lnPoints(h.note);
  }).join('') + '</div>';
}
function _lnEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _lnAddDays(iso, n) {
  var p = String(iso).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
// The Friday on or after a date: Saturday-to-Friday weeks end on Friday.
function _lnFriday(iso) {
  var p = String(iso).split('-').map(Number);
  var dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return _lnAddDays(iso, (5 - dow + 7) % 7);
}
function _lnThisFriday() {
  var today = (typeof officeClock === 'function') ? officeClock().iso : new Date().toISOString().slice(0, 10);
  return _lnFriday(today);
}
function _lnWeekNow() { return _lnWeek || _lnThisFriday(); }
function _lnWeekLabel(iso) { return 'Week ending Friday ' + fmtDate(iso); }
function _lnKey(r) { return (String(r.vendor || '').trim() + '|' + String(r.technology || '').trim()).toLowerCase(); }
function _lnRank(v) { return LN_RANK[v] != null ? LN_RANK[v] : 0; }
function _lnStatusLabel(v) {
  for (var i = 0; i < LN_STATUS.length; i++) if (LN_STATUS[i].k === v) return LN_STATUS[i].label;
  return '';
}
function _lnPill(v, muted) {
  if (!v) return '<span class="ln-dim">—</span>';
  return '<span class="ln-pill ln-pill-' + v + (muted ? ' ln-pill-muted' : '') + '">' + _lnStatusLabel(v) + '</span>';
}
function _lnEmployees() {
  return (typeof EMPLOYEES !== 'undefined' && EMPLOYEES && EMPLOYEES.length) ? EMPLOYEES.slice() : [currentUser];
}
function _lnDirtyCount() { return _lnRows.filter(function(r){ return r._dirty || r._new; }).length; }

async function _lnCanLeave() {
  if (!_lnDirtyCount()) return true;
  return await confirmAction({
    title: 'Discard unsaved changes?',
    body: 'You have unsaved changes for this week. Leave without saving them?',
    confirmText: 'Discard changes', danger: true
  });
}

// == NAVIGATION ==
// == PRODUCT PICKER (v205) ==================================================
// A drop-down with a tick box per product. Unticked products are hidden from
// the table (nothing is deleted), leaving more room for the update columns.
// The unticked set is remembered while the page is open, so new products show.
var _lnHide = { mine: {}, team: {} };
function _lnPickHtml(scope, products) {
  if (!products || products.length < 2) return '';
  var seen = {}, list = [];
  products.forEach(function(r){ var k = _lnKey(r); if (!seen[k]) { seen[k] = 1; list.push({ k: k, v: r.vendor, t: r.technology }); } });
  list.sort(function(a, b){ return (a.v + '|' + a.t).toLowerCase() < (b.v + '|' + b.t).toLowerCase() ? -1 : 1; });
  return '<details class="ln-pp" id="ln-pp-' + scope + '"><summary class="btn btn-sm btn-ghost"><i data-lucide="list-checks" class="btn-icon"></i><span class="ln-pp-label">All products</span></summary>' +
    '<div class="ln-pp-panel"><div class="ln-pp-actions"><button type="button" class="btn btn-sm btn-ghost" onclick="_lnPickAll(\'' + scope + '\',true)">Select all</button>' +
    '<button type="button" class="btn btn-sm btn-ghost" onclick="_lnPickAll(\'' + scope + '\',false)">Clear</button></div>' +
    list.map(function(p){
      return '<label class="ln-pp-opt"><input type="checkbox" data-pk="' + _lnEsc(p.k) + '"' + (_lnHide[scope][p.k] ? '' : ' checked') + ' onchange="_lnPickChange(\'' + scope + '\')">' +
        '<span><span class="ln-pp-v">' + _lnEsc(p.v) + '</span> ' + _lnEsc(p.t) + '</span></label>';
    }).join('') + '</div></details>';
}
function _lnPickChange(scope) {
  var box = document.getElementById('ln-pp-' + scope);
  if (!box) return;
  var hide = {};
  Array.prototype.forEach.call(box.querySelectorAll('input[data-pk]'), function(c){ if (!c.checked) hide[c.getAttribute('data-pk')] = 1; });
  _lnHide[scope] = hide;
  _lnApplyPick(scope);
}
function _lnPickAll(scope, on) {
  var box = document.getElementById('ln-pp-' + scope);
  if (!box) return;
  Array.prototype.forEach.call(box.querySelectorAll('input[data-pk]'), function(c){ c.checked = on; });
  _lnPickChange(scope);
}
function _lnApplyPick(scope) {
  var host = document.getElementById(scope === 'mine' ? 'ln-mine-content' : 'ln-team-content');
  if (!host) return;
  var hide = _lnHide[scope];
  Array.prototype.forEach.call(host.querySelectorAll('tr[data-pk]'), function(tr){
    tr.classList.toggle('ln-hide', !!hide[tr.getAttribute('data-pk')]);
  });
  Array.prototype.forEach.call(host.querySelectorAll('.ln-group'), function(g){
    var trs = g.querySelectorAll('tr[data-pk]');
    if (!trs.length) return;
    g.classList.toggle('ln-hide', g.querySelectorAll('tr[data-pk]:not(.ln-hide)').length === 0);
  });
  var box = document.getElementById('ln-pp-' + scope);
  if (box) {
    var all = box.querySelectorAll('input[data-pk]'), on = box.querySelectorAll('input[data-pk]:checked');
    var lab = box.querySelector('.ln-pp-label');
    if (lab) lab.textContent = on.length === all.length ? 'All products' : (on.length ? on.length + ' of ' + all.length + ' products' : 'No products');
  }
}
document.addEventListener('click', function(e){
  Array.prototype.forEach.call(document.querySelectorAll('details.ln-pp[open]'), function(d){ if (!d.contains(e.target)) d.removeAttribute('open'); });
});

async function showLearningTab(tab) {
  // v205: Compare is hidden for now (the code stays).
  if (tab === 'compare') tab = 'team';
  if (tab !== 'mine' && !isManager) tab = 'mine';
  if (_lnTab === 'mine' && tab !== 'mine' && !(await _lnCanLeave())) { tab = 'mine'; }
  _lnTab = tab;
  ['mine', 'team', 'compare'].forEach(function(t){
    var el = document.getElementById('lntab-' + t);
    if (el) el.style.display = (t === tab) ? '' : 'none';
  });
  if (typeof setSidebarSubActive === 'function') setSidebarSubActive('learning', tab);
  _lnSyncWeekBar();
  if (tab === 'mine') renderLearningMine();
  else if (tab === 'team') renderLearningTeam();
  else renderLearningCompare();
}

function _lnSyncWeekBar() {
  var w = _lnWeekNow();
  var inp = document.getElementById('ln-week-input');
  if (inp) inp.value = w;
  var lab = document.getElementById('ln-week-label');
  if (lab) lab.textContent = _lnWeekLabel(w) + (w === _lnThisFriday() ? ' (this week)' : '');
}

async function setLearningWeek(iso) {
  if (!iso) { _lnSyncWeekBar(); return; }
  if (_lnTab === 'mine' && !(await _lnCanLeave())) { _lnSyncWeekBar(); return; }
  _lnRows = [];
  _lnWeek = _lnFriday(iso);
  showLearningTab(_lnTab);
}
function shiftLearningWeek(n) { setLearningWeek(_lnAddDays(_lnWeekNow(), 7 * n)); }
function learningThisWeek() { setLearningWeek(_lnThisFriday()); }

// == CATALOGUE (Vendors & Products) ==
async function _lnLoadCatalog() {
  if (_lnCatalog) return _lnCatalog;
  var res = await Promise.all([
    sb.from('vendors').select('id,name').eq('is_active', true).order('display_order').order('name'),
    sb.from('product_lines').select('id,vendor_id,name').eq('is_active', true).order('display_order').order('name')
  ]);
  if (res[0].error || res[1].error) return [];
  var byVendor = {};
  (res[1].data || []).forEach(function(p){
    if (/^other\b/i.test(p.name || '')) return;           // "Other (specify)" is handled by our own Other
    (byVendor[p.vendor_id] = byVendor[p.vendor_id] || []).push({ id: p.id, name: p.name });
  });
  _lnCatalog = (res[0].data || []).map(function(v){ return { vendor: v.name, lines: byVendor[v.id] || [] }; });
  return _lnCatalog;
}

// == MY WEEK ==
var _lnTeamRows = [];    // v202: the Team Week rows on screen (approve buttons)
var _lnPrevNotes = {};   // product key -> up to 3 earlier {week, note}, newest first
async function renderLearningMine() {
  var host = document.getElementById('ln-mine-content');
  if (!host) return;
  var mySeq = ++_lnSeq;
  var emp = (isManager && _lnEditEmp) ? _lnEditEmp : currentUser;
  var week = _lnWeekNow();
  host.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  var res = await sb.from('learning_entries').select('*').eq('employee', emp).eq('week_date', week)
    .order('vendor').order('technology');
  if (mySeq !== _lnSeq) return;
  if (res.error) { host.innerHTML = _lnError('Could not load this week'); return; }
  var rows = res.data || [];
  var notice = '', offerFrom = null;

  if (!rows.length) {
    var prev = await sb.from('learning_entries').select('week_date').eq('employee', emp)
      .lt('week_date', week).order('week_date', { ascending: false }).limit(1);
    if (mySeq !== _lnSeq) return;
    var prevWeek = (!prev.error && prev.data && prev.data[0]) ? prev.data[0].week_date : null;
    // Auto-copy only your OWN current week. A manager opening someone else's
    // week, or anyone browsing another week, gets a button instead - so no
    // row is ever created on someone's behalf just by looking.
    if (prevWeek && emp === currentUser && week === _lnThisFriday()) {
      var copied = await _lnCopyWeek(emp, prevWeek, week);
      if (mySeq !== _lnSeq) return;
      if (copied.ok) {
        var again = await sb.from('learning_entries').select('*').eq('employee', emp).eq('week_date', week)
          .order('vendor').order('technology');
        if (mySeq !== _lnSeq) return;
        rows = again.data || [];
        notice = 'Started from your entries for the week ending ' + fmtDate(prevWeek) + '. Change what moved this week and add your update.';
      } else {
        offerFrom = prevWeek;
      }
    } else if (prevWeek) {
      offerFrom = prevWeek;
    }
  }

  // v202: show what was written the week before, right above this week's box.
  _lnPrevNotes = {};
  if (rows.length) {
    var lastWk = await sb.from('learning_entries').select('vendor,technology,update_note,week_date')
      .eq('employee', emp).lt('week_date', week).order('week_date', { ascending: false }).limit(60);
    if (mySeq !== _lnSeq) return;
    (lastWk.data || []).forEach(function(r){
      if (!r.update_note) return;
      var k = _lnKey(r);
      var list = _lnPrevNotes[k] || (_lnPrevNotes[k] = []);
      if (list.length < 3) list.push({ week: r.week_date, note: r.update_note });
    });
  }

  _lnRows = rows.map(function(r){ return Object.assign({ _origCert: r.cert_status, _origDue: r.due_date }, r); });
  await _lnLoadCatalog();
  if (mySeq !== _lnSeq) return;
  _lnPaintEditor(emp, week, notice, offerFrom);
}

async function _lnCopyWeek(emp, fromWeek, toWeek) {
  var src = await sb.from('learning_entries').select('*').eq('employee', emp).eq('week_date', fromWeek);
  if (src.error || !src.data || !src.data.length) return { ok: false };
  var rows = src.data.map(function(r){
    var o = { employee: emp, week_date: toWeek, update_note: null };
    LN_COPY_FIELDS.forEach(function(f){ o[f] = r[f]; });
    return o;
  });
  // ignoreDuplicates: a second tab doing the same copy cannot double the rows.
  var ins = await sb.from('learning_entries')
    .upsert(rows, { onConflict: 'employee,week_date,vendor,technology', ignoreDuplicates: true });
  return { ok: !ins.error, error: ins.error };
}

async function learningCopyFrom(fromWeek) {
  if (!await requireAuth()) return;
  var emp = (isManager && _lnEditEmp) ? _lnEditEmp : currentUser;
  var r = await _lnCopyWeek(emp, fromWeek, _lnWeekNow());
  if (!r.ok) { showError('Could not copy that week' + (r.error ? ': ' + r.error.message : '.')); return; }
  showToast('Copied from the week ending ' + fmtDate(fromWeek) + ' ✓');
  renderLearningMine();
}

function _lnError(what) {
  return '<div class="alert alert-error show">' + _lnEsc(what) + '. Check your connection and try again.</div>';
}

function _lnStatusSelect(i, f, val, label) {
  return '<select class="ln-st ln-st-' + (val || 'none') + '" data-i="' + i + '" data-f="' + f + '" onchange="_lnOnInput(this)" aria-label="' + _lnEsc(label) + '">' +
    '<option value="">—</option>' +
    LN_STATUS.map(function(s){ return '<option value="' + s.k + '"' + (val === s.k ? ' selected' : '') + '>' + s.label + '</option>'; }).join('') +
  '</select>';
}
function _lnDateInput(i, f, val, label) {
  return '<input type="date" class="ln-date" data-i="' + i + '" data-f="' + f + '" value="' + _lnEsc(val || '') + '" onchange="_lnOnInput(this)" aria-label="' + _lnEsc(label) + '">';
}
function _lnText(i, f, val, label, ph, area) {
  return area
    ? '<textarea rows="2" data-i="' + i + '" data-f="' + f + '" oninput="_lnOnInput(this)" aria-label="' + _lnEsc(label) + '" placeholder="' + _lnEsc(ph || '') + '">' + _lnEsc(val || '') + '</textarea>'
    : '<input type="text" data-i="' + i + '" data-f="' + f + '" value="' + _lnEsc(val || '') + '" oninput="_lnOnInput(this)" aria-label="' + _lnEsc(label) + '" placeholder="' + _lnEsc(ph || '') + '">';
}

function _lnPaintEditor(emp, week, notice, offerFrom) {
  var host = document.getElementById('ln-mine-content');
  var mine = (emp === currentUser);
  var empPicker = isManager
    ? '<label class="ln-emp-pick">Employee <select id="ln-mine-emp" onchange="_lnPickEmployee(this.value)">' +
        _lnEmployees().map(function(n){ return '<option value="' + _lnEsc(n) + '"' + (n === emp ? ' selected' : '') + '>' + _lnEsc(n) + '</option>'; }).join('') +
      '</select></label>'
    : '';

  var body;
  if (!_lnRows.length) {
    body = '<div class="ln-empty">' +
      '<div class="ln-empty-title">' + (mine ? 'No products for this week yet' : 'No entries for ' + _lnEsc(emp) + ' this week') + '</div>' +
      '<div class="ln-empty-sub">' + (offerFrom
          ? 'Start from the week ending ' + fmtDate(offerFrom) + ', or add products below.'
          : 'Add the products ' + (mine ? 'you are' : 'they are') + ' learning below.') + '</div>' +
      (offerFrom ? '<button class="btn btn-primary" onclick="learningCopyFrom(\'' + offerFrom + '\')"><i data-lucide="copy" class="btn-icon"></i>Copy from ' + fmtDate(offerFrom) + '</button>' : '') +
    '</div>';
  } else {
    body = '<div class="ln-grid-wrap"><table class="ln-grid"><thead><tr>' +
      '<th>Product</th><th>Course</th><th>Certification</th><th>Hands-on</th><th>This week\'s update</th>' +
      '<th>Roadblocks</th><th>Due</th><th></th></tr></thead><tbody>' +
      _lnRows.map(function(r, i){
        return '<tr class="' + (r.is_blocked ? 'ln-row-blocked' : '') + '" data-pk="' + _lnEsc(_lnKey(r)) + '">' +
          '<td data-label="Product"><div class="ln-vendor">' + _lnEsc(r.vendor) + '</div><div class="ln-tech">' + _lnEsc(r.technology) + '</div>' +
            (r._new ? '<span class="ln-newtag">new</span>' : '') + '</td>' +
          '<td data-label="Course">' + _lnStatusSelect(i, 'course_status', r.course_status, 'Course status') + _lnDateInput(i, 'course_date', r.course_date, 'Course completion date') + '</td>' +
          '<td data-label="Certification">' + _lnStatusSelect(i, 'cert_status', r.cert_status, 'Certification status') + _lnDateInput(i, 'cert_date', r.cert_date, 'Certification date') + '</td>' +
          '<td data-label="Hands-on">' + _lnStatusSelect(i, 'hands_on_status', r.hands_on_status, 'Hands-on status') + '</td>' +
          '<td data-label="This week\'s update" class="ln-wide">' + _lnPrevHtml(_lnPrevNotes[_lnKey(r)]) + _lnText(i, 'update_note', r.update_note, 'This week\'s update', 'One point per line - what did you do this week?', true) + '</td>' +
          '<td data-label="Roadblocks" class="ln-block-cell">' + _lnRbHtml(i, r) + '</td>' +
          // v202: Next steps hidden for now (the column and its data stay).
          '<td data-label="Due">' + _lnDueHtml(i, r) + '</td>' +
          '<td class="ln-act">' + (r.remove_requested
            ? '<div class="ln-rm-req">Removal requested</div>' + (isManager
                ? '<button class="btn btn-sm btn-ghost" onclick="_lnRemoveRow(' + i + ')">Approve</button><button class="btn btn-sm btn-ghost" onclick="_lnKeepRow(' + i + ')">Keep</button>'
                : '<button class="btn btn-sm btn-ghost" onclick="_lnRemoveRow(' + i + ')">Withdraw</button>')
            : '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="_lnRemoveRow(' + i + ')" title="' + (isManager ? 'Remove this product from the week' : 'Ask your manager to remove this product') + '" aria-label="Remove ' + _lnEsc(r.technology) + '"><i data-lucide="trash-2"></i></button>') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  host.innerHTML =
    '<div class="card">' +
      '<div class="ln-ed-head">' +
        '<div><div class="card-title" style="margin-bottom:2px">' + (mine ? 'My Week' : _lnEsc(emp) + '’s week') + '</div>' +
        '<div class="ln-sub">' + _lnEsc(_lnWeekLabel(week)) + '</div></div><div class="ln-head-tools">' + _lnPickHtml('mine', _lnRows) + empPicker + '</div>' +
      '</div>' +
      (notice ? '<div class="ln-notice">' + _lnEsc(notice) + '</div>' : '') +
      body +
      _lnAddPanelHtml() +
      '<div class="ln-savebar">' +
        '<span id="ln-dirty-hint" class="ln-dirty-hint"></span>' +
        '<button class="btn btn-primary" id="ln-save-btn" onclick="saveLearningWeek()" disabled><i data-lucide="save" class="btn-icon"></i>Save changes</button>' +
      '</div>' +
    '</div>';
  _lnUpdateSaveBar();
  _lnApplyPick('mine');
  if (typeof renderIcons === 'function') renderIcons();
}

async function _lnPickEmployee(name) {
  if (!(await _lnCanLeave())) { var s = document.getElementById('ln-mine-emp'); if (s) s.value = _lnEditEmp || currentUser; return; }
  _lnRows = [];
  _lnEditEmp = name;
  renderLearningMine();
}

function _lnOnInput(el) {
  var i = Number(el.getAttribute('data-i')), f = el.getAttribute('data-f');
  var r = _lnRows[i];
  if (!r) return;
  var v = (el.type === 'checkbox') ? el.checked : (el.value === '' ? null : el.value);
  if (typeof v === 'string' && el.tagName !== 'SELECT' && el.type !== 'date') v = v.length ? v : null;
  r[f] = v;
  r._dirty = true;
  if (el.tagName === 'SELECT') el.className = 'ln-st ln-st-' + (v || 'none');
  _lnUpdateSaveBar();
}

// == ROADBLOCKS (v202): a list of rows, one roadblock each - no tick box ==
// Stored as lines of blocker_note; is_blocked is simply "has at least one".
function _lnRbLines(r) {
  return r.is_blocked ? String(r.blocker_note || '').split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean) : [];
}
function _lnRbRow(i, val) {
  return '<div class="ln-rb-row"><input type="text" data-rbi="' + i + '" value="' + _lnEsc(val || '') + '" oninput="_lnRbSync(' + i + ')" placeholder="What is blocking?" aria-label="Roadblock">' +
    '<button type="button" class="btn btn-sm btn-ghost btn-icon-only" onclick="_lnRbRemove(this,' + i + ')" title="Remove this roadblock" aria-label="Remove this roadblock"><i data-lucide="x"></i></button></div>';
}
function _lnRbHtml(i, r) {
  return '<div class="ln-rb-list" id="ln-rb-' + i + '">' + _lnRbLines(r).map(function(l){ return _lnRbRow(i, l); }).join('') + '</div>' +
    '<button type="button" class="btn btn-sm btn-ghost ln-rb-add" onclick="_lnRbAdd(' + i + ')"><i data-lucide="plus" class="btn-icon"></i>Add roadblock</button>';
}
function _lnRbAdd(i) {
  var list = document.getElementById('ln-rb-' + i);
  if (!list) return;
  list.insertAdjacentHTML('beforeend', _lnRbRow(i, ''));
  if (typeof renderIcons === 'function') renderIcons();
  var inputs = list.querySelectorAll('input'); inputs[inputs.length - 1].focus();
}
function _lnRbRemove(btn, i) {
  var row = btn.closest('.ln-rb-row'); if (row) row.remove();
  _lnRbSync(i);
}
function _lnRbSync(i) {
  var r = _lnRows[i], list = document.getElementById('ln-rb-' + i);
  if (!r || !list) return;
  var lines = Array.prototype.map.call(list.querySelectorAll('input'), function(x){ return x.value.trim(); }).filter(Boolean);
  var note = lines.length ? lines.join('\n') : null;
  if (note === (r.is_blocked ? (r.blocker_note || null) : null)) return;
  r.blocker_note = note;
  r.is_blocked = !!note;
  r._dirty = true;
  var tr = list.closest('tr'); if (tr) tr.classList.toggle('ln-row-blocked', r.is_blocked);
  _lnUpdateSaveBar();
}

// == DUE DATE (v202): fixed once saved; changing it needs a manager ==
// Employees ask for a new date (due_date_pending); a manager approves or
// rejects it. The database enforces the lock too (_learning_entries_due_guard).
function _lnDueHtml(i, r) {
  if (!r._origDue) return _lnDateInput(i, 'due_date', r.due_date, 'Due date');
  var pend = r.due_date_pending;
  if (isManager) {
    return _lnDateInput(i, 'due_date', r.due_date, 'Due date') +
      (pend ? '<div class="ln-due-req">Asked for ' + fmtDate(pend) +
        '<div class="ln-due-btns"><button type="button" class="btn btn-sm btn-primary" onclick="_lnDueDecideInEditor(' + i + ',true)">Approve</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="_lnDueDecideInEditor(' + i + ',false)">Reject</button></div></div>' : '');
  }
  return '<div class="ln-due-locked" title="Set once - a manager approves any change"><i data-lucide="lock"></i>' + fmtDate(r.due_date) + '</div>' +
    '<label class="ln-due-ask">' + (pend ? 'Change requested - waiting for manager' : 'Ask to change to') +
      '<input type="date" class="ln-date" data-i="' + i + '" data-f="due_date_pending" value="' + _lnEsc(pend || '') + '" onchange="_lnOnInput(this)" aria-label="Ask to change the due date to"></label>';
}
function _lnDueDecideInEditor(i, approve) {
  var r = _lnRows[i]; if (!r || !r.due_date_pending) return;
  if (approve) r.due_date = r.due_date_pending;
  r.due_date_pending = null;
  r._dirty = true;
  _lnRepaint();
  _lnUpdateSaveBar();
}
// From Team Week: approve / reject straight away.
async function learningDueDecision(id, approve) {
  if (!await requireAuth()) return;
  var row = (_lnTeamRows || []).filter(function(r){ return r.id === id; })[0];
  if (!row || !row.due_date_pending) return;
  var patch = approve ? { due_date: row.due_date_pending, due_date_pending: null } : { due_date_pending: null };
  var u = await sb.from('learning_entries').update(patch).eq('id', id).select('id');
  if (u.error || !u.data || !u.data.length) { showError('Could not update the due date' + (u.error ? ': ' + u.error.message : '.')); return; }
  showToast(approve ? 'New due date approved ✓' : 'Due date request rejected ✓');
  renderLearningTeam();
}

function _lnUpdateSaveBar() {
  var n = _lnDirtyCount();
  var btn = document.getElementById('ln-save-btn');
  var hint = document.getElementById('ln-dirty-hint');
  if (btn) btn.disabled = !n || _lnSaving;
  if (hint) hint.textContent = n ? (n + ' product' + (n === 1 ? '' : 's') + ' changed — not saved yet') : '';
}

async function _lnRemoveRow(i) {
  var r = _lnRows[i];
  if (!r) return;
  if (r._new) { _lnRows.splice(i, 1); _lnRepaint(); return; }
  if (!isManager) {
    // v202: employees cannot delete - they ask, and a manager approves.
    var want = !r.remove_requested;
    if (want && !await confirmAction({
      title: 'Ask to remove ' + r.technology + '?',
      body: 'Your manager has to approve it. Until then it stays in your week.',
      confirmText: 'Ask manager'
    })) return;
    if (!await requireAuth()) return;
    var rq = await sb.from('learning_entries').update({ remove_requested: want }).eq('id', r.id).select('id');
    if (rq.error || !rq.data || !rq.data.length) { showError('Could not send the request' + (rq.error ? ': ' + rq.error.message : '.')); return; }
    r.remove_requested = want;
    showToast(want ? 'Removal sent to your manager for approval ✓' : 'Removal request withdrawn ✓');
    _lnRepaint();
    return;
  }
  var ok = await confirmAction({
    title: 'Remove ' + r.technology + ' from this week?',
    body: 'It is removed from the week ending ' + fmtDate(r.week_date) + ' only. Earlier weeks keep their entries.',
    confirmText: 'Remove', danger: true
  });
  if (!ok || !await requireAuth()) return;
  var del = await sb.from('learning_entries').delete().eq('id', r.id).select('id');
  if (del.error || !del.data || !del.data.length) { showError('Could not remove it' + (del.error ? ': ' + del.error.message : '.')); return; }
  _lnRows.splice(i, 1);
  showToast('Removed ✓');
  _lnRepaint();
}

// Manager keeps a product an employee asked to remove.
async function _lnKeepRow(i) {
  var r = _lnRows[i]; if (!r || !await requireAuth()) return;
  var u = await sb.from('learning_entries').update({ remove_requested: false }).eq('id', r.id).select('id');
  if (u.error || !u.data || !u.data.length) { showError('Could not update it' + (u.error ? ': ' + u.error.message : '.')); return; }
  r.remove_requested = false;
  showToast('Kept ✓');
  _lnRepaint();
}
// From Team Week: remove (approve) or keep.
async function learningRemoveDecision(id, approve) {
  if (!await requireAuth()) return;
  var q = approve ? sb.from('learning_entries').delete().eq('id', id).select('id')
                  : sb.from('learning_entries').update({ remove_requested: false }).eq('id', id).select('id');
  var u = await q;
  if (u.error || !u.data || !u.data.length) { showError('Could not update it' + (u.error ? ': ' + u.error.message : '.')); return; }
  showToast(approve ? 'Removed ✓' : 'Kept ✓');
  renderLearningTeam();
}

function _lnRepaint() {
  var emp = (isManager && _lnEditEmp) ? _lnEditEmp : currentUser;
  _lnPaintEditor(emp, _lnWeekNow(), '', null);
}

// -- add a product --
function _lnAddPanelHtml() {
  var cat = _lnCatalog || [];
  return '<div class="ln-add">' +
    '<div class="ln-add-title">Add a product</div>' +
    '<div class="ln-add-row">' +
      '<select id="ln-add-vendor" onchange="_lnAddVendorChanged()" aria-label="Vendor">' +
        '<option value="">Vendor…</option>' +
        cat.map(function(v, i){ return '<option value="' + i + '">' + _lnEsc(v.vendor) + '</option>'; }).join('') +
        '<option value="__other">Other vendor…</option>' +
      '</select>' +
      '<input type="text" id="ln-add-vendor-other" placeholder="Vendor name" aria-label="Vendor name" maxlength="60" style="display:none">' +
      '<select id="ln-add-tech" onchange="_lnAddTechChanged()" aria-label="Technology" disabled><option value="">Technology / solution…</option></select>' +
      '<input type="text" id="ln-add-tech-other" placeholder="Technology / solution" aria-label="Technology or solution" maxlength="80" style="display:none">' +
      '<button class="btn btn-ghost" onclick="_lnAddProduct()"><i data-lucide="plus" class="btn-icon"></i>Add</button>' +
    '</div>' +
  '</div>';
}

function _lnAddVendorChanged() {
  var vSel = document.getElementById('ln-add-vendor'), tSel = document.getElementById('ln-add-tech');
  var vOther = document.getElementById('ln-add-vendor-other'), tOther = document.getElementById('ln-add-tech-other');
  var val = vSel.value;
  vOther.style.display = (val === '__other') ? '' : 'none';
  if (val === '__other') {
    tSel.style.display = 'none'; tSel.disabled = true; tOther.style.display = ''; vOther.focus();
    return;
  }
  tSel.style.display = ''; tOther.style.display = 'none';
  if (val === '') { tSel.disabled = true; tSel.innerHTML = '<option value="">Technology / solution…</option>'; return; }
  var v = _lnCatalog[Number(val)];
  tSel.disabled = false;
  tSel.innerHTML = '<option value="">Technology / solution…</option>' +
    v.lines.map(function(l){ return '<option value="' + l.id + '">' + _lnEsc(l.name) + '</option>'; }).join('') +
    '<option value="__other">Other…</option>';
}
function _lnAddTechChanged() {
  var tSel = document.getElementById('ln-add-tech'), tOther = document.getElementById('ln-add-tech-other');
  tOther.style.display = (tSel.value === '__other') ? '' : 'none';
  if (tSel.value === '__other') tOther.focus();
}

function _lnAddProduct() {
  var vSel = document.getElementById('ln-add-vendor'), tSel = document.getElementById('ln-add-tech');
  var vendor, technology, lineId = null;
  if (vSel.value === '') { showError('Pick a vendor.'); return; }
  if (vSel.value === '__other') {
    vendor = (document.getElementById('ln-add-vendor-other').value || '').trim();
    technology = (document.getElementById('ln-add-tech-other').value || '').trim();
  } else {
    var v = _lnCatalog[Number(vSel.value)];
    vendor = v.vendor;
    if (tSel.value === '__other') technology = (document.getElementById('ln-add-tech-other').value || '').trim();
    else if (tSel.value) {
      var line = v.lines.filter(function(l){ return String(l.id) === tSel.value; })[0];
      technology = line ? line.name : '';
      lineId = line ? line.id : null;
    }
  }
  if (!vendor) { showError('Type the vendor name.'); return; }
  if (!technology) { showError('Pick or type the technology / solution.'); return; }
  var key = _lnKey({ vendor: vendor, technology: technology });
  if (_lnRows.some(function(r){ return _lnKey(r) === key; })) { showError(technology + ' is already in this week.'); return; }
  var emp = (isManager && _lnEditEmp) ? _lnEditEmp : currentUser;
  _lnRows.push({ _new: true, employee: emp, week_date: _lnWeekNow(), vendor: vendor, technology: technology,
                 product_line_id: lineId, course_status: null, cert_status: null, hands_on_status: null,
                 is_blocked: false, _origCert: null });
  _lnRepaint();
}

// -- save --
async function saveLearningWeek() {
  if (_lnSaving) return;
  var changed = _lnRows.filter(function(r){ return r._dirty || r._new; });
  if (!changed.length) return;
  var missing = changed.filter(function(r){ return r.is_blocked && !(r.blocker_note || '').trim(); })[0];
  if (missing) { showError('Say what is blocking ' + missing.technology + ', or untick Blocked.'); return; }
  _lnSaving = true;
  _lnUpdateSaveBar();
  var btn = document.getElementById('ln-save-btn');
  if (btn) btn.textContent = 'Saving...';
  var failed = 0, firstErr = '';
  try {
    if (!await requireAuth()) { failed = changed.length; return; }
    var fields = ['course_status', 'course_date', 'cert_status', 'cert_date', 'hands_on_status', 'update_note',
                  'is_blocked', 'blocker_note', 'next_steps', 'due_date', 'due_date_pending'];
    var newRows = changed.filter(function(r){ return r._new; });
    if (newRows.length) {
      var payload = newRows.map(function(r){
        var o = { employee: r.employee, week_date: r.week_date, vendor: r.vendor, technology: r.technology, product_line_id: r.product_line_id };
        fields.forEach(function(f){ o[f] = (f === 'is_blocked') ? !!r[f] : (r[f] == null ? null : r[f]); });
        if (!o.is_blocked) o.blocker_note = null;
        return o;
      });
      var ins = await sb.from('learning_entries').insert(payload).select('*');
      if (ins.error) { failed += newRows.length; firstErr = ins.error.message; }
      else newRows.forEach(function(r, k){ Object.assign(r, ins.data[k] || {}); r._new = false; r._dirty = false; });
    }
    var upd = changed.filter(function(r){ return !r._new && r._dirty; });
    for (var k = 0; k < upd.length; k++) {
      var r = upd[k], patch = {};
      fields.forEach(function(f){ patch[f] = (f === 'is_blocked') ? !!r[f] : (r[f] == null ? null : r[f]); });
      if (!patch.is_blocked) patch.blocker_note = null;
      var u = await sb.from('learning_entries').update(patch).eq('id', r.id).select('id');
      if (u.error || !u.data || !u.data.length) { failed++; if (!firstErr) firstErr = u.error ? u.error.message : 'not saved'; }
      else r._dirty = false;
    }
  } finally {
    _lnSaving = false;
    if (btn) btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save changes';
    if (typeof renderIcons === 'function') renderIcons();
    _lnUpdateSaveBar();
  }
  if (failed) { showError(failed + ' product' + (failed === 1 ? ' was' : 's were') + ' not saved' + (firstErr ? ': ' + firstErr : '.') + ' Your edits are still on screen; try Save again.'); return; }
  // v202: a due date that is now saved becomes locked for the employee.
  _lnRows.forEach(function(r){ r._origDue = r.due_date; });
  _lnRepaint();
  showToast('Week saved ✓');

  // Newly completed certifications: offer to put the certificate on the
  // Certificates page too (it needs the file and dates, so it is not automatic).
  var emp = (isManager && _lnEditEmp) ? _lnEditEmp : currentUser;
  var newlyCert = _lnRows.filter(function(r){ return r.cert_status === 'completed' && r._origCert !== 'completed'; });
  _lnRows.forEach(function(r){ r._origCert = r.cert_status; });
  _lnRepaint();
  if (newlyCert.length && emp === currentUser && typeof openCertUploadModal === 'function') {
    var go = await confirmAction({
      title: 'Certification completed',
      body: 'Well done on ' + newlyCert.map(function(r){ return r.technology; }).join(', ') +
            '. Upload the certificate so it also appears on the Certificates page?',
      confirmText: 'Upload now'
    });
    if (go) {
      navigateSub('certificates', 'mine');
      openCertUploadModal();
      var nm = document.getElementById('cert-up-name');
      if (nm) nm.value = newlyCert[0].vendor + ' ' + newlyCert[0].technology;
      var iss = document.getElementById('cert-up-issue');
      if (iss && newlyCert[0].cert_date) iss.value = newlyCert[0].cert_date;
    }
  }
}

function learningEditFor(emp) {
  _lnEditEmp = emp;
  _lnRows = [];
  navigateSub('learning', 'mine');
}

// == TEAM WEEK (managers) ==
async function renderLearningTeam() {
  var host = document.getElementById('ln-team-content');
  if (!host || !isManager) return;
  var mySeq = ++_lnSeq;
  var week = _lnWeekNow();
  // Read the filters BEFORE the spinner replaces the controls, or every
  // change would reset them.
  var fEmp = (document.getElementById('ln-team-emp') || {}).value || '';
  var fVendor = (document.getElementById('ln-team-vendor') || {}).value || '';
  var fBlocked = !!(document.getElementById('ln-team-blocked') || {}).checked;
  host.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
  var res = await fetchAllRows(function(){
    return sb.from('learning_entries').select('*').eq('week_date', week).order('employee').order('vendor').order('technology');
  });
  if (mySeq !== _lnSeq) return;
  if (res.error) { host.innerHTML = _lnError('Could not load the team week'); return; }
  var rows = res.data || [];
  _lnTeamRows = rows;
  // v204: last week's update, shown in its own column beside this week's.
  var lastWeek = _lnAddDays(week, -7);
  var earlier = await fetchAllRows(function(){
    return sb.from('learning_entries').select('employee,vendor,technology,update_note').eq('week_date', lastWeek);
  });
  if (mySeq !== _lnSeq) return;
  var teamPrev = {};
  (earlier.data || []).forEach(function(r){ if (r.update_note) teamPrev[r.employee + '|' + _lnKey(r)] = r.update_note; });
  var vendors = {};
  rows.forEach(function(r){ vendors[r.vendor] = 1; });
  var shown = rows.filter(function(r){
    return (!fEmp || r.employee === fEmp) && (!fVendor || r.vendor === fVendor) && (!fBlocked || r.is_blocked);
  });

  var people = _lnEmployees();
  var updated = people.filter(function(p){ return rows.some(function(r){ return r.employee === p; }); });
  var blocked = rows.filter(function(r){ return r.is_blocked; });
  var certDone = rows.filter(function(r){ return r.cert_status === 'completed'; }).length;

  var stat = function(label, value, cls) {
    return '<div class="stat-card ' + (cls || '') + '"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div></div>';
  };
  var filters =
    '<div class="ln-filters">' +
      '<select id="ln-team-emp" onchange="renderLearningTeam()" aria-label="Employee"><option value="">All employees</option>' +
        people.map(function(p){ return '<option value="' + _lnEsc(p) + '"' + (p === fEmp ? ' selected' : '') + '>' + _lnEsc(p) + '</option>'; }).join('') + '</select>' +
      '<select id="ln-team-vendor" onchange="renderLearningTeam()" aria-label="Vendor"><option value="">All vendors</option>' +
        Object.keys(vendors).sort().map(function(v){ return '<option value="' + _lnEsc(v) + '"' + (v === fVendor ? ' selected' : '') + '>' + _lnEsc(v) + '</option>'; }).join('') + '</select>' +
      _lnPickHtml('team', rows) +
      '<label class="ln-check"><input type="checkbox" id="ln-team-blocked" onchange="renderLearningTeam()"' + (fBlocked ? ' checked' : '') + '> Roadblocks only</label>' +
    '</div>';

  // v202: requests waiting for a manager - due date changes and removals.
  var reqs = rows.filter(function(r){ return r.due_date_pending || r.remove_requested; });
  var requests = reqs.length
    ? '<div class="ln-requests"><div class="ln-rb-title">Waiting for your approval (' + reqs.length + ')</div>' +
        reqs.map(function(r){
          var what = r.remove_requested ? 'Remove from the week'
                   : 'Due date ' + (r.due_date ? fmtDate(r.due_date) : '(none)') + ' \u2192 ' + fmtDate(r.due_date_pending);
          var fn = r.remove_requested ? 'learningRemoveDecision' : 'learningDueDecision';
          return '<div class="ln-req-row"><div><strong>' + _lnEsc(r.employee) + '</strong> \u00b7 ' + _lnEsc(r.vendor) + ' ' + _lnEsc(r.technology) +
                 '<div class="ln-rb-note">' + _lnEsc(what) + '</div></div>' +
                 '<div class="ln-due-btns"><button class="btn btn-sm btn-primary" onclick="' + fn + '(' + Number(r.id) + ',true)">Approve</button>' +
                 '<button class="btn btn-sm btn-ghost" onclick="' + fn + '(' + Number(r.id) + ',false)">' + (r.remove_requested ? 'Keep' : 'Reject') + '</button></div></div>';
        }).join('') + '</div>'
    : '';

  // v204: no separate roadblock banner - blocked rows are red and list their roadblocks.
  var roadblocks = requests;

  var groups = people.filter(function(p){ return !fEmp || p === fEmp; }).map(function(p){
    var mine = shown.filter(function(r){ return r.employee === p; });
    var hasAny = rows.some(function(r){ return r.employee === p; });
    if (!mine.length && hasAny) return '';          // filtered out by vendor / roadblocks
    if (!mine.length && (fVendor || fBlocked)) return '';
    return '<div class="ln-group">' +
      '<div class="ln-group-head"><div class="ln-group-name">' + _lnEsc(p) + '</div>' +
        '<button class="btn btn-sm btn-ghost" data-emp="' + _lnEsc(p) + '" onclick="learningEditFor(this.getAttribute(\'data-emp\'))"><i data-lucide="pencil" class="btn-icon"></i>' + (hasAny ? 'Edit' : 'Add entries') + '</button></div>' +
      (mine.length
        ? '<div class="ln-grid-wrap"><table class="ln-view"><thead><tr><th>Product</th><th>Course</th><th>Certification</th><th>Hands-on</th><th>Last week (' + _lnEsc(fmtDate(lastWeek)) + ')</th><th>This week\'s update</th><th>Due</th></tr></thead><tbody>' +
            mine.map(function(r){
              return '<tr class="' + (r.is_blocked ? 'ln-row-blocked' : '') + '" data-pk="' + _lnEsc(_lnKey(r)) + '">' +
                '<td data-label="Product"><div class="ln-vendor">' + _lnEsc(r.vendor) + '</div><div class="ln-tech">' + _lnEsc(r.technology) + '</div>' +
                  (r.is_blocked ? '<div class="ln-blocked-tag">Blocked' + _lnPoints(r.blocker_note) + '</div>' : '') + '</td>' +
                '<td data-label="Course"' + (r.course_date ? ' title="Completed ' + fmtDate(r.course_date) + '"' : '') + '>' + _lnPill(r.course_status) + '</td>' +
                '<td data-label="Certification"' + (r.cert_date ? ' title="Completed ' + fmtDate(r.cert_date) + '"' : '') + '>' + _lnPill(r.cert_status) + '</td>' +
                '<td data-label="Hands-on">' + _lnPill(r.hands_on_status) + '</td>' +
                '<td data-label="Last week" class="ln-wide ln-lastcol">' + (teamPrev[r.employee + '|' + _lnKey(r)] ? _lnPoints(teamPrev[r.employee + '|' + _lnKey(r)]) : '<span class="ln-dim">—</span>') + '</td>' +
                '<td data-label="This week\'s update" class="ln-wide">' + (r.update_note ? _lnPoints(r.update_note) : '<span class="ln-dim">—</span>') + '</td>' +
                '<td data-label="Due">' + (r.due_date ? fmtDate(r.due_date) : '<span class="ln-dim">—</span>') + '</td>' +
              '</tr>';
            }).join('') + '</tbody></table></div>'
        : '<div class="ln-none">No entries for this week.</div>') +
    '</div>';
  }).join('');

  host.innerHTML =
    '<div class="summary-grid ln-stats">' +
      stat('Updated this week', updated.length + ' / ' + people.length, 'teal') +
      stat('Products tracked', rows.length, 'navy') +
      stat('Certifications done', certDone, 'early') +
      stat('Roadblocks', blocked.length, blocked.length ? 'wknd' : '') +
    '</div>' +
    '<div class="card">' + filters + roadblocks + (groups || '<div class="ln-none">Nothing matches these filters.</div>') + '</div>';
  _lnApplyPick('team');
  if (typeof renderIcons === 'function') renderIcons();
}

// == COMPARE (managers): each person vs their own previous week ==
function _lnCompare(now, prev) {
  var prevBy = {}, nowBy = {};
  prev.forEach(function(r){ prevBy[_lnKey(r)] = r; });
  now.forEach(function(r){ nowBy[_lnKey(r)] = r; });
  var out = { items: [], removed: [], up: 0, down: 0, same: 0, added: 0, completed: [], rbNew: 0, rbCleared: 0, rbOngoing: 0, notes: 0 };
  now.forEach(function(r){
    var p = prevBy[_lnKey(r)];
    var item = { r: r, p: p || null, moves: {}, dir: 'new' };
    if (r.update_note) out.notes++;
    if (!p) { out.added++; }
    else {
      var anyUp = false, anyDown = false;
      LN_AREAS.forEach(function(a){
        var d = _lnRank(r[a.f]) - _lnRank(p[a.f]);
        item.moves[a.f] = d;
        if (d > 0) { anyUp = true; if (r[a.f] === 'completed') out.completed.push(r.technology + ' ' + a.label.toLowerCase()); }
        if (d < 0) anyDown = true;
      });
      item.dir = anyUp ? 'up' : anyDown ? 'down' : 'same';
      out[item.dir]++;
      if (r.is_blocked && !p.is_blocked) out.rbNew++;
      else if (!r.is_blocked && p.is_blocked) out.rbCleared++;
      else if (r.is_blocked && p.is_blocked) out.rbOngoing++;
    }
    if (!p && r.is_blocked) out.rbNew++;
    out.items.push(item);
  });
  prev.forEach(function(r){ if (!nowBy[_lnKey(r)]) out.removed.push(r); });
  var order = { up: 0, down: 1, 'new': 2, same: 3 };
  out.items.sort(function(a, b){ return order[a.dir] - order[b.dir]; });
  return out;
}

function _lnCmpCell(prevV, nowV, hasPrev) {
  if (!hasPrev) return _lnPill(nowV);
  var d = _lnRank(nowV) - _lnRank(prevV);
  if (!d) return _lnPill(nowV, true);
  return '<span class="ln-move ln-move-' + (d > 0 ? 'up' : 'down') + '">' + _lnPill(prevV) +
         ' <span class="ln-arrow" aria-label="changed to">→</span> ' + _lnPill(nowV) + '</span>';
}

async function renderLearningCompare() {
  var host = document.getElementById('ln-compare-content');
  if (!host || !isManager) return;
  var mySeq = ++_lnSeq;
  var week = _lnWeekNow(), prevWeek = _lnAddDays(week, -7);
  var fEmp = (document.getElementById('ln-cmp-emp') || {}).value || '';   // read before the spinner
  host.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
  var res = await fetchAllRows(function(){
    return sb.from('learning_entries').select('*').in('week_date', [week, prevWeek]).order('employee').order('vendor').order('technology');
  });
  if (mySeq !== _lnSeq) return;
  if (res.error) { host.innerHTML = _lnError('Could not load the comparison'); return; }
  var rows = res.data || [];
  var people = _lnEmployees();

  var cards = people.filter(function(p){ return !fEmp || p === fEmp; }).map(function(p){
    var now = rows.filter(function(r){ return r.employee === p && r.week_date === week; });
    var prev = rows.filter(function(r){ return r.employee === p && r.week_date === prevWeek; });
    var head = '<div class="ln-group-head"><div class="ln-group-name">' + _lnEsc(p) + '</div></div>';
    if (!now.length) {
      return '<div class="ln-group ln-cmp-card">' + head +
        '<div class="ln-none">No update for the week ending ' + fmtDate(week) + (prev.length ? ' (had ' + prev.length + ' product' + (prev.length === 1 ? '' : 's') + ' the week before).' : '.') + '</div></div>';
    }
    var c = _lnCompare(now, prev);
    var chips = [];
    if (!prev.length) chips.push('<span class="ln-chip">No entries the week before — everything shows as new</span>');
    else {
      chips.push('<span class="ln-chip ln-chip-up">' + c.up + ' moved forward</span>');
      chips.push('<span class="ln-chip">' + c.same + ' no change</span>');
      if (c.down) chips.push('<span class="ln-chip ln-chip-down">' + c.down + ' went back</span>');
      if (c.added) chips.push('<span class="ln-chip">' + c.added + ' new</span>');
      if (c.removed.length) chips.push('<span class="ln-chip">' + c.removed.length + ' removed</span>');
    }
    if (c.rbNew) chips.push('<span class="ln-chip ln-chip-down">' + c.rbNew + ' new roadblock' + (c.rbNew === 1 ? '' : 's') + '</span>');
    if (c.rbCleared) chips.push('<span class="ln-chip ln-chip-up">' + c.rbCleared + ' roadblock' + (c.rbCleared === 1 ? '' : 's') + ' cleared</span>');
    if (c.rbOngoing) chips.push('<span class="ln-chip ln-chip-warn">' + c.rbOngoing + ' still blocked</span>');
    var quiet = prev.length && !c.up && !c.down && !c.added && !c.notes && !c.rbNew && !c.rbCleared;
    return '<div class="ln-group ln-cmp-card">' + head +
      '<div class="ln-chips">' + chips.join('') + '</div>' +
      (c.completed.length ? '<div class="ln-completed">Completed this week: ' + _lnEsc(c.completed.join(', ')) + '</div>' : '') +
      (quiet ? '<div class="ln-quiet">Nothing changed since last week and no update was written.</div>' : '') +
      '<div class="ln-grid-wrap"><table class="ln-view"><thead><tr><th>Product</th><th>Course</th><th>Certification</th><th>Hands-on</th><th>Roadblock</th><th>This week\'s update</th></tr></thead><tbody>' +
        c.items.map(function(it){
          var r = it.r, pr = it.p;
          var rb = r.is_blocked
            ? '<span class="ln-blocked-tag">' + (pr && pr.is_blocked ? 'Still blocked' : 'Blocked') + (r.blocker_note ? ': ' + _lnEsc(r.blocker_note) : '') + '</span>'
            : (pr && pr.is_blocked ? '<span class="ln-cleared">Cleared</span>' : '<span class="ln-dim">—</span>');
          return '<tr class="ln-dir-' + it.dir + '">' +
            '<td data-label="Product"><div class="ln-vendor">' + _lnEsc(r.vendor) + '</div><div class="ln-tech">' + _lnEsc(r.technology) + '</div>' +
              (it.dir === 'new' && prev.length ? '<span class="ln-newtag">new</span>' : '') + '</td>' +
            LN_AREAS.map(function(a){ return '<td data-label="' + a.label + '">' + _lnCmpCell(pr ? pr[a.f] : null, r[a.f], !!pr) + '</td>'; }).join('') +
            '<td data-label="Roadblock">' + rb + '</td>' +
            '<td data-label="This week\'s update" class="ln-wide">' + _lnPrevHtml(pr && pr.update_note ? [{ week: prevWeek, note: pr.update_note }] : null) + (r.update_note ? _lnPoints(r.update_note) : '<span class="ln-dim">No update yet this week</span>') + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
      (c.removed.length ? '<div class="ln-small" style="margin-top:6px">Removed since last week: ' + _lnEsc(c.removed.map(function(r){ return r.vendor + ' ' + r.technology; }).join(', ')) + '</div>' : '') +
    '</div>';
  }).join('');

  host.innerHTML =
    '<div class="card">' +
      '<div class="ln-filters">' +
        '<select id="ln-cmp-emp" onchange="renderLearningCompare()" aria-label="Employee"><option value="">All employees</option>' +
          people.map(function(p){ return '<option value="' + _lnEsc(p) + '"' + (p === fEmp ? ' selected' : '') + '>' + _lnEsc(p) + '</option>'; }).join('') + '</select>' +
        '<span class="ln-sub">Each person is compared with their own entries for the week ending ' + fmtDate(prevWeek) + ' — not with each other.</span>' +
      '</div>' +
      cards +
    '</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function resetLearningState() {
  _lnTab = 'mine'; _lnWeek = null; _lnEditEmp = null; _lnRows = []; _lnCatalog = null; _lnTeamRows = []; _lnSeq++;
}
