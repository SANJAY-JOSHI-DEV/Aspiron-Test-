# Aspiron Education - Test results (2026-11-23)

Environment: throw-away PostgreSQL 16 on the audit container (password `throwaway-test-db`, local only), Node 22, Chromium via
pre-installed Playwright 1.63 (repo pins 1.56.1; `pg@8.13.1` installed in a scratch folder, project files untouched).
**No production system, real account, email, push or payment was used.**

| # | Command | Before fixes | After fixes |
|---|---|---|---|
| 1 | `bash tests/db/build.sh` (all v9-v92 SQL in README order) | exit 0 | exit 0 |
| 2 | `psql -v ON_ERROR_STOP=1 -f tests/db/break_it.sql` | 355/355 (old suite) | **363/363 PASS**, exit 0 |
| 3 | new checks on the OLD SQL (v35 + v76 from HEAD) | 49a FAIL (70.1 vs 0.8 ms); 50a, 50d, 50e, 51a FAIL (exit 3) | all PASS |
| 4 | `psql -f tests/db/open_findings.sql` | 0 open | 0 open |
| 5 | `node tests/e2e/student.js` | 195 PASS | 195 PASS |
| 6 | `node tests/e2e/admin.js` | 87 PASS | 87 PASS |
| 7 | `node tests/e2e/v3_xss.js`, `xss_admin_store.js` | ALL PASS | not rerun (no rendering change) |
| 8 | db-backup "Dump and encrypt" step run locally (pg_dump 16) on the test DB | - | exit 0; 1 `.dump.gpg` + 1 `.authdump.gpg` (decrypts, has table data) |
| 9 | same step on a DB with no auth schema | - | exit 0; warning; main backup only |
| 10 | YAML parse + `bash -n` of every db-backup step | - | OK |
| 11 | `npm audit --package-lock-only --omit=dev` (tests/e2e) | 0 vulnerabilities | - |
| 12 | Redacted regex secret scan, full history | 0 real secrets | - |

Not run: manual suites (`admin_tour`, `files_*`, `result_alert`, `xguard`), gitleaks binary (download refused; CI runs it),
live-site checks (host unreachable), OCR import (needs jsDelivr), load tests (not allowed).
