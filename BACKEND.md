# Backend Reference — NetSec Portal

**Database:** Supabase (Postgres)  
**Project URL:** `https://rxxcrlobbtlvjgcqgjjm.supabase.co`  
**Auth:** Anon key in `js/app.js` — all table access goes through this key  
**Last verified:** 2026-04-27  
**Last updated:** 2026-04-27 — Customers table, customer/project links on OT + project sessions, activity_type standardization

> This file is the source of truth for the Supabase schema.  
> Before requesting any DB change, read this file first to avoid duplicating tables or columns.

---

## Tables

### 1. `ot_sessions`
Stores individual overtime session logs.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| employee | text | Employee name |
| activity | text | Activity / project description |
| ot_date | date | |
| start_time | time | 24h format |
| end_time | time | 24h format |
| day_name | text | Sunday–Saturday |
| band | text | Eve / Early / Mid / Wknd / Day |
| rate | text | 1:1 / 1:2 / Split |
| duration_hours | numeric | Raw duration |
| credited_hours | numeric | After rate applied |
| status | text | **pending** / approved / rejected — added 2026-04-17 |
| manager_comment | text | Manager's note on review — added 2026-04-17 |
| reviewed_by | text | Manager name — added 2026-04-17 |
| reviewed_at | timestamptz | When reviewed — added 2026-04-17 |
| customer_name | text | Selected customer (text snapshot) — added 2026-04-27 |
| project_name | text | Selected project (text snapshot) — added 2026-04-27 |
| activity_type | text | Standardized activity type — added 2026-04-27 |
| created_at | timestamptz | DEFAULT NOW() |

> **SQL already run** (2026-04-17):
> ```sql
> ALTER TABLE ot_sessions ADD COLUMN status TEXT DEFAULT 'approved';
> ALTER TABLE ot_sessions ADD COLUMN manager_comment TEXT;
> ALTER TABLE ot_sessions ADD COLUMN reviewed_by TEXT;
> ALTER TABLE ot_sessions ADD COLUMN reviewed_at TIMESTAMPTZ;
> UPDATE ot_sessions SET status = 'approved' WHERE status IS NULL;
> ```
>
> **SQL already run** (2026-04-27 — Weekend policy change to 1:1):
> ```sql
> UPDATE ot_sessions SET credited_hours = duration_hours, rate = '1:1' WHERE band = 'Wknd';
> ```
>
> **SQL already run** (2026-04-27 — Customers, project links, activity types):
> ```sql
> CREATE TABLE customers (id BIGSERIAL PK, name TEXT UNIQUE, status TEXT, created_at TIMESTAMPTZ);
> -- + RLS open policy, seed (Mashreq, Landmark, Dubai Holding, Naivas, DFM, ABK, ASTER)
> ALTER TABLE projects ADD COLUMN customer_id BIGINT REFERENCES customers(id);
> ALTER TABLE project_sessions ADD COLUMN customer_name TEXT;
> ALTER TABLE ot_sessions ADD COLUMN customer_name TEXT;
> ALTER TABLE ot_sessions ADD COLUMN project_name TEXT;
> -- Standardize activity_type values in project_sessions
> ```
>
> **SQL still to run** (2026-04-27 — activity_type on OT):
> ```sql
> ALTER TABLE ot_sessions ADD COLUMN activity_type TEXT;
> ```

---

### 2. `comp_off_register`
Approved comp off entitlements (written when a comp off request is approved).

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| employee | text | |
| date_taken | date | Date the comp off was used |
| days | numeric | 1.0 or 0.5 |
| related_request | bigint | FK to comp_off_requests.id |
| created_at | timestamptz | |

---

### 3. `comp_off_requests`
Employee requests to take a comp off day.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| employee | text | |
| request_date | date | Date requested to take off |
| type | text | Full Day / Half Day |
| days | numeric | 1.0 or 0.5 |
| related_activity | text | Optional context |
| remarks | text | |
| status | text | pending / approved / rejected |
| manager_comment | text | |
| created_at | timestamptz | |

---

### 4. `leave_requests`
Annual and sick leave requests.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| employee | text | |
| leave_type | text | Annual / Sick |
| start_date | date | |
| end_date | date | |
| working_days | numeric | Calculated working days |
| reason | text | |
| status | text | pending / approved / rejected |
| manager_comment | text | |
| created_at | timestamptz | |

---

### 5. `annual_leave`
Approved leave records (written when a leave request is approved).

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| employee | text | |
| leave_type | text | Annual / Sick |
| start_date | date | |
| end_date | date | |
| working_days | numeric | |
| created_at | timestamptz | |

---

### 6. `project_sessions`
Project work session logs.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| project_name | text | |
| customer_name | text | Selected customer — added 2026-04-27 |
| session_date | date | |
| activity_type | text | HLD/LLD Discussion or Doc, Pilot Sites Rollout, As-Built Doc, KT/Training, Migration, Troubleshooting, Initial Configuration |
| session_info | text | |
| start_time | time | |
| end_time | time | |
| duration_hours | numeric | |
| onsite_remote | text | Onsite / Remote |
| team_members | text | Comma-separated |
| stake_holders | text | |
| remarks | text | |
| logged_by | text | Employee name |
| created_at | timestamptz | |

---

### 7. `projects`
Project name registry (used to populate dropdowns).

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| name | text | Project name |
| status | text | active / archived |
| customer_id | bigint | FK to customers.id — added 2026-04-27 |
| created_at | timestamptz | |

---

### 7b. `customers`
Predefined customer registry. Each project belongs to one customer.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| name | text UNIQUE NOT NULL | |
| status | text | active / archived (default active) |
| created_at | timestamptz | |

Seed values: Mashreq, Landmark, Dubai Holding, Naivas, DFM, ABK, ASTER.

---

### 8. `inventory`
Device inventory — UAE/Oman/Bahrain/KDM/Qatar hardware tracking.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| serial_number | text UNIQUE NOT NULL | Primary device identifier |
| model_no | text | EC-XS / EC-XS NFR |
| audit_location | text | e.g. STORE-GITD |
| availability_status | text | Free text — e.g. "Available in Qatar", "Available (locked)" |
| rail_kit | text | N/A / Yes |
| ids_ps | text | N/A / IDS Capable |
| current_location | text | UAE / OMAN / Qatar / Nigeria / Bahrain / KDM |
| current_partner | text | e.g. GULF IT, HPE/GulfFit, Network International |
| current_end_user | text | e.g. UAE-Gulfit, Qatar-Gulfit |
| previous_location | text | |
| version | text | blank / IDS Capable |
| remarks | text | |
| audit_date | date | |
| last_updated_by | text | Employee name who last edited |
| created_at | timestamptz | DEFAULT NOW() |
| updated_at | timestamptz | DEFAULT NOW() |

---

### 9. `inventory_activity_log`
Audit trail for every add / edit / delete on the inventory table.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| device_id | bigint | References inventory.id (no cascade — kept after deletion) |
| serial_number | text | Copied from device at time of change |
| changed_by | text | Employee name |
| action | text | created / updated / deleted |
| field_changes | jsonb | `{ "Field Label": { "from": "old", "to": "new" } }` for updates |
| changed_at | timestamptz | DEFAULT NOW() |

---

### 10. `kb_articles`
Knowledge Base — articles and notes submitted by employees.

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| title | text NOT NULL | Article heading |
| category | text | Network / Security / Configuration / Troubleshooting / General |
| tags | text | Comma-separated e.g. "cisco,vlan,switch" |
| content | text NOT NULL | Full article body (plain text) |
| file_url | text | Optional external link (SharePoint, Drive, etc.) |
| submitted_by | text NOT NULL | Employee name |
| created_at | timestamptz | DEFAULT NOW() |
| updated_at | timestamptz | DEFAULT NOW() |

> **SQL to run** (if not yet done):
> ```sql
> CREATE TABLE kb_articles (
>   id           BIGSERIAL PRIMARY KEY,
>   title        TEXT NOT NULL,
>   category     TEXT,
>   tags         TEXT,
>   content      TEXT NOT NULL,
>   file_url     TEXT,
>   submitted_by TEXT NOT NULL,
>   created_at   TIMESTAMPTZ DEFAULT NOW(),
>   updated_at   TIMESTAMPTZ DEFAULT NOW()
> );
> ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
> CREATE POLICY "kb_all" ON kb_articles FOR ALL USING (true);
> ```

---

## RLS Policies

All tables use open anon-key policies (same pattern — app relies on PIN auth, not Supabase Auth):

```sql
-- Pattern applied to every table:
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "<table>_all" ON <table> FOR ALL USING (true);
```

---

## How Approval Flow Works

```
Employee submits → comp_off_requests / leave_requests (status: pending)
Manager approves → status set to 'approved'
              → record written to comp_off_register / annual_leave
Manager rejects → status set to 'rejected', manager_comment stored
```

---

## Requesting Backend Changes

Before asking to add/modify anything in Supabase:
1. Check the table list above — the column may already exist
2. If a new table is needed, confirm the SQL is not already in this file
3. SQL to run will be provided in a code block — paste into **Supabase dashboard → SQL Editor**
