-- ═══════════════════════════════════════════════════════════════════
-- RLS Hardening — Step 1: require authenticated user
-- Date: 2026-04-30
--
-- BEFORE running:
--   1. Take a Full Backup from Dashboard → 📦 Data Backup → Full Backup
--   2. Have at least one user signed in to the app while testing
--   3. Keep this file open — rollback statements at the bottom
--
-- WHAT THIS DOES:
--   Replaces every "USING (true)" policy with "USING (auth.role() = 'authenticated')".
--   Anonymous traffic (anyone with just the public anon key, no sign-in) is now blocked.
--   Signed-in users continue to have full access — same as before.
--
-- AFTER running:
--   - Open the live app, sign in, and run smoke tests A through J of the runbook.
--   - If anything breaks: run the rollback section at the bottom of this file.
-- ═══════════════════════════════════════════════════════════════════

-- ot_sessions
DROP POLICY IF EXISTS "ot_sessions_all" ON ot_sessions;
CREATE POLICY "ot_sessions_authed" ON ot_sessions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- comp_off_register
DROP POLICY IF EXISTS "comp_off_register_all" ON comp_off_register;
CREATE POLICY "comp_off_register_authed" ON comp_off_register FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- comp_off_requests
DROP POLICY IF EXISTS "comp_off_requests_all" ON comp_off_requests;
CREATE POLICY "comp_off_requests_authed" ON comp_off_requests FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- leave_requests
DROP POLICY IF EXISTS "leave_requests_all" ON leave_requests;
CREATE POLICY "leave_requests_authed" ON leave_requests FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- annual_leave
DROP POLICY IF EXISTS "annual_leave_all" ON annual_leave;
CREATE POLICY "annual_leave_authed" ON annual_leave FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- project_sessions
DROP POLICY IF EXISTS "project_sessions_all" ON project_sessions;
CREATE POLICY "project_sessions_authed" ON project_sessions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- projects
DROP POLICY IF EXISTS "projects_all" ON projects;
CREATE POLICY "projects_authed" ON projects FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- customers
DROP POLICY IF EXISTS "customers_all" ON customers;
CREATE POLICY "customers_authed" ON customers FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- inventory
DROP POLICY IF EXISTS "inventory_all" ON inventory;
CREATE POLICY "inventory_authed" ON inventory FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- inventory_activity_log
DROP POLICY IF EXISTS "inventory_activity_log_all" ON inventory_activity_log;
CREATE POLICY "inventory_activity_log_authed" ON inventory_activity_log FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- kb_articles
DROP POLICY IF EXISTS "kb_all" ON kb_articles;
CREATE POLICY "kb_authed" ON kb_articles FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- user_profiles
DROP POLICY IF EXISTS "user_profiles_all" ON user_profiles;
CREATE POLICY "user_profiles_authed" ON user_profiles FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- ═══════════════════════════════════════════════════════════════════
-- VERIFY (run after the policies are applied)
-- ═══════════════════════════════════════════════════════════════════
SELECT schemaname, tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;


-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (if anything breaks)
-- Restores the open-anyone policies that were active before Step 1.
-- ═══════════════════════════════════════════════════════════════════
/*
DROP POLICY IF EXISTS "ot_sessions_authed" ON ot_sessions;
CREATE POLICY "ot_sessions_all" ON ot_sessions FOR ALL USING (true);

DROP POLICY IF EXISTS "comp_off_register_authed" ON comp_off_register;
CREATE POLICY "comp_off_register_all" ON comp_off_register FOR ALL USING (true);

DROP POLICY IF EXISTS "comp_off_requests_authed" ON comp_off_requests;
CREATE POLICY "comp_off_requests_all" ON comp_off_requests FOR ALL USING (true);

DROP POLICY IF EXISTS "leave_requests_authed" ON leave_requests;
CREATE POLICY "leave_requests_all" ON leave_requests FOR ALL USING (true);

DROP POLICY IF EXISTS "annual_leave_authed" ON annual_leave;
CREATE POLICY "annual_leave_all" ON annual_leave FOR ALL USING (true);

DROP POLICY IF EXISTS "project_sessions_authed" ON project_sessions;
CREATE POLICY "project_sessions_all" ON project_sessions FOR ALL USING (true);

DROP POLICY IF EXISTS "projects_authed" ON projects;
CREATE POLICY "projects_all" ON projects FOR ALL USING (true);

DROP POLICY IF EXISTS "customers_authed" ON customers;
CREATE POLICY "customers_all" ON customers FOR ALL USING (true);

DROP POLICY IF EXISTS "inventory_authed" ON inventory;
CREATE POLICY "inventory_all" ON inventory FOR ALL USING (true);

DROP POLICY IF EXISTS "inventory_activity_log_authed" ON inventory_activity_log;
CREATE POLICY "inventory_activity_log_all" ON inventory_activity_log FOR ALL USING (true);

DROP POLICY IF EXISTS "kb_authed" ON kb_articles;
CREATE POLICY "kb_all" ON kb_articles FOR ALL USING (true);

DROP POLICY IF EXISTS "user_profiles_authed" ON user_profiles;
CREATE POLICY "user_profiles_all" ON user_profiles FOR ALL USING (true);
*/
