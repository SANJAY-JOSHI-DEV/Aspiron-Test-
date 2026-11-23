# Aspiron Education - Repository cleanup report (2026-11-23)

**Files removed: 0.** No file could be *proven* unused, so nothing was deleted (rule: delete only with proof).

## Method
For every frontend file (app1-29.js, v3.js, cx/*, parser.js, qrcode.js, ptable*, pyq-syllabus.js, store*, xguard.js, every CSS,
icons, og-images, SEO pages) the file name was searched across the whole repository except itself and the docs
(`git grep -F <name>`), covering HTML `<script>/<link>`, JS dynamic loads, `sw.js` precache, manifests, workflows, tests and scripts.

## Candidates found and retained
| File | Why it looked unused | Why it is kept |
|---|---|---|
| `jee-test-series.html`, `neet-test-series.html` | No internal link | Redirect stubs (noindex, canonical + meta refresh) for old public URLs; search engines/external links may still use them. OWNER DECISION. |
| `supabase_v49_v50_all_in_one.sql` | Duplicates v49 + v50 | SQL migration history; referenced by README/PENDING. Never delete migrations. |
| `admin.html` | Shows "404" | Intentional decoy for the old admin path (SECURITY_MAP). |
| `ADMIN_REDESIGN.md`, `PENDING.md`, `SECURITY_*.md` | Documentation | Owner records / audit evidence. |
| `supabase_check_alerts.sql`, `supabase_backup_role.sql` | Run by hand only | Operational scripts referenced by README/BACKUP.md. |
| `lib/*` | Vendored | Loaded dynamically by `cx/m-import.js` (pdf.js, jszip, tesseract). |

Recovery: nothing to recover (no deletion).
