// == CONFIG =======================================================
const SUPABASE_URL = 'https://rxxcrlobbtlvjgcqgjjm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4eGNybG9iYnRsdmpnY3FnamptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzczNzEsImV4cCI6MjA5MDUxMzM3MX0.egC7GkqozxJ8IUbsL3RaHcyE4spGVOwmt2t9s082QSE';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// EMPLOYEES list is now derived from user_profiles at login (manager filters etc.)
// Fallback used until profiles load — ordered to match historical data.
let EMPLOYEES = ['Ahmed Ali','Venkatesan','Prasanth','Salman Aziz','Mohammed Afsal','Mohammed Nasif'];
const KSA_EMP   = ['Salman Aziz','Mohammed Afsal'];
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

