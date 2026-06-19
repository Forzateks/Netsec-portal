// == CONFIG =======================================================
const SUPABASE_URL = 'https://rxxcrlobbtlvjgcqgjjm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4eGNybG9iYnRsdmpnY3FnamptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzczNzEsImV4cCI6MjA5MDUxMzM3MX0.egC7GkqozxJ8IUbsL3RaHcyE4spGVOwmt2t9s082QSE';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// EMPLOYEES list is now derived from user_profiles at login (manager filters etc.)
// Fallback used until profiles load — ordered to match historical data.
let EMPLOYEES = ['Ahmed Ali','Venkatesan','Prasanth','Salman Aziz','Mohammed Afsal','Mohammed Nasif'];
const KSA_EMP   = ['Salman Aziz','Mohammed Afsal'];

// v136: dated per-employee weekend overrides. During an onsite rotation an
// employee can follow a different weekend (e.g. Thu+Fri off, working Sat+Sun)
// — their OT must be banded against that schedule for the period. Each entry:
//   { employee, from, to, weekendDays }  (dates inclusive, 'YYYY-MM-DD';
//   weekendDays = JS getDay() numbers, Sun=0 .. Sat=6).
// isWeekend() consults this first, so calcOT / validateOTStart / the manager
// Recompute tool all stay consistent — the correction survives a recompute.
// Keep this list short and remove entries once they're purely historical and
// no longer need to recompute. (Hardcoded by design, like KSA_EMP.)
const WEEKEND_OVERRIDES = [
  { employee: 'Ahmed Ali', from: '2025-12-30', to: '2026-02-05', weekendDays: [4, 5] } // Thu + Fri
];
const LEAVE_ALLOWANCE = 22;
const SICK_ALLOWANCE  = 12;

let currentUser = '';
let currentEmail = '';
let isManager   = false;
// v95: drives the dashboard backup-staleness banner. Set from user_profiles
// at login; only Venkat + Nasif are flagged by default.
let isBackupResponsible = false;
let approveTarget = null;
let USER_PROFILES = []; // [{user_id, email, employee_name, is_manager}]

