# Aspiron Education - Payment security review (2026-11-23)

## Classification
**Payment integration: MANUAL UPI (implemented, live design). No payment gateway. Razorpay: NOT implemented** (only the
placeholder text "e.g. Razorpay" in `cx/m-ops.js`). **No webhooks exist.** Plans (`supabase_v90/v91`): payment
"does not exist yet" - plans are given by the admin; `cbt_plan_notify` only records interest.

## How money flows today
1. Buyer opens `store.html`, `cbt_store_order(item, name, mobile)` creates a *pending* order; price comes from `cbt_store_items`.
2. `cbt_store_order_apply` recalculates price, coupon (DB rules, advisory lock on limited coupons) and wallet (advisory lock per number) **on the server**.
3. Buyer pays with any UPI app from a QR built from the shop's UPI id; the site never sees card/bank credentials.
4. `cbt_store_paid(code, mobile, payer, utr)` records payer name + UTR; **status stays `pending`**; a reused UTR is flagged (`utr_seen`).
5. A team member with `store:manage` (or the owner) approves after checking the bank app; access (`series_access`) is granted only then; members' approvals alert the owner (R6).

## Checks
| # | Check | Result |
|---|---|---|
| 1-2 | Price/discount/amount decided on the server | PASS |
| 3 | Order bound to number + item + amount | PASS (code + mobile; wrong-code limit) |
| 4-7 | Provider verification / webhook signature / replay / idempotency | NOT APPLICABLE (no gateway). Idempotent: approving twice does not grant twice (series_access unique) |
| 8 | Client cannot mark paid | PASS |
| 10 | Order-id substitution | PASS (needs code + matching mobile) |
| 11 | Coupon/negative/overflow | PASS (`greatest(0,…)`, bounded inputs, locked limits) |
| 12 | Refund/cancel/manual approval protected | PASS (`store:manage`, logged, owner alert); deleted paid orders kept in `order_trash` |
| 13 | Forged UTR/screenshot | **PARTIAL - human reconciliation only.** Approve only after the UTR is visible in the bank account statement; never from a screenshot. |
| 14-15 | Card/CVV/PIN/OTP stored? | NONE. Cardholder data never reaches Aspiron -> **PCI DSS not in scope** for these flows |
| 16 | Payment keys in frontend/history | none found |
| 17 | Receipts/orders of other buyers | PASS |
| 18 | Entitlement only after verified payment | PASS (admin approval) |
| 19 | Test/live separation | NOT APPLICABLE (no gateway) |
| 21 | Payment data to analytics/email | none (no analytics; no email sent) |
| 22 | Provider account ownership | NOT VERIFIED (UPI/bank account) |

## Before adding Razorpay (future)
- Create orders server-side (Edge Function with the Razorpay secret in Supabase secrets, never in `config.js`).
- Verify `razorpay_signature` (HMAC-SHA256 of order_id|payment_id) server-side; grant access only from a verified webhook
  (`X-Razorpay-Signature`), store `payment_id` with a UNIQUE constraint for idempotency, compare amount/currency/order.
- Use Razorpay Checkout (hosted) so card data never touches Aspiron; keep test and live keys in separate projects.
- Add break_it checks: forged signature, replayed webhook, amount mismatch, duplicate payment_id.
