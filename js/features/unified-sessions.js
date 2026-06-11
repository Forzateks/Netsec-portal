// == UNIFIED SESSIONS (Phase 2 - Beta) ==========================
// Single form for Project / POC / AMC / Internal session logging.
// Phase 2 only persists; OT integration arrives in Phase 3.

// ── LONG-SESSION GUARDRAIL ─────────────────────────────────────
// Raw input-time duration (cross-midnight aware). Used by both the
// live form readout and the >12h save-confirm modal. Intentionally
// independent of calcOT — this is purely about the times the user
// typed, before any OT band / 1:2 amplification logic.
function _rawDurationHours(startStr, endStr) {
  if (!startStr || !endStr) return null;
  var sp = startStr.split(':').map(Number);
  var ep = endStr.split(':').map(Number);
  if (sp.length < 2 || ep.length < 2 || isNaN(sp[0]) || isNaN(ep[0])) return null;
  var sf = sp[0] + (sp[1]||0)/60;
  var ef = ep[0] + (ep[1]||0)/60;
  var dur = ef < sf ? (ef + 24 - sf) : (ef - sf);
  return dur;
}
// "4h 30m" / "4h" / "0h 15m". Compact form used inline in the form.
function _formatDurationShort(h) {
  if (h == null || isNaN(h)) return '—';
  var hrs = Math.floor(h);
  var mins = Math.round((h - hrs) * 60);
  if (mins === 60) { hrs++; mins = 0; }
  if (mins === 0) return hrs + 'h';
  return hrs + 'h ' + mins + 'm';
}
// "16 hours 30 minutes" — long form used inside the confirm modal.
function _formatDurationLong(h) {
  if (h == null || isNaN(h)) return '0 minutes';
  var hrs = Math.floor(h);
  var mins = Math.round((h - hrs) * 60);
  if (mins === 60) { hrs++; mins = 0; }
  var parts = [];
  if (hrs > 0)  parts.push(hrs + ' hour' + (hrs===1?'':'s'));
  if (mins > 0) parts.push(mins + ' minute' + (mins===1?'':'s'));
  return parts.join(' ') || '0 minutes';
}
// "Thursday, 14 May 2026 — 23:00"
function _formatLongDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  var d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr + ' ' + timeStr;
  var days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' — ' + timeStr.slice(0,5);
}
function _addOneDay(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}
// Render the inline duration line under the start/end time fields.
// elId points at a <span> the form HTML provides. Empty / invalid →
// "Duration: —". >12h → amber + warning copy.
function _renderDurationLine(elId, startStr, endStr) {
  var el = document.getElementById(elId);
  if (!el) return;
  var dur = _rawDurationHours(startStr, endStr);
  if (dur === null) {
    el.className = 'duration-line';
    el.textContent = 'Duration: —';
    return;
  }
  var crosses = (endStr < startStr);
  var crossLbl = crosses ? ' (crosses to next day)' : '';
  if (dur > 12) {
    el.className = 'duration-line duration-warn';
    el.textContent = '⚠️ Duration: ' + _formatDurationShort(dur) + crossLbl + ' — double-check times';
  } else {
    el.className = 'duration-line';
    el.textContent = 'Duration: ' + _formatDurationShort(dur) + crossLbl;
  }
}
// Promise-returning confirmation. Resolves true if user confirms, false
// if they cancel or Esc. Default focus on Cancel (per spec). Enter NOT
// wired to confirm — only an explicit click on the Yes button does that.
function confirmLongSession(dateStr, startStr, endStr) {
  return new Promise(function(resolve) {
    var modal  = document.getElementById('long-session-modal');
    var body   = document.getElementById('long-session-body');
    var cancel = document.getElementById('long-session-cancel');
    var ok     = document.getElementById('long-session-ok');
    if (!modal || !body || !cancel || !ok) {
      // Defensive fallback if the modal markup isn't in the DOM yet.
      resolve(window.confirm('This session is over 12 hours. Continue?'));
      return;
    }
    var dur     = _rawDurationHours(startStr, endStr);
    var crosses = (endStr < startStr);
    var endDate = crosses ? _addOneDay(dateStr) : dateStr;
    body.innerHTML =
      '<div class="long-sess-row"><span class="long-sess-label">Start</span><span class="long-sess-val">'+esc2(_formatLongDateTime(dateStr, startStr))+'</span></div>' +
      '<div class="long-sess-row"><span class="long-sess-label">End</span><span class="long-sess-val">to ' + esc2(_formatLongDateTime(endDate, endStr)) + '</span></div>' +
      '<div class="long-sess-total"><strong>Total: ' + esc2(_formatDurationLong(dur)) + '</strong></div>' +
      '<div class="long-sess-note">This is unusually long. Please confirm the times are correct.</div>';
    function close(result) {
      modal.classList.remove('show');
      cancel.onclick = null;
      ok.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) {
      // Esc cancels. Enter is intentionally NOT wired so the default-focused
      // Cancel button can't be accidentally bypassed.
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    }
    cancel.onclick = function(){ close(false); };
    ok.onclick     = function(){ close(true);  };
    document.addEventListener('keydown', onKey);
    modal.classList.add('show');
    // Default focus = Cancel per spec.
    setTimeout(function(){ cancel.focus(); }, 80);
  });
}

// AMC = recurring paid maintenance contract (wrench)
// Support = reactive one-off troubleshooting (life-buoy)
// Visually distinct so summaries can tell them apart at a glance.
const SESSION_TYPE_BADGES = {
  project:          { bg: '#EFF6FF', color: '#2563EB', label: '📁 Project' },
  poc:              { bg: '#F5F3FF', color: '#7C3AED', label: '🎯 POC' },
  amc:              { bg: '#FFFBEB', color: '#B45309', label: '🛠️ AMC' },
  support:          { bg: '#FFF1F2', color: '#9F1239', label: '🚨 Support' },
  presales:         { bg: '#FDF2F8', color: '#BE185D', label: '💼 Pre-Sales-Task' },
  customer_testing: { bg: '#ECFEFF', color: '#0E7490', label: '🧪 Customer Testing' },
  internal:         { bg: '#F3F4F6', color: '#6B7280', label: '🔧 Internal' },
};

// Split a session's raw duration into office_hours vs ot_hours using the
// existing OT policy (calcOT). Returns the calcOT result alongside so the
// caller can persist band/rate/credited_hours on the auto-created OT row.
//
// office_hours = portion that falls inside regular working hours
// ot_hours     = portion outside regular working hours (raw, no doubling)
// otCalc       = full calcOT result if ot_hours > 0, else null
//
// Note: credited_hours on the OT record may differ from ot_hours when
// Eve/Split doubles or caps. That's intentional - office/ot in unified_sessions
// reflect actual time worked; ot_sessions.credited_hours is what counts for CO.
function splitSessionHours(dateStr, startStr, endStr, employee) {
  if (!dateStr || !startStr || !endStr) return null;
  var d = new Date(dateStr);
  var wd = d.getDay();
  var t = getOTThresholds(employee);
  var eveStart = t.eveStart;
  var morningBlock = t.morningBlock;
  var sp = startStr.split(':').map(Number);
  var ep = endStr.split(':').map(Number);
  var sf = sp[0] + sp[1]/60;
  var ef = ep[0] + ep[1]/60;
  var rawDur = ef <= sf ? ef + 24 - sf : ef - sf;
  var isWknd = isWeekend(wd, employee);

  var otHours = 0;
  if (isWknd) {
    otHours = rawDur;
  } else {
    var crossesMidnight = ef <= sf;
    if (crossesMidnight) {
      if (sf >= eveStart) {
        // Eve/Split — whole session is OT
        otHours = rawDur;
      } else {
        // Mid — only post-eve portion of today + pre-morning portion of tomorrow
        otHours = (24 - Math.max(sf, eveStart)) + Math.min(ef, morningBlock);
      }
    } else {
      var morningOT = (sf < morningBlock) ? Math.max(0, Math.min(ef, morningBlock) - sf) : 0;
      var eveningOT = (ef > eveStart)     ? Math.max(0, ef - Math.max(sf, eveStart))     : 0;
      otHours = morningOT + eveningOT;
    }
  }
  otHours = Math.max(0, otHours);
  var officeHours = Math.max(0, rawDur - otHours);
  var otCalc = otHours > 0 ? calcOT(dateStr, startStr, endStr, employee) : null;

  return {
    total:  r2(rawDur),
    office: r2(officeHours),
    ot:     r2(otHours),
    otCalc: otCalc,
  };
}

// === FORM: type toggle + conditional fields ====================
// Three modes:
//   isEng       — Project/POC/AMC/Support/Pre-Sales-Task. Customer +
//                 engagement + stake holders + activity + mode + team
//                 all visible.
//   isInternal  — Internal/Other. NO customer/engagement/stake — work
//                 isn't tied to an external party. Activity stays
//                 visible with the dedicated INTERNAL_ACTIVITY_TYPES
//                 list ("Testing for customers", "Lab setup", "Others").
//                 Mode + team still visible.
//   neither     — empty placeholder. Hide everything below Session Type.
function onUSTypeChange() {
  var type = document.getElementById('us-type').value;
  var isEng      = (type === 'project' || type === 'poc' || type === 'amc' || type === 'support' || type === 'presales');
  var isInternal = (type === 'internal');
  // Customer Testing parallels Pre-Sales-Task on activity (own short list)
  // but parallels Internal on engagement (no engagement record). Customer
  // and Stake-Holders ARE relevant — lab validations / demos always run
  // for a named customer, often with named stakeholders. Treated as its
  // own type so the form/save logic doesn't accidentally require an
  // engagement_id.
  var isCustomerTest = (type === 'customer_testing');

  var custRow = document.getElementById('us-customer-row');
  var engRow  = document.getElementById('us-engagement-row');
  var actRow  = document.getElementById('us-activity-row');
  var stkRow  = document.getElementById('us-stake-row');
  var modeRow = document.getElementById('us-mode-row');
  var teamRow = document.getElementById('us-team-row');

  // Customer + stake: shown for engagement-tied AND Customer Testing.
  // Engagement: engagement-tied only (CT has none).
  if (custRow) custRow.style.display = (isEng || isCustomerTest) ? '' : 'none';
  if (engRow)  engRow.style.display  = isEng ? '' : 'none';
  if (stkRow)  stkRow.style.display  = (isEng || isCustomerTest) ? '' : 'none';
  // Activity + mode + team: visible for ANY chosen type, just with
  // different activity lists. Hidden only when type is empty.
  if (actRow)  actRow.style.display  = (isEng || isInternal || isCustomerTest) ? '' : 'none';
  if (modeRow) modeRow.style.display = (isEng || isInternal || isCustomerTest) ? '' : 'none';
  if (teamRow) teamRow.style.display = (isEng || isInternal || isCustomerTest) ? '' : 'none';

  // Repopulate the customer dropdown only when relevant. Internal +
  // empty types skip this — the row is hidden anyway and the previous
  // customer pick may not match the new type's customer list. Customer
  // Testing gets ALL customers (no engagement filter applies).
  if (isEng) _usPopulateCustomersByType(type);
  else if (isCustomerTest) fillCustomerSelect('us-customer', false);
  // Customer + engagement may no longer be valid — reset both. The user
  // re-picks from the now-filtered lists.
  var custEl = document.getElementById('us-customer');
  var engEl  = document.getElementById('us-engagement');
  var actEl  = document.getElementById('us-activity-type');
  if (custEl) custEl.value = '';
  if (engEl)  engEl.value  = '';
  // Activity Type list depends on session type — presales + internal
  // each get their own short list, everything else gets the delivery
  // list. Reset value to placeholder on type change.
  if (actEl) actEl.value = '';
  fillActivitySelect('us-activity-type', type);

  // Repopulate engagement dropdown filtered by selected type
  if (isEng) populateUSEngagementDropdown();
  updateUSPreview();
}

// Filter the Log-Session customer dropdown to only customers that have at
// least one engagement matching the chosen session type.
//   - type === ''          → disabled "Select session type first" placeholder
//   - type === 'internal'  → all customers (Internal sessions aren't tied to
//                            an engagement record, so the engagement-based
//                            filter would wrongly empty the list)
//   - any other type       → filter CUSTOMERS to those with at least one
//                            engagement of matching type, any status
// Edit Session modal is untouched on purpose — editing an existing row must
// keep the original customer visible even if no current engagement matches.
function _usPopulateCustomersByType(type) {
  var sel = document.getElementById('us-customer');
  if (!sel) return;
  if (!type) {
    sel.innerHTML = '<option value="">-- Select session type first --</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  if (type === 'internal') {
    fillCustomerSelect('us-customer', false);
    return;
  }
  // Collect customer_ids referenced by engagements of the chosen type.
  // Status is ignored on purpose — Closed/Cancelled engagements can still
  // accept retroactive sessions (e.g. final close-out work).
  var matchIds = {};
  (ENGAGEMENTS||[]).forEach(function(e){
    if (e.type === type && e.customer_id) matchIds[e.customer_id] = 1;
  });
  var customers = (CUSTOMERS||[]).filter(function(c){ return matchIds[c.id]; });
  if (!customers.length) {
    sel.innerHTML = '<option value="">No customers with ' + esc2(type) + ' engagements</option>';
    sel.disabled = true;
    return;
  }
  sel.innerHTML = '<option value="">-- Select Customer --</option>'
    + customers.map(function(c){ return '<option>' + esc2(c.name) + '</option>'; }).join('');
}

function onUSCustomerChange() {
  populateUSEngagementDropdown();
}

function populateUSEngagementDropdown() {
  var type = document.getElementById('us-type').value;
  var customer = document.getElementById('us-customer').value;
  var sel = document.getElementById('us-engagement');
  if (!sel) return;
  var cur = sel.value;
  var custRow = (CUSTOMERS||[]).find(function(c){ return c.name === customer; });
  var customer_id = custRow ? custRow.id : null;
  var options = (ENGAGEMENTS||[]).filter(function(e){
    return e.type === type
      && e.status !== 'archived'
      && !e.is_archived
      && (!customer_id || e.customer_id === customer_id);
  });
  sel.innerHTML = '<option value="">-- Select Engagement --</option>'
    + options.map(function(e){ return '<option value="'+e.id+'">'+e.name+'</option>'; }).join('');
  if (cur) sel.value = cur;
}

function populateUSCustomerDropdown() {
  fillCustomerSelect('us-customer', false);
  fillActivitySelect('us-activity-type');
}

function buildUSTeamCheckboxes() {
  var box = document.getElementById('us-team-checkboxes');
  if (!box || box.children.length) return;
  EMPLOYEES.forEach(function(emp){
    var label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;cursor:pointer;padding:6px 12px;border:1.5px solid var(--border);border-radius:20px;background:white;transition:all .15s';
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = emp; cb.name = 'us-team';
    cb.style.accentColor = 'var(--teal)';
    cb.onchange = function(){
      label.style.background = cb.checked ? '#E0F7FF' : 'white';
      label.style.borderColor = cb.checked ? 'var(--teal)' : 'var(--border)';
    };
    if (emp === currentUser) {
      cb.checked = true;
      label.style.background = '#E0F7FF';
      label.style.borderColor = 'var(--teal)';
    }
    label.appendChild(cb);
    label.appendChild(document.createTextNode((typeof empShortName === 'function') ? empShortName(emp) : emp.split(' ')[0]));
    box.appendChild(label);
  });
}

function initUSLogForm() {
  populateUSCustomerDropdown();
  buildUSTeamCheckboxes();
  var dateEl = document.getElementById('us-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
  onUSTypeChange();
  // Draft recovery — surface a banner if the last unsaved state is
  // still in localStorage. Then start the auto-save heartbeat so any
  // new typing gets captured.
  _usDraftCheck();
  _usDraftStart();
}

// ── LOG SESSION DRAFT AUTO-SAVE ──────────────────────────────────
// Snapshots the form to localStorage every 3 seconds so a tab close
// or accidental nav doesn't lose work. Cleared on successful submit.
//
// Scope: only this form has auto-save. Smaller forms (leave request,
// inventory, customer add) don't justify the localStorage churn.
var US_DRAFT_KEY = 'draft-log-session';
var _usDraftTimer = null;
var _usDraftFields = ['us-type','us-customer','us-engagement','us-activity-type',
                      'us-info','us-date','us-start','us-end','us-mode',
                      'us-stake','us-remarks'];

function _usDraftSnapshot() {
  var data = { savedAt: new Date().toISOString() };
  _usDraftFields.forEach(function(id){
    var el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  data.team = [];
  document.querySelectorAll('#us-team-checkboxes input[type=checkbox]:checked').forEach(function(cb){
    data.team.push(cb.value);
  });
  return data;
}

// "Blank" = no user-typed content. Defaults like today's date or the
// pre-checked currentUser teammate don't count as a draft worth keeping.
function _usDraftIsBlank(d) {
  if (!d) return true;
  var hasContent = false;
  ['us-info','us-customer','us-engagement','us-start','us-end','us-stake','us-remarks'].forEach(function(id){
    if (d[id]) hasContent = true;
  });
  // Team beyond just currentUser counts as content
  if (d.team && d.team.length > 1) hasContent = true;
  if (d.team && d.team.length === 1 && d.team[0] !== currentUser) hasContent = true;
  return !hasContent;
}

function _usDraftStart() {
  _usDraftStop();
  _usDraftTimer = setInterval(function(){
    var snap = _usDraftSnapshot();
    if (_usDraftIsBlank(snap)) return;
    try { localStorage.setItem(US_DRAFT_KEY, JSON.stringify(snap)); } catch(e) { /* quota or disabled */ }
  }, 3000);
}

function _usDraftStop() {
  if (_usDraftTimer) { clearInterval(_usDraftTimer); _usDraftTimer = null; }
}

function _usDraftClear() {
  try { localStorage.removeItem(US_DRAFT_KEY); } catch(e) {}
  var banner = document.getElementById('us-draft-banner');
  if (banner) banner.style.display = 'none';
}

function _usDraftCheck() {
  var raw = null;
  try { raw = localStorage.getItem(US_DRAFT_KEY); } catch(e) {}
  if (!raw) return;
  var d;
  try { d = JSON.parse(raw); } catch(e) { _usDraftClear(); return; }
  if (_usDraftIsBlank(d)) { _usDraftClear(); return; }

  var when = (typeof relativeTime === 'function' && d.savedAt) ? relativeTime(d.savedAt) : 'a moment ago';
  var banner = document.getElementById('us-draft-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'us-draft-banner';
    banner.className = 'us-draft-banner';
    var card = document.querySelector('#pjtab-uslog .card');
    if (card && card.parentNode) card.parentNode.insertBefore(banner, card);
  }
  banner.innerHTML =
    '<span class="us-draft-msg"><strong>Unsaved draft</strong> from ' + when + ' — restore the values you were typing?</span>' +
    '<button type="button" class="btn btn-sm btn-primary" onclick="_usDraftResume()">Resume</button>' +
    '<button type="button" class="btn btn-sm btn-ghost" onclick="_usDraftDiscard()">Discard</button>';
  banner.style.display = '';
}

function _usDraftResume() {
  var raw = null;
  try { raw = localStorage.getItem(US_DRAFT_KEY); } catch(e) {}
  if (!raw) return;
  var d;
  try { d = JSON.parse(raw); } catch(e) { return; }

  // Type must be set first because it controls which other rows are
  // visible AND populates the engagement dropdown.
  if (d['us-type']) {
    var t = document.getElementById('us-type');
    if (t) t.value = d['us-type'];
    if (typeof onUSTypeChange === 'function') onUSTypeChange();
  }
  // Customer next so the engagement dropdown filters correctly
  if (d['us-customer']) {
    var c = document.getElementById('us-customer');
    if (c) c.value = d['us-customer'];
    if (typeof onUSCustomerChange === 'function') onUSCustomerChange();
  }
  // Remaining straightforward fields
  ['us-engagement','us-activity-type','us-info','us-date','us-start','us-end','us-mode','us-stake','us-remarks'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && d[id] !== undefined && d[id] !== '') el.value = d[id];
  });
  // Team checkboxes
  if (Array.isArray(d.team)) {
    document.querySelectorAll('#us-team-checkboxes input[type=checkbox]').forEach(function(cb){
      cb.checked = d.team.indexOf(cb.value) !== -1;
      var lbl = cb.parentElement;
      if (lbl) {
        lbl.style.background = cb.checked ? '#E0F7FF' : 'white';
        lbl.style.borderColor = cb.checked ? 'var(--teal)' : 'var(--border)';
      }
    });
  }
  if (typeof updateUSPreview === 'function') updateUSPreview();
  var banner = document.getElementById('us-draft-banner');
  if (banner) banner.style.display = 'none';
  showToast('Draft restored ✓');
}

async function _usDraftDiscard() {
  var ok = await confirmAction({
    title: 'Discard the unsaved draft?',
    body: 'The values you were typing will be removed and you\'ll start with a fresh form.',
    confirmText: 'Discard',
    danger: false
  });
  if (!ok) return;
  _usDraftClear();
  showToast('Draft discarded');
}

function updateUSPreview() {
  var date  = document.getElementById('us-date').value;
  var start = document.getElementById('us-start').value;
  var end   = document.getElementById('us-end').value;
  // Live duration readout — passive, fires on every keystroke via the
  // onchange handlers on us-start/us-end. >12h flips it amber + adds
  // a "double-check times" nudge.
  _renderDurationLine('us-duration-line', start, end);
  var totEl = document.getElementById('us-preview-total');
  var offEl = document.getElementById('us-preview-office');
  var otEl  = document.getElementById('us-preview-ot');
  if (!totEl) return;
  if (!date || !start || !end) {
    totEl.textContent = '—'; offEl.textContent = '—'; otEl.textContent = '—';
    otEl.style.color = 'var(--gold)';
    return;
  }
  var split = splitSessionHours(date, start, end, currentUser);
  if (!split) { totEl.textContent = '—'; offEl.textContent = '—'; otEl.textContent = '—'; return; }
  totEl.textContent = fmtHours(split.total);
  offEl.textContent = fmtHours(split.office);
  if (split.ot > 0 && split.otCalc) {
    var c = split.otCalc;
    otEl.textContent = split.ot + 'h  →  ' + c.band + ' · ' + c.rate + ' · credited ' + c.credited + 'h (pending approval)';
    otEl.style.color = 'var(--gold)';
  } else {
    otEl.textContent = 'none';
    otEl.style.color = 'var(--muted)';
  }
}

// ── MULTI-MEMBER OT HELPERS ──────────────────────────────────────
// Build the canonical team list for a session: split CSV, trim, dedupe
// (case-insensitive), and force the logger in front. Empty input still
// returns the logger so they always get their own OT calc.
function _buildTeamList(loggerName, teamCsv) {
  var raw = (teamCsv || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  if (loggerName) raw.unshift(loggerName);
  var seen = {};
  var out = [];
  raw.forEach(function(n){
    var key = n.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    out.push(n);
  });
  return out;
}

// Run calcOT for one team member and return the ot_sessions row payload
// (without id / source / status — caller fills those). Returns null if
// the member's region produces zero credited hours (no OT row needed).
// "Unknown" members (not in EMPLOYEES) are skipped with a console
// warning — the spec asks for a toast, surfaced by the calling save.
function _buildMemberOTRow(memberName, date, start, end, isEng, customer, engagementName, actType, info) {
  if (!EMPLOYEES || EMPLOYEES.indexOf(memberName) === -1) {
    console.warn('Team member "'+memberName+'" not in EMPLOYEES — OT auto-gen skipped');
    return { unknown: true, name: memberName };
  }
  var c = calcOT(date, start, end, memberName);
  if (!c || !c.credited || c.credited <= 0) return null;
  var activityLabel = isEng
    ? ((customer || '') + ' / ' + (engagementName || '-') + ' — ' + info)
    : info;
  return {
    employee:        memberName,
    activity:        activityLabel,
    ot_date:         date,
    start_time:      start,
    end_time:        end,
    day_name:        c.dayName,
    band:            c.band,
    rate:            c.rate,
    duration_hours:  c.duration,
    credited_hours:  c.credited,
    customer_name:   isEng ? (customer || null) : null,
    project_name:    isEng ? engagementName     : null,
    activity_type:   isEng ? (actType || null)  : null,
    _calc:           c  // attached for the caller's summary toast only
  };
}

async function saveUnifiedSession() {
  // Pre-flight auth check (v82). Catches the "session died silently" case
  // where currentUser is still populated but the JWT has lost its email
  // claim — otherwise the INSERT fails with a misleading 42501 RLS error.
  if (!await requireAuth()) return;
  var type     = document.getElementById('us-type').value;
  var customer = document.getElementById('us-customer').value;
  var engId    = document.getElementById('us-engagement').value;
  var actType  = document.getElementById('us-activity-type').value;
  var info     = document.getElementById('us-info').value.trim();
  var date     = document.getElementById('us-date').value;
  var start    = document.getElementById('us-start').value;
  var end      = document.getElementById('us-end').value;
  var stakeH   = document.getElementById('us-stake').value.trim();
  var mode     = document.getElementById('us-mode').value;
  var remarks  = document.getElementById('us-remarks').value.trim();

  var teamChecks = document.querySelectorAll('#us-team-checkboxes input[type=checkbox]:checked');
  var teamMembers = Array.from(teamChecks).map(function(c){ return c.value; }).join(', ');

  var errEl = document.getElementById('us-error');
  errEl.style.display = 'none';

  function fail(msg) { errEl.textContent = '⚠️ ' + msg; errEl.style.display = 'block'; }

  if (!type)  return fail('Please pick a session type.');
  if (!date || !start || !end) return fail('Date, start and end times are required.');

  var isEng      = (type === 'project' || type === 'poc' || type === 'amc' || type === 'support' || type === 'presales');
  var isInternal = (type === 'internal');
  var isCustomerTest = (type === 'customer_testing');
  if (isEng) {
    if (!customer)    return fail('Please pick a customer.');
    if (!engId)       return fail('Please pick an engagement.');
    if (!actType)     return fail('Please pick an activity type.');
    if (!teamMembers) return fail('Pick at least one team member.');
  } else if (isCustomerTest) {
    // Customer Testing: customer + activity + team required; engagement
    // is intentionally absent (no formal engagement record for lab
    // validations / demos). Stake-holders is optional.
    if (!customer)    return fail('Please pick a customer.');
    if (!actType)     return fail('Please pick an activity type.');
    if (!teamMembers) return fail('Pick at least one team member.');
  } else if (isInternal) {
    // Internal sessions: no customer/engagement/stake-holders, but the
    // activity (one of Testing for customers / Lab setup / Others) and
    // a team member are still required so the session is meaningful.
    if (!actType)     return fail('Please pick an activity type.');
    if (!teamMembers) return fail('Pick at least one team member.');
  }
  if (!info) return fail('Session info is required.');

  // Long-session guardrail (strict > 12h, raw input duration). Fires for
  // every session type. Cancel returns to the form and jumps focus to
  // the Start Time field so the typo is the first thing the user fixes.
  var rawDur = _rawDurationHours(start, end);
  if (rawDur !== null && rawDur > 12) {
    var longOk = await confirmLongSession(date, start, end);
    if (!longOk) {
      var startEl = document.getElementById('us-start');
      if (startEl && startEl.focus) startEl.focus();
      return;
    }
  }

  // Engagement snapshot (name) for non-internal
  var engagement_name = null;
  if (isEng && engId) {
    var engRow = (ENGAGEMENTS||[]).find(function(e){ return String(e.id) === String(engId); });
    if (engRow) engagement_name = engRow.name;
  }

  // Office/OT split — driven by the LOGGER's region for the unified row.
  // Per-member OT is computed individually below.
  var split = splitSessionHours(date, start, end, currentUser);
  if (!split) return fail('Could not compute hours.');

  var btn = document.getElementById('us-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  // Activity/team/mode persist for both engagement-tied and Internal
  // sessions. Customer/engagement/stake-holders only persist for
  // engagement-tied — Internal work isn't bound to an external party.
  var payload = {
    employee:        currentUser,
    session_date:    date,
    start_time:      start,
    end_time:        end,
    session_type:    type,
    engagement_id:   isEng && engId ? Number(engId) : null,
    customer_name:   (isEng || isCustomerTest) ? (customer || null) : null,
    engagement_name: engagement_name,
    activity_type:   (isEng || isInternal || isCustomerTest) ? (actType || null) : null,
    session_info:    info,
    team_members:    (isEng || isInternal || isCustomerTest) ? (teamMembers || null) : null,
    stake_holders:   (isEng || isCustomerTest) ? (stakeH || null) : null,
    mode:            (isEng || isInternal || isCustomerTest) ? (mode || null) : null,
    remarks:         remarks || null,
    total_hours:     split.total,
    office_hours:    split.office,
    ot_hours:        split.ot,
  };

  var res = await sb.from('unified_sessions').insert(payload).select().single();
  if (res.error) {
    btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Session'; if (typeof renderIcons === 'function') renderIcons();
    return fail('Save failed: ' + res.error.message);
  }
  var unifiedId = res.data.id;

  // Per-member OT generation. The logger is auto-added by _buildTeamList
  // so they always get their own region-correct OT (matches v52 behaviour
  // for solo sessions and adds the new fan-out for team sessions).
  // Customer Testing follows the same pattern as engagement-tied sessions
  // (per-member OT for each team member), just with null engagement_name
  // since CT has no formal engagement record.
  var otSummary = '';
  var unknownMembers = [];
  if (isEng || isCustomerTest) {
    var team = _buildTeamList(currentUser, teamMembers);
    var rowsToInsert = [];
    var createdParts = [];
    team.forEach(function(name){
      var row = _buildMemberOTRow(name, date, start, end, isEng || isCustomerTest, customer, engagement_name, actType, info);
      if (row && row.unknown) { unknownMembers.push(row.name); return; }
      if (!row) return; // member's region yielded zero credit
      var calc = row._calc; delete row._calc;
      row.status            = 'pending';
      row.source            = 'unified';
      row.source_session_id = unifiedId;
      rowsToInsert.push(row);
      createdParts.push(name + ' ' + fmtHours(calc.credited) + ' ' + calc.band);
    });
    if (rowsToInsert.length) {
      var insRes = await sb.from('ot_sessions').insert(rowsToInsert);
      if (insRes.error) {
        console.error('Multi-OT insert failed:', insRes.error);
        otSummary = ' (warning: linked OT records could not be created — '+insRes.error.message+')';
      } else {
        otSummary = ' · OT pending: ' + createdParts.join(', ');
      }
    }
  } else if (split.ot > 0 && split.otCalc) {
    // Internal session (no team field): generate OT for the logger only.
    var ic = split.otCalc;
    var iRow = _buildMemberOTRow(currentUser, date, start, end, false, null, null, null, info);
    if (iRow && !iRow.unknown) {
      delete iRow._calc;
      iRow.status            = 'pending';
      iRow.source            = 'unified';
      iRow.source_session_id = unifiedId;
      var iRes = await sb.from('ot_sessions').insert(iRow);
      if (!iRes.error) otSummary = ' · ' + ic.band + ' OT ' + fmtHours(ic.credited) + ' pending approval';
    }
  }
  if (unknownMembers.length) {
    setTimeout(function(){
      showError('OT not auto-generated for: ' + unknownMembers.join(', ') + ' — user not found in system.');
    }, 400);
  }

  btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Session'; if (typeof renderIcons === 'function') renderIcons();

  // Reset form
  ['us-info','us-stake','us-remarks','us-start','us-end'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('us-customer').value = '';
  document.getElementById('us-engagement').value = '';
  document.getElementById('us-activity-type').value = '';
  document.getElementById('us-mode').value = '';
  // Reset team checkboxes back to current user only
  document.querySelectorAll('#us-team-checkboxes input').forEach(function(cb){
    cb.checked = cb.value === currentUser;
    var lbl = cb.parentElement;
    lbl.style.background = cb.checked ? '#E0F7FF' : 'white';
    lbl.style.borderColor = cb.checked ? 'var(--teal)' : 'var(--border)';
  });

  // Successful save — wipe the draft so the banner doesn't reappear next visit
  _usDraftClear();
  showToast('Session logged ✓' + otSummary);
  updateUSPreview();
}

// === MY SESSIONS (Beta) view ===================================
async function renderUSSessions() {
  document.getElementById('us-sess-loading').style.display = 'flex';
  document.getElementById('us-sess-table').style.display = 'none';
  document.getElementById('us-sess-empty').style.display = 'none';

  var fType  = (document.getElementById('us-flt-type')||{}).value || '';
  var fCust  = (document.getElementById('us-flt-cust')||{}).value || '';
  var fEng   = (document.getElementById('us-flt-eng')||{}).value || '';
  var fMem   = (document.getElementById('us-flt-mem')||{}).value || '';
  var fFrom  = (document.getElementById('us-flt-from')||{}).value || '';
  var fTo    = (document.getElementById('us-flt-to')||{}).value || '';

  // Newest-logged first (created_at), with session_date / start_time as
  // secondary keys for legacy rows that don't have a created_at value.
  // Paginated to bypass the Supabase server-side 1000-row cap.
  var res = await fetchAllRows(function() {
    var q = sb.from('unified_sessions').select('*').order('created_at',{ascending:false,nullsFirst:false}).order('session_date',{ascending:false}).order('start_time',{ascending:false});
    if (fType) q = q.eq('session_type', fType);
    if (fCust) q = q.eq('customer_name', fCust);
    if (fEng)  q = q.eq('engagement_name', fEng);
    if (fFrom) q = q.gte('session_date', fFrom);
    if (fTo)   q = q.lte('session_date', fTo);
    return q;
  });
  document.getElementById('us-sess-loading').style.display = 'none';
  var rows = res.data || [];

  if (fMem) {
    // v105: exact full-name match against trimmed team_members CSV tokens
    // plus the logger. Replaces firstName-substring includes() which
    // collided the two Mohammeds (Nasif and Afsal both reduced to
    // "mohammed"). Whitespace-tolerant via trim on each token.
    var target = fMem.trim().toLowerCase();
    rows = rows.filter(function(r){
      if (r.employee && r.employee.toLowerCase() === target) return true;
      if (!r.team_members) return false;
      var members = r.team_members.split(',').map(function(s){ return s.trim().toLowerCase(); });
      return members.indexOf(target) !== -1;
    });
  }
  if (!rows.length) {
    document.getElementById('us-sess-empty').style.display = 'block';
    var emptyCards = document.getElementById('us-sess-cards');
    if (emptyCards) emptyCards.innerHTML = '';
    return;
  }

  document.getElementById('us-sess-table').style.display = 'block';
  // Render the table tbody AND a card list in parallel. Visibility is toggled
  // by .us-cards-only / .us-table-only at the 768px breakpoint in CSS — no
  // resize listener needed since both formats live in the DOM. Cheaper than
  // re-fetching from Supabase on viewport change.
  var tbodyHtml = '';
  var cardsHtml = '';
  rows.forEach(function(r,i){
    var canEdit = isManager || (r.employee === currentUser);
    var t = SESSION_TYPE_BADGES[r.session_type] || {bg:'#F3F4F6',color:'#6B7280',label:r.session_type||'-'};
    var actions = canEdit
      ? '<button class="btn btn-sm btn-ghost btn-icon-only" onclick="openEditUS('+r.id+')" title="Edit" style="margin-right:4px"><i data-lucide="pencil"></i></button>'+
        '<button class="btn btn-sm btn-danger btn-icon-only" onclick="deleteUS('+r.id+')" title="Delete"><i data-lucide="trash-2"></i></button>'
      : '';
    // User-typed fields wrapped in esc2 — closes attribute-quote-break
    // injection (e.g. session_info containing `"` would otherwise blow
    // out the title attribute). Note esc2 does NOT escape <>&; broader
    // XSS hardening of the helper itself is a separate scoped deploy.
    var custName = r.customer_name || '-';
    var engName  = r.engagement_name || '-';
    var actType  = r.activity_type || '-';
    var info     = r.session_info || '';
    var emp      = r.employee || '-';
    // v106: show team members alongside the logger in the LOGGED BY cell.
    // Others = team_members minus the logger (avoid double-listing).
    // B-highlight: if the active member filter (fMem) matches one of the
    // "others", show that name explicitly instead of hiding it in "+N",
    // so a filtered result is self-explanatory.
    var __logger = r.employee || '';
    var __team = (r.team_members || '').split(',')
      .map(function(s){ return s.trim(); })
      .filter(Boolean);
    var __others = __team.filter(function(n){ return n !== __logger; });
    var empCell = esc2(__logger || '-');
    if (__others.length) {
      var __fMemTrim = (fMem || '').trim();
      // If filtering by a specific member who is in the others list,
      // surface their name; the rest collapse into "+N".
      if (__fMemTrim && __others.indexOf(__fMemTrim) !== -1) {
        var __rest = __others.filter(function(n){ return n !== __fMemTrim; });
        empCell += ', ' + esc2(__fMemTrim);
        if (__rest.length) {
          empCell += ' <span class="team-plus" title="' + esc2(__rest.join(', ')) + '">+' + __rest.length + '</span>';
        }
      } else {
        empCell += ' <span class="team-plus" title="' + esc2(__others.join(', ')) + '">+' + __others.length + '</span>';
      }
    }
    // Region tag next to the time so it's obvious whether a session is logged
    // in KSA or UAE local time — eyeballing the times alone is ambiguous
    // (e.g. an 09:00-12:00 KSA session reads the same as a UAE one).
    var region   = KSA_EMP.indexOf(r.employee) !== -1 ? 'KSA' : 'UAE';
    var regionTag = '<span style="display:inline-block;margin-left:6px;padding:1px 5px;border-radius:3px;background:#F1F5F9;color:#64748B;font-family:DM Sans,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.5px;vertical-align:1px">'+region+'</span>';
    tbodyHtml += '<tr>'+
      '<td style="color:var(--muted);font-size:12px">'+(i+1)+'</td>'+
      '<td><span class="badge" style="background:'+t.bg+';color:'+t.color+'">'+esc2(t.label)+'</span></td>'+
      '<td style="font-size:12px;color:var(--navy);font-weight:600">'+esc2(custName)+'</td>'+
      '<td style="font-size:12px"><strong>'+esc2(engName)+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtDate(r.session_date)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px;white-space:nowrap">'+fmtTime(r.start_time)+'-'+fmtTime(r.end_time)+regionTag+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+fmtHours(r.total_hours)+'</td>'+
      '<td><span class="badge" style="background:#f0f4ff;color:var(--navy);font-size:11px">'+esc2(actType)+'</span></td>'+
      '<td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc2(info)+'">'+esc2(info||'-')+'</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+empCell+'</td>'+
      '<td style="white-space:nowrap">'+actions+'</td>'+
      '</tr>';
    cardsHtml += '<div class="us-card">'+
      '<div class="us-card-head">'+
        '<span class="badge" style="background:'+t.bg+';color:'+t.color+'">'+esc2(t.label)+'</span>'+
        '<span class="us-card-hours num">'+fmtHours(r.total_hours)+'</span>'+
      '</div>'+
      '<div class="us-card-name">'+esc2(engName)+'</div>'+
      '<div class="us-card-meta">'+esc2(custName)+'</div>'+
      '<div class="us-card-row">'+
        '<span class="num">'+fmtDate(r.session_date)+'</span>'+
        '<span class="us-card-sep">·</span>'+
        '<span class="num">'+fmtTime(r.start_time)+'-'+fmtTime(r.end_time)+'</span>'+regionTag+
      '</div>'+
      '<div class="us-card-row">'+
        '<span class="badge" style="background:#f0f4ff;color:var(--navy);font-size:11px">'+esc2(actType)+'</span>'+
        '<span class="us-card-emp">'+empCell+'</span>'+
      '</div>'+
      (info?'<div class="us-card-info" title="'+esc2(info)+'">'+esc2(info)+'</div>':'')+
      (canEdit?'<div class="us-card-actions">'+actions+'</div>':'')+
    '</div>';
  });
  document.getElementById('us-sess-tbody').innerHTML = tbodyHtml;
  var cardsEl = document.getElementById('us-sess-cards');
  if (cardsEl) cardsEl.innerHTML = cardsHtml;
  if (typeof renderIcons === 'function') renderIcons();
  // Synced top horizontal scrollbar (desktop table only).
  if (typeof attachTopScroll === 'function') {
    requestAnimationFrame(function(){ attachTopScroll(document.getElementById('us-sess-table')); });
  }
}

function clearUSFilters() {
  ['us-flt-type','us-flt-cust','us-flt-eng','us-flt-mem','us-flt-from','us-flt-to'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  renderUSSessions();
}

function populateUSFilters() {
  // Customer filter
  var cs = document.getElementById('us-flt-cust');
  if (cs && cs.options.length <= 1) {
    cs.innerHTML = '<option value="">All Customers</option>'
      + (CUSTOMERS||[]).map(function(c){ return '<option>'+c.name+'</option>'; }).join('');
  }
  // Engagement filter
  var es = document.getElementById('us-flt-eng');
  if (es && es.options.length <= 1) {
    es.innerHTML = '<option value="">All Engagements</option>'
      + (ENGAGEMENTS||[]).map(function(e){ return '<option>'+e.name+'</option>'; }).join('');
  }
  // Member filter
  var ms = document.getElementById('us-flt-mem');
  if (ms && ms.options.length <= 1) {
    ms.innerHTML = '<option value="">All Members</option>'
      + (EMPLOYEES||[]).map(function(emp){ return '<option>'+emp+'</option>'; }).join('');
  }
}

// === EDIT / DELETE ============================================
async function openEditUS(id) {
  var res = await sb.from('unified_sessions').select('*').eq('id', id).single();
  if (res.error || !res.data) { showError('Could not load session.'); return; }
  var r = res.data;
  document.getElementById('edit-us-id').value = r.id;
  document.getElementById('edit-us-type').value = r.session_type;
  document.getElementById('edit-us-date').value = r.session_date;
  document.getElementById('edit-us-start').value = r.start_time;
  document.getElementById('edit-us-end').value = r.end_time;
  document.getElementById('edit-us-info').value = r.session_info || '';
  document.getElementById('edit-us-customer').value = r.customer_name || '';
  document.getElementById('edit-us-engagement').value = r.engagement_name || '';
  document.getElementById('edit-us-activity-type').value = r.activity_type || '';
  document.getElementById('edit-us-team').value = r.team_members || '';
  document.getElementById('edit-us-stake').value = r.stake_holders || '';
  document.getElementById('edit-us-mode').value = r.mode || '';
  document.getElementById('edit-us-remarks').value = r.remarks || '';
  // Populate dropdowns. Activity Type list is filtered by session_type
  // (presales gets the short list, everything else gets the delivery
  // list); the row's existing activity_type is passed in as legacyValue
  // so an out-of-list option still surfaces as "<value> (legacy)".
  fillCustomerSelect('edit-us-customer', false);
  fillActivitySelect('edit-us-activity-type', r.session_type, r.activity_type);
  document.getElementById('edit-us-customer').value = r.customer_name || '';
  document.getElementById('edit-us-activity-type').value = r.activity_type || '';
  // Engagement dropdown
  var sel = document.getElementById('edit-us-engagement');
  var custRow = (CUSTOMERS||[]).find(function(c){ return c.name === r.customer_name; });
  var customer_id = custRow ? custRow.id : null;
  var options = (ENGAGEMENTS||[]).filter(function(e){
    return e.type === r.session_type && (!customer_id || e.customer_id === customer_id);
  });
  sel.innerHTML = '<option value="">-- Select --</option>'
    + options.map(function(e){ return '<option value="'+e.name+'">'+e.name+'</option>'; }).join('');
  sel.value = r.engagement_name || '';

  document.getElementById('edit-us-error').style.display = 'none';
  _updateEditUSDuration();
  // Apply Internal-vs-engagement field visibility based on the row's
  // type — mirrors the Log Session form's onUSTypeChange behaviour.
  _editUSApplyFieldVisibility();
  document.getElementById('edit-unified-modal').classList.add('show');
}

// Toggle Customer / Engagement / Stake Holders rows in the edit modal
// based on session_type. Engagement-tied types keep them visible;
// Internal hides them entirely (work isn't bound to an external party).
// Also refreshes the Activity Type list — Internal gets the dedicated
// short list; the row's existing activity passes in as legacyValue so
// pre-v77 entries (e.g. an old internal session saved with "Migration")
// still appear, marked "(legacy)".
function _editUSApplyFieldVisibility() {
  var type       = (document.getElementById('edit-us-type')||{}).value || '';
  var isEng      = (type === 'project' || type === 'poc' || type === 'amc' || type === 'support' || type === 'presales');
  var isInternal = (type === 'internal');
  var isCustomerTest = (type === 'customer_testing');

  function rowOf(id) {
    var el = document.getElementById(id);
    return el ? el.closest('.form-group') : null;
  }
  var custRow = rowOf('edit-us-customer');
  var engRow  = rowOf('edit-us-engagement');
  var stkRow  = rowOf('edit-us-stake');
  // Customer + stake shown for engagement-tied AND Customer Testing.
  // Engagement shown only for engagement-tied (CT has none).
  if (custRow) custRow.style.display = (isEng || isCustomerTest) ? '' : 'none';
  if (engRow)  engRow.style.display  = isEng ? '' : 'none';
  if (stkRow)  stkRow.style.display  = (isEng || isCustomerTest) ? '' : 'none';

  // Repopulate the activity-type dropdown for the new type, preserving
  // the current value when it appears in the new list (or as legacy).
  var actEl = document.getElementById('edit-us-activity-type');
  var currentAct = actEl ? actEl.value : '';
  if (typeof fillActivitySelect === 'function') {
    fillActivitySelect('edit-us-activity-type', type, currentAct);
    if (actEl && currentAct) actEl.value = currentAct;
  }
}

function closeEditUS() {
  document.getElementById('edit-unified-modal').classList.remove('show');
}

// Live duration readout for the Edit Session modal. Mirrors the
// updateUSPreview line for the Log Session form. Bound to onchange
// on edit-us-start / edit-us-end.
function _updateEditUSDuration() {
  var s = ((document.getElementById('edit-us-start')||{}).value)||'';
  var e = ((document.getElementById('edit-us-end')||{}).value)||'';
  _renderDurationLine('edit-us-duration-line', s, e);
}

async function saveEditUS() {
  if (!await requireAuth()) return;
  var id    = document.getElementById('edit-us-id').value;
  var type  = document.getElementById('edit-us-type').value;
  var date  = document.getElementById('edit-us-date').value;
  var start = document.getElementById('edit-us-start').value;
  var end   = document.getElementById('edit-us-end').value;
  var info  = document.getElementById('edit-us-info').value.trim();
  var customer = document.getElementById('edit-us-customer').value;
  var engagement = document.getElementById('edit-us-engagement').value;
  var actType = document.getElementById('edit-us-activity-type').value;
  var team  = document.getElementById('edit-us-team').value.trim();
  var stake = document.getElementById('edit-us-stake').value.trim();
  var mode  = document.getElementById('edit-us-mode').value;
  var remarks = document.getElementById('edit-us-remarks').value.trim();
  var errEl = document.getElementById('edit-us-error');
  errEl.style.display = 'none';
  function fail(m){ errEl.textContent = '⚠️ ' + m; errEl.style.display = 'block'; }

  if (!date || !start || !end) return fail('Date and times required.');
  if (!info) return fail('Session info required.');

  // Long-session guardrail also fires on edit. Same threshold (raw > 12h).
  var rawDur = _rawDurationHours(start, end);
  if (rawDur !== null && rawDur > 12) {
    var longOk = await confirmLongSession(date, start, end);
    if (!longOk) {
      var startEl = document.getElementById('edit-us-start');
      if (startEl && startEl.focus) startEl.focus();
      return;
    }
  }

  var isEng      = (type === 'project' || type === 'poc' || type === 'amc' || type === 'support' || type === 'presales');
  var isInternal = (type === 'internal');
  var isCustomerTest = (type === 'customer_testing');
  var engId = null;
  if (isEng && engagement) {
    var engRow = (ENGAGEMENTS||[]).find(function(e){ return e.name === engagement && e.type === type; });
    if (engRow) engId = engRow.id;
  }
  // Internal + Customer Testing each require activity + at least one
  // team member. Engagement-tied validation lives below in the existing
  // payload-build path.
  if (isInternal) {
    if (!actType) return fail('Please pick an activity type.');
    if (!team)    return fail('Pick at least one team member.');
  } else if (isCustomerTest) {
    if (!customer) return fail('Please pick a customer.');
    if (!actType)  return fail('Please pick an activity type.');
    if (!team)     return fail('Pick at least one team member.');
  }

  // Read OLD row (need original employee for the unified totals split)
  var oldRes = await sb.from('unified_sessions').select('*').eq('id', id).single();
  if (oldRes.error || !oldRes.data) return fail('Could not load existing session.');
  var oldRow = oldRes.data;
  var sessionEmployee = oldRow.employee;

  // Read ALL existing OT rows linked to this session (one per team member
  // from the original save). v53 the link is multi-row via source_session_id.
  var oldOtRes = await sb.from('ot_sessions')
    .select('*').eq('source', 'unified').eq('source_session_id', id);
  var oldOtRows = oldOtRes.error ? [] : (oldOtRes.data || []);
  var oldByEmp = {};
  oldOtRows.forEach(function(r){ oldByEmp[r.employee] = r; });

  // Build NEW team list (logger included, dedup'd) and pre-compute the
  // OT row for each member so we can compare against the OLD rows.
  // Customer Testing follows the team-fan-out path same as engagement-tied
  // edits — every team member listed on a CT session gets their own OT row.
  var newTeam = (isEng || isCustomerTest) ? _buildTeamList(sessionEmployee, team) : [sessionEmployee];
  var unknownMembers = [];
  var newOtByEmp = {};
  newTeam.forEach(function(name){
    var row = _buildMemberOTRow(name, date, start, end, isEng || isCustomerTest, customer, engagement, actType, info);
    if (row && row.unknown) { unknownMembers.push(row.name); return; }
    if (!row) return; // their region yields no OT
    delete row._calc;
    newOtByEmp[name] = row;
  });

  // Diff against old to figure out approved-OT impact. Anything approved
  // that will change (member dropped, times changed) needs a warning.
  var approvedAffected = [];
  oldOtRows.forEach(function(r){
    if (r.status !== 'approved') return;
    if (!newOtByEmp[r.employee]) {
      approvedAffected.push({ name:r.employee, action:'removed', hrs:r.credited_hours, band:r.band });
      return;
    }
    var n = newOtByEmp[r.employee];
    var changed = (r.start_time !== n.start_time)
      || (r.end_time   !== n.end_time)
      || (r.ot_date    !== n.ot_date)
      || (Number(r.credited_hours) !== Number(n.credited_hours))
      || (r.band !== n.band);
    if (changed) approvedAffected.push({ name:r.employee, action:'updated', hrs:r.credited_hours, band:r.band });
  });

  if (approvedAffected.length) {
    var lines = approvedAffected.map(function(a){
      return '  • '+a.name+' ('+fmtHours(a.hrs)+' '+a.band+') — '+a.action;
    }).join('\n');
    var ok = await confirmAction({
      title: 'Recalculate approved OT for '+approvedAffected.length+' team member'+(approvedAffected.length===1?'':'s')+'?',
      body: 'This session has APPROVED OT linked for:\n\n'+lines+'\n\nSaving will reset their OT to PENDING (or remove it if they are no longer on the team). The manager will need to re-approve. Comp-off balances may change.',
      confirmText: 'Save & reset to pending',
      danger: false
    });
    if (!ok) return;
  }

  // Recompute office/OT split on the session row for the LOGGER (the
  // unified_sessions row's split fields are about the session itself,
  // not per-member).
  var split = splitSessionHours(date, start, end, sessionEmployee);
  if (!split) return fail('Could not compute hours.');

  var payload = {
    session_type:    type,
    session_date:    date,
    start_time:      start,
    end_time:        end,
    session_info:    info,
    customer_name:   (isEng || isCustomerTest) ? (customer || null) : null,
    engagement_name: isEng ? (engagement || null) : null,
    engagement_id:   engId,
    activity_type:   (isEng || isInternal || isCustomerTest) ? (actType || null) : null,
    team_members:    (isEng || isInternal || isCustomerTest) ? (team || null) : null,
    stake_holders:   (isEng || isCustomerTest) ? (stake || null) : null,
    mode:            (isEng || isInternal || isCustomerTest) ? (mode || null) : null,
    remarks:         remarks,
    total_hours:     split.total,
    office_hours:    split.office,
    ot_hours:        split.ot,
  };

  var upd = await sb.from('unified_sessions').update(payload).eq('id', id);
  if (upd.error) return fail('Save failed: ' + upd.error.message);

  // === Diff old vs new OT rows per team member ===
  // For each old member missing from new   → DELETE their OT row
  // For each old member present in new     → UPDATE their OT row (reset
  //                                            to pending if was approved)
  // For each new member missing from old   → INSERT their OT row (pending)
  var approvedNotifs = [];
  for (var i = 0; i < oldOtRows.length; i++) {
    var r = oldOtRows[i];
    var nrow = newOtByEmp[r.employee];
    if (!nrow) {
      await sb.from('ot_sessions').delete().eq('id', r.id);
      if (r.status === 'approved') approvedNotifs.push({ name:r.employee, hrs:r.credited_hours, band:r.band, action:'removed' });
    } else {
      var patch = {
        activity:        nrow.activity,
        ot_date:         nrow.ot_date,
        start_time:      nrow.start_time,
        end_time:        nrow.end_time,
        day_name:        nrow.day_name,
        band:            nrow.band,
        rate:            nrow.rate,
        duration_hours:  nrow.duration_hours,
        credited_hours:  nrow.credited_hours,
        customer_name:   nrow.customer_name,
        project_name:    nrow.project_name,
        activity_type:   nrow.activity_type
      };
      if (r.status === 'approved') {
        patch.status          = 'pending';
        patch.manager_comment = null;
        patch.reviewed_by     = null;
        patch.reviewed_at     = null;
        approvedNotifs.push({ name:r.employee, hrs:r.credited_hours, band:r.band, action:'updated' });
      }
      await sb.from('ot_sessions').update(patch).eq('id', r.id);
      delete newOtByEmp[r.employee]; // mark handled
    }
  }
  // Remaining entries in newOtByEmp are members who weren't in old — insert.
  var toInsert = Object.keys(newOtByEmp).map(function(name){
    var n = newOtByEmp[name];
    n.status            = 'pending';
    n.source            = 'unified';
    n.source_session_id = id;
    return n;
  });
  if (toInsert.length) {
    await sb.from('ot_sessions').insert(toInsert);
  }

  // Notify manager once per affected approved-OT member.
  if (typeof notifyManagerOTEvent === 'function') {
    approvedNotifs.forEach(function(a){
      var verb = (a.action === 'removed') ? 'removed from a session that had APPROVED OT' : 'edited a session that had APPROVED OT';
      var msg  = a.name + ' was ' + verb + ' (' + a.hrs + 'h, ' + a.band + '). The OT row was '+ (a.action === 'removed' ? 'deleted.' : 'reset to PENDING.');
      notifyManagerOTEvent('ot_edited_after_approval', id, msg);
    });
  }
  if (unknownMembers.length) {
    setTimeout(function(){
      showError('OT not auto-generated for: ' + unknownMembers.join(', ') + ' — user not found in system.');
    }, 400);
  }

  closeEditUS();
  showToast('Session updated ✓');
  renderUSSessions();
}

// === POC / AMC SUMMARIES ======================================
// Generic renderer driven by session_type. Mirrors renderPjProjectSummary
// in shape but reads from unified_sessions and uses engagement_name as
// the grouping key.
function clearEngagementFilters() {
  ['pj-eng-from','pj-eng-to'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var t = document.getElementById('pj-eng-type'); if (t) t.value = 'all';
  renderEngagementSummary();
}

// Unified Engagement Summary — replaces the per-type summaries.
// Reads pj-eng-type / pj-eng-from / pj-eng-to / pj-eng-year. Type 'all'
// covers Project + POC + AMC + Support + Pre-Sales (excludes Internal
// which is not engagement-based).
async function renderEngagementSummary() {
  var typeEl = document.getElementById('pj-eng-type');
  var typeKey = (typeEl && typeEl.value) || 'all';

  // Year picker setup (lazy, mirrors the old per-type setup)
  var yearEl = document.getElementById('pj-eng-year');
  if (yearEl && !yearEl.options.length) {
    var allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = 'All Years'; allOpt.selected = true;
    yearEl.appendChild(allOpt);
    var thisYear = new Date().getFullYear();
    for (var y = thisYear; y >= 2023; y--) {
      var o = document.createElement('option'); o.value = y; o.textContent = y; yearEl.appendChild(o);
    }
  }
  // Dashboard "Hours by Engagement/Customer" cards stash a desired year on
  // window before navigating here. Honour it once, then clear so manual
  // dropdown changes aren't overridden on subsequent renders.
  if (yearEl && window._engSumPrefilterYear) {
    yearEl.value = window._engSumPrefilterYear;
    delete window._engSumPrefilterYear;
  }

  document.getElementById('pj-eng-loading').style.display = 'flex';
  document.getElementById('pj-eng-content').innerHTML = '';

  var fromVal = (document.getElementById('pj-eng-from')||{}).value || '';
  var toVal   = (document.getElementById('pj-eng-to')||{}).value   || '';
  var year    = (yearEl && yearEl.value) || 'all';

  // Paginated to bypass the Supabase server-side 1000-row cap so the
  // chart aggregates the full dataset, not just the first 1000 rows.
  var res = await fetchAllRows(function() {
    var q = sb.from('unified_sessions').select('*');
    if (typeKey === 'all') {
      q = q.in('session_type', ['project','poc','amc','support','presales']);
    } else {
      q = q.eq('session_type', typeKey);
    }
    if (fromVal || toVal) {
      if (fromVal) q = q.gte('session_date', fromVal);
      if (toVal)   q = q.lte('session_date', toVal);
    } else if (year && year !== 'all') {
      q = q.gte('session_date', year + '-01-01').lte('session_date', year + '-12-31');
    }
    return q;
  });
  document.getElementById('pj-eng-loading').style.display = 'none';
  var rows = res.data || [];

  var TYPE_LABELS = { project:'Project', poc:'POC', amc:'AMC', support:'Support', presales:'Pre-Sales-Task', customer_testing:'Customer Testing' };
  var typeLabel   = typeKey==='all' ? 'Engagement' : TYPE_LABELS[typeKey] || typeKey;

  if (!rows.length) {
    document.getElementById('pj-eng-content').innerHTML = renderEmptyState({
      icon: 'folder-open',
      heading: 'No '+esc2(typeLabel)+' data yet',
      sub: 'Once your team logs sessions against '+esc2(typeLabel.toLowerCase())+'s, summary stats and charts appear here.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Aggregate by engagement_name (with type when "All", so engagement names
  // that exist under multiple types stay distinct).
  var byEng = {};
  rows.forEach(function(r){
    var key = (r.engagement_name || '(unspecified)') + (typeKey==='all' ? ' · '+(TYPE_LABELS[r.session_type]||r.session_type) : '');
    if (!byEng[key]) byEng[key] = { sessions: 0, hours: 0, members: {}, customer: r.customer_name || '-', sessionType: r.session_type };
    byEng[key].sessions += 1;
    byEng[key].hours    += parseFloat(r.total_hours || 0);
    // v123: mirrors the v119 fix from renderPjEmployeeSummary. Previously
    // the else-if path only credited the logger when team_members was
    // empty — sessions where a user logged but their own name wasn't in
    // team_members dropped the logger from the per-engagement breakdown.
    // Build a deduped credit set: team_members ∪ {logger}. Each unique
    // name gets credited once per session; engagement total is unaffected
    // (it's summed independently above).
    var hrs = parseFloat(r.total_hours || 0);
    var people = {};
    if (r.team_members) {
      r.team_members.split(',').forEach(function(name){
        name = name.trim();
        if (name) people[name] = true;
      });
    }
    if (r.employee) people[r.employee] = true;
    Object.keys(people).forEach(function(name){
      byEng[key].members[name] = (byEng[key].members[name] || 0) + hrs;
    });
  });
  var sorted = Object.keys(byEng).sort(function(a,b){ return byEng[b].hours - byEng[a].hours; });
  var totalHours    = sorted.reduce(function(s,k){ return s + byEng[k].hours; }, 0);
  var totalSessions = sorted.reduce(function(s,k){ return s + byEng[k].sessions; }, 0);

  // Aggregate by customer
  var byCust = {};
  rows.forEach(function(r){
    var cust = (r.customer_name || '').trim() || '(no customer)';
    if (!byCust[cust]) byCust[cust] = { hours: 0, sessions: 0 };
    byCust[cust].hours    += parseFloat(r.total_hours || 0);
    byCust[cust].sessions += 1;
  });
  var sortedCust = Object.keys(byCust).sort(function(a,b){ return byCust[b].hours - byCust[a].hours; });

  var TYPE_BADGE = {
    project:  '<span class="badge" style="background:#EFF6FF;color:#2563EB">PROJECT</span>',
    poc:      '<span class="badge" style="background:#F5F3FF;color:#7C3AED">POC</span>',
    amc:      '<span class="badge" style="background:#FFFBEB;color:#B45309">AMC</span>',
    support:  '<span class="badge" style="background:#FFF1F2;color:#9F1239">SUPPORT</span>',
    presales: '<span class="badge" style="background:#FDF2F8;color:#BE185D">PRE-SALES-TASK</span>'
  };

  var tableRows = sorted.map(function(name){
    var d = byEng[name];
    var cleanName = name.replace(/ · (Project|POC|AMC|Support|Pre-Sales-Task)$/, '');
    var memberBreakdown = Object.keys(d.members).map(function(m){
      var label = (typeof empShortName === 'function') ? empShortName(m) : m.split(' ')[0];
      return '<span class="badge" style="background:#f0f4ff;color:var(--navy);margin:1px">'+label+': '+fmtHours(d.members[m])+'</span>';
    }).join(' ');
    var typeBadge = (typeKey==='all') ? (TYPE_BADGE[d.sessionType]||'') : '';
    return '<tr>'+
      '<td><strong>'+esc2(cleanName)+'</strong>'+(typeBadge?' '+typeBadge:'')+'</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+esc2(d.customer)+'</td>'+
      '<td style="font-family:DM Mono,monospace">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:15px">'+fmtHours(d.hours)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px;color:var(--muted)">'+fmtDays(d.hours/8)+'</td>'+
      '<td style="font-size:12px">'+memberBreakdown+'</td>'+
    '</tr>';
  }).join('');

  var PIE_COLORS = ['#0A1F5C','#00A0D2','#C8A832','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444'];
  var pieData = sorted.slice(0,8).map(function(name,i){
    var clean = name.replace(/ · (Project|POC|AMC|Support|Pre-Sales-Task)$/, '');
    return { label: clean, value: byEng[name].hours, color: PIE_COLORS[i%PIE_COLORS.length] };
  });
  var custPieData = sortedCust.slice(0,8).map(function(cust,i){
    return { label: cust, value: byCust[cust].hours, color: PIE_COLORS[i%PIE_COLORS.length] };
  });
  var pie     = (typeof buildPieChart === 'function') ? buildPieChart(pieData,     'h') : '';
  var custPie = (typeof buildPieChart === 'function') ? buildPieChart(custPieData, 'h') : '';

  // Hours by Vendor + Product Line — join sessions to their engagement via
  // (engagement_name + session_type) to pick up the vendor/product_line text
  // stored on the engagement. Sessions whose engagement has NULL vendor get
  // bucketed as "(no vendor)" so historical rows still surface here.
  var engByKey = {};
  (ENGAGEMENTS||[]).forEach(function(e){
    engByKey[e.name + '||' + e.type] = e;
  });
  var byVendor = {}, byProductLine = {};
  rows.forEach(function(r){
    var hrs = parseFloat(r.total_hours || 0);
    var eng = engByKey[(r.engagement_name||'') + '||' + r.session_type];
    var v   = (eng && eng.vendor)       ? eng.vendor       : '(no vendor)';
    var p   = (eng && eng.product_line) ? eng.product_line : '(no product line)';
    byVendor[v]      = (byVendor[v]||0)      + hrs;
    byProductLine[p] = (byProductLine[p]||0) + hrs;
  });
  var sortedVendor      = Object.keys(byVendor)     .sort(function(a,b){ return byVendor[b]      - byVendor[a]; });
  var sortedProductLine = Object.keys(byProductLine).sort(function(a,b){ return byProductLine[b] - byProductLine[a]; });
  var vendorPieData = sortedVendor.slice(0,8).map(function(v,i){
    return { label: v, value: byVendor[v], color: PIE_COLORS[i%PIE_COLORS.length] };
  });
  var plPieData = sortedProductLine.slice(0,8).map(function(p,i){
    return { label: p, value: byProductLine[p], color: PIE_COLORS[i%PIE_COLORS.length] };
  });
  var vendorPie = (typeof buildPieChart === 'function') ? buildPieChart(vendorPieData, 'h') : '';
  var plPie     = (typeof buildPieChart === 'function') ? buildPieChart(plPieData,     'h') : '';

  // Type-mix mini-bar (only when All Types is selected)
  var typeMixHtml = '';
  if (typeKey === 'all') {
    var byType = { project:0, poc:0, amc:0, support:0, presales:0 };
    rows.forEach(function(r){ if (byType[r.session_type] !== undefined) byType[r.session_type] += parseFloat(r.total_hours||0); });
    var mixTotal = byType.project + byType.poc + byType.amc + byType.support + byType.presales;
    if (mixTotal > 0) {
      var seg = function(k, color, label){
        var pct = (byType[k]/mixTotal)*100;
        if (pct < 0.5) return '';
        return '<div style="background:'+color+';height:100%;width:'+pct.toFixed(2)+'%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700" title="'+label+': '+fmtHours(byType[k])+' ('+fmtPct(pct)+')">'+(pct>=8?fmtPct(pct):'')+'</div>';
      };
      typeMixHtml =
        '<div class="card" style="margin-bottom:20px"><div class="card-title">Time Mix Across Types</div>'+
          '<div style="display:flex;height:28px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:#f1f5f9">'+
            seg('project',  '#2563EB','Project')+
            seg('poc',      '#7C3AED','POC')+
            seg('amc',      '#B45309','AMC')+
            seg('support',  '#9F1239','Support')+
            seg('presales', '#BE185D','Pre-Sales-Task')+
          '</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:var(--muted)">'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#2563EB;border-radius:2px;margin-right:6px;vertical-align:middle"></span>Project '+fmtHours(byType.project)+'</span>'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#7C3AED;border-radius:2px;margin-right:6px;vertical-align:middle"></span>POC '+fmtHours(byType.poc)+'</span>'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#B45309;border-radius:2px;margin-right:6px;vertical-align:middle"></span>AMC '+fmtHours(byType.amc)+'</span>'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#9F1239;border-radius:2px;margin-right:6px;vertical-align:middle"></span>Support '+fmtHours(byType.support)+'</span>'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#BE185D;border-radius:2px;margin-right:6px;vertical-align:middle"></span>Pre-Sales-Task '+fmtHours(byType.presales)+'</span>'+
          '</div>'+
        '</div>';
    }
  }

  var rangeNote = (fromVal || toVal)
    ? 'Period: ' + (fromVal || '…') + ' → ' + (toVal || '…')
    : ('Year: ' + (year==='all' ? 'All Years' : year));
  var typeNote  = typeKey==='all' ? 'All engagement types' : (TYPE_LABELS[typeKey] + ' only');

  document.getElementById('pj-eng-content').innerHTML =
    typeMixHtml +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
      '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by '+esc2(typeLabel)+' (Top 8)</div>'+pie+'</div>'+
      '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by Customer (Top 8)</div>'+custPie+'</div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
      '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by Vendor (Top 8)</div>'+vendorPie+'</div>'+
      '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by Product Line (Top 8)</div>'+plPie+'</div>'+
    '</div>'+
    '<div class="card" style="margin-bottom:20px"><div class="card-title">Quick Stats</div>'+
      '<div class="summary-grid">'+
        '<div class="stat-card navy"><div class="stat-label">Total '+esc2(typeLabel)+'s</div><div class="stat-value">'+sorted.length+'</div></div>'+
        '<div class="stat-card teal"><div class="stat-label">Total Hours</div><div class="stat-value" style="font-size:20px">'+fmtHours(totalHours)+'</div></div>'+
        '<div class="stat-card eve"><div class="stat-label">Total Sessions</div><div class="stat-value">'+fmtCount(totalSessions)+'</div></div>'+
        '<div class="stat-card wknd"><div class="stat-label">Total Customers</div><div class="stat-value">'+fmtCount(sortedCust.length)+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div class="table-wrap"><table>'+
      '<thead><tr><th>Engagement</th><th>Customer</th><th>Sessions</th><th>Total Hours</th><th>Working Days</th><th>Team Breakdown</th></tr></thead>'+
      '<tbody>'+tableRows+'</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">'+typeNote+' &middot; '+rangeNote+' &middot; Working days = hours / 8</div>';
}

async function renderUnifiedTypeSummary(typeKey) {
  var ids = {
    project:  { year: 'pj-sum-year',      from: 'pj-sum-from',      to: 'pj-sum-to',      loading: 'pj-project-loading',  content: 'pj-project-content',  heading: 'Project' },
    poc:      { year: 'pj-poc-year',      from: 'pj-poc-from',      to: 'pj-poc-to',      loading: 'pj-poc-loading',      content: 'pj-poc-content',      heading: 'POC Engagements' },
    amc:      { year: 'pj-amc-year',      from: 'pj-amc-from',      to: 'pj-amc-to',      loading: 'pj-amc-loading',      content: 'pj-amc-content',      heading: 'AMC Engagements' },
    support:  { year: 'pj-support-year',  from: 'pj-support-from',  to: 'pj-support-to',  loading: 'pj-support-loading',  content: 'pj-support-content',  heading: 'Support Engagements' },
    presales: { year: 'pj-presales-year', from: 'pj-presales-from', to: 'pj-presales-to', loading: 'pj-presales-loading', content: 'pj-presales-content', heading: 'Pre-Sales-Task Engagements' },
  };
  var ui = ids[typeKey];
  if (!ui) return;

  // Year picker setup
  var yearEl = document.getElementById(ui.year);
  if (yearEl && !yearEl.options.length) {
    var allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = 'All Years'; allOpt.selected = true;
    yearEl.appendChild(allOpt);
    var thisYear = new Date().getFullYear();
    for (var y = thisYear; y >= 2023; y--) {
      var o = document.createElement('option'); o.value = y; o.textContent = y; yearEl.appendChild(o);
    }
  }

  document.getElementById(ui.loading).style.display = 'flex';
  document.getElementById(ui.content).innerHTML = '';

  // Date range overrides the year picker. Empty range falls back to year.
  var fromVal = ui.from ? ((document.getElementById(ui.from)||{}).value || '') : '';
  var toVal   = ui.to   ? ((document.getElementById(ui.to)||{}).value   || '') : '';
  var year = (yearEl && yearEl.value) || 'all';
  // Paginated to bypass the Supabase server-side 1000-row cap.
  var res = await fetchAllRows(function() {
    var q = sb.from('unified_sessions').select('*').eq('session_type', typeKey);
    if (fromVal || toVal) {
      if (fromVal) q = q.gte('session_date', fromVal);
      if (toVal)   q = q.lte('session_date', toVal);
    } else if (year && year !== 'all') {
      q = q.gte('session_date', year + '-01-01').lte('session_date', year + '-12-31');
    }
    return q;
  });
  document.getElementById(ui.loading).style.display = 'none';
  var rows = res.data || [];

  if (!rows.length) {
    document.getElementById(ui.content).innerHTML = renderEmptyState({
      icon: 'folder-open',
      heading: 'No '+typeKey.toUpperCase()+' data yet for '+year,
      sub: 'Once team members log '+typeKey.toUpperCase()+' sessions, summary stats and charts appear here.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Aggregate by engagement_name
  var byEng = {};
  rows.forEach(function(r){
    var key = r.engagement_name || '(unspecified)';
    if (!byEng[key]) byEng[key] = { sessions: 0, hours: 0, members: {}, customer: r.customer_name || '-' };
    byEng[key].sessions += 1;
    byEng[key].hours += parseFloat(r.total_hours || 0);
    if (r.team_members) {
      r.team_members.split(',').forEach(function(name){
        name = name.trim();
        if (!name) return;
        byEng[key].members[name] = (byEng[key].members[name] || 0) + parseFloat(r.total_hours || 0);
      });
    } else if (r.employee) {
      byEng[key].members[r.employee] = (byEng[key].members[r.employee] || 0) + parseFloat(r.total_hours || 0);
    }
  });

  var sorted = Object.keys(byEng).sort(function(a,b){ return byEng[b].hours - byEng[a].hours; });
  var totalHours = sorted.reduce(function(s,k){ return s + byEng[k].hours; }, 0);
  var totalSessions = sorted.reduce(function(s,k){ return s + byEng[k].sessions; }, 0);

  var tableRows = sorted.map(function(name){
    var d = byEng[name];
    var memberBreakdown = Object.keys(d.members).map(function(m){
      var label = (typeof empShortName === 'function') ? empShortName(m) : m.split(' ')[0];
      return '<span class="badge" style="background:#f0f4ff;color:var(--navy);margin:1px">'+label+': '+fmtHours(d.members[m])+'</span>';
    }).join(' ');
    return '<tr>'+
      '<td><strong>'+esc2(name)+'</strong></td>'+
      '<td style="font-size:12px;color:var(--muted)">'+esc2(d.customer)+'</td>'+
      '<td style="font-family:DM Mono,monospace">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:15px">'+fmtHours(d.hours)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px;color:var(--muted)">'+fmtDays(d.hours/8)+'</td>'+
      '<td style="font-size:12px">'+memberBreakdown+'</td>'+
    '</tr>';
  }).join('');

  var PIE_COLORS = ['#0A1F5C','#00A0D2','#C8A832','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444'];
  var pieData = sorted.slice(0,8).map(function(name,i){
    return { label: name, value: byEng[name].hours, color: PIE_COLORS[i%PIE_COLORS.length] };
  });

  // Aggregate by customer for the second pie
  var byCust = {};
  rows.forEach(function(r){
    var cust = (r.customer_name || '').trim() || '(no customer)';
    if (!byCust[cust]) byCust[cust] = { hours: 0, sessions: 0 };
    byCust[cust].hours    += parseFloat(r.total_hours || 0);
    byCust[cust].sessions += 1;
  });
  var sortedCust = Object.keys(byCust).sort(function(a,b){ return byCust[b].hours - byCust[a].hours; });
  var custPieData = sortedCust.slice(0,8).map(function(cust,i){
    return { label: cust, value: byCust[cust].hours, color: PIE_COLORS[i%PIE_COLORS.length] };
  });

  var pie     = (typeof buildPieChart === 'function') ? buildPieChart(pieData,     'h') : '';
  var custPie = (typeof buildPieChart === 'function') ? buildPieChart(custPieData, 'h') : '';

  // Footnote: prefer the date range over the year if a range is set
  var rangeNote = (fromVal || toVal)
    ? 'Period: ' + (fromVal || '…') + ' → ' + (toVal || '…')
    : ('Year: ' + (year==='all' ? 'All Years' : year));

  document.getElementById(ui.content).innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
      '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by '+ui.heading+' (Top 8)</div>'+pie+'</div>'+
      '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by Customer (Top 8)</div>'+custPie+'</div>'+
    '</div>'+
    '<div class="card" style="margin-bottom:20px"><div class="card-title">Quick Stats</div>'+
      '<div class="summary-grid">'+
        '<div class="stat-card navy"><div class="stat-label">Total '+typeKey.toUpperCase()+'s</div><div class="stat-value">'+fmtCount(sorted.length)+'</div></div>'+
        '<div class="stat-card teal"><div class="stat-label">Total Hours</div><div class="stat-value" style="font-size:20px">'+fmtHours(totalHours)+'</div></div>'+
        '<div class="stat-card eve"><div class="stat-label">Total Sessions</div><div class="stat-value">'+fmtCount(totalSessions)+'</div></div>'+
        '<div class="stat-card wknd"><div class="stat-label">Total Customers</div><div class="stat-value">'+fmtCount(sortedCust.length)+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div class="table-wrap"><table>'+
      '<thead><tr><th>Engagement</th><th>Customer</th><th>Sessions</th><th>Total Hours</th><th>Working Days</th><th>Team Breakdown</th></tr></thead>'+
      '<tbody>'+tableRows+'</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">'+rangeNote+' &middot; Working days = hours / 8</div>';
}

async function deleteUS(id) {
  if (!await requireAuth()) return;
  // Read the session row (for employee/audit) + ALL linked OT rows
  // (v53 the link is multi-row via source_session_id, not a single FK).
  var sessRes = await sb.from('unified_sessions').select('employee').eq('id', id).single();
  if (sessRes.error) { showError('Could not load session.'); return; }
  var sessionEmployee = sessRes.data.employee;

  var otRes = await sb.from('ot_sessions')
    .select('id,employee,status,credited_hours,band')
    .eq('source', 'unified').eq('source_session_id', id);
  var linkedOTs = otRes.error ? [] : (otRes.data || []);
  var approved  = linkedOTs.filter(function(r){ return r.status === 'approved'; });

  var dOpts = { title: 'Delete this session?', body: 'This cannot be undone.', confirmText: 'Delete' };
  if (approved.length) {
    var lines = approved.map(function(a){ return '  • '+a.employee+' ('+fmtHours(a.credited_hours)+' '+a.band+')'; }).join('\n');
    dOpts.title = 'Delete session with approved OT?';
    dOpts.body  = 'This session has APPROVED OT linked for:\n\n'+lines+'\n\nDeleting will remove '+(approved.length===1?'that':'all those')+' OT row'+(approved.length===1?'':'s')+', reducing comp-off balance'+(approved.length===1?'':'s').slice(0,-1)+(approved.length===1?'':'s')+'.\n\nThis cannot be undone.';
  } else if (linkedOTs.length) {
    dOpts.body = 'The '+linkedOTs.length+' linked pending OT record'+(linkedOTs.length===1?'':'s')+' will also be deleted.\n\nThis cannot be undone.';
  }
  if (!await confirmAction(dOpts)) return;

  // Delete linked OT rows (cascaded via source_session_id query, not FK).
  if (linkedOTs.length) {
    await sb.from('ot_sessions').delete().eq('source','unified').eq('source_session_id', id);
  }
  var del = await sb.from('unified_sessions').delete().eq('id', id);
  if (del.error) { showError('Error: ' + del.error.message); return; }

  // Notify manager once per approved-OT member that was wiped.
  if (typeof notifyManagerOTEvent === 'function') {
    approved.forEach(function(a){
      var msg = sessionEmployee + ' deleted a session that had APPROVED OT for ' + a.employee + ' (' + a.credited_hours + 'h, ' + a.band + '). The credit has been removed from their balance.';
      notifyManagerOTEvent('ot_deleted_after_approval', id, msg);
    });
  }

  showToast('Session deleted ✓');
  renderUSSessions();
}
