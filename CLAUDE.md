# CLAUDE.md — NetSec Portal

Guidance for AI assistants (and humans) working in this repo. **Read this before
making any change.** It overrides default assumptions about how this codebase is
laid out and how work should be done here.

---

## 1. What this is

NetSec Portal is the internal operations app for **Gulfit Network Distribution FZC**
(a.k.a. Gulf IT), a UAE/KSA network-security consultancy with 6 employees. It replaces
Excel for overtime tracking, leave/comp-off management, session logging (Project / POC /
AMC / Support / Pre-Sales / Internal), professional-services deals, AMC contracts,
inventory, certificates, team skills, a project tracker, tasks, and an internal
knowledge base.

- **Live URL:** https://netsec-portal.pages.dev/
- **Backend:** Supabase project `https://rxxcrlobbtlvjgcqgjjm.supabase.co`
- **Hosting:** Cloudflare Pages — auto-deploys on push to `master` (~30–60s)
- **Current shell version:** v133 (see §5 Versioning)

---

## 2. Tech stack — and the hard constraints

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript. **No framework, no build step, no bundler.** |
| Backend | Supabase (Postgres + Auth + RLS), accessed via `@supabase/supabase-js@2` from CDN |
| Hosting | Cloudflare Pages (static, deploys from `master`) |
| Error tracking | Sentry (loaded from CDN in `index.html`, prod-only) |
| Icons | Lucide (CDN) | 
| Excel export | SheetJS / XLSX — lazy-loaded on demand, not in the initial bundle |
| Fonts | DM Sans (UI) + DM Mono (numeric data) via Google Fonts |

**Do not introduce:** React/Vue/etc., a build pipeline (Vite/webpack), `package.json`,
npm dependencies, or any backend other than Supabase. Everything ships as static files
served as-is. There is no transpilation — write browser-ready ES5/ES6 that runs directly.

---

## 3. Architecture & file structure

> **Important:** This was historically a single `index.html` file. It has since been
> refactored into a modular `index.html` (shell/markup) + `css/styles.css` +
> `js/core/*` + `js/features/*`. Older docs that say "single-file app, edit index.html"
> are **out of date** — most logic now lives in the `js/` modules.

```
Netsec-portal/
├── index.html              # App shell: all HTML markup + <script> load order. No app logic.
├── css/
│   └── styles.css          # ALL styles — design tokens, components, responsive rules
├── js/
│   ├── core/
│   │   ├── state.js        # Config (Supabase URL + anon key) + global state vars. LOADS FIRST.
│   │   ├── auth.js         # Login, password reset/change, profile load, role detection, ensureAuthValid
│   │   ├── navigation.js   # showScreen / navigateSub / tab + sidebar accordion routing
│   │   ├── helpers.js      # Shared helpers: r2, esc2, fmtDate/Time, fmtHours/Days, toast, Excel backup
│   │   └── init.js         # window.onload boot, service-worker/PWA lifecycle, PTR, a11y. LOADS LAST.
│   └── features/
│       ├── overtime.js     # ⭐ calcOT() — OT band/rate/credit engine (single source of truth)
│       ├── leave.js        # Annual + sick leave, comp-off, manager approvals, team overview
│       ├── dashboard.js    # Dashboard cards/alerts + backup reminder banner + OT CSV export
│       ├── editors.js      # OT + session edit modals, monthly OT report
│       ├── projects.js     # Engagements (customers/projects), session summaries, dropdown data
│       ├── unified-sessions.js # Log/list "unified" sessions (Project/POC/AMC/Support/etc.)
│       ├── approvals.js    # OT approval rendering
│       ├── notifications.js# Notification bell + polling
│       ├── inventory.js    # Device tracking + append-only activity log
│       ├── knowledge-base.js # KB browse/submit/edit/delete
│       ├── tracker.js      # Project Tracker (All / Projects / POCs) kanban-ish view
│       ├── certificates.js # Employee certificates (mine / all)
│       ├── amc-contracts.js# AMC contracts
│       ├── ps-deals.js     # Professional Services deals + milestones
│       ├── team-skills.js  # Team skills matrix
│       ├── team.js         # Team Portfolio (public route at /#/team + internal mode)
│       └── tasks.js        # Tasks + task templates + task-completion approvals
├── data/
│   ├── team.json           # Team Portfolio content
│   └── whats-new.json      # Versioned release notes shown in the "What's new" modal
├── docs/
│   ├── BACKEND.md (../)    # (BACKEND.md lives at repo root) Supabase schema reference
│   ├── schema.sql          # ⭐ Full current DB schema — source of truth for tables/RLS
│   ├── features/           # OT_Policy_Guide.md, technical reference, feature map
│   ├── security/           # Security posture + RLS step-1/step-2 SQL
│   ├── testing/            # Manual regression checklist + RLS smoke tests
│   ├── migrations/         # Historical data-migration artifacts (e.g. v96)
│   └── archive/            # Old version snapshots (V1.3) + legacy import SQL — DO NOT edit/re-run
├── sw.js                   # Service worker (cache-first shell, update lifecycle)
├── manifest.webmanifest    # PWA manifest
├── README.md               # Project overview
├── BACKEND.md              # Supabase schema/table/RLS reference — READ BEFORE ANY DB CHANGE
└── (icons, logo, video, favicons)
```

### Script load order (in `index.html`, ~line 2944) — order matters
`state.js` → `auth.js` → `overtime.js` → `leave.js` → `dashboard.js` → `editors.js`
→ `navigation.js` → `helpers.js` → `projects.js` → `unified-sessions.js` →
`notifications.js` → `inventory.js` → `approvals.js` → `knowledge-base.js` →
`tracker.js` → `certificates.js` → `amc-contracts.js` → `ps-deals.js` →
`team-skills.js` → `team.js` → `tasks.js` → `init.js`.

All scripts are plain globals (no modules/imports). Functions are called across files by
global name, often guarded with `typeof fn === 'function'`. `state.js` must load first
(defines `sb`, `EMPLOYEES`, `KSA_EMP`, `currentUser`, `isManager`, …); `init.js` must
load last (it wires `window.onload`).

---

## 4. Running & deploying

- **Run locally:** no build — open `index.html` in a browser, or serve the folder
  statically. The service worker only registers over https/localhost.
- **Deploy:** edit files → `git add` → `git commit` → push to `master`. Cloudflare Pages
  auto-deploys in ~30–60s. Always sanity-check the live site after a push; if it breaks,
  `git revert HEAD && git push`.
- The Supabase **anon key is embedded in `js/core/state.js`** — this is unavoidable for a
  static site and is acceptable (RLS is the real defense, §8). Don't waste effort hiding it.

---

## 5. Versioning — the version trio (+ release notes)

When the app shell changes meaningfully, **four places must stay in sync**:

1. `sw.js` → `CACHE_VERSION = 'netsec-vNNN'`
2. `js/core/init.js` → `SW_REGISTRATION_URL = '/sw.js?v=NNN'`
3. `index.html` → Sentry `release: 'netsec-portal@vNNN'`
4. `data/whats-new.json` → add an item with `"version": "vNNN"` (drives the "What's new"
   modal; users see only items newer than their running version)

Bumping the cache version is what forces existing PWA clients (especially iOS) to pick up
the new shell. The user-menu version label reads from `SW_REGISTRATION_URL`, so the trio
is the single source of truth — don't add a 5th place.

---

## 6. Modules & navigation

Navigation is sidebar-driven via `showScreen(name)` and `navigateSub(screen, subTab)` in
`js/core/navigation.js`. Screens are `<div class="screen" id="screen-NAME">`; sub-tabs are
toggled by per-feature `show*Tab()` functions. Some sidebar groups are **manager-only**
and hidden at login by `initApp()` in `auth.js`.

| Area | Notes |
|---|---|
| Dashboard | Summary cards, alerts, quick actions; manager backup banner |
| Sessions | Log Session + My Sessions (unified session log) |
| Leave | Annual (22/yr) + Sick (12/yr) + Comp-off requests; manager Team Overview |
| Reports | OT Sessions, OT Summary, Engagement/Customer/Employee summaries, Activity Matrix |
| Project Tracker | All / Projects / POCs |
| Tasks | Tasks + templates; badge counts open tasks |
| Approvals (manager) | Leave / OT / Task-completion sub-tabs |
| Customers & Deals (manager) | Customers, Engagements, Professional Services, AMC Contracts |
| Catalog | Inventory, Certificates, Vendors & Products (mgr), Team Skills (mgr) |
| Team | Team Portfolio (also a **public** route at `/#/team`, no auth) |
| Settings | Admin Tools (mgr), Knowledge Base, OT Policy |

`/#/team` is the one route that renders without authentication (public-mode in `init.js`).

---

## 7. OT policy — the most complex business logic

⭐ **`calcOT()` in `js/features/overtime.js` is the single source of truth for all OT
band / rate / credit calculations. Never duplicate, inline, or rewrite the band logic.**
The live preview, save path, edit modals, and the manager Recompute tool all call it.
Related: `isWeekend()`, `getOTThresholds()`, `validateOTStart()` in the same file.

**Region differences** (`KSA_EMP = ['Salman Aziz','Mohammed Afsal']`):

| Region | Block window (weekday) | Weekend |
|---|---|---|
| UAE | 7:30 AM – 6:30 PM (Mon–Fri) | Sat + Sun |
| KSA | 8:00 AM – 7:00 PM (Sun–Thu) | Fri + Sat |

Weekday OT cannot fall **entirely** inside the block window (such sessions get 0 credit
and are rejected/auto-archived). Sessions that straddle the boundary get partial credit.

**Five bands** (trigger → rate → comp-off pool):

| Band | Trigger | Rate | Comp-Off pool |
|---|---|---|---|
| Early | Weekday, start 5 AM up to morning boundary | 1:1, capped at boundary | Eve+Early pool |
| Eve | Weekday, start at/after eve threshold, no midnight cross | 1:1 | Eve+Early pool |
| Eve/Split | Eve window + crosses midnight | Eve 1:1 + post-midnight 1:2, cap 8h | Eve+Early pool |
| Mid | Crosses midnight starting before eve threshold, OR starts before 5 AM | <4h raw = 1:1, ≥4h raw = 1:2 (cap 8h, capped at morning boundary) | Mid 1:2 pool only |
| Wknd | Weekend day | 1:1, no cap | Weekend pool (credited = raw hours) |

**Comp-off (v142):** 8 credited hours = 1 day, counted as **fractional days** with
**all CO-eligible pools combined** — `calcSummary` sums Eve+Early + Mid-1:2 + Weekend
credited hours and divides by 8 (Mid-1:1 excluded). Partial hours count immediately;
there is no per-pool flooring and no banking. (Pre-v142 this was `Math.floor` per
separate pool with partials banked forward — do **not** reintroduce that.) A mixed
weekday session covering both morning Early and evening Eve OT is stored as band `Eve`
but `bandBadge()` re-derives and renders both badges.

Full employee-facing rules: `docs/features/OT_Policy_Guide.md`.

### Manager admin tools (Settings → Admin Tools)
- **Policy Recompute** — re-runs `calcOT` on all sessions
- **Archive Policy Violators** — soft-archive sessions inside the block window
- **Re-evaluate Archived** — un-archive sessions that now qualify
- **Purge** — hard-delete archived/rejected rows >1 year old

> Comp-off balance can currently go negative if old approved sessions get recomputed away
> — documented gap, unhandled.

---

## 8. Auth & authorization (two-layer defense)

- **Auth:** Supabase Auth email + password. Manager invites users via the Supabase
  dashboard; first-time invitees are forced to set a password before entering (handled in
  `init.js` via `type=invite|recovery` hash detection). Forgot/Change password supported.
  Email confirmation is **OFF** in Supabase settings.
- **Identity mapping:** `user_profiles` maps `auth.users.email` → `employee_name` +
  `is_manager` + `is_backup_responsible`. Loaded at login (`fetchUserProfile`,
  `loadAllProfiles` in `auth.js`); drives `currentUser`, `isManager`, the `EMPLOYEES`
  list, and Sentry user/region tags.

**Layer 1 — UI:** hides manager-only sidebar items/buttons for non-managers (cosmetic).

**Layer 2 — Database RLS:** the real enforcement. Step-1 blocks anonymous access; Step-2
enforces per-row ownership via SQL helper functions `is_manager_user()` (checks JWT email
against `user_profiles.is_manager`) and `current_employee_name()`. See
`docs/security/rls_step2_per_row_ownership.sql`. Even direct API calls can't bypass it.

> `auth.js` includes `ensureAuthValid()` / `requireAuth()` — a pre-flight that catches a
> silently-dead Supabase session (which otherwise surfaces as a cryptic RLS `42501`
> error). Call `if (!await requireAuth()) return;` at mutation entry points.

### Permission summary

| Resource | Employee | Manager |
|---|---|---|
| OT sessions | Own only (view/edit/delete) | All |
| Leave / Comp-off | Own only | All + approvals |
| Sessions (unified) | All view; edit/delete own | All |
| Inventory | Add/edit; **no delete** | Full + delete |
| `inventory_activity_log` | — | Append-only (no UPDATE/DELETE policy on it) |
| KB articles | Submit; edit/delete own | All |
| Profiles, customers, engagements | Read | Manage |
| Admin tools, backup | None | Full |

---

## 9. Database

> **`BACKEND.md` (root) and `docs/schema.sql` are the source of truth. Read them before
> requesting or making any schema change** — the column or table may already exist.

Current tables (`docs/schema.sql`): `user_profiles`, `customers`, `vendors`,
`product_lines`, `engagements`, `engagement_milestones`, `amc_contracts`,
`amc_contract_engagements`, `ps_deals`, `ps_milestones`, `unified_sessions`,
`ot_sessions`, `annual_leave`, `leave_requests`, `comp_off_register`,
`comp_off_requests`, `inventory`, `inventory_activity_log`, `certificates`,
`employee_skills`, `kb_articles`, `notifications`, `dashboard_alert_snoozes`,
`team_members`, `tasks`, `task_assignments`, `task_templates`,
`task_template_assignees`, `backup_log`.

Key facts:
- **`unified_sessions`** is now the single source of truth for session data (the old
  `project_sessions` + `projects` tables were migrated in and dropped); the registry of
  customers/projects/POCs lives in **`engagements`**.
- `comp_off_register` / `annual_leave` are **balance** sources of truth; `*_requests`
  tables track the approval workflow. Approving inserts into the register table and sets
  the request `status='approved'`.
- All DB changes ship as **SQL to run manually in the Supabase SQL Editor** — there are no
  migrations run by the app. Note new SQL in `BACKEND.md`.
- Always check the Supabase `error` before using `data`.

### Bulk-import gotcha (don't duplicate rows)
Legacy SQL imports come as (1) a **dry-run SELECT** preview and (2) **batch INSERTs**.
Do **not** run the dry-run as `INSERT … SELECT` — the batch INSERTs already cover those
rows; doing so duplicates the first N. Tag every imported row with a unique `remarks`
marker (e.g. `Imported 2026-05-09 from <source> legacy log`) so one
`DELETE … WHERE remarks = '…'` rolls the whole import back. Existing imported data (e.g.
Landmark's 542 sessions / 949h) must not be re-imported.

---

## 10. Conventions & code rules

- **No `console.log` in production code** (except the deliberate `console.warn` on SW
  registration failure). Errors go to Sentry.
- **Use the shared helpers — never inline their logic:**
  - OT band/rate/credit → `calcOT()` only
  - Hour rounding → `r2(n)` (`Math.round(n*100)/100`). **Never** declare a local `var r2`
    — it shadows the global helper and breaks things silently.
  - Date display → `fmtDate()` (`01-Jan-2026`), `fmtTime()`, `fmtDateTime()`,
    `fmtDateRange()`
  - Number display → `fmtHours()`, `fmtDays()`, `fmtPct()`, `fmtCount()`, `fmtNumber()`
  - Currency → `fmtUsd()`, `fmtAed()`, `usdToAed()` (USD is stored; AED derived at
    `USD_TO_AED_RATE = 3.6725`, never persisted)
  - Toasts → `showToast()`; HTML-escape user text → `esc2()` (see Known Limitations)
- **Reuse existing constants** — don't hardcode magic numbers: `LEAVE_ALLOWANCE = 22`,
  `SICK_ALLOWANCE = 12`, `KSA_EMP`, `EMPLOYEES` (all in `state.js`).
- **`'DM Mono'` quoting trap:** using `'DM Mono'` inside a single-quoted JS string can
  break the parser in some contexts — prefer `DM Mono` unquoted (CSS allows it for font
  names) or escape carefully. This has bitten the codebase repeatedly.
- **Grouping:** new HTML screens use `<!-- ══ SCREEN NAME ══ -->` dividers; new JS
  sections use `// == SECTION ==` dividers. Match the surrounding style.
- **Mobile-first.** Breakpoints `@media(max-width:640px)` and `@media(max-width:380px)`.
  Use `.hide-mobile` to drop non-essential table columns; tables get `overflow-x:auto`;
  modals are bottom-sheets on mobile; form grids collapse to one column; stat cards stay
  2×2, dropping to 1 column under 380px.

### Brand tokens (CSS variables in `css/styles.css`)
Navy `#0A1F5C` (primary), Teal `#00A0D2` (accent/credited/success), Gold `#C8A832`
(warnings/eve), Success `#10B981`, Danger `#EF4444`, Background `#F8FAFC`.
Fonts: DM Sans (UI), DM Mono (hours, dates, codes, money).

---

## 11. Known limitations (deliberate — don't "fix" inline)

- **`esc2()` is an incomplete HTML escape** (`js/core/helpers.js` ~line 482). It escapes
  `'` and `"` only — **not** `<`, `>`, or `&`. A tactical fix wrapped user-typed fields in
  `esc2()` across the session tables/cards, closing the attribute-quote-break vector; the
  angle-bracket/ampersand gap remains. Risk is low (6 managed Auth users, no public input
  surface). A proper rewrite (split into `escHtml()` + `escJsAttr()`, migrate every
  callsite, regression-test the onclick Edit/Delete buttons in tracker rows, bump
  `CACHE_VERSION`) should happen **before** the app ever opens to broader/external input —
  as its own dedicated deploy, not a drive-by edit.
- **Two regions hardcoded** (UAE/KSA). Adding a third needs code changes — acceptable for
  the current team size.
- **No automated tests.** Only the manual runbooks in `docs/testing/`. Manually
  re-test OT/comp-off logic after any policy change.

---

## 12. Working style with the project owner

The primary user is a **beginner** (not fluent in terminal/SQL/git conventions). When
collaborating interactively:

1. **Explain the WHY** of each change briefly, in plain language.
2. **Backend before frontend.** Before writing frontend code, confirm whether a Supabase
   table/column exists. If it doesn't, the frontend will break — state the SQL first.
3. **No duplicate SQL.** Before giving INSERT statements, confirm the row/table isn't
   already there (running INSERTs twice creates duplicates). Tag imports (see §9).
4. **Phased, testable changes.** Prefer small, deployable increments over big-bang
   rewrites: plan → (backend SQL if needed) → frontend edit → test → deploy → verify live.
5. **Surface assumptions and trade-offs.** If multiple interpretations exist, present them
   rather than silently picking one. If a simpler approach exists, say so.
6. **Surgical changes.** Touch only what the task requires. Don't refactor, reformat, or
   "improve" adjacent code. Match existing style even if you'd do it differently. If you
   spot unrelated dead code or bugs, mention them — don't silently delete or rewrite.
7. **Production-grade quality.** Handle empty/loading/error states, validate inputs, think
   through real-world edge cases (double-clicks, no data, 1000+ rows, sessions crossing
   midnight or the block window). Don't ship "good enough."

---

## 13. Before any task — checklist

1. What does "done" look like for the user? What behavior changes / what do they see?
2. Which files/sections (`index.html` markup vs which `js/` module vs `css/styles.css`)
   need to change? What should **not** be touched?
3. Does it need a Supabase schema change? If yes, state the exact SQL and check
   `BACKEND.md`/`schema.sql` first to avoid duplicating a table/column.
4. Does it touch OT calculations or comp-off balances? If yes, it must go through
   `calcOT()` and you must run the manual runbook (`docs/testing/`) before pushing.
5. If the shell changed, bump the **version trio + whats-new.json** (§5).
6. Is there a phased path so it can be tested incrementally before going live?
