# NetSec Portal

Internal operations portal for Gulf IT / Gulfit Network Distribution FZC.  
Built by Mohammed Nasif. Deployed via Netlify (static site, no build step).

---

## Project Structure

```
netsec-portal/
├── index.html          # App shell — HTML structure only
├── css/
│   └── styles.css      # All CSS (design tokens, components, responsive)
├── js/
│   └── app.js          # All JavaScript (auth, OT, leave, projects, inventory, approvals)
├── README.md           # This file — project overview and dev guide
├── BACKEND.md          # Supabase schema, tables, RLS policies — READ BEFORE ANY DB CHANGES
└── V1.3-04-04-2026/    # Archived version snapshot
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (no framework, no build) |
| Backend | Supabase (Postgres + REST via supabase-js v2) |
| Auth | PIN-based login (client-side, no Supabase Auth) |
| Hosting | Netlify — auto-deploys on push to `master` |
| Fonts | Google Fonts (DM Sans + DM Mono) |

---

## Modules

| Module | Nav Tab | Description |
|---|---|---|
| Dashboard | 🏠 | Summary stats, quick actions, team overview |
| Overtime | ⏱ | Log OT sessions, comp off requests, summary, manager view |
| Leave | 🏖️ | Annual leave + sick leave requests and history |
| Projects | 📁 | Project session logging and summaries |
| Approvals | 🔔 | Manager-only — approve/reject comp off and leave requests |
| Inventory | 📦 | Device tracking with activity log (UAE/Oman/Bahrain/KDM/Qatar) |

---

## OT Policy (key rules — full policy in the Policy tab)

| Band | Trigger | Rate | Comp Off |
|---|---|---|---|
| Eve | Weekday 6:30PM–midnight (no cross) | 1:1 | 8 hrs = 1 day |
| Early | Weekday start 5:00AM–7:29AM | 1:1 | 8 hrs = 1 day (pools with Eve) |
| Midnight | Crosses midnight before 6:30PM or starts <5AM | <4h = 1:1, ≥4h = 1:2 | 8 credited hrs (cap 8h) = 1 day |
| Weekend | Sat/Sun (UAE) or Fri/Sat (KSA) | 1:1 always | 8 credited hrs = 1 day (credited = raw hrs, no cap) |
| Day | Everything else | 1:1 | No CO |

> **Weekday OT block:** Sessions cannot start between **7:30 AM and 6:30 PM** on weekdays (regular working hours). Form rejects with error.

---

## Roles

| Role | Who | Access |
|---|---|---|
| Manager | Venkatesan | All tabs + Approvals + Manager OT View + delete in Inventory |
| Employee | All others | All tabs except Approvals; no delete in Inventory |

---

## Local Development

No build step — just open `index.html` in a browser.  
Supabase anon key is embedded in `js/app.js` — do not commit new keys publicly.

---

## Deployment

Push to `master` → GitHub → Netlify auto-deploys (usually < 60 seconds).

---

## Backend Changes

> **Always read `BACKEND.md` before asking for or making any Supabase changes.**  
> It contains the full current schema, table definitions, and RLS policies.
