// == TASKS MODULE (v93, Phase 1) =====================================
// General task list + multi-owner assignment + status updates. Recurring
// tasks (daily / weekly / etc.) come in Phase 2 (v94); Excel import in
// Phase 3 (v95). The Excel sheet keeps being authoritative until v95;
// no dual-write yet.
//
// Permission model (matches the RLS in the tasks_and_assignments
// migration):
//   - Read: any authenticated user sees all tasks.
//   - Insert/Delete (= archive): manager only.
//   - Update: manager OR any assignee. The RLS allows the UPDATE
//     statement itself; the UI restricts which FIELDS an assignee can
//     change (status + remarks only). Manager-only fields carry a
//     data-mgr-only="1" attribute and tasks.js disables them when the
//     editing user isn't the manager.

var TASKS_DATA        = [];   // cached task rows (current filter excluded)
var TASKS_ASSIGNMENTS = [];   // cached assignments { task_id, assigned_to }
var _tasksLoading     = false;

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

// == LOAD ========================================================
async function loadTasks() {
  if (_tasksLoading) return;
  _tasksLoading = true;
  var loadEl = document.getElementById('tasks-load');
  var contentEl = document.getElementById('tasks-content');
  if (loadEl) loadEl.style.display = 'flex';
  if (contentEl) contentEl.innerHTML = '';

  // Two parallel fetches — tasks + their assignments. We don't use a
  // PostgREST embed (.select('*,task_assignments(*)')) because it can
  // get prickly with RLS on the junction table; explicit join in JS is
  // simpler to reason about and gives us a single client-side cache.
  var res = await Promise.all([
    sb.from('tasks').select('*').order('created_at', { ascending: false }),
    sb.from('task_assignments').select('task_id,assigned_to')
  ]);
  _tasksLoading = false;
  if (loadEl) loadEl.style.display = 'none';
  if (res[0].error) {
    if (contentEl) contentEl.innerHTML = '<div class="alert alert-error show">Error loading tasks: ' + esc2(res[0].error.message) + '</div>';
    return;
  }
  TASKS_DATA        = res[0].data || [];
  TASKS_ASSIGNMENTS = (res[1].error ? [] : (res[1].data || []));

  // Populate the Owner filter dropdown once data is here. EMPLOYEES is
  // the canonical team list; we add an "Unassigned" sentinel for tasks
  // with no assignees (edge case but possible if RLS killed an insert).
  _tasksPopulateOwnerFilter();

  // Surface the "New Task" button only for managers — matches the RLS
  // INSERT policy so non-managers don't see an affordance they can't use.
  var newBtn = document.getElementById('tasks-new-btn');
  if (newBtn) newBtn.style.display = isManager ? '' : 'none';

  renderTasksList();
  // Refresh the sidebar badge — counts may have changed since last poll.
  if (typeof updateTasksBadge === 'function') updateTasksBadge();
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

  return (TASKS_DATA||[]).filter(function(t){
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
}

// == RENDER LIST =================================================
function renderTasksList() {
  var host = document.getElementById('tasks-content');
  if (!host) return;
  var rows = _tasksFiltered();
  var assignByTask = _tasksAssigneesByTaskId();

  if (!rows.length) {
    var emptyHtml;
    if (!TASKS_DATA.length) {
      // Genuine empty state — no tasks ever created.
      emptyHtml = (typeof renderEmptyState === 'function')
        ? renderEmptyState({
            icon:'check-square',
            heading:'No tasks yet',
            sub: isManager ? 'Click + New Task above to create the first one.' : 'Your manager hasn\'t created any tasks yet.',
            btnText: isManager ? 'Create the first task' : null,
            btnOnclick: isManager ? 'openCreateTaskModal()' : null
          })
        : '<div class="team-empty">No tasks yet.</div>';
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
    var datesText = [t.start_date, t.eta_date, t.end_date]
      .map(function(d){ return d ? fmtDate(d) : '—'; })
      .join(' / ');

    return '<tr class="'+(t.is_archived?'task-row-archived':'')+'">'+
      '<td class="dim" style="font-size:12px">'+(idx+1)+'</td>'+
      '<td><strong>'+esc2(t.title)+'</strong>'+
        (t.description?'<div class="dim" style="font-size:11.5px;margin-top:2px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc2(t.description)+'">'+esc2(t.description)+'</div>':'')+
      '</td>'+
      '<td style="font-size:12.5px">'+ownerText+'</td>'+
      '<td><span class="badge '+priMeta.cls+'">'+esc2(priMeta.label)+'</span></td>'+
      '<td>'+statusCell+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:11.5px;color:var(--muted);white-space:nowrap">'+datesText+'</td>'+
      '<td style="white-space:nowrap">'+actions+'</td>'+
    '</tr>';
  }).join('');

  host.innerHTML =
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div class="table-wrap"><table class="tasks-table">'+
        '<thead><tr>'+
          '<th style="width:32px">#</th>'+
          '<th>Task</th>'+
          '<th>Owner(s)</th>'+
          '<th>Priority</th>'+
          '<th>Status</th>'+
          '<th>Start / ETA / End</th>'+
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
  if (!isManager) { showError('Only managers can create tasks.'); return; }
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
