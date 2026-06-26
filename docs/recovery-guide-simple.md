# NetSec Portal — Recovery Guide (Plain English)

**Who this is for:** the manager and anyone non-technical who needs to understand
*"if something goes wrong, are we safe, and how do we get back?"*

This is the simple overview. The exact click-by-click steps live in
[`disaster-recovery.md`](disaster-recovery.md) — but read this first.

---

## 1. The app is made of two halves

Think of it like a shop:

| Half | The shop analogy | What it actually is | Where it lives |
|---|---|---|---|
| **The app (frontend)** | The building, shelves, signs, layout — what people see and click | The screens, buttons, and logic (the website itself) | **GitHub** (master copy) → served live by **Cloudflare** |
| **The data (backend)** | The stock and the records — OT hours, leave, tasks, inventory, customers | The database + logins + uploaded files | **Supabase** |

The two are **separate**. If one breaks, the other is usually fine. That's good news —
it means a problem is rarely "everything is gone," it's usually "one half needs restoring."

Each half has its own **safety net**:

- The app is protected by **GitHub**.
- The data is protected by **Backups**.

Understand those two safety nets and you understand recovery. The rest of this guide
is just *"which net catches which problem."*

---

## 2. Safety net #1 — GitHub (protects the app)

**What GitHub is, simply:** a free, cloud-based vault that stores every version of the
app's code. Every single change we make is saved as a **commit** — a labelled snapshot
with the date, what changed, and who changed it. Nothing is ever overwritten; old
versions stay forever.

**Why it matters:**

- The live website (on Cloudflare) is just a **copy** of what's in GitHub. Cloudflare
  automatically re-publishes whenever GitHub changes. So **GitHub is the real master copy** —
  Cloudflare is just the shop window.
- If the live site breaks, gets a bad change, or even vanishes entirely, we can rebuild
  it from GitHub in **a minute or two**.
- Because every change is a saved snapshot, we can also **rewind time** — undo a bad
  update and go back to exactly how the app was last week, or last month.
- It's not on anyone's laptop. If a laptop is lost or someone leaves, the code is safe
  in GitHub.

**The one thing you must protect:** the GitHub login (account `Forzateks`, repository
`Forzateks/Netsec-portal`). Keep the password safe and, ideally, turn on two-factor
authentication.

> **Plain takeaway:** as long as we have the GitHub account, the *app itself can never
> truly be lost.* The worst case is a short outage while we re-publish it.

---

## 3. Safety net #2 — Backups (protect the data)

**What a backup is, simply:** a downloaded file (a `.zip`) containing a complete copy of
all your data — every OT session, leave request, task, customer, inventory item, etc. —
frozen at the moment you took it.

**How to take one:** log in as the manager → **Admin Tools → Full Backup**. It downloads
a `.zip` with:

- An **Excel file** you can open and read like a spreadsheet.
- A **technical `.sql` file** used to reload everything during a real recovery.

**Why it matters:** Supabase (where the live data lives) is run by a company. It's
reliable, but it's not *ours*. If it ever has a serious problem — outage, account locked,
data corrupted, or someone deletes the project — the only way to get the data back is
from a backup **you** took. **No backup = no recovery of data.**

**The golden rules for backups:**

1. **Take them regularly.** Weekly is a sensible minimum for a 6-person team. After a busy
   month-end, take one too.
2. **Keep them in two places.** E.g. one copy on a cloud drive (Google Drive / OneDrive)
   and one on the **lab server**. If one location is lost, the other survives.
3. **A backup is only as fresh as the last one you took.** If your newest backup is from
   3 weeks ago, a disaster means you lose 3 weeks of data. Recent backups = small loss.

> **Two things a backup does NOT include** (be aware):
> - **User logins** — after a restore, each person is simply re-invited by email and sets
>   a new password. Their history is untouched.
> - **Uploaded certificate PDFs** — the *records* of certificates are backed up, but the
>   actual PDF files are stored separately. If those files matter, download them from
>   Supabase → Storage occasionally and keep them with your backups.

---

## 4. What can go wrong — and which net catches it

| What happened | How bad | Which half | How we recover | Roughly how long |
|---|---|---|---|---|
| **A bad update broke a screen** | Low | App | Rewind to the previous GitHub version (revert the commit). | Minutes |
| **The live website is down / showing errors** | Low–Medium | App | Re-publish from GitHub to Cloudflare. | Minutes |
| **Someone hacked or defaced the site** | Medium | App | Change the passwords, then re-publish the clean version from GitHub. Old versions in GitHub are untouched. | Minutes–1 hour |
| **Supabase is having a temporary outage** | Medium | Data | Usually just wait — Supabase comes back and data is intact. Don't panic, don't delete anything. | Until they fix it |
| **Supabase data corrupted / project deleted / account locked** | High | Data | Create a fresh Supabase, load the **latest backup** into it, re-invite users, point the app at it. | ~30–45 min |
| **Someone accidentally deleted important records** | Medium | Data | Restore those records from the most recent backup. | Varies |
| **A laptop is lost / an employee leaves** | Low | Neither | Nothing important lives on laptops — it's all in GitHub + Supabase + Cloudflare. Just remove their access. | Minutes |
| **Both halves lost at once** (very rare) | High | Both | Do the data recovery (above) *and* re-publish the app from GitHub. They're independent steps. | ~1 hour |

**The reassuring pattern:** almost every row above is fixed by one of just two actions —
*"re-publish from GitHub"* (for the app) or *"load the latest backup"* (for the data).

---

## 5. The two recovery stories, step by step (simple version)

### Story A — "Supabase went down / we lost the data"

1. **Stay calm and don't delete anything.** If Supabase is just having an outage, the
   data is fine — wait for them to recover. Check https://status.supabase.com.
2. If the data is genuinely lost or the project is gone, grab your **most recent backup
   `.zip`**.
3. Create a **new, empty Supabase project**.
4. Load the structure (`schema.sql`, kept in GitHub) and then the **data** from your
   backup `.zip` into it.
5. **Re-invite the team** by email so everyone can log in again.
6. Point the app at the new Supabase (a small one-line change in the code, pushed to
   GitHub — Cloudflare re-publishes automatically).
7. Everyone logs in; history is back.

→ The exact clicks are in [`disaster-recovery.md`](disaster-recovery.md), Steps 1–9.
The whole thing is roughly **30–45 minutes** for someone following the runbook.

### Story B — "The website broke / disappeared / was attacked"

1. **The app's master copy is safe in GitHub** — this is the whole point of GitHub.
2. If it's a **bad change**, rewind to the last good version (revert the commit) and push.
   Cloudflare re-publishes the good version in ~30 seconds.
3. If the live site is **gone or attacked**, change the Cloudflare + GitHub passwords,
   then re-connect GitHub to Cloudflare (or trigger a fresh publish). It rebuilds from
   the clean code in GitHub.
4. **None of your data is touched** in this scenario — the data lives in Supabase, a
   separate place. You're only rebuilding the screens.

> **This is why GitHub matters so much:** the app can be re-created from it at any time,
> at any past version. Without GitHub, a broken or deleted website would mean rebuilding
> from scratch.

---

## 6. The 5-minute prevention checklist (do these, sleep well)

- [ ] **Take a Full Backup regularly** (weekly + after big changes). Admin Tools → Full Backup.
- [ ] **Store each backup in two places** — cloud drive *and* the lab server.
- [ ] **Protect three logins** and write down who has them: **GitHub**, **Supabase**,
      **Cloudflare**. Turn on two-factor authentication where possible.
- [ ] **Keep `docs/schema.sql` up to date** in GitHub (the tech person does this whenever
      the database structure changes — it's needed to rebuild the database).
- [ ] **Once a quarter, do a practice run** of the data recovery on a throwaway Supabase
      project (see the drill section in the technical runbook). The first real recovery
      should not be the first time anyone tries it.
- [ ] **Occasionally download the certificate PDFs** from Supabase → Storage if those
      files matter to you.

---

## 7. What you need access to (keep this list safe)

| Thing | What it's for | Where |
|---|---|---|
| **GitHub account** (`Forzateks`) | The app's master code — re-publishing & rewinding | github.com |
| **Supabase account** | The live database — outages & restoring | supabase.com |
| **Cloudflare account** | Hosting that serves the app to users | dash.cloudflare.com |
| **Latest backup `.zip`** | Your data, to restore after a Supabase loss | Cloud drive + lab server |
| **A password manager** | Holds the three logins above safely | — |

If you can get into those three accounts and you have a recent backup, **you can recover
from anything on this page.**

---

*Need the detailed, click-by-click steps? See [`disaster-recovery.md`](disaster-recovery.md).*
