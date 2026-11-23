# Aspiron Education - Cloud, GitHub and Supabase review (2026-11-23)

## What changed since the historical baseline
| Baseline clue | Now (verified from repo) |
|---|---|
| Repo `Aspiron-Dev/Aspiron-Test-` | `SANJAY-JOSHI-DEV/Aspiron-Test-`, **public**, Pages enabled (GitHub search API) |
| 86 tables / 86 SQL files | **98 tables** (24 `public` + 74 `cbt_private`) in the rebuilt test DB; 87 SQL files in the root (v9-v92 + checks) |
| RLS on, 0 policies, 0 browser grants | **Still true** (test DB): RLS 24/24, 0 policies, 0 table grants, `cbt_private` not usable by anon |
| 5 workflows | Still 5: tests, security, db-backup, restore-drill, security-alerts |
| No Supabase Auth | **Email + Google login is ON** (`config.js EMAIL_LOGIN: true`, `app28.js`, `supabase_v65_auth.sql`) |
| No React/Next | Still vanilla JS (`v3.js`, `app*.js`, `cx/*.js`) |
| Cloudflare planned | Still not verified/connected |
| Razorpay/AI not found | Still not implemented |

## Supabase / PostgreSQL (repository SQL, rebuilt in a throw-away PostgreSQL 16)
- 196 functions in `public` (158 SECURITY DEFINER), ~181 executable by `anon` (incl. pgcrypto helpers of the test stub), 0 in `cbt_private`.
- Every SECURITY DEFINER function has a fixed `search_path` (0 exceptions).
- `authenticated` can run only `student_link`, `student_request`, `student_signin` (v65).
- Attack suite: **363/363 PASS** (was 355; +8 new checks for A26-01, A26-03, A26-04).
- NOT VERIFIED in production: effective grants, extensions schema, Data API exposed schemas, legacy JWT keys (R7), Auth settings (A26-12), backups' restore result. Run `supabase_check_installed.sql` and `supabase_security_check.sql`.

## Edge Function `send-push`
Admin session (`as1.`) required and checked with `messaging:manage`; push hosts allow-listed (SSRF); exact CORS origins; generic error bodies;
pinned `web-push@3.6.7`, `@supabase/supabase-js@2.118.0`; `due` mode needs `CRON_KEY` once set (A26-06).

## GitHub
- Workflows: `permissions: contents: read`; actions pinned by SHA; `timeout-minutes` set; no `pull_request_target`; tests use no secrets.
- gitleaks (pinned + checksum) on every PR, full history.
- Backups: encrypted artifacts in a public repo (A26-02).
- NOT VERIFIED: branch protection, push protection, collaborators, Dependabot alerts state.

## Hosting, DNS, TLS, Cloudflare
GitHub Pages with CNAME `aspironeducation.com`. The live site and DNS could not be reached from this audit environment
(network policy), so TLS, HSTS, DNSSEC, SPF/DKIM/DMARC, registrar lock and Cloudflare are **NOT VERIFIED**.
`scripts/check-exposed.sh` already checks the live site weekly in Actions.

### Owner verification commands (run on your own computer, read-only)
```
curl -sI https://aspironeducation.com | grep -iE 'strict-transport|content-security|x-frame|server'
dig +short NS aspironeducation.com ; dig +short TXT aspironeducation.com ; dig +short TXT _dmarc.aspironeducation.com
dig +short CAA aspironeducation.com ; whois aspironeducation.com | grep -iE 'status|expir'
```

## Free Cloudflare rollout (zero cost, after owner approval)
1. Add the site on the Free plan; copy existing DNS records exactly; switch Namecheap nameservers.
2. SSL/TLS Full (strict); Always Use HTTPS; HSTS (start max-age 1 day, raise later).
3. Transform Rules -> response headers: `X-Frame-Options: DENY` (not on embeds), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
4. Do not cache `/rest/v1` (it is on supabase.co anyway); keep Pages as origin.
