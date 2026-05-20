# RLS Smoke Tests

Process-discipline checklist for any change that touches an RLS policy,
a trigger that gates manager-only columns, or a new manager-only column
on an existing table.

## Why this exists

v74 shipped a `certificates.is_gulfit_relevant` toggle that returned
`204 No Content` from the API but never actually persisted. Root cause
was a stale UPDATE policy that silently rejected the row match. The bug
wasn't caught for ~24 hours because the PATCH "succeeded" — no error
surfaced to the client.

These tests catch that specific class of silent failure plus the
complementary one: a column that should be manager-only but accepts
employee writes because a trigger's revert-list is missing it.

## When to run

- After any `CREATE POLICY` / `DROP POLICY` / `ALTER POLICY` on a table
  that has manager-only columns
- After adding a column to a table whose write-protection lives in a
  `BEFORE UPDATE` trigger (the new column needs to join the trigger's
  revert list)
- After any `CREATE OR REPLACE FUNCTION` on a security-related trigger

Cost: ~2 minutes. Run both tests; both should pass before the change is
considered shipped.

## Test A — Manager can edit any cert

**Login as the manager (Venkatesan).** Open DevTools console on the
deployed app. Pick a certificate ID that the manager does NOT own (the
manager owns zero certs today, so any cert id works).

```js
const r = await sb.from('certificates')
  .update({ is_gulfit_relevant: true })
  .eq('id', /* not-own cert id */)
  .select();
console.log('Rows:', r.data?.length, 'Error:', r.error);
```

- **Pass:** `Rows: 1`, the returned row shows `is_gulfit_relevant: true`,
  `Error: null`.
- **Silent fail signature:** `Rows: 0`, `Error: null`. Means the UPDATE
  policy's `USING` clause matched zero rows. The PATCH succeeded at the
  API layer but persisted nothing. This is the v74 bug pattern.

Roll back the test write after passing:

```js
await sb.from('certificates').update({ is_gulfit_relevant: false }).eq('id', /* same id */);
```

## Test B — Employee cannot archive an engagement

**Login as a non-manager employee (Ahmed or Salman).** Open DevTools
console. Pick any engagement id.

```js
const r = await sb.from('engagements')
  .update({ is_archived: true, archived_at: new Date().toISOString() })
  .eq('id', /* test id */)
  .select();
console.log('Rows:', r.data, 'Error:', r.error);
```

Two acceptable pass shapes:

- **Trigger revert (current pattern):** `r.data` returns the row but
  `is_archived` stays `false` and `archived_at` stays `null`. The trigger
  silently reverted the manager-only columns. `Error: null`.
- **Policy rejection:** `r.error` is non-null with a message indicating
  the row violated the UPDATE WITH CHECK clause. Also acceptable.

- **Bug signature:** `r.data` returns the row with `is_archived: true`
  and `archived_at` populated. The defense in depth is broken — direct
  API call bypassed the UI gate.

If bug confirmed, restore immediately as manager:

```js
await sb.from('engagements')
  .update({ is_archived: false, archived_at: null })
  .eq('id', /* same id */);
```

## When you add a new manager-only column

Before declaring the change shipped:

1. If the table uses a `BEFORE UPDATE` trigger to enforce write
   permissions (currently only `engagements`):
   `pg_get_functiondef(oid)` on the trigger function and confirm the
   new column appears in the revert list.
2. If the table uses a per-row UPDATE policy
   (currently `certificates`): confirm the UPDATE policy `USING` matches
   the manager via `is_manager_user()` OR via row ownership.
3. Run Test A (or its analog for the new column/table) as the manager.
4. Run Test B (or its analog) as a non-manager.

## History

- v74 — shipped certificates UPDATE bug.
- v76 — added these tests after diagnosis. Two RLS fixes shipped in the
  same migration: certificate UPDATE policy expanded to manager-or-owner,
  engagement trigger revert list extended to include `is_archived` +
  `archived_at`.
