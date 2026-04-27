# Testing

This project has no automated test harness yet, so this folder defines the manual regression baseline a senior developer would expect before shipping.

## Smoke Test Checklist

1. Sign in with a normal employee account and confirm non-manager tabs stay hidden
2. Sign in with a manager account and confirm approvals and manager-only actions appear
3. Log an OT session and verify band, rate, credited hours, and saved record
4. Submit a comp off request and verify it appears in employee history and manager approvals
5. Submit annual leave and sick leave requests and verify balances and approval flow
6. Log a project session and confirm project/customer filtering works
7. Add, edit, and search an inventory device and verify the activity log updates
8. Create and browse a knowledge base article
9. Run backup export and confirm expected data is included

## High-Risk Areas

- Auth bootstrap and role mapping from `user_profiles`
- OT calculation rules, especially cross-midnight and weekend logic
- Approval side effects that write into `comp_off_register` and `annual_leave`
- Inventory duplicate detection and delete logging
- Customer/project relationship changes

## Suggested Next Step

- Add a lightweight regression script or browser-based test suite for login, OT logging, leave requests, approvals, inventory, and KB flows
