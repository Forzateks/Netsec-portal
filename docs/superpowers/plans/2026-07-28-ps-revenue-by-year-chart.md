# PS Deals Revenue-by-Year Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An always-visible "Revenue by Year" bar chart on the Professional Services screen, showing total awarded deal value (Won/In Progress/Completed, grouped by `awarded_year`) in both USD and AED, independent of the page's filters.

**Architecture:** Pure frontend change in `js/features/ps-deals.js` + one new fixed `<div>` in `index.html`. No new DB column — reuses `ps_deals.final_ps_value_usd`, `.awarded_year`, `.status`. The chart is a hand-rolled inline SVG bar chart, matching the existing `buildPieChart()` technique in `js/features/projects.js` — no charting library.

**Tech Stack:** Vanilla HTML/CSS/JS, Supabase JS client (`sb`), Cloudflare Pages (auto-deploy on push to `master`).

## Global Constraints

- No framework, no build step — plain browser-ready JS (`CLAUDE.md` §2).
- No automated test framework exists in this repo — verification is manual/scratch-script based (`CLAUDE.md` §11).
- No new database column or migration — reuses `ps_deals.final_ps_value_usd`, `.awarded_year`, `.status`, `.is_archived` as-is (per the approved spec, `docs/superpowers/specs/2026-07-28-ps-revenue-by-year-chart-design.md`).
- Reuse `fmtUsd()`, `fmtAed()`, `usdToAed()`, `esc2()` from `js/core/helpers.js` as-is — never reimplement currency formatting or AED conversion (`CLAUDE.md` §10).
- SVG `fill`/text color attributes use literal hex values (`#0A1F5C` navy, `#00A0D2` teal, `#6b7280` muted), matching `buildPieChart()`'s existing precedent — do not use `var(--x)` CSS custom properties inside SVG presentation attributes (regular HTML `style="..."` attributes outside the `<svg>` may still use `var(--x)` as elsewhere in the codebase).
- The chart is independent of `_psFilteredDeals()`/the search box/Region/Client/Year filters/`_psStatusFilter` — always computed from the full `PS_DEALS` array.
- Any shell-visible change requires the version trio bump: `sw.js` `CACHE_VERSION`, `js/core/init.js` `SW_REGISTRATION_URL`, `index.html` Sentry `release`, plus a `data/whats-new.json` entry — all four move together (`CLAUDE.md` §5).
- **Do not `git push` until the final task.** Every task before the last commits locally only.
- Manager-only screen (`CLAUDE.md` §6/§8) — verification requires logging in as a manager.

---

## Task 1: Revenue aggregation — `_psYearlyRevenue()`

**Files:**
- Modify: `js/features/ps-deals.js` (insert after `_psLinkedEngagementLabel`, before the `// ── RENDER` comment)

**Interfaces:**
- Consumes: `PS_DEALS` (global array, already loaded by `loadPsDeals()`)
- Produces: `PS_REVENUE_STATUSES` (array, `['won','in_progress','completed']`); `_psYearlyRevenue()` → `{ years: [{year:number, usd:number}, ...] (ascending by year), excludedCount: number }`

- [ ] **Step 1: Add the constant and aggregation function**

In `js/features/ps-deals.js`, find:

```js
function _psLinkedEngagementLabel(engId) {
  if (!engId) return '<span class="dim">—</span>';
  var eng = (ENGAGEMENTS||[]).find(function(e){ return e.id === engId; });
  if (!eng) return '<span class="dim">(deleted)</span>';
  // Engagement may have been archived after the link was made. The link
  // itself stays valid (FK SET NULL only fires on permanent delete) but
  // the deal display should signal that the engagement is no longer in
  // the active list.
  var archBadge = eng.is_archived
    ? ' <span class="ps-linked-arch-badge">archived</span>'
    : '';
  return '<span class="ps-eng-link" title="Linked engagement"><i data-lucide="link-2" style="width:11px;height:11px;vertical-align:-1px"></i> '+esc2(eng.name)+archBadge+'</span>';
}

// ── RENDER ────────────────────────────────────────────────────────
```

Replace with:

```js
function _psLinkedEngagementLabel(engId) {
  if (!engId) return '<span class="dim">—</span>';
  var eng = (ENGAGEMENTS||[]).find(function(e){ return e.id === engId; });
  if (!eng) return '<span class="dim">(deleted)</span>';
  // Engagement may have been archived after the link was made. The link
  // itself stays valid (FK SET NULL only fires on permanent delete) but
  // the deal display should signal that the engagement is no longer in
  // the active list.
  var archBadge = eng.is_archived
    ? ' <span class="ps-linked-arch-badge">archived</span>'
    : '';
  return '<span class="ps-eng-link" title="Linked engagement"><i data-lucide="link-2" style="width:11px;height:11px;vertical-align:-1px"></i> '+esc2(eng.name)+archBadge+'</span>';
}

// v150: statuses that count as "closed" revenue for the yearly chart.
// Quoted hasn't happened yet; Lost/Cancelled never happened.
var PS_REVENUE_STATUSES = ['won', 'in_progress', 'completed'];

// v150: revenue-by-year aggregation for the "Revenue by Year" chart card.
// Sums final_ps_value_usd for deals in PS_REVENUE_STATUSES, grouped by
// awarded_year. Always reads the full PS_DEALS array — independent of
// every filter/chip on this page (a fixed company-wide figure, not a
// filtered view). Deals that qualify by status but have no awarded_year
// set are excluded from every bucket and counted separately so the chart
// can footnote them (mirrors the AMC Total Value card's missing-value
// footnote in js/features/amc-contracts.js).
function _psYearlyRevenue() {
  var byYear = {};
  var excludedCount = 0;
  (PS_DEALS||[]).forEach(function(d){
    if (d.is_archived) return;
    if (PS_REVENUE_STATUSES.indexOf(d.status) === -1) return;
    if (!d.awarded_year) { excludedCount++; return; }
    byYear[d.awarded_year] = (byYear[d.awarded_year] || 0) + (Number(d.final_ps_value_usd) || 0);
  });
  var years = Object.keys(byYear)
    .map(function(y){ return { year: Number(y), usd: byYear[y] }; })
    .sort(function(a,b){ return a.year - b.year; });
  return { years: years, excludedCount: excludedCount };
}

// ── RENDER ────────────────────────────────────────────────────────
```

- [ ] **Step 2: Verify with a throwaway Node script (no DOM needed — pure aggregation over a plain array)**

Create a scratch file `ps-task1-check.js` (anywhere outside the repo):

```js
var PS_REVENUE_STATUSES = ['won', 'in_progress', 'completed'];
function _psYearlyRevenue() {
  var byYear = {};
  var excludedCount = 0;
  (PS_DEALS||[]).forEach(function(d){
    if (d.is_archived) return;
    if (PS_REVENUE_STATUSES.indexOf(d.status) === -1) return;
    if (!d.awarded_year) { excludedCount++; return; }
    byYear[d.awarded_year] = (byYear[d.awarded_year] || 0) + (Number(d.final_ps_value_usd) || 0);
  });
  var years = Object.keys(byYear)
    .map(function(y){ return { year: Number(y), usd: byYear[y] }; })
    .sort(function(a,b){ return a.year - b.year; });
  return { years: years, excludedCount: excludedCount };
}

global.PS_DEALS = [
  { status:'won',         is_archived:false, awarded_year:2025, final_ps_value_usd:20000 },
  { status:'in_progress', is_archived:false, awarded_year:2025, final_ps_value_usd:15000 },
  { status:'completed',   is_archived:false, awarded_year:2024, final_ps_value_usd:31000 },
  { status:'quoted',      is_archived:false, awarded_year:2026, final_ps_value_usd:99999 }, // excluded: status not in PS_REVENUE_STATUSES
  { status:'lost',        is_archived:false, awarded_year:2026, final_ps_value_usd:99999 }, // excluded: status
  { status:'cancelled',   is_archived:false, awarded_year:2026, final_ps_value_usd:99999 }, // excluded: status
  { status:'won',         is_archived:false, awarded_year:null, final_ps_value_usd:5000 },  // excluded: no awarded_year — counted in excludedCount
  { status:'completed',   is_archived:true,  awarded_year:2025, final_ps_value_usd:99999 }  // excluded: archived
];

var result = _psYearlyRevenue();
var failed = 0;
function check(label, got, expected) {
  var ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok?'PASS':'FAIL')+' — '+label+': expected '+JSON.stringify(expected)+', got '+JSON.stringify(got));
}
check('years',         result.years,         [ {year:2024, usd:31000}, {year:2025, usd:35000} ]);
check('excludedCount', result.excludedCount, 1);
process.exit(failed ? 1 : 0);
```

Run: `node ps-task1-check.js`
Expected: 2 `PASS` lines, exit code 0. Delete the scratch file when done.

- [ ] **Step 3: Commit (local only — do not push)**

```bash
git add js/features/ps-deals.js
git commit -m "feat: add _psYearlyRevenue() revenue-by-year aggregation"
```

---

## Task 2: Render the "Revenue by Year" chart

**Files:**
- Modify: `index.html` (insert new fixed `<div id="ps-revenue-chart"></div>`)
- Modify: `js/features/ps-deals.js` — add `_psRenderRevenueChart()`; call it from `loadPsDeals()`

**Interfaces:**
- Consumes: `_psYearlyRevenue()` (Task 1); `fmtUsd()`, `fmtAed()`, `usdToAed()` (existing, `js/core/helpers.js`)
- Produces: `_psRenderRevenueChart()` → writes HTML directly to `#ps-revenue-chart`, no return value (matches `_amcRenderTotalCard()`'s existing pattern of writing straight to its DOM anchor)

- [ ] **Step 1: Add the new fixed `<div>` in `index.html`**

Find:

```html
  <div class="card" style="margin-bottom:14px">
    <div class="filter-bar-inline" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <input id="ps-search" oninput="renderPsDeals()" placeholder="Search client, partner, remarks..." style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;min-width:220px;flex:1">
      <label style="font-size:12px;color:var(--muted);font-weight:600">Client:</label>
      <select id="ps-filter-client" onchange="renderPsDeals()" style="width:auto;padding:7px 10px;font-size:13px"></select>
      <label style="font-size:12px;color:var(--muted);font-weight:600;margin-left:6px">Region:</label>
      <select id="ps-filter-region" onchange="renderPsDeals()" style="width:auto;padding:7px 10px;font-size:13px"></select>
      <label style="font-size:12px;color:var(--muted);font-weight:600;margin-left:6px">Year:</label>
      <select id="ps-filter-year" onchange="renderPsDeals()" style="width:auto;padding:7px 10px;font-size:13px"></select>
      <button class="btn btn-sm btn-ghost" onclick="clearPsFilters()">✕ Clear</button>
      <button class="btn btn-sm btn-ghost archived-toggle-btn" id="ps-archived-toggle" onclick="_psToggleArchivedView()" style="margin-left:auto"></button>
    </div>
  </div>

  <div id="ps-load" class="loading"><div class="spinner"></div>Loading deals...</div>
  <div id="ps-content"></div>
```

Replace with:

```html
  <div class="card" style="margin-bottom:14px">
    <div class="filter-bar-inline" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <input id="ps-search" oninput="renderPsDeals()" placeholder="Search client, partner, remarks..." style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;min-width:220px;flex:1">
      <label style="font-size:12px;color:var(--muted);font-weight:600">Client:</label>
      <select id="ps-filter-client" onchange="renderPsDeals()" style="width:auto;padding:7px 10px;font-size:13px"></select>
      <label style="font-size:12px;color:var(--muted);font-weight:600;margin-left:6px">Region:</label>
      <select id="ps-filter-region" onchange="renderPsDeals()" style="width:auto;padding:7px 10px;font-size:13px"></select>
      <label style="font-size:12px;color:var(--muted);font-weight:600;margin-left:6px">Year:</label>
      <select id="ps-filter-year" onchange="renderPsDeals()" style="width:auto;padding:7px 10px;font-size:13px"></select>
      <button class="btn btn-sm btn-ghost" onclick="clearPsFilters()">✕ Clear</button>
      <button class="btn btn-sm btn-ghost archived-toggle-btn" id="ps-archived-toggle" onclick="_psToggleArchivedView()" style="margin-left:auto"></button>
    </div>
  </div>

  <div id="ps-revenue-chart"></div>

  <div id="ps-load" class="loading"><div class="spinner"></div>Loading deals...</div>
  <div id="ps-content"></div>
```

- [ ] **Step 2: Add `_psRenderRevenueChart()`**

In `js/features/ps-deals.js`, find:

```js
// ── RENDER ────────────────────────────────────────────────────────
function renderPsDeals() {
```

Replace with:

```js
// ── RENDER ────────────────────────────────────────────────────────

// v150: builds the inline SVG "Revenue by Year" bar chart and writes it
// to #ps-revenue-chart. Same hand-rolled-SVG technique as buildPieChart()
// in js/features/projects.js — no charting library. Independent of every
// filter on this page; called once from loadPsDeals() whenever PS_DEALS
// refreshes, not from renderPsDeals() (which reruns on every keystroke in
// the search box — this chart never changes based on that).
function _psRenderRevenueChart() {
  var data = _psYearlyRevenue();
  var wrap = document.getElementById('ps-revenue-chart');
  if (!wrap) return;
  if (!data.years.length) {
    wrap.innerHTML = '<div class="card" style="text-align:center;color:var(--muted);padding:20px;margin-bottom:14px">No revenue recorded yet</div>';
    return;
  }

  var barW = 70, gap = 30, padL = 30, padR = 30, padTop = 50, barAreaH = 140, padBottom = 34;
  var n = data.years.length;
  var svgW = padL + padR + n*barW + (n-1)*gap;
  var svgH = padTop + barAreaH + padBottom;
  var maxUsd = 0;
  data.years.forEach(function(y){ if (y.usd > maxUsd) maxUsd = y.usd; });

  var bars = data.years.map(function(y, i){
    var x = padL + i*(barW+gap);
    var h = maxUsd > 0 ? Math.round((y.usd/maxUsd) * barAreaH) : 0;
    var barY = padTop + (barAreaH - h);
    var cx = x + barW/2;
    var usdLabel = fmtUsd(y.usd, false);
    var aedLabel = fmtAed(usdToAed(y.usd), false);
    return '<g>'+
      '<rect x="'+x+'" y="'+barY+'" width="'+barW+'" height="'+h+'" rx="4" fill="#00A0D2"/>'+
      '<text x="'+cx+'" y="'+(padTop-24)+'" text-anchor="middle" font-family="DM Mono,monospace" font-weight="700" font-size="14" fill="#0A1F5C">'+usdLabel+'</text>'+
      '<text x="'+cx+'" y="'+(padTop-8)+'" text-anchor="middle" font-family="DM Mono,monospace" font-size="10" fill="#6b7280">'+aedLabel+'</text>'+
      '<text x="'+cx+'" y="'+(padTop+barAreaH+20)+'" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="12" font-weight="600" fill="#0A1F5C">'+y.year+'</text>'+
    '</g>';
  }).join('');

  var footnote = data.excludedCount > 0
    ? '<div style="font-size:11px;color:#92400E;font-style:italic;margin-top:6px">'+data.excludedCount+' deal'+(data.excludedCount===1?'':'s')+' excluded — no awarded year set</div>'
    : '';

  wrap.innerHTML = '<div class="card" style="margin-bottom:14px">'+
    '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:8px">Revenue by Year (Awarded)</div>'+
    '<svg viewBox="0 0 '+svgW+' '+svgH+'" style="width:100%;max-width:'+svgW+'px;height:'+svgH+'px;display:block">'+bars+'</svg>'+
    footnote+
  '</div>';
}

function renderPsDeals() {
```

- [ ] **Step 3: Call it from `loadPsDeals()`**

Find:

```js
  PS_DEALS      = dRes.data || [];
  PS_MILESTONES = mRes.data || [];
  _psPopulateFilters();
  renderPsDeals();
}
```

Replace with:

```js
  PS_DEALS      = dRes.data || [];
  PS_MILESTONES = mRes.data || [];
  _psPopulateFilters();
  _psRenderRevenueChart();
  renderPsDeals();
}
```

- [ ] **Step 4: Verify (no browser tool available — use these instead)**

You do not have a browser tool in this environment. Do not attempt to open one or claim you did. Instead:

1. `node --check js/features/ps-deals.js` — confirms no JavaScript syntax errors.
2. `node --check index.html` will fail (it's not a JS file) — instead, manually confirm the new `<div id="ps-revenue-chart"></div>` appears exactly once in `index.html`, positioned between the filter-bar's closing `</div>` and `<div id="ps-load"...>`.
3. Grep `js/features/ps-deals.js` to confirm `_psRenderRevenueChart` is defined exactly once and that `loadPsDeals()` calls it exactly once, before `renderPsDeals()`.
4. Read back the full `_psRenderRevenueChart()` function and manually trace both branches (`data.years.length === 0`, and `> 0`) to confirm each writes to `wrap.innerHTML` and neither leaves `wrap` untouched.
5. Confirm every `fill="..."` and SVG `<text>` `fill="..."` attribute uses a literal hex color (`#00A0D2`, `#0A1F5C`, `#6b7280`), not `var(--...)`.

Report exactly what you checked and the output — do not claim a browser check you didn't perform. Full visual verification is deferred to a human who will run it later in this plan (Task 4).

- [ ] **Step 5: Commit (local only — do not push)**

```bash
git add index.html js/features/ps-deals.js
git commit -m "feat: render Revenue by Year chart above the PS deals list"
```

---

## Task 3: Version trio + release notes

**Files:**
- Modify: `sw.js` — `CACHE_VERSION`
- Modify: `js/core/init.js` — `SW_REGISTRATION_URL`
- Modify: `index.html` — Sentry `release`
- Modify: `data/whats-new.json` — append v150 entry

- [ ] **Step 1: Bump `sw.js`**

Find:

```js
var CACHE_VERSION = 'netsec-v149';
```

Replace with:

```js
var CACHE_VERSION = 'netsec-v150';
```

- [ ] **Step 2: Bump `js/core/init.js`**

Find:

```js
var SW_REGISTRATION_URL = '/sw.js?v=149';
```

Replace with:

```js
var SW_REGISTRATION_URL = '/sw.js?v=150';
```

- [ ] **Step 3: Bump `index.html`**

Find:

```js
    release: 'netsec-portal@v149',
```

Replace with:

```js
    release: 'netsec-portal@v150',
```

- [ ] **Step 4: Append the whats-new.json entry**

In `data/whats-new.json`, find the closing of the `v149-amc-long-expired-section` item (the last item in the `items` array):

```json
    {
      "id": "v149-amc-long-expired-section",
      "version": "v149",
      "category": "new",
      "title": "Expired AMC Contracts section",
      "body": "AMC Contracts that have been expired for more than 60 days now move to their own \"Expired AMC Contracts\" section below the main list, and drop out of the Total AMC Value figure. Editing a contract's dates to a new period moves it straight back to the main list and the total automatically — no separate status field to manage."
    }
  ]
}
```

Replace with:

```json
    {
      "id": "v149-amc-long-expired-section",
      "version": "v149",
      "category": "new",
      "title": "Expired AMC Contracts section",
      "body": "AMC Contracts that have been expired for more than 60 days now move to their own \"Expired AMC Contracts\" section below the main list, and drop out of the Total AMC Value figure. Editing a contract's dates to a new period moves it straight back to the main list and the total automatically — no separate status field to manage."
    },
    {
      "id": "v150-ps-revenue-chart",
      "version": "v150",
      "category": "new",
      "title": "Revenue by Year chart for Professional Services",
      "body": "The Professional Services screen now shows a Revenue by Year bar chart above the deal list — total awarded value (Won / In Progress / Completed) per year, in both USD and AED. It's always company-wide, independent of the page's search and filters."
    }
  ]
}
```

- [ ] **Step 5: Verify all four files agree on v150**

Run:

```bash
grep -n "netsec-v150\|v=150\|netsec-portal@v150\|\"version\": \"v150\"" sw.js js/core/init.js index.html data/whats-new.json
```

Expected: one match per file, all showing `150`.

- [ ] **Step 6: Commit (local only — do not push)**

```bash
git add sw.js js/core/init.js index.html data/whats-new.json
git commit -m "v150: Revenue by Year chart for Professional Services"
```

---

## Task 4: Manual regression pass (live/local, no code changes)

Log in as a manager. Navigate to **Customers & Deals → Professional Services**. Use **+ New Deal** for every throwaway deal below — Client name `ZZZ QA150` for all of them (easy to find/filter/clean up), Region/Mode/Vendor anything, and note in Remarks: `v150 QA - safe to delete`. Use awarded years **2001** and **2002** — far enough in the past that no real deal will ever collide with them, so totals are exact and easy to verify by hand.

- [ ] **Step 1: A single closed deal creates a new bar**

Create **Deal A**: Status `Won`, Awarded Year `2002`, Final PS Value `10000`.

Expected: a new bar appears in the "Revenue by Year (Awarded)" chart above the table, labeled `2002`, showing `$10,000` (bold) and `≈ AED 36,725` (smaller, muted) above the bar.

- [ ] **Step 2: A second closed deal in the same year adds to the same bar**

Create **Deal B**: Status `In Progress`, Awarded Year `2002`, Final PS Value `5000`.

Expected: the `2002` bar's total becomes `$15,000` / `≈ AED 55,088` — no second `2002` bar, same one grows.

- [ ] **Step 3: A closed deal in a different year creates a separate, correctly-ordered bar**

Create **Deal C**: Status `Completed`, Awarded Year `2001`, Final PS Value `8000`.

Expected: a new bar for `2001` appears **to the left** of the `2002` bar (ascending year order), showing `$8,000`. The `2002` bar is unchanged at `$15,000`.

- [ ] **Step 4: Quoted deals are excluded**

Create **Deal D**: Status `Quoted`, Awarded Year `2002`, Final PS Value left blank.

Expected: the `2002` bar stays at exactly `$15,000` — unchanged.

- [ ] **Step 5: Lost deals are excluded**

Create **Deal E**: Status `Lost`, Awarded Year `2002`, Final PS Value left blank.

Expected: the `2002` bar stays at exactly `$15,000` — unchanged.

- [ ] **Step 6: Cancelled deals are excluded (even with a Final Value set)**

Create **Deal F**: Status `Cancelled`, Awarded Year `2002`, Final PS Value `50000` (required for this status — the form will reject an empty value here).

Expected: the `2002` bar stays at exactly `$15,000` — the `$50,000` never counts, confirming exclusion is by status, not by whether a value happens to be present.

- [ ] **Step 7: A closed deal missing Awarded Year is excluded and footnoted**

Create **Deal G**: Status `Won`, Awarded Year left **blank**, Final PS Value `3000`.

Expected: no bar changes (the `$3,000` appears nowhere), and a footnote appears below the chart: "1 deal excluded — no awarded year set".

- [ ] **Step 8: Archiving a deal removes it from the chart immediately**

Open **Deal A** (the first `Won`/2002/`$10,000` deal from Step 1) and click the trash/archive button in its edit modal (`archivePsDealFromModal()`) — this is this screen's existing archive flow (Edit modal → trash icon → confirm "Archive"), not a delete. Confirm the archive.

Expected: without any manual page refresh (archiving already calls `loadPsDeals()`, which now also calls `_psRenderRevenueChart()`), the `2002` bar drops from `$15,000` to `$5,000` — only Deal B's contribution remains, confirming an archived deal never counts, matching how Contract-style archiving already behaves elsewhere in this app (e.g. AMC Contracts).

- [ ] **Step 9: The chart ignores the page's own filters**

Type `ZZZ QA150` into the search box at the top of the page.

Expected: the table below narrows to whichever of these test deals are still active (Deal A is now in the Archived view, not here), but the chart above stays exactly as it was at the end of Step 8 — unaffected by the search. Clear the search box afterward.

- [ ] **Step 10: Mobile / narrow width**

Resize the browser window to under 768px wide (or DevTools device toolbar).

Expected: the chart card scales down responsively (the `<svg>` has `width:100%`) without horizontal overflow or a broken layout.

- [ ] **Step 11: Clean up all QA data**

This screen's delete flow is archive-first, then permanent-delete from the Archived view (same two-step pattern as AMC Contracts):

1. For each of Deals B, C, D, E, F, G (Deal A is already archived from Step 8): open the deal's Edit modal and click the trash/archive button, confirm "Archive".
2. Click the "Archived (N)" toggle button near the filter bar to switch to the Archived view. All 7 test deals (A through G) should be listed there.
3. For each of the 7, click the permanent-delete button (`permanentlyDeletePsDeal`) and type the client name (`ZZZ QA150`) to confirm.
4. Switch back to the active view ("Back to Active" button).

Expected: the "Revenue by Year" chart returns to exactly its pre-test state (same bars, same totals, same or absent footnote as before Step 1), and the Archived toggle either disappears or shows a count with no `ZZZ QA150` rows in it.

---

## Task 5: Push and verify live deploy

**Files:** none (deploy step only)

- [ ] **Step 1: Push to origin/master**

```bash
git push origin master
```

- [ ] **Step 2: Poll the live `sw.js` for the new version**

```bash
i=0; until curl -s "https://netsec-portal.pages.dev/sw.js?cb=$(date +%s)" | grep -q "netsec-v150"; do i=$((i+1)); if [ $i -ge 12 ]; then echo "TIMEOUT"; break; fi; sleep 10; done; curl -s "https://netsec-portal.pages.dev/sw.js?cb=$(date +%s)" | grep CACHE_VERSION
```

Expected: `var CACHE_VERSION = 'netsec-v150';` within ~2 minutes.

- [ ] **Step 3: If it times out, check the Cloudflare Pages build directly**

A prior deploy in this repo (v148) hit a transient `clone_repo` timeout connecting to GitHub — unrelated to the code, resolved by retrying the same deployment rather than pushing again. If Step 2 times out:

```bash
gh api repos/Forzateks/Netsec-portal/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[] | {name, status, conclusion}'
```

If `conclusion` is `failure`, use the Cloudflare Pages MCP tool to `POST /accounts/{account_id}/pages/projects/netsec-portal/deployments/{deployment_id}/retry` for that deployment, then repeat Step 2.

- [ ] **Step 4: Confirm the deployed file actually contains the new code**

```bash
curl -s "https://netsec-portal.pages.dev/js/features/ps-deals.js?cb=$(date +%s)" | grep -o "_psYearlyRevenue\|_psRenderRevenueChart\|PS_REVENUE_STATUSES" | sort -u
```

Expected: all three names present. This checks the actual served file, not just that the build succeeded (a build can succeed while still serving a stale cached copy at the edge for a short window).

- [ ] **Step 5: Remind the human partner to re-verify live**

Tell the user the deploy is confirmed live and ask them to hard-refresh (or open a private window) and glance at the Professional Services screen — the chart should now be visible above the deal list, matching whatever real Won/In Progress/Completed deals with an Awarded Year already exist in production.
