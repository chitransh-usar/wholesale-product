# CLAUDE.md

Notes for Claude Code, or any AI assistant, working in this repository.
Written to save the next session from rediscovering things the hard way.

## What this is

A B2B wholesale marketplace for Indian trade. Retailers browse products,
compare wholesalers, and order. Wholesalers list stock, take orders, and
raise GST invoices.

- `client/` React 19 + Vite (rolldown), React Router v7, Tailwind v4
- `server/` Express 5 + Socket.IO + PostgreSQL (Neon)

## Running it

```bash
cd server && npm run dev     # nodemon src/server.js, port 5000
cd client && npm run dev     # vite
cd client && npm run lint    # eslint
cd client && npx vite build  # the quickest full check that nothing is broken
```

There is no server test script. `node --check <file>` catches syntax errors;
real verification means driving the code against a database (see below).

Required env: `DATABASE_URL`, `JWT_SECRET` on the server;
`VITE_API_BASE_URL`, `VITE_CLOUDINARY_CLOUD_NAME`,
`VITE_CLOUDINARY_UPLOAD_PRESET` on the client. Email, SMS, WhatsApp and push
providers are all optional and degrade quietly when unset.

## Migrations are not automatic

`server/migrations/*.sql` are run by hand against Neon. Nothing applies them
on boot, so a feature can be complete in code and still broken in production
because its migration has not been run. When you add a column, say so
explicitly in your final message.

Files are applied in rough date order, except `z_fix_order_payment_status_constraint.sql`,
which is named to sort last because it re-applies a CHECK constraint that
earlier files drop.

**Never put a semicolon inside a comment in a migration.** Use a full stop.
They are pasted into a hosted SQL editor, which splits a file on semicolons
with no idea that one is inside a `--` comment. It cuts the sentence in half
and hands the tail to the server as a statement, producing a syntax error
that points at a line nowhere near the real problem. `psql` runs such a file
perfectly, so `psql -f` passing proves nothing about this. It cost a debugging
round on 14 Sept, where the reported error was `syntax error at or near "="`
and the SQL was entirely valid.

For the same reason prefer plain, separately terminated statements over
`DO $$ ... $$` blocks: a splitter cuts straight through the middle of one.
Most guards do not need a DO block at all. `ADD COLUMN IF NOT EXISTS`,
`DROP CONSTRAINT IF EXISTS` followed by `ADD CONSTRAINT`, and
`ALTER TABLE IF EXISTS` between them cover nearly everything, and
`ALTER TABLE IF EXISTS` is how to touch a table another migration may not
have created yet. `wholesale3_razorpay_route.sql` is the worked example.

Test a new migration against a splitter, not just `psql`: split the file on
semicolons and run the pieces one at a time.

## Verifying database work

The pattern that has caught the most real bugs here: start a local Postgres,
build the schema, and drive the actual controller with a fake `req`/`res`.

```js
// The app's pool hardcodes ssl, which a local server does not offer.
// Preload the module cache so the controller under test is the real one.
const Module = require("module");
const { Pool } = require("pg");
const dbPath = require.resolve("./src/config/db");
const testPool = new Pool({
  connectionString: "postgres://postgres@127.0.0.1:5433/test",
});
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const ctrl = require("./src/controllers/orderController");
const makeRes = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
```

Postgres cannot run as root and the unix socket path has a 107 byte limit, so
initdb as the `postgres` user under a short path such as `/var/tmp/pgt` and
connect over `127.0.0.1`, not a socket in a deep scratch directory.

For UI work, a small mock API on port 5000 plus `npx vite --port 5174` and
Playwright (`executablePath: "/opt/pw-browsers/chromium"`) renders real pages.
Screenshotting has repeatedly caught things reading the code did not, such as
broken images sprawling alt text across a card. Seed `localStorage.token` and
mock `GET /api/auth/me` to get past the auth guard.

## Conventions that matter

**Theme.** Tailwind v4 `@theme` tokens in `client/src/index.css`:
cream `#faf6ef`, clay `#c56b4a`, espresso `#3d2e24`, sage `#7a8b6f`. Use these
rather than raw Tailwind colours. Tailwind v4 renamed gradients, so it is
`bg-linear-to-r`, not `bg-gradient-to-r`.

**No em dashes** in code, comments, commit messages or documents. Use a comma
or a full stop.

**No invented data.** Do not display a metric the system does not really
compute. Two vanity fields, `trust_score` and `response_rate`, were removed
for exactly this reason and must not come back. A new seller showing zero is
correct; a plausible-looking number is not.

**The seller dashboard is for wholesalers.** `/seller/*` is guarded by
`RequireRole`. Do not put buyer concepts such as loyalty points or gift card
balances on it.

**Plain English in the UI.** Users are Indian traders who may not read English
as a first language. Say "shop page", not "storefront"; "Everyone", not
"public catalogue".

## Things that are easy to get wrong

**Order lifecycle.** `server/src/services/orderStatusService.js` holds a 22
state machine. `validateStatusTransition` is the authority. Four states are
terminal: `cancelled`, `refunded`, `payment_failed`, `return_rejected`. Never
write `orders.status` without validating the transition, and never write a
status the map does not contain.

The map is an object literal with several duplicate keys, so a later entry
silently wins over an earlier one. They currently agree, but check before
trusting a line you read in isolation.

**Payments are self-declared.** There is no payment gateway. The buyer scans a
UPI QR code and presses a button to say they paid. `initiatePayment` opens a
server-side session so the browser never names an amount; `updatePaymentStatus`
settles it, capped at the outstanding balance.

Orders support a 50/50 instalment plan. A part-paid order still owes money, so
"can this be paid" cannot be asked of the lifecycle alone: see
`canAcceptPayment` in `orderController.js`, which checks both that the order is
not dead and that a balance remains.

**Money in paise.** Use `toPaise`/`fromPaise` when splitting or summing an
amount. Floating point rupees lose a paisa on a 50/50 split of an odd total.

**Stock is reserved at order creation** and credited back only when a payment
is abandoned. If you add a path that kills an order, return its stock from
`order_items`, and only when nothing has been paid yet.

**Listing visibility.** `supplier_inventory.visibility` is `public`,
`storefront` or `private`. Any new query that surfaces listings to buyers must
filter it, or private stock leaks. `private` listings are reachable only
through `/listing/:inventoryId`, an unlisted page whose UUID is the secret.

**Orders can hold several products.** `order_items` is the real content;
`orders.inventory_item_id` is a single-item leftover kept for older readers.
A change that only reads `inventory_item_id` silently drops the rest of the
cart. A branch was rejected for exactly this.

**A 403 is not a dead session.** `client/src/utils/axios.js` clears the token
on 401 only. Clearing it on 403 logs users out mid-browse.

**Invoices are reconciled, not recreated.** `createInvoiceFromOrder` returns
early when an invoice exists, so calling it again after payment leaves the
invoice stamped UNPAID. Use `reconcileInvoiceForOrder`.

**Which state somebody is in decides the tax.** Same state as the customer is
CGST plus SGST, a different state is IGST, and it is a number on a legal
document. Ask `services/placeOfSupply.js` and nothing else: it reads a declared
state, then the state the GST number carries (the first two digits of a GSTIN
ARE the state), then the city. Do not add a fourth chain of COALESCEs, and do
not default an unknown location to a real place: `null` means "not told", which
the service reads as the same state so a local sale bills correctly.

**A challan never moves the ledger.** `services/challanBook.js` holds the two
kinds, `sale` for goods out and `purchase` for goods in, each with its own run
of numbers. A challan exists because goods MOVED, not because anybody has or
has not paid, it carries no GST, and it never touches the party balance. One
that also moved the ledger would have every sale counted twice in the khata,
once when the goods left and again when the bill went out, and both entries
would look correct on their own. `delivery_challan_items.gst_percent` is the
rate the line WILL be billed at, and nothing sums it.

**Nothing in the khata moves stock, including the challan.** This line used to
say a challan moves stock. It does not, and nothing else here does either:
`supplier_inventory.stock` is written only by `orderController.js` and
`orderStatusService.js`, both on the marketplace order path. A sale does not
lower it, a purchase does not raise it, a challan does not touch it. That is
deliberate and self-consistent, see the note at the top of `purchaseController.js`,
but it means the stock figure is meaningless for a wholesaler using the khata.
A stock ledger is the largest missing piece in this product and is written up
in `ROADMAP.md` under the 18 Sept survey. Do not "fix" one document to move
stock on its own: that makes the figure wrong in a new direction.

The bill is NOT converted server side. The challan loads into the sale or
purchase form and the ordinary path prices it, then `stampBilled` closes the
challans in the same transaction that writes the bill. A second copy of the
money arithmetic is what that avoids.

`CHALLAN_WHEN_UNPAID` defaults OFF since 17 Sept and now decides only whether
an unpaid sale holds its invoice back. It used to default on, which was never
what section 31(1) says.

**A sale from a shop order follows that order.** Accepting an order writes a
sale, and the order lifecycle is the authority over both. Its status and its
amounts cannot be changed from the sale side, which returns 409 with
`code: "FOLLOWS_ORDER"`. The sale owes exactly what the customer agreed at
checkout; recomputing or retyping it moves the debt away from the figure he
pressed pay on.

**Bills run per channel, orders and sales do not.** Each sales channel,
including a wholesaler's extra Amazon or Flipkart account (`amazon-2`, see
`services/salesChannels.js`), has its own run of INVOICE numbers, because each
marketplace reconciles against its own. Orders are one `SO/` run and sales one
`S/` run for everything, on purpose: two counters printing the same prefix hand
out the same number twice. Two runs must never share a prefix either, which is
what `prefixClash` checks. Any lookup that can run inside a transaction must
probe with `to_regclass` first: catching a failed statement does not undo the
aborted transaction.

**HSN codes are validated, never guessed.** `services/hsnService.js` checks the
shape (4, 6 or 8 digits) and suggests from the wholesaler's own history plus a
short curated textile list labelled as common rather than as verified. Nothing
maps an HSN to a GST rate and nothing should: rates change and the same heading
carries different rates by price slab.

## Repository layout

```
server/src/
  controllers/   route handlers, most business logic lives here
  services/      orderStatusService (lifecycle), invoiceService, pdfService,
                 gstService, placeOfSupply, hsnService, notificationManager,
                 geocodingService
  repositories/  invoiceRepository, the only repository-style module
  routes/        mounted under /api/* in app.js
  migrations/    hand-applied SQL
client/src/
  pages/         top level screens; pages/dashboard/* is the seller workspace
  layouts/       SellerLayout holds the dashboard shell and nav
  components/    shared UI; components/invoice/* is invoice specific
  context/       Auth, Cart, Socket, Notification, Unread, Wishlist
```

## Where things stand

`PROGRESS.md` at the repository root is the running record: what has been
built, what is left, what is known to be broken, and which migrations still
need running by hand. Read it before starting, and add to it in the same
commit as the work it describes. It is kept out of this file on purpose, so
the instructions every session loads do not grow a changelog inside them.

`ROADMAP.md` beside it is what has been AGREED and not yet started, with an
assessment of what each piece actually needs. Kept separate from PROGRESS so
a decision is never mistaken for a thing that exists. Two items on it,
e-invoice and e-way bill, cannot be finished by writing code alone: they need
credentials and a GSP, and the roadmap says which half is ours.

## Known gaps, as of this writing

Checked 17 Sept. Three entries that used to be on this list were repeated into
a session summary without being checked and turned out to be false, so check
before repeating any of these.

- Seller-side search ("textile wholesalers in Surat") is not built. The shop
  page exists; discovery of it does not.
- `README.md` is substantially out of date. It still describes the marketplace
  and does not mention the khata, GST invoicing, or import and export.
- Git history contains a committed password and an invoice PDF. The credential
  has been rotated; rewriting history is outstanding.
- Products and stock cannot be imported. Everything else can, see
  `services/importService.js`. It was left out because it was not asked for,
  not because it is hard.
- `GST28_CESS12` in `wholesale3_tax_terms_and_cess.sql` is a shipped example
  with an unverified 12 per cent cess. Remove it or zero it before a real
  customer sees it.

Fixed, and no longer gaps, listed because the old wording of this file said
otherwise:

- An order CAN be advanced past `payment_completed`. The whole chain through to
  `completed` is in `client/src/utils/orderStatus.js`, and `Orders.jsx` and
  `SellerOrderDetail.jsx` both call it.
- There IS an admin console, `/administration`, built in Phase 1.
- The invented demo products and the 4.5 star rating were deleted on 14 Sept.

## Working style expected here

Verify rather than assert. Several bugs in this repository were found only by
running the code against a real database or rendering it in a real browser,
and several plausible-sounding claims turned out to be wrong when tested.
State plainly what was checked and what was not.
