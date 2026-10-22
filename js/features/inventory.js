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
  if (tab === 'add')     { resetAddDeviceForm(); loadInvCatalog().then(function(){ fillInvVendorSelect('add', ''); fillInvModelSelect('add', '', ''); }); }
  if (tab === 'log')     loadActivityLog();
  setSidebarSubActive('inventory', tab);
}

async function loadInventory() {
  var wrap = document.getElementById('inv-table-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div>Loading inventory...</div>';
  var both = await Promise.all([sb.from('inventory').select('*').order('id'), loadInvCatalog()]);
  var res = both[0];
  if (res.error) {
    wrap.innerHTML = '<div class="alert alert-error show">Error: '+res.error.message+'</div>';
    return;
  }
  _invData = res.data || [];
  fillInvFilterVendors();
  renderInventoryStats(_invData);
  applyInventoryFilters();
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
  ['inv-search','inv-filter-vendor','inv-filter-model','inv-filter-location','inv-filter-status'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  applyInventoryFilters();
}

function applyInventoryFilters() {
  var search  = (document.getElementById('inv-search').value||'').toLowerCase();
  var modelF  = document.getElementById('inv-filter-model').value;
  var vendorF = (document.getElementById('inv-filter-vendor') || {}).value || '';
  var locF    = document.getElementById('inv-filter-location').value;
  var statusF = document.getElementById('inv-filter-status').value;

  var filtered = _invData.filter(function(d) {
    var matchSearch = !search ||
      (d.serial_number||'').toLowerCase().includes(search) ||
      (d.vendor||'').toLowerCase().includes(search) ||
      (d.model_no||'').toLowerCase().includes(search) ||
      (d.current_location||'').toLowerCase().includes(search) ||
      (d.current_partner||'').toLowerCase().includes(search) ||
      (d.current_end_user||'').toLowerCase().includes(search) ||
      (d.remarks||'').toLowerCase().includes(search);
    var matchModel  = !modelF  || d.model_no === modelF;
    var matchVendor = !vendorF || (d.vendor||'') === vendorF;
    var matchLoc    = !locF    || d.current_location === locF;
    var matchStatus = !statusF || (d.availability_status||'').toLowerCase().includes(statusF);
    return matchSearch && matchVendor && matchModel && matchLoc && matchStatus;
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
      ((document.getElementById('inv-filter-vendor')||{}).value||'') ||
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
          sub: 'Add your devices to track serial numbers, locations, and audit history.',
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
      '<td style="font-variant-numeric:tabular-nums;font-size:12px">'+
        '<span style="display:inline-flex;align-items:center;gap:6px">'+
          esc2(d.serial_number||'')+
          (d.serial_number
            ? '<button class="inv-copy-btn" title="Copy serial number" aria-label="Copy serial number" data-serial="'+esc2(d.serial_number)+'" onclick="copyInvSerial(this)"><i data-lucide="copy" aria-hidden="true"></i></button>'
            : '')+
        '</span>'+
      '</td>'+
      '<td>'+_invEsc(d.model_no||'—')+(d.vendor ? '<div style="font-size:11px;color:var(--muted)">'+_invEsc(d.vendor)+'</div>' : '')+'</td>'+
      '<td><span class="badge '+sc+'">'+esc2(d.availability_status||'—')+'</span></td>'+
      '<td class="hide-mobile">'+esc2(d.current_location||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.current_partner||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.current_end_user||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.ids_ps||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:11px;color:var(--muted);line-height:1.3">'+esc2(d.last_updated_by||'—')+'<br><span style="font-size:10px"'+(d.updated_at?' title="'+relativeTimeTitle(d.updated_at)+'"':'')+'>'+(d.updated_at?relativeTime(d.updated_at):'')+'</span></td>'+
      '<td>'+
        '<div style="display:flex;gap:6px">'+
        '<button class="btn btn-sm btn-ghost" onclick="openEditDeviceModal('+d.id+')">✏️ Edit</button>'+
        '<button class="btn btn-sm btn-danger" title="Delete device" aria-label="Delete device '+esc2(d.serial_number||'')+'" onclick="deleteDevice('+d.id+',\''+esc2(d.serial_number||'')+'\')">🗑</button>'+
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
  ['inv-add-serial','inv-add-status','inv-add-rail','inv-add-ids',
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

  var addVendor = document.getElementById('inv-add-vendor').value;
  var addModel  = document.getElementById('inv-add-model').value;
  if (addVendor === INV_NEW || addModel === INV_NEW) { showError('Finish adding the company or model first.'); return; }
  if (!addVendor) { showError('Pick the company.'); return; }
  if (!addModel)  { showError('Pick the model (or add a new one from the list).'); return; }

  var btn = document.getElementById('inv-add-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  var payload = {
    serial_number:       serial,
    vendor:              addVendor,
    model_no:            addModel,
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
  fillInvVendorSelect('edit', d.vendor || '');
  fillInvModelSelect('edit', d.vendor || '', d.model_no || '');
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
  var editVendor = document.getElementById('inv-edit-vendor').value;
  var editModel  = document.getElementById('inv-edit-model').value;
  if (editVendor === INV_NEW || editModel === INV_NEW || !editVendor || !editModel) {
    showError(!editVendor ? 'Pick the company.' : 'Pick the model (or add a new one from the list).');
    btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  var newData = {
    vendor:              editVendor,
    model_no:            editModel,
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
    vendor:'Company', model_no:'Model', availability_status:'Status', rail_kit:'Rail Kit', ids_ps:'IDS/PS',
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

// v181: open to employees as well as managers (the inventory RLS policy
// already allowed it; only the UI hid the button). Because anyone can now
// delete, the record of a deletion has to stand on its own:
//   - the warning names the device, so the person sees what they are removing
//   - the log keeps a snapshot of the device's details, since the row itself
//     is gone afterwards and a bare serial number says nothing about it
//   - the log is written only AFTER the delete succeeds. It used to be written
//     first, so a failed delete still left a "Deleted" entry behind.
// inventory_activity_log has no UPDATE or DELETE policy, so the entry cannot
// be edited or removed afterwards.
var INV_DELETE_SNAPSHOT_FIELDS = [
  ['vendor','Company'], ['model_no','Model'], ['availability_status','Status'], ['current_location','Location'],
  ['current_partner','Partner'], ['current_end_user','End user'], ['ids_ps','IDS/PS'],
  ['version','Version'], ['remarks','Remarks']
];

async function deleteDevice(id, serial) {
  if (!await requireAuth()) return;
  var d = (_invData || []).filter(function(x){ return x.id === id; })[0] || { id:id, serial_number:serial };
  var NL = String.fromCharCode(10);

  var lines = ['Serial: ' + (d.serial_number || serial || '—')];
  INV_DELETE_SNAPSHOT_FIELDS.slice(0, 5).forEach(function(f){
    if (d[f[0]]) lines.push(f[1] + ': ' + d[f[0]]);
  });

  if (!await confirmAction({
    title: 'Delete this device?',
    body: lines.join(NL) + NL + NL +
          'This permanently removes the device from inventory and cannot be undone. ' +
          'The deletion is recorded in the Activity Log under your name.',
    confirmText: 'Delete device',
    cancelText: 'Keep device',
    danger: true
  })) return;

  var res = await sb.from('inventory').delete().eq('id', id).select('id');
  if (res.error) { showError('Could not delete: ' + res.error.message); return; }
  // RLS can filter a delete down to zero rows without raising an error.
  if (!res.data || !res.data.length) {
    showError('The device was not deleted - it may already be gone, or you may not have permission.');
    loadInventory();
    return;
  }

  var snapshot = {};
  INV_DELETE_SNAPSHOT_FIELDS.forEach(function(f){
    if (d[f[0]] != null && d[f[0]] !== '') snapshot[f[0]] = { from: d[f[0]], to: null };
  });
  var logRes = await sb.from('inventory_activity_log').insert({
    device_id:     id,
    serial_number: d.serial_number || serial,
    changed_by:    currentUser,
    action:        'deleted',
    field_changes: snapshot
  });
  if (logRes.error && typeof reportSilentFail === 'function') {
    reportSilentFail('inventory_activity_log', { op: 'deleted', error: logRes.error.message });
  }

  showToast('Device ' + (d.serial_number || serial) + ' deleted');
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
    var isDelete = log.action === 'deleted';
    // v181: a deletion lists what the device WAS, since the row no longer exists.
    if (isDelete && log.field_changes && typeof log.field_changes === 'object') {
      var gone = [];
      INV_DELETE_SNAPSHOT_FIELDS.forEach(function(f){
        var c = log.field_changes[f[0]];
        if (c && c.from != null && c.from !== '') {
          gone.push('<span class="inv-log-del-key">'+f[1]+':</span> '+esc2(c.from));
        }
      });
      if (gone.length) changesHtml = gone.join('<br>');
    }
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
      '<tr'+(isDelete ? ' class="inv-log-deleted"' : '')+'>'+
      '<td style="white-space:nowrap;font-size:12px;color:var(--muted)" title="'+relativeTimeTitle(log.changed_at)+'">'+relativeTime(log.changed_at)+'</td>'+
      '<td style="font-variant-numeric:tabular-nums;font-size:12px;font-weight:600">'+esc2(log.serial_number||'')+'</td>'+
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
  var headers = ['Serial Number','Company','Model','Status','Rail Kit','IDS/PS','Location',
                 'Partner','End User','Previous Location','Audit Location','Version',
                 'Remarks','Audit Date','Last Updated By'];
  var rows = [headers];
  _invData.forEach(function(d) {
    rows.push([d.serial_number,d.vendor,d.model_no,d.availability_status,d.rail_kit,d.ids_ps,
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

// == COMPANIES & MODELS (v199) ======================================
// Inventory used to be Aruba EdgeConnect only, with five models hard-coded
// in three dropdowns. Devices now carry a company (inventory.vendor) and the
// models come from the inventory_models catalogue, which anyone can extend
// from the Add / Edit Device form ("+ Add new model..."). Company names are
// offered from that catalogue plus the active Vendors & Products list, so
// "Netally" is spelled the same everywhere.
var _invModels  = [];   // [{ vendor, model }]
var _invVendors = [];   // active names from the vendors table
var INV_NEW = '__new__';

async function loadInvCatalog() {
  var res = await Promise.all([
    sb.from('inventory_models').select('vendor,model').order('vendor').order('model'),
    sb.from('vendors').select('name').eq('is_active', true).order('name')
  ]);
  if (!res[0].error) _invModels  = res[0].data || [];
  if (!res[1].error) _invVendors = (res[1].data || []).map(function(v){ return v.name; });
  return !res[0].error;
}

function _invEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Every company worth offering: catalogue, vendor list, and anything already
// on a device (so an old value is never dropped from its own edit form).
function _invCompanies() {
  var seen = {}, out = [];
  function add(n) { n = (n || '').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); } }
  _invModels.forEach(function(m){ add(m.vendor); });
  _invVendors.forEach(add);
  (_invData || []).forEach(function(d){ add(d.vendor); });
  return out.sort(function(a, b){ return a.localeCompare(b); });
}

function _invModelsFor(vendor) {
  var v = (vendor || '').toLowerCase(), seen = {}, out = [];
  _invModels.forEach(function(m){
    if ((m.vendor || '').toLowerCase() === v && !seen[m.model.toLowerCase()]) { seen[m.model.toLowerCase()] = 1; out.push(m.model); }
  });
  return out;
}

function fillInvVendorSelect(prefix, selected) {
  var sel = document.getElementById('inv-' + prefix + '-vendor');
  if (!sel) return;
  var list = _invCompanies();
  if (selected && list.indexOf(selected) === -1) list.unshift(selected);
  sel.innerHTML = '<option value="">-- Select company --</option>' +
    list.map(function(n){ return '<option value="' + _invEsc(n) + '"' + (n === selected ? ' selected' : '') + '>' + _invEsc(n) + '</option>'; }).join('') +
    '<option value="' + INV_NEW + '">+ Add new company...</option>';
}

function fillInvModelSelect(prefix, vendor, selected) {
  var sel = document.getElementById('inv-' + prefix + '-model');
  if (!sel) return;
  if (!vendor) {
    sel.innerHTML = '<option value="">-- Pick a company first --</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  var list = _invModelsFor(vendor);
  if (selected && list.indexOf(selected) === -1) list.unshift(selected);
  sel.innerHTML = '<option value="">-- Select model --</option>' +
    list.map(function(m){ return '<option value="' + _invEsc(m) + '"' + (m === selected ? ' selected' : '') + '>' + _invEsc(m) + '</option>'; }).join('') +
    '<option value="' + INV_NEW + '">+ Add new model...</option>';
}

// Store a new company+model pair. A pair someone else added a moment ago
// (unique violation) is fine - it exists, which is all we wanted.
async function _invAddModel(vendor, model) {
  if (!await requireAuth()) return false;
  var ins = await sb.from('inventory_models').insert({ vendor: vendor, model: model, created_by: currentUser });
  if (ins.error && ins.error.code !== '23505') { showError('Could not add the model: ' + ins.error.message); return false; }
  await loadInvCatalog();
  fillInvFilterVendors();
  return true;
}

async function onInvVendorChange(prefix) {
  var vSel = document.getElementById('inv-' + prefix + '-vendor');
  if (vSel.value !== INV_NEW) { fillInvModelSelect(prefix, vSel.value, ''); return; }
  var name = await promptInput({
    title: 'Add a company', label: 'Company name', placeholder: 'e.g. Netally', confirmText: 'Next',
    body: 'Then add its first model. Use the same spelling as Vendors & Products if the company is listed there.',
    validate: function(v){ return v.length > 60 ? 'Keep it under 60 characters.' : null; }
  });
  if (!name) { fillInvVendorSelect(prefix, ''); fillInvModelSelect(prefix, '', ''); return; }
  // Reuse an existing spelling rather than creating "NetAlly" next to "Netally".
  var existing = _invCompanies().find(function(c){ return c.toLowerCase() === name.toLowerCase(); });
  name = existing || name;
  var model = await promptInput({
    title: 'First model for ' + name, label: 'Model', placeholder: 'e.g. LinkRunner 10G', confirmText: 'Add',
    validate: function(v){ return v.length > 60 ? 'Keep it under 60 characters.' : null; }
  });
  if (!model) { fillInvVendorSelect(prefix, existing ? name : ''); fillInvModelSelect(prefix, existing ? name : '', ''); return; }
  if (await _invAddModel(name, model)) {
    fillInvVendorSelect(prefix, name);
    fillInvModelSelect(prefix, name, model);
    showToast('Added ' + name + ' ' + model + ' \u2713');
  } else {
    fillInvVendorSelect(prefix, ''); fillInvModelSelect(prefix, '', '');
  }
}

async function onInvModelChange(prefix) {
  var vendor = document.getElementById('inv-' + prefix + '-vendor').value;
  var mSel = document.getElementById('inv-' + prefix + '-model');
  if (mSel.value !== INV_NEW) return;
  var model = await promptInput({
    title: 'Add a model for ' + vendor, label: 'Model', placeholder: 'e.g. EtherScope nXG', confirmText: 'Add',
    validate: function(v){ return v.length > 60 ? 'Keep it under 60 characters.' : null; }
  });
  if (!model) { fillInvModelSelect(prefix, vendor, ''); return; }
  var dup = _invModelsFor(vendor).find(function(m){ return m.toLowerCase() === model.toLowerCase(); });
  if (dup) { fillInvModelSelect(prefix, vendor, dup); return; }
  if (await _invAddModel(vendor, model)) { fillInvModelSelect(prefix, vendor, model); showToast('Added model ' + model + ' \u2713'); }
  else fillInvModelSelect(prefix, vendor, '');
}

function fillInvFilterVendors() {
  var sel = document.getElementById('inv-filter-vendor');
  if (!sel) return;
  var keep = sel.value;
  var list = _invCompanies().filter(function(c){
    return (_invData || []).some(function(d){ return (d.vendor || '') === c; });
  });
  sel.innerHTML = '<option value="">All Companies</option>' +
    list.map(function(n){ return '<option value="' + _invEsc(n) + '">' + _invEsc(n) + '</option>'; }).join('');
  sel.value = list.indexOf(keep) !== -1 ? keep : '';
  fillInvFilterModels();
}

// Models that are actually on devices, narrowed to the chosen company.
function fillInvFilterModels() {
  var sel = document.getElementById('inv-filter-model');
  if (!sel) return;
  var keep = sel.value;
  var vendor = (document.getElementById('inv-filter-vendor') || {}).value || '';
  var seen = {}, list = [];
  (_invData || []).forEach(function(d){
    if (!d.model_no || (vendor && (d.vendor || '') !== vendor) || seen[d.model_no]) return;
    seen[d.model_no] = 1; list.push(d.model_no);
  });
  list.sort(function(a, b){ return a.localeCompare(b); });
  sel.innerHTML = '<option value="">All Models</option>' +
    list.map(function(m){ return '<option value="' + _invEsc(m) + '">' + _invEsc(m) + '</option>'; }).join('');
  sel.value = list.indexOf(keep) !== -1 ? keep : '';
}
