# Production Deployment Guide

This guide describes the repository as inspected. It does not connect to Neon,
run SQL, push Git commits, or deploy services.

## Table of contents

- [Current architecture](#current-architecture)
- [Important readiness and security findings](#important-readiness-and-security-findings)
- [Neon migration audit](#neon-migration-audit)
- [Reviewed migration order](#reviewed-migration-order)
- [Run the migrations manually](#run-the-migrations-manually)
- [Verify the Neon schema](#verify-the-neon-schema)
- [Configure the backend host](#configure-the-backend-host)
- [Configure Vercel](#configure-vercel)
- [Smoke-test checklist](#smoke-test-checklist)
- [Backups and recovery](#backups-and-recovery)
- [GitHub status](#github-status)
- [What has not been verified](#what-has-not-been-verified)

## Current architecture

| Part | Actual project setup |
|---|---|
| Frontend | React 19 and Vite 8 in `client/`. `npm run build` creates `client/dist/`. |
| Backend | CommonJS Node.js and Express 5 in `server/`. `npm start` runs `src/server.js`. |
| Realtime | Socket.IO is attached to the Express HTTP server. Use a persistent Node service, not Vercel Functions, for the backend. |
| Database | PostgreSQL through `pg.Pool`, configured by the server-only `DATABASE_URL`. |
| Frontend API setting | `VITE_API_BASE_URL`, compiled into browser JavaScript. It is public and must contain only the backend origin. |
| Vercel routes | `client/vercel.json` already rewrites SPA requests to `index.html`. |

Use one Vercel project for the static frontend and a separate Railway or Render
service for the Express and Socket.IO backend. Do not deploy the backend as
Vercel Functions: the application uses a persistent Socket.IO server and writes
files to local disk.

## Current approval status

The current 59-file plan has been applied and verified on the dedicated local
`wholesale_marketplace_test` database running PostgreSQL 18.6. This does not
approve production migrations or deployment. Production credentials previously
shared in conversation must first be rotated and confirmed revoked. Neon was
not contacted.

The current runner is deliberately restricted to `server/.env.test`,
`wholesale_marketplace_test`, a local host, and port 5432. The separate
`migrate:neon` command below is required for a consciously approved Neon apply.
Do not point `.env.test` at a hosted database or bypass the local runner guard.

### Latest local schema audit, 23 October 2026

The read-only audit connected only to `wholesale_marketplace_test` at
`127.0.0.1:5432` and confirmed `transaction_read_only=on`. It found 78 ordinary
tables, 28 sequences, 244 indexes, and 982 columns. There were no views,
materialized views, partitioned tables, or foreign tables. A static scan found
77 unique `CREATE TABLE` declarations in the 59 included migrations, all
present in the database. The remaining table is the runner's
`schema_migrations` ledger.

All 98 foreign keys were validated and referenced existing relation targets.
The 76 primary keys, 19 unique constraints, and 76 CHECK constraints were
enumerated. Two CHECK constraints, `sales_channel_check` and
`invoices_channel_check`, are intentionally `NOT VALID` in
`wholesale3_marketplace_linkages.sql` so legacy values do not block the
migration. Both corresponding tables currently have zero rows. All 244
indexes were valid and ready, with no exact duplicate definitions. Of the 28
sequences, only `order_number_seq` is unowned; it is intentionally consumed by
`generate_order_number()` rather than attached to a table column. All seven
user triggers were enabled and matched the migration declarations. The six
application functions matched their declarations. No domain, enum, range, or
multirange types were found in `public`. `pgcrypto` version 1.4 is installed.

At the time of the 23 October audit, the ledger had exactly 57 ordered entries
with matching checksums. The two profile-recovery migrations were added later
and were applied to the local test database on 26 October, bringing its
current ledger to 59. The original catalog query retrieved column types,
nullability, defaults, identity, and generated-column metadata. It did not
produce an exhaustive normalized, column-by-column diff against every
`ALTER TABLE` in the migration set, nor a separate anti-join for every foreign
key. Treat the local schema as a conditional pass, not as evidence that a
hosted database has the same schema or permissions.

### Repository database inventory

The SQL migration set is the schema source of truth. There is no ORM model
layer. `000_baseline.sql` is the structure-only baseline; the explicit
59-entry manifest in `server/run_migrations.js` adds later columns, keys,
indexes, triggers, and functions. `marketplace_schema.sql` is a byte-identical
duplicate baseline and is excluded. The migration set declares 77 distinct
application tables:

```text
coupon_usage, coupons, credit_account_audit, credit_note_items,
credit_note_sequences, credit_notes, credit_transactions,
delivery_challan_items, delivery_challan_sequences, delivery_challans,
device_tokens, flash_sale_products, flash_sales, gift_card_transactions,
gift_cards, imports, inventory_forecasts, inventory_log, invoice_items,
invoice_logs, invoice_sequences, invoice_settings, invoices, items,
loyalty_accounts, loyalty_transactions, marketplace_linkages, master_hsn,
master_settings, master_states, master_tax_rates, master_tax_terms,
master_units, master_uqc, messages, notification_logs,
notification_preferences, notifications, order_analytics, order_items,
order_sequences, order_status_history, orders, parties, party_payments,
payment_transactions, payments, product_reviews, products, purchase_lines,
purchase_sequences, purchases, razorpay_transfers, razorpay_webhook_events,
referral_rewards, referrals, return_requests, review_helpful_votes,
review_images, review_replies, review_reports, reviews, sale_lines,
sale_sequences, sales, seller_reviews, shipment_checkpoints,
shipment_tracking_links, shipments, staff_members, stock_ledger,
supplier_inventory, supplier_payments, suppliers, users,
wholesaler_profiles, wishlist_notifications
```

Feature ownership is visible in the migration names and SQL: users, seller
profiles, staff and device tokens support identity; products, `items`,
`supplier_inventory`, inventory history/forecasting and master tables support
catalogue and inventory; orders, order items, shipments, returns, payments,
Razorpay records and status history support marketplace fulfilment; invoices,
invoice items/logs/settings/sequences support billing; parties, sales,
purchases, credit entries/notes, supplier payments, challans and the stock
ledger support the wholesaler books; notifications, messages, promotions,
loyalty, referrals and reviews support engagement. The migrations define six
application functions and seven user triggers in the audited local schema.
No application enum types or views were found in the migration declarations.
The locally audited functions are `generate_order_number`,
`sync_order_status_history_legacy`, `sync_payment_transactions_legacy`,
`trigger_generate_order_number`, `trigger_update_updated_at`, and
`validate_order_status_transition`. The locally audited triggers are
`trg_generate_order_number`, `trg_order_status_history_legacy`,
`trg_payment_transactions_legacy`, `trg_update_invoices_updated_at`,
`trg_update_order_analytics_updated_at`, `trg_update_orders_updated_at`, and
`trg_update_return_requests_updated_at`.

The baseline and later SQL define the exact columns, types, defaults,
nullability, keys, foreign keys, checks, and indexes. The latest documented
local audit found 982 columns, 98 foreign keys, 76 primary keys, 19 unique
constraints, 76 check constraints, 28 sequences, and 244 indexes. These are
local-database observations, not claims about Neon. Use
`server/inspect_full_schema.sql` against the intended target to inspect its
catalog before claiming that its schema matches this inventory.

Do not use `server/scripts/dump_schema.js` as a complete database export. It
writes directly to `server/migrations/000_baseline.sql` and does not serialize
all the application's functions, triggers, types, or policies. Use the
version-controlled migration manifest for a fresh schema, or `pg_dump` for a
full source database transfer.

## Important readiness and security findings

### Must address before production traffic

1. **Rotate exposed credentials.** A database password and JWT secret were
   previously shared in the conversation. Replace both before production use.
   Do not paste the replacement values into chat, source files, GitHub, or
   Vite variables.
2. **Persistent file storage is not configured.** Review photos are written to
   `server/uploads/review_images`, and generated invoice PDFs are cached under
   `server/storage/invoices`. These paths are local to the server process.
   Configure a persistent volume at the paths the code uses, or implement a
   durable object-storage adapter before relying on uploads across restarts or
   multiple backend instances. The client-side Cloudinary identifiers do not
   make these backend review uploads persistent.
3. **Set the exact frontend origin.** Production Express CORS and Socket.IO
   now use the same `CLIENT_URL` allowlist. Set it to the Vercel origin, with
   comma-separated origins only if more than one is intentionally allowed.
4. **Use the correct PostgreSQL endpoint and verified TLS.** For Render's
   internal database URL, the backend and database must be in compatible
   regions. All remote PostgreSQL connections verify the server certificate.
   Supply a trusted PEM with `DATABASE_SSL_CA` when the provider's internal
   endpoint uses a private or self-signed CA. If no trusted CA is available,
   use the provider's external database URL with its trusted certificate.
   Never bypass certificate verification or set `sslmode=disable` remotely.
5. **Review the tax seed.** The test-only `GST28_CESS12` seed was removed from
   the migration so a fresh production database does not start with an
   unverified nonzero cess rate. This source change does not alter a row that
   may already exist in another database.

The backend now exposes `GET /healthz` for process liveness and `GET /readyz`
for a PostgreSQL readiness check. Configure the host's health check to use
`/readyz`.

### Git and secrets

At inspection time, the branch was `main`, `origin` pointed to
`https://github.com/chitransh-usar/wholesale-product.git`, and the worktree had
one pre-existing modification: `.gitignore`. Its existing edits were
preserved; this review only added private-key extensions to the ignore rules.
No non-example `.env` file, database dump, or private-key filename was tracked
by Git. This filename check is not a complete scan of Git history. Removing a
secret in a later commit does not remove it from older commits, so rotate any
credential that has ever been committed or shared.

The invoice PDF `server/uploads/invoices/INV-2026-000007.pdf` was added in
commit `5993b33734f9fc5d85bc288a8813f2778762d9c8` and deleted in
`bf2766e69145ded099642f135e12f391618f6c31`. Deleting it did not remove it from
Git history. A local text classification confirmed invoice/tax, amount,
business/customer, and contact/personal-information indicators. Do not treat
the repository history as sanitized.

A prior report also mentioned a committed password, but this review could not
identify a credential-bearing commit and path in the available local history.
Database and JWT credentials were previously shared outside the repository;
their rotation or invalidation cannot be verified from this checkout. Treat
them as exposed until each provider confirms revocation and replacement.

Two uploaded review images remain tracked under `server/uploads/review_images/`
despite the ignore rule. The tracked `docs/Vyapari-Product-Blueprint.pdf` is a
project document, not a generated invoice; its contents were not reviewed, so
confirm it is appropriate for the repository's intended visibility. Removing
files in a later commit does not remove prior copies from Git history. Do not
rewrite or force-push history without a separate backup and explicit approval.

The current `.gitignore` excludes `.env` files (except `.env.example`),
runtime uploads and storage, build output, logs, common database dump formats,
and common private-key files. Safe `.env.example` templates remain tracked.
Ignore rules do not untrack files that were already committed.

The current index still tracks
`server/uploads/review_images/1784785587591-907545501.png` and
`server/uploads/review_images/1784787237809-505932094.png`. Their location and
timestamp-like names indicate generated or uploaded review images, but their
contents were not inspected. Treat them as user-uploaded artifacts until their
owner confirms otherwise. Decide whether each is approved public sample data
or should be untracked in a separately approved change; do not delete it from
the worktree as part of this deployment preparation.

The tracked `docs/Vyapari-Product-Blueprint.pdf` is a project blueprint, not
the generated invoice PDF identified above. Its contents were not inspected.
Confirm that it contains no private business or personal information before
publishing the repository publicly.

### Rotate exposed credentials safely

1. In the Neon dashboard, rotate/revoke the PostgreSQL role password that was
   previously shared. Do not send the replacement in chat. Update the
   server-only `DATABASE_URL` in the private local `server/.env` and in the
   backend host's secret settings. Restart the backend and verify its
   readiness endpoint without exposing the URL in logs.
2. Generate a new high-entropy `JWT_SECRET` locally or with a password
   manager. Update the same private local and backend-host settings. Replacing
   it invalidates existing JWTs, so users may need to sign in again.
3. Check any other development/hosting copies and revoke provider tokens or
   API keys that may have been exposed. Keep frontend `VITE_*` settings free
   of private credentials.
4. Never put replacements in `.env.example`, source code, command history,
   screenshots, GitHub, or this chat. Confirm rotation in the provider
   dashboards, since source-code inspection cannot prove provider-side
   invalidation.

## Neon migration audit

### Baseline and runner findings

- `server/migrations/000_baseline.sql` is a structure-only generated snapshot
  dated 2026-08-27. It creates 54 tables and the `pgcrypto` extension. It does
  not contain application rows.
- `server/migrations/marketplace_schema.sql` is byte-for-byte identical to the
  baseline. It is not a second schema to apply.
- The baseline already contains some older marketplace and Wholesale 3.0
  tables. Later SQL files add missing columns, constraints, indexes, functions,
  triggers, and newer tables such as suppliers, purchases, and delivery
  challans.
- The snapshot contains tables, sequences, indexes, primary/foreign/check
  constraints, and `pgcrypto`. The migration set defines functions and
  triggers, but no PostgreSQL enum types or views were found. Statuses and
  roles are represented as text/varchar values, often constrained by `CHECK`
  constraints. The schema is managed with SQL rather than an ORM model layer.
- There are 64 `.sql` files. One is the duplicate baseline and one is a
  diagnostic query, so the folder is not a safe instruction to run every file
  alphabetically.
- The former runner applied every `.sql` file alphabetically and retried
  failures, but had no migration ledger or advisory lock. Retrying does not
  repair a file that succeeds too early because it uses `ALTER TABLE IF EXISTS`.
  In particular, the old order could silently skip supplier/import columns
  and delivery-challan fields.

The revised `server/run_migrations.js` uses an explicit manifest, checks that
every SQL file is either included or deliberately excluded, records file
checksums in `public.schema_migrations`, locks concurrent runs, and wraps each
migration with its history entry in a transaction. Before applying the
baseline, it permits no pre-existing public-schema objects other than the
runner's exact migration-history table and its single primary-key index. It
checks relations, indexes, standalone user-defined types, routines, operators,
operator classes/families, collations, conversions, and text-search objects.
User-defined event triggers are also rejected because they can affect DDL
across schemas. Other objects outside `public` are outside the baseline
emptiness check.

Running the migration script with no arguments or `--plan` only prints the
plan. On Windows PowerShell use `npm.cmd run migrate -- --plan`; the local
`npm.ps1` shim has been observed to discard arguments after `--`. The plan path
does not load the database module. Database changes require the explicit
`--apply` option.

### Migration-history validation

Before applying anything, the runner requires `schema_migrations` to be an
ordinary table with exactly `filename TEXT PRIMARY KEY`, `checksum TEXT NOT
NULL`, and `applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`. It
checks NOT NULL through column nullability, and rejects extra non-nullability
constraints, indexes, triggers, row security, policies, or rules.
For ledger rows, it rejects unknown migration IDs, duplicate IDs, invalid
checksum formats, checksums that do not match the current SQL, and any gap in
manifest order. A valid history is an exact prefix of the manifest; its
unrecorded suffix is pending work, not an inconsistent missing migration.
The primary key also prevents duplicate filenames in the normal schema.

The advisory lock is session-scoped. The runner checks that unlock returns
success. If acquisition was attempted but not confirmed, or unlock fails, it
destroys the borrowed connection instead of returning a possibly locked
session to the pool. It then closes the pool even if releasing the connection
fails.

### Excluded files

| File | Reason not included in the fresh Neon plan |
|---|---|
| `marketplace_schema.sql` | Duplicate of `000_baseline.sql`. |
| `check_self_dealing_orders.sql` | Read-only diagnostic queries. Its cleanup statements are comments and are not executed. |
| `backfill_paid_invoices.sql` | Data repair that inserts into `payments` and `invoice_logs` and updates `invoices` and `orders`. The reported target is empty, so there are no existing rows to repair. |
| `fix_uuid_column_types.sql` | Legacy repair for older schemas. It can delete all `order_status_history` or `payment_transactions` rows when `order_id` is not UUID; the fresh baseline already defines those reference columns as UUID. |
| `add_trust_score_and_response_rate.sql` | Adds unverified vanity metrics (`95%`, `98%`, and `< 2 hrs`) instead of computed values. |
| `drop_trust_score_and_response_rate.sql` | Drops `trust_score` and `response_rate` from `wholesaler_profiles`; optional cleanup, excluded from this plan. |
| `wholesale3_drop_stale_credit_columns.sql` | Conditionally drops five derived credit columns from `parties` only when they contain defaults; if non-default values exist, it leaves them in place. Excluded pending separate review. |

If the target database is not empty, do not use this fresh-database plan. The
runner will stop if objects exist in `public` without its migration history.
Reconcile the schema and data first rather than forcing the baseline or
guessing which files already ran.

### Dependency and data-change notes

- `wholesale3_opening_balance.sql` follows `wholesale3_purchases.sql` because
  the former adds opening-balance fields to `suppliers`.
- `wholesale3_order_party.sql` follows `wholesale3_parties_and_sales.sql`;
  `wholesale3_one_ledger.sql` and `wholesale3_order_to_sale.sql` follow both.
- `wholesale3_invoice_from_sale.sql` follows the parties/sales schema, and
  `wholesale3_credit_notes.sql` follows invoice-from-sale.
- `wholesale3_delivery_challans.sql` precedes
  `wholesale3_series_financial_year.sql`, which precedes
  `wholesale3_challans_two_kinds.sql`.
- `wholesale3_imports.sql` follows the tables it extends, especially
  `suppliers` and `purchases`, because it uses `ALTER TABLE IF EXISTS`.
- `wholesale3_uqc_master_units.sql` follows
  `wholesale3_platform_masters.sql`, which creates `master_units`.
- `wholesale3_invoice_numbers_per_wholesaler.sql` follows
  `enterprise_invoice_module.sql`; `wholesale3_sales_channels.sql` follows
  invoice numbering; `wholesale3_marketplace_linkages.sql` follows sales
  channels and the order/sale financial-year sequences.
- `z_fix_order_payment_status_constraint.sql` remains the final order
  payment-status constraint migration. The narrowly scoped profile recovery
  migration follows it and changes no order schema.

Some included files update old rows or remove legacy constraints/sequence
records. For a genuinely empty database, those data statements have no rows to
change. This was assessed from the SQL, not verified against Neon. Do not apply
this plan to a database containing user data without a backup and a separate
review.

### Static review of row-changing migrations

The following included files change, backfill, normalize, delete, or recreate
existing data/schema. These effects are why the plan is only for a newly
verified empty target, not permission to skip or run files selectively.

| Migration | Static finding |
|---|---|
| `add_installment_payments.sql` | Backfills `orders.remaining_amount` and `orders.amount_paid` from payment status and order totals; drops/replaces matching payment-status checks on `orders`. |
| `add_order_delivery_fields.sql` | Normalizes null or legacy-capitalized `orders.status` and `orders.payment_status` to `pending`. |
| `enterprise_order_management.sql` | Assigns generated order numbers to rows missing them and fills `orders.supplier_id` from `supplier_inventory`. |
| `listing_visibility.sql` | Sets missing/invalid `supplier_inventory.visibility` values to `public`. |
| `align_schema_with_app.sql` | On legacy mismatched types, drops and recreates listed reference columns, losing their old values; makes legacy fields nullable and installs compatibility triggers. It also drops/re-adds `order_status_history.changed_by` when it is not UUID. |
| `fix_order_status_constraint.sql` | Normalizes `orders.status` and `payment_status`, maps unrecognized values to `payment_pending`/`pending`, and replaces status checks. |
| `wholesale3_invoice_numbers_per_wholesaler.sql` | Seeds per-owner `invoice_sequences` from `invoices`, deletes ownerless sequence rows, changes keys/indexes, and drops global invoice-number uniqueness. |
| `wholesale3_sales_channels.sql` | Drops the prior invoice-sequence owner/year index before creating the owner/series/year index. |
| `wholesale3_series_financial_year.sql` | Backfills `sale_sequences` and `delivery_challan_sequences.financial_year` from the current date and replaces primary keys. |
| `wholesale3_challans_two_kinds.sql` | Marks challans with an `invoice_id` as billed, widens the challan sequence key, and drops an obsolete index. |
| `wholesale3_uqc_master_units.sql` | Assigns UQC values to matching master units, resets a previous default `BOX` value for `case`, and replaces its foreign key. |
| `wholesale3_marketplace_linkages.sql` | Clears `orders.channel='shop'`, deletes duplicate sale/order sequence rows while keeping the highest counters, and drops legacy series/prefix columns. |
| `z_fix_order_payment_status_constraint.sql` | Normalizes order payment-status values and maps unsupported values to `pending` before replacing the check. |
| `wholesale3_platform_masters.sql`, `wholesale3_master_settings.sql`, `wholesale3_tax_terms_and_cess.sql`, and `wholesale3_uqc_master_units.sql` | Insert reference/configuration seed rows with conflict handling; UQC migration also updates matching `master_units` and clears a prior `case='BOX'` guess. Treat the seeded lists/rates as application defaults requiring business review. |

`000_baseline.sql` creates tables, indexes, sequences, and `pgcrypto`; it has
no application-data backfill. Several later SQL files repeat
`CREATE TABLE IF NOT EXISTS`, `CREATE EXTENSION IF NOT EXISTS`, or index
definitions. Those statements do not reconcile an existing object's columns,
constraints, or types.

Other included migrations drop and recreate constraints or indexes as part of
the schema transition, including `add_installment_payments.sql`,
`fix_order_status_constraint.sql`, `wholesale3_order_number_per_owner.sql`,
`wholesale3_razorpay_route.sql`, `wholesale3_sales_channels.sql`,
`wholesale3_challans_two_kinds.sql`, `wholesale3_imports.sql`, and
`wholesale3_staff_accounts.sql`. The plan also
replaces several functions and triggers. These are schema changes, not silent
data skips; a failed statement rolls back its whole file and history record.

`fix_uuid_column_types.sql` is deliberately excluded from this fresh-baseline
plan. Its legacy path can delete all rows in `order_status_history` or
`payment_transactions` when their `order_id` types are not UUID, and drops
other mismatched columns. In contrast, the baseline definitions for the
reference columns listed by `align_schema_with_app.sql` are already UUID; the
baseline also contains `order_status_history.updated_by` and the
`payment_transactions` fields that `fix_uuid_column_types.sql` adds. A static
check of those baseline definitions found no target requiring that legacy
repair on the fresh path. `align_schema_with_app.sql` has a stale header saying
it runs "after fix_uuid_column_types.sql"; that describes the old-schema path,
not a dependency of the fresh baseline. Its conditional type-repair blocks
remain as a compatibility guard. No SQL was executed to confirm the whole
sequence.

`pgcrypto` is required by the SQL. The baseline and several included
migrations use `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`. Before applying,
confirm Neon supports the extension for the selected PostgreSQL version and
that the migration role can create it, or have the provider/admin install it
through the supported process. `IF NOT EXISTS` does not bypass permissions.
On the local PostgreSQL 18.6 test server, `pgcrypto` was available, the local
role had database-create/superuser privileges, and the baseline successfully
installed it. Neon support and permissions remain unverified.

### Disposable migration test procedure

The initial local test was performed on 2026-10-23. The final two reviewed
profile-recovery migrations were applied on 2026-10-26:

- Before applying, the configured URL was confirmed locally as
  `127.0.0.1:5432/wholesale_marketplace_test`. A live read-only identity query
  confirmed the actual database and server address. The runner's exact
  baseline preflight found no public-schema objects.
- On 23 October, the runner applied the then-current 57-migration manifest.
  On 26 October, it applied the two added profile recovery migrations. The
  current local ledger records all 59 migrations with checksums.
- A separate read-only verification validated the exact manifest prefix and
  all checksums, confirmed `pgcrypto` is installed, and found no user or order
  rows. The resulting public schema contains 78 tables, including the runner
  ledger and reference/configuration data.
- Two runner issues discovered during the real local run were fixed and
  covered by tests: canonicalizing `inet_server_addr()` and validating the
  history table correctly on PostgreSQL 18.

For a future fresh local test database, the runner accepts only
`server/.env.test` configured for the dedicated local database and port 5432.
From `server/`, preview with:

```powershell
npm.cmd run migrate -- --plan
```

Only use `npm.cmd run migrate -- --apply` for the dedicated local test target.
The runner validates both the configured URL and the actual connected database
before changing schema. On this machine, `npm` resolves to a PowerShell
`npm.ps1` shim that drops arguments after `--`; `npm.cmd` forwards them. Do not
use `npm run migrate -- --apply` in this PowerShell environment because it
silently ran plan mode instead.

Do not use `node --env-file=.env.neon` or `.env.migration-test` with this
runner. The code explicitly loads `.env.test` with override enabled and
rejects non-local targets.

To rerun the local mocked runner tests from `server/`, use:

```powershell
node --test tests/runMigrations.test.js
```

## Reviewed migration order

This is the runner's exact order. `npm.cmd run migrate -- --plan` prints the
same list and checks that the files on disk still match it.

1. `000_baseline.sql`
2. `add_installment_payments.sql`
3. `add_order_delivery_fields.sql`
4. `add_seller_profile_columns.sql`
5. `add_upi_id_field.sql`
6. `enterprise_invoice_module.sql`
7. `enterprise_order_management.sql`
8. `inventory_forecast_intelligence.sql`
9. `listing_visibility.sql`
10. `messaging_system.sql`
11. `notification_system.sql`
12. `phase2_a_tracking.sql`
13. `phase2_b_driver_links.sql`
14. `phase2_c_warehouse.sql`
15. `retail_features.sql`
16. `reviews_system.sql`
17. `retire_vanity_metrics.sql`
18. `align_schema_with_app.sql`
19. `fix_order_status_constraint.sql`
20. `wholesale3_parties_and_sales.sql`
21. `wholesale3_items.sql`
22. `wholesale3_platform_masters.sql`
23. `wholesale3_master_settings.sql`
24. `wholesale3_purchases.sql`
25. `wholesale3_opening_balance.sql`
26. `wholesale3_party_state.sql`
27. `wholesale3_listing_billing_fields.sql`
28. `wholesale3_tax_on_top.sql`
29. `wholesale3_tax_terms_and_cess.sql`
30. `wholesale3_uqc_master_units.sql`
31. `wholesale3_razorpay_route.sql`
32. `wholesale3_invoice_numbers_per_wholesaler.sql`
33. `wholesale3_invoice_number_format.sql`
34. `wholesale3_invoice_document_block.sql`
35. `wholesale3_invoice_rule46_fields.sql`
36. `wholesale3_fractional_invoice_quantity.sql`
37. `wholesale3_drop_invented_hsn.sql`
38. `wholesale3_sales_channels.sql`
39. `wholesale3_order_party.sql`
40. `wholesale3_one_ledger.sql`
41. `wholesale3_order_to_sale.sql`
42. `wholesale3_invoice_from_sale.sql`
43. `wholesale3_credit_notes.sql`
44. `wholesale3_delivery_challans.sql`
45. `wholesale3_sale_transport.sql`
46. `wholesale3_order_transport.sql`
47. `wholesale3_series_financial_year.sql`
48. `wholesale3_challans_two_kinds.sql`
49. `wholesale3_order_sequences.sql`
50. `wholesale3_order_number_sequence.sql`
51. `wholesale3_order_number_per_owner.sql`
52. `wholesale3_imports.sql`
53. `wholesale3_stock_ledger.sql`
54. `wholesale3_staff_accounts.sql`
55. `wholesale3_one_invoice_per_order.sql`
56. `wholesale3_marketplace_linkages.sql`
57. `z_fix_order_payment_status_constraint.sql`
58. `wholesale3_restore_wholesaler_profiles.sql`
59. `wholesale3_restore_wholesaler_profile_payout_fields.sql`

## Local migration command

The runner is never called by application startup. It defaults to plan-only.
Its apply mode is restricted to `server/.env.test`, which overrides any
inherited `DATABASE_URL` and is validated as local
`wholesale_marketplace_test` on port 5432.

For the already-migrated local test database, run:

```powershell
Set-Location 'C:\Users\Chitransh Koshta\wholesale-product\server'
npm.cmd run migrate -- --plan
```

For a future fresh local test database only, the command that applies changes
is:

```powershell
npm.cmd run migrate -- --apply
```

Do not configure `.env.test` with a Neon URL or use the local `migrate`
command against Neon.

## Explicit Neon migration command

`migrate:neon` reuses the same 59-file manifest, checksum verification,
ordered history-prefix checks, baseline-empty-schema preflight, per-file
transactions, and advisory lock as the local runner. It requires a direct
Neon hostname, an exact expected database name and endpoint hostname, explicit
backup confirmation, and the `NEON_MIGRATION_DATABASE_URL` environment
variable. It does not run at startup. It refuses a Neon pooler endpoint, an
unexpected connected database or schema, an incompatible history ledger, or
an untracked/non-empty public schema when starting from baseline.

First create a recoverable Neon branch or backup and confirm the target is the
intended project, endpoint, and database. Preview the order without opening a
database connection:

```powershell
Set-Location 'C:\Users\Chitransh Koshta\wholesale-product\server'
npm.cmd run migrate:neon -- --plan
```

For a newly created, empty Neon database with no data to import, provide the
direct endpoint URL in `NEON_MIGRATION_DATABASE_URL` through a secure shell
environment, then apply with both database and endpoint confirmations:

```powershell
npm.cmd run migrate:neon -- --apply --database <database-name> --endpoint <direct-neon-hostname> --confirm-backup yes
```

The endpoint argument is the hostname only, for example the `ep-...neon.tech`
host shown by Neon, not the URL or credentials. `--database` must match the
database path in the URL and the live `current_database()` result. A backup
must already exist and be restorable before confirming. Run this from a
trusted operator machine or temporary secure migration environment, not
Vercel, and remove the migration URL from that environment after completion.
The command reports migration names and PostgreSQL diagnostics without
printing the connection URL. A failed migration rolls back that migration and
its ledger entry, stops immediately, and must be reviewed before retrying.

The full manifest includes some legacy normalization/backfill statements
documented above. Use it for an empty database only, unless a database has a
valid exact-prefix `schema_migrations` ledger and each pending data-changing
migration has been reviewed for the target's existing rows. The command does
not infer migration history from the presence of tables. Never create ledger
rows by hand to make an existing schema appear migrated.

Several included historical migrations contain conditional column
replacement or cleanup of obsolete sequence rows. The migration runner does
not drop tables, but these statements can discard column values or rows on a
populated target. For this new Neon database, proceed only after confirming
that it is genuinely empty and the baseline preflight accepts it. If there is
any existing application data, partial migration history, or unexpected
public-schema object, stop and review the pending migration effects before
applying anything.

## Verify the Neon schema

Run the read-only verifier after migration. It derives the expected
application table names from the 59 included SQL migrations, confirms the
expected database and `public` schema, reports missing tables, and checks the
migration ledger against the version-controlled filenames and checksums. It
does not apply SQL and exits non-zero if tables are missing, migration history
is absent or incomplete, or the connected target does not match.

Set `DATABASE_URL` securely in the operator shell to the intended Neon
application endpoint. A pooled Neon URL is supported. The verifier rejects
`search_path` in URL startup options or `PGOPTIONS`; do not put the URL in
command arguments, source files, or logs. Then run:

```powershell
Set-Location 'C:\Users\Chitransh Koshta\wholesale-product\server'
npm.cmd run db:verify -- --database wholesale_marketplace
```

The current manifest declares 77 application tables, including `users`,
`wholesaler_profiles`, `products`, and `supplier_inventory`. This verifier
checks tables and migration history, not every column, constraint, index,
trigger, function, extension, grant, or row. Use the read-only inventory in
`server/inspect_full_schema.sql` for a broader catalog review. After it
reports all 59 migrations recorded and no missing tables, test readiness,
registration, login, the catalogue, and city filtering through the deployed
service.

If a source database contains data to preserve, do not run the fresh baseline
plan over it. Back up both source and target, create an empty Neon database,
and copy a complete custom-format dump, including schema, data, and sequence
state. Use the direct Neon endpoint and prevent restore from dropping anything:

```powershell
pg_dump --format=custom --no-owner --no-acl --file .\wholesale-source.dump --dbname $env:SOURCE_DATABASE_URL
pg_restore --exit-on-error --no-owner --no-acl --dbname $env:NEON_MIGRATION_DATABASE_URL .\wholesale-source.dump
```

Only run `pg_restore` against a verified empty target. Do not add `--clean` or
`--create`. This transfers the source database's schema and its own
`schema_migrations` table, if present. Afterward compare its migration
history and checksums with the repository, then audit columns, constraints,
indexes, functions, triggers, sequences, extensions, and row counts. If the
source has no compatible migration ledger or differs from the repository
migration history, stop for a separately reviewed schema reconciliation; do
not try the full manifest against the restored data automatically. Keep the
dump in restricted storage and securely remove it according to the
data-retention policy after verification. Since `--no-owner --no-acl` omits
source role ownership and grants, create the least-privilege Neon application
role and grant only the required schema/table/sequence permissions separately.

Do not paste migration files one at a time in pgAdmin if you also intend to use
the runner. That bypasses the history/checksum record and can leave the runner
unable to tell what has already been applied. If a run fails, keep the exact
failed filename and error, stop there, and review before retrying.

### Recovery

There are no down migrations. Before applying, keep the Neon branch point or
backup available. For a failed initial setup, stop the app and diagnose the
failed file; do not drop tables or reset the branch as a shortcut. Correct the
cause and use the recorded history to resume, or restore a reviewed backup
using Neon's recovery tools. The runner will refuse checksum changes to an
already recorded migration; use a new forward migration rather than editing an
applied migration.

## Configure the backend host

Deploy `server/` as a Node service on Railway or Render. Use Node.js 22.12 or
newer, install dependencies from `server/package-lock.json`, and start with
`npm start` from the `server` root. Do not run migrations from a build or
startup command.

Set secrets and server variables in the host dashboard, not in Vercel:

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL URL for application traffic. Keep it server-only. For Neon, use the intended project/database; a pooled endpoint can be used for app traffic if required. Remote TLS is verified. The pool uses at most 10 connections per backend process. |
| `NEON_MIGRATION_DATABASE_URL` | Only during Neon migrations | Direct, unpooled Neon URL used only by `migrate:neon`. Supply it through a private environment variable, never in source, Vercel variables, or logs. |
| `DATABASE_SSL_CA` | Conditional | Trusted PEM CA certificate for a private or self-signed PostgreSQL endpoint, including Render internal hosts when their certificate is not publicly trusted. Remote TLS verification is never disabled. |
| `JWT_SECRET` | Yes | Secret used to sign and verify sessions. Rotate the previously shared value. |
| `CLIENT_URL` | Yes in production | Exact Vercel origin, or a comma-separated list of exact allowed origins. No paths or wildcard. |
| `PORT` | Host supplied | The server reads this value and defaults to 5000 locally. |
| `NODE_ENV` | Set to `production` | Makes local development CORS origins unavailable. |
| `JWT_EXPIRES_IN` | Optional | Defaults in application code; use a duration such as `30d`, not a bare number. |
| `CHALLAN_WHEN_UNPAID` | Optional | Defaults to `false`. Keep disabled until the business/legal behavior is approved. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_API_BASE` | Optional | Used by Razorpay integrations. Do not set secrets until the provider account and webhook are configured. |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SENDGRID_API_KEY` | Optional | Email provider configuration. Only configure the selected provider. |
| `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | Optional | SMS provider configuration. |
| `WHATSAPP_PROVIDER`, `TWILIO_WHATSAPP_FROM` | Optional | WhatsApp provider configuration. Twilio account credentials are shared with the SMS integration. |
| `FCM_SERVICE_ACCOUNT_JSON` | Optional | Firebase Cloud Messaging service-account JSON. Keep it in the backend host's secret store. |
| `GEOCODER_USER_AGENT` | Optional | User-agent string used by the geocoding service. |

The backend binds to the platform-provided port. Startup rejects a missing
`JWT_SECRET`, an invalid `PORT`, or a production configuration without
`CLIENT_URL`. `SIGTERM` and `SIGINT` close Socket.IO before ending the
PostgreSQL pool. `/healthz` is a liveness check; `/readyz` returns a failure
response when PostgreSQL is unavailable.

The pool does not send a PostgreSQL startup `options` parameter. This is
required for Neon pooled connections, which reject `search_path` in startup
options. PostgreSQL's default search path includes `public`, where the
application migrations create the tables. Do not add `options=-c
search_path=public` (including a URL-encoded equivalent) to `DATABASE_URL`,
or set `PGOPTIONS` to a value that sets `search_path`; the server rejects
either configuration with an actionable error.
Remote TLS remains verified. The pool gives up after 5 seconds waiting for a
connection, 8 seconds for a PostgreSQL statement, or 9 seconds for a
client-side query deadline. Check `/readyz` before interpreting an empty
catalogue response. A healthy `/healthz` only means the HTTP process is
running.

### Diagnosing PostgreSQL `42P01` in catalogue and authentication

The city resolver reads `information_schema.columns` for optional city
columns. It does not issue SQL against `wholesaler_profiles` there. The
catalogue queries subsequently reference `products`, `supplier_inventory`,
`users`, and `wholesaler_profiles`; login uses `users`, while seller
registration also inserts into `wholesaler_profiles`. The migration manifest
includes `000_baseline.sql`, which defines these relations in `public`. The
confirmed catalogue error names `public.wholesaler_profiles`. The login
handler's credential query is `SELECT ... FROM users`; it does not reference
`wholesaler_profiles`. The reported login log omitted PostgreSQL's relation
detail, so the source query is known but the exact relation resolution failure
is not. Verify `public.users` and the active search path in the connected
database before attributing that error to a missing table versus an incorrect
database or schema.

After deploying, a PostgreSQL `42P01` log includes the structured relation
and schema fields when the driver supplies them. First verify the Render
service's `DATABASE_URL` points to the intended database without printing the
URL. Do not disable TLS. Then run these read-only queries in that database:

```sql
SELECT current_database(), current_schema(), current_setting('search_path');

SELECT
  to_regclass('public.users') AS public_users,
  to_regclass('public.products') AS public_products,
  to_regclass('public.supplier_inventory') AS public_supplier_inventory,
  to_regclass('public.wholesaler_profiles') AS public_wholesaler_profiles,
  to_regclass('public.schema_migrations') AS public_schema_migrations;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name IN (
  'products', 'supplier_inventory', 'users', 'wholesaler_profiles',
  'schema_migrations'
)
ORDER BY table_schema, table_name;
```

If `schema_migrations` is present in `public`, inspect its columns first:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'schema_migrations'
ORDER BY ordinal_position;
```

If the ledger has the expected `filename`, `checksum`, and `applied_at`
columns, compare its rows with the migration manifest. A missing baseline
record or database/schema mismatch is not established until these live checks
have been made. The `wholesale3_restore_wholesaler_profiles.sql` migration is
a narrow, forward-only repair based on the baseline and later profile
migrations. It creates the table only if absent, inserts no users or profile
rows, and relies on the existing `public.users(id)` key for its foreign key.
The following
`wholesale3_restore_wholesaler_profile_payout_fields.sql` adds three optional
bank-detail fields already present in the application's invoice schema. Neither
migration repairs a missing `public.users` table or other missing baseline
relations.

Read the ledger only after checking its columns:

```sql
SELECT filename, checksum, applied_at
FROM public.schema_migrations
ORDER BY applied_at, filename;
```

Before applying anything, create and verify a provider backup or recoverable
branch for the database named by Render's `DATABASE_URL`. In Render's
PostgreSQL dashboard, confirm a recent backup has completed and is retained
for restore; if the URL points to Neon or another provider, create and verify
that provider's backup/branch instead. Confirm `public.users` exists,
the effective search path includes `public`, and no conflicting profile table
exists in another schema. Inspect migration history first. The dedicated
repair command below refuses a mismatched database name, a local target,
missing `public.users`, an unexpected search path, an ambiguous profile table,
an existing profile schema missing required core columns or constraints, or
migration history that is not at the repair boundary. Missing payout fields
are added by the follow-up migration. It takes the same advisory migration lock
as the standard runner and applies only the two profile repair migrations, not
the full manifest. If the standard `public.schema_migrations` ledger exists
and contains the exact preceding
57-migration prefix, the command validates and records checksums for the two
repair migrations in the same transaction. If no ledger exists, it does not
invent one. If history is inconsistent, stop and reconcile it rather than
forcing the change.

Run the command from Render's Shell in the `server` directory after confirming
that `DATABASE_URL` points to the backed-up target and that `DATABASE_SSL_CA`
is set when the endpoint uses a private CA. Replace `<database-name>` with the
value returned by `current_database()` during the preflight. The URL and
credentials are read from the service environment and are never printed:

```sh
npm run migrate:restore-wholesaler-profile -- --apply --database <database-name> --confirm-backup
```

This command is deliberately separate from startup. Do not configure the full
migration runner or baseline as the production start command. The ordinary
`npm run migrate` remains restricted to the local test database. The profile
repair is transactional and repeat-safe:
an already-correct profile table is verified without re-creating it, while an
existing partial or conflicting schema causes an explicit refusal.

Verify the new relation and its declared constraints before restarting the
backend:

```sql
SELECT to_regclass('public.wholesaler_profiles') AS wholesaler_profiles;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'wholesaler_profiles'
ORDER BY ordinal_position;

SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.wholesaler_profiles'::regclass
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'wholesaler_profiles'
ORDER BY indexname;
```

If `public.users` is absent, do not apply the profile repair alone and do not
create an empty replacement `users` table. Diagnose the intended database and
recover the correct user data/schema first. A missing base relation can mean
migrations were not run, the service points to a different database, or the
relation is outside the application's active `search_path`.

After deployment, verify these public GET endpoints without sending credentials:

```powershell
curl.exe -i https://<your-backend-origin>/healthz
curl.exe -i https://<your-backend-origin>/readyz
curl.exe -i https://<your-backend-origin>/api/products
curl.exe -i https://<your-backend-origin>/api/products/cities
```

Both catalogue endpoints should return JSON arrays when ready. An empty array
is valid only after `/readyz` succeeds. Test login with a known test account
and registration only with an intentionally disposable test identity. Do not
test production registration with a real customer's email.

## Configure Vercel

Create/import a separate Vercel project from the existing GitHub repository:

- Root directory: `client`
- Framework preset: Vite
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`
- Public environment variable: `VITE_API_BASE_URL=https://<your-backend-origin>`
- Public Cloudinary settings, if used by the browser: `VITE_CLOUDINARY_CLOUD_NAME`
  and `VITE_CLOUDINARY_UPLOAD_PRESET`

Production builds now reject a missing or unsafe `VITE_API_BASE_URL`. It must
be an HTTPS origin without credentials or a path, and cannot point to a
loopback address. Development retains the `http://localhost:5000` fallback.

`VITE_*` values are included in browser code. Never put `DATABASE_URL`,
`JWT_SECRET`, SMTP passwords, private API keys, or webhook secrets in Vercel
frontend variables. The existing `client/vercel.json` handles SPA refreshes.

The backend is not deployed from the Vercel project. Set `CLIENT_URL` on the
backend to the exact production Vercel origin. Preview deployments require
explicitly adding their origin or using a stable preview domain.

Vercel's `VITE_CLOUDINARY_CLOUD_NAME` and
`VITE_CLOUDINARY_UPLOAD_PRESET` are public browser-upload settings for product
images. They do not persist the backend's review uploads. Review images are
written to `server/uploads/review_images` and served from `/uploads`; generated
invoice PDFs are cached at `server/storage/invoices`. Before production, either
configure and verify a persistent mounted volume at those paths for a
single-instance backend, or implement and test durable object storage. No
object-storage adapter is currently configured.

## Smoke-test checklist

These are checks to perform after deployment. They have not been performed by
this audit.

- Open the Vercel homepage and refresh a nested frontend route.
- Open the backend `/healthz` and `/readyz` endpoints.
- Confirm `/readyz` is healthy and backend logs contain no database connection
  errors.
- Register a test account, sign in, sign out, and verify role-protected routes.
- Load products and create/update a product using an authorized account.
- Place and process a test order, including the expected payment and invoice
  behavior.
- Confirm Socket.IO connects from the allowed frontend origin.
- Upload a review image, restart/redeploy the backend, and confirm it remains
  accessible. Do not consider uploads production-ready until persistence is
  proven.
- Check browser network requests and built assets for `localhost`, secret
  values, or private server variables.
- Check Vercel and backend runtime logs if any request fails.

## Backups and recovery

Keep development and production databases separate. Before any production
schema change, use Neon backup/branching or another verified backup procedure.
The current Neon database is reported empty, so no data transfer is planned.
Do not use a development dump containing private data as a production seed.

Migrations are forward-only in practice. Prefer a new corrective migration
over editing a migration already recorded in `schema_migrations`. Test that
migration against a disposable Neon branch or local PostgreSQL first. No
production migration should be run automatically at server boot.

## GitHub status

The repository already has an `origin` remote and is on `main`. No push, commit,
branch change, or remote modification was performed. The existing
`.gitignore` modification was present before this work and was preserved.

## What has not been verified

- Neon was not contacted. Its empty-table state is based on the user's report.
- No migration or SQL statement was executed against Neon or another remote
  database.
- The migration order has been replayed on the local PostgreSQL 18.6 test
  database. Provider-specific behavior, including Neon extension permissions,
  remains unverified.
- No backend host or Vercel deployment was created or changed.
- No production registration, login, order, payment, upload, or realtime flow
  was tested.
- Storage persistence still needs a hosting decision and verification.
