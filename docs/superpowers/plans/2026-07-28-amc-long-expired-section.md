# AMC 60+ Day Expired Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AMC contracts expired more than 60 days move out of the main AMC Contracts list into their own "Expired AMC Contracts" section below, excluded from the Total AMC Value card; editing a contract's dates to a future period moves it back automatically.

**Architecture:** Pure frontend change in `js/features/amc-contracts.js` (vanilla JS, no framework, no build step). Status stays 100% derived from `amc_end_date` — no new DB column. A new predicate (`_amcIsLongExpired`) routes rows between the existing main-list renderer and a new section that reuses the existing table/card renderers as-is.

**Tech Stack:** Vanilla HTML/CSS/JS, Supabase JS client (`sb`), Cloudflare Pages (auto-deploy on push to `master`).

## Global Constraints

- No framework, no build step, no `package.json` — plain browser-ready JS (project convention, `CLAUDE.md` §2).
- No automated test framework exists in this repo — verification is manual/scratch-script based (`CLAUDE.md` §11). Do not add Jest/Mocha/etc.
- No new database column or migration — status stays 100% derived from `amc_end_date` (per the approved spec, `docs/superpowers/specs/2026-07-28-amc-long-expired-section-design.md`).
- `AMC_LONG_EXPIRED_DAYS = 60` is the single source of truth for the threshold — never hardcode `60` or `-60` a second time anywhere else.
- Reuse `_amcRenderTable` / `_amcRenderCards` / `_amcBadge` / `_amcFmtUSD` as-is for the new section — do not fork or duplicate their logic (`CLAUDE.md` §10, "Use the shared helpers — never inline their logic").
- Any shell-visible change requires the version trio bump: `sw.js` `CACHE_VERSION`, `js/core/init.js` `SW_REGISTRATION_URL`, `index.html` Sentry `release`, plus a `data/whats-new.json` entry — all four move together (`CLAUDE.md` §5).
- **Do not `git push` until the final task.** Every task before the last commits locally only; Cloudflare Pages auto-deploys on push to `master`, so nothing goes live until the full feature has been manually regression-tested (Task 5) and the last task pushes everything at once.
- Manager-only screen: the AMC Contracts sidebar item is hidden for non-managers (`CLAUDE.md` §6/§8) — verification steps require logging in as a manager.

---

## Task 1: Long-expired threshold constant + predicate

**Files:**
- Modify: `js/features/amc-contracts.js:19` (after `AMC_REGIONS`) — add constant
- Modify: `js/features/amc-contracts.js:31` (after `_amcStatusFor`) — add predicate

**Interfaces:**
- Consumes: existing `_amcStatusFor(contract)` → `{key, label, days}`
- Produces: `AMC_LONG_EXPIRED_DAYS` (number, `60`); `_amcIsLongExpired(contract)` → `boolean`, `true` once a contract has been expired for more than `AMC_LONG_EXPIRED_DAYS` days (i.e. `days < -60`, day 61 past due onward)

- [ ] **Step 1: Add the threshold constant**

In `js/features/amc-contracts.js`, find:

```js
// Region dropdown is hardcoded — small fixed list, not worth a table.
var AMC_REGIONS = ['UAE', 'KSA', 'Qatar', 'Oman', 'Bahrain', 'Kuwait', 'Kenya', 'Other'];
```

Replace with:

```js
// Region dropdown is hardcoded — small fixed list, not worth a table.
var AMC_REGIONS = ['UAE', 'KSA', 'Qatar', 'Oman', 'Bahrain', 'Kuwait', 'Kenya', 'Other'];

// v149: contracts expired more than this many days move out of the main
// list into their own "Expired AMC Contracts" section below.
var AMC_LONG_EXPIRED_DAYS = 60;
```

- [ ] **Step 2: Add the predicate function**

Find:

```js
function _amcStatusFor(contract) {
  if (!contract || !contract.amc_end_date) return { key:'unknown', label:'—', days:null };
  var today = new Date(); today.setHours(0,0,0,0);
  var end   = new Date(contract.amc_end_date + 'T00:00:00');
  var days  = Math.round((end - today) / 86400000);
  if (days < 0)  return { key:'expired',  label:'Expired',         days:days };
  if (days <= 90) return { key:'expiring', label:'Expiring Soon',  days:days };
  return            { key:'active',   label:'Active',          days:days };
}
```

Replace with (adds a new function directly after, `_amcStatusFor` itself unchanged):

```js
function _amcStatusFor(contract) {
  if (!contract || !contract.amc_end_date) return { key:'unknown', label:'—', days:null };
  var today = new Date(); today.setHours(0,0,0,0);
  var end   = new Date(contract.amc_end_date + 'T00:00:00');
  var days  = Math.round((end - today) / 86400000);
  if (days < 0)  return { key:'expired',  label:'Expired',         days:days };
  if (days <= 90) return { key:'expiring', label:'Expiring Soon',  days:days };
  return            { key:'active',   label:'Active',          days:days };
}

// v149: true once a contract has been expired for more than
// AMC_LONG_EXPIRED_DAYS days — routes it into the separate expired
// section instead of the main list. Doesn't change _amcStatusFor's
// 'expired' key/badge — same status, different section.
function _amcIsLongExpired(contract) {
  var st = _amcStatusFor(contract);
  return st.key === 'expired' && st.days != null && st.days < -AMC_LONG_EXPIRED_DAYS;
}
```

- [ ] **Step 3: Verify with a throwaway Node script (no DOM needed — pure date logic)**

Create a scratch file (anywhere outside the repo, e.g. your OS temp dir) named `amc-task1-check.js`:

```js
function _amcStatusFor(contract) {
  if (!contract || !contract.amc_end_date) return { key:'unknown', label:'—', days:null };
  var today = new Date(); today.setHours(0,0,0,0);
  var end   = new Date(contract.amc_end_date + 'T00:00:00');
  var days  = Math.round((end - today) / 86400000);
  if (days < 0)  return { key:'expired',  label:'Expired',         days:days };
  if (days <= 90) return { key:'expiring', label:'Expiring Soon',  days:days };
  return            { key:'active',   label:'Active',          days:days };
}
var AMC_LONG_EXPIRED_DAYS = 60;
function _amcIsLongExpired(contract) {
  var st = _amcStatusFor(contract);
  return st.key === 'expired' && st.days != null && st.days < -AMC_LONG_EXPIRED_DAYS;
}

function isoDaysAgo(n) {
  var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0,10);
}
function isoDaysFromNow(n) {
  var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

var cases = [
  { name:'future end date',         end: isoDaysFromNow(30), expectLongExpired:false },
  { name:'expired 30 days ago',     end: isoDaysAgo(30),      expectLongExpired:false },
  { name:'expired exactly 60 days', end: isoDaysAgo(60),      expectLongExpired:false },
  { name:'expired 61 days ago',     end: isoDaysAgo(61),      expectLongExpired:true  },
  { name:'expired 400 days ago',    end: isoDaysAgo(400),     expectLongExpired:true  }
];

var failed = 0;
cases.forEach(function(c){
  var got = _amcIsLongExpired({ amc_end_date: c.end });
  var ok = got === c.expectLongExpired;
  if (!ok) failed++;
  console.log((ok?'PASS':'FAIL')+' — '+c.name+': expected '+c.expectLongExpired+', got '+got);
});
process.exit(failed ? 1 : 0);
```

Run: `node amc-task1-check.js`
Expected: 5 `PASS` lines, exit code 0. The "exactly 60 days" case is the boundary check — it must be `false` (stays in the main Expired bucket), only day 61 flips to `true`. Delete the scratch file when done.

- [ ] **Step 4: Commit (local only — do not push)**

```bash
git add js/features/amc-contracts.js
git commit -m "feat: add AMC_LONG_EXPIRED_DAYS threshold + _amcIsLongExpired predicate"
```

---

## Task 2: Filtering refactor — exclude long-expired from the main list

**Files:**
- Modify: `js/features/amc-contracts.js` — `_amcFilteredContracts()`, `_amcCountByStatus()`; add `_amcApplyCommonFilters()`, `_amcLongExpiredContracts()`

**Interfaces:**
- Consumes: `_amcIsLongExpired(contract)` from Task 1; `AMC_CONTRACTS` (global array); `_amcStatusFilter` (global string)
- Produces: `_amcApplyCommonFilters(rows)` → filtered array; `_amcFilteredContracts()` → array (unchanged signature, now excludes long-expired rows from every non-archived chip bucket); `_amcLongExpiredContracts()` → array (new — non-archived + long-expired rows, respecting the same search/region/vendor/year filters)

- [ ] **Step 1: Replace `_amcFilteredContracts` with the common-filter helper + long-expired exclusion**

Find:

```js
// Apply current status-chip + filter-bar selections to the contracts
// list. Returns the filtered+sorted array.
function _amcFilteredContracts() {
  var search = (((document.getElementById('amc-search')||{}).value)||'').toLowerCase().trim();
  var regions = (typeof msGetValues === 'function') ? msGetValues('amc-filter-region') : [];
  var vendors = (typeof msGetValues === 'function') ? msGetValues('amc-filter-vendor') : [];
  var year    = ((document.getElementById('amc-filter-year')||{}).value)||'';

  // Archived view is its own filter — show archived rows, all other
  // filters still apply within that set. Every other chip hides archived
  // by default (the Archived chip is the only path to them).
  var rows;
  if (_amcStatusFilter === 'archived') {
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !!c.is_archived; });
  } else {
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !c.is_archived; });
    if (_amcStatusFilter !== 'all') {
      rows = rows.filter(function(c){ return _amcStatusFor(c).key === _amcStatusFilter; });
    }
  }
  if (search) {
    rows = rows.filter(function(c){
      return [c.customer_name, c.git_sales_order, c.partner]
        .some(function(f){ return f && f.toLowerCase().indexOf(search) !== -1; });
    });
  }
  if (regions.length) rows = rows.filter(function(c){ return c.region && regions.indexOf(c.region) !== -1; });
  if (vendors.length) rows = rows.filter(function(c){ return c.vendor && vendors.indexOf(c.vendor) !== -1; });
  if (year)           rows = rows.filter(function(c){ return String(c.booking_year) === String(year); });
  return rows;
}
```

Replace with:

```js
// Shared search/region/vendor/year predicate — used by both the main
// list (_amcFilteredContracts) and the 60+ day expired section
// (_amcLongExpiredContracts) so the two stay in lockstep.
function _amcApplyCommonFilters(rows) {
  var search = (((document.getElementById('amc-search')||{}).value)||'').toLowerCase().trim();
  var regions = (typeof msGetValues === 'function') ? msGetValues('amc-filter-region') : [];
  var vendors = (typeof msGetValues === 'function') ? msGetValues('amc-filter-vendor') : [];
  var year    = ((document.getElementById('amc-filter-year')||{}).value)||'';
  if (search) {
    rows = rows.filter(function(c){
      return [c.customer_name, c.git_sales_order, c.partner]
        .some(function(f){ return f && f.toLowerCase().indexOf(search) !== -1; });
    });
  }
  if (regions.length) rows = rows.filter(function(c){ return c.region && regions.indexOf(c.region) !== -1; });
  if (vendors.length) rows = rows.filter(function(c){ return c.vendor && vendors.indexOf(c.vendor) !== -1; });
  if (year)           rows = rows.filter(function(c){ return String(c.booking_year) === String(year); });
  return rows;
}

// Apply current status-chip + filter-bar selections to the contracts
// list. Returns the filtered+sorted array.
function _amcFilteredContracts() {
  // Archived view is its own filter — show archived rows, all other
  // filters still apply within that set. Every other chip hides archived
  // by default (the Archived chip is the only path to them).
  var rows;
  if (_amcStatusFilter === 'archived') {
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !!c.is_archived; });
  } else {
    // v149: long-expired (60+ days past due) contracts live in their own
    // section below and are excluded from every non-archived chip bucket.
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !c.is_archived && !_amcIsLongExpired(c); });
    if (_amcStatusFilter !== 'all') {
      rows = rows.filter(function(c){ return _amcStatusFor(c).key === _amcStatusFilter; });
    }
  }
  return _amcApplyCommonFilters(rows);
}

// v149: rows for the "Expired AMC Contracts (60+ days)" section — always
// non-archived + long-expired, independent of the status-chip selection
// above, but respects the same search/region/vendor/year filters as the
// main list (see _amcApplyCommonFilters).
function _amcLongExpiredContracts() {
  var rows = (AMC_CONTRACTS||[]).filter(function(c){ return !c.is_archived && _amcIsLongExpired(c); });
  return _amcApplyCommonFilters(rows);
}
```

- [ ] **Step 2: Update `_amcCountByStatus` to exclude long-expired rows from every chip count**

Find:

```js
function _amcCountByStatus() {
  // Counts feed the chip badges. "All" + lifecycle counts (active /
  // expiring / expired) include only non-archived rows so the active
  // workflow numbers are honest. "archived" is the separate counter
  // that drives the visibility of the Archived chip.
  var c = { all:0, active:0, expiring:0, expired:0, archived:0 };
  (AMC_CONTRACTS||[]).forEach(function(row){
    if (row.is_archived) { c.archived += 1; return; }
    c.all += 1;
    var k = _amcStatusFor(row).key;
    if (c[k] !== undefined) c[k] += 1;
  });
  return c;
}
```

Replace with:

```js
function _amcCountByStatus() {
  // Counts feed the chip badges. "All" + lifecycle counts (active /
  // expiring / expired) include only non-archived, non-long-expired rows
  // so the active workflow numbers are honest. "archived" is the separate
  // counter that drives the visibility of the Archived chip. Long-expired
  // rows aren't counted here — the expired section gets its own count
  // from _amcLongExpiredContracts().length where it needs it.
  var c = { all:0, active:0, expiring:0, expired:0, archived:0 };
  (AMC_CONTRACTS||[]).forEach(function(row){
    if (row.is_archived) { c.archived += 1; return; }
    if (_amcIsLongExpired(row)) return;
    c.all += 1;
    var k = _amcStatusFor(row).key;
    if (c[k] !== undefined) c[k] += 1;
  });
  return c;
}
```

- [ ] **Step 3: Verify with a throwaway Node script (DOM stubbed — the source's `||{}` guards make `getElementById` returning `null` safe)**

Create a scratch file `amc-task2-check.js`:

```js
global.document = { getElementById: function(){ return null; } };
// msGetValues intentionally left undefined so the typeof-guard below
// falls back to [] for region/vendor — matches an unfiltered page load.

function _amcStatusFor(contract) {
  if (!contract || !contract.amc_end_date) return { key:'unknown', label:'—', days:null };
  var today = new Date(); today.setHours(0,0,0,0);
  var end   = new Date(contract.amc_end_date + 'T00:00:00');
  var days  = Math.round((end - today) / 86400000);
  if (days < 0)  return { key:'expired',  label:'Expired',         days:days };
  if (days <= 90) return { key:'expiring', label:'Expiring Soon',  days:days };
  return            { key:'active',   label:'Active',          days:days };
}
var AMC_LONG_EXPIRED_DAYS = 60;
function _amcIsLongExpired(contract) {
  var st = _amcStatusFor(contract);
  return st.key === 'expired' && st.days != null && st.days < -AMC_LONG_EXPIRED_DAYS;
}

function _amcApplyCommonFilters(rows) {
  var search = (((document.getElementById('amc-search')||{}).value)||'').toLowerCase().trim();
  var regions = (typeof msGetValues === 'function') ? msGetValues('amc-filter-region') : [];
  var vendors = (typeof msGetValues === 'function') ? msGetValues('amc-filter-vendor') : [];
  var year    = ((document.getElementById('amc-filter-year')||{}).value)||'';
  if (search) {
    rows = rows.filter(function(c){
      return [c.customer_name, c.git_sales_order, c.partner]
        .some(function(f){ return f && f.toLowerCase().indexOf(search) !== -1; });
    });
  }
  if (regions.length) rows = rows.filter(function(c){ return c.region && regions.indexOf(c.region) !== -1; });
  if (vendors.length) rows = rows.filter(function(c){ return c.vendor && vendors.indexOf(c.vendor) !== -1; });
  if (year)           rows = rows.filter(function(c){ return String(c.booking_year) === String(year); });
  return rows;
}

var _amcStatusFilter = 'all';
function _amcFilteredContracts() {
  var rows;
  if (_amcStatusFilter === 'archived') {
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !!c.is_archived; });
  } else {
    rows = (AMC_CONTRACTS||[]).filter(function(c){ return !c.is_archived && !_amcIsLongExpired(c); });
    if (_amcStatusFilter !== 'all') {
      rows = rows.filter(function(c){ return _amcStatusFor(c).key === _amcStatusFilter; });
    }
  }
  return _amcApplyCommonFilters(rows);
}
function _amcLongExpiredContracts() {
  var rows = (AMC_CONTRACTS||[]).filter(function(c){ return !c.is_archived && _amcIsLongExpired(c); });
  return _amcApplyCommonFilters(rows);
}
function _amcCountByStatus() {
  var c = { all:0, active:0, expiring:0, expired:0, archived:0 };
  (AMC_CONTRACTS||[]).forEach(function(row){
    if (row.is_archived) { c.archived += 1; return; }
    if (_amcIsLongExpired(row)) return;
    c.all += 1;
    var k = _amcStatusFor(row).key;
    if (c[k] !== undefined) c[k] += 1;
  });
  return c;
}

function isoDaysAgo(n) {
  var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0,10);
}
function isoDaysFromNow(n) {
  var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

global.AMC_CONTRACTS = [
  { id:1, customer_name:'Active Co',    amc_value_usd:100, is_archived:false, amc_end_date: isoDaysFromNow(30) },
  { id:2, customer_name:'Recently Exp', amc_value_usd:200, is_archived:false, amc_end_date: isoDaysAgo(30) },
  { id:3, customer_name:'Long Expired', amc_value_usd:300, is_archived:false, amc_end_date: isoDaysAgo(90) },
  { id:4, customer_name:'Archived+Old', amc_value_usd:400, is_archived:true,  amc_end_date: isoDaysAgo(500) }
];

var failed = 0;
function check(label, got, expected) {
  var ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok?'PASS':'FAIL')+' — '+label+': expected '+JSON.stringify(expected)+', got '+JSON.stringify(got));
}

_amcStatusFilter = 'all';
check('All chip ids (excludes id 3, long-expired)', _amcFilteredContracts().map(function(r){return r.id;}), [1,2]);
check('Long-expired section ids', _amcLongExpiredContracts().map(function(r){return r.id;}), [3]);
var counts = _amcCountByStatus();
check('counts.all', counts.all, 2);
check('counts.archived', counts.archived, 1);

_amcStatusFilter = 'archived';
check('Archived chip ids (unaffected by long-expired logic)', _amcFilteredContracts().map(function(r){return r.id;}), [4]);

process.exit(failed ? 1 : 0);
```

Run: `node amc-task2-check.js`
Expected: 5 `PASS` lines, exit code 0. Delete the scratch file when done.

- [ ] **Step 4: Commit (local only — do not push)**

```bash
git add js/features/amc-contracts.js
git commit -m "feat: exclude 60+ day expired AMC contracts from main list filters/counts"
```

---

## Task 3: Render the "Expired AMC Contracts" section

**Files:**
- Modify: `css/styles.css:369` (after `.amc-total-foot`) — add section styles
- Modify: `js/features/amc-contracts.js` — `renderAMCContracts()`; add `_amcExpiredSectionSubtotalHtml()`, `_amcRenderExpiredSection()` after `_amcRenderCards()`

**Interfaces:**
- Consumes: `_amcLongExpiredContracts()`, `_amcFmtUSD()`, `_amcRenderTable()`, `_amcRenderCards()` (all existing/Task 2)
- Produces: `_amcRenderExpiredSection(linksByContract)` → HTML string (`''` if nothing to show); `_amcExpiredSectionSubtotalHtml(rows)` → HTML string

- [ ] **Step 1: Add CSS for the new section**

In `css/styles.css`, find:

```css
.amc-total-foot{font-size:11px;color:#92400E;margin-top:4px;font-style:italic}
```

Replace with:

```css
.amc-total-foot{font-size:11px;color:#92400E;margin-top:4px;font-style:italic}

/* v149: "Expired AMC Contracts (60+ days)" section — sits below the main
   table/cards, separated by a dashed rule rather than its own card so it
   reads as part of the same page, not a competing panel. */
.amc-expired-section{margin-top:22px;padding-top:18px;border-top:1px dashed var(--border)}
.amc-expired-section-title{font-size:14px;font-weight:700;color:var(--navy);margin-bottom:2px}
.amc-expired-section-sub{font-size:12px;color:var(--muted);margin-bottom:10px;font-family:'DM Mono',monospace}
.amc-expired-section-foot{font-family:'DM Sans',sans-serif;font-style:italic;color:#92400E}
```

- [ ] **Step 2: Add the subtotal + section renderer functions**

In `js/features/amc-contracts.js`, find the end of `_amcRenderCards` (the closing of the function, immediately before the `// ── FILTERS` section comment):

```js
      : '')+
    '</div>';
  }).join('') + '</div>';
}

// ── FILTERS ──────────────────────────────────────────────────────
```

Replace with:

```js
      : '')+
    '</div>';
  }).join('') + '</div>';
}

// v149: subtotal line for the expired section — same missing-value
// footnote pattern as _amcRenderTotalCard, just returns a string instead
// of writing to the fixed #amc-total-card element.
function _amcExpiredSectionSubtotalHtml(rows) {
  var n = rows ? rows.length : 0;
  var sum = 0, missing = 0;
  (rows||[]).forEach(function(r){
    var v = r.amc_value_usd;
    if (v === null || v === undefined || v === '' || isNaN(v)) missing++;
    else sum += Number(v);
  });
  var foot = missing > 0
    ? ' <span class="amc-expired-section-foot">('+missing+' excluded, missing value)</span>'
    : '';
  return 'Total Expired Value: '+_amcFmtUSD(sum, true)+' · '+n+' contract'+(n===1?'':'s')+foot;
}

// v149: build the "Expired AMC Contracts (60+ days)" section HTML. Reuses
// the same table/card renderers as the main list — same columns, same
// badge, same manager Edit/Archive actions. Returns '' when there's
// nothing to show so renderAMCContracts doesn't add an empty section.
function _amcRenderExpiredSection(linksByContract) {
  var rows = _amcLongExpiredContracts();
  if (!rows.length) return '';
  var isMobile = window.innerWidth < 768;
  var listHtml = isMobile ? _amcRenderCards(rows, linksByContract) : _amcRenderTable(rows, linksByContract);
  return '<div class="amc-expired-section">'+
    '<div class="amc-expired-section-title">Expired AMC Contracts (60+ days)</div>'+
    '<div class="amc-expired-section-sub">'+_amcExpiredSectionSubtotalHtml(rows)+'</div>'+
    listHtml+
  '</div>';
}

// ── FILTERS ──────────────────────────────────────────────────────
```

- [ ] **Step 3: Wire the section into `renderAMCContracts()`**

Find the full function:

```js
function renderAMCContracts() {
  var loadEl = document.getElementById('amc-load');
  if (loadEl) loadEl.style.display = 'none';
  var content = document.getElementById('amc-content');
  if (!content) return;
  // Lazy multi-select + year-filter wiring on first render
  _amcPopulateFilters();

  var rows = _amcFilteredContracts();
  var counts = _amcCountByStatus();
  _amcRenderTotalCard(rows);

  // Status chip row (lives above the filter bar)
  var chip = function(key, label, count) {
    var active = (_amcStatusFilter === key);
    return '<button class="amc-chip'+(active?' amc-chip-active':'')+' amc-chip-'+key+'" onclick="setAMCStatusFilter(\''+key+'\')">'+
      label+' <span class="amc-chip-count">'+fmtCount(count)+'</span>'+
    '</button>';
  };
  var chipBar =
    '<div class="amc-chip-row">'+
      chip('all',      'All',            counts.all)+
      chip('active',   '🟢 Active',      counts.active)+
      chip('expiring', '🟡 Expiring Soon', counts.expiring)+
      chip('expired',  '🔴 Expired',     counts.expired)+
      // Archived chip only renders if there's at least one archived row
      // — keeps the toolbar clean for fresh installs and after a full
      // restore. Neutral grey to signal "historical, not workflow".
      (counts.archived ? chip('archived', '📦 Archived', counts.archived) : '')+
    '</div>';

  if (!rows.length) {
    content.innerHTML = chipBar + renderEmptyState({
      icon: (counts.all === 0) ? 'file-plus-2' : 'search-x',
      heading: (counts.all === 0) ? 'No AMC contracts yet' : 'No contracts match the current filters',
      sub: (counts.all === 0)
        ? 'Manager-only: click + New Contract to register the first one.'
        : 'Try adjusting the filters or clearing them.',
      btnText: (counts.all === 0 && isManager) ? '+ New Contract' : (counts.all > 0 ? 'Clear filters' : ''),
      btnOnclick: (counts.all === 0 && isManager) ? 'openAMCContractModal()' : (counts.all > 0 ? 'clearAMCFilters()' : '')
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  // Engagement count per contract via the link table
  var linksByContract = {};
  (AMC_CONTRACT_LINKS||[]).forEach(function(l){
    linksByContract[l.contract_id] = (linksByContract[l.contract_id]||0) + 1;
  });

  var isMobile = window.innerWidth < 768;
  var listHtml = isMobile ? _amcRenderCards(rows, linksByContract) : _amcRenderTable(rows, linksByContract);
  content.innerHTML = chipBar + listHtml +
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+counts.all+' contracts · Sorted by end date</div>';
  if (typeof renderIcons === 'function') renderIcons();
}
```

Replace with:

```js
function renderAMCContracts() {
  var loadEl = document.getElementById('amc-load');
  if (loadEl) loadEl.style.display = 'none';
  var content = document.getElementById('amc-content');
  if (!content) return;
  // Lazy multi-select + year-filter wiring on first render
  _amcPopulateFilters();

  var rows = _amcFilteredContracts();
  var counts = _amcCountByStatus();
  _amcRenderTotalCard(rows);

  // Engagement count per contract via the link table — shared by the main
  // list and the expired section below.
  var linksByContract = {};
  (AMC_CONTRACT_LINKS||[]).forEach(function(l){
    linksByContract[l.contract_id] = (linksByContract[l.contract_id]||0) + 1;
  });

  // Status chip row (lives above the filter bar)
  var chip = function(key, label, count) {
    var active = (_amcStatusFilter === key);
    return '<button class="amc-chip'+(active?' amc-chip-active':'')+' amc-chip-'+key+'" onclick="setAMCStatusFilter(\''+key+'\')">'+
      label+' <span class="amc-chip-count">'+fmtCount(count)+'</span>'+
    '</button>';
  };
  var chipBar =
    '<div class="amc-chip-row">'+
      chip('all',      'All',            counts.all)+
      chip('active',   '🟢 Active',      counts.active)+
      chip('expiring', '🟡 Expiring Soon', counts.expiring)+
      chip('expired',  '🔴 Expired',     counts.expired)+
      // Archived chip only renders if there's at least one archived row
      // — keeps the toolbar clean for fresh installs and after a full
      // restore. Neutral grey to signal "historical, not workflow".
      (counts.archived ? chip('archived', '📦 Archived', counts.archived) : '')+
    '</div>';

  // v149: 60+ day expired contracts get their own section below the main
  // list. Independent of the status chip above; hidden while browsing the
  // Archived view (that's a separate historical view already).
  var expiredSectionHtml = (_amcStatusFilter === 'archived') ? '' : _amcRenderExpiredSection(linksByContract);

  if (!rows.length) {
    content.innerHTML = chipBar + renderEmptyState({
      icon: (counts.all === 0) ? 'file-plus-2' : 'search-x',
      heading: (counts.all === 0) ? 'No AMC contracts yet' : 'No contracts match the current filters',
      sub: (counts.all === 0)
        ? 'Manager-only: click + New Contract to register the first one.'
        : 'Try adjusting the filters or clearing them.',
      btnText: (counts.all === 0 && isManager) ? '+ New Contract' : (counts.all > 0 ? 'Clear filters' : ''),
      btnOnclick: (counts.all === 0 && isManager) ? 'openAMCContractModal()' : (counts.all > 0 ? 'clearAMCFilters()' : '')
    }) + expiredSectionHtml;
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  var isMobile = window.innerWidth < 768;
  var listHtml = isMobile ? _amcRenderCards(rows, linksByContract) : _amcRenderTable(rows, linksByContract);
  content.innerHTML = chipBar + listHtml +
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Showing '+rows.length+' of '+counts.all+' contracts · Sorted by end date</div>' +
    expiredSectionHtml;
  if (typeof renderIcons === 'function') renderIcons();
}
```

- [ ] **Step 4: Smoke-check locally (no long-expired data exists yet, so this just confirms nothing broke)**

Open `index.html` directly in a browser (or serve the folder statically — no build step, per `CLAUDE.md` §4), log in as a manager, open the browser DevTools console, and navigate to **Customers & Deals → AMC Contracts**.

Expected:
- Zero errors in the console.
- The page looks exactly as it did before (chips, table/cards, Total AMC Value) — no long-expired test data exists yet, so `_amcRenderExpiredSection` returns `''` and nothing new is visible.
- In the console, `typeof _amcRenderExpiredSection` returns `"function"` and `typeof _amcIsLongExpired` returns `"function"`.

- [ ] **Step 5: Commit (local only — do not push)**

```bash
git add css/styles.css js/features/amc-contracts.js
git commit -m "feat: render Expired AMC Contracts (60+ days) section below the main list"
```

---

## Task 4: Version trio + release notes

**Files:**
- Modify: `sw.js` — `CACHE_VERSION`
- Modify: `js/core/init.js` — `SW_REGISTRATION_URL`
- Modify: `index.html` — Sentry `release`
- Modify: `data/whats-new.json` — append v149 entry

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: nothing consumed by later tasks (mechanical version bump)

- [ ] **Step 1: Bump `sw.js`**

Find:

```js
var CACHE_VERSION = 'netsec-v148';
```

Replace with:

```js
var CACHE_VERSION = 'netsec-v149';
```

- [ ] **Step 2: Bump `js/core/init.js`**

Find:

```js
var SW_REGISTRATION_URL = '/sw.js?v=148';
```

Replace with:

```js
var SW_REGISTRATION_URL = '/sw.js?v=149';
```

- [ ] **Step 3: Bump `index.html`**

Find:

```js
    release: 'netsec-portal@v148',
```

Replace with:

```js
    release: 'netsec-portal@v149',
```

- [ ] **Step 4: Append the whats-new.json entry**

In `data/whats-new.json`, find the closing of the `v148-others-activity-type` item (the last item in the `items` array):

```json
    {
      "id": "v148-others-activity-type",
      "version": "v148",
      "category": "new",
      "title": "\"Others\" activity type for POC and Pre-Sales",
      "body": "Log Session → Activity Type now includes an \"Others\" option for PoC and Pre-Sales-Task sessions, matching every other session type, so you're never stuck without a fitting category."
    }
  ]
}
```

Replace with:

```json
    {
      "id": "v148-others-activity-type",
      "version": "v148",
      "category": "new",
      "title": "\"Others\" activity type for POC and Pre-Sales",
      "body": "Log Session → Activity Type now includes an \"Others\" option for PoC and Pre-Sales-Task sessions, matching every other session type, so you're never stuck without a fitting category."
    },
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

- [ ] **Step 5: Verify all four files agree on v149**

Run:

```bash
grep -n "netsec-v149\|v=149\|netsec-portal@v149\|\"version\": \"v149\"" sw.js js/core/init.js index.html data/whats-new.json
```

Expected: one match per file, all showing `149`.

- [ ] **Step 6: Commit (local only — do not push)**

```bash
git add sw.js js/core/init.js index.html data/whats-new.json
git commit -m "v149: Expired AMC Contracts section (60+ days)"
```

---

## Task 5: Manual regression pass (live/local, no code changes)

Log in as a manager. Navigate to **Customers & Deals → AMC Contracts**. Use the existing **+ New Contract** button for every throwaway contract below — pick any existing customer/vendor already in the dropdowns, tag `Notes` with `v149 QA - safe to delete` so they're identifiable, use `$1` as the value to keep totals easy to eyeball by hand, and use GIT SO values `QA-TEST-149-A` / `-B` / `-C`.

- [ ] **Step 1: Long-expired contract is excluded from the main list and counted in the new section**

Create **Contract A**: Start Date 1 year ago, End Date 65 days ago.

Expected: Contract A does **not** appear anywhere in the main table (not under All, not under 🔴 Expired) and is **not** counted in any chip badge. It **does** appear in the new "Expired AMC Contracts (60+ days)" section below, and the top "Total AMC Value" card does **not** include its $1.

- [ ] **Step 2: Expired-section subtotal is correct**

With only Contract A in the long-expired bucket (from Step 1), confirm the section's "Total Expired Value" line reads `$1.00 · 1 contract`.

- [ ] **Step 3: Recently-expired (≤60 days) contracts stay in the main list**

Create **Contract B**: Start Date 1 year ago, End Date 30 days ago.

Expected: Contract B appears in the main table under the 🔴 Expired chip (and under All), badge reads "Expired · 30d ago". It does **not** appear in the new section.

- [ ] **Step 4: Renewal — editing dates moves a contract back automatically**

Edit Contract A: change End Date to 30 days from today. Save.

Expected: Contract A disappears from the "Expired AMC Contracts" section (or the section disappears entirely if it was the only row there) and reappears in the main table (under 🟡 Expiring Soon or 🟢 Active depending on the exact day count), and its $1 is back in the top "Total AMC Value" card. No "Status" field was touched — only the dates.

- [ ] **Step 5: Archived contracts never appear in the new section**

Create **Contract C**: Start Date 1 year ago, End Date 90 days ago (long-expired). Confirm it shows in the new section. Then click **Archive** on Contract C (from either the main flow or the new section's row — same Edit/Archive actions).

Expected: Contract C disappears from the new section immediately (archived wins) and appears only under the 📦 Archived chip. At this point Contract A is Active (renewed in Step 4) and Contract B is only 30 days expired (Step 3, not long-expired) — neither belongs in the long-expired bucket, so the "Expired AMC Contracts" section should now render nothing at all (no long-expired, non-archived rows remain).

- [ ] **Step 6: Filters apply to both the main list and the new section**

Re-lapse Contract A (edit End Date back to 65 days ago) so there's a long-expired row again. In the search box, type a string that matches Contract A's customer name.

Expected: both the main list (if Contract A's customer also has other matching rows) and the "Expired AMC Contracts" section narrow to match the search term. Clear the search box; try the Region and Vendor filters the same way if Contract A's region/vendor are distinct enough to test narrowing. Clear all filters when done (`Clear` button).

- [ ] **Step 7: The new section is independent of the status chip**

With Contract A still long-expired, click through the **All**, **Active**, **Expiring Soon**, and **Expired** chips in turn.

Expected: the "Expired AMC Contracts" section stays visible and unchanged under every one of those four chips — it is not chip-driven.

- [ ] **Step 8: The new section is hidden while browsing Archived**

Click the **📦 Archived** chip.

Expected: the "Expired AMC Contracts" section is not rendered at all while this chip is active (Contract C shows in the main archived table instead, if not yet permanently deleted).

- [ ] **Step 9: Mobile layout**

Resize the browser window to under 768px wide (or open DevTools device toolbar). Confirm the new section renders as stacked cards (same style as the main list's mobile view), not a table.

- [ ] **Step 10: Clean up all QA data**

From the **📦 Archived** chip, permanently delete Contract C (type-the-name confirmation required). Archive Contract A and Contract B, then permanently delete both the same way. Confirm all three QA contracts are gone and the AMC Contracts screen returns to its pre-test state (same counts and Total AMC Value as before Step 1).

---

## Task 6: Push and verify live deploy

**Files:** none (deploy step only)

- [ ] **Step 1: Push to origin/master**

```bash
git push origin master
```

- [ ] **Step 2: Poll the live `sw.js` for the new version**

```bash
i=0; until curl -s "https://netsec-portal.pages.dev/sw.js?cb=$(date +%s)" | grep -q "netsec-v149"; do i=$((i+1)); if [ $i -ge 12 ]; then echo "TIMEOUT"; break; fi; sleep 10; done; curl -s "https://netsec-portal.pages.dev/sw.js?cb=$(date +%s)" | grep CACHE_VERSION
```

Expected: `var CACHE_VERSION = 'netsec-v149';` within ~2 minutes.

- [ ] **Step 3: If it times out, check the Cloudflare Pages build directly**

A prior deploy in this repo (v148) hit a transient `clone_repo` timeout connecting to GitHub — unrelated to the code, resolved by retrying the same deployment rather than pushing again. If Step 2 times out, check the GitHub check-run status for the pushed commit:

```bash
gh api repos/Forzateks/Netsec-portal/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[] | {name, status, conclusion}'
```

If `conclusion` is `failure`, use the Cloudflare Pages MCP tool (`mcp__plugin_cloudflare_cloudflare-api__execute` or equivalent) to `POST /accounts/{account_id}/pages/projects/netsec-portal/deployments/{deployment_id}/retry` for that deployment, then repeat Step 2.

- [ ] **Step 4: Manual smoke check on the live site**

Log in to https://netsec-portal.pages.dev/ as a manager, open AMC Contracts, confirm the screen loads with no console errors and no long-expired test data remains (Task 5 Step 10 cleaned it up) — the page should look identical to before this feature shipped, since real long-expired contracts (if any exist in production) are the only thing that will now show the new section.
