# Cross-Region OT Timezone Shift (Team-Member Fan-Out)

**Date:** 2026-08-01
**Status:** Approved, pending implementation
**Area:** `js/features/unified-sessions.js` only. `js/features/overtime.js` (`calcOT()` and friends) is NOT modified.

## Problem

When a unified session (Project/POC/AMC/Support/Pre-Sales/Customer Testing) is logged with
multiple team members, each member gets their own `ot_sessions` row via `_buildMemberOTRow()`,
called once per member with the **same literal `date`/`start`/`end` strings** the logger typed,
just swapping in each member's name so `calcOT()` picks up their region's thresholds
(`getOTThresholds()`).

That's correct only when every team member shares the logger's region. It's wrong when they
don't: UAE (UTC+4) and KSA (UTC+3) are different real-world time zones (fixed year-round, neither
observes DST), so the same literal clock string does not represent the same real-world instant in
both regions.

**Concrete case:** Mohammed Nasif (UAE) logs a joint call as 5:00–10:00 AM (his local time) and
adds Mohammed Afsal (KSA) as a team member. The real-world-simultaneous time for Afsal is
4:00–9:00 AM KSA local. Today's code computes Afsal's credit on the literal "5:00–10:00" against
KSA's 8:00 AM block-window start → 3h credited. The correct, timezone-shifted calculation
(4:00–9:00 against the same 8:00 AM boundary) gives 4h. Afsal is short exactly the 1-hour
UAE/KSA offset.

## Goal

For team members whose region differs from the session logger's region, shift the clock time fed
into `calcOT()` by the fixed UAE↔KSA offset before computing their credit, so each member's OT is
calculated against their own real local time. Same-region members (the overwhelming majority of
sessions — a 6-person team with only 2 KSA-based employees) are completely unaffected.

## Non-goals

- **No retroactive recompute.** Confirmed with the user: this only changes sessions saved or
  edited from the moment this ships. Already-logged sessions (including the one that surfaced
  this bug) are left exactly as they are — no automated fix-up tool, no manual "reprocess"
  option. If a manager wants a specific past session corrected, they'd re-save it through the
  normal Edit flow, which now runs the corrected logic.
- **`calcOT()` itself is not touched.** It remains the single, protected source of truth for
  band/rate/credit logic (CLAUDE.md §7). This fix operates entirely in its caller
  (`unified-sessions.js`), by correcting what gets passed in.
- **No third region / no configurable offset.** The 1-hour UAE↔KSA offset is hardcoded, matching
  the existing "two regions hardcoded" limitation already documented in CLAUDE.md §11.
- **No change to the unified_sessions record itself.** The parent session row (what the logger
  typed, e.g. "5:00 AM–10:00 AM UAE") is the meeting record and stays as entered. Only each team
  member's own derived `ot_sessions` row is shifted.
- **No transparency note/annotation** in the OT row's activity text explaining the shift
  happened. The member's `ot_sessions` row already shows their own correct local start/end time,
  band, and credited hours — that's self-explanatory without extra copy. Can be revisited later
  if it causes confusion in practice.
- **`validateOTStart()` / manual single-employee OT entry** (Sessions → log a plain OT session,
  not via unified session team fan-out) is out of scope — that flow has always been one person
  entering their own local time directly; there's no cross-region ambiguity there.

## Design

### 1. Region + offset helpers (new, in `unified-sessions.js`)

```js
function _employeeRegion(name) {
  return KSA_EMP.indexOf(name) !== -1 ? 'KSA' : 'UAE';
}

// UAE = UTC+4, KSA = UTC+3, both fixed year-round (no DST in either country).
// Returns the hours to ADD to the logger's literal clock time to get the
// team member's own real local clock time. 0 when same region.
function _regionShiftHours(loggerName, memberName) {
  var lr = _employeeRegion(loggerName), mr = _employeeRegion(memberName);
  if (lr === mr) return 0;
  return lr === 'UAE' ? -1 : 1; // UAE logger -> KSA member: -1h. KSA logger -> UAE member: +1h.
}
```

### 2. Clock-shift helper with day rollover (new, in `unified-sessions.js`)

Pure calendar arithmetic via `Date.UTC` — never reads the browser's local timezone, only used as
a day-counter, consistent with the existing `WEEKEND_OVERRIDES` convention of treating
`'YYYY-MM-DD'` as a plain lexical/calendar value rather than feeding it through local-timezone
`Date()` parsing.

```js
// Shifts 'HH:MM' by hoursDelta (integer, e.g. -1, 0, +1), rolling the date
// string forward/back a day if the shift crosses midnight.
function _shiftClock(dateStr, timeStr, hoursDelta) {
  if (!hoursDelta) return { date: dateStr, time: timeStr };
  var dp = dateStr.split('-').map(Number), tp = timeStr.split(':').map(Number);
  var totalMin = tp[0]*60 + tp[1] + hoursDelta*60;
  var dayDelta = Math.floor(totalMin / 1440);
  totalMin = ((totalMin % 1440) + 1440) % 1440;
  var d = new Date(Date.UTC(dp[0], dp[1]-1, dp[2] + dayDelta));
  var newDate = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
  var newTime = String(Math.floor(totalMin/60)).padStart(2,'0') + ':' + String(totalMin%60).padStart(2,'0');
  return { date: newDate, time: newTime };
}
```

### 3. `_buildMemberOTRow()` gains a `loggerName` parameter

Current signature (`js/features/unified-sessions.js:583`):
```js
function _buildMemberOTRow(memberName, date, start, end, isEng, customer, engagementName, actType, info) {
```

New signature — `loggerName` inserted as the 2nd parameter:
```js
function _buildMemberOTRow(memberName, loggerName, date, start, end, isEng, customer, engagementName, actType, info) {
  if (!EMPLOYEES || EMPLOYEES.indexOf(memberName) === -1) {
    console.warn('Team member "'+memberName+'" not in EMPLOYEES — OT auto-gen skipped');
    return { unknown: true, name: memberName };
  }
  var shift   = _regionShiftHours(loggerName, memberName);
  var sAnchor = _shiftClock(date, start, shift);   // { date, time } — anchor date follows the START shift
  var eTime   = _shiftClock(date, end, shift).time; // only need the end CLOCK time; calcOT infers
                                                      // midnight-crossing itself from start vs end
  var c = calcOT(sAnchor.date, sAnchor.time, eTime, memberName);
  if (!c || !c.credited || c.credited <= 0) return null;
  var activityLabel = isEng
    ? ((customer || '') + ' / ' + (engagementName || '-') + ' — ' + info)
    : info;
  return {
    employee:        memberName,
    activity:        activityLabel,
    ot_date:         sAnchor.date,
    start_time:      sAnchor.time,
    end_time:        eTime,
    day_name:        c.dayName,
    band:            c.band,
    rate:            c.rate,
    duration_hours:  c.duration,
    credited_hours:  c.credited,
    customer_name:   isEng ? (customer || null) : null,
    project_name:    isEng ? engagementName     : null,
    activity_type:   isEng ? (actType || null)  : null,
    _calc:           c
  };
}
```

Why the end time's own rolled-over date is discarded: `calcOT()` takes a single anchor date and
infers midnight-crossing purely from comparing the start/end fractional hours (`ef<=sf`) — it has
no separate "end date" parameter. Shifting both start and end clock times by the identical delta
and anchoring on the (possibly rolled-back/forward) start date reproduces exactly the semantics
`calcOT` already expects, and correctly re-derives whether the *shifted* session crosses midnight
(which can flip in either direction relative to the original — see Testing scenarios 3–4).

### 4. Call site updates — pass `loggerName` through

Three call sites in `js/features/unified-sessions.js`, all adding the logger name as the 2nd
argument (no other changes):

| Location | Logger value | Team fan-out? |
|---|---|---|
| `saveUnifiedSession()` — engagement/Customer Testing path, ~line 771 | `currentUser` | Yes, loop over `_buildTeamList(currentUser, teamMembers)` |
| `saveUnifiedSession()` — Internal-session path, ~line 793 | `currentUser` | No (logger-only call; shift is always 0 since `memberName === loggerName`, included for signature consistency) |
| Edit-session save flow — engagement/Customer Testing path, ~line 1181 | `sessionEmployee` (the original session's owner, read from the DB row, not the editor) | Yes, loop over `_buildTeamList(sessionEmployee, team)` |

`sessionEmployee` (not `currentUser`) is deliberately used as the logger reference in the edit
path — a manager editing someone else's session must not shift times relative to the *manager's*
region; the session's actual owner is always the "logger" reference point, matching how the
existing code already treats `sessionEmployee` for the office/OT split (`splitSessionHours(date,
start, end, sessionEmployee)`).

## Data flow summary

```
saveUnifiedSession() / edit-session save flow
  team = _buildTeamList(loggerName, teamMembersCsv)   // unchanged
  team.forEach(memberName =>
    _buildMemberOTRow(memberName, loggerName, date, start, end, ...)
      shift = _regionShiftHours(loggerName, memberName)     // NEW: 0 unless regions differ
      (sAnchor, eTime) = shift clock by `shift` hours, with day rollover  // NEW
      calcOT(sAnchor.date, sAnchor.time, eTime, memberName)  // unchanged calcOT, corrected inputs
  )
  → ot_sessions row per member, storing the MEMBER'S OWN shifted date/start/end/day_name
```

Everywhere a member's own OT row is displayed — My Sessions list, the "i" calculation-detail
popover (`explainOT()`), band badges, OT Summary — already reads straight from the stored
`ot_sessions` row, so showing each member their own correct local time requires no separate
display-layer change; it falls out of storing the shifted values.

## Testing

Manual — no automated tests in this repo (`docs/testing/`).

1. **The reported case:** UAE employee logs 5:00–10:00 AM, adds a KSA team member. Confirm the
   KSA member's `ot_sessions` row shows `04:00–09:00`, band `Early`, credited `4.00h` (not the
   uncorrected 3h). Confirm the UAE logger's own row is unaffected: `05:00–10:00`, credited
   `2.50h`.
2. **Reverse direction:** KSA employee logs a session, adds a UAE team member. Confirm the UAE
   member's row is shifted +1h relative to the literal typed time, and the KSA logger's own row
   is unchanged.
3. **Midnight rollback (UAE logger, KSA member):** UAE logger logs `00:15`–`00:45` (same-day,
   no crossing). Confirm the KSA member's row lands on the PREVIOUS calendar date, `23:15`–`23:45`
   (still same-day for them, no crossing), with weekend/weekday band picked per that member's own
   shifted date (relevant if the shift crosses a Thu/Fri or Sun/Mon regional weekend boundary).
4. **Midnight-crossing flips (KSA logger, UAE member):** KSA logger logs a session that crosses
   midnight in KSA's frame, e.g. `23:45`–`00:15`. Confirm the UAE member's shifted times
   (`00:45`–`01:15`) land entirely within a single UAE calendar day (crossing resolved away by
   the shift) and credit is computed accordingly — not double-counted or dropped.
5. **Same-region team (the common case):** a session with only same-region team members (e.g. all
   4 UAE employees) produces byte-identical `ot_sessions` rows to before this change — `shift`
   evaluates to 0 for every member, so `_shiftClock` short-circuits and returns the input
   unchanged.
6. **Editing an existing cross-region session:** edit a session's time on a session that has a
   KSA team member; confirm their OT row recalculates with the new shifted time (not the raw
   edited time), and the existing "approved OT will reset to pending" warning still fires
   correctly when their credited hours actually change.
7. **Zero-credit member after shift:** construct a case where a member had nonzero credit under
   the old (unshifted) logic but the shift moves their window entirely inside their own region's
   block hours (credit becomes 0) — confirm their row is simply not created (or removed, if
   editing), matching the existing "member's region yields zero credit" behavior.
8. **Unknown member unaffected:** a team member not in `EMPLOYEES` still short-circuits to the
   existing `{unknown: true, name}` path before any shift logic runs.
9. **Existing sessions untouched:** confirm no batch/background process runs against previously
   saved `ot_sessions` rows — this ships as pure forward-looking logic with no migration, no
   "Recompute"-style tool.
