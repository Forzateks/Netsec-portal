# Disaster Recovery Runbook

**Purpose:** restore the NetSec Portal database from a Full Backup .zip after total Supabase project loss (project deleted, region outage, account compromise, etc.).

**Audience:** Mohammed Nasif / Venkatesan / whoever has the GitHub repo + Supabase billing access.

**Prerequisites:**

- Access to the GitHub repo (`Forzateks/Netsec-portal`).
- A Supabase account that can create a new project.
- A recent **Full Backup** .zip — generated from **Admin Tools → Reports & Backup → Full Backup (Excel + SQL .zip)**.
- The schema. See _Step 2_ below — if the live project is still reachable, dump it now and check in `docs/schema.sql`; otherwise you'll rebuild schema from migration history (slower).

---

## What's in the backup .zip

Every Full Backup contains three files:

| File | Purpose |
|---|---|
| `netsec-backup-<DATE>.xlsx` | Every table as a separate sheet. Human-readable. Use this to eyeball data before restoring, or to extract a single row/value when the DB is intact. |
| `netsec-backup-<DATE>.sql` | Data-only INSERT statements for all 23 tables, in FK-safe order, wrapped in `BEGIN`/`COMMIT`. **This is what you apply during recovery.** |
| `README.txt` | One-page summary: when it was generated, table count, row count, pointer to this runbook. |

The backup is **data-only**. The schema (CREATE TABLE statements, RLS policies, functions, triggers) is **not** in the .zip — see Step 2.

---

## Tables covered by the backup

23 tables, in restore order (parents before children):

1. `user_profiles`
2. `customers`
3. `vendors`
4. `product_lines`
5. `engagements`
6. `engagement_milestones`
7. `amc_contracts`
8. `amc_contract_engagements`
9. `ps_deals`
10. `ps_milestones`
11. `unified_sessions`
12. `ot_sessions`
13. `annual_leave`
14. `leave_requests`
15. `comp_off_register`
16. `comp_off_requests`
17. `inventory`
18. `inventory_activity_log`
19. `certificates`
20. `employee_skills`
21. `kb_articles`
22. `notifications`
23. `dashboard_alert_snoozes`

`auth.users` is **not** in the backup — it's owned by Supabase Auth. See Step 6 for re-creating users.

---

## Restoration procedure

### Step 1 — Take a fresh backup of the live project (if reachable)

If the existing project is still up at all, take ONE MORE Full Backup before doing anything else. The most recent data wins; an hour-stale backup beats a week-stale one.

- Log in as the manager → Admin Tools → **Full Backup (Excel + SQL .zip)**
- Verify the .zip downloaded and the README's row count looks reasonable.

If the project is already gone, skip to Step 2 with the most recent available backup.

### Step 2 — Get or rebuild `schema.sql`

The schema lives outside the backup. You need it to set up an empty target before applying the data dump. Three ways to get it, in order of preference:

**Option A (recommended): keep a fresh `schema.sql` in the repo.**

If `docs/schema.sql` exists in the repo and is recent, use it. (If you don't have one yet, generate one NOW while the live project is up — see Option B — and commit it.)

**Option B: dump from the live Supabase project via CLI.**

Requires the Supabase CLI installed (`npm install -g supabase`):

```bash
supabase login
supabase db dump --schema-only --linked > schema.sql
```

Or via project ref:

```bash
supabase db dump --schema-only --project-ref rxxcrlobbtlvjgcqgjjm > schema.sql
```

**Option C: rebuild from migrations.**

If the project is dead but the repo has migration history under `docs/security/` and the Supabase migration list, replay every migration in order. This is the slow path — only use it if A and B are both impossible. The migration list is the source of truth (see `mcp__supabase__list_migrations` output or the Supabase Studio → Database → Migrations panel from any working project).

### Step 3 — Provision a new (empty) Supabase project

- Go to https://supabase.com/dashboard → New Project
- Region: same as the original (or as close as possible) to keep latency consistent.
- DB password: generate a strong one and stash it in your password manager.
- Wait ~2 minutes for provisioning.

Note the new project's:
- Project URL (looks like `https://abcdefgh.supabase.co`)
- `anon` public key (Settings → API)
- `service_role` secret key (Settings → API — do NOT commit this anywhere)

### Step 4 — Apply schema.sql

In the new project's **SQL Editor**:

1. Paste the contents of `schema.sql`.
2. Run it.
3. Confirm no errors. (Some `CREATE EXTENSION` lines may say "already exists" — that's fine, Supabase ships them by default.)

Verify the table count:
```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE';
```
Should be 23.

### Step 5 — Apply the data dump

In the same SQL Editor, paste the contents of `netsec-backup-<DATE>.sql` from inside the .zip. Run it.

The dump:
- Wraps everything in `BEGIN` / `COMMIT` — if any statement fails, nothing is committed.
- Uses `OVERRIDING SYSTEM VALUE` on identity columns so original ids are preserved (FK references depend on this).
- Bumps each table's identity sequence past `max(id)` after the inserts so the next app insert won't collide.

**Run as the project owner.** The SQL Editor uses the `service_role` by default in the dashboard — that's correct. The `anon` and `authenticated` roles will be blocked by RLS.

**If the file is large (>1MB):** Supabase Studio's SQL editor may struggle. Alternative — use `psql` from a local terminal:
```bash
psql 'postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres' -f netsec-backup-<DATE>.sql
```
Connection string is under **Settings → Database → Connection String**.

### Step 6 — Re-invite users via Supabase Auth

`auth.users` is not in the backup. After Step 5, the data is restored but no one can log in yet — the email→user_id mappings are gone.

In the new project's **Authentication → Users → Invite**:

Send invites to each row in `user_profiles`:
- venkat@gulfitd.com
- adil@gulfitd.com
- darayus@gulfitd.com
- nasif@gulfitd.com
- ahmed@gulfitd.com
- prasanth@gulfitd.com
- salman@gulfitd.com
- afsal@gulfitd.com

Each user receives the invite email, sets a password, and on first login the existing `user_profiles` row (matched by email via the `current_employee_name()` RLS helper) takes effect. No need to update `user_profiles.user_id` — the helper functions key off `auth.jwt()->>'email'`, not the UUID.

Confirm RLS works: log in as one of the employees → confirm they only see their own OT/leave/etc.

### Step 7 — Verify row counts

Run this query in the new project's SQL Editor and compare against the README.txt row count from the backup:

```sql
SELECT 'user_profiles' AS t, COUNT(*) FROM user_profiles
UNION ALL SELECT 'customers',               COUNT(*) FROM customers
UNION ALL SELECT 'vendors',                 COUNT(*) FROM vendors
UNION ALL SELECT 'product_lines',           COUNT(*) FROM product_lines
UNION ALL SELECT 'engagements',             COUNT(*) FROM engagements
UNION ALL SELECT 'engagement_milestones',   COUNT(*) FROM engagement_milestones
UNION ALL SELECT 'amc_contracts',           COUNT(*) FROM amc_contracts
UNION ALL SELECT 'amc_contract_engagements',COUNT(*) FROM amc_contract_engagements
UNION ALL SELECT 'ps_deals',                COUNT(*) FROM ps_deals
UNION ALL SELECT 'ps_milestones',           COUNT(*) FROM ps_milestones
UNION ALL SELECT 'unified_sessions',        COUNT(*) FROM unified_sessions
UNION ALL SELECT 'ot_sessions',             COUNT(*) FROM ot_sessions
UNION ALL SELECT 'annual_leave',            COUNT(*) FROM annual_leave
UNION ALL SELECT 'leave_requests',          COUNT(*) FROM leave_requests
UNION ALL SELECT 'comp_off_register',       COUNT(*) FROM comp_off_register
UNION ALL SELECT 'comp_off_requests',       COUNT(*) FROM comp_off_requests
UNION ALL SELECT 'inventory',               COUNT(*) FROM inventory
UNION ALL SELECT 'inventory_activity_log',  COUNT(*) FROM inventory_activity_log
UNION ALL SELECT 'certificates',            COUNT(*) FROM certificates
UNION ALL SELECT 'employee_skills',         COUNT(*) FROM employee_skills
UNION ALL SELECT 'kb_articles',             COUNT(*) FROM kb_articles
UNION ALL SELECT 'notifications',           COUNT(*) FROM notifications
UNION ALL SELECT 'dashboard_alert_snoozes', COUNT(*) FROM dashboard_alert_snoozes;
```

Counts must match the source exactly. If any row count is off, the dump likely hit an FK error — re-check the `BEGIN`/`COMMIT` log in the SQL Editor.

### Step 8 — Point the app at the new project

Edit the Supabase URL and anon key in the app:

- In `index.html` (or wherever `sb = supabase.createClient(...)` lives), update:
  - `https://rxxcrlobbtlvjgcqgjjm.supabase.co` → the new project URL
  - The anon key string → the new project's anon key
- Commit + push.
- Netlify auto-deploys in ~10s.

Hard-refresh the live site. Log in. Spot-check a few flows:
- Dashboard renders without errors
- OT Sessions list populated
- Engagement Summary populated
- Team Portfolio loads

### Step 9 — Re-test the backup pipeline

Once restored, take a fresh Full Backup from the new project. Confirm:
- The .zip downloads
- Row counts in the new backup match Step 7

You now have a verified-working recovery and a known-good backup of the recovered state.

---

## Test-the-runbook drill (do this once a quarter)

The most expensive part of disaster recovery is the first time you do it. Eliminate that cost by doing a dry run on a throwaway Supabase project once a quarter:

1. Take a Full Backup of the live project.
2. Spin up a new free-tier Supabase project ("netsec-dr-drill-YYYY-MM-DD").
3. Walk steps 4–7 exactly as written.
4. Compare row counts.
5. Delete the drill project.

If anything in steps 4–7 surprises you, fix this runbook before the surprise becomes a real incident.

---

## Edge cases

- **Sequences out of sync:** the dump bumps each identity sequence past `max(id)` after the inserts. If you skip that (e.g. only restore a single table manually), the next app insert will fail with a unique-violation. Run the `setval` line by hand to fix.
- **Single-quote-heavy data in `notes` / `manager_comment` / `session_info`:** the dump's `_sqlEscape` doubles single quotes; PostgreSQL accepts newlines / backslashes / tabs as-is inside standard `'...'` strings. No special handling needed.
- **JSONB column (`inventory_activity_log.field_changes`):** the dump JSON-stringifies the object, escapes single quotes, and inserts as text — PostgreSQL auto-casts to `jsonb` on column type match.
- **Soft-deleted rows (`is_archived=true` in engagements / amc_contracts / ps_deals):** these are preserved as-is. Restoration carries soft-delete state forward.
- **Storage buckets (certificates files):** Supabase Storage is NOT in this backup. Cert PDFs etc. live in the `certificates` bucket. If you need to preserve files, separately export the bucket contents via Supabase Studio → Storage → download (no bulk export in the dashboard, may need the CLI or a small script). The `certificates` table's `file_url` references will dangle in the new project until you re-upload the files OR clear the cert rows.

---

## When to refresh this runbook

Update this file when:
- A new table is added to the database. Add it to BACKUP_TABLES in `dashboard.js` AND to the verify-counts SQL in Step 7.
- An `auth.users` migration tool ships (then Step 6 changes).
- The schema diverges from `docs/schema.sql` in a way that re-importing the dump would fail. Either re-export the schema or document the gap.
