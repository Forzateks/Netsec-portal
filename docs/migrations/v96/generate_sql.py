"""
Reads migration_plan.json and emits migration_apply.sql — one transactional
block (BEGIN ... COMMIT) that:
  1. INSERTs each task + its assignees (via chained CTE so we keep the
     returned id without round-tripping).
  2. INSERTs each template + its default assignees.

Notes:
  - created_by is hard-coded 'Venkatesan' for every row. The [MIG-v96]
    remarks tag is the authoritative migration marker; created_by is
    informational, and Venkat is the natural owner of cleanup work.
  - Empty-assignee tasks/templates are inserted with a plain INSERT
    (no task_assignments row). The validation report already counts
    these — they will need to be edited in the UI later.
  - frequency for tasks always lands as 'general' (per JSON output).
  - Strings are escaped via the standard double-single-quote pattern.
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
SRC  = HERE / "migration_plan.json"
OUT  = HERE / "migration_apply.sql"

def q(s):
    """SQL string literal or NULL."""
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def q_date(s):
    if s is None: return "NULL"
    return q(s) + "::date"

plan = json.loads(SRC.read_text(encoding="utf-8"))
lines = []
lines.append("-- v96 task data migration — generated from migration_plan.json")
lines.append("-- Tag every imported row with [MIG-v96] in remarks for clean rollback:")
lines.append("--   DELETE FROM public.tasks          WHERE remarks LIKE '[MIG-v96]%';")
lines.append("--   DELETE FROM public.task_templates WHERE remarks LIKE '[MIG-v96]%';")
lines.append("-- (CASCADE FKs will clear assignment + template_assignee rows.)")
lines.append("")
lines.append("BEGIN;")
lines.append("")

# ---- Tasks (155) ---------------------------------------------------
lines.append("-- ===== TASKS (" + str(len(plan["tasks"])) + ") =====")
for i, t in enumerate(plan["tasks"], 1):
    cols = [
        ("title",       q(t["title"])),
        ("description", q(t["description"])),
        ("priority",    q(t["priority"])),
        ("status",      q(t["status"])),
        ("frequency",   q(t["frequency"])),
        ("start_date",  q_date(t["start_date"])),
        ("eta_date",    q_date(t["eta_date"])),
        ("end_date",    q_date(t["end_date"])),
        ("remarks",     q(t["remarks"])),
        ("created_by",  q("Venkatesan")),
    ]
    col_names  = ", ".join(c for c, _ in cols)
    col_values = ", ".join(v for _, v in cols)
    assignees = t["assignees"] or []
    if assignees:
        arr = "ARRAY[" + ", ".join(q(a) for a in assignees) + "]::text[]"
        lines.append(
            f"WITH t_{i} AS ("
            f"INSERT INTO public.tasks ({col_names}) VALUES ({col_values}) RETURNING id"
            f") INSERT INTO public.task_assignments (task_id, assigned_to) "
            f"SELECT id, unnest({arr}) FROM t_{i};"
        )
    else:
        lines.append(
            f"INSERT INTO public.tasks ({col_names}) VALUES ({col_values});"
        )

lines.append("")
# ---- Templates (10) ------------------------------------------------
lines.append("-- ===== TEMPLATES (" + str(len(plan["templates"])) + ") =====")
for i, tpl in enumerate(plan["templates"], 1):
    cols = [
        ("title",       q(tpl["title"])),
        ("description", q(tpl["description"])),
        ("frequency",   q(tpl["frequency"])),
        ("remarks",     q(tpl["remarks"])),
        ("created_by",  q("Venkatesan")),
        ("is_active",   "true"),
    ]
    col_names  = ", ".join(c for c, _ in cols)
    col_values = ", ".join(v for _, v in cols)
    assignees = tpl["assignees"] or []
    if assignees:
        arr = "ARRAY[" + ", ".join(q(a) for a in assignees) + "]::text[]"
        lines.append(
            f"WITH tpl_{i} AS ("
            f"INSERT INTO public.task_templates ({col_names}) VALUES ({col_values}) RETURNING id"
            f") INSERT INTO public.task_template_assignees (template_id, assigned_to) "
            f"SELECT id, unnest({arr}) FROM tpl_{i};"
        )
    else:
        lines.append(
            f"INSERT INTO public.task_templates ({col_names}) VALUES ({col_values});"
        )

lines.append("")
lines.append("COMMIT;")
lines.append("")

OUT.write_text("\n".join(lines), encoding="utf-8")

# Compute expected counts the verifier will check against.
total_tasks      = len(plan["tasks"])
total_templates  = len(plan["templates"])
total_task_assns = sum(len(t["assignees"]) for t in plan["tasks"])
total_tpl_assns  = sum(len(t["assignees"]) for t in plan["templates"])
empty_tasks      = sum(1 for t in plan["tasks"]      if not t["assignees"])
empty_templates  = sum(1 for t in plan["templates"]  if not t["assignees"])

print(f"Wrote {OUT}")
print(f"  Tasks:               {total_tasks}")
print(f"  Templates:           {total_templates}")
print(f"  Task assignments:    {total_task_assns}")
print(f"  Template assignees:  {total_tpl_assns}")
print(f"  Empty-owner tasks:     {empty_tasks}")
print(f"  Empty-owner templates: {empty_templates}")
print(f"  SQL size: {OUT.stat().st_size} bytes / {len(lines)} lines")
