// == INVENTORY MODULE ==============================================

var _invData   = [];
var _invEditId = null;

function showInventoryTab(tab) {
  ['devices','add','log'].forEach(function(t) {
    var el  = document.getElementById('invtab-'+t);
    var sub = document.getElementById('invsub-'+t);
    if (!el) return;
    el.style.display = (t === tab) ? 'block' : 'none';
    if (!sub) return;
    if (t === tab) { sub.classList.add('active'); }
    else           { sub.classList.remove('active'); }
  });
  if (tab === 'devices') loadInventory();
  if (tab === 'add')     resetAddDeviceForm();
  if (tab === 'log')     loadActivityLog();
  setSidebarSubActive('inventory', tab);
}

async function loadInventory() {
  var wrap = document.getElementById('inv-table-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div>Loading inventory...</div>';
  var res = await sb.from('inventory').select('*').order('id');
  if (res.error) {
    wrap.innerHTML = '<div class="alert alert-error show">Error: '+res.error.message+'</div>';
    return;
  }
  _invData = res.data || [];
  renderInventoryStats(_invData);
  renderInventoryTable(_invData);
}

function renderInventoryStats(data) {
  var el       = document.getElementById('inv-stats');
  var total    = data.length;
  var available = data.filter(function(d) {
    var s = (d.availability_status||'').toLowerCase();
    return s.includes('available') && !s.includes('locked');
  }).length;
  var locked   = data.filter(function(d) {
    return (d.availability_status||'').toLowerCase().includes('locked');
  }).length;
  var ids      = data.filter(function(d) { return d.ids_ps === 'IDS Capable'; }).length;
  var locs     = new Set(data.map(function(d) { return d.current_location; }).filter(Boolean));

  el.innerHTML =
    '<div class="stat-card teal"><div class="stat-label">Total Devices</div><div class="stat-value">'+total+'</div></div>'+
    '<div class="stat-card early"><div class="stat-label">Available</div><div class="stat-value">'+available+'</div></div>'+
    '<div class="stat-card wknd"><div class="stat-label">Locked</div><div class="stat-value">'+locked+'</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">IDS Capable</div><div class="stat-value">'+ids+'</div></div>'+
    '<div class="stat-card navy"><div class="stat-label">Countries</div><div class="stat-value">'+locs.size+'</div></div>';
}

function invStatusClass(status) {
  var s = (status||'').toLowerCase();
  if (s.includes('locked'))    return 'inv-status-locked';
  if (s.includes('available')) return 'inv-status-available';
  if (s === '' || s === '—')   return 'inv-status-default';
  return 'inv-status-unavailable';
}

// Reset every Inventory filter input and re-render. Wired to the "Clear
// filters" CTA in the empty-state card.
function clearInventoryFilters() {
  ['inv-search','inv-filter-model','inv-filter-location','inv-filter-status'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  applyInventoryFilters();
}

function applyInventoryFilters() {
  var search  = (document.getElementById('inv-search').value||'').toLowerCase();
  var modelF  = document.getElementById('inv-filter-model').value;
  var locF    = document.getElementById('inv-filter-location').value;
  var statusF = document.getElementById('inv-filter-status').value;

  var filtered = _invData.filter(function(d) {
    var matchSearch = !search ||
      (d.serial_number||'').toLowerCase().includes(search) ||
      (d.current_location||'').toLowerCase().includes(search) ||
      (d.current_partner||'').toLowerCase().includes(search) ||
      (d.current_end_user||'').toLowerCase().includes(search) ||
      (d.remarks||'').toLowerCase().includes(search);
    var matchModel  = !modelF  || d.model_no === modelF;
    var matchLoc    = !locF    || d.current_location === locF;
    var matchStatus = !statusF || (d.availability_status||'').toLowerCase().includes(statusF);
    return matchSearch && matchModel && matchLoc && matchStatus;
  });
  renderInventoryTable(filtered);
}

function renderInventoryTable(data) {
  var wrap = document.getElementById('inv-table-wrap');
  if (!data.length) {
    // If any filter is active, surface a Clear-filters CTA so the user
    // recovers in one click. With no filters set, it's a true empty
    // dataset — just show the friendly message.
    var anyFilter =
      (document.getElementById('inv-search').value||'') ||
      (document.getElementById('inv-filter-model').value||'') ||
      (document.getElementById('inv-filter-location').value||'') ||
      (document.getElementById('inv-filter-status').value||'');
    wrap.innerHTML = anyFilter
      ? renderEmptyState({
          icon: 'package',
          heading: 'No devices match your filters',
          sub: 'Try removing a filter or clearing them all.',
          btnText: 'Clear filters',
          btnIcon: 'x',
          btnOnclick: 'clearInventoryFilters()'
        })
      : renderEmptyState({
          icon: 'package',
          heading: 'No devices tracked yet',
          sub: 'Add your Aruba EC devices to track serial numbers, locations, and audit history.',
          btnText: 'Add first device',
          btnOnclick: "navigateSub('inventory','add')"
        });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  var rows = '';
  data.forEach(function(d, i) {
    var sc = invStatusClass(d.availability_status);
    rows += '<tr>'+
      '<td style="font-size:11px;color:var(--muted);font-weight:600">'+(i+1)+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace;font-size:12px;font-weight:600">'+
        '<span style="display:inline-flex;align-items:center;gap:6px">'+
          esc2(d.serial_number||'')+
          (d.serial_number
            ? '<button class="inv-copy-btn" title="Copy serial number" aria-label="Copy serial number" data-serial="'+esc2(d.serial_number)+'" onclick="copyInvSerial(this)"><i data-lucide="copy" aria-hidden="true"></i></button>'
            : '')+
        '</span>'+
      '</td>'+
      '<td>'+esc2(d.model_no||'—')+'</td>'+
      '<td><span class="badge '+sc+'">'+esc2(d.availability_status||'—')+'</span></td>'+
      '<td class="hide-mobile">'+esc2(d.current_location||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.current_partner||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.current_end_user||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.ids_ps||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:11px;color:var(--muted);line-height:1.3">'+esc2(d.last_updated_by||'—')+'<br><span style="font-size:10px"'+(d.updated_at?' title="'+relativeTimeTitle(d.updated_at)+'"':'')+'>'+(d.updated_at?relativeTime(d.updated_at):'')+'</span></td>'+
      '<td>'+
        '<div style="display:flex;gap:6px">'+
        '<button class="btn btn-sm btn-ghost" onclick="openEditDeviceModal('+d.id+')">✏️ Edit</button>'+
        (isManager ? '<button class="btn btn-sm btn-danger" onclick="deleteDevice('+d.id+',\''+esc2(d.serial_number||'')+'\')">🗑</button>' : '')+
        '</div>'+
      '</td>'+
    '</tr>';
  });

  wrap.innerHTML =
    '<div class="table-wrap"><table>'+
    '<thead><tr>'+
    '<th>#</th><th>Serial No.</th><th>Model</th><th>Status</th>'+
    '<th class="hide-mobile">Location</th><th class="hide-mobile">Partner</th>'+
    '<th class="hide-mobile">End User</th><th class="hide-mobile">IDS/PS</th>'+
    '<th class="hide-mobile">Last Updated</th><th>Actions</th>'+
    '</tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '</table></div>';
}

// v132: copy a device serial number to the clipboard from the inline copy
// button in the devices table. Shows a toast + a brief checkmark on the
// button. Serial comes from the button's data-serial attribute (esc2'd at
// render — the attribute-quote-break vector is closed; serials are
// alphanumeric in practice anyway).
function copyInvSerial(btn) {
  var serial = btn.getAttribute('data-serial') || '';
  if (!serial) return;
  _invCopyText(serial).then(function(ok) {
    if (!ok) { showError('Could not copy serial.'); return; }
    showToast('Serial copied ✓');
    if (btn._copyRevert) clearTimeout(btn._copyRevert);
    btn.classList.add('inv-copy-done');
    btn.innerHTML = '<span style="font-size:13px;line-height:1">✓</span>';
    btn._copyRevert = setTimeout(function() {
      btn.classList.remove('inv-copy-done');
      btn.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
      if (typeof renderIcons === 'function') renderIcons();
    }, 1200);
  });
}

// Prefer the async Clipboard API (works on HTTPS / localhost). Fall back to
// a hidden-textarea + execCommand for older browsers or non-secure contexts.
// Returns a Promise<boolean>.
function _invCopyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text)
      .then(function() { return true; })
      .catch(function() { return _invCopyFallback(text); });
  }
  return Promise.resolve(_invCopyFallback(text));
}
function _invCopyFallback(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

function resetAddDeviceForm() {
  ['inv-add-serial','inv-add-model','inv-add-status','inv-add-rail','inv-add-ids',
   'inv-add-location','inv-add-partner','inv-add-enduser','inv-add-prevlocation',
   'inv-add-auditloc','inv-add-version','inv-add-remarks','inv-add-auditdate'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function saveNewDevice() {
  if (!await requireAuth()) return;
  var serial = document.getElementById('inv-add-serial').value.trim();
  if (!serial) { showError('Serial number is required.'); return; }

  // Pre-check: serial already in our loaded inventory?
  var dupe = (_invData||[]).find(function(x){ return (x.serial_number||'').toLowerCase() === serial.toLowerCase(); });
  if (dupe) {
    showError('Serial "'+serial+'" already in inventory (model '+(dupe.model_no||'—')+', location '+(dupe.current_location||'—')+'). Use Edit on that device instead of re-adding.');
    return;
  }

  var btn = document.getElementById('inv-add-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  var payload = {
    serial_number:       serial,
    model_no:            document.getElementById('inv-add-model').value,
    availability_status: document.getElementById('inv-add-status').value,
    rail_kit:            document.getElementById('inv-add-rail').value,
    ids_ps:              document.getElementById('inv-add-ids').value,
    current_location:    document.getElementById('inv-add-location').value,
    current_partner:     document.getElementById('inv-add-partner').value,
    current_end_user:    document.getElementById('inv-add-enduser').value,
    previous_location:   document.getElementById('inv-add-prevlocation').value,
    audit_location:      document.getElementById('inv-add-auditloc').value,
    version:             document.getElementById('inv-add-version').value,
    remarks:             document.getElementById('inv-add-remarks').value,
    audit_date:          document.getElementById('inv-add-auditdate').value || null,
    last_updated_by:     currentUser,
  };

  var res = await sb.from('inventory').insert(payload).select().single();
  if (res.error) {
    // Friendly message for unique-violation (race condition fallback)
    if (res.error.code === '23505' || /duplicate key|unique/i.test(res.error.message)) {
      showError('Serial "'+serial+'" already in inventory. Check the device list — it may have just been added.');
    } else {
      showError('Error saving device: ' + res.error.message);
    }
    btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Device'; if (typeof renderIcons === 'function') renderIcons(); return;
  }

  await sb.from('inventory_activity_log').insert({
    device_id:     res.data.id,
    serial_number: serial,
    changed_by:    currentUser,
    action:        'created',
    field_changes: payload,
  });

  btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Device'; if (typeof renderIcons === 'function') renderIcons();
  showInventoryTab('devices');
  showToast('Device saved ✓');
}

function openEditDeviceModal(id) {
  var d = _invData.find(function(x) { return x.id === id; });
  if (!d) return;
  _invEditId = id;
  document.getElementById('inv-edit-serial').textContent     = d.serial_number;
  document.getElementById('inv-edit-model').value            = d.model_no || '';
  document.getElementById('inv-edit-status').value           = d.availability_status || '';
  document.getElementById('inv-edit-rail').value             = d.rail_kit || 'N/A';
  document.getElementById('inv-edit-ids').value              = d.ids_ps || 'N/A';
  document.getElementById('inv-edit-location').value         = d.current_location || '';
  document.getElementById('inv-edit-partner').value          = d.current_partner || '';
  document.getElementById('inv-edit-enduser').value          = d.current_end_user || '';
  document.getElementById('inv-edit-prevlocation').value     = d.previous_location || '';
  document.getElementById('inv-edit-auditloc').value         = d.audit_location || '';
  document.getElementById('inv-edit-version').value          = d.version || '';
  document.getElementById('inv-edit-remarks').value          = d.remarks || '';
  document.getElementById('inv-edit-auditdate').value        = d.audit_date ? d.audit_date.split('T')[0] : '';
  // Last updated info — read-only display
  var lu = document.getElementById('inv-edit-lastupdated');
  if (lu) {
    var by = d.last_updated_by || '—';
    var luStamp = d.updated_at || d.created_at;
    var when = luStamp ? relativeTime(luStamp) : '—';
    lu.value = by + '  •  ' + when;
  }
  document.getElementById('inv-edit-modal').classList.add('show');
}

function closeEditDeviceModal() {
  document.getElementById('inv-edit-modal').classList.remove('show');
  _invEditId = null;
}

async function saveEditDevice() {
  if (!await requireAuth()) return;
  if (!_invEditId) return;
  var btn = document.getElementById('inv-edit-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  var old = _invData.find(function(x) { return x.id === _invEditId; });
  var newData = {
    model_no:            document.getElementById('inv-edit-model').value,
    availability_status: document.getElementById('inv-edit-status').value,
    rail_kit:            document.getElementById('inv-edit-rail').value,
    ids_ps:              document.getElementById('inv-edit-ids').value,
    current_location:    document.getElementById('inv-edit-location').value,
    current_partner:     document.getElementById('inv-edit-partner').value,
    current_end_user:    document.getElementById('inv-edit-enduser').value,
    previous_location:   document.getElementById('inv-edit-prevlocation').value,
    audit_location:      document.getElementById('inv-edit-auditloc').value,
    version:             document.getElementById('inv-edit-version').value,
    remarks:             document.getElementById('inv-edit-remarks').value,
    audit_date:          document.getElementById('inv-edit-auditdate').value || null,
    last_updated_by:     currentUser,
    updated_at:          new Date().toISOString(),
  };

  // Build change diff for log
  var fieldLabels = {
    model_no:'Model', availability_status:'Status', rail_kit:'Rail Kit', ids_ps:'IDS/PS',
    current_location:'Location', current_partner:'Partner', current_end_user:'End User',
    previous_location:'Prev Location', audit_location:'Audit Location',
    version:'Version', remarks:'Remarks', audit_date:'Audit Date'
  };
  var changes = {};
  Object.keys(fieldLabels).forEach(function(k) {
    var oldVal = (old[k] || '');
    var newVal = (newData[k] || '');
    if (String(oldVal) !== String(newVal)) {
      changes[fieldLabels[k]] = { from: oldVal, to: newVal };
    }
  });

  var res = await sb.from('inventory').update(newData).eq('id', _invEditId);
  if (res.error) {
    showError('Error updating device: ' + res.error.message);
    btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes'; if (typeof renderIcons === 'function') renderIcons(); return;
  }

  if (Object.keys(changes).length > 0) {
    await sb.from('inventory_activity_log').insert({
      device_id:     _invEditId,
      serial_number: old.serial_number,
      changed_by:    currentUser,
      action:        'updated',
      field_changes: changes,
    });
  }

  btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes'; if (typeof renderIcons === 'function') renderIcons();
  closeEditDeviceModal();
  showToast('Device saved ✓');
  loadInventory();
}

async function deleteDevice(id, serial) {
  if (!await requireAuth()) return;
  if (!isManager) return;
  if (!await confirmAction({
    title: 'Delete this device?',
    body: 'Serial: '+serial+'\n\nThis cannot be undone.',
    confirmText: 'Delete device'
  })) return;

  await sb.from('inventory_activity_log').insert({
    device_id:     id,
    serial_number: serial,
    changed_by:    currentUser,
    action:        'deleted',
    field_changes: {},
  });

  var res = await sb.from('inventory').delete().eq('id', id);
  if (res.error) { showError('Error deleting: ' + res.error.message); return; }
  showToast('Device deleted ✓');
  loadInventory();
}

async function loadActivityLog() {
  var container = document.getElementById('inv-log-content');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  var res = await sb.from('inventory_activity_log')
    .select('*').order('changed_at', {ascending:false}).limit(200);
  if (res.error) {
    container.innerHTML = '<div class="alert alert-error show">Error: '+res.error.message+'</div>';
    return;
  }
  var data = res.data || [];
  if (!data.length) {
    container.innerHTML = renderEmptyState({
      icon: 'history',
      heading: 'No activity yet',
      sub: 'When a device changes hands, location, or status, the change history shows up here.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var rows = '';
  data.forEach(function(log) {
    var icon  = log.action==='created'?'✅':log.action==='deleted'?'🗑️':'✏️';
    var color = log.action==='created'?'var(--success)':log.action==='deleted'?'var(--danger)':'var(--teal)';
    var changesHtml = '—';
    if (log.action === 'updated' && log.field_changes && typeof log.field_changes === 'object') {
      var parts = [];
      Object.keys(log.field_changes).forEach(function(f) {
        var c = log.field_changes[f];
        parts.push('<span style="color:var(--muted)">'+f+':</span> '+
          '<span style="color:var(--danger);text-decoration:line-through">'+esc2(c.from||'—')+'</span>'+
          ' → <span style="color:var(--success)">'+esc2(c.to||'—')+'</span>');
      });
      changesHtml = parts.join('<br>');
    }
    rows +=
      '<tr>'+
      '<td style="white-space:nowrap;font-size:12px;color:var(--muted)" title="'+relativeTimeTitle(log.changed_at)+'">'+relativeTime(log.changed_at)+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace;font-size:12px;font-weight:600">'+esc2(log.serial_number||'')+'</td>'+
      '<td><span style="color:'+color+';font-weight:600">'+icon+' '+cap(log.action)+'</span></td>'+
      '<td>'+esc2(log.changed_by||'')+'</td>'+
      '<td style="font-size:12px;line-height:1.7">'+changesHtml+'</td>'+
      '</tr>';
  });

  container.innerHTML =
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>Date</th><th>Serial No.</th><th>Action</th><th>Changed By</th><th>Changes</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '</table></div>';
}

function exportInventoryCSV() {
  if (!_invData.length) { showError('No data to export.'); return; }
  var headers = ['Serial Number','Model','Status','Rail Kit','IDS/PS','Location',
                 'Partner','End User','Previous Location','Audit Location','Version',
                 'Remarks','Audit Date','Last Updated By'];
  var rows = [headers];
  _invData.forEach(function(d) {
    rows.push([d.serial_number,d.model_no,d.availability_status,d.rail_kit,d.ids_ps,
               d.current_location,d.current_partner,d.current_end_user,d.previous_location,
               d.audit_location,d.version,d.remarks,d.audit_date,d.last_updated_by]);
  });
  var csv = rows.map(function(r) {
    return r.map(function(v) { return '"'+(v||'')+'"'; }).join(',');
  }).join('\n');
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'GulfIT_Inventory_'+new Date().toLocaleDateString('en-GB').replace(/\//g,'-')+'.csv';
  a.click();
}

