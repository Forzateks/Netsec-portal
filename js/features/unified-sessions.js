// == UNIFIED SESSIONS (Phase 2 - Beta) ==========================
// Single form for Project / POC / AMC / Internal session logging.
// Phase 2 only persists; OT integration arrives in Phase 3.

const SESSION_TYPE_BADGES = {
  project:  { bg: '#EFF6FF', color: '#2563EB', label: '📁 Project' },
  poc:      { bg: '#F5F3FF', color: '#7C3AED', label: '🎯 POC' },
  amc:      { bg: '#FFFBEB', color: '#B45309', label: '🛠️ AMC' },
  presales: { bg: '#FDF2F8', color: '#BE185D', label: '💼 Pre-Sales' },
  internal: { bg: '#F3F4F6', color: '#6B7280', label: '🔧 Internal' },
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
function onUSTypeChange() {
  var type = document.getElementById('us-type').value;
  var isEng = (type === 'project' || type === 'poc' || type === 'amc' || type === 'presales');
  var engRow = document.getElementById('us-engagement-row');
  if (engRow) engRow.style.display = isEng ? '' : 'none';
  var actRow = document.getElementById('us-activity-row');
  if (actRow) actRow.style.display = isEng ? '' : 'none';
  var stkRow = document.getElementById('us-stake-row');
  if (stkRow) stkRow.style.display = isEng ? '' : 'none';
  var modeRow = document.getElementById('us-mode-row');
  if (modeRow) modeRow.style.display = isEng ? '' : 'none';
  var teamRow = document.getElementById('us-team-row');
  if (teamRow) teamRow.style.display = isEng ? '' : 'none';

  // Repopulate engagement dropdown filtered by selected type
  if (isEng) populateUSEngagementDropdown();
  updateUSPreview();
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
}

function updateUSPreview() {
  var date  = document.getElementById('us-date').value;
  var start = document.getElementById('us-start').value;
  var end   = document.getElementById('us-end').value;
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
  totEl.textContent = split.total + 'h';
  offEl.textContent = split.office + 'h';
  if (split.ot > 0 && split.otCalc) {
    var c = split.otCalc;
    otEl.textContent = split.ot + 'h  →  ' + c.band + ' · ' + c.rate + ' · credited ' + c.credited + 'h (pending approval)';
    otEl.style.color = 'var(--gold)';
  } else {
    otEl.textContent = 'none';
    otEl.style.color = 'var(--muted)';
  }
}

async function saveUnifiedSession() {
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

  var isEng = (type === 'project' || type === 'poc' || type === 'amc' || type === 'presales');
  if (isEng) {
    if (!customer)  return fail('Please pick a customer.');
    if (!engId)     return fail('Please pick an engagement.');
    if (!actType)   return fail('Please pick an activity type.');
    if (!teamMembers) return fail('Pick at least one team member.');
  }
  if (!info) return fail('Session info is required.');

  // Engagement snapshot (name) for non-internal
  var engagement_name = null;
  if (isEng && engId) {
    var engRow = (ENGAGEMENTS||[]).find(function(e){ return String(e.id) === String(engId); });
    if (engRow) engagement_name = engRow.name;
  }

  // Compute office vs OT split using the existing OT policy
  var split = splitSessionHours(date, start, end, currentUser);
  if (!split) return fail('Could not compute hours.');

  var btn = document.getElementById('us-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  var payload = {
    employee:      currentUser,
    session_date:  date,
    start_time:    start,
    end_time:      end,
    session_type:  type,
    engagement_id: isEng && engId ? Number(engId) : null,
    customer_name: isEng ? (customer || null) : null,
    engagement_name: engagement_name,
    activity_type: isEng ? (actType || null) : null,
    session_info:  info,
    team_members:  isEng ? teamMembers : null,
    stake_holders: isEng ? (stakeH || null) : null,
    mode:          isEng ? (mode || null) : null,
    remarks:       remarks || null,
    total_hours:   split.total,
    office_hours:  split.office,
    ot_hours:      split.ot,
  };

  var res = await sb.from('unified_sessions').insert(payload).select().single();
  if (res.error) {
    btn.disabled = false; btn.innerHTML = '💾 Save Session';
    return fail('Save failed: ' + res.error.message);
  }
  var unifiedId = res.data.id;

  // If OT detected, auto-create the linked ot_sessions record
  var otSummary = '';
  if (split.ot > 0 && split.otCalc) {
    var c = split.otCalc;
    var activityLabel = isEng
      ? ((customer || '') + ' / ' + (engagement_name || '-') + ' — ' + info)
      : info;
    var otRow = {
      employee:          currentUser,
      activity:          activityLabel,
      ot_date:           date,
      start_time:        start,
      end_time:          end,
      day_name:          c.dayName,
      band:              c.band,
      rate:              c.rate,
      duration_hours:    c.duration,
      credited_hours:    c.credited,
      status:            'pending',
      source:            'unified',
      source_session_id: unifiedId,
      customer_name:     isEng ? (customer || null) : null,
      project_name:      isEng ? engagement_name : null,
      activity_type:     isEng ? (actType || null) : null,
    };
    var otRes = await sb.from('ot_sessions').insert(otRow).select().single();
    if (otRes.error) {
      console.error('Linked OT creation failed:', otRes.error);
      otSummary = ' (warning: linked OT record could not be created — '+otRes.error.message+')';
    } else {
      // Stamp the unified row with the new OT id
      await sb.from('unified_sessions').update({ linked_ot_session_id: otRes.data.id }).eq('id', unifiedId);
      otSummary = ' · ' + c.band + ' OT ' + c.credited + 'h pending approval';
    }
  }

  btn.disabled = false; btn.innerHTML = '💾 Save Session';

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

  // Update alert text to summarize what was saved
  var successEl = document.getElementById('us-success');
  if (successEl) successEl.textContent = '✅ Session saved' + otSummary;
  showAlert('us-success');
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
  var q = sb.from('unified_sessions').select('*').order('created_at',{ascending:false,nullsFirst:false}).order('session_date',{ascending:false}).order('start_time',{ascending:false});
  if (fType) q = q.eq('session_type', fType);
  if (fCust) q = q.eq('customer_name', fCust);
  if (fEng)  q = q.eq('engagement_name', fEng);
  if (fFrom) q = q.gte('session_date', fFrom);
  if (fTo)   q = q.lte('session_date', fTo);
  var res = await q;
  document.getElementById('us-sess-loading').style.display = 'none';
  var rows = res.data || [];

  if (fMem) {
    var firstName = fMem.split(' ')[0].toLowerCase();
    rows = rows.filter(function(r){ return (r.team_members||r.employee||'').toLowerCase().includes(firstName); });
  }
  if (!rows.length) { document.getElementById('us-sess-empty').style.display = 'block'; return; }

  document.getElementById('us-sess-table').style.display = 'block';
  document.getElementById('us-sess-tbody').innerHTML = rows.map(function(r,i){
    var canEdit = isManager || (r.employee === currentUser);
    var t = SESSION_TYPE_BADGES[r.session_type] || {bg:'#F3F4F6',color:'#6B7280',label:r.session_type||'-'};
    return '<tr>'+
      '<td style="color:var(--muted);font-size:12px">'+(i+1)+'</td>'+
      '<td><span class="badge" style="background:'+t.bg+';color:'+t.color+'">'+t.label+'</span></td>'+
      '<td style="font-size:12px;color:var(--navy);font-weight:600">'+(r.customer_name||'-')+'</td>'+
      '<td style="font-size:12px"><strong>'+(r.engagement_name||'-')+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtDate(r.session_date)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtTime(r.start_time)+'-'+fmtTime(r.end_time)+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+r.total_hours+'h</td>'+
      '<td><span class="badge" style="background:#f0f4ff;color:var(--navy);font-size:11px">'+(r.activity_type||'-')+'</span></td>'+
      '<td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+(r.session_info||'')+'">'+(r.session_info||'-')+'</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+(r.employee||'-')+'</td>'+
      '<td style="white-space:nowrap">'+
        (canEdit ? '<button class="btn btn-sm btn-ghost" onclick="openEditUS('+r.id+')" style="margin-right:4px">✏️</button><button class="btn btn-sm btn-danger" onclick="deleteUS('+r.id+')">✕</button>' : '')+
      '</td>'+
      '</tr>';
  }).join('');
  // Synced top horizontal scrollbar so the user can scroll the wide table
  // without having to scroll the page to find the bottom scrollbar.
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
  if (res.error || !res.data) { alert('Could not load session.'); return; }
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
  // Populate dropdowns
  fillCustomerSelect('edit-us-customer', false);
  fillActivitySelect('edit-us-activity-type');
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
  document.getElementById('edit-unified-modal').classList.add('show');
}

function closeEditUS() {
  document.getElementById('edit-unified-modal').classList.remove('show');
}

async function saveEditUS() {
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

  var isEng = (type === 'project' || type === 'poc' || type === 'amc' || type === 'presales');
  var engId = null;
  if (isEng && engagement) {
    var engRow = (ENGAGEMENTS||[]).find(function(e){ return e.name === engagement && e.type === type; });
    if (engRow) engId = engRow.id;
  }

  // Read OLD row (need original employee for region-correct OT split + linked OT id)
  var oldRes = await sb.from('unified_sessions').select('*').eq('id', id).single();
  if (oldRes.error || !oldRes.data) return fail('Could not load existing session.');
  var oldRow = oldRes.data;
  var sessionEmployee = oldRow.employee;
  var oldOtId = oldRow.linked_ot_session_id;

  // Read OLD linked OT row (if any) so we can detect approved status
  var oldOt = null;
  if (oldOtId) {
    var oldOtRes = await sb.from('ot_sessions').select('*').eq('id', oldOtId).single();
    if (!oldOtRes.error) oldOt = oldOtRes.data;
  }

  // Recompute hours under the session OWNER's region (not currentUser - manager edits!)
  var split = splitSessionHours(date, start, end, sessionEmployee);
  if (!split) return fail('Could not compute hours.');

  // Approved-OT warning
  var wasApproved = !!(oldOt && oldOt.status === 'approved');
  if (wasApproved) {
    var msg = 'WARNING: This session has APPROVED OT linked to it ('+oldOt.credited_hours+'h credited).\n\nSaving will recalculate the OT and reset its status to PENDING. The manager will need to re-approve it. Comp-off balance for ' + sessionEmployee + ' may change.\n\nContinue?';
    if (!confirm(msg)) return;
  }

  var payload = {
    session_type:    type,
    session_date:    date,
    start_time:      start,
    end_time:        end,
    session_info:    info,
    customer_name:   isEng ? (customer || null) : null,
    engagement_name: isEng ? (engagement || null) : null,
    engagement_id:   engId,
    activity_type:   isEng ? (actType || null) : null,
    team_members:    isEng ? team : null,
    stake_holders:   isEng ? stake : null,
    mode:            isEng ? mode : null,
    remarks:         remarks,
    total_hours:     split.total,
    office_hours:    split.office,
    ot_hours:        split.ot,
  };

  var upd = await sb.from('unified_sessions').update(payload).eq('id', id);
  if (upd.error) return fail('Save failed: ' + upd.error.message);

  // === Cascade to linked ot_sessions ===
  var activityLabel = isEng
    ? ((customer || '') + ' / ' + (engagement || '-') + ' — ' + info)
    : info;

  if (split.ot > 0 && split.otCalc) {
    var c = split.otCalc;
    var otPayload = {
      activity:       activityLabel,
      ot_date:        date,
      start_time:     start,
      end_time:       end,
      day_name:       c.dayName,
      band:           c.band,
      rate:           c.rate,
      duration_hours: c.duration,
      credited_hours: c.credited,
      customer_name:  isEng ? (customer || null) : null,
      project_name:   isEng ? (engagement || null) : null,
      activity_type:  isEng ? (actType || null) : null,
    };
    if (oldOt && oldOt.status === 'approved') {
      // Reset to pending — manager re-approves
      otPayload.status          = 'pending';
      otPayload.manager_comment = null;
      otPayload.reviewed_by     = null;
      otPayload.reviewed_at     = null;
    }
    if (oldOtId) {
      // Update existing OT row
      await sb.from('ot_sessions').update(otPayload).eq('id', oldOtId);
    } else {
      // Create a new OT row (session previously had no OT)
      otPayload.employee          = sessionEmployee;
      otPayload.status            = 'pending';
      otPayload.source            = 'unified';
      otPayload.source_session_id = id;
      var ins = await sb.from('ot_sessions').insert(otPayload).select().single();
      if (!ins.error) {
        await sb.from('unified_sessions').update({ linked_ot_session_id: ins.data.id }).eq('id', id);
      }
    }
  } else if (oldOtId) {
    // No more OT — delete the now-stale OT row
    await sb.from('ot_sessions').delete().eq('id', oldOtId);
    await sb.from('unified_sessions').update({ linked_ot_session_id: null }).eq('id', id);
  }

  // Notify manager if an approved OT was just reset
  if (wasApproved && typeof notifyManagerOTEvent === 'function') {
    var notifMsg = sessionEmployee + ' edited a session that had APPROVED OT (' + oldOt.credited_hours + 'h, ' + oldOt.band + '). It is now PENDING again — please review.';
    notifyManagerOTEvent('ot_edited_after_approval', id, notifMsg);
  }

  closeEditUS();
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

// Unified Engagement Summary — replaces the four per-type summaries.
// Reads pj-eng-type / pj-eng-from / pj-eng-to / pj-eng-year. Type 'all'
// covers Project + POC + AMC + Pre-Sales (excludes Internal which is not
// engagement-based).
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

  document.getElementById('pj-eng-loading').style.display = 'flex';
  document.getElementById('pj-eng-content').innerHTML = '';

  var fromVal = (document.getElementById('pj-eng-from')||{}).value || '';
  var toVal   = (document.getElementById('pj-eng-to')||{}).value   || '';
  var year    = (yearEl && yearEl.value) || 'all';

  var q = sb.from('unified_sessions').select('*');
  if (typeKey === 'all') {
    q = q.in('session_type', ['project','poc','amc','presales']);
  } else {
    q = q.eq('session_type', typeKey);
  }
  if (fromVal || toVal) {
    if (fromVal) q = q.gte('session_date', fromVal);
    if (toVal)   q = q.lte('session_date', toVal);
  } else if (year && year !== 'all') {
    q = q.gte('session_date', year + '-01-01').lte('session_date', year + '-12-31');
  }
  var res = await q;
  document.getElementById('pj-eng-loading').style.display = 'none';
  var rows = res.data || [];

  var TYPE_LABELS = { project:'Project', poc:'POC', amc:'AMC', presales:'Pre-Sales' };
  var typeLabel   = typeKey==='all' ? 'Engagement' : TYPE_LABELS[typeKey] || typeKey;

  if (!rows.length) {
    document.getElementById('pj-eng-content').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📊</div>'+
      '<div class="empty-title">No '+esc2(typeLabel)+' sessions in this period</div></div>';
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
    presales: '<span class="badge" style="background:#FDF2F8;color:#BE185D">PRE-SALES</span>'
  };

  var tableRows = sorted.map(function(name){
    var d = byEng[name];
    var cleanName = name.replace(/ · (Project|POC|AMC|Pre-Sales)$/, '');
    var memberBreakdown = Object.keys(d.members).map(function(m){
      var label = (typeof empShortName === 'function') ? empShortName(m) : m.split(' ')[0];
      return '<span class="badge" style="background:#f0f4ff;color:var(--navy);margin:1px">'+label+': '+r2(d.members[m])+'h</span>';
    }).join(' ');
    var typeBadge = (typeKey==='all') ? (TYPE_BADGE[d.sessionType]||'') : '';
    return '<tr>'+
      '<td><strong>'+esc2(cleanName)+'</strong>'+(typeBadge?' '+typeBadge:'')+'</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+esc2(d.customer)+'</td>'+
      '<td style="font-family:DM Mono,monospace">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:15px">'+r2(d.hours)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px;color:var(--muted)">'+r2(d.hours/8)+' days</td>'+
      '<td style="font-size:12px">'+memberBreakdown+'</td>'+
    '</tr>';
  }).join('');

  var PIE_COLORS = ['#0A1F5C','#00A0D2','#C8A832','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444'];
  var pieData = sorted.slice(0,8).map(function(name,i){
    var clean = name.replace(/ · (Project|POC|AMC|Pre-Sales)$/, '');
    return { label: clean, value: byEng[name].hours, color: PIE_COLORS[i%PIE_COLORS.length] };
  });
  var custPieData = sortedCust.slice(0,8).map(function(cust,i){
    return { label: cust, value: byCust[cust].hours, color: PIE_COLORS[i%PIE_COLORS.length] };
  });
  var pie     = (typeof buildPieChart === 'function') ? buildPieChart(pieData,     'h') : '';
  var custPie = (typeof buildPieChart === 'function') ? buildPieChart(custPieData, 'h') : '';

  // Type-mix mini-bar (only when All Types is selected)
  var typeMixHtml = '';
  if (typeKey === 'all') {
    var byType = { project:0, poc:0, amc:0, presales:0 };
    rows.forEach(function(r){ if (byType[r.session_type] !== undefined) byType[r.session_type] += parseFloat(r.total_hours||0); });
    var mixTotal = byType.project + byType.poc + byType.amc + byType.presales;
    if (mixTotal > 0) {
      var seg = function(k, color, label){
        var pct = (byType[k]/mixTotal)*100;
        if (pct < 0.5) return '';
        return '<div style="background:'+color+';height:100%;width:'+pct.toFixed(2)+'%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700" title="'+label+': '+r2(byType[k])+'h ('+pct.toFixed(0)+'%)">'+(pct>=8?Math.round(pct)+'%':'')+'</div>';
      };
      typeMixHtml =
        '<div class="card" style="margin-bottom:20px"><div class="card-title">Time Mix Across Types</div>'+
          '<div style="display:flex;height:28px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:#f1f5f9">'+
            seg('project',  '#2563EB','Project')+
            seg('poc',      '#7C3AED','POC')+
            seg('amc',      '#B45309','AMC')+
            seg('presales', '#BE185D','Pre-Sales')+
          '</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:var(--muted)">'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#2563EB;border-radius:2px;margin-right:6px;vertical-align:middle"></span>Project '+r2(byType.project)+'h</span>'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#7C3AED;border-radius:2px;margin-right:6px;vertical-align:middle"></span>POC '+r2(byType.poc)+'h</span>'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#B45309;border-radius:2px;margin-right:6px;vertical-align:middle"></span>AMC '+r2(byType.amc)+'h</span>'+
            '<span><span style="display:inline-block;width:10px;height:10px;background:#BE185D;border-radius:2px;margin-right:6px;vertical-align:middle"></span>Pre-Sales '+r2(byType.presales)+'h</span>'+
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
    '<div class="card" style="margin-bottom:20px"><div class="card-title">Quick Stats</div>'+
      '<div class="summary-grid">'+
        '<div class="stat-card navy"><div class="stat-label">Total '+esc2(typeLabel)+'s</div><div class="stat-value">'+sorted.length+'</div></div>'+
        '<div class="stat-card teal"><div class="stat-label">Total Hours</div><div class="stat-value" style="font-size:20px">'+r2(totalHours)+'h</div></div>'+
        '<div class="stat-card eve"><div class="stat-label">Total Sessions</div><div class="stat-value">'+totalSessions+'</div></div>'+
        '<div class="stat-card wknd"><div class="stat-label">Total Customers</div><div class="stat-value">'+sortedCust.length+'</div></div>'+
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
    presales: { year: 'pj-presales-year', from: 'pj-presales-from', to: 'pj-presales-to', loading: 'pj-presales-loading', content: 'pj-presales-content', heading: 'Pre-Sales Engagements' },
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
  var q = sb.from('unified_sessions').select('*').eq('session_type', typeKey);
  if (fromVal || toVal) {
    if (fromVal) q = q.gte('session_date', fromVal);
    if (toVal)   q = q.lte('session_date', toVal);
  } else if (year && year !== 'all') {
    q = q.gte('session_date', year + '-01-01').lte('session_date', year + '-12-31');
  }
  var res = await q;
  document.getElementById(ui.loading).style.display = 'none';
  var rows = res.data || [];

  if (!rows.length) {
    document.getElementById(ui.content).innerHTML =
      '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No '+typeKey.toUpperCase()+' sessions for '+year+'</div></div>';
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
      return '<span class="badge" style="background:#f0f4ff;color:var(--navy);margin:1px">'+label+': '+r2(d.members[m])+'h</span>';
    }).join(' ');
    return '<tr>'+
      '<td><strong>'+esc2(name)+'</strong></td>'+
      '<td style="font-size:12px;color:var(--muted)">'+esc2(d.customer)+'</td>'+
      '<td style="font-family:DM Mono,monospace">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:15px">'+r2(d.hours)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px;color:var(--muted)">'+r2(d.hours/8)+' days</td>'+
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
        '<div class="stat-card navy"><div class="stat-label">Total '+typeKey.toUpperCase()+'s</div><div class="stat-value">'+sorted.length+'</div></div>'+
        '<div class="stat-card teal"><div class="stat-label">Total Hours</div><div class="stat-value" style="font-size:20px">'+r2(totalHours)+'h</div></div>'+
        '<div class="stat-card eve"><div class="stat-label">Total Sessions</div><div class="stat-value">'+totalSessions+'</div></div>'+
        '<div class="stat-card wknd"><div class="stat-label">Total Customers</div><div class="stat-value">'+sortedCust.length+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div class="table-wrap"><table>'+
      '<thead><tr><th>Engagement</th><th>Customer</th><th>Sessions</th><th>Total Hours</th><th>Working Days</th><th>Team Breakdown</th></tr></thead>'+
      '<tbody>'+tableRows+'</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">'+rangeNote+' &middot; Working days = hours / 8</div>';
}

async function deleteUS(id) {
  // Read the row to find any linked OT and its status
  var res = await sb.from('unified_sessions').select('linked_ot_session_id,employee').eq('id', id).single();
  if (res.error) { alert('Could not load session.'); return; }
  var oldOtId = res.data.linked_ot_session_id;
  var sessionEmployee = res.data.employee;

  var oldOt = null;
  if (oldOtId) {
    var otRes = await sb.from('ot_sessions').select('status,credited_hours,band').eq('id', oldOtId).single();
    if (!otRes.error) oldOt = otRes.data;
  }

  var msg = 'Delete this session?';
  if (oldOt && oldOt.status === 'approved') {
    msg = 'WARNING: This session has APPROVED OT linked to it ('+oldOt.credited_hours+'h credited as ' + oldOt.band + ').\n\nDeleting will also remove that OT row, reducing ' + sessionEmployee + '\'s comp-off balance.\n\nContinue?';
  } else if (oldOtId) {
    msg = 'Delete this session?\n\nThe linked ' + (oldOt ? oldOt.status : 'pending') + ' OT record will also be deleted.';
  }
  if (!confirm(msg)) return;

  if (oldOtId) {
    await sb.from('ot_sessions').delete().eq('id', oldOtId);
  }
  var del = await sb.from('unified_sessions').delete().eq('id', id);
  if (del.error) { alert('Error: ' + del.error.message); return; }

  // Notify manager when an approved OT row was just deleted
  if (oldOt && oldOt.status === 'approved' && typeof notifyManagerOTEvent === 'function') {
    var nm = sessionEmployee + ' deleted a session that had APPROVED OT (' + oldOt.credited_hours + 'h, ' + oldOt.band + '). The credit has been removed from their balance.';
    notifyManagerOTEvent('ot_deleted_after_approval', id, nm);
  }

  renderUSSessions();
}
