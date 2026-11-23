# Aspiron Education - Remediation changelog (2026-11-23)

Branch: `ccr-c50d872f-cvdgho` (started equal to `main`, commit `8679166`, clean tree). Pushed to this branch only; **not merged, not deployed**.

| File | Change | Finding |
|---|---|---|
| `supabase_v35_admin_team.sql` cbt_admin_login | bcrypt work also for unknown usernames | A26-01 |
| `supabase_v35_admin_team.sql` admin_session_ok, new admin_high_risk, cbt_admin_login | team sessions 12 h idle + 7 d total, owner 24 h + 14 d; risky changes need a sign-in younger than 12 h (else `reauth`); new sessions start with the short expiry | A26-03 |
| `cx/core.js`, `cx/shell.js`, `cp-dt764twzf54s5m.html` | panel treats `reauth` as "sign in again" with a clear message; fixed the old "30 days" text; cache versions core v12, shell v22 | A26-03 |
| `supabase_v76_low_fixes.sql` cbt_private.auth | `pending` only for the student's own valid token/code; strangers get `invalid` | A26-04 |
| `app1.js`, `index.html` | "incorrect" message now says the code comes after approval; app1 v42 | A26-04 |
| `.github/workflows/db-backup.yml`, `BACKUP.md` | second locked file with Supabase Auth users (warning only if unreadable); artifact retention 90 -> 30 days (Drive keeps 90). Same schedule, no new workflow | A26-09, A26-02 |
| `tests/db/break_it.sql` | sections 49 (2 checks), 50 (5 checks), 51 (1 check) | all |
| `security-audit/2026-11-23/*` | reports | - |

Behaviour changes: team members sign in at least weekly (owner every 2 weeks) and again before risky changes once their sign-in is 12 h old;
a stranger typing a code for a pending number sees the normal "incorrect" message.
No change to scoring, pricing, test timing, order status rules, entitlements or content visibility.

## Production rollout (owner)
1. Merge the branch (Pages publishes the admin/app files). 2. Supabase -> SQL Editor: `supabase_v76_low_fixes.sql`, then `supabase_v35_admin_team.sql`.
3. Run `supabase_check_installed.sql`. 4. Sign in as owner and as one team member; try one risky change. 5. Actions -> Database backup -> Run workflow: green, and check whether the auth file appears.
