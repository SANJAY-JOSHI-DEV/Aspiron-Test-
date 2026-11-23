# Aspiron Education - Action plan (2026-11-23)

## Now (this week)
1. **Apply the fixes:** merge this branch; in Supabase SQL Editor run `supabase_v76_low_fixes.sql`, then `supabase_v35_admin_team.sql`.
2. **2-step sign-in everywhere:** GitHub, Supabase, both Gmail accounts, Namecheap, Telegram, Resend, Zoho; Admin -> Team & access -> require 2-step for the team.
3. **Backups (A26-02):** retention is now 30 days; confirm `BACKUP_PASSWORD` is a random 24+ character value used nowhere else; check the last restore drill is green.
   Optional: public-key encryption so GitHub never holds the key (needs a key only you keep).
4. **CRON_KEY (A26-06)** and **legacy keys off (R7)** per SECURITY_RUNBOOK.md 7.
5. **Supabase Auth (A26-12):** Confirm email ON, minimum password 8+, redirect URLs only `https://aspironeducation.com/**`, rate limits, Resend SMTP.

## Next (this month)
6. Done in code (apply with step 1): A26-01, A26-03, A26-04, A26-09.
7. Tell the team: sign in again weekly, and before risky changes once a sign-in is 12 hours old.
8. **Header-spoofing check (A26-05)** on a free staging Supabase project.
9. **GitHub settings:** protect `main` (PR required), secret scanning + push protection ON, review collaborators.
10. **Cloudflare Free** in front of the domain (headers, HSTS, WAF basics) - see cloud review.
11. **Email DNS:** SPF, DKIM (Resend + Zoho), DMARC `p=quarantine` after a monitoring week.

## Later
12. Admin CSP: pin jsDelivr paths, try `wasm-unsafe-eval` (A26-07). 13. Remove `unsafe-inline` from the student app (A26-08).
14. Paid files out of Drive links (A26-10).
16. **Legal review required:** privacy notice, terms, refund policy, DPDP Act 2023 duties for minors / guardian consent, content and code IP assignment.
17. Independent penetration test before large-scale launch; staging load test before claiming any capacity.

## Before production release of anything new
Run the full test workflow on the PR; run new SQL in README order and `supabase_v35_admin_team.sql` last; run `supabase_check_installed.sql`.
