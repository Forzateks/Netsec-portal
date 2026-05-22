// == TEAM PORTFOLIO MODULE (v83 → v91) ===============================
// Public-facing showcase + internal portfolio mapping + RFP Process
// Playbook. Single screen (screen-team), three tabs.
//
// v91: team members are now stored in the team_members Supabase table,
// not data/team.json. Schema: id / full_name / role / section / email /
// phone / country / photo_url / sort_order / is_active. Manager-only
// write via RLS; data/team.json is kept as an offline fallback only.
//
// Products + RFP stages still live in data/team.json — they didn't move
// to DB this ship.
//
// Public route: /#team. Reachable without authentication. The unauth view
// shows only Meet the Team, with phone numbers stripped and product names
// replaced by their publicCategory label (generic, no specific vendor
// names leak to competitors).
//
// Internal route: same /#team after login. Full data. Three tabs visible.
//
// Routing convention: hash-based (#/team[?tab=meet|portfolio|rfp]) so the
// page is shareable as a static link without server config. Init.js wires
// the hash listener; this module exposes navigateToTeamRoute() for the
// sidebar to call and renderTeamScreen() for the router to call.

var TEAM_DATA          = null;     // cached normalised payload {team, products, rfpStages}
var TEAM_PUBLIC_MODE   = false;    // true when unauthenticated visitor
var TEAM_CURRENT_TAB   = 'meet';   // 'meet' | 'portfolio' | 'rfp'
var TEAM_SELECTED_STAGE_ID = null; // currently focused RFP stage (for detail panel)

// Section keys mirror the DB CHECK constraint. UI labels and accent
// colours are looked up by key — the DB stays normalised, the display
// strings live here.
var TEAM_CATEGORY_ORDER  = ['sales', 'presales', 'post_sales_technical'];
var TEAM_CATEGORY_LABELS = {
  'sales':                'Sales',
  'presales':             'Presales',
  'post_sales_technical': 'Post Sales (Technical)'
};
var TEAM_CATEGORY_COLORS = {
  'sales':                'var(--navy)',
  'presales':             'var(--teal)',
  'post_sales_technical': '#C8A832'
};
// Legacy → new section mapping used when falling back to the old JSON
// shape if Supabase is unreachable. Lets us tolerate a partially-stale
// fallback file without breaking the page.
var TEAM_LEGACY_CATEGORY_MAP = {
  'BDM':       'sales',
  'Presales':  'presales',
  'Technical': 'post_sales_technical'
};

// Deterministic slug from full_name. Lowercase, non-alphanumeric → "-".
// Used as the JS-side member id so products.owners and rfpStages.ownerIds
// (still string-keyed in data/team.json) match the DB-sourced members.
// Note: "Mohammed Adil Shaikh" → "mohammed-adil-shaikh" (the v83 JSON
// used "adil-shaikh"; the JSON file is updated in v91 to match the new
// rule so cross-refs stay intact).
function _teamSlug(fullName) {
  if (!fullName) return '';
  return String(fullName).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Map a DB team_members row into the shape the render code expects.
// Keeps the field names the v83 render functions already use (name,
// category, location, photo) so we don't have to touch every renderer.
function _teamMemberFromDb(row) {
  return {
    _dbId:    row.id,                            // numeric DB id (for inline-edit save)
    id:       _teamSlug(row.full_name),          // string slug for cross-refs
    name:     row.full_name,
    role:     row.role || '',
    category: row.section,                       // already in the new vocabulary
    email:    row.email || '',
    phone:    row.phone || '',
    location: row.country,
    photo:    row.photo_url || '',
    publicVisible: true,                          // is_active filter handled in query
    displayOrder:  row.sort_order
  };
}

// Map a legacy JSON team row to the same shape (fallback only). Old
// shape used `category` in {'BDM','Presales','Technical'} which we
// translate via TEAM_LEGACY_CATEGORY_MAP.
function _teamMemberFromLegacyJson(m) {
  var cat = m.category;
  if (TEAM_LEGACY_CATEGORY_MAP[cat]) cat = TEAM_LEGACY_CATEGORY_MAP[cat];
  return {
    _dbId:    null,                              // not editable in fallback mode
    id:       m.id || _teamSlug(m.name || ''),
    name:     m.name,
    role:     m.role || '',
    category: cat,
    email:    m.email || '',
    phone:    m.phone || '',
    location: m.location,
    photo:    m.photo || '',
    publicVisible: m.publicVisible !== false,
    displayOrder:  m.displayOrder
  };
}

// == DATA LOAD ===================================================
// v91: team members come from Supabase (team_members table). Products +
// RFP stages still come from data/team.json — they didn't move to DB
// this ship. If the DB read fails, fall back to JSON for the entire
// payload so the public route still renders something useful.
//
// One-shot cache per page load; renderTeamScreen() can call repeatedly
// without re-fetching. After a manager-side edit we invalidate by
// nulling TEAM_DATA before the next render.
async function loadTeamData() {
  if (TEAM_DATA) return TEAM_DATA;

  // Always pull the JSON for products + rfpStages. Cheap (static file
  // under the SW data/* bypass added in v85). If even this fails, we
  // synthesise an empty shape so renders don't crash.
  var jsonPayload = { team: [], products: [], rfpStages: [] };
  try {
    var res = await fetch('data/team.json', { cache: 'no-cache' });
    if (res.ok) jsonPayload = await res.json();
  } catch (e) {
    console.warn('team.json fetch failed:', e);
  }

  // Try the DB. RLS allows authenticated read AND, since the public
  // route hits the page anonymously, anon reads will be blocked — that
  // case is what the JSON fallback covers.
  var dbTeam = null;
  try {
    var dbRes = await sb.from('team_members')
      .select('*')
      .eq('is_active', true)
      .order('section')
      .order('sort_order');
    if (!dbRes.error && Array.isArray(dbRes.data) && dbRes.data.length) {
      dbTeam = dbRes.data.map(_teamMemberFromDb);
    }
  } catch (e) {
    console.warn('team_members DB load failed; using JSON fallback:', e);
  }

  // Choose source for team[] only. Products + rfpStages always JSON.
  var team = dbTeam || (jsonPayload.team || []).map(_teamMemberFromLegacyJson);

  TEAM_DATA = {
    team:      team,
    products:  jsonPayload.products  || [],
    rfpStages: jsonPayload.rfpStages || [],
    _source:   dbTeam ? 'db' : 'json'   // surfaced in DOM only for debugging
  };
  return TEAM_DATA;
}

// Public-view scrub: blank phone numbers, swap product names for their
// publicCategory label. Operates on a deep clone so the internal cache
// stays intact for any later in-session re-render. publicVisible is
// always true for DB-sourced rows (is_active filter at query), so we
// don't filter on it here — that flag is a v83 JSON-era concept.
function scrubForPublic(data) {
  var team = (data.team || []).map(function(m){
    var c = Object.assign({}, m);
    c.phone = '';
    return c;
  });
  var products = (data.products || []).map(function(p){
    var c = Object.assign({}, p);
    // Public visitors see the generic category label, never the vendor name
    c.name = p.publicCategory || p.category || p.name;
    c.publicCategory = c.name;
    return c;
  });
  return { team: team, products: products, rfpStages: [] };
}

function getActiveTeamData() {
  if (!TEAM_DATA) return { team: [], products: [], rfpStages: [] };
  return TEAM_PUBLIC_MODE ? scrubForPublic(TEAM_DATA) : TEAM_DATA;
}

// == HELPERS =====================================================
// Initials placeholder: "Mohammed Adil Shaikh" → "MS", "Venkatesan" → "V".
// Used when a photo file is missing or 404s. Render in a teal circle with
// white text so it visually matches the photo footprint exactly.
function teamInitials(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function teamPhotoHtml(member, size) {
  size = size || 120;
  // Layered fallback: the initials circle renders as the base layer
  // (always present); the <img> sits absolutely on top of it. When the
  // photo file exists, the img covers the initials. When the file 404s,
  // onerror hides the img and reveals the initials underneath. No HTML
  // string-injection / quote-escaping needed — that's what produced the
  // v83 "full name leaks into the circle" bug.
  var initials = esc2(teamInitials(member.name));
  var fontPx = Math.round(size * 0.38);
  var wrap = '<div class="team-photo-wrap" style="width:'+size+'px;height:'+size+'px">'+
    '<div class="team-initials" style="font-size:'+fontPx+'px">'+initials+'</div>';
  if (member.photo) {
    wrap += '<img src="'+esc2(member.photo)+'" alt="" class="team-photo" onerror="this.style.display=\'none\'">';
  }
  wrap += '</div>';
  return wrap;
}

function teamGroupByCategory(members) {
  var byCat = { 'sales': [], 'presales': [], 'post_sales_technical': [] };
  members.forEach(function(m){
    var cat = m.category || 'post_sales_technical';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(m);
  });
  // Stable sort by displayOrder, then name. displayOrder is optional —
  // members without it fall to the end of their category.
  Object.keys(byCat).forEach(function(k){
    byCat[k].sort(function(a,b){
      var ao = (a.displayOrder == null) ? 9999 : a.displayOrder;
      var bo = (b.displayOrder == null) ? 9999 : b.displayOrder;
      if (ao !== bo) return ao - bo;
      return (a.name||'').localeCompare(b.name||'');
    });
  });
  return byCat;
}

function teamFindById(id) {
  if (!TEAM_DATA) return null;
  return (TEAM_DATA.team || []).find(function(m){ return m.id === id; }) || null;
}

// == ROUTING =====================================================
// Hash-based routing: #/team[?tab=meet|portfolio|rfp]. Other prefixes are
// ignored; init.js calls renderTeamScreen() when it sees #/team. The
// sidebar entry uses navigateToTeamRoute() which updates the hash and
// triggers re-render via the hashchange listener.
function parseTeamHash() {
  var h = window.location.hash || '';
  if (!h.startsWith('#/team')) return null;
  var tab = 'meet';
  var qIdx = h.indexOf('?');
  if (qIdx !== -1) {
    var qs = h.slice(qIdx + 1);
    qs.split('&').forEach(function(pair){
      var kv = pair.split('=');
      if (kv[0] === 'tab' && kv[1]) tab = decodeURIComponent(kv[1]);
    });
  }
  if (['meet','portfolio','rfp'].indexOf(tab) === -1) tab = 'meet';
  return { tab: tab };
}

function navigateToTeamRoute(tab) {
  var newHash = '#/team' + (tab && tab !== 'meet' ? '?tab=' + tab : '');
  if (window.location.hash === newHash) {
    // Same hash — hashchange won't fire, render manually.
    renderTeamScreen();
  } else {
    window.location.hash = newHash;
    // hashchange listener picks it up
  }
}

// Called from init.js on initial load if hash matches #/team, AND from
// the hashchange listener whenever the hash changes within the team
// subpath. Also called when the sidebar item is clicked.
async function renderTeamScreen() {
  var parsed = parseTeamHash();
  if (!parsed) return;
  // Public visitors trying to deep-link to internal-only tabs silently
  // get redirected to Meet the Team. Avoids "permission denied" friction;
  // they probably typed the URL or got a forwarded link.
  if (TEAM_PUBLIC_MODE && parsed.tab !== 'meet') {
    parsed.tab = 'meet';
    window.history.replaceState(null, '', '#/team');
  }
  TEAM_CURRENT_TAB = parsed.tab;

  // Make sure the team screen is the active one. In public mode init.js
  // already arranged the layout (login screen hidden, app shell hidden,
  // team screen shown). In internal mode we go through the normal
  // showScreen() path so the sidebar item highlights correctly.
  if (!TEAM_PUBLIC_MODE && typeof showScreen === 'function') {
    showScreen('team');
  }

  var host = document.getElementById('team-content');
  if (!host) return;
  host.innerHTML = '<div class="loading" style="padding:40px 0"><div class="spinner"></div>Loading…</div>';
  await loadTeamData();
  host.innerHTML = renderTeamLayout();
  // Wire tab clicks (delegation — handler reads data-tab off the button)
  Array.prototype.forEach.call(host.querySelectorAll('.team-tab-btn'), function(btn){
    btn.addEventListener('click', function(){
      navigateToTeamRoute(btn.getAttribute('data-tab'));
    });
  });
  if (typeof renderIcons === 'function') renderIcons();
}

// == LAYOUT (header + tabs + active tab body) ====================
function renderTeamLayout() {
  var tab = TEAM_CURRENT_TAB;
  var publicLink = TEAM_PUBLIC_MODE
    ? '<a href="#" onclick="event.preventDefault();handleTeamPublicSignIn()" class="team-signin-link">Sign in to see portfolio mapping &amp; RFP process →</a>'
    : '';
  var tabs = '<div class="team-tabs">'+
    '<button class="team-tab-btn '+(tab==='meet'?'active':'')+'" data-tab="meet">Meet the Team</button>'+
    (!TEAM_PUBLIC_MODE ? '<button class="team-tab-btn '+(tab==='portfolio'?'active':'')+'" data-tab="portfolio">Portfolio Mapping</button>' : '')+
    (!TEAM_PUBLIC_MODE ? '<button class="team-tab-btn '+(tab==='rfp'?'active':'')+'" data-tab="rfp">RFP Process</button>' : '')+
  '</div>';

  var body = '';
  if (tab === 'meet')      body = renderMeetTheTeamTab();
  else if (tab === 'portfolio') body = renderPortfolioTab();
  else if (tab === 'rfp')  body = renderRfpTab();

  return '<div class="team-page">'+
    '<div class="team-page-head">'+
      '<div>'+
        '<div class="team-page-title">Gulfit Networking Team</div>'+
        '<div class="team-page-sub">'+(TEAM_PUBLIC_MODE
          ? 'Meet the people behind your network'
          : 'Internal portfolio &amp; RFP playbook')+'</div>'+
      '</div>'+
      publicLink+
    '</div>'+
    tabs+
    '<div class="team-tab-body">'+body+'</div>'+
  '</div>';
}

// Public visitor's "Sign in to see more" link. Just routes back to the
// login screen and clears the team-only public mode flag — the existing
// auth flow handles the rest. After successful login the hashchange
// fires and renderTeamScreen() picks them up in internal mode.
function handleTeamPublicSignIn() {
  TEAM_PUBLIC_MODE = false;
  window.location.hash = '';
  window.location.reload();
}

// == TAB 1: MEET THE TEAM ========================================
function renderMeetTheTeamTab() {
  var data = getActiveTeamData();
  // Static Regional BUs info box. Same content for public + internal —
  // it's marketing-grade information about Gulfit's coverage. Not
  // editable; if the regional list changes that's a one-line code edit.
  var regionalBox =
    '<div class="team-regional-bu">'+
      '<i data-lucide="globe" class="team-regional-bu-ico"></i>'+
      '<div>'+
        '<div class="team-regional-bu-title">Regional BUs</div>'+
        '<div class="team-regional-bu-sub">KSA, Qatar, Kuwait, Oman, Bahrain</div>'+
      '</div>'+
    '</div>';

  if (!data.team.length) {
    return regionalBox + '<div class="team-empty">No team members to show yet.</div>';
  }
  var byCat = teamGroupByCategory(data.team);
  var sections = TEAM_CATEGORY_ORDER.map(function(cat){
    var members = byCat[cat] || [];
    // Even with zero members in a section, render the section header +
    // Add Member button so a manager can seed the first row. Public
    // mode hides empty sections entirely.
    if (!members.length && (TEAM_PUBLIC_MODE || typeof isManager === 'undefined' || !isManager)) return '';
    return renderCategorySection(cat, members.map(renderMemberCard).join(''));
  }).join('');
  return regionalBox + sections;
}

function renderCategorySection(category, innerHtml) {
  var color = TEAM_CATEGORY_COLORS[category] || 'var(--navy)';
  var label = TEAM_CATEGORY_LABELS[category] || category;
  // Add Member button: manager-only, hidden on public route. Pre-selects
  // the clicked section in the modal so the manager doesn't have to.
  var addBtn = (!TEAM_PUBLIC_MODE && typeof isManager !== 'undefined' && isManager)
    ? '<button class="team-add-member-btn" onclick="openAddTeamMemberModal(\''+esc2(category)+'\')" title="Add a member to '+esc2(label)+'">'+
        '<i data-lucide="plus" class="team-add-member-ico"></i>Add Member'+
      '</button>'
    : '';
  return '<section class="team-cat-section">'+
    '<div class="team-cat-head">'+
      '<div class="team-cat-bar" style="background:'+color+'"></div>'+
      '<h2 class="team-cat-title">'+esc2(label)+'</h2>'+
      addBtn+
    '</div>'+
    '<div class="team-card-grid">'+innerHtml+'</div>'+
  '</section>';
}

function renderMemberCard(m) {
  // v91: inline edit affordance for managers — pencil button shown on
  // hover next to name + phone. Non-manager / public render plain text.
  // DB-backed members carry _dbId; JSON-fallback rows don't, so editing
  // is silently disabled there too (best-effort offline degradation).
  var canEdit = !TEAM_PUBLIC_MODE && typeof isManager !== 'undefined' && isManager && m._dbId;

  // Name: editable span + (manager-only) pencil. Wrap in a positioning
  // container so the pencil can absolute-position to the right.
  var nameEdit = canEdit
    ? '<button class="team-card-edit-pencil" title="Edit name" onclick="startTeamMemberEdit('+m._dbId+',\'full_name\', this)" data-current="'+esc2(m.name)+'"><i data-lucide="pencil"></i></button>'
    : '';
  var nameHtml =
    '<div class="team-card-name-wrap">'+
      '<span class="team-card-name" data-member-id="'+m._dbId+'" data-field="full_name">'+esc2(m.name)+'</span>'+
      nameEdit+
    '</div>';

  // Bottom row: email left, location badge right. Email truncates with
  // ellipsis if too long; location stays at fixed pill size on the right.
  var emailHtml = m.email
    ? '<div class="team-contact-row" title="'+esc2(m.email)+'">'+
        '<i data-lucide="mail" class="team-contact-ico"></i>'+
        '<a href="mailto:'+esc2(m.email)+'">'+esc2(m.email)+'</a>'+
      '</div>'
    : '<div></div>'; // placeholder so location stays right-aligned
  var locBadge = m.location
    ? '<span class="team-loc-badge team-loc-'+esc2(m.location.toLowerCase())+'">'+esc2(m.location)+'</span>'
    : '';

  // Phone is internal-only (public scrub blanks it). Editable for managers.
  // Empty phone + manager → small "+ Add phone" link. Empty + non-manager →
  // hidden entirely (no clutter when nothing to show).
  var phoneHtml = '';
  if (!TEAM_PUBLIC_MODE) {
    if (m.phone) {
      var phoneEdit = canEdit
        ? '<button class="team-card-edit-pencil team-card-edit-pencil-inline" title="Edit phone" onclick="startTeamMemberEdit('+m._dbId+',\'phone\', this)" data-current="'+esc2(m.phone)+'"><i data-lucide="pencil"></i></button>'
        : '';
      phoneHtml =
        '<div class="team-card-phone">'+
          '<i data-lucide="phone" class="team-contact-ico"></i>'+
          '<a href="tel:'+esc2(m.phone.replace(/\s+/g,''))+'">'+esc2(m.phone)+'</a>'+
          phoneEdit+
        '</div>';
    } else if (canEdit) {
      phoneHtml =
        '<div class="team-card-phone team-card-phone-empty">'+
          '<button class="team-card-add-phone" onclick="startTeamMemberEdit('+m._dbId+',\'phone\', this)" data-current="">'+
            '<i data-lucide="plus" class="team-contact-ico"></i>Add phone'+
          '</button>'+
        '</div>';
    }
  }

  return '<article class="team-card" data-member-id="'+m._dbId+'">'+
    '<div class="team-card-photo">'+teamPhotoHtml(m, 120)+'</div>'+
    nameHtml+
    '<div class="team-card-role">'+esc2(m.role || '')+'</div>'+
    '<div class="team-card-bottom">'+emailHtml+locBadge+'</div>'+
    phoneHtml+
  '</article>';
}

// == INLINE EDIT (manager-only) ===================================
// startTeamMemberEdit: pencil onclick handler. Locates the display
// element matching (memberId, field), replaces it with a text input
// that saves on Enter or blur. Esc cancels. The smoke-test pattern
// from v90 (update().select() + value match) catches the v74-class
// silent RLS-fail where a denied write returns 204 + empty body.
async function startTeamMemberEdit(dbId, field, pencilBtn) {
  if (!await requireAuth()) return;
  if (typeof isManager === 'undefined' || !isManager) {
    showError('Manager access only.'); return;
  }
  var current = pencilBtn.getAttribute('data-current') || '';

  // Find the corresponding display element for this field.
  // - full_name → .team-card-name with matching data-member-id
  // - phone → the <a> inside .team-card-phone OR the "+ Add phone" button container
  var card = pencilBtn.closest('.team-card');
  if (!card) return;

  var displayEl, parent;
  if (field === 'full_name') {
    displayEl = card.querySelector('.team-card-name[data-member-id="'+dbId+'"]');
    parent = displayEl ? displayEl.parentNode : null;
  } else if (field === 'phone') {
    var phoneRow = card.querySelector('.team-card-phone');
    if (!phoneRow) return;
    displayEl = phoneRow;
    parent = phoneRow.parentNode;
  }
  if (!displayEl || !parent) return;

  // Hide the pencil while editing — clicking it again mid-edit would be
  // confusing. Restored on finish.
  pencilBtn.style.visibility = 'hidden';

  // Create the input. Stamp memberId + field on it so the blur handler
  // can pick them up without closure capture.
  var input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'team-card-edit-input';
  input.setAttribute('data-member-id', String(dbId));
  input.setAttribute('data-field', field);
  input.setAttribute('data-pencil', '1');
  input.maxLength = field === 'full_name' ? 80 : 32;
  input.placeholder = field === 'phone' ? '+971 50 123 4567' : 'Full name';

  // Stash the original element so we can restore it on cancel.
  input._origDisplay = displayEl;
  input._origPencil  = pencilBtn;

  // Replace the display element with the input. innerHTML approach
  // would lose the pencil/handlers; swap nodes instead.
  if (field === 'full_name') {
    parent.replaceChild(input, displayEl);
  } else {
    // For phone, replace the whole phone row (which contains the link +
    // optional pencil) with the input.
    parent.replaceChild(input, displayEl);
  }
  input.focus();
  input.select();

  // Save on blur or Enter; cancel on Escape.
  input.addEventListener('keydown', function(ev){
    if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input._cancel = true; input.blur(); }
  });
  input.addEventListener('blur', function(){
    finishTeamMemberEdit(input, current);
  });
}

async function finishTeamMemberEdit(input, originalValue) {
  var dbId = parseInt(input.getAttribute('data-member-id'), 10);
  var field = input.getAttribute('data-field');
  var newValue = (input.value || '').trim();
  var cancelled = input._cancel || newValue === originalValue;

  // Cancel path or no-op: just revert the DOM without a save round-trip.
  if (cancelled) {
    var p = input.parentNode;
    if (p && input._origDisplay) p.replaceChild(input._origDisplay, input);
    if (input._origPencil) input._origPencil.style.visibility = '';
    return;
  }

  // Empty-string for phone is a clear ("set NULL"); for full_name it's a
  // validation failure. Don't allow blank names.
  if (field === 'full_name' && !newValue) {
    showError('Name can\'t be empty.');
    var p2 = input.parentNode;
    if (p2 && input._origDisplay) p2.replaceChild(input._origDisplay, input);
    if (input._origPencil) input._origPencil.style.visibility = '';
    return;
  }
  var payloadValue = (field === 'phone' && !newValue) ? null : newValue;

  var ok = await _teamUpdateMemberField(dbId, field, payloadValue);
  if (!ok) {
    // Save failed (RLS, network, smoke-test mismatch). Revert.
    var p3 = input.parentNode;
    if (p3 && input._origDisplay) p3.replaceChild(input._origDisplay, input);
    if (input._origPencil) input._origPencil.style.visibility = '';
    return;
  }

  // Saved. Invalidate the cache and re-render so the new value (and any
  // ordering changes) flow through cleanly. Cheaper than surgical DOM
  // patching and guarantees consistency.
  TEAM_DATA = null;
  renderTeamScreen();
  showToast('Saved ✓');
}

// Update a single column on a team_members row. .select().single() forces
// PostgREST to return the saved row; if the returned value doesn't match
// the intent, RLS silently dropped the write (v74 class) — return false
// so the caller reverts the UI.
async function _teamUpdateMemberField(dbId, field, value) {
  var update = {};
  update[field] = value;
  var res = await sb.from('team_members')
    .update(update)
    .eq('id', dbId)
    .select(field+',id')
    .single();
  if (res.error) {
    console.error('team_members update failed:', res.error);
    showError('Could not update: ' + res.error.message);
    return false;
  }
  if (!res.data || res.data[field] !== value) {
    showError('Update did not persist — check manager permissions.');
    return false;
  }
  return true;
}

// == ADD MEMBER MODAL (manager-only) =============================
// openAddTeamMemberModal(seedSection): seeds the section dropdown so the
// "+ Add Member" button under Presales pre-fills Presales. Required
// fields are full_name / role / section / country (matches the DB CHECK
// constraints + NOT NULL columns). sort_order auto-computed at save as
// MAX(existing in section) + 10.
function openAddTeamMemberModal(seedSection) {
  if (typeof isManager === 'undefined' || !isManager) {
    showError('Manager access only.'); return;
  }
  var modal = document.getElementById('add-team-member-modal');
  if (!modal) return;
  // Reset fields
  ['atm-name','atm-role','atm-email','atm-phone','atm-photo'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var sectionSel = document.getElementById('atm-section');
  if (sectionSel) sectionSel.value = seedSection || 'sales';
  var countrySel = document.getElementById('atm-country');
  if (countrySel) countrySel.value = 'UAE';
  var errEl = document.getElementById('atm-error');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  modal.classList.add('show');
  // Focus the first input for fast typing
  setTimeout(function(){ var n = document.getElementById('atm-name'); if (n) n.focus(); }, 50);
}

function closeAddTeamMemberModal() {
  var modal = document.getElementById('add-team-member-modal');
  if (modal) modal.classList.remove('show');
}

async function saveAddTeamMember() {
  if (!await requireAuth()) return;
  if (typeof isManager === 'undefined' || !isManager) {
    showError('Manager access only.'); return;
  }
  var errEl = document.getElementById('atm-error');
  function fail(msg) { errEl.textContent = '⚠️ ' + msg; errEl.style.display = 'block'; }
  errEl.style.display = 'none';

  var name    = (document.getElementById('atm-name').value || '').trim();
  var role    = (document.getElementById('atm-role').value || '').trim();
  var section = document.getElementById('atm-section').value;
  var email   = (document.getElementById('atm-email').value || '').trim();
  var phone   = (document.getElementById('atm-phone').value || '').trim();
  var country = document.getElementById('atm-country').value;
  var photo   = (document.getElementById('atm-photo').value || '').trim();

  // Validation matching the DB CHECK + NOT NULL constraints.
  if (!name)    return fail('Full name is required.');
  if (!role)    return fail('Role / designation is required.');
  if (!section) return fail('Section is required.');
  if (!country) return fail('Country is required.');
  if (email && email.indexOf('@') === -1) return fail('Email looks invalid.');

  // Compute the next sort_order for this section so the new row drops
  // below the existing ones. +10 step leaves room for manual reordering
  // via SQL later without renumbering every row.
  var maxRes = await sb.from('team_members')
    .select('sort_order')
    .eq('section', section)
    .eq('is_active', true)
    .order('sort_order', { ascending: false })
    .limit(1);
  var nextOrder = 10;
  if (!maxRes.error && maxRes.data && maxRes.data.length) {
    nextOrder = (parseInt(maxRes.data[0].sort_order, 10) || 0) + 10;
  }

  var row = {
    full_name: name,
    role:      role,
    section:   section,
    email:     email || null,
    phone:     phone || null,
    country:   country,
    photo_url: photo || null,
    sort_order: nextOrder,
    is_active: true
  };
  var ins = await sb.from('team_members').insert(row).select().single();
  if (ins.error || !ins.data) {
    return fail('Save failed: ' + (ins.error ? ins.error.message : 'unknown'));
  }

  closeAddTeamMemberModal();
  showToast('Added ' + name + ' to ' + (TEAM_CATEGORY_LABELS[section] || section) + ' ✓');
  TEAM_DATA = null;
  renderTeamScreen();
}

// == TAB 2: PORTFOLIO MAPPING (internal only) ====================
// Per-member cards listing the products they own. Source of truth is the
// products[] array; per-member ownership computed at render time so
// edits to products only need to touch one place in the JSON.
function renderPortfolioTab() {
  var data = getActiveTeamData();
  if (!data.team.length) return '<div class="team-empty">No team members loaded.</div>';
  var byCat = teamGroupByCategory(data.team);

  // Build owner→products[] index once.
  var memberProducts = {};
  (data.products || []).forEach(function(p){
    (p.owners || []).forEach(function(ownerId){
      if (!memberProducts[ownerId]) memberProducts[ownerId] = [];
      memberProducts[ownerId].push(p);
    });
  });

  return TEAM_CATEGORY_ORDER.map(function(cat){
    var members = byCat[cat] || [];
    if (!members.length) return '';
    var cards = members.map(function(m){
      return renderPortfolioCard(m, memberProducts[m.id] || []);
    }).join('');
    return renderCategorySection(cat, cards);
  }).join('');
}

function renderPortfolioCard(m, products) {
  var prodListHtml;
  if (!products.length) {
    prodListHtml = '<div class="team-portfolio-empty">— <span style="color:var(--muted);font-style:italic">Customer-facing role</span></div>';
  } else {
    prodListHtml = '<ul class="team-portfolio-list">'+
      products.map(function(p){
        return '<li><span class="team-portfolio-prod">'+esc2(p.name)+'</span>'+
          (p.category ? '<span class="team-portfolio-cat">'+esc2(p.category)+'</span>' : '')+
          '</li>';
      }).join('')+
    '</ul>';
  }
  var locBadge = m.location ? '<span class="team-loc-badge team-loc-'+esc2(m.location.toLowerCase())+'">'+esc2(m.location)+'</span>' : '';
  return '<article class="team-card team-portfolio-card">'+
    '<div class="team-portfolio-head">'+
      teamPhotoHtml(m, 64)+
      '<div class="team-portfolio-headtext">'+
        '<div class="team-card-name">'+esc2(m.name)+'</div>'+
        '<div class="team-card-role">'+esc2(m.role || '')+'</div>'+
        '<div class="team-card-meta">'+locBadge+'</div>'+
      '</div>'+
    '</div>'+
    '<div class="team-portfolio-handles">Handles:</div>'+
    prodListHtml+
  '</article>';
}

// == TAB 3: RFP PROCESS PLAYBOOK (internal only) =================
// Interactive flowchart: action stages (rectangles), decisions (diamonds),
// terminals (colored variants). Connecting arrows drawn via SVG overlay
// positioned by JS after the cards lay out. Clicking a stage opens a
// detail side panel with owner / artifacts / description / next steps.
//
// Mobile (≤640px): the flowchart converts to a vertical stepper — each
// stage becomes a full-width card; decision branches show as nested
// sub-cards. The same click-for-detail behavior applies.
function renderRfpTab() {
  var data = getActiveTeamData();
  var stages = data.rfpStages || [];
  if (!stages.length) {
    return '<div class="team-empty">No RFP stages defined.</div>';
  }
  // Default the detail panel to the first stage so the panel isn't empty
  // on first paint. User clicks anywhere else to change selection.
  if (!TEAM_SELECTED_STAGE_ID || !stages.find(function(s){ return s.id === TEAM_SELECTED_STAGE_ID; })) {
    TEAM_SELECTED_STAGE_ID = stages[0].id;
  }
  return '<div class="rfp-layout">'+
    '<div class="rfp-flow">'+ renderRfpFlow(stages) +'</div>'+
    '<aside class="rfp-detail" id="rfp-detail-panel">'+ renderRfpDetailPanel(stages) +'</aside>'+
  '</div>';
}

function renderRfpFlow(stages) {
  // Desktop layout = stacked rows. We let CSS flex handle horizontal
  // alignment within each row; decision branches go side-by-side under
  // their parent. The order in the JSON is the canonical sequence; we
  // render in that order with the decision's branches splitting the row.
  //
  // Mobile layout (CSS @media) flattens this to a single vertical column
  // and decision branches stack as labelled sub-cards.
  return '<div class="rfp-flow-inner">'+
    stages.map(function(s, i){ return renderRfpStageCard(s, i); }).join('')+
  '</div>';
}

function renderRfpStageCard(stage, idx) {
  var isSelected = (TEAM_SELECTED_STAGE_ID === stage.id);
  var typeCls = 'rfp-stage-' + stage.type;
  // Decision diamonds render label only — owner/artifacts are N/A.
  // Terminals get an extra "end" treatment via CSS.
  var ownerLine = '';
  if (stage.type !== 'decision' && stage.owner) {
    ownerLine = '<div class="rfp-stage-owner">'+esc2(stage.owner)+'</div>';
  }
  var branchLine = '';
  if (stage.type === 'decision' && stage.branches && stage.branches.length) {
    branchLine = '<div class="rfp-stage-branches">'+
      stage.branches.map(function(b){
        return '<span class="rfp-stage-branch">'+esc2(b.label)+'</span>';
      }).join('<span class="rfp-stage-branch-sep">·</span>')+
    '</div>';
  }
  return '<button type="button" class="rfp-stage '+typeCls+(isSelected?' selected':'')+'" '+
    'onclick="selectRfpStage(\''+esc2(stage.id)+'\')" '+
    'data-stage="'+esc2(stage.id)+'">'+
    '<div class="rfp-stage-idx">'+(idx+1)+'</div>'+
    '<div class="rfp-stage-label">'+esc2(stage.label)+'</div>'+
    ownerLine+
    branchLine+
  '</button>';
}

// Detail panel content for the currently selected stage. Owner photos
// are tiny avatars that link the abstract role to the actual people who
// run it — gives the manager (and incoming employees) a quick "who do I
// ask about this?" answer.
function renderRfpDetailPanel(stages) {
  var stage = stages.find(function(s){ return s.id === TEAM_SELECTED_STAGE_ID; }) || stages[0];
  if (!stage) return '<div class="team-empty">Click a stage to see details.</div>';

  var owners = (stage.ownerIds || []).map(teamFindById).filter(Boolean);
  var ownerHtml = '';
  if (stage.owner || owners.length) {
    var avatars = owners.map(function(m){
      return '<div class="rfp-detail-owner" title="'+esc2(m.name)+'">'+
        teamPhotoHtml(m, 36)+
        '<span class="rfp-detail-owner-name">'+esc2(m.name)+'</span>'+
      '</div>';
    }).join('');
    ownerHtml = '<div class="rfp-detail-section">'+
      '<div class="rfp-detail-label">Owner</div>'+
      (stage.owner ? '<div class="rfp-detail-role">'+esc2(stage.owner)+'</div>' : '')+
      (avatars ? '<div class="rfp-detail-owners">'+avatars+'</div>' : '')+
    '</div>';
  }

  var artHtml = '';
  if (stage.artifacts && stage.artifacts.length) {
    artHtml = '<div class="rfp-detail-section">'+
      '<div class="rfp-detail-label">Artifacts produced</div>'+
      '<ul class="rfp-detail-artifacts">'+
        stage.artifacts.map(function(a){ return '<li>'+esc2(a)+'</li>'; }).join('')+
      '</ul>'+
    '</div>';
  }

  var nextHtml = '';
  if (stage.type === 'decision' && stage.branches && stage.branches.length) {
    nextHtml = '<div class="rfp-detail-section">'+
      '<div class="rfp-detail-label">Decision branches</div>'+
      '<ul class="rfp-detail-next">'+
        stage.branches.map(function(b){
          var target = stages.find(function(s){ return s.id === b.to; });
          var label = target ? target.label : b.to;
          return '<li><span class="rfp-branch-label">'+esc2(b.label)+'</span> → '+
            '<a href="#" onclick="event.preventDefault();selectRfpStage(\''+esc2(b.to)+'\')">'+esc2(label)+'</a></li>';
        }).join('')+
      '</ul>'+
    '</div>';
  } else if (stage.nextStages && stage.nextStages.length) {
    nextHtml = '<div class="rfp-detail-section">'+
      '<div class="rfp-detail-label">Next</div>'+
      '<ul class="rfp-detail-next">'+
        stage.nextStages.map(function(id){
          var target = stages.find(function(s){ return s.id === id; });
          if (!target) return '';
          return '<li>→ <a href="#" onclick="event.preventDefault();selectRfpStage(\''+esc2(id)+'\')">'+esc2(target.label)+'</a></li>';
        }).join('')+
      '</ul>'+
    '</div>';
  } else {
    nextHtml = '<div class="rfp-detail-section"><div class="rfp-detail-label">Next</div>'+
      '<div class="rfp-detail-terminal">End of flow</div></div>';
  }

  var typeBadge = '<span class="rfp-detail-typebadge rfp-detail-typebadge-'+stage.type+'">'+
    (stage.type === 'action' ? 'Action' : stage.type === 'decision' ? 'Decision' : 'End State')+
  '</span>';

  return '<div class="rfp-detail-head">'+typeBadge+'<h3 class="rfp-detail-title">'+esc2(stage.label)+'</h3></div>'+
    (stage.description ? '<p class="rfp-detail-desc">'+esc2(stage.description)+'</p>' : '')+
    ownerHtml+
    artHtml+
    nextHtml;
}

function selectRfpStage(id) {
  TEAM_SELECTED_STAGE_ID = id;
  // Re-render the whole RFP tab body. Cheap (~7 stages) and keeps the
  // "current selection" highlight on the flow side in sync with the
  // detail panel on the right.
  var host = document.getElementById('team-content');
  if (!host) return;
  // Replace only the .team-tab-body content so the header + tabs don't
  // flicker. Selector-based update keeps scroll position too.
  var bodyEl = host.querySelector('.team-tab-body');
  if (bodyEl) {
    bodyEl.innerHTML = renderRfpTab();
    if (typeof renderIcons === 'function') renderIcons();
  }
}
