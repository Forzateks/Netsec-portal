# On-Prem Nightly Backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Ubuntu VM that pulls a verified nightly backup of the Supabase database onto Gulfit-owned hardware, and makes its own failure visible on the app's dashboard.

**Architecture:** One-way outbound pull. Nightly cron runs `pg_dump` against Supabase's session pooler, checks the dump is intact, restores it into a local PostgreSQL (the restore *is* the test), compares row counts against the previous night, rotates old files, then writes a row into the existing `backup_log` table over the same psql connection. The app is not modified.

**Tech Stack:** Ubuntu Server 24.04 LTS, PostgreSQL 17 (client + server), bash, cron, gzip.

**Spec:** `docs/superpowers/specs/2026-08-18-onprem-backup-design.md`

## Global Constraints

- Supabase runs **PostgreSQL 17.6** — `pg_dump` client must be **17 or newer** or it refuses to run.
- Connect via the **session pooler** (port 5432), never the transaction pooler (6543) — the latter does not support `pg_dump`.
- The VM opens **no inbound ports**. No port forwarding, no DMZ. Outbound only.
- The database password lives **only** in `~/.pgpass` (mode `0600`). Never inline in a script, never in git.
- Dumps are **never** copied into the git repo.
- `backup_log` inserts run as the `postgres` role over psql — `rls_forced = false` is verified, so no anon key, no service-role key, and no new RLS policy.
- All paths are owned by a dedicated `netsecbackup` user; backup directory mode `0700`.
- The repo is served publicly by Cloudflare Pages — anything added to it is world-readable unless Task 1 blocks it.

---

### Task 1: Stop Cloudflare Pages serving the repo's internals

Everything in the repo is downloadable from the live site, including `docs/schema.sql` with every RLS policy. This must be closed before the backup script is added to the repo.

**Files:**
- Create: `_redirects`
- Create: `ops/README.md`

**Interfaces:**
- Produces: a repo path `ops/` that is safe to hold operational scripts, because `_redirects` returns 404 for it.

- [ ] **Step 1: Confirm the exposure is real (this is the failing test)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://netsec-portal.pages.dev/docs/schema.sql
curl -s -o /dev/null -w "%{http_code}\n" https://netsec-portal.pages.dev/CLAUDE.md
```

Expected: `200` and `200` — both are currently public.

- [ ] **Step 2: Create the `_redirects` file**

Cloudflare Pages reads `_redirects` from the output root. Splat rules return 404 for internal paths while leaving the app untouched.

Create `_redirects`:

```
/docs/*        /index.html  404
/ops/*         /index.html  404
/CLAUDE.md     /index.html  404
/BACKEND.md    /index.html  404
/README.md     /index.html  404
/sw.js.map     /index.html  404
```

- [ ] **Step 3: Create the ops directory with a README**

Create `ops/README.md`:

```markdown
# Operational scripts

Scripts that run on Gulfit-owned infrastructure, not in the browser.

These are versioned here so they survive the loss of the machine that runs
them. They are blocked from public web access by `/_redirects` — verify with:

    curl -s -o /dev/null -w "%{http_code}" https://netsec-portal.pages.dev/ops/README.md

That must return 404. If it returns 200, `_redirects` is broken and no secret
or operational detail may be added to this directory until it is fixed.

**Never** put a password, connection string or dump file in here.
```

- [ ] **Step 4: Commit and push**

```bash
git add _redirects ops/README.md
git commit -m "ops: stop Cloudflare Pages serving repo internals

docs/schema.sql (every RLS policy), CLAUDE.md, BACKEND.md and the DR runbook
were all returning HTTP 200 on the live site. Publishing the exact
authorization boundary tells an attacker precisely what to probe.

Adds _redirects returning 404 for internal paths, and an ops/ directory for
scripts that run on our own infrastructure."
git push origin master
```

- [ ] **Step 5: Verify the fix on the live site**

Wait ~60s for the deploy, then:

```bash
for p in docs/schema.sql CLAUDE.md BACKEND.md ops/README.md; do
  printf "%-24s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://netsec-portal.pages.dev/$p?cb=$RANDOM)"
done
curl -s -o /dev/null -w "app still works: %{http_code}\n" https://netsec-portal.pages.dev/
```

Expected: all four internal paths return `404`; the app root returns `200`.

**If the app root is anything but 200, revert immediately** (`git revert HEAD && git push`) — a broken `_redirects` can take the site down.

---

### Task 2: Build the Ubuntu VM

**Files:** none in the repo — this is VMware and OS setup.

**Interfaces:**
- Produces: a reachable host `netsec-backup` with a `netsecbackup` user, sudo access, and outbound internet.

- [ ] **Step 1: Create the VM in VMware**

Settings, matching the spec:

| Setting | Value |
|---|---|
| Guest OS | Ubuntu Linux 64-bit |
| vCPU | 2 |
| RAM | 4 GB |
| Disk | 60 GB, thin provisioned |
| Network | your normal internal LAN (needs outbound internet) |
| Name | `netsec-backup` |

Download **Ubuntu Server 24.04 LTS** from https://ubuntu.com/download/server and attach the ISO.

- [ ] **Step 2: Install Ubuntu**

During the installer:
- Choose **Ubuntu Server** (not minimized).
- Set hostname `netsec-backup`.
- Create your admin user (this is *your* login, not the service account).
- **Tick "Install OpenSSH server"** — this is how you'll manage it.
- Skip all the "Featured server snaps".

- [ ] **Step 3: Update the OS and confirm outbound internet**

SSH in from your laptop, then:

```bash
sudo apt update && sudo apt -y upgrade
curl -s -o /dev/null -w "outbound internet: %{http_code}\n" https://supabase.com
```

Expected: `outbound internet: 200`.

- [ ] **Step 4: Create the service account and directories**

```bash
sudo useradd --system --create-home --shell /bin/bash netsecbackup
sudo mkdir -p /var/backups/netsec /opt/netsec-backup
sudo chown -R netsecbackup:netsecbackup /var/backups/netsec /opt/netsec-backup
sudo chmod 700 /var/backups/netsec
sudo touch /var/log/netsec-backup.log
sudo chown netsecbackup:netsecbackup /var/log/netsec-backup.log
```

- [ ] **Step 5: Decide and apply disk encryption**

Spec section 7 requires the dumps encrypted at rest, because the dump is the
entire company database in one file and RLS gives no protection to a file.
Pick one — this is open item 3 in the spec:

**Option A — VMware layer (simpler).** In vSphere, enable VM encryption on the
`netsec-backup` VM. Nothing to do inside the guest. Requires a configured Key
Provider in vCenter.

**Option B — LUKS inside the guest (works on any hypervisor).** Add a second
virtual disk to the VM, then:

```bash
sudo apt install -y cryptsetup
sudo cryptsetup luksFormat /dev/sdb          # answer YES, set a strong passphrase
sudo cryptsetup open /dev/sdb netsecbackup_crypt
sudo mkfs.ext4 /dev/mapper/netsecbackup_crypt
sudo mount /dev/mapper/netsecbackup_crypt /var/backups/netsec
sudo chown netsecbackup:netsecbackup /var/backups/netsec
sudo chmod 700 /var/backups/netsec
```

Note that LUKS needs the passphrase at every boot, so an unattended reboot
leaves backups failing until someone unlocks it. Record which option you chose
in the spec's section 10.

- [ ] **Step 6: Verify the permissions are locked down**

```bash
ls -ld /var/backups/netsec
```

Expected: `drwx------ ... netsecbackup netsecbackup ...` — the leading `drwx------` is what matters. No group or other access.

---

### Task 3: Install PostgreSQL 17 and prove you can reach Supabase

This task ends the moment you have pulled one real table out of Supabase by hand. Everything afterwards is automation of a thing already proven to work.

**Files:**
- Create: `/home/netsecbackup/.pgpass` (on the VM, never in git)

**Interfaces:**
- Produces: `psql` and `pg_dump` v17+ on PATH; a working `$CONN` connection string; a local PostgreSQL server.

- [ ] **Step 1: Add the official PostgreSQL apt repository**

Ubuntu's default packages may lag behind 17. The PostgreSQL project's own repo guarantees a new enough client.

```bash
sudo apt install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
sudo apt update
```

- [ ] **Step 2: Install PostgreSQL 17 server and client**

```bash
sudo apt install -y postgresql-17 postgresql-client-17
```

- [ ] **Step 3: Verify the client version meets the constraint**

```bash
pg_dump --version
```

Expected: `pg_dump (PostgreSQL) 17.x` — must be **17 or higher**, because Supabase runs 17.6. If it prints 16 or lower, stop: the repository step did not take effect.

- [ ] **Step 4: Store the database password**

Get the connection details from the Supabase dashboard: **Settings → Database → Connection string → Session pooler**. You need the host, the user (`postgres.<project-ref>`) and the database password.

```bash
sudo -u netsecbackup bash
cat > ~/.pgpass <<'EOF'
aws-0-<region>.pooler.supabase.com:5432:postgres:postgres.<project-ref>:<the-database-password>
EOF
chmod 600 ~/.pgpass
ls -l ~/.pgpass
```

Expected: `-rw------- ... .pgpass`. If it shows anything else, `psql` will silently ignore the file.

- [ ] **Step 5: Prove connectivity and confirm the server version**

Still as `netsecbackup`:

```bash
export CONN="postgresql://postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432/postgres"
psql "$CONN" -c "select version(), current_user;"
```

Expected: prints `PostgreSQL 17.6 ...` and `postgres`. If it hangs, the session pooler host is wrong or outbound 5432 is blocked by your firewall.

- [ ] **Step 6: Prove the `backup_log` insert permission without writing a row**

This is the failure-signal mechanism from the spec. The transaction is rolled back, so nothing lands in the table or the dashboard.

```bash
psql "$CONN" -c "begin; \
  insert into backup_log (taken_by, taken_by_email, notes) \
  values ('Automated (on-prem)','backup@gulfitd.com','permission test'); \
  rollback;"
```

Expected: `INSERT 0 1` followed by `ROLLBACK`. If you get `ERROR: new row violates row-level security policy`, stop and re-check that you connected as `postgres` and not with an anon key.

- [ ] **Step 7: Pull one real table by hand**

```bash
pg_dump "$CONN" --schema=public --table=public.customers --no-owner --no-privileges \
  | head -40
```

Expected: readable SQL containing `CREATE TABLE public.customers`. **This is the moment the whole design is proven.** Everything after this is scripting.

---

### Task 4: The dump script — dump and integrity checks

**Files:**
- Create: `ops/backup-netsec.sh` (in the repo, deployed to `/opt/netsec-backup/backup-netsec.sh`)

**Interfaces:**
- Produces: `/var/backups/netsec/netsec-YYYY-MM-DD.sql.gz`, and exit code 0 only when the dump passed every integrity check.
- Consumes: `$CONN` and `~/.pgpass` from Task 3.

- [ ] **Step 1: Write the script's dump-and-check stage**

Create `ops/backup-netsec.sh`:

```bash
#!/usr/bin/env bash
# Nightly backup of the NetSec Portal Supabase database.
# Spec: docs/superpowers/specs/2026-08-18-onprem-backup-design.md
# Runs as the netsecbackup user, from cron, at 02:00.
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────
# The password is NOT here. It lives in ~/.pgpass (mode 0600).
CONN="${NETSEC_CONN:?NETSEC_CONN must be set (see /opt/netsec-backup/netsec-backup.env)}"
BACKUP_DIR=/var/backups/netsec
LOG=/var/log/netsec-backup.log
LOCAL_DB=netsec_backup
MIN_BYTES=10240          # a dump smaller than 10 KB is not a real dump

DATE=$(date +%F)
DUMP="$BACKUP_DIR/netsec-$DATE.sql.gz"

log() { echo "$(date '+%F %T')  $*" | tee -a "$LOG"; }
fail() { log "FAILED: $*"; exit 1; }

log "=== backup run start ($DATE) ==="

# ── Step 1: dump ─────────────────────────────────────────────────
log "dumping public schema from Supabase..."
pg_dump "$CONN" --schema=public --no-owner --no-privileges \
  | gzip -9 > "$DUMP.partial" || fail "pg_dump returned non-zero"
mv "$DUMP.partial" "$DUMP"

# Reference list of who to re-invite during a real recovery.
# Passwords are NOT exported - recovery re-invites users.
psql "$CONN" -At -F, -c "select id, email from auth.users order by email" \
  > "$BACKUP_DIR/auth-users-$DATE.csv" || log "WARN: auth.users export failed (non-fatal)"

# ── Step 2: integrity checks, before this dump is trusted ────────
SIZE=$(stat -c%s "$DUMP")
log "dump size: $SIZE bytes"
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "dump is only $SIZE bytes (floor $MIN_BYTES)"

# A pg_dump that dies midway still leaves a file. The completion marker is
# the only reliable proof it finished.
gunzip -c "$DUMP" | tail -5 | grep -q "PostgreSQL database dump complete" \
  || fail "dump has no completion marker - it was truncated"

TABLES=$(gunzip -c "$DUMP" | grep -c "^CREATE TABLE public\." || true)
log "tables in dump: $TABLES"

# Compare against the newest PREVIOUS dump rather than a hardcoded list.
# A fixed list is exactly what silently drifted in the app's own backup.
PREV=$(ls -1t "$BACKUP_DIR"/netsec-*.sql.gz 2>/dev/null | grep -v "$DATE" | head -1 || true)
if [ -n "$PREV" ]; then
  PREV_TABLES=$(gunzip -c "$PREV" | grep -c "^CREATE TABLE public\." || true)
  log "previous dump had $PREV_TABLES tables"
  [ "$TABLES" -ge "$PREV_TABLES" ] \
    || fail "table count dropped: $PREV_TABLES -> $TABLES (schema damage or partial dump)"
else
  log "no previous dump to compare against (first run)"
fi

log "dump passed all integrity checks"
```

- [ ] **Step 2: Deploy it to the VM and make it executable**

```bash
sudo cp ops/backup-netsec.sh /opt/netsec-backup/backup-netsec.sh
sudo chown netsecbackup:netsecbackup /opt/netsec-backup/backup-netsec.sh
sudo chmod 750 /opt/netsec-backup/backup-netsec.sh
```

Create the environment file that holds the connection string (not the password):

```bash
sudo -u netsecbackup tee /opt/netsec-backup/netsec-backup.env >/dev/null <<'EOF'
NETSEC_CONN=postgresql://postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432/postgres
EOF
sudo chmod 640 /opt/netsec-backup/netsec-backup.env
```

- [ ] **Step 3: Run it and verify a real dump appears**

```bash
sudo -u netsecbackup bash -c 'set -a; . /opt/netsec-backup/netsec-backup.env; set +a; \
  /opt/netsec-backup/backup-netsec.sh'
ls -lh /var/backups/netsec/
```

Expected: log lines ending `dump passed all integrity checks`, and a `netsec-YYYY-MM-DD.sql.gz` of a few hundred KB.

- [ ] **Step 4: Verify the truncation check actually catches a bad dump**

This proves the safety net works rather than assuming it. Make a deliberately broken dump and confirm the script rejects it:

```bash
sudo -u netsecbackup bash -c '
  cd /var/backups/netsec
  gunzip -c netsec-$(date +%F).sql.gz | head -50 | gzip > broken.sql.gz
  gunzip -c broken.sql.gz | tail -5 | grep -q "PostgreSQL database dump complete" \
    && echo "UNEXPECTED: marker found" || echo "GOOD: truncated dump correctly has no marker"
  rm broken.sql.gz'
```

Expected: `GOOD: truncated dump correctly has no marker`.

- [ ] **Step 5: Commit**

```bash
git add ops/backup-netsec.sh
git commit -m "ops: nightly Supabase dump with integrity checks

Dumps the public schema via the session pooler, then refuses to trust the
result until it clears a size floor, carries pg_dump's completion marker,
and has at least as many tables as the previous night. The table check
compares against the last dump rather than a hardcoded list, because a
hardcoded list is what silently drifted in the app's own backup."
git push origin master
```

---

### Task 5: Verified restore and row-count comparison

A dump that has never been restored is a hope. This is what turns it into a backup.

**Files:**
- Modify: `ops/backup-netsec.sh` (append the restore and comparison stages)

**Interfaces:**
- Consumes: `$DUMP`, `$LOCAL_DB`, `log()`, `fail()` from Task 4.
- Produces: `$TOTAL_ROWS` and `$TABLE_COUNT` shell variables used by Task 6, and a local `rowcounts` table holding the previous night's figures.

- [ ] **Step 1: Create the local database and the row-count history table**

The history table must live OUTSIDE the `public` schema, because the nightly
restore drops and recreates `public` — anything stored there would be wiped
before it could be compared against.

```bash
sudo -u postgres psql -c "CREATE USER netsecbackup;"
sudo -u postgres psql -c "CREATE DATABASE netsec_backup OWNER netsecbackup;"
sudo -u postgres psql -d netsec_backup <<'SQL'
CREATE SCHEMA IF NOT EXISTS backup_meta AUTHORIZATION netsecbackup;
CREATE TABLE IF NOT EXISTS backup_meta.rowcount_history (
  run_date   date   NOT NULL,
  table_name text   NOT NULL,
  row_count  bigint NOT NULL,
  PRIMARY KEY (run_date, table_name)
);
ALTER TABLE backup_meta.rowcount_history OWNER TO netsecbackup;
SQL
```

Verify it survives a schema reset, which is exactly what the nightly run does:

```bash
sudo -u netsecbackup psql -d netsec_backup -c   "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
   SELECT count(*) AS history_table_survived FROM backup_meta.rowcount_history;"
```

Expected: it returns a count (0 on first run) rather than an error. If it
errors, the table was created in the wrong schema and every night's row-count
comparison would silently compare against nothing.

- [ ] **Step 2: Append the restore stage to the script**

Add to the end of `ops/backup-netsec.sh`:

```bash
# ── Step 3: restore into local Postgres — THIS is the verification ──
log "restoring into local database '$LOCAL_DB'..."
psql -d "$LOCAL_DB" -q -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" \
  || fail "could not reset local schema"
gunzip -c "$DUMP" | psql -d "$LOCAL_DB" -q -v ON_ERROR_STOP=1 \
  || fail "restore failed - the dump is not usable"
log "restore succeeded"

# ── Step 4: row counts, compared against last night ──────────────
TABLE_COUNT=$(psql -d "$LOCAL_DB" -At -c \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
log "restored tables: $TABLE_COUNT"

psql -d "$LOCAL_DB" -q <<SQL
insert into backup_meta.rowcount_history (run_date, table_name, row_count)
select current_date, relname, n_live_tup
from pg_stat_user_tables where schemaname = 'public'
on conflict (run_date, table_name) do update set row_count = excluded.row_count;
SQL

TOTAL_ROWS=$(psql -d "$LOCAL_DB" -At -c \
  "select coalesce(sum(row_count),0) from backup_meta.rowcount_history where run_date = current_date")
log "total rows: $TOTAL_ROWS"

# Flag any table that shrank materially since the last run. This catches a
# subtly broken dump AND accidental mass deletion in production.
ALERTS=$(psql -d "$LOCAL_DB" -At <<SQL
with prev as (
  select table_name, row_count from backup_meta.rowcount_history
  where run_date = (select max(run_date) from backup_meta.rowcount_history where run_date < current_date)
), cur as (
  select table_name, row_count from backup_meta.rowcount_history where run_date = current_date
)
select string_agg(cur.table_name || ': ' || prev.row_count || ' -> ' || cur.row_count, '; ')
from cur join prev using (table_name)
where cur.row_count < prev.row_count * 0.8 or prev.row_count - cur.row_count > 100;
SQL
)
if [ -n "$ALERTS" ]; then
  log "ROW COUNT ALERT: $ALERTS"
else
  log "row counts look normal"
fi
```

- [ ] **Step 3: Redeploy and run**

```bash
sudo cp ops/backup-netsec.sh /opt/netsec-backup/backup-netsec.sh
sudo chown netsecbackup:netsecbackup /opt/netsec-backup/backup-netsec.sh
sudo chmod 750 /opt/netsec-backup/backup-netsec.sh
sudo -u netsecbackup bash -c 'set -a; . /opt/netsec-backup/netsec-backup.env; set +a; \
  /opt/netsec-backup/backup-netsec.sh'
```

Expected: `restore succeeded`, `restored tables: 31`, a plausible total row count, and `row counts look normal`.

- [ ] **Step 4: Prove the restored copy is real data, not an empty shell**

```bash
sudo -u netsecbackup psql -d netsec_backup -c \
  "select (select count(*) from engagements) as engagements,
          (select count(*) from unified_sessions) as sessions,
          (select count(*) from leave_requests) as leave_requests;"
```

Expected: non-zero counts that match production — engagements should be around 147.

- [ ] **Step 5: Commit**

```bash
git add ops/backup-netsec.sh
git commit -m "ops: restore each dump locally and compare row counts

The nightly restore is the verification - a dump nobody has restored is a
hope, not a backup. Row counts are compared against the previous run and
flagged on a material drop, which catches both a subtly broken dump and
accidental mass deletion in production."
git push origin master
```

---

### Task 6: Report to backup_log, and rotate

This is what makes a silent failure impossible: the app's existing dashboard staleness banner becomes the alarm.

**Files:**
- Modify: `ops/backup-netsec.sh` (append the report and rotate stages)

**Interfaces:**
- Consumes: `$TOTAL_ROWS`, `$TABLE_COUNT`, `$ALERTS`, `$SIZE`, `$CONN` from Tasks 4 and 5.

- [ ] **Step 1: Append the report and rotation stages**

Add to the end of `ops/backup-netsec.sh`:

```bash
# ── Step 5: rotate, then report ──────────────────────────────────
# Keep 30 daily. Keep the 1st of each month for 12 months.
log "rotating old dumps..."
find "$BACKUP_DIR" -name 'netsec-*.sql.gz' -type f -mtime +30 \
  ! -name 'netsec-????-??-01.sql.gz' -delete
find "$BACKUP_DIR" -name 'netsec-????-??-01.sql.gz' -type f -mtime +365 -delete
find "$BACKUP_DIR" -name 'auth-users-*.csv' -type f -mtime +30 -delete
log "dumps retained: $(ls -1 "$BACKUP_DIR"/netsec-*.sql.gz | wc -l)"

# Report into the app's backup_log. Runs as the postgres role over the same
# connection, which bypasses RLS (verified: rls_forced = false), so this
# needs no anon key, no service-role key and no new policy.
NOTES="verified restore OK; $TABLE_COUNT tables"
[ -n "$ALERTS" ] && NOTES="$NOTES; ALERT $ALERTS"

psql "$CONN" -q <<SQL || fail "backup_log insert failed - the dashboard alarm will not update"
insert into backup_log (taken_by, taken_by_email, file_size_bytes, table_count, row_count, notes)
values ('Automated (on-prem)', 'backup@gulfitd.com', $SIZE, $TABLE_COUNT, $TOTAL_ROWS,
        \$\$$NOTES\$\$);
SQL

log "reported to backup_log"
log "=== backup run complete ==="
```

- [ ] **Step 2: Redeploy and run**

```bash
sudo cp ops/backup-netsec.sh /opt/netsec-backup/backup-netsec.sh
sudo chown netsecbackup:netsecbackup /opt/netsec-backup/backup-netsec.sh
sudo chmod 750 /opt/netsec-backup/backup-netsec.sh
sudo -u netsecbackup bash -c 'set -a; . /opt/netsec-backup/netsec-backup.env; set +a; \
  /opt/netsec-backup/backup-netsec.sh'
```

Expected: ends with `reported to backup_log` then `=== backup run complete ===`.

- [ ] **Step 3: Verify the row landed in Supabase**

```bash
sudo -u netsecbackup bash -c 'set -a; . /opt/netsec-backup/netsec-backup.env; set +a; \
  psql "$NETSEC_CONN" -c "select taken_at, taken_by, table_count, row_count, notes \
    from backup_log order by taken_at desc limit 3;"'
```

Expected: the newest row reads `Automated (on-prem)` with a sensible table and row count.

- [ ] **Step 4: Verify the alarm works end-to-end in the app**

Open the NetSec Portal dashboard and go to **Settings → Admin Tools → Reports & Backup**. The "last backup" indicator should now show today, attributed to `Automated (on-prem)`.

This is the whole failure-detection design proven: if the script ever stops, this stops updating and goes stale on the dashboard.

- [ ] **Step 5: Commit**

```bash
git add ops/backup-netsec.sh
git commit -m "ops: rotate dumps and report into backup_log

Keeps 30 daily plus the 1st of each month for a year. Reports into the
existing backup_log table over the same psql connection - the postgres role
bypasses RLS, so no key and no new policy are needed. The app's existing
dashboard staleness banner becomes the alarm: if this job dies, nobody
writes a row and a manager sees it stale the next morning."
git push origin master
```

---

### Task 7: Schedule it, and confirm it survives a reboot

**Files:**
- Create: `/etc/cron.d/netsec-backup` (on the VM)

- [ ] **Step 1: Install the cron entry**

```bash
sudo tee /etc/cron.d/netsec-backup >/dev/null <<'EOF'
# NetSec Portal nightly backup. Spec: docs/superpowers/specs/2026-08-18-onprem-backup-design.md
SHELL=/bin/bash
02 2 * * * netsecbackup set -a; . /opt/netsec-backup/netsec-backup.env; set +a; /opt/netsec-backup/backup-netsec.sh >> /var/log/netsec-backup.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/netsec-backup
```

Note the run time is `02:02`, not `02:00` — a deliberately odd minute avoids the moment every scheduled job on the planet fires at once.

- [ ] **Step 2: Verify cron accepted the file**

```bash
sudo systemctl restart cron
grep CRON /var/log/syslog | tail -5
```

Expected: no parse errors mentioning `netsec-backup`.

- [ ] **Step 3: Prove it survives a reboot**

```bash
sudo reboot
```

Wait, SSH back in, then:

```bash
systemctl is-enabled cron postgresql
ls -l /etc/cron.d/netsec-backup
```

Expected: both `enabled`, and the cron file still present.

- [ ] **Step 4: Let one real scheduled run happen, then check it**

The next morning:

```bash
tail -40 /var/log/netsec-backup.log
ls -lh /var/backups/netsec/
```

Expected: a run logged at ~02:02 ending `=== backup run complete ===`, and a dump dated today.

---

### Task 8: Document it and schedule the restore drill

A backup nobody has restored is a hope. This makes the drill a dated commitment rather than an intention.

**Files:**
- Modify: `docs/disaster-recovery.md`
- Create: `docs/testing/backup-restore-drill.md`

- [ ] **Step 1: Write the drill runbook**

Create `docs/testing/backup-restore-drill.md`:

```markdown
# Restore drill — twice a year

A backup nobody has restored is a hope. Run this every 6 months and record
the date at the bottom.

## Steps

1. Create a throwaway Supabase project (any region, free tier).
2. Copy its session-pooler connection string.
3. Restore the newest dump from the on-prem VM:

       gunzip -c /var/backups/netsec/netsec-<newest>.sql.gz \
         | psql "<throwaway-connection-string>" -v ON_ERROR_STOP=1

4. Point a LOCAL copy of the app at it: edit `SUPABASE_URL` and
   `SUPABASE_KEY` in `js/core/state.js` to the throwaway project's values.
   **Local only — never commit this change.**
5. Serve the app locally and log in. Open Dashboard, My Sessions and Leave
   Overview. Confirm the data is present and the numbers look right.
6. Delete the throwaway Supabase project.
7. Record the drill below and commit.

Step 5 is the point of the exercise: it proves the dump is not merely valid
SQL but actually runs the application.

## Drill log

| Date | Run by | Dump used | Result |
|---|---|---|---|
| _(first drill pending)_ | | | |
```

- [ ] **Step 2: Link the automated backup from the DR runbook**

Add to the top of `docs/disaster-recovery.md`, just under the Purpose line:

```markdown
> **There is also an automated nightly backup** on the on-prem
> Ubuntu VM (`netsec-backup`), holding 30 daily and 12 monthly dumps at
> `/var/backups/netsec/`. Those dumps include the schema, so a restore from
> them skips Step 2 below entirely. Design:
> `docs/superpowers/specs/2026-08-18-onprem-backup-design.md`.
> Drill: `docs/testing/backup-restore-drill.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/testing/backup-restore-drill.md docs/disaster-recovery.md
git commit -m "docs: restore drill runbook and DR pointer to the on-prem backup

The drill is what turns 'we have dumps' into 'we know they restore and the
app runs on them'. Scheduled twice a year with a dated log."
git push origin master
```

- [ ] **Step 4: Run the first drill now**

Do not defer this. The first drill is the one that finds the problems — a missing extension, an ownership error, a step in this plan that was wrong. Follow `docs/testing/backup-restore-drill.md` end to end and record the result.

---

## Verification checklist

Everything below must be true before this is considered done:

- [ ] `https://netsec-portal.pages.dev/docs/schema.sql` returns **404**; the app root returns 200
- [ ] `pg_dump --version` on the VM is **17 or newer**
- [ ] `/var/backups/netsec` is mode `0700`, owned by `netsecbackup`
- [ ] `~/.pgpass` is mode `0600`
- [ ] A manual run ends with `=== backup run complete ===`
- [ ] The restored local database reports ~147 engagements
- [ ] A deliberately truncated dump is rejected by the marker check
- [ ] The newest `backup_log` row reads `Automated (on-prem)`
- [ ] The app's Admin Tools backup indicator shows today's automated backup
- [ ] A scheduled 02:02 run has completed unattended
- [ ] The first restore drill is recorded in `docs/testing/backup-restore-drill.md`

## What is deliberately not built

Per the spec's section 1, and worth restating so nobody "adds it later" by reflex:

- **No failover.** If Supabase is down, the app is down.
- **No realtime replication.** Up to 24h of data loss is the accepted trade-off.
- **No offsite copy yet.** One on-prem VM is a single fire or ransomware event
  away from gone. This is strictly better than today, not complete. The natural
  next step is one encrypted offsite copy.
