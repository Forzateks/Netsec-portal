-- ═══════════════════════════════════════════════════════════════════
-- RLS Hardening — Step 2: per-row ownership
-- Date: 2026-04-30
--
-- Tightens Step 1 (auth-only) to per-row ownership:
--   * Employees see/edit only their own OT, leave, comp-off rows
--   * Manager sees/edits everything
--   * Approval write-throughs (comp_off_register, annual_leave) are
--     manager-only since those tables are system-written on approve
--   * Project sessions, inventory, KB stay collaborative (any auth
--     can read; ownership applies on write/delete)
--   * Manager flag is required for projects/customers/user_profiles writes
--
-- BEFORE running:
--   1. Take a Full Backup from Dashboard.
--   2. Confirm Venkatesan has is_manager = TRUE in user_profiles.
--   3. Smoke-tested Step 1.
--
-- AFTER running:
--   Run runbook section A (auth) and B-extra (save an OT session)
--   end-to-end as both manager and employee. If anything 403s, paste
--   the rollback block at the bottom.
-- ═══════════════════════════════════════════════════════════════════

-- ── HELPER FUNCTIONS ──────────────────────────────────────────────
-- STABLE (cached per query) + SECURITY DEFINER (bypasses RLS during the
-- self-lookup in user_profiles, so we don't recurse into our own policy).

CREATE OR REPLACE FUNCTION current_employee_name() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT employee_name FROM public.user_profiles
  WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_manager_user() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT is_manager FROM public.user_profiles
     WHERE LOWER(email) = LOWER(auth.jwt()->>'email') LIMIT 1),
    FALSE
  );
$$;


-- ── DROP existing _authed policies (Step 1) ────────────────────────
DROP POLICY IF EXISTS "ot_sessions_authed"            ON ot_sessions;
DROP POLICY IF EXISTS "comp_off_register_authed"      ON comp_off_register;
DROP POLICY IF EXISTS "comp_off_requests_authed"      ON comp_off_requests;
DROP POLICY IF EXISTS "leave_requests_authed"         ON leave_requests;
DROP POLICY IF EXISTS "annual_leave_authed"           ON annual_leave;
DROP POLICY IF EXISTS "project_sessions_authed"       ON project_sessions;
DROP POLICY IF EXISTS "projects_authed"               ON projects;
DROP POLICY IF EXISTS "customers_authed"              ON customers;
DROP POLICY IF EXISTS "inventory_authed"              ON inventory;
DROP POLICY IF EXISTS "inventory_activity_log_authed" ON inventory_activity_log;
DROP POLICY IF EXISTS "kb_authed"                     ON kb_articles;
DROP POLICY IF EXISTS "user_profiles_authed"          ON user_profiles;


-- ── ot_sessions: self or manager (full CRUD on own row) ────────────
CREATE POLICY ot_sessions_select ON ot_sessions FOR SELECT
  USING (is_manager_user() OR employee = current_employee_name());
CREATE POLICY ot_sessions_insert ON ot_sessions FOR INSERT
  WITH CHECK (is_manager_user() OR employee = current_employee_name());
CREATE POLICY ot_sessions_update ON ot_sessions FOR UPDATE
  USING (is_manager_user() OR employee = current_employee_name())
  WITH CHECK (is_manager_user() OR employee = current_employee_name());
CREATE POLICY ot_sessions_delete ON ot_sessions FOR DELETE
  USING (is_manager_user() OR employee = current_employee_name());


-- ── comp_off_requests: self or manager (full CRUD on own row) ──────
CREATE POLICY comp_off_requests_select ON comp_off_requests FOR SELECT
  USING (is_manager_user() OR employee = current_employee_name());
CREATE POLICY comp_off_requests_insert ON comp_off_requests FOR INSERT
  WITH CHECK (is_manager_user() OR employee = current_employee_name());
CREATE POLICY comp_off_requests_update ON comp_off_requests FOR UPDATE
  USING (is_manager_user() OR employee = current_employee_name())
  WITH CHECK (is_manager_user() OR employee = current_employee_name());
CREATE POLICY comp_off_requests_delete ON comp_off_requests FOR DELETE
  USING (is_manager_user() OR employee = current_employee_name());


-- ── comp_off_register: read self/mgr, write mgr only ───────────────
CREATE POLICY comp_off_register_select ON comp_off_register FOR SELECT
  USING (is_manager_user() OR employee = current_employee_name());
CREATE POLICY comp_off_register_insert ON comp_off_register FOR INSERT
  WITH CHECK (is_manager_user());
CREATE POLICY comp_off_register_update ON comp_off_register FOR UPDATE
  USING (is_manager_user()) WITH CHECK (is_manager_user());
CREATE POLICY comp_off_register_delete ON comp_off_register FOR DELETE
  USING (is_manager_user());


-- ── leave_requests: self or manager (full CRUD on own row) ─────────
CREATE POLICY leave_requests_select ON leave_requests FOR SELECT
  USING (is_manager_user() OR employee = current_employee_name());
CREATE POLICY leave_requests_insert ON leave_requests FOR INSERT
  WITH CHECK (is_manager_user() OR employee = current_employee_name());
CREATE POLICY leave_requests_update ON leave_requests FOR UPDATE
  USING (is_manager_user() OR employee = current_employee_name())
  WITH CHECK (is_manager_user() OR employee = current_employee_name());
CREATE POLICY leave_requests_delete ON leave_requests FOR DELETE
  USING (is_manager_user() OR employee = current_employee_name());


-- ── annual_leave: read self/mgr, write mgr only ────────────────────
CREATE POLICY annual_leave_select ON annual_leave FOR SELECT
  USING (is_manager_user() OR employee = current_employee_name());
CREATE POLICY annual_leave_insert ON annual_leave FOR INSERT
  WITH CHECK (is_manager_user());
CREATE POLICY annual_leave_update ON annual_leave FOR UPDATE
  USING (is_manager_user()) WITH CHECK (is_manager_user());
CREATE POLICY annual_leave_delete ON annual_leave FOR DELETE
  USING (is_manager_user());


-- ── project_sessions: read all auth, write/edit own or mgr ─────────
CREATE POLICY project_sessions_select ON project_sessions FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY project_sessions_insert ON project_sessions FOR INSERT
  WITH CHECK (is_manager_user() OR logged_by = current_employee_name());
CREATE POLICY project_sessions_update ON project_sessions FOR UPDATE
  USING (is_manager_user() OR logged_by = current_employee_name())
  WITH CHECK (is_manager_user() OR logged_by = current_employee_name());
CREATE POLICY project_sessions_delete ON project_sessions FOR DELETE
  USING (is_manager_user() OR logged_by = current_employee_name());


-- ── projects: read all auth, write mgr only ────────────────────────
CREATE POLICY projects_select ON projects FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY projects_insert ON projects FOR INSERT
  WITH CHECK (is_manager_user());
CREATE POLICY projects_update ON projects FOR UPDATE
  USING (is_manager_user()) WITH CHECK (is_manager_user());
CREATE POLICY projects_delete ON projects FOR DELETE
  USING (is_manager_user());


-- ── customers: read all auth, write mgr only ───────────────────────
CREATE POLICY customers_select ON customers FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY customers_insert ON customers FOR INSERT
  WITH CHECK (is_manager_user());
CREATE POLICY customers_update ON customers FOR UPDATE
  USING (is_manager_user()) WITH CHECK (is_manager_user());
CREATE POLICY customers_delete ON customers FOR DELETE
  USING (is_manager_user());


-- ── inventory: collaborative read+write, mgr-only delete ───────────
CREATE POLICY inventory_select ON inventory FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY inventory_insert ON inventory FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY inventory_update ON inventory FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY inventory_delete ON inventory FOR DELETE
  USING (is_manager_user());


-- ── inventory_activity_log: read all, append only, immutable ───────
CREATE POLICY inventory_activity_log_select ON inventory_activity_log FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY inventory_activity_log_insert ON inventory_activity_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
-- No UPDATE/DELETE policies = denied (audit log stays immutable)


-- ── kb_articles: read all, own or mgr can edit/delete ──────────────
CREATE POLICY kb_articles_select ON kb_articles FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY kb_articles_insert ON kb_articles FOR INSERT
  WITH CHECK (is_manager_user() OR submitted_by = current_employee_name());
CREATE POLICY kb_articles_update ON kb_articles FOR UPDATE
  USING (is_manager_user() OR submitted_by = current_employee_name())
  WITH CHECK (is_manager_user() OR submitted_by = current_employee_name());
CREATE POLICY kb_articles_delete ON kb_articles FOR DELETE
  USING (is_manager_user() OR submitted_by = current_employee_name());


-- ── user_profiles: read all auth, write mgr only ───────────────────
CREATE POLICY user_profiles_select ON user_profiles FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY user_profiles_insert ON user_profiles FOR INSERT
  WITH CHECK (is_manager_user());
CREATE POLICY user_profiles_update ON user_profiles FOR UPDATE
  USING (is_manager_user()) WITH CHECK (is_manager_user());
CREATE POLICY user_profiles_delete ON user_profiles FOR DELETE
  USING (is_manager_user());


-- ═══════════════════════════════════════════════════════════════════
-- VERIFY — should show 4 policies per table (or 2 for inventory_activity_log)
-- ═══════════════════════════════════════════════════════════════════
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;


-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK to Step 1 (uncomment and run if anything breaks)
-- ═══════════════════════════════════════════════════════════════════
/*
-- Drop all Step 2 policies
DROP POLICY IF EXISTS ot_sessions_select ON ot_sessions;
DROP POLICY IF EXISTS ot_sessions_insert ON ot_sessions;
DROP POLICY IF EXISTS ot_sessions_update ON ot_sessions;
DROP POLICY IF EXISTS ot_sessions_delete ON ot_sessions;
DROP POLICY IF EXISTS comp_off_requests_select ON comp_off_requests;
DROP POLICY IF EXISTS comp_off_requests_insert ON comp_off_requests;
DROP POLICY IF EXISTS comp_off_requests_update ON comp_off_requests;
DROP POLICY IF EXISTS comp_off_requests_delete ON comp_off_requests;
DROP POLICY IF EXISTS comp_off_register_select ON comp_off_register;
DROP POLICY IF EXISTS comp_off_register_insert ON comp_off_register;
DROP POLICY IF EXISTS comp_off_register_update ON comp_off_register;
DROP POLICY IF EXISTS comp_off_register_delete ON comp_off_register;
DROP POLICY IF EXISTS leave_requests_select ON leave_requests;
DROP POLICY IF EXISTS leave_requests_insert ON leave_requests;
DROP POLICY IF EXISTS leave_requests_update ON leave_requests;
DROP POLICY IF EXISTS leave_requests_delete ON leave_requests;
DROP POLICY IF EXISTS annual_leave_select ON annual_leave;
DROP POLICY IF EXISTS annual_leave_insert ON annual_leave;
DROP POLICY IF EXISTS annual_leave_update ON annual_leave;
DROP POLICY IF EXISTS annual_leave_delete ON annual_leave;
DROP POLICY IF EXISTS project_sessions_select ON project_sessions;
DROP POLICY IF EXISTS project_sessions_insert ON project_sessions;
DROP POLICY IF EXISTS project_sessions_update ON project_sessions;
DROP POLICY IF EXISTS project_sessions_delete ON project_sessions;
DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;
DROP POLICY IF EXISTS customers_select ON customers;
DROP POLICY IF EXISTS customers_insert ON customers;
DROP POLICY IF EXISTS customers_update ON customers;
DROP POLICY IF EXISTS customers_delete ON customers;
DROP POLICY IF EXISTS inventory_select ON inventory;
DROP POLICY IF EXISTS inventory_insert ON inventory;
DROP POLICY IF EXISTS inventory_update ON inventory;
DROP POLICY IF EXISTS inventory_delete ON inventory;
DROP POLICY IF EXISTS inventory_activity_log_select ON inventory_activity_log;
DROP POLICY IF EXISTS inventory_activity_log_insert ON inventory_activity_log;
DROP POLICY IF EXISTS kb_articles_select ON kb_articles;
DROP POLICY IF EXISTS kb_articles_insert ON kb_articles;
DROP POLICY IF EXISTS kb_articles_update ON kb_articles;
DROP POLICY IF EXISTS kb_articles_delete ON kb_articles;
DROP POLICY IF EXISTS user_profiles_select ON user_profiles;
DROP POLICY IF EXISTS user_profiles_insert ON user_profiles;
DROP POLICY IF EXISTS user_profiles_update ON user_profiles;
DROP POLICY IF EXISTS user_profiles_delete ON user_profiles;

-- Re-create the Step 1 authed policies
CREATE POLICY "ot_sessions_authed"            ON ot_sessions            FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "comp_off_register_authed"      ON comp_off_register      FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "comp_off_requests_authed"      ON comp_off_requests      FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "leave_requests_authed"         ON leave_requests         FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "annual_leave_authed"           ON annual_leave           FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "project_sessions_authed"       ON project_sessions       FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "projects_authed"               ON projects               FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "customers_authed"              ON customers              FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "inventory_authed"              ON inventory              FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "inventory_activity_log_authed" ON inventory_activity_log FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "kb_authed"                     ON kb_articles            FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "user_profiles_authed"          ON user_profiles          FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
*/
