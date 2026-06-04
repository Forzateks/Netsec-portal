// == TASKS MODULE (v93 + v94, Phases 1 + 2) ==========================
// Phase 1 (v93): general one-off tasks + multi-owner + status updates.
// Phase 2 (v94): recurring task templates that auto-generate instances
//                on a daily/weekly/monthly/quarterly cadence.
// Phase 3 (v95): Excel import — not yet built.
//
// Data model (v94):
//   task_templates              — manager-managed recurring definitions
//   task_template_assignees     — default assignees for a template
//   tasks                       — instances (and one-off general tasks).
//                                  frequency='general' → one-off;
//                                  frequency in (daily/weekly/monthly/quarterly)
//                                    AND template_id IS NOT NULL → generated.
//                                  period_key disambiguates per-template
//                                  instances (UNIQUE INDEX enforces dedup).
//   task_assignments            — per-instance assignees (cloned from
//                                  task_template_assignees on generation).
//
// Permission model (RLS):
//   - Read: any authenticated user sees all tasks + all templates.
//   - tasks INSERT/DELETE, templates INSERT/UPDATE/DELETE, assignments
//     INSERT/DELETE: manager only.
//   - tasks UPDATE: manager OR any assignee (frontend restricts to
//     status + remarks for non-managers via data-mgr-only="1").
//   - Instance generation: runs only inside the manager's session. The
//     tasks_insert_manager RLS would block a non-manager generator, so
//     generateMissingInstances() short-circuits if !isManager. Trade-off
//     accepted in the spec: if an employee opens Tasks before the
//     manager has on a new day, they see the previous period's instance
//     until the manager loads the page. A Cloudflare Worker cron is the
//     Phase 3+ fix for this.

var TASKS_DATA        = [];   // cached task rows (filtered after fetch)
var TASKS_ASSIGNMENTS = [];   // cached assignments { task_id, assigned_to }
var TASK_TEMPLATES    = [];   // cached template rows (manager-only writes)
var TASK_TEMPLATE_ASSIGNEES = []; // cached { template_id, assigned_to }
var _tasksLoading     = false;
var _tasksActiveTab   = (function(){
  try { return localStorage.getItem('tasksActiveTab') || 'general'; }
  catch(_) { return 'general'; }
})();

var TASK_PRIORITY_META = {
  low:    { label:'Low',    cls:'task-pri-low' },
  medium: { label:'Medium', cls:'task-pri-medium' },
  high:   { label:'High',   cls:'task-pri-high' },
  urgent: { label:'Urgent', cls:'task-pri-urgent' }
};
var TASK_STATUS_META = {
  yet_to_start: { label:'Yet to start', cls:'task-st-yts' },
  ongoing:      { label:'Ongoing',      cls:'task-st-ong' },
  completed:    { label:'Completed',    cls:'task-st-done' },
  cancelled:    { label:'Cancelled',    cls:'task-st-cnc' }
};
var TASK_FREQUENCY_META = {
  general:   { label:'General',   short:'One-off'   },
  daily:     { label:'Daily',     short:'Daily'     },
  weekly:    { label:'Weekly',    short:'Weekly'    },
  monthly:   { label:'Monthly',   short:'Monthly'   },
  quarterly: { label:'Quarterly', short:'Quarterly' }
};
var TASK_FREQUENCY_TABS = ['general','daily','weekly','monthly','quarterly'];

// == LOAD ========================================================
async function loadTasks() {
  if (_tasksLoading) return;
  _tasksLoading = true;
  var loadEl = document.getElementById('tasks-load');
  var contentEl = document.getElementById('tasks-content');
  if (loadEl) loadEl.style.display = 'flex';
  if (contentEl) contentEl.innerHTML = '';

  // v94: BEFORE the main fetch, give the recurring-task generator a turn.
  // It's a no-op for non-managers (RLS would block their INSERTs anyway)
  // and for managers it mints any missing daily/weekly/monthly/quarterly
  // instances for the current period. The function logs but never throws,
  // so the page still loads even if generation fails for one template.
  if (isManager) {
    try { await generateMissingInstances(); }
    catch (e) { console.warn('generateMissingInstances failed:', e); }
  }

  // Parallel fetches: tasks + assignments + templates + template assignees.
  // We don't use a PostgREST embed (.select('*,task_assignments(*)')) —
  // RLS on junction tables is prickly. Explicit join in JS keeps it boring.
  var res = await Promise.all([
    sb.from('tasks').select('*').order('created_at', { ascending: false }),
    sb.from('task_assignments').select('task_id,assigned_to'),
    sb.from('task_templates').select('*').order('frequency').order('title'),
    sb.from('task_template_assignees').select('template_id,assigned_to')
  ]);
  _tasksLoading = false;
  if (loadEl) loadEl.style.display = 'none';
  if (res[0].error) {
    if (contentEl) contentEl.innerHTML = '<div class="alert alert-error show">Error loading tasks: ' + esc2(res[0].error.message) + '</div>';
    return;
  }
  TASKS_DATA               = res[0].data || [];
  TASKS_ASSIGNMENTS        = (res[1].error ? [] : (res[1].data || []));
  TASK_TEMPLATES           = (res[2].error ? [] : (res[2].data || []));
  TASK_TEMPLATE_ASSIGNEES  = (res[3].error ? [] : (res[3].data || []));

  // Populate Owner filter once data is here. EMPLOYEES is the canonical
  // team list; "Unassigned" sentinel handles tasks with no assignees.
  _tasksPopulateOwnerFilter();

  // Render the tab bar reflecting current selection + visibility of the
  // manager-only template controls (New ▾ dropdown + Manage Templates btn).
  _tasksRenderTabBar();
  _tasksApplyManagerVisibility();

  renderTasksList();
  // Refresh sidebar badge — counts may have changed since last poll.
  if (typeof updateTasksBadge === 'function') updateTasksBadge();
}

// Toggle visibility for the manager-only UI bits on the tasks page. The
// New ▾ split button and Manage Templates button both surface mutations
// the RLS would refuse for non-managers, so we hide rather than disable.
function _tasksApplyManagerVisibility() {
  // v111: "+ New Task" split button is now visible to ALL authenticated
  // users — employees can create one-off general tasks. Recurring template
  // controls (Manage Templates + the 4 recurring menu items inside the
  // split-button dropdown) stay manager-only.
  var newBtnWrap = document.getElementById('tasks-new-btn-wrap');
  if (newBtnWrap) newBtnWrap.style.display = '';   // show to everyone
  ['tasks-manage-templates-btn','tasks-new-menu-recurring'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.style.display = isManager ? '' : 'none';
  });
}

function _tasksPopulateOwnerFilter() {
  var sel = document.getElementById('tasks-flt-owner');
  if (!sel) return;
  var prev = sel.value;
  var html = '<option value="">All Owners</option><option value="__unassigned__">Unassigned</option>';
  (EMPLOYEES || []).forEach(function(emp){
    html += '<option value="' + esc2(emp) + '">' + esc2(emp) + '</option>';
  });
  sel.innerHTML = html;
  if (prev) sel.value = prev;
}

function clearTasksFilters() {
  ['tasks-search','tasks-flt-owner','tasks-flt-status'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var arc = document.getElementById('tasks-flt-archived'); if (arc) arc.checked = false;
  renderTasksList();
}

// == HELPERS =====================================================
// Group assignments by task_id for fast lookup.
function _tasksAssigneesByTaskId() {
  var byId = {};
  TASKS_ASSIGNMENTS.forEach(function(a){
    if (!byId[a.task_id]) byId[a.task_id] = [];
    byId[a.task_id].push(a.assigned_to);
  });
  return byId;
}

function _tasksFiltered() {
  var search = (((document.getElementById('tasks-search')||{}).value)||'').toLowerCase().trim();
  var owner  = ((document.getElementById('tasks-flt-owner') ||{}).value)||'';
  var status = ((document.getElementById('tasks-flt-status')||{}).value)||'';
  var showArchived = !!(document.getElementById('tasks-flt-archived')||{}).checked;
  var assignByTask = _tasksAssigneesByTaskId();
  var activeTab = _tasksActiveTab || 'general';

  var rows = (TASKS_DATA||[]).filter(function(t){
    // Tab filter — match by frequency column (default 'general' for legacy
    // pre-v94 rows + new one-off tasks).
    if ((t.frequency || 'general') !== activeTab) return false;
    if (!showArchived && t.is_archived) return false;
    if (showArchived  && !t.is_archived) return false;
    if (status && t.status !== status) return false;
    if (owner === '__unassigned__') {
      if ((assignByTask[t.id] || []).length) return false;
    } else if (owner) {
      if ((assignByTask[t.id] || []).indexOf(owner) === -1) return false;
    }
    if (search) {
      var hay = ((t.title||'') + ' ' + (t.description||'') + ' ' + (t.remarks||'')).toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });

  // Recurring tabs: sort by period_key DESC so the newest period sits on top.
  // General tab (v103): completed tasks sink to the bottom; everything else
  // (yet_to_start, ongoing, cancelled) stays on top. created_at-desc is the
  // tie-breaker within each group, preserving newest-first within both
  // sections.
  if (activeTab !== 'general') {
    rows.sort(function(a,b){
      var ak = a.period_key || '';
      var bk = b.period_key || '';
      if (ak === bk) return (b.created_at||'').localeCompare(a.created_at||'');
      return bk.localeCompare(ak);
    });
  } else {
    rows.sort(function(a,b){
      var ad = (a.status === 'completed') ? 1 : 0;
      var bd = (b.status === 'completed') ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return (b.created_at||'').localeCompare(a.created_at||'');
    });
  }
  return rows;
}

// == RENDER LIST =================================================
function renderTasksList() {
  var host = document.getElementById('tasks-content');
  if (!host) return;
  var rows = _tasksFiltered();
  var assignByTask = _tasksAssigneesByTaskId();
  var activeTab = _tasksActiveTab || 'general';
  var isRecurringTab = (activeTab !== 'general');

  if (!rows.length) {
    var emptyHtml;
    // Distinguish three empty states: (a) no tasks of this frequency ever
    // existed, (b) zero rows globally, (c) filter excludes everything.
    var anyInTab = (TASKS_DATA||[]).some(function(t){ return (t.frequency||'general') === activeTab; });
    if (!TASKS_DATA.length || !anyInTab) {
      var freqLbl = (TASK_FREQUENCY_META[activeTab] || {}).label || 'tasks';
      var heading, sub, btnText, btnOnclick;
      if (isRecurringTab) {
        heading   = 'No ' + freqLbl.toLowerCase() + ' recurring tasks yet';
        sub       = isManager
          ? 'Create a recurring template — instances will auto-generate each period.'
          : 'Your manager has not set up any ' + freqLbl.toLowerCase() + ' recurring tasks.';
        btnText   = isManager ? 'New ' + freqLbl + ' Recurring' : null;
        btnOnclick= isManager ? "openCreateRecurringTemplateModal('" + activeTab + "')" : null;
      } else {
        // v111: employees can create one-off tasks too. Empty-state CTA
        // shown to everyone; copy phrasing diverges by role only because
        // the manager voice differs from the self-serve voice.
        heading   = 'No general tasks yet';
        sub       = isManager
          ? 'Click + New Task above to create the first one.'
          : 'Click + New Task above to create one.';
        btnText   = 'Create the first task';
        btnOnclick= 'openCreateTaskModal()';
      }
      emptyHtml = (typeof renderEmptyState === 'function')
        ? renderEmptyState({ icon:'check-square', heading:heading, sub:sub, btnText:btnText, btnOnclick:btnOnclick })
        : '<div class="team-empty">'+esc2(heading)+'</div>';
    } else {
      emptyHtml = (typeof renderEmptyState === 'function')
        ? renderEmptyState({ icon:'filter-x', heading:'No tasks match the current filters', sub:'Adjust the filters above or click Clear.', btnText:'Clear filters', btnOnclick:'clearTasksFilters()' })
        : '<div class="team-empty">No tasks match the current filters.</div>';
    }
    host.innerHTML = emptyHtml;
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var tbody = rows.map(function(t, idx){
    var assignees = assignByTask[t.id] || [];
    var isAssignee = currentUser && assignees.indexOf(currentUser) !== -1;
    var canEdit = isManager || isAssignee;

    var priMeta = TASK_PRIORITY_META[t.priority] || TASK_PRIORITY_META['medium'];
    var stMeta  = TASK_STATUS_META[t.status]   || TASK_STATUS_META['yet_to_start'];

    // Status cell: clickable dropdown for any allowed editor (manager
    // OR assignee). Read-only chip for everyone else.
    var statusCell;
    if (canEdit && !t.is_archived) {
      var opts = Object.keys(TASK_STATUS_META).map(function(k){
        var sel = (k === t.status) ? ' selected' : '';
        return '<option value="'+k+'"'+sel+'>'+esc2(TASK_STATUS_META[k].label)+'</option>';
      }).join('');
      statusCell = '<select class="task-status-select '+stMeta.cls+'" data-task-id="'+t.id+'" onchange="changeTaskStatus('+t.id+', this.value)">'+opts+'</select>';
    } else {
      statusCell = '<span class="badge '+stMeta.cls+'">'+esc2(stMeta.label)+'</span>';
    }

    // Actions: manager gets edit + archive/restore; assignees get edit
    // (modal opens with manager-only fields disabled). Plain readers
    // get no action buttons.
    var actions = '';
    if (canEdit) {
      actions += '<button class="btn btn-sm btn-ghost btn-icon-only" title="Edit task" onclick="openEditTaskModal('+t.id+')"><i data-lucide="pencil"></i></button>';
    }
    if (isManager) {
      if (t.is_archived) {
        actions += '<button class="btn btn-sm btn-ghost btn-icon-only" title="Restore" onclick="restoreTask('+t.id+')"><i data-lucide="rotate-ccw"></i></button>';
      } else {
        actions += '<button class="btn btn-sm btn-danger btn-icon-only" title="Archive" onclick="archiveTask('+t.id+')"><i data-lucide="archive"></i></button>';
      }
    }

    var ownerText = assignees.length
      ? assignees.map(function(n){ return esc2(_tasksShortName(n)); }).join(', ')
      : '<span class="dim">—</span>';
    // v110: show only present date slots, each labelled (Start/ETA/End)
    // so a lone date is unambiguous. Drops the "/ — / —" noise that
    // appeared when rows had only one or two of the three dates set.
    var _dParts = [t.start_date, t.eta_date, t.end_date];
    var _dFilled = _dParts.filter(Boolean);
    var datesText;
    if (!_dFilled.length) {
      datesText = '<span class="dim">—</span>';
    } else {
      var _dLabels = ['Start','ETA','End'];
      datesText = _dParts.map(function(d,i){
        return d ? '<span class="task-date-seg"><span class="task-date-tag">'+_dLabels[i]+'</span> '+fmtDate(d)+'</span>' : '';
      }).filter(Boolean).join('<span class="task-date-div"> · </span>');
    }

    // Recurring tabs swap the date triplet column for a single period
    // label (e.g. "Today" / "Week 22" / "May 2026" / "Q2 2026").
    var periodOrDatesCell;
    if (isRecurringTab) {
      var lbl = formatPeriodLabel(t.period_key, activeTab);
      periodOrDatesCell = '<td><span class="task-period-pill">'+esc2(lbl)+'</span></td>';
    } else {
      periodOrDatesCell = '<td style="font-family:DM Mono,monospace;font-size:11.5px;color:var(--muted);white-space:nowrap">'+datesText+'</td>';
    }
    var rowCls = 'task-pri-'+(t.priority||'medium');
    if (t.is_archived) rowCls += ' task-row-archived';
    if (t.status === 'completed' || t.status === 'cancelled') rowCls += ' task-row-done';
    return '<tr class="'+rowCls+'">'+
      '<td class="dim" style="font-size:12px">'+(idx+1)+'</td>'+
      '<td><strong>'+esc2(t.title)+'</strong>'+
        (t.description?'<div class="dim" style="font-size:11.5px;margin-top:2px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc2(t.description)+'">'+esc2(t.description)+'</div>':'')+
      '</td>'+
      '<td style="font-size:12.5px">'+ownerText+'</td>'+
      '<td><span class="task-pri-dot task-pri-dot-'+(t.priority||'medium')+'"></span><span class="task-pri-lbl">'+esc2(priMeta.label)+'</span></td>'+
      '<td>'+statusCell+'</td>'+
      periodOrDatesCell+
      '<td style="white-space:nowrap">'+actions+'</td>'+
    '</tr>';
  }).join('');

  var dateColHeader = isRecurringTab ? 'Period' : 'Start / ETA / End';
  host.innerHTML =
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div class="table-wrap"><table class="tasks-table">'+
        '<thead><tr>'+
          '<th style="width:32px">#</th>'+
          '<th>Task</th>'+
          '<th>Owner(s)</th>'+
          '<th>Priority</th>'+
          '<th>Status</th>'+
          '<th>'+dateColHeader+'</th>'+
          '<th style="width:90px">Actions</th>'+
        '</tr></thead>'+
        '<tbody>'+tbody+'</tbody>'+
      '</table></div>'+
    '</div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' task'+(rows.length===1?'':'s')+
      (TASKS_DATA.length !== rows.length ? ' · '+TASKS_DATA.length+' total' : '')+
    '</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function _tasksShortName(emp) {
  return (typeof empShortName === 'function') ? empShortName(emp) : (emp||'').split(/\s+/)[0];
}

// == STATUS CHANGE (inline, any editor) ==========================
// Optimistic UI: flip the cached row + re-render immediately. .select()
// returns the saved row so we can verify (v90 smoke-test pattern); if
// the returned status doesn't match what we sent, revert + toast.
async function changeTaskStatus(taskId, newStatus) {
  if (!await requireAuth()) return;
  var t = (TASKS_DATA||[]).find(function(x){ return x.id === taskId; });
  if (!t) return;
  var old = t.status;
  if (old === newStatus) return;
  t.status = newStatus;
  renderTasksList();
  var res = await sb.from('tasks')
    .update({ status: newStatus })
    .eq('id', taskId)
    .select('id,status')
    .single();
  if (res.error || !res.data || res.data.status !== newStatus) {
    t.status = old;
    renderTasksList();
    reportSilentFail('tasks', { op: 'status_change', task_id: taskId, expected: newStatus, got: res.data && res.data.status, error: res.error && res.error.message });
    showError('Could not update status: ' + (res.error ? res.error.message : 'permission denied'));
    return;
  }
  showToast('Status: ' + (TASK_STATUS_META[newStatus] ? TASK_STATUS_META[newStatus].label : newStatus));
  if (typeof updateTasksBadge === 'function') updateTasksBadge();
}

// == CREATE + EDIT MODAL =========================================
// Single modal element (#task-modal) is reused for both flows. _taskModalMode
// flips between 'create' / 'edit'; saveTaskModal dispatches accordingly.
var _taskModalMode = null;     // 'create' | 'edit'
var _taskModalEditingId = null;

function openCreateTaskModal() {
  // v111: employees can create one-off general tasks. RLS gates the actual
  // INSERT via tasks_insert_authenticated_self (created_by must be self).
  // No frontend role gate here; per-field locks below restrict assignees +
  // frequency for non-managers.
  _taskModalMode = 'create';
  _taskModalEditingId = null;
  _resetTaskModal();
  document.getElementById('task-modal-title').textContent = 'New Task';
  document.getElementById('task-modal-save-btn').innerHTML = '<i data-lucide="plus" class="btn-icon"></i>Create Task';
  _applyTaskModalReadonly(false);   // manager fields all editable
  document.getElementById('task-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
  setTimeout(function(){ var el = document.getElementById('task-modal-title-input'); if (el) el.focus(); }, 50);
}

function openEditTaskModal(taskId) {
  var t = (TASKS_DATA||[]).find(function(x){ return x.id === taskId; });
  if (!t) { showError('Task not found.'); return; }
  var assignByTask = _tasksAssigneesByTaskId();
  var assignees = assignByTask[taskId] || [];
  var isAssignee = currentUser && assignees.indexOf(currentUser) !== -1;
  if (!isManager && !isAssignee) {
    showError('You can only edit tasks assigned to you.');
    return;
  }
  _taskModalMode = 'edit';
  _taskModalEditingId = taskId;
  _resetTaskModal();

  document.getElementById('task-modal-title').textContent = isManager ? 'Edit Task' : 'Update Task';
  document.getElementById('task-modal-save-btn').innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';

  document.getElementById('task-modal-id').value             = taskId;
  document.getElementById('task-modal-title-input').value    = t.title || '';
  document.getElementById('task-modal-description').value    = t.description || '';
  document.getElementById('task-modal-priority').value       = t.priority || 'medium';
  document.getElementById('task-modal-status').value         = t.status || 'yet_to_start';
  document.getElementById('task-modal-start').value          = t.start_date || '';
  document.getElementById('task-modal-eta').value            = t.eta_date || '';
  document.getElementById('task-modal-end').value            = t.end_date || '';
  document.getElementById('task-modal-remarks').value        = t.remarks || '';
  _populateAssigneeCheckboxes(assignees);

  // Field-level lockdown for non-managers: title / description / dates /
  // priority / assignees become read-only. RLS allows the UPDATE; this
  // is the UI half of the "assignees only edit status + remarks" rule
  // from the spec.
  _applyTaskModalReadonly(!isManager);

  document.getElementById('task-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.remove('show');
  _taskModalMode = null;
  _taskModalEditingId = null;
}

function _resetTaskModal() {
  var errEl = document.getElementById('task-modal-error');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  document.getElementById('task-modal-id').value             = '';
  document.getElementById('task-modal-title-input').value    = '';
  document.getElementById('task-modal-description').value    = '';
  document.getElementById('task-modal-priority').value       = 'medium';
  document.getElementById('task-modal-status').value         = 'yet_to_start';
  document.getElementById('task-modal-start').value          = '';
  document.getElementById('task-modal-eta').value            = '';
  document.getElementById('task-modal-end').value            = '';
  document.getElementById('task-modal-remarks').value        = '';
  _populateAssigneeCheckboxes([]);
}

function _populateAssigneeCheckboxes(checkedNames) {
  var host = document.getElementById('task-modal-assignees');
  if (!host) return;
  var checkedSet = {};
  (checkedNames||[]).forEach(function(n){ checkedSet[n] = 1; });
  host.innerHTML = (EMPLOYEES||[]).map(function(emp){
    var c = checkedSet[emp] ? ' checked' : '';
    return '<label class="task-assignee-chk">'+
      '<input type="checkbox" data-assignee="'+esc2(emp)+'" value="'+esc2(emp)+'"'+c+'> '+esc2(emp)+
    '</label>';
  }).join('');
}

// Apply the readonly visual + interactive state to all [data-mgr-only]
// fields inside the modal. Idempotent — passing false re-enables.
function _applyTaskModalReadonly(readonly) {
  var fields = document.querySelectorAll('#task-modal [data-mgr-only="1"]');
  Array.prototype.forEach.call(fields, function(f){
    // For the assignees container, lock individual checkboxes.
    if (f.id === 'task-modal-assignees') {
      var inputs = f.querySelectorAll('input[type=checkbox]');
      Array.prototype.forEach.call(inputs, function(i){ i.disabled = readonly; });
      f.classList.toggle('task-modal-readonly', readonly);
      return;
    }
    f.disabled = readonly;
    f.classList.toggle('task-modal-readonly', readonly);
  });
}

async function saveTaskModal() {
  if (!await requireAuth()) return;
  var errEl = document.getElementById('task-modal-error');
  function fail(m) { errEl.textContent = '⚠️ ' + m; errEl.style.display = 'block'; }
  errEl.style.display = 'none';

  var title       = (document.getElementById('task-modal-title-input').value || '').trim();
  var description = (document.getElementById('task-modal-description').value || '').trim();
  var priority    = document.getElementById('task-modal-priority').value;
  var status      = document.getElementById('task-modal-status').value;
  var startDate   = document.getElementById('task-modal-start').value || null;
  var etaDate     = document.getElementById('task-modal-eta').value   || null;
  var endDate     = document.getElementById('task-modal-end').value   || null;
  var remarks     = (document.getElementById('task-modal-remarks').value || '').trim();

  var assignees = Array.prototype.slice.call(
    document.querySelectorAll('#task-modal-assignees input[type=checkbox]:checked')
  ).map(function(i){ return i.value; });

  // Validation
  if (!title)    return fail('Title is required.');
  if (!priority) return fail('Priority is required.');
  if (!status)   return fail('Status is required.');
  if (_taskModalMode === 'create' && !assignees.length) {
    return fail('Pick at least one assignee.');
  }
  if (_taskModalMode === 'edit' && isManager && !assignees.length) {
    return fail('A task needs at least one assignee. Unassign by archiving the task instead.');
  }
  // Date order soft-warn: continue but surface to user.
  if (startDate && etaDate && startDate > etaDate) {
    return fail('Start date is after ETA — double-check the dates.');
  }
  if (etaDate && endDate && etaDate > endDate) {
    return fail('ETA is after End date — double-check the dates.');
  }

  if (_taskModalMode === 'create') {
    await _saveCreateTask({
      title:title, description:description||null, priority:priority, status:status,
      startDate:startDate, etaDate:etaDate, endDate:endDate, remarks:remarks||null,
      assignees:assignees, fail:fail
    });
  } else {
    await _saveEditTask({
      taskId:_taskModalEditingId,
      title:title, description:description||null, priority:priority, status:status,
      startDate:startDate, etaDate:etaDate, endDate:endDate, remarks:remarks||null,
      assignees:assignees, fail:fail
    });
  }
}

// Create flow. INSERT task → INSERT assignments. Supabase JS doesn't
// support multi-statement transactions, so if assignments fail we
// manually DELETE the orphan task to keep the table clean. Not
// strictly atomic, but functionally equivalent for the small-team
// scale and clearer than wiring up a server-side RPC.
async function _saveCreateTask(p) {
  // v111: this path creates ONE-OFF tasks only (frequency defaults to
  // 'general' via the v94 schema default — not passed in the payload).
  // Recurring tasks use a separate flow via openCreateRecurringTemplateModal
  // (manager-only, writes to task_templates not tasks). DO NOT add a
  // frequency field here without also gating it on isManager — RLS
  // tasks_insert_authenticated_self lets any authed user INSERT as long
  // as created_by matches, so a non-manager could otherwise smuggle a
  // recurring task in by manipulating the payload.
  var ins = await sb.from('tasks').insert({
    title: p.title,
    description: p.description,
    priority: p.priority,
    status: p.status,
    start_date: p.startDate,
    eta_date: p.etaDate,
    end_date: p.endDate,
    remarks: p.remarks,
    created_by: currentUser || 'unknown'
  }).select().single();
  if (ins.error || !ins.data) { p.fail('Save failed: ' + (ins.error ? ins.error.message : 'unknown')); return; }
  var taskId = ins.data.id;

  // Build assignment rows + insert.
  var rows = p.assignees.map(function(emp){ return { task_id: taskId, assigned_to: emp }; });
  var ainsRes = await sb.from('task_assignments').insert(rows);
  if (ainsRes.error) {
    // Rollback the orphan.
    await sb.from('tasks').delete().eq('id', taskId);
    p.fail('Assignments failed: ' + ainsRes.error.message + ' — task was not created.');
    return;
  }

  closeTaskModal();
  showToast('Task created · assigned to ' + p.assignees.length + ' ' + (p.assignees.length===1?'person':'people'));
  await loadTasks();
}

// Edit flow. Manager can change everything (and replaces assignments
// via delete+re-insert). Assignee-but-not-manager updates only the
// status + remarks columns — title/description/dates/priority/
// assignees stay frozen even if a DOM manipulation tried to send them.
async function _saveEditTask(p) {
  var payload;
  if (isManager) {
    payload = {
      title: p.title,
      description: p.description,
      priority: p.priority,
      status: p.status,
      start_date: p.startDate,
      eta_date: p.etaDate,
      end_date: p.endDate,
      remarks: p.remarks
    };
  } else {
    // Field-level enforcement: only status + remarks. RLS would still
    // allow the wider payload (the policy gates rows not columns), so
    // this is the column-level enforcement.
    payload = { status: p.status, remarks: p.remarks };
  }

  var upd = await sb.from('tasks').update(payload).eq('id', p.taskId).select().single();
  if (upd.error || !upd.data) { p.fail('Save failed: ' + (upd.error ? upd.error.message : 'unknown')); return; }
  // RLS smoke-test: verify each field we sent matches the returned row.
  var mismatch = Object.keys(payload).some(function(k){
    return String(upd.data[k] == null ? '' : upd.data[k]) !== String(payload[k] == null ? '' : payload[k]);
  });
  if (mismatch) {
    reportSilentFail('tasks', { op: 'edit_task', task_id: p.taskId, payload: payload, returned: upd.data });
    p.fail('Server returned a different value — your changes may have been silently rejected. Reload.');
    return;
  }

  // Manager-only: sync the assignment set (delete absent, insert new).
  if (isManager) {
    var currentAssignByTask = _tasksAssigneesByTaskId();
    var current = currentAssignByTask[p.taskId] || [];
    var currentSet = {}, nextSet = {};
    current.forEach(function(n){ currentSet[n] = 1; });
    p.assignees.forEach(function(n){ nextSet[n] = 1; });
    var toRemove = current.filter(function(n){ return !nextSet[n]; });
    var toAdd    = p.assignees.filter(function(n){ return !currentSet[n]; });
    if (toRemove.length) {
      var delRes = await sb.from('task_assignments').delete().eq('task_id', p.taskId).in('assigned_to', toRemove);
      if (delRes.error) { p.fail('Could not update assignments: ' + delRes.error.message); return; }
    }
    if (toAdd.length) {
      var addRes = await sb.from('task_assignments').insert(toAdd.map(function(emp){ return { task_id: p.taskId, assigned_to: emp }; }));
      if (addRes.error) { p.fail('Could not update assignments: ' + addRes.error.message); return; }
    }
  }

  closeTaskModal();
  showToast('Task updated ✓');
  await loadTasks();
}

// == ARCHIVE / RESTORE (manager-only) ============================
async function archiveTask(taskId) {
  if (!await requireAuth()) return;
  if (!isManager) { showError('Manager access only.'); return; }
  var t = (TASKS_DATA||[]).find(function(x){ return x.id === taskId; });
  if (!t) return;
  if (!await confirmAction({
    title: 'Archive task "' + t.title + '"?',
    body:  'Archived tasks are hidden from the default list but kept in the database. Use the "Show archived" filter to restore them.',
    confirmText: 'Archive',
    danger: true
  })) return;
  var upd = await sb.from('tasks')
    .update({ is_archived: true, archived_at: new Date().toISOString() })
    .eq('id', taskId).select('id,is_archived').single();
  if (upd.error || !upd.data || !upd.data.is_archived) {
    reportSilentFail('tasks', { op: 'archive', task_id: taskId, error: upd.error && upd.error.message });
    showError('Archive failed: ' + (upd.error ? upd.error.message : 'permission denied'));
    return;
  }
  showToast('Task archived ✓');
  await loadTasks();
}

async function restoreTask(taskId) {
  if (!await requireAuth()) return;
  if (!isManager) { showError('Manager access only.'); return; }
  var upd = await sb.from('tasks')
    .update({ is_archived: false, archived_at: null })
    .eq('id', taskId).select('id,is_archived').single();
  if (upd.error || !upd.data || upd.data.is_archived) {
    reportSilentFail('tasks', { op: 'restore', task_id: taskId, error: upd.error && upd.error.message });
    showError('Restore failed: ' + (upd.error ? upd.error.message : 'permission denied'));
    return;
  }
  showToast('Task restored ✓');
  await loadTasks();
}

// == SIDEBAR BADGE COUNTER =======================================
// Counts open tasks (status NOT completed/cancelled, not archived):
//   - Manager: ALL open tasks across the team.
//   - Employee: just the ones they're assigned to.
// Polled by startNotifPolling every 60s in addition to the on-demand
// refresh after create/update/archive.
async function updateTasksBadge() {
  var badge = document.getElementById('tasks-badge');
  if (!badge) return;
  try {
    var q = sb.from('tasks')
      .select('id, task_assignments!inner(assigned_to)', { count:'exact', head:true })
      .eq('is_archived', false)
      .not('status', 'in', '(completed,cancelled)');
    if (!isManager && currentUser) {
      q = q.eq('task_assignments.assigned_to', currentUser);
    }
    var res = await q;
    if (res.error) {
      // Fall back to a no-embed count when the embed query trips an RLS
      // edge case. For managers this is fine; for employees we lose the
      // assignee filter and over-count — the cell turns into "all open"
      // which is loud but not wrong.
      console.warn('updateTasksBadge primary count failed:', res.error.message);
      var alt = await sb.from('tasks').select('id', { count:'exact', head:true })
        .eq('is_archived', false).not('status', 'in', '(completed,cancelled)');
      if (alt.error) return;
      _tasksRenderBadge(alt.count || 0);
      return;
    }
    _tasksRenderBadge(res.count || 0);
  } catch (e) {
    console.warn('updateTasksBadge error:', e);
  }
}

function _tasksRenderBadge(n) {
  var badge = document.getElementById('tasks-badge');
  if (!badge) return;
  if (n > 0) {
    badge.textContent = String(n);
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ============================================================
// v94 — RECURRING TASK TEMPLATES (Phase 2)
// ============================================================

// == PERIOD HELPERS =============================================
// All date math uses the user's local clock. UAE/KSA timezones differ
// only by 1h and there is no DST, so a 6-person team will be on the
// same calendar date for the bulk of the day. The UNIQUE index
// idx_tasks_template_period prevents data corruption if two browsers
// disagree about the period for a few minutes near midnight.

function computePeriodKey(date, frequency) {
  var d = (date instanceof Date) ? date : new Date(date);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  switch (frequency) {
    case 'daily':     return y + '-' + m + '-' + day;
    case 'weekly':    return y + '-W' + getISOWeek(d);
    case 'monthly':   return y + '-' + m;
    case 'quarterly': return y + '-Q' + (Math.floor(d.getMonth() / 3) + 1);
  }
  return null;
}

function computePeriodStartDate(date, frequency) {
  var d = new Date(date);
  switch (frequency) {
    case 'daily':
      return _isoDate(d);
    case 'weekly': {
      // Monday is start of week. JS Sunday=0 → treat as 7 so subtraction works.
      var day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return _isoDate(d);
    }
    case 'monthly':
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
    case 'quarterly': {
      var qMonth = Math.floor(d.getMonth()/3) * 3;
      return d.getFullYear() + '-' + String(qMonth+1).padStart(2,'0') + '-01';
    }
  }
  return null;
}

function _isoDate(d) {
  // toISOString() bakes in UTC, which can drift the date when the user's
  // local clock is near midnight. Use local components instead.
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ISO 8601 week number (week starts Monday, week 1 contains first
// Thursday). Standard recipe; matches the period_key format 'YYYY-Www'.
function getISOWeek(d) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  var weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return String(weekNum).padStart(2, '0');
}

// Friendly label shown in the table for recurring instances.
// Today's daily key → "Today"; current week's weekly key → "This Week", etc.
function formatPeriodLabel(periodKey, frequency) {
  if (!periodKey) return '—';
  var now = new Date();
  var nowKey = computePeriodKey(now, frequency);

  if (frequency === 'daily') {
    if (periodKey === nowKey) return 'Today';
    // Yesterday convenience
    var yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (periodKey === computePeriodKey(yesterday, 'daily')) return 'Yesterday';
    // Fallback: full date
    try { return fmtDate(periodKey); }
    catch(_) { return periodKey; }
  }
  if (frequency === 'weekly') {
    var w = (periodKey.split('-W')[1] || '').replace(/^0+/, '');
    return 'Week ' + w + ' · ' + (periodKey.split('-W')[0]);
  }
  if (frequency === 'monthly') {
    var parts = periodKey.split('-');
    var mNum = parseInt(parts[1], 10);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return (months[mNum-1] || parts[1]) + ' ' + parts[0];
  }
  if (frequency === 'quarterly') {
    return periodKey.replace('-', ' '); // "2026-Q2" → "2026 Q2"
  }
  return periodKey;
}

// == TAB BAR =====================================================
function _tasksRenderTabBar() {
  var bar = document.getElementById('tasks-tab-bar');
  if (!bar) return;
  bar.innerHTML = TASK_FREQUENCY_TABS.map(function(k){
    var meta = TASK_FREQUENCY_META[k];
    var active = (k === _tasksActiveTab) ? ' active' : '';
    return '<button class="tasks-tab-btn'+active+'" data-tab="'+k+'" onclick="setTasksActiveTab(\''+k+'\')">'+
      esc2(meta.label) +
    '</button>';
  }).join('');
}

function setTasksActiveTab(tab) {
  if (TASK_FREQUENCY_TABS.indexOf(tab) === -1) return;
  if (tab === _tasksActiveTab) return;
  _tasksActiveTab = tab;
  try { localStorage.setItem('tasksActiveTab', tab); } catch(_) {}
  // Clear filters on tab switch — each tab has its own working context.
  ['tasks-search','tasks-flt-owner','tasks-flt-status'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var arc = document.getElementById('tasks-flt-archived'); if (arc) arc.checked = false;
  _tasksRenderTabBar();
  renderTasksList();
}

// == SPLIT-BUTTON DROPDOWN (+ New Task ▾) =========================
function toggleNewTaskMenu(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  var menu = document.getElementById('tasks-new-menu');
  if (menu) menu.classList.toggle('show');
}
function closeNewTaskMenu() {
  var menu = document.getElementById('tasks-new-menu');
  if (menu) menu.classList.remove('show');
}
// Outside-click close — bound once in init.js or here lazily.
document.addEventListener('click', function(e){
  var menu = document.getElementById('tasks-new-menu');
  var btn  = document.getElementById('tasks-new-btn-wrap');
  if (!menu || !btn) return;
  if (!menu.classList.contains('show')) return;
  if (btn.contains(e.target)) return;
  menu.classList.remove('show');
});

// == GENERATE MISSING INSTANCES ==================================
// Called from loadTasks() inside the manager's session only. For each
// active template, computes the current period_key + checks if an
// instance exists; if not, mints one + copies assignees. The UNIQUE
// index idx_tasks_template_period is the final guard against a race
// where two manager tabs open at the same time on a fresh period.
async function generateMissingInstances() {
  // Pull templates with their default assignee list in one round-trip.
  var tplRes = await sb.from('task_templates')
    .select('id, title, description, priority, remarks, frequency, created_by, last_generated_for, task_template_assignees(assigned_to)')
    .eq('is_active', true);
  if (tplRes.error) { console.warn('templates fetch failed:', tplRes.error); return; }
  var templates = tplRes.data || [];
  if (!templates.length) return;

  var now = new Date();
  var created = 0;

  for (var i = 0; i < templates.length; i++) {
    var tpl = templates[i];
    var periodKey = computePeriodKey(now, tpl.frequency);
    if (!periodKey) continue;

    // Skip if instance for this period already exists — cheap pre-check
    // saves a round-trip when the unique constraint would catch it anyway.
    var dup = await sb.from('tasks')
      .select('id', { head:true, count:'exact' })
      .eq('template_id', tpl.id)
      .eq('period_key', periodKey);
    if (!dup.error && (dup.count || 0) > 0) continue;

    var periodStart = computePeriodStartDate(now, tpl.frequency);
    var insRes = await sb.from('tasks').insert({
      title:       tpl.title,
      description: tpl.description,
      priority:    tpl.priority,
      remarks:     tpl.remarks,
      status:      'yet_to_start',
      template_id: tpl.id,
      frequency:   tpl.frequency,
      period_key:  periodKey,
      start_date:  periodStart,
      created_by:  tpl.created_by || 'System'
    }).select().single();

    if (insRes.error) {
      // Most likely a race: another tab beat us to it and tripped the
      // UNIQUE index. Continue silently — second tab will see the row
      // the first one minted on its own refresh.
      if ((insRes.error.code || '') !== '23505') {
        console.warn('instance insert failed for template', tpl.id, insRes.error);
      }
      continue;
    }

    var instanceId = insRes.data.id;
    var defaults = (tpl.task_template_assignees || []).map(function(a){
      return { task_id: instanceId, assigned_to: a.assigned_to };
    });
    if (defaults.length) {
      var asRes = await sb.from('task_assignments').insert(defaults);
      if (asRes.error) {
        // Couldn't copy assignees — best to remove the orphan instance
        // so we don't end up with an unassigned recurring task.
        console.warn('assignments insert failed for instance', instanceId, asRes.error);
        await sb.from('tasks').delete().eq('id', instanceId);
        continue;
      }
    }

    // Stamp template.last_generated_for so we can see at a glance when
    // generation last fired. Not used for dedup (that's period_key on
    // the tasks table) — just diagnostic.
    await sb.from('task_templates')
      .update({ last_generated_for: periodKey })
      .eq('id', tpl.id);

    created++;
  }

  if (created) {
    console.log('Generated ' + created + ' recurring task instance(s).');
  }
}

// == CREATE / EDIT TEMPLATE MODAL ================================
// Reuses #task-template-modal. Mode swaps between 'create' / 'edit'.
var _tplModalMode = null;
var _tplModalEditingId = null;

function openCreateRecurringTemplateModal(frequency) {
  if (!isManager) { showError('Only managers can create recurring tasks.'); return; }
  if (TASK_FREQUENCY_TABS.indexOf(frequency) === -1 || frequency === 'general') {
    showError('Invalid frequency.'); return;
  }
  closeNewTaskMenu();
  _tplModalMode = 'create';
  _tplModalEditingId = null;
  _resetTplModal();
  document.getElementById('task-template-modal-title').textContent = 'New ' + (TASK_FREQUENCY_META[frequency].label) + ' Recurring Task';
  document.getElementById('task-template-modal-save-btn').innerHTML = '<i data-lucide="plus" class="btn-icon"></i>Create Recurring Template';
  document.getElementById('task-template-modal-freq').value = frequency;
  document.getElementById('task-template-modal-freq-label').textContent = TASK_FREQUENCY_META[frequency].label;
  document.getElementById('task-template-modal-active').checked = true;
  _tplPopulateAssigneeCheckboxes([]);
  document.getElementById('task-template-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
  setTimeout(function(){ var el = document.getElementById('task-template-modal-title-input'); if (el) el.focus(); }, 50);
}

function openEditTemplateModal(templateId) {
  if (!isManager) { showError('Manager access only.'); return; }
  var tpl = (TASK_TEMPLATES||[]).find(function(x){ return x.id === templateId; });
  if (!tpl) { showError('Template not found.'); return; }
  _tplModalMode = 'edit';
  _tplModalEditingId = templateId;
  _resetTplModal();
  document.getElementById('task-template-modal-title').textContent = 'Edit ' + (TASK_FREQUENCY_META[tpl.frequency].label) + ' Recurring Task';
  document.getElementById('task-template-modal-save-btn').innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';
  document.getElementById('task-template-modal-freq').value = tpl.frequency;
  document.getElementById('task-template-modal-freq-label').textContent = TASK_FREQUENCY_META[tpl.frequency].label;
  document.getElementById('task-template-modal-title-input').value = tpl.title || '';
  document.getElementById('task-template-modal-description').value = tpl.description || '';
  document.getElementById('task-template-modal-priority').value    = tpl.priority || 'medium';
  document.getElementById('task-template-modal-remarks').value     = tpl.remarks || '';
  document.getElementById('task-template-modal-active').checked    = !!tpl.is_active;
  var currentAssignees = (TASK_TEMPLATE_ASSIGNEES||[]).filter(function(a){ return a.template_id === templateId; }).map(function(a){ return a.assigned_to; });
  _tplPopulateAssigneeCheckboxes(currentAssignees);
  document.getElementById('task-template-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeTaskTemplateModal() {
  document.getElementById('task-template-modal').classList.remove('show');
  _tplModalMode = null;
  _tplModalEditingId = null;
}

function _resetTplModal() {
  var errEl = document.getElementById('task-template-modal-error');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  document.getElementById('task-template-modal-title-input').value = '';
  document.getElementById('task-template-modal-description').value = '';
  document.getElementById('task-template-modal-priority').value    = 'medium';
  document.getElementById('task-template-modal-remarks').value     = '';
  document.getElementById('task-template-modal-active').checked    = true;
}

function _tplPopulateAssigneeCheckboxes(checkedNames) {
  var host = document.getElementById('task-template-modal-assignees');
  if (!host) return;
  var checkedSet = {};
  (checkedNames||[]).forEach(function(n){ checkedSet[n] = 1; });
  host.innerHTML = (EMPLOYEES||[]).map(function(emp){
    var c = checkedSet[emp] ? ' checked' : '';
    return '<label class="task-assignee-chk">'+
      '<input type="checkbox" data-tpl-assignee="'+esc2(emp)+'" value="'+esc2(emp)+'"'+c+'> '+esc2(emp)+
    '</label>';
  }).join('');
}

async function saveTaskTemplateModal() {
  if (!await requireAuth()) return;
  if (!isManager) { showError('Manager access only.'); return; }
  var errEl = document.getElementById('task-template-modal-error');
  function fail(m) { errEl.textContent = '⚠️ ' + m; errEl.style.display = 'block'; }
  errEl.style.display = 'none';

  var frequency   = document.getElementById('task-template-modal-freq').value;
  var title       = (document.getElementById('task-template-modal-title-input').value || '').trim();
  var description = (document.getElementById('task-template-modal-description').value || '').trim();
  var priority    = document.getElementById('task-template-modal-priority').value;
  var remarks     = (document.getElementById('task-template-modal-remarks').value || '').trim();
  var isActive    = !!document.getElementById('task-template-modal-active').checked;

  var assignees = Array.prototype.slice.call(
    document.querySelectorAll('#task-template-modal-assignees input[type=checkbox]:checked')
  ).map(function(i){ return i.value; });

  if (!title)         return fail('Title is required.');
  if (!frequency)     return fail('Frequency is missing.');
  if (!assignees.length) return fail('Pick at least one default assignee.');

  if (_tplModalMode === 'create') {
    var insRes = await sb.from('task_templates').insert({
      title: title,
      description: description || null,
      priority: priority,
      frequency: frequency,
      remarks: remarks || null,
      is_active: isActive,
      created_by: currentUser || 'unknown'
    }).select().single();
    if (insRes.error || !insRes.data) { fail('Save failed: ' + (insRes.error ? insRes.error.message : 'unknown')); return; }
    var tplId = insRes.data.id;
    var asRows = assignees.map(function(emp){ return { template_id: tplId, assigned_to: emp }; });
    var asRes = await sb.from('task_template_assignees').insert(asRows);
    if (asRes.error) {
      await sb.from('task_templates').delete().eq('id', tplId);
      fail('Default assignees failed: ' + asRes.error.message + ' — template was not created.');
      return;
    }
    // Immediately mint the first instance for the current period if active.
    if (isActive) {
      try { await generateMissingInstances(); }
      catch (e) { console.warn('first-instance generation after create failed:', e); }
    }
    closeTaskTemplateModal();
    showToast('Recurring template created · ' + TASK_FREQUENCY_META[frequency].label.toLowerCase());
    // Switch to that frequency tab so user sees their new instance.
    setTasksActiveTab(frequency);
    await loadTasks();
  } else {
    var upd = await sb.from('task_templates').update({
      title: title,
      description: description || null,
      priority: priority,
      remarks: remarks || null,
      is_active: isActive
    }).eq('id', _tplModalEditingId).select().single();
    if (upd.error || !upd.data) { fail('Save failed: ' + (upd.error ? upd.error.message : 'unknown')); return; }

    // Diff assignee set (delete absent + insert new).
    var currentNames = (TASK_TEMPLATE_ASSIGNEES||[]).filter(function(a){ return a.template_id === _tplModalEditingId; }).map(function(a){ return a.assigned_to; });
    var nextSet = {}, currentSet = {};
    assignees.forEach(function(n){ nextSet[n] = 1; });
    currentNames.forEach(function(n){ currentSet[n] = 1; });
    var toRemove = currentNames.filter(function(n){ return !nextSet[n]; });
    var toAdd    = assignees.filter(function(n){ return !currentSet[n]; });
    if (toRemove.length) {
      var delRes = await sb.from('task_template_assignees').delete().eq('template_id', _tplModalEditingId).in('assigned_to', toRemove);
      if (delRes.error) { fail('Could not update default assignees: ' + delRes.error.message); return; }
    }
    if (toAdd.length) {
      var addRes = await sb.from('task_template_assignees').insert(toAdd.map(function(emp){ return { template_id: _tplModalEditingId, assigned_to: emp }; }));
      if (addRes.error) { fail('Could not update default assignees: ' + addRes.error.message); return; }
    }
    closeTaskTemplateModal();
    showToast('Template updated ✓');
    if (typeof openManageTemplatesModal === 'function') {
      // Refresh the list view if it's open underneath.
      var mt = document.getElementById('manage-templates-modal');
      if (mt && mt.classList.contains('show')) renderManageTemplatesList();
    }
    await loadTasks();
  }
}

// == MANAGE TEMPLATES MODAL ======================================
function openManageTemplatesModal() {
  if (!isManager) { showError('Manager access only.'); return; }
  document.getElementById('manage-templates-modal').classList.add('show');
  renderManageTemplatesList();
  if (typeof renderIcons === 'function') renderIcons();
}
function closeManageTemplatesModal() {
  document.getElementById('manage-templates-modal').classList.remove('show');
}

function renderManageTemplatesList() {
  var host = document.getElementById('manage-templates-list');
  if (!host) return;
  if (!TASK_TEMPLATES.length) {
    host.innerHTML = '<div class="team-empty">No recurring templates yet. Use the New ▾ button to create one.</div>';
    return;
  }
  var asByTpl = {};
  (TASK_TEMPLATE_ASSIGNEES||[]).forEach(function(a){
    if (!asByTpl[a.template_id]) asByTpl[a.template_id] = [];
    asByTpl[a.template_id].push(a.assigned_to);
  });
  var rows = TASK_TEMPLATES.map(function(tpl, idx){
    var freq = TASK_FREQUENCY_META[tpl.frequency] || { label: tpl.frequency };
    var asg  = (asByTpl[tpl.id] || []).map(function(n){ return esc2(_tasksShortName(n)); }).join(', ') || '<span class="dim">—</span>';
    var statusBadge = tpl.is_active
      ? '<span class="badge task-pri-low" style="background:#D1FAE5;color:#065F46">Active</span>'
      : '<span class="badge task-pri-low" style="background:#F1F5F9;color:#94A3B8">Inactive</span>';
    return '<tr>'+
      '<td class="dim" style="font-size:12px">'+(idx+1)+'</td>'+
      '<td><strong>'+esc2(tpl.title)+'</strong>'+
        (tpl.description?'<div class="dim" style="font-size:11.5px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc2(tpl.description)+'</div>':'')+
      '</td>'+
      '<td>'+esc2(freq.label)+'</td>'+
      '<td style="font-size:12.5px">'+asg+'</td>'+
      '<td>'+statusBadge+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button class="btn btn-sm btn-ghost btn-icon-only" title="Edit" onclick="openEditTemplateModal('+tpl.id+')"><i data-lucide="pencil"></i></button>'+
        '<button class="btn btn-sm btn-danger btn-icon-only" title="Deactivate" onclick="softDeleteTemplate('+tpl.id+')"><i data-lucide="trash-2"></i></button>'+
      '</td>'+
    '</tr>';
  }).join('');
  host.innerHTML =
    '<div class="table-wrap"><table class="tasks-table">'+
      '<thead><tr>'+
        '<th style="width:32px">#</th>'+
        '<th>Template</th>'+
        '<th>Frequency</th>'+
        '<th>Default assignees</th>'+
        '<th>Status</th>'+
        '<th style="width:90px">Actions</th>'+
      '</tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
    '</table></div>';
  if (typeof renderIcons === 'function') renderIcons();
}

// Soft-delete = set is_active=false. We deliberately don't DELETE the row
// because existing instances FK-reference it and we want the join to keep
// working for history. To fully remove, the manager would need a separate
// "Purge inactive templates" admin tool — not built in Phase 2.
async function softDeleteTemplate(templateId) {
  if (!await requireAuth()) return;
  if (!isManager) { showError('Manager access only.'); return; }
  var tpl = TASK_TEMPLATES.find(function(x){ return x.id === templateId; });
  if (!tpl) return;
  if (!await confirmAction({
    title: 'Deactivate "' + tpl.title + '"?',
    body:  'Future instances will stop being generated. Existing instances (past + current period) stay in place. You can reactivate later by editing the template.',
    confirmText: 'Deactivate',
    danger: true
  })) return;
  var upd = await sb.from('task_templates')
    .update({ is_active: false })
    .eq('id', templateId).select('id,is_active').single();
  if (upd.error || !upd.data || upd.data.is_active !== false) {
    reportSilentFail('task_templates', { op: 'soft_delete', template_id: templateId, error: upd.error && upd.error.message });
    showError('Deactivate failed: ' + (upd.error ? upd.error.message : 'permission denied'));
    return;
  }
  showToast('Template deactivated ✓');
  await loadTasks();
  renderManageTemplatesList();
}
