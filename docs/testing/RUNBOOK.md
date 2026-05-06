# Manual Regression Runbook — NetSec Portal

Run this before pushing significant changes. Each step lists the click path, the expected result, and a pass/fail box. Time required: ~25 minutes for the full pass, ~10 minutes for the smoke subset (marked ⭐).

---

## Pre-flight

- [ ] Latest Cloudflare Pages deployment is live (check the dashboard for the most recent commit hash)
- [ ] You have at least two test accounts: one manager (Venkatesan), one employee
- [ ] Test data is acceptable to modify, OR you've taken a Full Backup from Dashboard

---

## A. Authentication ⭐

| # | Step | Expected | ✓ |
|---|---|---|---|
| A1 | Open the live URL in an incognito window | Login screen renders, email/password form visible, no DB error | ☐ |
| A2 | Try to sign in with wrong password | "Invalid login credentials" error appears | ☐ |
| A3 | Sign in with valid manager email/password | Lands on Dashboard, header shows "Manager" badge | ☐ |
| A4 | Confirm Approvals tab and Manager OT View are visible | Both visible in nav | ☐ |
| A5 | Sign out (top-right Logout) | Returns to login screen, fields cleared | ☐ |
| A6 | Sign in with employee account | Header shows "Employee" badge, Approvals tab hidden, Manager OT View sub-tab hidden | ☐ |
| A7 | Forgot Password → enter email → submit | Success banner appears; check inbox for reset email | ☐ |
| A8 | Reload during a logged-in session | Should stay signed in (Remember Me default on) | ☐ |
| A9 | Uncheck Remember Me, sign in, close tab, reopen | Should require sign-in again | ☐ |

---

## B. OT Logging — Bands ⭐

Use the live preview to confirm each. No need to save unless verifying DB write.

| # | Date / Times | Expected band | Expected credit (UAE) | ✓ |
|---|---|---|---|---|
| B1 | Weekday, 06:00–07:30 | Early, 1:1 | 1.5h | ☐ |
| B2 | Weekday, 07:00–10:00 | Early, 1:1 | 0.5h (capped at 7:30) | ☐ |
| B3 | Weekday, 18:00–19:00 | Eve, 1:1 | 0.5h (only post-18:30) | ☐ |
| B4 | Weekday, 19:00–22:00 | Eve, 1:1 | 3h | ☐ |
| B5 | Weekday, 21:00–01:00 | Eve, Split | 5h (3 + 2 doubled) | ☐ |
| B6 | Weekday, 23:00–08:30 | Mid, 1:2 | 8.5h (1 + 7.5) | ☐ |
| B7 | Weekend (UAE Sat/Sun), any hours | Wknd, 1:1 | raw hours | ☐ |
| B8 | Weekday, 08:00–17:00 (entirely in block) | Submit rejected | "regular working hours" error | ☐ |

For KSA accounts (Salman, Afsal), confirm boundaries shift to 8:00 AM and 7:00 PM:
- [ ] Weekday 7:30–08:00 → 0.5h Early credit (UAE would be 0)
- [ ] Weekday 18:00–19:00 → blocked entirely (KSA Eve threshold is 19:00)

## B-extra. Save and Verify

- [ ] Log a real OT session, save it → appears in Sessions tab as "Pending"
- [ ] Hover the (i) icon on the new row → tooltip shows step-by-step calculation matching policy
- [ ] As manager, navigate to Approvals → OT Sessions sub-tab → the pending session appears
- [ ] Approve it with a comment → status flips to Approved with comment visible
- [ ] CO Balance on Dashboard updates (if credit ≥ 8h pooled or weekend ≥ 8h)

---

## C. Comp Off

- [ ] Submit a Full Day comp off request → appears in employee history as Pending
- [ ] As manager, approve it → record appears in `comp_off_register`, balance reduces by 1
- [ ] Submit a Half Day request → comp off balance reduces by 0.5 on approval
- [ ] Reject a request with a comment → status Rejected, comment visible

---

## D. Leave

- [ ] Submit Annual Leave for a 3-day range → working days calculated correctly (excludes weekends per region)
- [ ] As manager, approve → Annual Leave Used count rises, Remaining drops
- [ ] Submit Sick Leave for 1 day → approved → Sick balance drops (limit 12/year)
- [ ] Try submitting leave dates that overlap with approved leave → behavior documented (currently allowed; may want a future check)
- [ ] As employee, check My Leave Overview shows correct totals
- [ ] As manager, check Team Leave Overview shows all employees side by side

---

## E. Projects

- [ ] **Add Project** (manager): Customer dropdown required, Project Name uppercase, Status defaults to active
- [ ] Adding a duplicate project name → reject with "already exists" error
- [ ] **Edit Project**: change customer, name, or status → cascades to project_sessions and ot_sessions referencing the old name
- [ ] **Delete Project**: removes from registry only; existing sessions still reference the (now orphaned) name
- [ ] **Log Session** (Sessions tab): Type → Customer → Engagement → Activity Type chained correctly. Live preview shows Total / Office / OT split with band info. Save creates a unified_sessions row plus a linked pending ot_sessions row when OT > 0.
- [ ] **My Sessions**: shows everyone's unified sessions; Legacy toggle swaps the data source to old `project_sessions` (read-only)
- [ ] **POC Summary** + **AMC Summary**: each shows only their respective type sessions; pie + table
- [ ] Activity Type dropdown shows the 10 standardized values
- [ ] **Sessions tab**: filter by Customer, Project, Member, From-date, To-date all work
- [ ] Top horizontal scrollbar mirrors bottom scroll
- [ ] **Project Summary**: two pies (Hours by Project, Hours by Customer); LANDMARK aliases consolidate
- [ ] **Employee Summary**: hours per employee, top projects column visible

---

## F. Approvals (manager)

- [ ] Comp Off Requests sub-tab: pending list, approve/reject with comment
- [ ] Leave Requests sub-tab: same flow
- [ ] OT Sessions sub-tab: pending OT sessions, approve/reject
- [ ] Notification badge at top updates count after each action
- [ ] Approving an OT session: status flips to Approved, CO balance updates

---

## G. Inventory

- [ ] **Add Device**: Serial Number is required and unique
- [ ] Try adding duplicate serial → friendly error referencing existing device
- [ ] Model dropdown shows EC-XS, EC-SP, EC-M, EC-10104, EC-10106
- [ ] Version field is a datalist (suggestions but free entry)
- [ ] **Edit Device**: Last Updated By + On readonly field shows correct values
- [ ] All fields persisted on save
- [ ] **Delete Device** (manager only): confirms before deletion, writes to inventory_activity_log
- [ ] **Activity Log tab**: shows all changes with from/to diff
- [ ] **Export CSV**: downloads with all current rows

---

## H. Knowledge Base

- [ ] Browse tab: search and filter by category/tag work
- [ ] Submit new article: title, category, tags, content, optional file URL
- [ ] My Articles tab: shows only your submissions
- [ ] Edit your own article → updates correctly
- [ ] Manager can edit/delete any article; employee can only edit own
- [ ] Article view modal renders content; close button returns to list

---

## I. Manager OT View — Admin Tools

| # | Tool | Expected | ✓ |
|---|---|---|---|
| I1 | ⚙️ Policy Recompute → Preview | Lists per-session band/rate/credit changes | ☐ |
| I2 | 📦 Archive Policy Violators → Preview | Lists per-employee delete vs keep counts; balance after column not negative | ☐ |
| I3 | 📦 Archive Policy Violators → Apply | Sessions go to status=archived, dimmed in Sessions tab with reason on hover | ☐ |
| I4 | 🔄 Re-evaluate Archived → Preview | Lists archived sessions that now qualify for partial credit | ☐ |
| I5 | 🔄 Re-evaluate Archived → Apply | Selected sessions un-archive (status=approved), credit updates | ☐ |
| I6 | 🗑️ Purge > 1 Year | Only deletes archived/rejected older than 365 days; "nothing to purge" message if none | ☐ |

---

## J. Backup & Reports ⭐

- [ ] Dashboard → Full Backup → downloads .xlsx with one sheet per table, all rows present
- [ ] Per-table backup buttons each download a separate .xlsx with just that table
- [ ] Monthly OT Report (manager): downloads CSV with previous month's sessions + summary

---

## K. UI / Cosmetic

- [ ] Mobile viewport: header collapses, hide-mobile columns hidden in tables
- [ ] Login → app transition: no flash of unauthenticated content
- [ ] Loading spinners visible during fetches
- [ ] No mojibake in any visible text (em dashes, emojis render correctly)
- [ ] Footer credit "Built by Mohammed Nasif" present
- [ ] Date format `DD/MM/YYYY` consistent across all tables

---

## Sign-off

- Tester: ___________________
- Date: _____________________
- Build / commit hash: _______
- Result: ☐ Pass  ☐ Pass with notes  ☐ Fail

Notes / regressions found:
```
(record here)
```

---

## When to update this runbook

Whenever a new feature is added or business rule changes:
1. Add a row to the relevant section above
2. If a new admin tool appears under Manager OT View, extend section I
3. If a new band or policy rule is introduced, extend section B
