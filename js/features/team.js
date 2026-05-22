// == TEAM PORTFOLIO MODULE (v83) =====================================
// Public-facing showcase + internal portfolio mapping + RFP Process
// Playbook. Single screen (screen-team), three tabs. All data lives in
// data/team.json — edit that file and commit; no admin UI.
//
// Public route: /#team. Reachable without authentication. The unauth view
// shows only Meet the Team, members where publicVisible=true, with phone
// numbers stripped and product names replaced by their publicCategory
// label (generic, no specific vendor names leak to competitors).
//
// Internal route: same /#team after login. Full data. Three tabs visible.
//
// Routing convention: hash-based (#/team[?tab=meet|portfolio|rfp]) so the
// page is shareable as a static link without server config. Init.js wires
// the hash listener; this module exposes navigateToTeamRoute() for the
// sidebar to call and renderTeamScreen() for the router to call.

var TEAM_DATA          = null;     // cached JSON
var TEAM_PUBLIC_MODE   = false;    // true when unauthenticated visitor
var TEAM_CURRENT_TAB   = 'meet';   // 'meet' | 'portfolio' | 'rfp'
var TEAM_SELECTED_STAGE_ID = null; // currently focused RFP stage (for detail panel)

var TEAM_CATEGORY_ORDER  = ['BDM', 'Presales', 'Technical'];
var TEAM_CATEGORY_COLORS = {
  'BDM':       'var(--navy)',
  'Presales':  'var(--teal)',
  'Technical': '#C8A832'
};

// == DATA LOAD ===================================================
// Lightweight cache: fetch once per page load. The service worker's
// same-origin stale-while-revalidate handles staleness across reloads.
async function loadTeamData() {
  if (TEAM_DATA) return TEAM_DATA;
  try {
    var res = await fetch('data/team.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    TEAM_DATA = await res.json();
  } catch (e) {
    console.error('Team data load failed:', e);
    TEAM_DATA = { team: [], products: [], rfpStages: [] };
  }
  return TEAM_DATA;
}

// Public-view scrub: filter publicVisible=true, strip phone numbers, swap
// product names for their publicCategory label. Operates on a deep clone
// so the internal cache stays intact for any later in-session re-render.
function scrubForPublic(data) {
  var team = (data.team || [])
    .filter(function(m){ return m.publicVisible === true; })
    .map(function(m){
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
  var byCat = { 'BDM': [], 'Presales': [], 'Technical': [] };
  members.forEach(function(m){
    var cat = m.category || 'Technical';
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
  if (!data.team.length) {
    return '<div class="team-empty">No team members to show yet.</div>';
  }
  var byCat = teamGroupByCategory(data.team);
  return TEAM_CATEGORY_ORDER.map(function(cat){
    var members = byCat[cat] || [];
    if (!members.length) return '';
    return renderCategorySection(cat, members.map(renderMemberCard).join(''));
  }).join('');
}

function renderCategorySection(category, innerHtml) {
  var color = TEAM_CATEGORY_COLORS[category] || 'var(--navy)';
  return '<section class="team-cat-section">'+
    '<div class="team-cat-head">'+
      '<div class="team-cat-bar" style="background:'+color+'"></div>'+
      '<h2 class="team-cat-title">'+esc2(category)+'</h2>'+
    '</div>'+
    '<div class="team-card-grid">'+innerHtml+'</div>'+
  '</section>';
}

function renderMemberCard(m) {
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
  // Phone is internal-only (public scrub blanks it). Rendered as a small
  // chip below the email+location row so the main row stays clean.
  var phoneHtml = (!TEAM_PUBLIC_MODE && m.phone)
    ? '<div class="team-card-phone">'+
        '<i data-lucide="phone" class="team-contact-ico"></i>'+
        '<a href="tel:'+esc2(m.phone.replace(/\s+/g,''))+'">'+esc2(m.phone)+'</a>'+
      '</div>'
    : '';
  return '<article class="team-card">'+
    '<div class="team-card-photo">'+teamPhotoHtml(m, 120)+'</div>'+
    '<div class="team-card-name">'+esc2(m.name)+'</div>'+
    '<div class="team-card-role">'+esc2(m.role || '')+'</div>'+
    '<div class="team-card-bottom">'+emailHtml+locBadge+'</div>'+
    phoneHtml+
  '</article>';
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
