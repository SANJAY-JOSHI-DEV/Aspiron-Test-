# Aspiron Education - Remediation changelog (2026-11-23)

Branch: `ccr-c50d872f-cvdgho` (started equal to `main`, commit `8679166`, clean working tree, no pre-existing changes).
**Not committed, not pushed, not deployed** - waiting for the owner's approval.

| File | Change | Why |
|---|---|---|
| `supabase_v35_admin_team.sql` (cbt_admin_login, ~line 644) | +3 lines: `if u.id is null then perform adm_pw_new(p_pw); end if;` with comment | A26-01: same bcrypt work for unknown usernames, so timing does not reveal valid team usernames |
| `tests/db/break_it.sql` (new section 49) | +2 checks (49a timing, 49b same error) | Regression test: failed before the fix, passes after |
| `security-audit/2026-11-23/*` | New audit reports | Deliverables (no secrets, no personal data) |

No change to scoring, pricing, timing, order status, entitlements or content visibility.

## Production rollout (owner)
1. Review the diff. 2. Supabase -> SQL Editor: run `supabase_v35_admin_team.sql` (it is safe to run again and is already run last after other files).
3. Admin -> sign in as owner and as one team member (normal sign-in still works). 4. Nothing else changes.
