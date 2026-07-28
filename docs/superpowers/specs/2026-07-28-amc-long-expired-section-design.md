# AMC Contracts — 60+ Day Expired Section

**Date:** 2026-07-28
**Status:** Approved, pending implementation
**Area:** `js/features/amc-contracts.js`, `css/styles.css` (AMC contracts screen only)

## Problem

The AMC Contracts screen (`Customers & Deals → AMC Contracts`) currently derives
status purely from `amc_end_date`: Active / Expiring Soon (≤90 days out) / Expired
(any number of days past due). A contract that expired 2 days ago and one that
expired 2 years ago both sit in the same "Expired" bucket, mixed into the main
table, and both still count toward the "Total AMC Value" card under the default
"All" chip. Old, dead contracts accumulate and clutter the primary working view
and inflate the headline value figure.

## Goal

Contracts that have been expired for **more than 60 days** move out of the main
list into a separate, always-visible "Expired AMC Contracts" section below the
main table. Renewing a contract (editing its dates) moves it back automatically.
The Total AMC Value card should reflect only the current book — i.e. it should
drop when a contract lapses past 60 days and rise again when it's renewed.

## Non-goals

- No new database column, no migration, no schema change.
- No change to the existing `is_archived` soft-delete workflow — Archive/Restore/
  Permanently Delete behave exactly as they do today, independently of this change.
- No change to the 90-day "Expiring Soon" threshold.
- No manual "Status" override field — status stays 100% date-derived.

## Design

### 1. Threshold & routing logic

Add a constant:

```js
var AMC_LONG_EXPIRED_DAYS = 60;
```

`_amcStatusFor()` is unchanged (still returns `active` / `expiring` / `expired` /
`unknown` based on `amc_end_date`, with `days` = days until end date, negative
once past due).

A new predicate determines section routing without changing the status key:

```js
function _amcIsLongExpired(contract) {
  var st = _amcStatusFor(contract);
  return st.key === 'expired' && st.days != null && st.days < -AMC_LONG_EXPIRED_DAYS;
}
```

- **Future end date** → Active / Expiring Soon, unchanged, stays in main list.
- **Expired 1–60 days** (`-60 <= days < 0`) → unchanged, stays in main list under
  the existing 🔴 Expired chip.
- **Expired more than 60 days** (`days < -60`, i.e. day 61 past due onward) →
  excluded from the main list's `All` / `Active` / `Expiring Soon` / `Expired`
  chip buckets and counts; appears only in the new bottom section. Referred to
  as "60+ days" in the UI as user-friendly shorthand for this same rule.
- **Archived** (`is_archived = true`) → unaffected either way. Archive is manual
  and always wins — an archived contract never appears in the new section, no
  matter how expired its dates are. `_amcFilteredContracts()` already splits
  archived vs. non-archived before any status logic runs; that split is
  untouched.

`_amcFilteredContracts()` (used for the main table) additionally excludes rows
where `_amcIsLongExpired(c)` is true, for every non-archived chip (`all`,
`active`, `expiring`, `expired`).

### 2. Renewal workflow

No new field. A manager renews a contract the same way they edit any contract
today: click Edit on the row (available in the new section same as the main
table), update Start/End Date to the new period, Save. On next render,
`_amcStatusFor` recomputes from the new `amc_end_date`; if it's now in the
future (or within 60 days past-due), the contract disappears from the bottom
section and reappears in the main list + Total AMC Value automatically.

### 3. New "Expired AMC Contracts" section

Rendered by `renderAMCContracts()`, appended after the main table/cards and
before the "Showing X of Y" footer line — but only when:
- `_amcStatusFilter !== 'archived'` (hidden while browsing the Archived view —
  that's a separate historical view and mixing it with "currently lapsed but
  not archived" would be confusing), and
- there is at least one row after filtering (see below) — otherwise it renders
  nothing (no empty-state card clutter).

Row source: `_amcLongExpiredContracts()` — same search box + Region/Vendor/Year
filter predicates as `_amcFilteredContracts()` (extracted into a shared helper
so the two don't drift), restricted to non-archived rows where
`_amcIsLongExpired(c)` is true. It is **independent of `_amcStatusFilter`** —
it doesn't have its own chip and stays visible regardless of which of
All/Active/Expiring/Expired is currently selected above.

Rendering: reuses the existing `_amcRenderTable` (desktop, ≥768px) /
`_amcRenderCards` (mobile) functions as-is — same columns, same red
"Expired · Nd ago" badge (via the existing `_amcBadge`/`amc-badge-expired`
styling — no new badge variant), same manager Edit/Archive icon actions. Wrapped
in its own titled card:

```
Expired AMC Contracts (60+ days)
Total Expired Value: $21,250 · 2 contracts
[table/cards]
```

The subtotal line reuses `_amcFmtUSD` the same way the top Total AMC Value card
does (sum `amc_value_usd` across the section's rows, footnote if any are missing
a value — mirroring `_amcRenderTotalCard`'s existing missing-value handling).

### 4. Total AMC Value card

No logic change to `_amcRenderTotalCard()` itself — it still sums whatever
`rows` array `renderAMCContracts()` passes it (the main table's filtered rows).
Because those rows now exclude long-expired contracts under every chip, the
card automatically reflects only the current book: it drops the moment a
contract crosses 60 days past due, and rises again once that contract is
renewed and reappears in the main rows.

## Data flow summary

```
loadAMCContracts()
  → AMC_CONTRACTS (all rows, incl. archived + expired-any-duration)
  → renderAMCContracts()
      → _amcFilteredContracts()        // main table: excludes archived + long-expired
          → _amcRenderTotalCard(rows)  // sums main table rows only
          → chip bar (counts exclude long-expired)
          → _amcRenderTable/_amcRenderCards(rows)
      → _amcLongExpiredContracts()     // bottom section: non-archived + long-expired only,
                                        // same search/region/vendor/year filters
          → subtotal line
          → _amcRenderTable/_amcRenderCards(rows)   // reused as-is
```

## Testing

Manual — no automated tests in this repo (`docs/testing/`).

1. Seed/pick a contract with `amc_end_date` 61+ days in the past, not archived.
   Confirm: absent from All/Active/Expiring/Expired chip counts and the main
   table; present in the new "Expired AMC Contracts" section; Total AMC Value
   excludes its value; the section's own subtotal includes it.
2. Edit that contract's End Date to a future date. Save. Confirm: it disappears
   from the bottom section and reappears in the main list (Active or Expiring
   Soon as appropriate) and back in Total AMC Value.
3. A contract expired 30 days ago (inside the 60-day window) stays in the main
   list under the Expired chip, not in the new section.
4. Archive a long-expired (61+ day) contract. Confirm it disappears from the
   new section (archived wins) and only shows under the Archived chip.
5. Search box / Region / Vendor / Year filters narrow both the main table and
   the new section consistently.
6. Switch between chips (All/Active/Expiring/Expired) — the new section stays
   visible and unchanged throughout (it's not chip-driven).
7. Browsing the Archived chip hides the new section entirely.
8. Mobile width (<768px): new section renders as cards via `_amcRenderCards`,
   same as the main list.
9. No long-expired contracts exist: section doesn't render at all.
