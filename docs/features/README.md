# Features

This folder groups product-facing reference material for the NetSec Portal.

## Current Application Areas

- `Dashboard`: summary metrics, quick actions, connection status, manager alerts
- `Overtime`: OT logging, policy calculation, session history, comp off workflow, manager view
- `Leave`: annual and sick leave requests, history, team overview
- `Projects`: project session logging, project summaries, employee summaries, project management
- `Approvals`: manager review flow for comp off, leave, and OT sessions
- `Inventory`: device registry, duplicate prevention, edit/delete flow, activity log
- `Knowledge Base`: browse, submit, and manage internal articles

## Frontend Shape

- Runtime entry point: [index.html](/d:/Netsec-portal/index.html)
- Styling: [css/styles.css](/d:/Netsec-portal/css/styles.css)
- Core browser scripts: [js/core/state.js](/d:/Netsec-portal/js/core/state.js), [js/core/auth.js](/d:/Netsec-portal/js/core/auth.js), [js/core/navigation.js](/d:/Netsec-portal/js/core/navigation.js), [js/core/helpers.js](/d:/Netsec-portal/js/core/helpers.js), [js/core/init.js](/d:/Netsec-portal/js/core/init.js)
- Feature scripts: [js/features/overtime.js](/d:/Netsec-portal/js/features/overtime.js), [js/features/leave.js](/d:/Netsec-portal/js/features/leave.js), [js/features/dashboard.js](/d:/Netsec-portal/js/features/dashboard.js), [js/features/editors.js](/d:/Netsec-portal/js/features/editors.js), [js/features/projects.js](/d:/Netsec-portal/js/features/projects.js), [js/features/inventory.js](/d:/Netsec-portal/js/features/inventory.js), [js/features/approvals.js](/d:/Netsec-portal/js/features/approvals.js), [js/features/knowledge-base.js](/d:/Netsec-portal/js/features/knowledge-base.js)

## Data Dependencies

- Supabase Auth drives sign-in and password reset
- `user_profiles` maps auth users to employee names and manager access
- Business data is stored in tables documented in [BACKEND.md](/d:/Netsec-portal/BACKEND.md)

## Reference Assets

- `GulfitOT_Technical_Reference.docx`: legacy feature and business-rule reference copied here from the repo root for easier discovery
