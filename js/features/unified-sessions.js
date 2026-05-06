// == UNIFIED SESSIONS (Phase 2 - Beta) ==========================
// Single form for Project / POC / AMC / Internal session logging.
// Phase 2 only persists; OT integration arrives in Phase 3.

const SESSION_TYPE_BADGES = {
  project:  { bg: '#EFF6FF', color: '#2563EB', label: '📁 Project' },
  poc:      { bg: '#F5F3FF', color: '#7C3AED', label: '🎯 POC' },
  amc:      { bg: '#FFFBEB', color: '#B45309', label: '🛠️ AMC' },
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
  var isEng = (type === 'project' || type === 'poc' || type === 'amc');
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
    label.appendChild(document.createTextNode(emp.split(' ')[0]));
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

  var isEng = (type === 'project' || type === 'poc' || type === 'amc');
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

  var q = sb.from('unified_sessions').select('*').order('session_date',{ascending:false}).order('start_time',{ascending:false});
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
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+r.start_time+'-'+r.end_time+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+r.total_hours+'h</td>'+
      '<td><span class="badge" style="background:#f0f4ff;color:var(--navy);font-size:11px">'+(r.activity_type||'-')+'</span></td>'+
      '<td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+(r.session_info||'')+'">'+(r.session_info||'-')+'</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+(r.employee||'-')+'</td>'+
      '<td style="white-space:nowrap">'+
        (canEdit ? '<button class="btn btn-sm btn-ghost" onclick="openEditUS('+r.id+')" style="margin-right:4px">✏️</button><button class="btn btn-sm btn-danger" onclick="deleteUS('+r.id+')">✕</button>' : '')+
      '</td>'+
      '</tr>';
  }).join('');
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

  var sp = start.split(':').map(Number);
  var ep = end.split(':').map(Number);
  var sf = sp[0] + sp[1]/60, ef = ep[0] + ep[1]/60;
  var totalHours = r2(ef <= sf ? ef + 24 - sf : ef - sf);

  var isEng = (type === 'project' || type === 'poc' || type === 'amc');
  var engId = null;
  if (isEng && engagement) {
    var engRow = (ENGAGEMENTS||[]).find(function(e){ return e.name === engagement && e.type === type; });
    if (engRow) engId = engRow.id;
  }

  var payload = {
    session_type:  type,
    session_date:  date,
    start_time:    start,
    end_time:      end,
    session_info:  info,
    customer_name: isEng ? (customer || null) : null,
    engagement_name: isEng ? (engagement || null) : null,
    engagement_id: engId,
    activity_type: isEng ? (actType || null) : null,
    team_members:  isEng ? team : null,
    stake_holders: isEng ? stake : null,
    mode:          isEng ? mode : null,
    remarks:       remarks,
    total_hours:   totalHours,
  };

  var res = await sb.from('unified_sessions').update(payload).eq('id', id);
  if (res.error) return fail('Save failed: ' + res.error.message);
  closeEditUS();
  renderUSSessions();
}

async function deleteUS(id) {
  if (!confirm('Delete this session?')) return;
  var res = await sb.from('unified_sessions').delete().eq('id', id);
  if (res.error) { alert('Error: ' + res.error.message); return; }
  renderUSSessions();
}
