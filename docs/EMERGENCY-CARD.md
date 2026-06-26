# 🚨 NetSec Portal — Emergency Card

**Print this. Pin it. This is the one page you reach for when something breaks.**
Full guides: `recovery-guide-simple.md` (plain English) · `disaster-recovery.md` (detailed steps).

---

## First 5 minutes — stay calm

1. **Don't delete anything.** Most "outages" fix themselves; deleting makes it worse.
2. **Screenshot the error.** You'll want it.
3. **Check if it's just an outage:** Supabase → https://status.supabase.com · Cloudflare → https://www.cloudflarestatus.com
4. If a status page shows an outage → **wait**. Your data and code are safe. It comes back.
5. If it's not an outage → find the matching row below.

---

## What broke? → What to do

| Symptom | It's the… | Do this |
|---|---|---|
| A screen looks wrong after an update | App | Undo the last change in GitHub (revert the commit) → it re-publishes in ~30s. |
| Website is down / errors everywhere | App | Re-publish from GitHub (Cloudflare → re-deploy). Data is untouched. |
| Site hacked / defaced | App | Change GitHub + Cloudflare passwords → re-publish clean code from GitHub. |
| Can't log in / data won't load, but site shows | Data | Check Supabase status. If outage → wait. If project gone → run the **Data Restore** below. |
| Data corrupted / Supabase project deleted | Data | **Data Restore** below (needs your latest backup .zip). |
| Accidentally deleted records | Data | Restore those rows from the latest backup. |

---

## The 3 logins you must have (keep passwords safe)

| Account | URL | For |
|---|---|---|
| **GitHub** (`Forzateks`) | github.com | The app's master code |
| **Supabase** | supabase.com | The live database |
| **Cloudflare** | dash.cloudflare.com | Hosting that serves the app |

---

## Where things are

- **Latest data backup (.zip):** ____________________ (cloud drive) AND ____________________ (lab server)
- **Latest certificate-PDF export:** ____________________
- **App code:** GitHub → `Forzateks/Netsec-portal`
- **Live site:** https://netsec-portal.pages.dev
- **Supabase project ref:** `rxxcrlobbtlvjgcqgjjm`

---

## Data Restore — short version (full steps in disaster-recovery.md)

1. Take ONE more backup if Supabase is still reachable (freshest wins).
2. New empty Supabase project.
3. Run `docs/schema.sql` (structure) → then the backup's `.sql` (data).
4. Re-create the **`certificates`** Storage bucket (private) and re-upload the cert PDFs.
5. Re-invite the team by email (Authentication → Invite).
6. Update the Supabase URL + key in `js/core/state.js`, push to GitHub → app re-publishes.
7. Log in, spot-check. Take a fresh backup of the recovered system.

⏱ ~45 minutes following the runbook.

---

## App Re-publish — short version

- App code is **always safe in GitHub**. Cloudflare just serves a copy.
- Re-deploy: Cloudflare → Pages project → **Retry/Create deployment**, or push any commit.
- If the Cloudflare Pages project is **gone**: create a new Pages project →
  connect repo `Forzateks/Netsec-portal` → branch **master** → **Framework preset: None**,
  **Build command: empty**, **Output directory: `/` (root)**. (Details in disaster-recovery.md.)

---

## How much could we lose?

- **Data:** at most everything since your **last backup**. Back up weekly → lose at most a week.
- **App code:** nothing — every version is in GitHub forever.

> **The one habit that makes all of this work: take a Full Backup every week and keep the last several.**
