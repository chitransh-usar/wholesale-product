# Code audit before the merge

Nothing here is fixed yet. Everything is cited with a file and a line so it
can be checked rather than believed.

Ordered by what it costs to leave alone, not by how easy it is to fix.

## 0. The migrations cannot build a database from scratch

Found by pointing the runner at an empty database. `migrations/` contains
only patches: `ALTER TABLE orders`, `ALTER TABLE supplier_inventory`,
`fix_uuid_column_types`, and so on. **Nothing in the repository creates
`orders`, `order_items`, `supplier_inventory`, `products` or
`order_status_history` in the first place.** They were created by an original
schema that was never committed.

What that costs:

- A new environment cannot be stood up. Every dev or staging database has to
  be cloned from production.
- The merge is going to need throwaway databases to test against, and there
  is no way to make one.
- A new developer cannot run the project at all without a dump from someone.

**The fix is one command against the live database, not a week of
archaeology:**

```
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" \
  > server/migrations/000_baseline.sql
```

Committing that gives an exact baseline, and the existing patch migrations
then apply on top of it in order. Guessing at the original shape by reading
the code would be slower and wrong in places.

Two things were already fixed while finding this, in
`6ac62ac`:

- `enterprise_order_management.sql` had `idSERIAL PRIMARY KEY`, a missing
  space, which is a syntax error that made Postgres reject the whole file.
  None of its eight tables were ever created by the runner. Unnoticed
  because these are normally pasted into a console one at a time.
- The runner made a single alphabetical pass, so a file could fail purely
  because its dependency sorted after it. It now makes passes until nothing
  new succeeds, which is safe because every migration here is idempotent.

## 1. Correctness, worst first

### 1.1 Invoice numbers are shared across every wholesaler

`invoiceRepository.getNextSequenceNumber` increments `invoice_sequences`
keyed on **year alone**:

```sql
INSERT INTO invoice_sequences (year, last_number) VALUES ($1, 1)
ON CONFLICT (year) DO UPDATE SET last_number = invoice_sequences.last_number + 1
```

and `enterprise_invoice_module.sql` declares `year INTEGER PRIMARY KEY`. One
counter for the whole platform.

With one wholesaler this is invisible. With two, wholesaler A gets
INV-2026-000001, B gets 000002, A gets 000003. Each wholesaler's own series
is full of holes.

Why it matters:

- Rule 46(b) wants a **consecutive** serial number, unique per supplier for a
  financial year. Holes are not consecutive.
- It leaks business volume. A wholesaler watching his numbers jump from 14 to
  87 can read the platform's throughput off his own bills.
- The merge is what makes it bite, because the merge is what puts more than
  one wholesaler on one instance.

Sale numbers (`S-0001`, `saleController.js:32`) and credit note numbers
(`CN-0001`, `creditNoteService.js:39`) are already per wholesaler. Invoices
are the odd one out.

Second, smaller: the reset is by calendar year. The Indian financial year
runs April to March, which is the year Rule 46 means.

**Fix shape:** re-key `invoice_sequences` on `(wholesaler_id, year)`,
backfill from each wholesaler's existing highest number, and pass the
wholesaler id down. Numbers already issued must not move.

### 1.2 The order state map has four duplicate keys

`orderStatusService.js` declares `payment_completed`, `return_approved`,
`replacement_requested` and `replacement_issued` twice each in the same
object literal. JavaScript keeps the last one silently.

They agree today. The danger is a future edit to the first copy that appears
to do nothing, and a reviewer who reads the first copy and concludes the
wrong thing about what transition is legal.

**Fix shape:** delete the second block. No behaviour change, verified by
comparing both copies first.

### 1.3 Three invoice paths that have drifted

- `invoiceService.createInvoiceFromOrder` (automatic, on payment)
- `invoiceService.createManualInvoice`
- `saleInvoiceService.createInvoiceFromSale`

They do not agree on:

| | from order | manual | from sale |
| --- | --- | --- | --- |
| recipient snapshot | no | no | yes |
| linked to a party | no | no | yes |
| reaches the khata | no | no | yes |
| GST rate source | settings | payload | the sale line |

So a manual invoice today is a document that exists and is owed by nobody.
It never reaches a customer's balance or a statement.

**Fix shape:** one `buildInvoice` that all three call, differing only in
where the lines and the recipient come from.

### 1.4 Four ledgers

Documented at length in `MERGE_2_AND_3.md` section 3.4. Repeated here only so
this audit is complete: `orders.amount_paid`, `payment_transactions`,
`payments` and `party_payments` all hold money, and only the last is the
customer's actual balance.

## 2. Redundant code

### 2.1 Duplicated helpers

| Helper | Copies | Where |
| --- | --- | --- |
| `money()` formatter | **14** | every dashboard page and 4 components |
| `toPaise` / `fromPaise` | 3 | party, order, sale controllers |
| `clean()` | 4 | item, party, sale controllers, gstService |
| `fullName()` | 2 | pdfService, saleInvoiceService |

The paise ones are the ones that matter. Money arithmetic copied three times
is three places to get rounding wrong, and this project has already shipped
one paisa bug. They belong in `server/src/utils/money.js` and
`client/src/utils/format.js`.

The 14 copies of `money()` are not identical: some use 0 decimal places,
some 2. That inconsistency is currently invisible because no screen shows
both.

### 2.2 `SELECT *` in 8 files

17 occurrences, worst in `promotionController` (8). Every one ships columns
nobody reads over the wire from Neon, and each is a silent break waiting for
a schema change. `creditNoteService.js` and `invoiceRepository.js` have one
each in hot paths.

### 2.3 Scheduled for deletion by the merge

- `items` and `itemController`, once listings absorb them (plan 3.1)
- the `payments` table, once orders produce sales (plan 3.4)
- `orders.inventory_item_id`, the single item leftover that `order_items`
  replaced
- `DELETE /api/invoices/:id`, which soft cancels and stamps "Refunded" when
  nothing was refunded; credit notes replace it

## 3. Query efficiency

### 3.1 Missing index: `party_payments.sale_id`

Five query sites filter on it, including the balance subquery that runs on
the customer list, the customer page, the statement and the overview. The
migration indexes `(party_id, paid_on)` and `(wholesaler_id, paid_on)` but
not `sale_id`.

This is the single cheapest performance win in the codebase: one line.

### 3.2 The balance is a correlated subquery, run per row

`partyController.js:17` defines `BALANCE_SELECT` as two correlated
subqueries, and it is interpolated into the customer **list** at line 62. For
a book of 500 customers that is 1000 subquery executions per page load, and
the page has no pagination, so it grows with the business.

**Fix shape:** two grouped aggregates joined once, rather than two subqueries
per row.

### 3.3 Three list endpoints have no limit and no pagination

- `itemController.listItems`
- `partyController.listParties`
- `orderController.getSellerOrders`

`listSales` is capped at 200. Statements are also unbounded, which is correct
for a document but means a two year statement is one large response.

### 3.4 Row by row inserts

Six loops insert line items one round trip at a time: `orderController:360`,
`saleController:254` and `:625`, `creditNoteService:155`,
`invoiceRepository:309`, `promotionController:37`.

Bounded by cart size so not urgent, but each is a single multi row `INSERT`
away from one round trip instead of ten. Against Neon, round trips are the
expensive part.

### 3.5 The client ships as one 1.8 MB chunk

23 chunks are emitted and `App.jsx` lazy loads 16 routes, but the main chunk
is still 1.8 MB, 506 KB gzipped. Something in the shared import graph is
pulling nearly everything into the entry. Worth one look at what, because
these users are on Indian mobile data.

## 4. What the merge should unify while it is in there

Not new work, just the right moment:

1. One price lookup, per `MERGE_2_AND_3.md` 5b. Today prices are read
   directly in the catalogue, the cart, the sale form and the invoice.
2. One GST call. Four call sites today, three of which pass different rate
   sources.
3. One numbering service, per wholesaler, covering invoices, sales and credit
   notes, which already do it three different ways.
4. One find or create for a party, per plan 3.2.

## 5. Checked and clean

Recorded so nobody re-checks:

- **No orphaned client components.** Every `.jsx` under `components/` and
  `pages/` is referenced.
- **No unused dependencies** on either side. The two that look unused in
  `client/package.json` are Tailwind, consumed through the Vite plugin.
- **No `trust_score` or `response_rate` residue** outside the migration that
  retired them.
- **Every mounted API prefix is called by the client** except `/api/track`,
  which is the public driver link and is opened directly by URL.
- **The 401 versus 403 rule holds.** `utils/axios.js` still clears the token
  on 401 only.
