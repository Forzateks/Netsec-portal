// == TEAM SKILLS ====================================================
// Manager-only register of each employee's proficiency on product_lines.
// RLS exposes the table only when is_manager_user() is true, so a
// non-manager direct fetch returns zero rows. The sidebar entry sits
// inside #sidebar-manager-group which is hidden for non-managers.
//
// Storage shape (employee_skills):
//   employee_name + product_line_id (UNIQUE)
//   level: 'beginner' | 'intermediate' | 'expert'
//   optional last_used_year + last_used_month (paired or both null)
//   optional notes
//
// product_line_id is an FK with ON DELETE RESTRICT — that backs the
// product-line delete protection in projects.js (defense in depth).

var SKILLS = [];              // [{id, employee_name, product_line_id, level, ...}]
var _skEditing = null;        // null = add, {id, ...} = edit

var SKILL_LEVEL_META = {
  beginner:     { label:'Beginner',     shortLabel:'B', cls:'sk-pill-beginner' },
  intermediate: { label:'Intermediate', shortLabel:'I', cls:'sk-pill-intermediate' },
  expert:       { label:'Expert',       shortLabel:'E', cls:'sk-pill-expert' }
};
var SKILL_LEVEL_RANK = { beginner:1, intermediate:2, expert:3 };

// ── LOAD ──────────────────────────────────────────────────────────
async function loadSkills() {
  var content = document.getElementById('sk-content');
  var loadEl = document.getElementById('sk-load');
  // Sidebar is hidden for non-managers, but a direct URL or stale tab
  // can still land them on this screen. RLS returns zero rows server-
  // side; surface a friendly "not authorized" state so the page isn't
  // a confusing blank.
  if (!isManager) {
    if (loadEl) loadEl.style.display = 'none';
    if (content) content.innerHTML = renderEmptyState({
      icon: 'lock',
      heading: 'Not authorized',
      sub: 'Team Skills is a manager-only register. Contact your manager if you need access.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  if (loadEl) loadEl.style.display = 'flex';
  var res = await sb.from('employee_skills').select('*').order('employee_name').order('product_line_id');
  if (loadEl) loadEl.style.display = 'none';
  if (res.error) { showError('Could not load skills: '+res.error.message); return; }
  SKILLS = res.data || [];
  // Lazy-load vendor + product line caches if the user hasn't visited
  // Vendors & Products yet — the matrix needs PRODUCT_LINES + VENDORS.
  if (!Array.isArray(window.PRODUCT_LINES) || !window.PRODUCT_LINES.length ||
      !Array.isArray(window.VENDORS)       || !window.VENDORS.length) {
    if (typeof loadProjects === 'function') await loadProjects();
  }
  _skPopulateVendorFilter();
  renderSkillsMatrix();
}

function _skPopulateVendorFilter() {
  var sel = document.getElementById('sk-filter-vendor');
  if (!sel) return;
  var prev = sel.value;
  var vendors = (VENDORS||[]).slice().sort(function(a,b){ return (a.display_order||0) - (b.display_order||0) || a.name.localeCompare(b.name); });
  sel.innerHTML = '<option value="">All Vendors</option>' +
    vendors.map(function(v){ return '<option value="'+v.id+'">'+esc2(v.name)+'</option>'; }).join('');
  if (prev) sel.value = prev;
}

function clearSkillFilters() {
  ['sk-search','sk-filter-vendor'].forEach(function(id){ var el=document.getElementById(id); if (el) el.value=''; });
  var empty = document.getElementById('sk-show-empty'); if (empty) empty.checked = false;
  renderSkillsMatrix();
}

// ── HELPERS ───────────────────────────────────────────────────────
function _skVendorFor(line) {
  if (!line) return null;
  return (VENDORS||[]).find(function(v){ return v.id === line.vendor_id; }) || null;
}

function _skFmtLastUsed(skill) {
  if (!skill || !skill.last_used_year || !skill.last_used_month) return '';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[skill.last_used_month-1] + ' ' + skill.last_used_year;
}

function _skPillLabel(level, shortForm) {
  var meta = SKILL_LEVEL_META[level] || { label:level||'—', shortLabel:'?' , cls:'sk-pill-beginner' };
  return shortForm ? meta.shortLabel : meta.label;
}

function _skPillHtml(skill, shortForm) {
  var meta = SKILL_LEVEL_META[skill.level] || { label:skill.level||'?', cls:'sk-pill-beginner' };
  var label = shortForm ? meta.shortLabel : meta.label;
  var tipParts = [];
  var last = _skFmtLastUsed(skill);
  if (last) tipParts.push('Last used ' + last);
  if (skill.notes) tipParts.push(skill.notes);
  var title = tipParts.length ? ' title="' + esc2(tipParts.join(' — ')) + '"' : '';
  return '<span class="sk-pill '+meta.cls+'"'+title+'>'+esc2(label)+'</span>';
}

// ── FILTER + GROUP ────────────────────────────────────────────────
function _skFilteredLines() {
  var search = (((document.getElementById('sk-search')||{}).value)||'').toLowerCase().trim();
  var vendor = ((document.getElementById('sk-filter-vendor')||{}).value)||'';
  var showEmpty = !!(document.getElementById('sk-show-empty')||{}).checked;

  var lines = (PRODUCT_LINES||[]).slice()
    .filter(function(p){ return p.name && p.name.toLowerCase() !== 'other (specify)'; })
    .filter(function(p){ return p.is_active; });
  if (vendor) lines = lines.filter(function(p){ return String(p.vendor_id) === String(vendor); });
  if (search) lines = lines.filter(function(p){ return p.name.toLowerCase().indexOf(search) !== -1; });

  // Hide lines with zero skill entries unless the toggle is on.
  if (!showEmpty) {
    var usedSet = {};
    SKILLS.forEach(function(s){ usedSet[s.product_line_id] = 1; });
    lines = lines.filter(function(p){ return usedSet[p.id]; });
  }

  lines.sort(function(a,b){
    var va = _skVendorFor(a), vb = _skVendorFor(b);
    var vNameA = va ? va.name : '~'; // unmatched vendors sink to the bottom
    var vNameB = vb ? vb.name : '~';
    if (vNameA !== vNameB) return vNameA.localeCompare(vNameB);
    return a.name.localeCompare(b.name);
  });
  return lines;
}

function _skEmployees() {
  // EMPLOYEES is the canonical team list seeded in state.js.
  return (EMPLOYEES||[]).slice();
}

// ── RENDER (desktop matrix + mobile accordion) ────────────────────
function renderSkillsMatrix() {
  var content = document.getElementById('sk-content');
  if (!content) return;
  var lines = _skFilteredLines();
  var emps  = _skEmployees();

  if (!SKILLS.length && !((document.getElementById('sk-show-empty')||{}).checked)) {
    // Genuine empty state — no skills logged anywhere yet.
    content.innerHTML = renderEmptyState({
      icon: 'users',
      heading: 'No team skills logged yet',
      sub: 'Record each team member’s proficiency on the products you sell so you know who to assign new work to.',
      btnText: '+ Add a skill',
      btnOnclick: 'openSkillModal()'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  if (!lines.length) {
    content.innerHTML = renderEmptyState({
      icon: 'search-x',
      heading: 'No products match the current filters',
      sub: 'Try toggling "Show empty products" or clearing the filters.',
      btnText: 'Clear filters',
      btnOnclick: 'clearSkillFilters()'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var isMobile = window.innerWidth < 720;
  content.innerHTML = (isMobile ? _skRenderAccordion(lines, emps) : _skRenderMatrix(lines, emps)) +
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+lines.length+' product line'+(lines.length===1?'':'s')+' · '+SKILLS.length+' skill record'+(SKILLS.length===1?'':'s')+' total</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function _skRenderMatrix(lines, emps) {
  // Build a (employee_name, product_line_id) -> skill lookup once
  var byKey = {};
  SKILLS.forEach(function(s){ byKey[s.employee_name + '|' + s.product_line_id] = s; });

  var head = '<tr>'+
    '<th class="sk-rowhead">Product Line</th>'+
    '<th class="sk-vendorhead hide-mobile">Vendor</th>'+
    emps.map(function(e){ return '<th class="sk-emphead">'+esc2(_skFirstName(e))+'</th>'; }).join('')+
  '</tr>';

  var body = lines.map(function(p){
    var v = _skVendorFor(p);
    return '<tr>'+
      '<td class="sk-rowhead"><strong>'+esc2(p.name)+'</strong></td>'+
      '<td class="sk-vendorhead hide-mobile">'+esc2(v?v.name:'—')+'</td>'+
      emps.map(function(e){
        var sk = byKey[e+'|'+p.id];
        var cls = 'sk-cell' + (sk ? ' sk-cell-filled' : ' sk-cell-empty');
        var inner = sk
          ? _skPillHtml(sk, false)
          : '<span class="sk-cell-add" aria-hidden="true">+</span>';
        var onclick = sk
          ? 'openSkillModal('+sk.id+')'
          : 'openSkillModal(null, '+JSON.stringify(e).replace(/"/g,'&quot;')+', '+p.id+')';
        return '<td class="'+cls+'" onclick="'+onclick+'">'+inner+'</td>';
      }).join('')+
    '</tr>';
  }).join('');

  return '<div class="card" style="padding:0;overflow:hidden">'+
    '<div class="table-wrap"><table class="sk-matrix"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>'+
  '</div>';
}

function _skRenderAccordion(lines, emps) {
  var byKey = {};
  SKILLS.forEach(function(s){ byKey[s.employee_name + '|' + s.product_line_id] = s; });
  return '<div class="sk-acc">' + emps.map(function(e){
    var rows = lines.map(function(p){
      var sk = byKey[e+'|'+p.id];
      var v = _skVendorFor(p);
      var pill = sk ? _skPillHtml(sk, true) : '<span class="sk-pill sk-pill-empty">—</span>';
      var onclick = sk
        ? 'openSkillModal('+sk.id+')'
        : 'openSkillModal(null, '+JSON.stringify(e).replace(/"/g,'&quot;')+', '+p.id+')';
      return '<div class="sk-acc-row" onclick="'+onclick+'">'+
        '<div class="sk-acc-row-name"><strong>'+esc2(p.name)+'</strong><span class="dim" style="font-size:11px">'+esc2(v?v.name:'—')+'</span></div>'+
        '<div class="sk-acc-row-pill">'+pill+'</div>'+
      '</div>';
    }).join('');
    return '<details class="sk-acc-emp">'+
      '<summary class="sk-acc-summary">'+esc2(e)+'</summary>'+
      '<div class="sk-acc-rows">'+rows+'</div>'+
    '</details>';
  }).join('') + '</div>';
}

function _skFirstName(full) {
  if (!full) return '—';
  var parts = String(full).trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : (parts[0] + ' ' + parts[parts.length-1].charAt(0) + '.');
}

// The reverse-lookup popover (openSkillReverseLookup) shares this
// modal element so we keep the close helper. The per-skill read-only
// view modal that used to live here was for non-managers; with manager-
// only access it's no longer reachable and has been removed.
function closeSkillViewModal() {
  var modal = document.getElementById('sk-view-modal');
  if (modal) modal.classList.remove('show');
}

// ── ADD / EDIT MODAL ──────────────────────────────────────────────
function openSkillModal(skillId, seedEmployee, seedProductLineId) {
  if (!isManager) { showError('Manager access only.'); return; }
  var modal = document.getElementById('sk-modal');
  if (!modal) return;
  var s = skillId ? SKILLS.find(function(x){ return x.id === skillId; }) : null;
  _skEditing = s ? Object.assign({}, s) : null;
  var errEl = document.getElementById('sk-modal-error');
  if (errEl) errEl.style.display = 'none';

  document.getElementById('sk-modal-title').textContent = s
    ? ('Edit Skill — ' + (s.employee_name||'') + ' / ' + _skProductLineName(s.product_line_id))
    : 'Add Skill';

  // Employee select — manager can pick any team member. Manager-only
  // screen, so no lock needed.
  var empSel = document.getElementById('sk-employee');
  empSel.innerHTML = (EMPLOYEES||[]).map(function(e){ return '<option value="'+esc2(e)+'">'+esc2(e)+'</option>'; }).join('');
  empSel.value = s ? (s.employee_name||'') : (seedEmployee || '');
  empSel.disabled = false;

  // Product line select — sourced from PRODUCT_LINES, hides "Other (specify)"
  // and disabled lines (unless the skill itself references one of them so
  // we don't silently drop an existing reference).
  var plSel = document.getElementById('sk-product-line');
  var lines = (PRODUCT_LINES||[]).slice()
    .filter(function(p){
      if (p.id === (s ? s.product_line_id : null)) return true; // keep existing ref
      if (!p.is_active) return false;
      if ((p.name||'').toLowerCase() === 'other (specify)') return false;
      return true;
    })
    .sort(function(a,b){
      var va = _skVendorFor(a), vb = _skVendorFor(b);
      var vn = (va?va.name:'~').localeCompare(vb?vb.name:'~');
      return vn !== 0 ? vn : a.name.localeCompare(b.name);
    });
  plSel.innerHTML = '<option value="">— Select Product —</option>' + lines.map(function(p){
    var v = _skVendorFor(p);
    return '<option value="'+p.id+'">'+esc2((v?v.name+' · ':'')+p.name)+'</option>';
  }).join('');
  plSel.value = s ? String(s.product_line_id) : (seedProductLineId ? String(seedProductLineId) : '');
  // Lock product line on edit — delete + re-add if you need to change it.
  plSel.disabled = !!s;

  // Level radios
  var lvl = s ? s.level : 'beginner';
  document.querySelectorAll('input[name="sk-level"]').forEach(function(r){
    r.checked = (r.value === lvl);
  });

  document.getElementById('sk-last-year').value  = s && s.last_used_year  ? s.last_used_year  : '';
  document.getElementById('sk-last-month').value = s && s.last_used_month ? s.last_used_month : '';
  document.getElementById('sk-notes').value      = s && s.notes ? s.notes : '';

  var delBtn = document.getElementById('sk-delete-btn');
  if (delBtn) delBtn.style.display = s ? '' : 'none';

  modal.classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeSkillModal() {
  var modal = document.getElementById('sk-modal');
  if (modal) modal.classList.remove('show');
  _skEditing = null;
}

function _skProductLineName(id) {
  var p = (PRODUCT_LINES||[]).find(function(x){ return x.id === id; });
  return p ? p.name : '';
}

function _skShowModalError(msg) {
  var el = document.getElementById('sk-modal-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
}

// ── SAVE / DELETE ─────────────────────────────────────────────────
async function saveSkill() {
  var errEl = document.getElementById('sk-modal-error');
  if (errEl) errEl.style.display = 'none';

  var emp   = document.getElementById('sk-employee').value || '';
  var plId  = document.getElementById('sk-product-line').value;
  var levelRadio = document.querySelector('input[name="sk-level"]:checked');
  var level = levelRadio ? levelRadio.value : '';
  var ly = document.getElementById('sk-last-year').value;
  var lm = document.getElementById('sk-last-month').value;
  var notes = (document.getElementById('sk-notes').value||'').trim();

  if (!plId)   { _skShowModalError('Pick a product line.'); return; }
  if (!emp)    { _skShowModalError('Pick an employee.'); return; }
  if (!level)  { _skShowModalError('Pick a level.'); return; }
  // last-used: both or neither (DB constraint employee_skills_lastused_pair)
  if ((ly && !lm) || (lm && !ly)) {
    _skShowModalError('Last used needs both Year and Month, or leave both empty.');
    return;
  }
  if (notes.length > 500) { _skShowModalError('Notes must be 500 characters or fewer.'); return; }

  var btn = document.getElementById('sk-save-btn');
  var orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Saving…'; }

  var payload = {
    employee_name:    emp,
    product_line_id:  parseInt(plId, 10),
    level:            level,
    last_used_year:   ly ? parseInt(ly,10) : null,
    last_used_month:  lm ? parseInt(lm,10) : null,
    notes:            notes || null
  };

  var res;
  if (_skEditing && _skEditing.id) {
    res = await sb.from('employee_skills').update(payload).eq('id', _skEditing.id);
  } else {
    payload.created_by = currentUser || null;
    res = await sb.from('employee_skills').insert(payload);
  }
  if (btn) { btn.disabled = false; btn.innerHTML = orig; if (typeof renderIcons === 'function') renderIcons(); }
  if (res.error) {
    // 23505 = unique_violation — friendlier message for the duplicate case
    if (res.error.code === '23505') {
      _skShowModalError('That employee already has this product in their skills. Edit the existing entry instead.');
    } else {
      _skShowModalError('Save failed: '+res.error.message);
    }
    return;
  }
  closeSkillModal();
  showToast('Skill saved ✓');
  await loadSkills();
}

async function deleteSkillFromModal() {
  if (!_skEditing || !_skEditing.id) return;
  var s = _skEditing;
  var pname = _skProductLineName(s.product_line_id) || 'this skill';
  if (!await confirmAction({
    title: 'Delete skill?',
    body:  'Remove '+(s.employee_name||'')+'’s skill record for '+pname+'?\n\nThis cannot be undone.',
    confirmText: 'Delete skill'
  })) return;
  var res = await sb.from('employee_skills').delete().eq('id', s.id);
  if (res.error) { showError('Delete failed: '+res.error.message); return; }
  closeSkillModal();
  showToast('Skill deleted ✓');
  await loadSkills();
}

// ── REVERSE LOOKUP (used by Vendors & Products page) ──────────────
// Returns a small markup string for the "X skilled" badge + popover
// trigger for a given product_line_id, or '' when nobody has the
// skill logged yet. Manager-only — non-managers don't see the badge.
function renderSkillCountBadge(productLineId) {
  if (!isManager) return '';
  if (!SKILLS || !SKILLS.length) return '';
  var n = SKILLS.filter(function(s){ return s.product_line_id === productLineId; }).length;
  if (!n) return '';
  return '<button type="button" class="sk-count-badge" onclick="event.stopPropagation();openSkillReverseLookup('+productLineId+')" title="See who is skilled in this product line">'+
    '<i data-lucide="users" style="width:11px;height:11px;vertical-align:-1px"></i> '+n+' skilled'+
  '</button>';
}

// Group the matching rows by level and show in a reuse of the
// read-only view modal. No edit shortcuts here — user goes to Team
// Skills to make changes.
function openSkillReverseLookup(productLineId) {
  var rows = SKILLS.filter(function(s){ return s.product_line_id === productLineId; });
  if (!rows.length) return;
  rows.sort(function(a,b){ return (SKILL_LEVEL_RANK[b.level]||0) - (SKILL_LEVEL_RANK[a.level]||0); });
  var pl = (PRODUCT_LINES||[]).find(function(p){ return p.id === productLineId; });
  var byLevel = { expert:[], intermediate:[], beginner:[] };
  rows.forEach(function(s){ if (byLevel[s.level]) byLevel[s.level].push(s); });
  var sect = function(level) {
    if (!byLevel[level] || !byLevel[level].length) return '';
    var meta = SKILL_LEVEL_META[level];
    return '<div class="sk-rev-section">'+
      '<div class="sk-rev-head"><span class="sk-pill '+meta.cls+'">'+meta.label+'</span> <span class="dim">('+byLevel[level].length+')</span></div>'+
      '<div class="sk-rev-names">'+byLevel[level].map(function(s){
        var last = _skFmtLastUsed(s);
        return '<div class="sk-rev-name"><strong>'+esc2(s.employee_name||'')+'</strong>'+(last?' <span class="dim">· '+esc2(last)+'</span>':'')+'</div>';
      }).join('')+'</div>'+
    '</div>';
  };
  document.getElementById('sk-view-title').textContent = pl ? ('Skilled in ' + pl.name) : 'Skilled team members';
  document.getElementById('sk-view-body').innerHTML =
    sect('expert') + sect('intermediate') + sect('beginner');
  document.getElementById('sk-view-modal').classList.add('show');
}

// ── PRE-FETCH FROM OTHER MODULES ──────────────────────────────────
// Called by Vendors & Products page so the "X skilled" badge appears
// even when the manager hasn't visited Team Skills yet. Manager-only;
// skipping it for non-managers avoids a wasted round trip (RLS would
// return zero rows anyway).
async function ensureSkillsLoaded() {
  if (!isManager) return;
  if (SKILLS && SKILLS.length) return;
  var res = await sb.from('employee_skills').select('*');
  if (!res.error) SKILLS = res.data || [];
}

// Re-render the matrix when the viewport crosses the 720px boundary
// so the table↔accordion swap doesn't get stuck.
var _skLastIsMobile = (typeof window !== 'undefined' && window.innerWidth < 720);
window.addEventListener('resize', function(){
  var nowMobile = window.innerWidth < 720;
  if (_skLastIsMobile !== nowMobile && SKILLS) {
    var screenEl = document.getElementById('screen-skills');
    if (screenEl && screenEl.classList.contains('active')) renderSkillsMatrix();
  }
  _skLastIsMobile = nowMobile;
});
