# Professional Services — Revenue by Year Chart

**Date:** 2026-07-28
**Status:** Approved, pending implementation
**Area:** `js/features/ps-deals.js`, `index.html` (Professional Services screen only), `css/styles.css`

## Problem

The Professional Services deals register (`Customers & Deals → Professional
Services`) lists every deal in a table/card view with filters, but there's no
way to see revenue trends over time at a glance — a manager has to mentally
sum "Final" values across dozens of rows to answer "how much did we book in
2026 vs 2025?"

## Goal

Add an always-visible "Revenue by Year" bar chart to the Professional
Services screen: one bar per year, showing total awarded deal value in both
USD and AED.

## Non-goals

- No new database column or migration — uses the existing `final_ps_value_usd`,
  `awarded_year`, and `status` columns on `ps_deals`.
- No changes to the existing table, filters, or chip row below it.
- No currency toggle — both USD and AED show together on every bar.
- No cross-screen reuse — this is specific to the PS Deals screen; not a
  generic charting component for other pages (YAGNI — no other screen has
  asked for this yet).
- Does not respond to the page's search/Region/Client/Year filters — it's a
  fixed company-wide figure, not a filtered view.

## Design

### 1. Data: `_psYearlyRevenue()`

New function in `js/features/ps-deals.js`. Filters `PS_DEALS` to:
- `is_archived` is falsy, AND
- `status` is one of `won`, `in_progress`, `completed` (deals that actually
  closed — excludes `quoted` since it hasn't happened yet, and `lost`/
  `cancelled` since they never happened)

Groups the remaining rows by `awarded_year` and sums `final_ps_value_usd`
per year. Rows matching the status filter above but with a null/blank
`awarded_year` are excluded from every year bucket and counted separately
(`excludedCount`) — mirrors the existing "N excluded, missing value"
footnote pattern already used by `_amcRenderTotalCard()` in
`js/features/amc-contracts.js`.

Returns:
```js
{
  years: [ { year: 2024, usd: 31000 }, { year: 2025, usd: 58200 }, ... ], // sorted ascending by year
  excludedCount: 0 // deals that qualified by status but have no awarded_year
}
```

Always computed from the full `PS_DEALS` array — never from
`_psFilteredDeals()`. It is independent of the search box and Region/
Client/Year filter dropdowns, and independent of `_psStatusFilter` (the
status chip row below it).

### 2. Rendering: `_psRenderRevenueChart()`

New function in `js/features/ps-deals.js`. Builds a hand-rolled inline SVG
bar chart — the same technique the codebase already uses for
`buildPieChart()` in `js/features/projects.js` (no charting library; matches
the "no framework, no build step" constraint in `CLAUDE.md` §2).

- One vertical bar per year in `years`, left to right, ascending by year.
- Bar height scales proportionally to the tallest year's `usd` value.
- Each bar is labeled with its USD value in bold directly above the bar
  (`fmtUsd()` or equivalent formatting already used elsewhere in this file —
  see `_psUsdCell()`), and its AED equivalent in smaller muted text beneath
  the USD label, using the existing `usdToAed()` / `fmtAed()` helpers — the
  same USD-bold/AED-muted pairing already used by `_psUsdCell()` and the PS
  deal cards.
- The year number is labeled below each bar's baseline.
- If `excludedCount > 0`, a small footnote below the chart: "N deal(s)
  excluded — no awarded year set" (same tone/placement as the AMC total
  card's missing-value footnote).
- Empty state (`years.length === 0`): a simple centered "No revenue recorded
  yet" message, matching `buildPieChart()`'s existing "No data" fallback —
  not an empty chart shell.
- Single-year case: renders one bar, no special-casing needed.

Writes its HTML into a new fixed DOM element `#ps-revenue-chart` (see below)
— this function does not go through `renderPsDeals()`'s `content.innerHTML`
assembly, because the chart doesn't change when filters/search change.

### 3. Placement and lifecycle

New fixed `<div id="ps-revenue-chart"></div>` added to `index.html`, inside
`#screen-psdeals`, between the existing filter-bar `.card` (ends around
index.html:1542) and the `#ps-load` / `#ps-content` elements (index.html:1544-1545)
— the same visual slot the AMC Contracts page uses for its Total Value card,
for consistency across the "Customers & Deals" section.

`_psRenderRevenueChart()` is called once from `loadPsDeals()` (in
`js/features/ps-deals.js`), immediately after `PS_DEALS = dRes.data || [];`
and alongside the existing `_psPopulateFilters(); renderPsDeals();` calls —
not from `renderPsDeals()` itself, since re-running an SVG rebuild on every
keystroke in the search box would be wasted work for a chart that never
changes based on those filters. Any deal create/edit/archive/restore/delete
already calls `loadPsDeals()` to refresh the list, so the chart picks up
changes automatically on the same refresh cycle — no separate wiring needed.

### 4. CSS

`_psRenderRevenueChart()` follows `buildPieChart()`'s existing convention:
styling is inlined directly in the returned HTML/SVG string (as `style="..."`
attributes) rather than new dedicated CSS classes — that's how
`buildPieChart()` already does it, and matching it keeps the two chart
functions consistent with each other. The only actual `css/styles.css`
addition is reusing the existing generic `.card` class (already used by the
filter-bar's own `<div class="card">`) as the chart's outer wrapper — no new
CSS classes are added. Colors/fonts use the same tokens the rest of the file
already references: `var(--navy)` for the bold USD figures, `var(--muted)`
for the AED sub-labels, `DM Mono` for both numeric figures (matching
`_psUsdCell()`), `DM Sans` for the year labels.

## Data flow summary

```
loadPsDeals()
  → PS_DEALS (all rows, incl. archived + every status)
  → _psPopulateFilters()
  → _psRenderRevenueChart()      // NEW — independent of filters/chips
      → _psYearlyRevenue()       // NEW — status ∈ {won,in_progress,completed}, non-archived, grouped by awarded_year
      → writes to #ps-revenue-chart
  → renderPsDeals()              // unchanged except it no longer needs to touch the chart
```

## Testing

Manual — no automated tests in this repo (`docs/testing/`).

1. A deal with status `won`, `awarded_year` 2026, `final_ps_value_usd` 20000
   contributes to the 2026 bar; a `quoted` deal with the same year does not.
2. A `lost` or `cancelled` deal never appears in any bar, regardless of
   `awarded_year` or `final_ps_value_usd`.
3. A `won`/`in_progress`/`completed` deal with no `awarded_year` set is
   excluded from every bar and bumps the footnote's excluded count by one.
4. An archived deal (any status) never contributes to any bar.
5. Bars render left-to-right in ascending year order; tallest bar corresponds
   to the year with the highest summed `final_ps_value_usd`.
6. Each bar shows both a USD figure (bold) and an AED figure (muted,
   directly derived via `usdToAed()` — never a separately stored value).
7. Typing in the search box or changing Region/Client/Year filters does not
   change the chart, only the table below it.
8. Zero qualifying deals → "No revenue recorded yet" message, not an empty
   chart.
9. Creating, editing, archiving, or restoring a deal refreshes the chart on
   the same cycle as the table (via `loadPsDeals()`), with no separate
   manual refresh needed.
