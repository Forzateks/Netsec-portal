# NetSec Portal

Internal operations portal for Gulf IT / Gulfit Network Distribution FZC.  
Deployed via Cloudflare Pages (static site, no build step).

---

## Project Structure

```
netsec-portal/
├── index.html                # App shell — HTML structure only
├── css/
│   └── styles.css            # All CSS (design tokens, components, responsive)
├── js/
│   ├── core/
│   │   ├── state.js          # Shared config and global state
│   │   ├── auth.js           # Auth bootstrap and app entry flow
│   │   ├── navigation.js     # Screen and tab switching
│   │   ├── helpers.js        # Shared UI/data helpers and backup export
│   │   └── init.js           # Session restore and initial page boot
│   └── features/
│       ├── overtime.js       # OT logging, summaries, comp off
│       ├── leave.js          # Leave flows and manager approvals
│       ├── dashboard.js      # Dashboard and OT CSV export
│       ├── editors.js        # OT and project edit modals, monthly OT report
│       ├── projects.js       # Projects, sessions, summaries, dropdown data
│       ├── inventory.js      # Inventory and activity log
│       ├── approvals.js      # OT approvals
│       └── knowledge-base.js # KB browse, submit, edit, delete
├── docs/
│   ├── features/
│   │   ├── README.md         # Feature map and product-area overview
│   │   └── GulfitOT_Technical_Reference.docx
│   ├── security/
│   │   └── README.md         # Security posture and hardening notes
│   ├── testing/
│   │   └── README.md         # Manual regression checklist
│   └── archive/
│       ├── README.md
│       └── V1.3-04-04-2026/  # Archived version snapshot and import artifacts
├── README.md                 # This file — project overview and dev guide
└── BACKEND.md                # Supabase schema, tables, RLS policies — READ BEFORE ANY DB CHANGES
```

## Organization Rules

- Keep runtime entry files at the repo root: `index.html`, `css/`, `js/`
- Put feature references and business documents under `docs/features/`
- Put security posture, auth notes, and hardening work under `docs/security/`
- Put manual test plans and future QA assets under `docs/testing/`
- Put historical snapshots and import artifacts under `docs/archive/`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (no framework, no build) |
| Backend | Supabase (Postgres + REST via supabase-js v2) |
| Auth | Supabase Auth (email/password + password reset) |
| Hosting | Cloudflare Pages — auto-deploys on push to `master` |
| Fonts | Google Fonts (DM Sans + DM Mono) |

---

## Modules

| Module | Nav Tab | Description |
|---|---|---|
| Dashboard | 🏠 | Summary stats, quick actions, team overview |
| Overtime | ⏱ | Log OT sessions, comp off requests, summary, manager view |
| Leave | 🏖️ | Annual leave + sick leave requests and history |
| Sessions | 📋 | Unified session log (Project / POC / AMC / Internal) — auto-creates pending OT for hours outside the block window. Project / POC / AMC / Employee summaries with type breakdown. |
| Approvals | 🔔 | Manager-only — approve/reject comp off and leave requests |
| Inventory | 📦 | Device tracking with activity log (UAE/Oman/Bahrain/KDM/Qatar) |
| Knowledge Base | 📚 | Internal article library for notes, troubleshooting, and configuration knowledge |

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
Supabase anon key is embedded in `js/core/state.js` — do not commit new keys publicly.

---

## Deployment

Push to `master` → GitHub → Cloudflare Pages auto-deploys (usually < 60 seconds).

---

## Backend Changes

> **Always read `BACKEND.md` before asking for or making any Supabase changes.**  
> It contains the full current schema, table definitions, and RLS policies.

## Supporting Docs

- Feature reference: [docs/features/README.md](/d:/Netsec-portal/docs/features/README.md)
- Security notes: [docs/security/README.md](/d:/Netsec-portal/docs/security/README.md)
- Testing checklist: [docs/testing/README.md](/d:/Netsec-portal/docs/testing/README.md)
- Archive notes: [docs/archive/README.md](/d:/Netsec-portal/docs/archive/README.md)
