# Inventory Feature — Implementation Plan
**Project:** NetSec Portal  
**Date:** 2026-04-13  
**Status:** Pre-implementation — review before any code changes

---

## 1. Current Project Overview

| Item | Detail |
|------|--------|
| Architecture | Single-file SPA (`index.html`) — HTML + CSS + vanilla JS |
| Backend | **Supabase** (Postgres + REST API via `supabase-js v2`) |
| Auth | PIN-based login with employee/manager roles |
| Hosting | Static HTML (no server, no build step) |
| Existing tables | `ot_sessions`, `comp_off_register`, `comp_off_requests`, `leave_requests`, `annual_leave`, `project_sessions` |
| Existing screens | Dashboard, Overtime, Leave, Projects, Approvals |

---

## 2. What the Excel Sheet Tracks (Columns → Fields)

From the screenshot, the inventory sheet is titled:
**"UAE-OMAN-BAHRIAN-KDM-QAT MANAGE BY UAE TEAM"**

| Excel Column | Field Name (DB) | Notes |
|---|---|---|
| Sno | auto-increment | PK |
| Date | `audit_date` | Date of last audit |
| Audit Location | `audit_location` | e.g. STORE-GITD |
| Model No. | `model_no` | e.g. EC-XS, EC-XS NFR |
| Available | `availability_status` | Available in Qatar / Available (locked) / Nigeria / etc. |
| Serial Number | `serial_number` | Unique device identifier |
| Rail Kit | `rail_kit` | N/A or value |
| IDS/PS | `ids_ps` | N/A or "IDS Capable" |
| Current Location | `current_location` | UAE / OMAN / Qatar / Nigeria |
| Current Partner | `current_partner` | GULF IT / HPE/GulfFit / Network International / etc. |
| Current End User Location | `current_end_user` | UAE-Gulfit / Qatar-Gulfit / Providus etc. |
| Previous Location | `previous_location` | Where device was before |
| Remarks | `remarks` | Free text |
| Version | `version` | IDS Capable / blank |

---

## 3. Backend Changes Required (Supabase)

> ⚠️ **YES — backend changes are needed.** You must create a new table in Supabase before the feature will work.

### SQL to run in Supabase SQL Editor:

```sql
-- 1. Main inventory table
CREATE TABLE inventory (
  id                  BIGSERIAL PRIMARY KEY,
  serial_number       TEXT NOT NULL UNIQUE,
  model_no            TEXT,
  audit_location      TEXT,
  availability_status TEXT DEFAULT 'Available',
  rail_kit            TEXT DEFAULT 'N/A',
  ids_ps              TEXT DEFAULT 'N/A',
  current_location    TEXT,
  current_partner     TEXT,
  current_end_user    TEXT,
  previous_location   TEXT,
  version             TEXT,
  remarks             TEXT,
  audit_date          DATE,
  last_updated_by     TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Activity log table (tracks every add / edit / delete with who did it)
CREATE TABLE inventory_activity_log (
  id            BIGSERIAL PRIMARY KEY,
  device_id     BIGINT,
  serial_number TEXT,
  changed_by    TEXT NOT NULL,
  action        TEXT NOT NULL,   -- 'created' | 'updated' | 'deleted'
  field_changes JSONB,           -- { "Field Name": { "from": "old", "to": "new" } }
  changed_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: open policies (same pattern as rest of app uses anon key)
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_all" ON inventory FOR ALL USING (true);
CREATE POLICY "inv_log_all" ON inventory_activity_log FOR ALL USING (true);
```

---

## 4. Frontend Plan (index.html changes)

### 4.1 — New Nav Tab
Add **"📦 Inventory"** tab (visible to all users, edit restricted to managers).

### 4.2 — New Screen `screen-inventory`

**Sub-sections:**
1. **Summary cards** — Total Devices | Available | In Use | Locked/Unavailable | Countries
2. **Filter bar** — by Location / Model / Status / Partner / search by serial
3. **Inventory Table** — all columns from the Excel, sortable, paginated
4. **Add Device modal** — form with all fields (manager only)
5. **Edit/Move Device modal** — update current location, partner, status, remarks (manager only)
6. **Audit Log** — shows recent changes with who changed what and when (nice to have)

### 4.3 — Role Restrictions
- **All users:** Can view the inventory table and search/filter
- **Manager only:** Can add new devices, edit existing records, delete devices

### 4.4 — Export
- Export filtered view to CSV (no backend needed, client-side)

---

## 5. Implementation Steps (in order)

- [ ] **Step 1 — You run the SQL** in Supabase dashboard to create `inventory` table
- [ ] **Step 2 — Import existing data** — either manually or via a CSV import in Supabase
- [ ] Step 3 — Add CSS styles for inventory screen
- [ ] Step 4 — Add HTML: nav tab + screen skeleton + modals
- [ ] Step 5 — Add JS: loadInventory(), addDevice(), editDevice(), deleteDevice(), exportCSV()
- [ ] Step 6 — Hook up summary cards to live counts
- [ ] Step 7 — Test on mobile (responsive)

---

## 6. What You Need to Do Before We Start Coding

1. **Run the SQL** above in your Supabase dashboard (`rxxcrlobbtlvjgcqgjjm`)
2. **Confirm field names** — does the list of fields in Section 2 match your sheet? Any missing columns?
3. **Confirm role behaviour** — should regular employees be able to update a device's location/remarks, or managers only?
4. **Import existing data** — do you want to bulk-import the current Excel data first? If yes, export the sheet as CSV and upload via Supabase dashboard > Table Editor > Import CSV

---

## 7. No Backend Changes Needed For
- CSS/styling additions
- New HTML screen
- Client-side filtering/search
- CSV export

All data operations (add/edit/delete/read) go through the **existing Supabase client** (`sb`) already in the app — no new API keys or services needed.
