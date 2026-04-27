# Security

This folder tracks the current security posture and operational hardening notes for the portal.

## Current State

- Authentication uses Supabase Auth email/password flows
- Authorization in the UI depends on `user_profiles.is_manager`
- The frontend still embeds the Supabase anon key in [js/core/state.js](/d:/Netsec-portal/js/core/state.js)
- Database access is broadly open through RLS policies documented in [BACKEND.md](/d:/Netsec-portal/BACKEND.md)

## Immediate Risks

- Open RLS policies mean any client holding the anon key can read and write application data
- Manager-only controls are enforced primarily in the client, so backend policy enforcement is still weak
- Static deployment means every shipped client secret should be treated as public

## Recommended Hardening Order

1. Replace open RLS policies with table-specific rules tied to authenticated users
2. Move manager authorization checks into the database layer, not only the UI
3. Audit every write path in `app.js` and align it to authenticated ownership rules
4. Move backup and export operations behind manager-only policy checks
5. Keep schema and auth changes documented in [BACKEND.md](/d:/Netsec-portal/BACKEND.md)

## Operational Notes

- Before backend or auth changes, review [BACKEND.md](/d:/Netsec-portal/BACKEND.md)
- After auth changes, validate login, password reset, role detection, and manager approvals
