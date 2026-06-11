// == CERTIFICATES MODULE ============================================
// Employees upload professional certificates (Aruba/Cisco/HPE/etc).
// Files live in the Supabase `certificates` storage bucket; metadata
// rows live in the `certificates` table. RLS on both: employees see
// only their own; managers see everything.

var _certData      = [];
var _certActiveSub = 'mine';   // 'mine' | 'all'
var _certGulfitFilter = 'all'; // 'all' | 'gulfit' | 'other' — applies on the All Certificates view only

// ── helpers ────────────────────────────────────────────────────────

// Slugify employee name for storage paths. MUST match the SQL helper
// `lower(regexp_replace(employee, '\s+', '_', 'g'))` used in the
// storage RLS policy or uploads/downloads will be denied.
function _certSlug(name) {
  return String(name||'').trim().toLowerCase().replace(/\s+/g, '_');
}

// Cert status: 🟢 Active (>30d) / 🟡 Soon (0-30d) / 🔴 Expired
// v123: threshold lowered 60d→30d so the row badge matches the dashboard
// expiry alert window (dashboard.js:914 uses 30d). Previously a cert
// 31-60 days from expiry showed yellow on the list with no dashboard
// surface — out of sync with CLAUDE.md "30-day expiry surfaces on dashboard".
function _certStatus(expiryISO) {
  if (!expiryISO) return { key:'unknown', label:'—', cls:'cert-st-unknown' };
  var today = new Date(); today.setHours(0,0,0,0);
  var exp = new Date(String(expiryISO).split('T')[0] + 'T00:00:00');
  var days = Math.floor((exp - today) / 86400000);
  if (days < 0)      return { key:'expired', label:'Expired',        cls:'cert-st-expired',  days:days };
  if (days <= 30)    return { key:'soon',    label:'Expiring Soon',  cls:'cert-st-soon',     days:days };
  return                  { key:'active',  label:'Active',         cls:'cert-st-active',   days:days };
}

// ── tab navigation ─────────────────────────────────────────────────

function showCertTab(tab) {
  _certActiveSub = tab;
  // Reset the Gulfit chip filter on every tab switch so the user never
  // lands on a stuck filter across navigations. Defense in depth — the
  // chip row also stays visible during empty-filter states, but this
  // means the user doesn't have to think about it at all.
  _certGulfitFilter = 'all';
  ['mine','all'].forEach(function(t){
    var el = document.getElementById('certtab-'+t);
    if (el) el.style.display = (t===tab ? 'block' : 'none');
  });
  setSidebarSubActive('certificates', tab);
  loadCertificates();
}

// ── data load ──────────────────────────────────────────────────────

async function loadCertificates() {
  var isAll = (_certActiveSub === 'all') && isManager;
  var loadId    = isAll ? 'cert-all-load'    : 'cert-mine-load';
  var contentId = isAll ? 'cert-all-content' : 'cert-mine-content';
  var load = document.getElementById(loadId);
  var content = document.getElementById(contentId);
  if (load)    load.style.display    = 'flex';
  if (content) content.innerHTML     = '';

  var q = sb.from('certificates').select('*').order('expiry_date', { ascending: true });
  if (!isAll) q = q.eq('employee', currentUser);
  var res = await q;

  if (load) load.style.display = 'none';
  if (res.error) {
    if (content) content.innerHTML = '<div class="alert alert-error show">Error loading certificates: '+esc2(res.error.message)+'</div>';
    return;
  }
  _certData = res.data || [];
  if (isAll) populateCertEmpFilter();
  renderCertList();
}

function populateCertEmpFilter() {
  var sel = document.getElementById('cert-all-filter-emp');
  if (!sel) return;
  var current = sel.value;
  var seen = {};
  var html = '<option value="">All Employees</option>';
  _certData.forEach(function(c){
    if (c.employee && !seen[c.employee]) {
      seen[c.employee] = 1;
      html += '<option>'+esc2(c.employee)+'</option>';
    }
  });
  sel.innerHTML = html;
  sel.value = current;
}

// ── render ─────────────────────────────────────────────────────────

function renderCertList() {
  var isAll = (_certActiveSub === 'all') && isManager;
  var contentId = isAll ? 'cert-all-content' : 'cert-mine-content';
  var content = document.getElementById(contentId);
  if (!content) return;

  var rows = _certData.slice();

  // Manager-only employee filter + Gulfit-relevance chip (All view only).
  if (isAll) {
    var empFilter = ((document.getElementById('cert-all-filter-emp')||{}).value||'').trim();
    if (empFilter) rows = rows.filter(function(c){return c.employee===empFilter;});
    if (_certGulfitFilter === 'gulfit') rows = rows.filter(function(c){ return !!c.is_gulfit_relevant; });
    if (_certGulfitFilter === 'other')  rows = rows.filter(function(c){ return !c.is_gulfit_relevant; });
  }

  // Build the chip row up front so it survives the empty-state branch.
  // Without this the v74 trap re-appears: filter to zero matches →
  // entire content area replaced with the empty state → chip row
  // disappears → user has no way to click "All" to recover.
  var chipBar = '';
  if (isAll && _certData.length > 0) {
    var allN     = _certData.length;
    var gulfitN  = _certData.filter(function(c){return !!c.is_gulfit_relevant;}).length;
    var otherN   = allN - gulfitN;
    var chipFn = function(key, label, count) {
      var act = (_certGulfitFilter === key);
      return '<button class="amc-chip cert-gulfit-chip-'+key+(act?' amc-chip-active':'')+'" onclick="setCertGulfitFilter(\''+key+'\')">'+
        label+' <span class="amc-chip-count">'+fmtCount(count)+'</span></button>';
    };
    chipBar =
      '<div class="amc-chip-row" style="margin-bottom:12px">'+
        chipFn('all',    'All',     allN)+
        chipFn('gulfit', '🟢 Gulfit Relevant', gulfitN)+
        chipFn('other',  '⚪ Other', otherN)+
      '</div>';
  }

  if (!rows.length) {
    // Branch the empty-state copy: there's a real difference between
    // "no certs uploaded yet" and "filter eliminated every cert", and
    // showing the same welcome text for both made the user think their
    // data was gone.
    var emptyHtml;
    if (isAll && _certData.length > 0) {
      // Filter eliminated everything. Chips above already give them
      // the way out; the message just names the situation.
      emptyHtml = renderEmptyState({
        icon: 'filter-x',
        heading: 'No certificates match this filter',
        sub: "Click 'All' above to show every certificate, or pick a different filter chip.",
        btnText: 'Clear filter',
        btnIcon: 'rotate-ccw',
        btnOnclick: "setCertGulfitFilter('all')"
      });
    } else if (isAll) {
      // True empty: no certs anywhere in the system yet.
      emptyHtml = renderEmptyState({
        icon: 'award',
        heading: 'Team certifications hub',
        sub: "Once employees upload their certs, you'll see everyone's qualifications and expiry dates here."
      });
    } else {
      // Mine view, no own certs.
      emptyHtml = renderEmptyState({
        icon: 'award',
        heading: 'No certificates yet',
        sub: 'Track your professional certs like Aruba ACMA, HPE Sales, or CCNA. Get expiry alerts so you renew on time.',
        btnText: 'Upload your first certificate',
        btnIcon: 'upload-cloud',
        btnOnclick: 'openCertUploadModal()'
      });
    }
    content.innerHTML = chipBar + emptyHtml;
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var th = '<tr>'+
    (isAll ? '<th>Employee</th>' : '')+
    '<th>Certificate</th>'+
    '<th class="hide-mobile">Issued</th>'+
    '<th>Expires</th>'+
    '<th>Status</th>'+
    '<th class="hide-mobile">File</th>'+
    '<th></th>'+
  '</tr>';

  var body = rows.map(function(c){
    var st = _certStatus(c.expiry_date);
    var actionsOwn = (c.employee === currentUser);
    var actionsMgr = isManager;
    var fileLabel = (c.file_name && c.file_name.length > 32) ? (c.file_name.slice(0,30)+'…') : (c.file_name||'—');
    // Inline tag next to the cert name. Green "Gulfit" pill when the
    // manager has flagged the cert; muted grey "General" pill otherwise.
    // Showing both states (vs only Gulfit) makes the backfill workflow
    // legible at a glance and removes the implicit "is this just
    // unflagged or actually general?" ambiguity.
    var relBadge = c.is_gulfit_relevant
      ? ' <span class="cert-gulfit-badge" title="Aligned with Gulfit\'s partner business">Gulfit</span>'
      : ' <span class="cert-general-badge" title="Not flagged as Gulfit-relevant">General</span>';
    return '<tr>'+
      (isAll ? '<td style="font-weight:600">'+esc2(c.employee)+'</td>' : '')+
      '<td><button type="button" class="cert-name-btn" onclick="previewCertificate('+c.id+')" title="Click to preview">'+esc2(c.name)+'</button>'+relBadge+'</td>'+
      '<td class="hide-mobile num">'+fmtDate(c.issue_date)+'</td>'+
      '<td class="num">'+fmtDate(c.expiry_date)+
        (st.key==='soon' ? '<div style="font-size:11px;color:#B45309;margin-top:2px">'+st.days+'d left</div>' : '')+
        (st.key==='expired' ? '<div style="font-size:11px;color:#B91C1C;margin-top:2px">'+Math.abs(st.days)+'d ago</div>' : '')+
      '</td>'+
      '<td><span class="badge cert-status '+st.cls+'">'+esc2(st.label)+'</span></td>'+
      '<td class="hide-mobile" style="font-size:12px;color:var(--muted)">'+esc2(fileLabel)+'</td>'+
      '<td style="white-space:nowrap;text-align:right">'+
        '<button class="btn btn-sm btn-ghost" onclick="previewCertificate('+c.id+')" title="Preview"><i data-lucide="eye" class="btn-icon" style="margin-right:0"></i></button>'+
        '<button class="btn btn-sm btn-ghost" onclick="downloadCertificate('+c.id+')" title="Download"><i data-lucide="download" class="btn-icon" style="margin-right:0"></i></button>'+
        ((actionsOwn || actionsMgr) ? '<button class="btn btn-sm btn-ghost" onclick="openCertEditModal('+c.id+')" title="Edit"><i data-lucide="pencil-line" class="btn-icon" style="margin-right:0"></i></button>' : '')+
        ((actionsOwn || actionsMgr) ? '<button class="btn btn-sm btn-danger" onclick="confirmDeleteCertificate('+c.id+')" title="Delete"><i data-lucide="trash-2" class="btn-icon" style="margin-right:0"></i></button>' : '')+
      '</td>'+
    '</tr>';
  }).join('');

  // chipBar was built above so it survives the empty-state branch too.
  content.innerHTML =
    chipBar+
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div class="table-wrap"><table class="cert-table"><thead>'+th+'</thead><tbody>'+body+'</tbody></table></div>'+
    '</div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+_certData.length+' certificates</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function setCertGulfitFilter(key) {
  _certGulfitFilter = key;
  renderCertList();
}

// ── upload modal ───────────────────────────────────────────────────

function openCertUploadModal() {
  ['cert-up-name','cert-up-issue','cert-up-expiry','cert-up-file'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  // Default issue date to today
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('cert-up-issue').value = today;
  document.getElementById('cert-up-error').style.display = 'none';
  document.getElementById('cert-upload-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeCertUploadModal() {
  document.getElementById('cert-upload-modal').classList.remove('show');
}

function _certShowError(elId, msg) {
  var e = document.getElementById(elId);
  if (!e) return;
  e.textContent = msg;
  e.style.display = 'block';
}

var _CERT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
var _CERT_ALLOWED   = ['application/pdf','image/png','image/jpeg','image/jpg'];

function _certValidate(name, issue, expiry, file, requireFile, errEl) {
  if (!name)    { _certShowError(errEl, 'Certificate name is required.'); return false; }
  if (!issue)   { _certShowError(errEl, 'Issue date is required.');       return false; }
  if (!expiry)  { _certShowError(errEl, 'Expiry date is required.');      return false; }
  if (expiry <= issue) { _certShowError(errEl, 'Expiry date must be after the issue date.'); return false; }
  if (requireFile && !file) { _certShowError(errEl, 'Please choose a file to upload.'); return false; }
  if (file) {
    if (file.size > _CERT_MAX_BYTES) { _certShowError(errEl, 'File is larger than 10 MB. Please choose a smaller file.'); return false; }
    if (_CERT_ALLOWED.indexOf(file.type) === -1) {
      _certShowError(errEl, 'Unsupported file type. Allowed: PDF, PNG, JPEG.'); return false;
    }
  }
  return true;
}

async function uploadCertificate() {
  if (!await requireAuth()) return;
  var nameEl   = document.getElementById('cert-up-name');
  var issueEl  = document.getElementById('cert-up-issue');
  var expiryEl = document.getElementById('cert-up-expiry');
  var fileEl   = document.getElementById('cert-up-file');
  var btn      = document.getElementById('cert-up-btn');

  var name   = (nameEl.value||'').trim();
  var issue  = issueEl.value;
  var expiry = expiryEl.value;
  var file   = fileEl.files && fileEl.files[0];
  if (!_certValidate(name, issue, expiry, file, true, 'cert-up-error')) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Uploading…';

  // 1. Upload to storage. Path = slug/timestamp_filename.
  var slug = _certSlug(currentUser);
  var ts = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  var path = slug + '/' + ts + '_' + safeName;
  var up = await sb.storage.from('certificates').upload(path, file, { contentType: file.type, upsert: false });

  if (up.error) {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="upload" class="btn-icon"></i>Upload Certificate';
    if (typeof renderIcons === 'function') renderIcons();
    _certShowError('cert-up-error', 'Upload failed: ' + up.error.message);
    return;
  }

  // 2. Insert DB row referencing the storage path.
  var ins = await sb.from('certificates').insert({
    employee:    currentUser,
    name:        name,
    issue_date:  issue,
    expiry_date: expiry,
    file_url:    path,
    file_name:   file.name
  });
  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="upload" class="btn-icon"></i>Upload Certificate';
  if (typeof renderIcons === 'function') renderIcons();

  if (ins.error) {
    // Try to clean up the uploaded file so we don't orphan it.
    sb.storage.from('certificates').remove([path]).catch(function(){});
    _certShowError('cert-up-error', 'Saving failed: ' + ins.error.message);
    return;
  }

  closeCertUploadModal();
  showToast('Certificate uploaded ✓');
  await loadCertificates();
}

// ── edit modal ─────────────────────────────────────────────────────

function openCertEditModal(id) {
  var c = _certData.find(function(x){return x.id===id;});
  if (!c) return;
  // Employees can only edit their own certs. Managers can open any
  // cert — they may need to toggle the Gulfit-relevant flag on
  // someone else's certification. RLS gates the actual write.
  if (c.employee !== currentUser && !isManager) {
    showError('You can only edit your own certificates.');
    return;
  }
  document.getElementById('cert-edit-id').value     = String(id);
  document.getElementById('cert-edit-name').value   = c.name || '';
  document.getElementById('cert-edit-issue').value  = c.issue_date || '';
  document.getElementById('cert-edit-expiry').value = c.expiry_date || '';
  document.getElementById('cert-edit-current-file').textContent = c.file_name || '(no filename stored)';
  document.getElementById('cert-edit-file').value   = '';
  document.getElementById('cert-edit-error').style.display = 'none';
  // Seed the Gulfit-relevant checkbox (manager-only row, hidden for
  // employees via auth.js' .manager-only-el toggle).
  var gulfitCb = document.getElementById('cert-edit-gulfit');
  if (gulfitCb) gulfitCb.checked = !!c.is_gulfit_relevant;
  document.getElementById('cert-edit-modal').classList.add('show');
  if (typeof renderIcons === 'function') renderIcons();
}

function closeCertEditModal() {
  document.getElementById('cert-edit-modal').classList.remove('show');
}

async function saveCertEdit() {
  if (!await requireAuth()) return;
  var id = parseInt(document.getElementById('cert-edit-id').value, 10);
  if (!id) return;
  var existing = _certData.find(function(x){return x.id===id;});
  if (!existing) return;

  var name   = (document.getElementById('cert-edit-name').value||'').trim();
  var issue  = document.getElementById('cert-edit-issue').value;
  var expiry = document.getElementById('cert-edit-expiry').value;
  var fileEl = document.getElementById('cert-edit-file');
  var newFile = fileEl.files && fileEl.files[0];

  if (!_certValidate(name, issue, expiry, newFile, false, 'cert-edit-error')) return;

  var btn = document.getElementById('cert-edit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Saving…';

  var patch = { name: name, issue_date: issue, expiry_date: expiry };
  // Only managers can flip the Gulfit-relevant flag. Employees never
  // see the checkbox; if they somehow set it (devtools), RLS rejects
  // the column write because the row isn't theirs to fully manage —
  // but defense in depth, we only include the field when isManager.
  if (isManager) {
    var gulfitCb = document.getElementById('cert-edit-gulfit');
    if (gulfitCb) patch.is_gulfit_relevant = !!gulfitCb.checked;
  }
  var oldPath = existing.file_url;
  var newPath = null;

  if (newFile) {
    // Upload replacement file under a fresh timestamped path, then update
    // the row, then delete the old object. If anything fails we keep the
    // original file intact.
    var slug = _certSlug(currentUser);
    var ts = Date.now();
    var safeName = newFile.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    newPath = slug + '/' + ts + '_' + safeName;
    var up = await sb.storage.from('certificates').upload(newPath, newFile, { contentType: newFile.type, upsert: false });
    if (up.error) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';
      if (typeof renderIcons === 'function') renderIcons();
      _certShowError('cert-edit-error', 'Upload failed: ' + up.error.message);
      return;
    }
    patch.file_url  = newPath;
    patch.file_name = newFile.name;
  }

  var { error } = await sb.from('certificates').update(patch).eq('id', id);
  if (error) {
    // Roll back the just-uploaded file so we don't orphan it
    if (newPath) sb.storage.from('certificates').remove([newPath]).catch(function(){});
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';
    if (typeof renderIcons === 'function') renderIcons();
    _certShowError('cert-edit-error', 'Saving failed: ' + error.message);
    return;
  }

  // DB updated — now best-effort delete the old file
  if (newPath && oldPath && oldPath !== newPath) {
    sb.storage.from('certificates').remove([oldPath]).catch(function(){});
  }

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="save" class="btn-icon"></i>Save Changes';
  if (typeof renderIcons === 'function') renderIcons();
  closeCertEditModal();
  showToast('Certificate updated ✓');
  await loadCertificates();
}

// ── preview ────────────────────────────────────────────────────────
// Opens the cert file in a new browser tab using a short-lived signed URL.
// Omitting the {download:...} option means the browser renders inline —
// PDFs in the native viewer, images as <img>. The download button below
// keeps the explicit force-download path for users who prefer that.

async function previewCertificate(id) {
  var c = _certData.find(function(x){return x.id===id;});
  if (!c) return;
  var res = await sb.storage.from('certificates').createSignedUrl(c.file_url, 60);
  if (res.error || !res.data || !res.data.signedUrl) {
    showError('Could not preview: ' + ((res.error && res.error.message) || 'no URL returned'));
    return;
  }
  window.open(res.data.signedUrl, '_blank', 'noopener');
}

// ── download ───────────────────────────────────────────────────────

async function downloadCertificate(id) {
  var c = _certData.find(function(x){return x.id===id;});
  if (!c) return;
  // Generate a 60-second signed URL. The third arg downloads with the
  // original filename rather than the storage path.
  var res = await sb.storage.from('certificates').createSignedUrl(c.file_url, 60, { download: c.file_name || true });
  if (res.error || !res.data || !res.data.signedUrl) {
    showError('Could not download: ' + ((res.error && res.error.message) || 'no URL returned'));
    return;
  }
  // Trigger download
  var a = document.createElement('a');
  a.href = res.data.signedUrl;
  if (c.file_name) a.download = c.file_name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── delete ─────────────────────────────────────────────────────────

async function confirmDeleteCertificate(id) {
  if (!await requireAuth()) return;
  var c = _certData.find(function(x){return x.id===id;});
  if (!c) return;
  if (c.employee !== currentUser && !isManager) {
    showError('You can only delete your own certificates.');
    return;
  }
  if (!await confirmAction({
    title: 'Delete certificate "'+c.name+'"?',
    body: 'This will permanently remove the file.\n\nThis cannot be undone.',
    confirmText: 'Delete certificate'
  })) return;
  deleteCertificate(id);
}

async function deleteCertificate(id) {
  var c = _certData.find(function(x){return x.id===id;});
  if (!c) return;
  // Delete DB row first (then file). If we deleted file first and the DB
  // delete failed, we'd be left with a dangling row pointing at nothing.
  var { error } = await sb.from('certificates').delete().eq('id', id);
  if (error) { showError('Could not delete: '+error.message); return; }
  if (c.file_url) {
    sb.storage.from('certificates').remove([c.file_url]).catch(function(err){
      console.warn('Storage delete failed (row already gone):', err);
    });
  }
  showToast('Certificate deleted ✓');
  await loadCertificates();
}
