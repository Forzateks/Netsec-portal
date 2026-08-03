# AMC Contracts — Graphs Tab (v155)

**Date:** 2026-08-03
**Status:** Approved design, ready for implementation planning
**Target version:** v155 (current shell: v154)

---

## 1. Goal

Give AMC Contracts the same kind of revenue bar chart that Professional Services
got in v150, but bucketed by the year of `amc_start_date` instead of a year
integer column — and put it on its own sub-tab rather than inline above the list.

**Done looks like:** a manager opens **AMC Contracts → Graphs** in the sidebar and
sees a single bar chart, "AMC Value by Year (Start Date)", with one bar per
calendar year showing total contracted USD (and derived AED) for contracts that
started that year.

---

## 2. Scope

### In scope
- One new sidebar sub-item and one new screen section under `screen-amc`.
- One chart: total `amc_value_usd` grouped by year of `amc_start_date`.
- Version trio bump + `whats-new.json` entry.

### Explicitly out of scope (considered and dropped)
- Contract-count-by-year chart.
- Value-by-region breakdown.
- Renewal-pipeline-by-month chart (would use `amc_end_date`, not start date).
- Any filter controls on the Graphs tab — the chart is fixed and company-wide,
  matching the PS revenue chart's deliberate independence from its page filters.
- Any change to the existing PS revenue chart.

---

## 3. Backend

**No schema change required.** Both columns already exist on `amc_contracts`
(`docs/schema.sql:243`):

| Column | Type | Notes |
|---|---|---|
| `amc_start_date` | `date NOT NULL` | Every contract has one — no "missing date" bucket needed in practice |
| `amc_value_usd` | `numeric(12,2)` | **Nullable** — rows without a value are excluded and footnoted |
| `is_archived` | `boolean NOT NULL DEFAULT false` | Archived rows excluded from the chart |

No new table, so **no `BACKUP_TABLES` change** in `js/features/dashboard.js`.
No SQL to run in the Supabase SQL Editor for this change.

---

## 4. Implementation approach

**Self-contained inline SVG inside `js/features/amc-contracts.js`.** No shared
charting abstraction, no charting library, and no edits to `js/features/ps-deals.js`.

Rationale: the codebase already establishes hand-rolled per-feature SVG as the
pattern — `buildPieChart()` in `js/features/projects.js:1862` came first, and
`_psRenderRevenueChart()` (`js/features/ps-deals.js:286`) copied the *technique*
rather than sharing the code. Two call sites do not justify an abstraction, and
extracting a shared helper would mean editing working, shipped v150 revenue-chart
code for zero user-visible benefit — against the surgical-changes rule in
CLAUDE.md §12.6.

---

## 5. Sub-tab wiring

### 5.1 Sidebar (`index.html`, ~line 349)

A third sub-item inside `sbg-amc`, placed **between** Contracts and Activity Log:

```html
<div class="sidebar-subitem" id="sbi-amc-graphs" onclick="navigateSub('amc','graphs')">
  <i data-lucide="bar-chart-3" class="sidebar-subicon"></i>Graphs
</div>
```

`bar-chart-3` is already used elsewhere in `index.html`, so the icon is known-good
in the bundled Lucide version.

### 5.2 Screen section (`index.html`, ~line 1536)

New block between `#amctab-contracts` and `#amctab-log`, following the same
`<!-- ── NAME TAB ── -->` divider convention as its neighbours:

```html
<!-- ── GRAPHS TAB ── -->
<div id="amctab-graphs" style="display:none">
  <div class="card">
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">AMC Value by Year (Start Date)</div>
      <button class="btn btn-sm btn-ghost" onclick="loadAMCGraphs()">↻ Refresh</button>
    </div>
    <div id="amc-graphs-content">
      <div class="loading"><div class="spinner"></div>Loading...</div>
    </div>
  </div>
</div>
```

Header + refresh button mirror `#amctab-log` exactly.

### 5.3 Tab switcher (`js/features/amc-contracts.js:832`)

```js
function showAMCTab(tab) {
  ['contracts','graphs','log'].forEach(function(t) {
    var el = document.getElementById('amctab-'+t);
    if (el) el.style.display = (t === tab) ? 'block' : 'none';
  });
  if (tab === 'contracts') loadAMCContracts();
  if (tab === 'graphs')    loadAMCGraphs();
  if (tab === 'log')       loadAMCActivityLog();
  setSidebarSubActive('amc', tab);
}
```

**No change needed in `js/core/navigation.js`** — `navigateSub()` already routes
any `amc` sub-tab straight through `showAMCTab()` (line 181), and `showScreen('amc')`
still defaults to `'contracts'` (line 131).

---

## 6. Data loading — `loadAMCGraphs()`

The Graphs tab performs its **own** fetch rather than reading the `AMC_CONTRACTS`
in-memory cache. Two reasons:

1. The tab works when a user lands on it directly (deep link, or clicking Graphs
   before ever opening Contracts) — the cache would be empty in that case.
2. Numbers are always fresh after a contract edit, with no cache-invalidation
   coupling between the two tabs.

Cost is negligible (dozens of contracts, three columns). The shape mirrors
`loadAMCActivityLog()`, which is the established per-tab-loader pattern in this file.

```js
async function loadAMCGraphs() {
  var el = document.getElementById('amc-graphs-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  var res = await sb.from('amc_contracts')
    .select('amc_start_date,amc_value_usd,is_archived');
  if (res.error) {
    el.innerHTML = '<div class="alert alert-error show">Error: '+res.error.message+'</div>';
    return;
  }
  _amcRenderValueChart(res.data || []);
}
```

The Supabase 1000-row cap is not a concern here (dozens of contracts expected),
consistent with the reasoning already documented in `loadAMCContracts()`.

---

## 7. Aggregation — `_amcValueByStartYear(rows)`

Pure function: takes rows, returns `{ years: [{year, usd}], missingValue: n }`.
No DOM access, so it can be reasoned about and eyeballed independently of rendering.

### Inclusion rule
Every contract where `is_archived` is falsy counts — **Active, Expiring Soon,
Expired, and 60+ day long-expired alike**. A start-date chart is a historical
record: the 2024 bar must stay at its value permanently, not shrink as those
contracts lapse. Archived is the app's soft-delete, so archived rows stay out.

### Year extraction
Use `String(c.amc_start_date).slice(0,4)` and validate with `/^\d{4}$/`.

**Do not use `new Date(...).getFullYear()`.** A Postgres `date` arrives as
`'YYYY-MM-DD'`, which JS parses as UTC midnight; a 1-January start date would fall
into the previous year under a negative UTC offset. String slicing cannot drift.
(`_amcStatusFor()` already dodges the same trap with its `+ 'T00:00:00'` suffix,
but slicing is simpler when only the year is needed.)

Rows whose date fails the `/^\d{4}$/` check are skipped defensively. The column is
`NOT NULL`, so this should never fire — it exists so a malformed row can't produce
a `NaN` bar.

### Missing values
A row with `amc_value_usd` null/blank/`NaN` is excluded from every bucket and
counted into `missingValue`, then footnoted. This mirrors the existing Total AMC
Value card (`_amcRenderTotalCard`, line 244), including its wording.

### Continuous year axis
The returned `years` array spans **every** year from min to max, inserting
`{year: Y, usd: 0}` for years with no contracts.

This is a deliberate divergence from the PS chart, which only emits years that
have data. With a real date axis, drawing 2023 next to 2026 implies they are
consecutive and misreads as a smooth trend. Zero bars make the gap visible.

**Span guard:** gap-filling applies only while `maxYear - minYear <= 20`. Beyond
that, fall back to emitting just the years that have data. This bounds the damage
from a single fat-fingered date — a contract typo'd as `2202` would otherwise
generate ~180 bars and a 17,000px-wide SVG. The guard is not a display preference;
it is protection against one bad row rendering the tab unusable.

---

## 8. Render — `_amcRenderValueChart(rows)`

Writes into `#amc-graphs-content`. Visually matched to `_psRenderRevenueChart()`
so the two commercial pages read as one system.

### Empty state
When `years` is empty, render via the shared helper rather than PS's plain grey div
(`renderEmptyState()` is the newer convention already used by `loadAMCActivityLog`):

```js
renderEmptyState({
  icon: 'bar-chart-3',
  heading: 'No AMC value to chart yet',
  sub: 'Once contracts with a value are recorded, total AMC value per start year shows up here.'
});
```

Call `renderIcons()` afterwards so the Lucide icon materialises.

### Geometry (identical to the PS chart)

| Constant | Value |
|---|---|
| `barW` | 70 |
| `gap` | 30 |
| `padL` / `padR` | 30 / 30 |
| `padTop` | 50 |
| `barAreaH` | 140 |
| `padBottom` | 34 |

`svgW = padL + padR + n*barW + (n-1)*gap`, `svgH = padTop + barAreaH + padBottom`.
Bar height scales against the max year value; a non-zero value that would round to
under 2px is clamped to 2px so small years stay visible. Zero-value gap years get
height 0 but still render their year label and a `$0` figure.

### Styling
- Bars: `fill="#00A0D2"` (teal), `rx="4"`
- USD label above bar: DM Mono, 14px, weight 700, `#0A1F5C`
- AED label beneath it: DM Mono, 10px, `#6b7280`
- Year label below axis: DM Sans, 12px, weight 600, `#0A1F5C`

Values formatted with `fmtUsd(usd, false)` and `fmtAed(usdToAed(usd), false)` —
the `false` suppresses cents, matching the PS chart. Never persist AED (CLAUDE.md §10).

### Mobile
The `<svg>` sits inside a `<div style="overflow-x:auto">` so a wide multi-year
chart scrolls horizontally instead of squashing, exactly as PS does.

### Footnote
When `missingValue > 0`:

```
N contracts excluded — no value set
```

Rendered in the same amber italic 11px treatment as the PS chart's exclusion note.

---

## 9. Versioning (CLAUDE.md §5)

`index.html` markup changes, so all four must move together **v154 → v155**:

1. `sw.js` → `CACHE_VERSION = 'netsec-v155'`
2. `js/core/init.js` → `SW_REGISTRATION_URL = '/sw.js?v=155'`
3. `index.html` → Sentry `release: 'netsec-portal@v155'`
4. `data/whats-new.json` → new `"version": "v155"` entry describing the Graphs tab

---

## 10. Manual test checklist

No automated tests exist in this repo (CLAUDE.md §11), so verify by hand before push:

- [ ] No contracts at all → empty state renders with its icon
- [ ] All contracts started in one year → single bar, correct total
- [ ] Contracts in 2023 and 2026, none between → 2024 and 2025 appear as zero bars
- [ ] Contract with an absurd start year (e.g. 2202) → span guard trips, chart stays usable
- [ ] Contract with null `amc_value_usd` → excluded, footnote shows correct count
- [ ] Archived contract → excluded from its year's total
- [ ] Expired and 60+ day long-expired contracts → still included
- [ ] Contract starting 1-Jan → lands in the correct year (timezone regression check)
- [ ] Click Graphs without visiting Contracts first → chart loads
- [ ] Refresh button re-fetches
- [ ] Contracts and Activity Log tabs still switch correctly; sidebar highlight follows
- [ ] Mobile (≤640px) → chart scrolls horizontally, page body does not
- [ ] Console clean; no `console.log` left behind

---

## 11. Files touched

| File | Change |
|---|---|
| `index.html` | Sidebar sub-item; `#amctab-graphs` section; Sentry release |
| `js/features/amc-contracts.js` | `showAMCTab()` array + dispatch; `loadAMCGraphs()`; `_amcValueByStartYear()`; `_amcRenderValueChart()` |
| `sw.js` | `CACHE_VERSION` |
| `js/core/init.js` | `SW_REGISTRATION_URL` |
| `data/whats-new.json` | v155 entry |

No CSS changes — all styling is inline in the SVG plus existing `.card` /
`.loading` / `.alert` classes.

---

## 12. Noted, not changed

`_amcLastLoaded` (`js/features/amc-contracts.js:14`) is assigned in
`loadAMCContracts()` but never read anywhere in the codebase — dead state.
Flagged rather than removed, per CLAUDE.md §12.6.
