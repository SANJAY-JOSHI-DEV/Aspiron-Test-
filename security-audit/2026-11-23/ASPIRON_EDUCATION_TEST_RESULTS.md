# Aspiron Education - Test results (2026-11-23)

Environment: throw-away PostgreSQL 16 on the audit container (password `throwaway-test-db`, local only), Node 22, Chromium via
pre-installed Playwright 1.63 (repo pins 1.56.1; `pg@8.13.1` installed in a scratch folder, project files untouched).
**No production system, real account, email, push or payment was used.**

| # | Command | Before fix | After fix |
|---|---|---|---|
| 1 | `bash tests/db/build.sh` (all v9-v92 SQL in README order) | exit 0 | exit 0 |
| 2 | `psql -v ON_ERROR_STOP=1 -f tests/db/break_it.sql` | exit 0, **355/355 PASS** (without section 49) | exit 0, **357/357 PASS** |
| 2b | same, with new section 49 on unfixed SQL | exit 3, **49a FAIL** (known 70.1 ms, unknown 0.8 ms) | 49a PASS (67.8 ms vs 68.4 ms) |
| 3 | `psql -f tests/db/open_findings.sql` | exit 0, 0 open | exit 0, 0 open |
| 4 | `node tests/e2e/student.js` | exit 0, 195 PASS | exit 0, 195 PASS |
| 5 | `node tests/e2e/admin.js` | exit 0, 87 PASS | exit 0, 87 PASS |
| 6 | `node tests/e2e/v3_xss.js` | exit 0, ALL PASS | not rerun (no frontend change) |
| 7 | `node tests/e2e/xss_admin_store.js` | exit 0, ALL PASS | not rerun (no frontend change) |
| 8 | `npm audit --package-lock-only --omit=dev` (tests/e2e) | 0 vulnerabilities | - |
| 9 | Redacted regex secret scan, full history | exit 0, 0 real secrets | - |
| 10 | Timing probe `cbt_admin_login` unknown vs real user | 2.3 ms vs 68.2 ms | equal |

Not run: `admin_tour.js`, `files_admin.js`, `files_dl.js`, `result_alert.js`, `xguard.js` (manual suites, unaffected by the change);
gitleaks binary (download refused - the CI job runs it); live-site checks (host unreachable); load tests (not allowed).
