// == RELEASE HISTORY (v202) =================================================
// Manager-only list of every update pushed to the portal, newest first, built
// from data/whats-new.json (the same file that feeds the "What's new" pill).
// Read-only; nothing is stored. Items without a "version" are dashboard tips,
// not releases, so they are left out.
var _rlItems = null;       // versioned items, loaded once per visit
var _rlLoading = false;

function _rlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _rlVerNum(v) { var m = String(v||'').match(/(\d+)/); return m ? parseInt(m[1],10) : 0; }

// Release time in UAE time (the team's office clock), e.g. "12-Nov-2026, 14:05 GST".
function _rlWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    var g = {}; parts.forEach(function(p){ g[p.type] = p.value; });
    return g.day + '-' + g.month + '-' + g.year + ', ' + g.hour + ':' + g.minute + ' GST';
  } catch (e) { return ''; }
}

async function loadReleases() {
  var box = document.getElementById('rl-content');
  if (!box) return;
  if (!isManager) { box.innerHTML = '<div class="card"><div class="empty-state">Release history is for managers.</div></div>'; return; }
  if (_rlLoading) return;
  _rlLoading = true;
  box.innerHTML = '<div class="card"><div class="empty-state">Loading\u2026</div></div>';
  try {
    var resp = await fetch('data/whats-new.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var all = await resp.json();
    var pool = (all && Array.isArray(all.items)) ? all.items : [];
    _rlItems = pool.filter(function(it){ return it && it.version; });
    renderReleases();
  } catch (e) {
    _rlItems = null;
    box.innerHTML = '<div class="card"><div class="empty-state">Could not load the release history. Check your connection and try again.<br><button class="btn btn-sm btn-ghost" style="margin-top:10px" onclick="loadReleases()">Retry</button></div></div>';
  } finally { _rlLoading = false; }
}

function renderReleases() {
  var box = document.getElementById('rl-content');
  if (!box || !_rlItems) return;
  var qEl = document.getElementById('rl-search');
  var cEl = document.getElementById('rl-cat');
  var q = qEl ? qEl.value.trim().toLowerCase() : '';
  var cat = cEl ? cEl.value : '';
  var running = _rlVerNum(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');

  var shown = _rlItems.filter(function(it){
    if (cat && it.category !== cat) return false;
    if (!q) return true;
    return (String(it.version) + ' ' + (it.title||'') + ' ' + (it.body||'')).toLowerCase().indexOf(q) !== -1;
  });

  // Group by version, newest first.
  var groups = {}, order = [];
  shown.forEach(function(it){
    var n = _rlVerNum(it.version);
    if (!groups[n]) { groups[n] = []; order.push(n); }
    groups[n].push(it);
  });
  order.sort(function(a,b){ return b - a; });

  var totalVersions = {};
  _rlItems.forEach(function(it){ totalVersions[_rlVerNum(it.version)] = 1; });
  var countEl = document.getElementById('rl-count');
  if (countEl) countEl.textContent = order.length + ' of ' + Object.keys(totalVersions).length + ' versions';

  if (!order.length) {
    box.innerHTML = '<div class="card"><div class="empty-state">No updates match.</div></div>';
    return;
  }

  box.innerHTML = order.map(function(n){
    var items = groups[n];
    // released_at: the earliest stamp among the version's items.
    var stamps = items.map(function(i){ return i.released_at; }).filter(Boolean).sort();
    var when = _rlWhen(stamps[0]);
    var label = items[0].version;
    var badge = n === running ? '<span class="rl-now">Running now</span>'
              : n > running  ? '<span class="rl-new">Newer than this device</span>' : '';
    return '<div class="card rl-ver">' +
      '<div class="rl-ver-head"><span class="rl-ver-no">' + _rlEsc(label) + '</span>' + badge +
      (when ? '<span class="rl-ver-when">' + _rlEsc(when) + '</span>' : '') + '</div>' +
      items.map(function(it){
        return '<div class="rl-item"><span class="rl-cat rl-cat-' + _rlEsc(it.category || 'app') + '">' + _rlEsc(_rlCatLabel(it.category)) + '</span>' +
          '<div class="rl-item-main"><div class="rl-item-title">' + _rlEsc(it.title || '') + '</div>' +
          (it.body ? '<div class="rl-item-body">' + _rlEsc(it.body) + '</div>' : '') + '</div></div>';
      }).join('') +
    '</div>';
  }).join('');
}

function _rlCatLabel(c) {
  return c === 'new' ? 'New' : c === 'fixed' ? 'Fixed' : c === 'tip' ? 'Tip' : 'Update';
}
