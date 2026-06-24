# Overtime Policy — Employee Guide

**Gulf IT / Gulfit Network Distribution FZC**
*Effective: 2026-04*

---

## 1. The basics

Overtime (OT) is logged through the **NetSec Portal** at https://netsec-portal.pages.dev/. Each session goes through three stages:

1. **You log it** → status: *Pending*
2. **Manager reviews** → status: *Approved* or *Rejected*
3. **Approved hours convert into Comp Off (CO) days** at **8 credited hours = 1 day**

Comp Off is taken as time off in lieu of payment. There is no monetary OT payout and no work-from-home equivalent.

---

## 2. When OT can be logged

### Weekday rule — regular working hours are *not* OT

| Region | OT cannot start between |
|---|---|
| UAE (Ahmed, Venkatesan, Prasanth, Mohammed Nasif) | **7:30 AM – 6:30 PM** |
| KSA (Salman Aziz, Mohammed Afsal) | **8:00 AM – 7:00 PM** |

If you try to submit a session with a start time inside this window, the form will reject it with an explanation. The portal blocks both new submissions and edits.

### Weekend rule

| Region | Weekend days |
|---|---|
| UAE | Saturday, Sunday |
| KSA | Friday, Saturday |

Weekend OT can start any time of day — no block window applies on weekends.

---

## 3. The five OT bands

Each session is automatically classified into one band based on date and start time. The band determines the rate and how Comp Off is calculated.

### 🟢 Early Morning

- **When:** Weekday, start time **5:00 AM – 7:29 AM** (UAE) / **5:00 AM – 7:59 AM** (KSA)
- **Rate:** 1:1 always
- **Credit cap:** Up to the regular-hours boundary (UAE 7:30 AM / KSA 8:00 AM). Time after that is regular work, not OT.
- **CO conversion:** 8 credited hours = 1 day. **Pools with Eve hours.**

**Example (UAE):** Ahmed works 7:00 AM – 10:00 AM on a Tuesday.
- Block boundary: 7:30 AM
- Credited: **0.5 hours** (only 7:00–7:30)
- Hours from 7:30 AM onward count as regular working hours.

**Example (KSA):** Salman works 6:00 AM – 9:00 AM on a Sunday.
- Block boundary: 8:00 AM
- Credited: **2 hours** (only 6:00–8:00)

### 🔵 Eve (Evening)

- **When:** Weekday, start time **after 6:30 PM** (UAE) / **after 7:00 PM** (KSA), session ends the same day
- **Rate:** 1:1 always
- **CO conversion:** 8 credited hours = 1 day. **Pools with Early hours.**

**Example (UAE):** Prasanth works 7:00 PM – 11:00 PM on a Wednesday.
- Credited: **4 hours**

### 🟡 Eve/Split (Evening crossing midnight)

- **When:** Starts in the Eve window AND crosses midnight
- **Rate:** Eve portion at 1:1 + post-midnight portion at 1:2 (doubled)
- **Cap:** 8 credited hours total
- **CO conversion:** 8 credited hours = 1 day

**Example:** Session 9:00 PM – 1:00 AM
- Eve portion: 9:00 PM – midnight = 3h × 1 = 3h credit
- Mid portion: midnight – 1:00 AM = 1h × 2 = 2h credit
- Total credited: **5 hours**

### 🟣 Midnight

- **When:** Either crosses midnight starting before the Eve threshold, *or* starts before 5:00 AM weekday
- **Rate:**
  - Less than 4 hours raw: 1:1
  - 4 hours or more raw: 1:2 (qualifies for Comp Off)
- **Credit cap:** Up to the morning block boundary (UAE 7:30 AM / KSA 8:00 AM)
- **CO conversion:** 8 credited hours from 1:2 sessions = 1 day. 1:1 hours don't earn CO.

**Example (UAE):** Session 11:00 PM – 8:30 AM.
- Raw hours: 9.5
- Block boundary: 7:30 AM next day
- Credited: 11:00 PM–midnight (1h) + midnight–7:30 AM (7.5h) = **8.5 hours**

### 🟠 Weekend

- **When:** Sat/Sun (UAE) or Fri/Sat (KSA)
- **Rate:** 1:1 always
- **Credited:** Equals actual hours worked. No cap, no doubling.
- **CO conversion:** 8 credited hours = 1 day

**Example:** Ahmed works 5:00 AM – 8:30 PM on a Saturday.
- Credited: **15.5 hours** → 15.5 ÷ 8 = **1.94 CO days** (fractional; counted immediately)

### ⚪ Day

- **When:** Anything that doesn't match the above (rare, given the weekday block)
- **Rate:** 1:1
- **No Comp Off.** Logged for record-keeping only.

---

## 4. Comp Off — how days are earned

Approved sessions convert to Comp Off at **8 credited hours = 1 day**, counted as
**fractional days** — partial hours count immediately, there's no rounding down and
nothing is "banked" waiting to cross a threshold.

**All CO-eligible credited hours are summed together** and divided by 8:

```
CO days earned  =  (Eve + Early + Eve/Split + Midnight 1:2 + all Weekend hours) ÷ 8
```

| Counts toward CO | Does **not** count |
|---|---|
| Eve, Early, Eve/Split hours | Midnight **1:1** (raw < 4h) — tracked for record only |
| Midnight **1:2** hours (raw ≥ 4h) | |
| Weekend 1:1 + 1:2 hours | |

Examples:
- 5h Eve + 4h Early = 9h → **1.13 CO days**
- 6.48h Weekend = **0.81 CO days**
- 7h Eve+Early + 6.48h Weekend (across the year) = 13.48h → **1.69 CO days**

> **Policy change (v142):** comp-off used to be whole days per separate pool, with
> partial hours banked toward the next full day. As of v142 all eligible hours are
> combined and counted as fractional days, so partials are credited right away.
> Balances are computed live from your sessions — there's no migration, the new
> total simply reflects every eligible hour.

---

## 5. Submitting a session

1. Open **Overtime → Log Session**
2. Select **Customer**, **Project**, and **Activity Type** (mandatory)
3. Enter activity description, date, start and end time
4. Live preview shows the calculated **Band**, **Duration**, **Rate**, and **Credited hours** before you save
5. Click **Save Session** — status will be *Pending*

If your start time is in the block window, the save will be rejected with a clear error.

---

## 6. After submitting

- **Manager reviews** in the Approvals tab
- If **approved**: hours count toward your CO balance immediately
- If **rejected**: a comment from the manager appears on the session, and it doesn't count
- If **archived** (auto, by policy review): the session stays visible (dimmed) with the reason recorded — typically because it falls in the weekday block window from a historical sweep

You can check status any time at **Overtime → Sessions**.

---

## 7. Frequently asked questions

**Q: What if I start work at 7:00 AM and finish at 10:00 AM on a weekday?**
A: Only 7:00 AM – 7:30 AM (UAE) or 7:00 AM – 8:00 AM (KSA) counts as OT. The rest is regular hours. Credited: 0.5h (UAE) or 1h (KSA).

**Q: What if a Mid session ends at 9:00 AM?**
A: The hours after the morning boundary (7:30 AM UAE / 8:00 AM KSA) don't count as OT. Only the time before the boundary is credited.

**Q: Why do my old (pre-2026) weekend hours still show 8h credited even when I worked longer?**
A: Pre-2026 sessions follow the previous policy (8h cap on weekend). New policy uncaps weekend hours but does not retroactively change historical records unless the manager re-runs a recompute.

**Q: Do partial hours count, or do I lose them?**
A: They count. Every CO-eligible credited hour converts at 8h = 1 day as a fractional
day, so there's nothing to "lose" or wait for — a 6.48h weekend session is 0.81 of a
CO day straight away.

**Q: Can I take Comp Off on the same day I earned it?**
A: No — Comp Off must be requested separately and approved by the manager.

**Q: What if I forgot to log a session on time?**
A: Log it as soon as possible. Backdated submissions are allowed, but the manager may follow up if the gap is unusual.

---

## 8. Need help?

Contact the manager (Venkatesan) or **Mohammed Nasif** (`nasif@gulfitd.com`) for portal issues, password resets, or policy questions.
