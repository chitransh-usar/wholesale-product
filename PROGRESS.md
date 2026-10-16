# Where things stand

A running record of what has been built, what is left, and what is known to
be wrong. Kept so a new session, or a new person, does not have to read the
git log to find out.

**Keep this current.** Add to it in the same commit as the work it describes.
A note written later is a note nobody writes.

Newest first. Dates are when the work landed on `claude/wholesale-3.0`.

---

## Needs running by hand

Migrations are not automatic. Nothing applies them on boot, so a feature can
be finished in code and still broken in production.

```bash
cd server && npm run migrate
```

| Migration | What it does | Run? |
|---|---|---|
| `wholesale3_order_number_sequence.sql` | Order numbers from a counter instead of dice | run 7 Sept |
| `wholesale3_one_invoice_per_order.sql` | Unique index so one order cannot hold two invoices | run 7 Sept |
| `wholesale3_staff_accounts.sql` | Employees who work on a wholesaler's book | run 7 Sept |

| `wholesale3_delivery_challans.sql` | Goods-out note when a sale is not fully paid | run 10 Sept |
| `wholesale3_invoice_number_format.sql` | Invoice number prefix, suffix and padding | run 10 Sept |
| `wholesale3_invoice_rule46_fields.sql` | Place of supply, reverse charge, round off | run 10 Sept |
| `wholesale3_platform_masters.sql` | Super admin flag, and the state, unit, tax rate and HSN masters | run 12 Sept |
| `wholesale3_series_financial_year.sql` | Sale and challan numbers restart each financial year | run 12 Sept, confirmed by a sale coming out `S/10/26-27` |
| `wholesale3_purchases.sql` | Suppliers, purchases, purchase lines, money paid out, purchase numbering | run 14 Sept |
| `wholesale3_master_settings.sql` | Platform formatting: decimals, digit grouping, currency, date format | run 14 Sept |
| `wholesale3_opening_balance.sql` | What a customer or supplier already owed before this product | run 14 Sept, re-run 18 Sept for the supplier half |
| `wholesale3_party_state.sql` | The customer's declared state, which decides CGST plus SGST against IGST | run 19 Sept, after standing outstanding since 14 Sept |
| `wholesale3_razorpay_route.sql` | Linked accounts, transfers and webhook deliveries, so a buyer's money reaches the wholesaler | run 14 Sept |
| `wholesale3_challans_two_kinds.sql` | Sale and purchase challans, each with its own run of numbers, and a billed status | run 18 Sept |
| `wholesale3_stock_ledger.sql` | The stock ledger, and the product and challan links on a sale or purchase line | run 18 Sept |
| `wholesale3_order_sequences.sql` | Orders get their own run of numbers, a source marker, and a billed quantity per line | run 19 Sept |
| `wholesale3_order_number_per_owner.sql` | Order numbers unique per wholesaler, not platform wide | **NOT RUN** |
| `wholesale3_marketplace_linkages.sql` | A second Amazon or Flipkart account, each with its own run of bill numbers, and a channel on orders. REWRITTEN 24 Sept, safe whether or not the 22 Sept version was run | **NOT RUN** |

**One outstanding as of 19 Sept**: `wholesale3_order_number_per_owner.sql`.
Until it is run, a second wholesaler's first shop order is refused, because
the old index made an order number unique across the whole platform while the
new series restarts at 1 for each wholesaler. Everything else in this table
has been run.

The three that were outstanding, the two challan kinds, the stock ledger and
the opening balance re-run, all went in on 18 Sept. No restart was needed with
any of them: every schema probe in this codebase caches only a TRUE answer, so
running a migration takes effect on the next request. That rule was put in
after `hasStatus` cached a false and would have pinned "the column is not
there" for the life of the process.

**One outstanding as of 14 Sept.**

`wholesale3_party_state.sql`. Until it is run, the State box on the customer
form answers `503 PARTY_STATE_NOT_SET_UP` when a state is actually typed, and
everything else about a customer saves exactly as before. Bills go on being
decided by the GST number and then the city, which is what they did
yesterday.

The Route migration changed nothing on its own, by design. Without an
activated linked account no transfer is attached and a payment is taken
exactly as it was before. What it opens is the Taking card payments screen at
`/seller/settings/payments`, so a wholesaler can start onboarding. Before any
money can actually reach one, three things outside the database are still
needed: Route enabled on the Razorpay account, `RAZORPAY_WEBHOOK_SECRET` set
or the webhook endpoint refuses every delivery, and Partner access if linked
accounts are to be created by API rather than by hand in their dashboard.

Restart the server after running any of them. The schema probes are cached per
process, so a running server goes on believing a table is absent, which is what
caught the sale numbering out on 12 Sept. Until it is run every purchase and supplier
route answers `503 PURCHASES_NOT_SET_UP` and the four screens say "the
purchase book is not switched on yet". Nothing else in the product is
affected, and no existing screen changes. Verified against a database without
the tables: all eleven routes degrade, none returns a 500.

Restart the server after running it. The schema probe is cached per process,
so a running server goes on believing the tables are absent, which is what
caught the sale numbering out on 12 Sept.

After running it, make the first admin by hand. There is no way to do it from
inside the product, by design:

```sql
UPDATE users SET is_platform_admin = TRUE WHERE email = 'you@example.com';
```

Nothing added on 11 Sept needs one: the credit feature moves existing rows and
adds no columns, and removing the "Partial" payment status is code only, since
`invoices.payment_status` carries no CHECK constraint.

To confirm the earlier three landed, since two of them use
IF NOT EXISTS and one can be refused by existing data without stopping the run:

```sql
SELECT
  (SELECT count(*) FROM pg_class
     WHERE relname = 'order_number_seq' AND relkind = 'S')          AS order_seq,
  (SELECT count(*) FROM pg_indexes
     WHERE indexname = 'idx_invoices_order')                        AS invoice_index,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name = 'staff_members')                            AS staff_table;
-- all three should read 1
SELECT generate_order_number();  -- ORD + today's date + six digits
```

`idx_invoices_order` is the one that can be missing while the others are fine:
it refuses to build if an order already holds two invoices. If it reads 0, the
query at the top of that migration lists the offenders. Sorting them out is a
judgement call, because a duplicate carrying payments needs those payments moved
onto the surviving invoice first, so do not delete on the strength of the query
alone. The application takes a lock before creating either way, so new
duplicates cannot appear whether or not the index exists.

Backfills, safe to run more than once, in this order:

One more, for the customer names already stored wrong. Dry run by default,
and safe to run more than once:

```bash
node scripts/repair_invoice_names.js            # show what would change
node scripts/repair_invoice_names.js --apply    # fill blanks, re-address
```

Documents issued before 12 Sept keep their old numbers, INV-000001 and S-0001
and DC-0001, because a document that has gone out is not renumbered on its own.
To bring a wholesaler's history across, after running the series migration:

```bash
node scripts/renumber_series.js "$DATABASE_URL" seller@example.com                  # dry run
node scripts/renumber_series.js "$DATABASE_URL" seller@example.com --write
node scripts/renumber_series.js "$DATABASE_URL" seller@example.com --write --skip-invoices
```

Scoped to one wholesaler, one transaction, dry run by default, and it refuses
to run at all until the series migration is in, because renumbering history
into a shape the live code will not continue leaves a worse mess than it found.

**Renumbering a tax invoice is not a neutral act.** Its number is what the
customer's books reference and what his input tax credit is claimed against.
For test data this is fine and it is what the script was written for; against
real trading history use `--skip-invoices`.

Part 3 of it only REPORTS orders holding two invoices. Do not merge those with
a script: payments can be split across the two numbers, and which one stands is
a judgement call.

```bash
node scripts/backfill_order_parties.js    # every order gets a customer
node scripts/backfill_order_payments.js   # shop payments into the khata   (done)
node scripts/backfill_order_sales.js      # accepted orders into the book  (done)
```

---

## Done

### 14 Sept 2026, signing in on a second phone

Reported: signed in on one device, then on another phone it said "Signed in
successfully" and nothing happened, and a reload was still signed out.

Nothing was blocking the second device. Auth is a stateless JWT with no
session table and no revocation, the middleware only verifies the signature,
and sockets use a room per user which holds many connections. There is no
code anywhere that could refuse a second sign in.

**The token was being deleted a moment after it was granted.** `fetchUser` in
AuthContext caught EVERY failure of `GET /api/auth/me` and called `logout()`,
which does `localStorage.removeItem("token")`. It did not rethrow. So
`login()` resolved as though it had worked, Login.jsx line 115 announced
"Signed in successfully", navigation ran, and the token was already gone. The
reload afterwards found nothing.

Any failure did it: a 500, or a timeout, and axios gives up after 10 seconds.
Which is why it showed up on the second phone and not the first. The phone
was on mobile data; the laptop was not.

There was a second fault making it likelier and intermittent. `login()`
awaited `fetchUser()` AND set the token, which fired the `[token]` effect,
which called `fetchUser()` again. Two concurrent lookups, and either one
failing wiped the token the other had just validated.

Fixed:
- only a **401** logs anybody out. That is the one answer that means the
  token is genuinely no good. A network failure or a 5xx keeps the token, so
  a reload picks straight back up, and sets an `unreachable` flag so a screen
  can say "could not reach the server" instead of pretending to be signed out
- one lookup, not two, claimed through a ref
- `login()` now throws when the account could not be loaded, so the sign in
  screen cannot announce success for a session that did not start. Login.jsx
  tells that apart from a wrong password, because sending somebody off to
  reset a password that was never wrong is its own waste of an evening

Verified in a browser against a mock that fails `/api/auth/me` on demand.
With the fix: a 500 keeps the token, shows an honest error, no false success,
and survives a reload; the happy path signs in and navigates; a real 401
clears the token and stays on the sign in screen. The before-state was read
off the code rather than demonstrated, because the throwaway mock would not
rebind its port to switch modes.

### 14 Sept 2026, Razorpay Route and the KYC plumbing

Asked whether we could KYC everyone who joins and then have Razorpay handle
everything, ordering and the purchase page alike. Half of that is exactly
right and is now built. The other half cannot work, for a reason worth
writing down.

**KYC is not ours to build, and that is the point.** What is buildable is the
plumbing: collect what Razorpay asks for, submit it, store the account id,
reflect the status, gate on it. The verification itself, that a PAN is real
and a bank account belongs to that business, is Razorpay's and their banking
partner's. A marketplace that self-certified its own sellers is how buyers'
money goes missing.

**Why it does not reach the purchase page.** KYC of a wholesaler lets him
RECEIVE money. The purchase page is him paying out, which is the opposite
direction and a different Razorpay product. But the real blocker is not KYC,
it is that there is nobody to KYC: a supplier is a private row in one
wholesaler's book, with no login, no account and no consent. He never joins,
so "KYC everyone who joins" never reaches him.

And if he DID join, the right flow is not the purchase book at all: the
wholesaler would place an order with him, which Route already covers. The
purchase book exists precisely for the mills that will never sign up, and
those keep the UPI intent built earlier today.

**BUILT.** `wholesale3_razorpay_route.sql` adds `razorpay_account_id` and a
`razorpay_kyc_status` to `wholesaler_profiles`, plus `razorpay_transfers` and
`razorpay_webhook_events`. A Taking card payments screen at
`/seller/settings/payments` collects the business details, PAN, registered
address and settlement bank account, creates the linked account, adds the
stakeholder, requests the route product and submits the bank account.

The status is stored rather than inferred, because a linked account exists
long before it can be paid into. `mapAccountStatus` reads any state it does
not recognise as `under_review`, never `activated`: a new state name
appearing in Razorpay's API must not be read as permission to move money.

**The webhook, which Route makes mandatory rather than optional.** Settlement
used to depend entirely on the buyer's browser posting back to `/verify`.
That was survivable while every rupee sat in one account a person could
reconcile; with Route the money has already moved to the wholesaler while the
order still says unpaid. `POST /api/webhooks/razorpay` verifies
`X-Razorpay-Signature` over the RAW body, which is why it is mounted in
app.js ahead of `express.json`: re-serialising a parsed object changes key
order and spacing, so parsing first would make every genuine webhook look
forged. Deliveries are recorded before they are acted on and the unique index
on `event_id` makes Razorpay's retries harmless.

**A design I got wrong and corrected.** The first cut refused checkout
outright for any wholesaler not activated, reasoning that money the platform
cannot forward should not be taken. That broke thirteen checks in
`razorpay_check`, and the failure was right: running a migration is not
allowed to break every existing seller. It was also solving a problem it had
invented. The danger is a transfer to an UNACTIVATED account, which Razorpay
holds with nobody able to release it; simply not attaching one leaves the
payment exactly as good as it was yesterday. So the rule is narrow: never
attach a transfer to an account that cannot receive it.

**Commission defaults to zero**, in `master_settings.platform_commission_percent`.
A plausible five per cent defaulted in would be money taken from wholesalers
that nobody agreed to. The stray paisa on a split is rounded DOWN, so the
platform absorbs it and a transfer can never exceed what was captured.

`scripts/route_check.js`, 27 checks. Razorpay is stubbed at the transport, so
this proves we call it correctly and act on the answer correctly, not that
their API behaves as documented. **The first live call is still the real
test**, exactly as with `createOrder`.

Caught by running it: `$2` used both as a column value and inside a `CASE`
comparison left Postgres unable to infer the parameter type, and every status
write failed with "text versus character varying". Cast explicitly.

**Still not done, and needed before real money:** Route requires your Razorpay
account to have it enabled, and creating linked accounts by API needs Partner
access; without that they are created by hand in the dashboard and only the
id is stored here. `RAZORPAY_WEBHOOK_SECRET` must be set or the webhook
endpoint refuses everything, deliberately, since an unverifiable endpoint
that moves money must not be an open one.

### 14 Sept 2026, invented data, the customer's state, and the invoice format

Four things asked for together, plus two found on the way.

**The last of the invented data is gone.** Two survivors of the `trust_score`
and `response_rate` cull:

*The demo catalogue.* When `/api/products` failed, the marketplace home page
put two made up products on screen, ABC Textiles in Mumbai and XYZ Garments
in Delhi, with prices, MOQs, verified ticks and phone numbers, behind a toast
saying "Using demo data". They were clickable, so a buyer could try to order
from a wholesaler who does not exist, and a wholesaler looking at his own
marketplace saw competitors who were never there. Now it shows nothing and
says the catalogue could not be loaded. That needed a new `loadFailed` state:
the existing empty state says "No products match your filters", which is a
lie when the fetch failed and the buyer has set no filters.

*The 4.5 stars.* `SearchResults.jsx` read `Number(supplier.rating || 4.5)`.
The catalogue endpoint it reads, `getPublicCatalog`, does not select a rating
at all, so this was not a rare fallback: **every product and every wholesaler
on the search page showed exactly 4.5**, the sort and the "min rating" filter
ordered and hid results by a constant, and anything at 4.8 or over got a "Top
Pick" badge, which nothing ever was. Ratings, the sort option, the filter and
the badge are all removed.

Real ratings were left alone. `seller_reviews` is genuine, `getProductById`
and `getWholesalerById` average it and honestly return 0, and the product and
wholesaler pages show it. If search is to rank on that, the average has to be
joined into `getPublicCatalog` first, and that is a real change, not a
fallback.

**The customer's state now reaches the tax.** `placeOfSupply` asks three
things in order: the declared state, the state the GST number carries, then
the city. The buyer's side never answered the first one. `parties` had no
state column at all, and every caller passed `{ gstin, city }`: the strongest
source was missing from half of every bill.

Wrong for one man in particular: a customer in another state with no GST
registration, in a town outside the ninety in `STATE_BY_CITY`. He resolved to
null, null reads as the same state, and his bill charged CGST plus SGST when
it owed IGST. There was no way to correct it because nothing asked.

- `wholesale3_party_state.sql` adds `parties.state`, nullable, no default
- a State dropdown on the customer form, defaulting to "Same state as you"
- a state nobody recognises is refused rather than stored as typed, because a
  misspelling resolves to null later and quietly bills as local
- guarded on the probe, and the guard is asymmetric on purpose: **typing** a
  state before the migration is a loud 503, leaving it **empty** changes
  nothing. The edit form sends every field including the empty ones, so
  refusing those would have made every customer uneditable on an unmigrated
  database, to protect a value that is not there

The marketplace side had the same bug for free: `bwp.warehouse_state` was
selected for the supplier and not for the buyer, out of the same table, on
the same query. Three call sites fixed.

`scripts/party_state_check.js` covers it, 19 checks, including the
pre-migration half in a child process because the schema probe caches per
process. Verified: Raipur customer, no GSTIN, Gujarat seller, now IGST 50.00
where it was CGST 25 plus SGST 25.

**The invoice formats money like the rest of the site.** Asked directly:
"why does the new invoice still have 1500.00 instead of 1,500". Because
`InvoiceDetails.jsx` was missed when the eighteen local `money()` copies were
collapsed. Every figure on it went through `Number(x).toFixed(2)` with a hard
coded symbol. So did the totals on `CreateInvoice.jsx`. Both now use the
shared formatter at document precision. Dates on the invoice screens went the
same way, `toLocaleDateString("en-IN")` to `dateLabel`.

**Two found on the way, unrelated to the ask.**

*The seller could not download his own bill.* Asked why an order paid in full
offered no invoice anywhere. The buyer has had a Download Invoice button on
his order page all along; the wholesaler who raised the bill had none, and
had to go and find it in the invoice list. The endpoint already allowed
either side of the order. It was a missing button.

*The mobile filter drawer never existed.* The Filters button on the search
page called `setIsFilterDrawerOpen`, which was never declared, so tapping it
threw a ReferenceError, and the sidebar it was meant to open is hidden below
`sm` anyway. Phones had no filters at all. The controls are now defined once
and shown in both the sidebar and a real drawer.

**The payment page layout on a laptop.** The two column grid held a single
child, so Order Details, Delivery Address and the buttons stacked into column
one and the right half sat empty. It only broke when the QR code moved out of
column two.

### 13 Sept 2026, from the Busy screenshots

Nine screenshots of Busy 21 sent over. Gone through line by line. What follows
is the triage, and the one item that was built today.

**BUILT: opening balances.** Busy's Account master carries `Op. Bal` with a
Dr/Cr flag. We had nothing, and it is the single thing that stopped a real
wholesaler moving onto this product: his customer book opened at zero on day
one, so the only number he cares about was wrong. His choices were entering a
fake sale for the old balance, which puts goods in his books he never sold and
tax on a bill he never raised, or not using it.

Stored SIGNED rather than with a Dr/Cr flag. Busy needs the flag because the
same field serves both sides of a double entry ledger; here positive means he
owed you and negative means you were holding his money, and one column cannot
disagree with itself the way a number and a flag can. The DATE is required
whenever the figure is not zero: "he owes 2 lakh" is not a fact until you say
as at when, and without it the opening figure and everything after it count the
same goods twice.

It goes through `khataBalance` and `supplierBalance`, so it reaches the
customer page, the customer list, the overview and the purchase totals from ONE
rule. Every caller had to be threaded with the probe, because a balance that
includes the opening figure on one screen and not another is exactly the
disagreement that file exists to prevent.

**The triage, for what is left.**

Worth taking, roughly in order:

| From Busy | Why it matters here |
|---|---|
| Unit Conversion | 1 bale = 20 than. Real the day somebody buys in bales and sells in metres |
| Bill Sundry | Freight, packing, insurance as lines on a bill. Ordinary in wholesale and we cannot express it |
| Type of Dealer (Regular / Composition) | A composition dealer may not charge GST and must print so on the bill. We assume everyone is Regular |
| HSN summary on the invoice | Required on a GST invoice above the turnover threshold. We do not print one |
| Original / Duplicate / Triplicate | Rule 46 wants the copy marked. Ours prints one unmarked copy |
| Invoice logo | Busy has it under Configure Sales Invoice. Commonly asked for |
| Discount Structure | Named discount schemes, real in wholesale |
| Item Group / Account Group | We have a free text `category` on items and nothing on parties |
| Std. Narration | Canned notes. Small and genuinely saves typing |
| Country master | Trivial, and the State master already sits beside it |

Deliberately NOT taking, and why:

- **Account Group, Journal, Contra, Dr/Cr Note without items.** Busy is a full
  double entry accounting package with a chart of accounts. This is a khata.
  Building those means building an accounting system nobody asked for.
- **Bill of Material, Production, Unassemble.** Manufacturing. Not this trade.
- **Physical Stock, Stock Journal, Material Issued to Party.** Stock movement,
  which cannot start before sales and purchases BOTH move stock, and today
  neither does. See the purchase note above for why one side alone is worse
  than neither.
- **E-Way Bill and E-Invoice.** Both real obligations above a threshold, both
  needing a government API integration and credentials. A phase of their own,
  not a master screen.
- **GSTIN online validation.** Busy's own note says it needs an active paid
  subscription, because it is a paid GSP API. Same shape as the above.

**One thing the screenshots answered that was already written up as a
limitation.** Busy's Regional Settings has "Currency Font: Rupee Foradian"
beside "Currency Character". That is exactly how it prints a rupee glyph in a
PDF, and it is the answer to the note in `pdfService`: embed a font that has
the character. It stays deliberately unfixed for now, because carrying a TTF in
the repository and trusting it to be on whatever host this runs on is a real
cost for a symbol that "Rs." already says perfectly well to these traders. The
option is now written down rather than unknown.

### 13 Sept 2026, later

**The double counted payment race is fixed.** An order backed invoice has two
writers: `reconcileInvoiceForOrder`, which mirrors what the order has received
and runs in the BACKGROUND off every payment event, and a wholesaler recording
the same money by hand. Reconcile was idempotent in one direction only. It
refuses to add when enough is already on the bill, but when it got there FIRST
the hand entry landed afterwards and nothing ever looked again. 510 on a 1,020
order showed as 1,020 received and the bill read fully paid with half owed.

The fix is a CEILING both writers obey, in `invoiceRepository.addPayment`,
which is the only place a payment row is written. For an order backed invoice
the ceiling is what the ORDER says has been received, because the order is the
authority over money that came in through the shop. That is the same rule the
sale side already states as FOLLOWS_ORDER. It is taken under the advisory lock
reconcile was already using, so whichever writer arrives second sees the first.

`recordPayment` now decides Paid or Pending from what the bill ACTUALLY holds,
read back inside the transaction, rather than from a total fetched before the
lock plus the figure asked for. A clamped payment could otherwise have stamped
a bill settled that was not.

A bill with no order behind it is untouched: there is no second writer, so a
hand entry is the only truth there is.

Driven deterministically rather than left to timing: the suite now forces the
losing order, reconciling first and hand entering after, which is the sequence
that used to fail about one run in three under load and never on an idle
machine.

**Money reads the same everywhere now, invoice included.** Collapsing the
eighteen screen helpers was only most of the job. Three places were still
formatting their own way:

- The INVOICE PDF printed `Rs.1250000.00` with no separators at all, while
  every screen showed 12,50,000. `pdfService` now reads the platform grouping
  and document decimals, primed once per document because `rupees()` is called
  from twenty one places inside synchronous drawing code where an await cannot
  go. The rupee SYMBOL is still deliberately not read there: PDFKit's built in
  Helvetica has no such glyph and silently draws a superscript one, so that
  file prints "Rs." and is the one place that cannot honour the setting.
- `InvoicePreview`, the invoice on screen, used raw `toFixed(2)` throughout, so
  it showed `₹12000.00` ungrouped. That was the original complaint on 11 Sept
  and it was still true on the invoice itself.
- `PaymentHistory`, `CartDrawer`, `SupplierCard` and `RefuseOrderModal`.

Checked end to end: the invoice screen and the PDF now print the same digits,
`₹12,50,000.50` against `Rs.12,50,000.50`, while a list screen shows
`₹12,50,001` because screen and document decimals are deliberately separate.

**The master sidebar no longer scrolls away.** The layout was `min-h-screen`,
so the whole page grew and took the sidebar with it. It is `h-dvh` with the
overflow hidden now, exactly as the seller shell does it, and only the content
pane scrolls. Verified: content scrolled 748px, sidebar stayed at the top,
window scroll never moved.

### 13 Sept 2026

**Razorpay's own checkout window, in place of ours.** The local imitation built
yesterday is deleted. Card numbers and UPI PINs belong inside an iframe served
by the people certified to collect them; a copy of that screen in our markup
gets the appearance right and the security exactly backwards, and its fields
would have had to become real eventually.

`createOrder` now makes the real Basic auth POST to `api.razorpay.com/v1/orders`
once keys exist, because their window will not open without an order id from
it. NOT exercised against the real host, which needs an account: it is written
to the documented contract and `razorpay_live_check.js` stubs the transport and
asserts the method, URL, auth header, paise amount, receipt and notes, plus
what happens when Razorpay refuses. Treat the first live call as the real test.

Without keys there is no button, only a line saying online payment is not
configured and to use the QR code. Their script authenticates the key id
against their servers, so a made up one cannot open anything, and a button that
always fails is worse than one that explains itself. Test keys are free.

**Razorpay is now the primary way to pay** and is drawn like it: a bordered
card marked Recommended with a full width 56px button, against the UPI QR which
is collapsed into a one line summary underneath with a secondary outline
button. It was the other way round. The reason is in the known problems below
and is deliberately NOT on the screen: a buyer cannot act on it, and telling
him his QR payment is unverified would only make him doubt money he has sent.

**The master area is finished.** `/master/settings` holds the platform's
formatting conventions: screen and document decimals kept apart, Indian against
western digit grouping, currency symbol and the words for the amount in words,
tax rate decimals kept apart from money decimals because 0.25% is a real GST
slab, the default minimum HSN digits a new wholesaler starts from, and the date
format. Rule 46(b) is shown read only, because it is law rather than a setting.

The sample at the top redraws as you type, using the product's own formatter
rather than a copy: if those two could disagree, the preview would be the thing
lying about what saving does. Verified by switching each control and watching
₹12,50,000 become ₹1,250,000 and 9 Sept 2026 become 2026-09-09.

**The eighteen money() copies are collapsed.** This is what the settings screen
was waiting for, and the reason it was not built on 12 Sept: a formatting
setting that half the product ignores is worse than none. They now import from
`utils/money`, aliased so not one call site changed: a screen that wanted two
decimals imports `amount as money`. `dateLabel` went the same way.

The formatter reads the platform settings through a module level value pushed
in by `useMasters`, not a hook, because `money()` is called from `useMemo`,
from sort comparators and from plain helpers where a hook cannot go. First
paint after a cold load uses the shipped defaults, which is harmless: those ARE
the old convention, so the worst case is a figure briefly correct in the old
way rather than briefly wrong.

**Verified:** 917 checks across 29 suites. 21 new on the live order contract,
27 on the settings, and 20 driven in a browser against a stand in for
`window.Razorpay` covering success, a decline, a dismissed window, no keys, and
a script that will not load. The decline and dismiss cases matter: a decline
must never reach verify, and a dismissed window must not leave the button
spinning.

### 12 Sept 2026

**Razorpay, scaffolded.** Asked for as "absolutely no need to make it working,
just setup fake", then completed "with modal and all, in testing only". Three
endpoints under `/api/orders/:orderId/razorpay/`, a full checkout window, and
no gateway behind any of it.

`RazorpayCheckoutModal` imitates the real window: merchant, amount, gateway
order id, the four methods, a form per method, and a declined path because a
checkout that can only succeed teaches nobody what the screen behind it does
when it does not. Nothing typed into it is read, validated or posted, and the
file is written to be DELETED rather than extended when the real gateway goes
in, since Razorpay collects card details inside its own iframe precisely so
they never touch our code. The test banner is not dismissible: a convincing
fake payment screen is the one thing here that could mislead somebody into
thinking money had moved.

**The one decision worth knowing:** the stub signs its fake payments with REAL
HMAC-SHA256, over the same string Razorpay signs, and `verifySignature` is the
same function in both modes. Returning `true` in stub mode would have been less
code and is how a fake gateway becomes a live hole: somebody sets a key one
afternoon, the branch is the wrong way round, and the verify endpoint accepts a
payment id posted by anyone holding the order number. Money is the one place
where the untested path must not be the one that says yes. Going live changes
the keys and the order-creation call, and changes nothing about what is trusted.

Stub mode is the ABSENCE of a secret, not a flag: a flag and a credential can
disagree, and the failure when they do is the expensive one. The `simulate`
endpoint, which mints valid signatures, 404s the moment a real secret exists.

Nothing in the Razorpay code settles money. Once a signature checks out it
hands to `orderController.updatePaymentStatus`, which is the one place that
knows what is owed, caps at it, mirrors into the khata, reconciles the invoice
and moves the order. A second settlement path would be a second copy of those
rules.

**Found while building it:** order creation leaves its own pending
`payment_transactions` row, for the whole subtotal, which `initiatePayment`
later supersedes with the correct instalment. Opening a gateway order against
that placeholder would have asked a buyer on the 50/50 plan for the full amount
instead of his first half. The session is now matched on `buyer_id`, which only
`initiatePayment` fills. Not on `payment_type`, which looks like the obvious
choice and is not: a legacy BEFORE INSERT trigger on that table copies
`payment_method` into `payment_type`, so the placeholder comes out with a type
nobody set.

**Still needed before it is real**, all listed in `razorpayService.js`: the
Basic-auth POST to `api.razorpay.com/v1/orders`, which is refused loudly rather
than faked; a webhook at `/api/webhooks/razorpay` verifying
`X-Razorpay-Signature` over the raw body, because the browser handler never
arrives if the buyer's browser dies after paying; and Razorpay Route with
linked accounts, since every rupee here would land in ONE account and this is a
marketplace where the money belongs to whichever wholesaler was bought from.
That last one is the real work behind "the UPI needs to be of each wholesaler
we are buying from".

**Verified:** 29 checks in `razorpay_check.js`, weighted towards what it
refuses: a forged signature, a signature that is genuinely valid for a pair the
attacker chose (which catches trusting the order id in the request body), an
empty payload, another buyer driving someone else's payment, an amount in the
request body, and replaying a handler payload to pay twice. 890 checks across
27 suites all green.

**The purchase book,** the other half of the trader's day. Goods coming in,
who they came from, what is owed for them, and what tax on them can be
claimed back. Five screens under `/seller/purchases` and `/seller/suppliers`,
and the deliberate mirror of the sales spine rather than a new idea:

| Sales | Purchases |
|---|---|
| `parties` | `suppliers` |
| `sales` | `purchases` |
| `sale_lines` | `purchase_lines` |
| `party_payments` | `supplier_payments` (money out) |
| `sale_sequences` | `purchase_sequences` |
| `khataBalance.js` | `supplierBalance.js` |

**Suppliers are a separate table, not a `kind` column on parties.** That was
the first idea and it is the wrong one. A party row means "he owes me", and
that meaning is baked into seventeen queries across five files: the customer
list, the overview totals, the statement, the credit service, `khataBalance`.
Every one would need a new filter, and the first one missed puts a supplier in
the customer list with his balance pointing the wrong way. The cost is that a
firm a wholesaler both buys from and sells to is two rows, which is the same
trade `parties` already made, and it fails in the safe direction.

**Three things a purchase has that a sale does not:**

- **The supplier's own bill number and its date**, because that is what GSTR-2B
  matches on and it cannot be reconstructed later. Unique per supplier per
  wholesaler, so the same bill cannot be entered twice. That is not tidiness:
  entering a purchase bill twice claims its input tax credit twice, and both
  rows look correct on their own afterwards.
- **`itc_eligible` per line.** Section 17(5) blocks credit on a list of things
  a trader genuinely buys, and one supplier bill can carry both kinds. The
  purchase page reports claimable credit separately from the bill's own GST,
  and says so when they differ.
- **No invoice.** The bill is the supplier's document, not ours.

**Nothing touches stock, on purpose.** The obvious next thought is that a
purchase should raise stock. It must not yet, because a sale does not lower
it: `sale_lines` stores an item name as text and touches no inventory row.
Wiring one side only gives a figure that climbs forever and is wrong from the
first purchase onward, which is worse than the honest nothing there is today.

**Known limit, stated rather than hidden.** The bill total is computed through
`gstService`, the same function the sale and the invoice use, so there is one
arithmetic. But the authority on a purchase is the paper the supplier handed
over, and his software may round a line differently, so a computed total can
land a rupee from the printed one. That gap matters when it is claimed and
matched against GSTR-2B. The form tells the wholesaler to check against the
printed figure and that the printed one is the one that counts. Letting him
state the tax off the bill is the correct next step.

**The permission is new and fails closed.** `purchases` is its own key, kept
apart from `sales` because a man trusted to write sales is not automatically
trusted to see what stock costs, and apart from `payments` because that is the
right to take money IN. An employee taken on before this existed has a stored
list that does not contain it, so the owner has to tick it. That is the
direction `staffAccess` already chose deliberately.

**Two bugs fixed while sweeping, both found by running the code:**

- **A bill reversed by a credit note still counted as money to collect.**
  `getDashboardStats` excluded cancelled invoices and not credited ones.
  Cancelling and crediting are different instruments, and a credit note
  deliberately leaves the invoice `Generated` and `Pending`, because under GST
  the document stands and is reversed by another document. So a fully credited
  bill went on counting towards "still to come in", towards revenue, and
  towards the unpaid count. The list beside the card already showed the row as
  "Credited": the card and the row underneath it disagreed, and the wholesaler
  was shown money to chase that he had already credited back. Reproduced with
  four bills, fixed, and locked down by four new checks in
  `invoice_payment_check.js`. This is the same shape as the complaint on
  11 Sept about bills reading unpaid when they were paid.
- **The two purchase detail screens said "not found" when the migration had
  not been run.** The server answers `503 PURCHASES_NOT_SET_UP`; the list
  screens read it, the detail screens read anything-but-404 as a generic
  failure and fell through to "Purchase not found". Telling a wholesaler his
  bill does not exist when the truth is the feature is not installed is the
  wrong answer to give about his records. Found by rendering the screens
  against a mock in that state.

**`client/src/utils/money.js`,** the destination the eighteen local `money()`
helpers collapse into. Not a nineteenth copy: the purchase screens use it from
the day they are written so the new work does not add to the pile, and the
existing screens move onto it one at a time. That ordering is what unblocks
`/master/settings`, which cannot control decimals and grouping while eighteen
components each format their own.

**Verified:** 861 checks across 26 suites, every database carrying every
migration. A new `purchase_check.js` drives 55 of them through the real
controllers: scoping on every id, the duplicate supplier bill, paying more
than a bill owes, editing a total below what has been paid, cancelling
releasing payments onto the account rather than deleting them, the totals not
netting across suppliers, blocked input credit, and eight concurrent
purchases taking eight distinct numbers. The five screens rendered at 1280px
and 400px, plus the not-set-up and empty states, with no sideways scroll and
no `NaN` or `undefined` on any of them.

**The platform master dashboard,** at `/master`, its own area with its own
layout and its own guard. States, units, tax rates and HSN codes, all
editable, plus an overview that says what is there.

A separate area rather than a page inside the seller workspace, for three
reasons pointing the same way: `/seller/*` is guarded by role seller|both, so
a Master screen inside it would be unreachable to a platform admin who does
not also sell; CLAUDE.md already says the seller dashboard is for wholesalers;
and they are different jobs. An admin who is also a wholesaler gets a
"Platform master" link in his sidebar footer and his account label reads
"Admin account" rather than "Wholesaler account". That label is presentation
only, the role stays what it is.

**Deactivate, never delete.** Every list carries `active`, switching a row off
stops it being offered, and the row stays because a document already issued
may name it. The screen says so where a person can see it. The last active row
in a list cannot be switched off, and the attempt is put back rather than left
half done.

**What is deliberately NOT in master:** a wholesaler's invoice prefix, his due
days, his default tax rate, his terms. Those are his and they stay on his own
Invoice defaults screen; if they lived in master, one wholesaler changing his
prefix would change everybody's. The overview screen says this outright,
because somebody looking for "invoice settings" will look there first.

Writes sit behind `requirePlatformAdmin`, which reads the flag from the
database on the request. The client guard only decides whether to draw the
screens; anyone past it finds every button returning 403. Editing a curated
HSN row leaves it marked curated rather than quietly relabelling it as the
admin's own.

**A white screen on the Overview, found while rendering this.** For an
employee without the money permission `overviewController` sends `money: null`
rather than zeros, deliberately, so the screen can say "not shown to you"
instead of claiming the business is owed nothing. The server had done its half
since the permission was built and the screen never did its own, so that
employee got a blank page on the first screen he lands on. It now says the
figures are withheld and shows him the rest of the page.


**All three documents are numbered the same way now.** They were three shapes
with three padding widths and no year on any of them:

    invoice   INV-000001   restarted yearly
    sale      S-0001       never restarted
    challan   DC-0001      never restarted

They read `INV/1/26-27`, `S/1/26-27` and `DC/1/26-27`, all restarting each
1 April. `wholesale3_series_financial_year.sql` adds the financial year to the
two counters that lacked it and makes it part of their key, carrying existing
counters into the CURRENT year rather than resetting, so nobody's next sale
collides with one he issued last week. Numbers already printed on a document
are left exactly as they are.

Only the invoice series is a legal requirement; a sale is the wholesaler's own
record and a challan under this product's rule is explicitly not a tax
document. The reason for the other two is legibility.

**And a third copy of the sale numbering, found by breaking it.** There were
two `nextSaleNumber` functions, one in saleController for a sale typed by hand
and one in orderSaleService for a sale written when an order is accepted.
Changing the shape in one and not the other is exactly what happened: sales
from the sales book took the new number and sales from an accepted order
crashed on an ON CONFLICT that no longer matched. Both, and the challan
counter, now come from `services/seriesNumbers.js`.


**The invoice number carries its financial year now.** A new wholesaler's
default shape is `INV/1/26-27` rather than `INV-000001`: six leading zeros and
no hint of which year it belonged to. Busy's own sample is `OM/1/26-27` and
our compose() reproduces it exactly.

The `{FY}` placeholder is substituted when the number is taken, so it follows
the year forward on its own. A suffix typed as the literal "26-27" would still
say 26-27 next April, which is a wrong year on a legal document, and the field
hint says so.

Padding drops to 0 by default because the year already makes it read as a
series. `INV/1/26-27` is eleven characters with room for six digits inside
Rule 46(b)'s sixteen; `INV/000001/26-27` is sixteen exactly, with no room at
all. A wholesaler who has already saved a format keeps it; this only decides
what somebody who has never opened the screen gets.

**Two dead paths found while doing it.** `invoice_settings` has carried
`number_suffix` and `number_pad_to` since 10 Sept, and the repository has
always written them, but the save route dropped both from the request and the
save mapping dropped both from the reply. So the columns were unreachable from
either direction and every wholesaler was stuck on the default whatever he
set. Both are wired now.

**A live sample, which Busy has and we did not.** `compose()` and `roomFor()`
were written on 10 Sept, exported, and never called by anything.
`GET /api/invoices/number-preview` now serves them and the settings screen
shows the sample as he types, with the financial year and how far the shape
can run. Asked of the server rather than worked out in the client, so the
sixteen character rule is checked by the same function that enforces it: a
second copy in the client is how a screen ends up promising a number the
server then refuses. An illegal shape is also refused at save time, tested
against the widest sequence it will ever reach rather than against number 1.


**Platform masters, and the super admin who owns them.** Four lists that were
constants in code, so correcting one meant a deploy: 37 states with their GST
codes, 7 units, 7 tax slabs, 32 HSN codes. `wholesale3_platform_masters.sql`
creates and seeds them, the seed generated from the running constants rather
than typed, so the tables cannot start life disagreeing with the code still
falling back to them.

The admin is a FLAG, `users.is_platform_admin`, not a fourth role. `users.role`
carries a CHECK allowing only buyer, seller and both, and an admin is not a
fourth kind of trader. It is read from the database on every admin request
rather than carried in the token, because a revoked admin has to lose his
powers at once and not whenever his session happens to expire.

That makes flash sales reachable for the first time. `promotionController` had
three checks against role `'admin'`, a value the constraint can never hold, so
the feature was unreachable rather than merely unbuilt. The dead checks are
gone and the routes use `requirePlatformAdmin`.

Every master read falls back to the constant it replaced, and an EMPTIED table
falls back too, because an empty list is a mistake rather than an instruction
and serving it would empty every dropdown in the product. `master_check.js`
runs both ways, with the migration and without.

**What still reads the constant, deliberately.** `placeOfSupply` resolves a
state name to its GST code synchronously, at module load, on the path that
decides CGST plus SGST against IGST. Making that asynchronous so it could read
a table is a separate change with its own risk. So the state master feeds the
dropdowns and the admin console; adding a state there does NOT yet change how
tax is computed for it. Written down rather than discovered later.

**A settled bill read as wholly unpaid on the Invoices header.** Reported with
a screenshot: two invoices both marked PAID in the list, above a card reading
"1,35,700 still to come in, 2 unpaid", which was their exact sum.

Yesterday's fix made the three cards sums of each bill's balance, worked out
from the invoice module's `payments` table. But a bill raised from the SALE
side deliberately writes no row there: that money is already in party_payments
against the sale, and writing it twice is what once made a bill read Paid while
the customer still owed the lot. So every sale-side bill counted as fully
outstanding. Since a bill is now Paid or Pending and nothing between, the stamp
answers it outright, and the payment rows are consulted only for one that is
not settled.


**"Partial" is gone from invoices.** Decided today, closing the conflict this
file had carried since the 10th. A bill exists only once the money is all in,
so it can never honestly be half paid: `payment_status` is Pending or Paid and
nothing between. What HAS come in is still carried by the payment rows, which
is where the Invoices header reads it from, so nothing is lost and only the
status word stopped describing a state that is not supposed to exist. The list
filter for "Not paid" also matches legacy `Partial` rows, or a bill with money
owing would drop out of the list meant to chase it.

**One rule for what has come in against a sale,** in `services/saleSettlement.js`.
Three places each kept their own copy and no two agreed. Money on an
order-backed sale sits in two places, and the khata holds two KINDS of row:

  - a mirror of the shop payment, written with `order_id` and
    `payment_transaction_id` set, so the customer's balance is right
  - money the wholesaler took himself and typed in, with a `sale_id` and
    neither of those

Adding them counts the shop payment twice, which is why the rule had been
GREATEST. But GREATEST has the opposite fault and it is worse: a wholesaler
who takes the second instalment in cash and records it adds a row that never
exceeds `orders.amount_paid` on its own, so it is swallowed whole. The sale
never settles, the bill is never raised, and the customer's page says he is
square while the sale page says he still owes. The same complaint made on
11 Sept, arriving by the other road. The rule is now `orders.amount_paid` plus
only the khata rows carrying no `order_id`.

**A returned order could be left with a tax invoice and nothing reversing it.**
`unwindReturnedOrder` looked only at `invoices.order_id` and missed two cases:

  - a bill raised from the SALE, which is what a cash settled order-backed
    sale produces: it carries a `sale_id` and no `order_id`
  - a bill that had not landed yet, because both billing paths run in the
    background, so a briskly completed return outran it

It now finds the bill by either road, and raises it first if the order is
settled but its bill has not caught up, because the sale is cancelled moments
later and both billing paths correctly refuse a cancelled sale.

This is the fault that had been showing up as `return_check` failing only when
the suites were run back to back and the database was busy. It was dismissed
as a flake on 11 Sept. It was not a flake.

### 11 Sept 2026

A day of hunting rather than building. Two faults a wholesaler reported, seven
more of the same kind found by going looking, and one feature that turned out
to be the real answer to the second report.

**The challan reached the order side.** The button and the challan list are on
the seller's order detail screen, not only on the sale page, and the orders
list carries a challan count the way the sales list does. Both go through the
sale behind the order, so there is still one document trail. `createForOrder`
returns `noSale` for an order nobody has accepted yet, and the screen is told
`hasSale` so it can stay quiet rather than offer a button that will refuse.

**A settled sale bills itself.** `billIfSettled` runs after a payment is
recorded and after a cash sale is written, so the last rupee raises the bill
instead of it waiting for somebody to remember. The "Make invoice" button now
only appears when the sale is actually settled; it used to show on any
confirmed sale, and pressing it on an unpaid one returned a 409 and redrew the
same screen, which read as a button that did nothing.

That second caller exposed a hole in the first: `createInvoiceFromSale`
checked for an existing invoice outside its transaction, so the auto bill and
the button could both read "none yet" and both write one. Harmless while a
person was the only caller. The check is now repeated under an advisory lock
on the sale, and the loser hands back the winner's invoice.

**The status route was leaving two things behind.** Found by walking every
cell of the challan grid against the route the screens actually use rather
than the service behind it.

- Marking an order delivered did not deliver its sale. The mirror lived in
  `orderStatusService`, and the "Mark delivered" button does not go there: it
  PATCHes `/orders/:id/status`, which writes the status itself. So the order
  read delivered and the sale read confirmed for ever, which is the exact
  drift the sale's own delivered button was removed to prevent.
  `follows_order_check` passed throughout because it drives the service, which
  was the half that was right. One helper now, `markSaleDelivered`, called
  from both, and the suite checks both.
- The same route would also cancel an order, writing the word and nothing
  else: sale left standing, stock left reserved, customer still owing for
  goods that were never coming. Cancelling belongs to `POST /cancel` and
  refunding to `POST /refund`; both are refused here now with a message saying
  where to go. Nothing in the product used that path, so no visible behaviour
  changed. The route allowed it, which was enough.

**Four screens were answering one question with different sums.** The first
was reported: an order reading "all paid" whose sale read "the whole amount
still due".

- **The sale.** Money from a shop order lands on `orders.amount_paid` and
  nothing tags a `party_payments` row to the sale, so the Sales list and the
  sale page, which both added up `party_payments` alone, answered zero. Both
  now read the figure the server already computes for the challan rule, which
  takes the greater of the two rather than the sum: that is one lot of money
  written down twice, not twice in the till. The sale page also says where the
  money came in, so an empty payments list is explained instead of puzzling.
- **The Customers page header.** Total billed counted sales alone while "Still
  to collect" beside it counted shop orders too, so a wholesaler with an order
  he had not accepted read "Total billed 0" next to "Still to collect 710". It
  reads `khataBalance`'s one rule now, the same one the Overview reads.
- **The Invoices tab header, all three cards.** "Still to come in" took the
  whole `grand_total` of a part paid bill, so 710 already received still
  showed as 1,420 to come. "Received" counted only bills stamped Paid, so that
  710 appeared on neither card: money in the till, on no card. And the count
  beside the first counted Pending while its amount included Partial, so the
  card could read "1,420 - 0 unpaid". Each bill's own balance is worked out
  first now and the cards are sums of balances.
- **A race hid that last one.** Checkout raises the bill in the background, so
  a buyer who pays at once has two callers arriving together: checkout
  creating the bill from an order with nothing on it, and the reconcile
  finding no bill, creating, losing under the lock and being handed the other
  one back with the payment never recorded. The bill then sat Pending with
  nothing on it until the final instalment healed it. `reconcileInvoiceForOrder`
  asks once more after creating. Only reachable with `CHALLAN_WHEN_UNPAID=false`.

**A challan raised against an order stayed "Not billed" for ever.** The sale
side stamped its challans when it billed; the order side, which is where a
shop order's bill comes from, never did. `markInvoicedForOrder` closes it,
called from both creation and reconcile.

**Setting a customer's credit against his order.** The second report, in the
wholesaler's own words: "I was owed nothing, he paid me, and now I owe him 2
lakh."

Every figure along the way was arithmetically right:

    he returns a 2 lakh order, not refunded    you owe him 2,00,000
    he orders 4 lakh, pays half                he owes 0
    he pays the other half                     you owe him 2,00,000

The credit was never spent. The khata is one netted number per customer, so
billing him 4 lakh cancelled his 2 lakh on the display and settling that bill
uncovered it again. Underneath, he had been asked to pay the whole 4 lakh
while 2 lakh of his money sat in the till, because nothing could set a credit
against an order, although two screens offered to: the Overview says "Refund
it, or set it against their next order", and the refuse modal says the same.
Neither had ever meant anything.

`services/creditApplyService.js` implements it, as a panel on the customer's
page. It does not invent a payment: those rupees are already counted in what
he has paid, which is why he is in credit, so a fresh row would count them
twice and double the problem. It re-addresses the payments that no live goods
are standing against, pointing them at the bill the wholesaler chooses, and
splits a row where the credit is bigger than the bill. His balance does not
move, because nothing has happened between the two of them; the bill reads as
paid because it now is; and the credit is gone. The order is told too, so it
stops asking for money already handed over, with a line in its history saying
where that money came from.

The credit is measured as the loose rows rather than as the balance, because
the balance is exactly what hid it: asked at the moment it mattered, it
answered "no credit" while 2 lakh was plainly in the till.

Cancelling was considered for removal and kept. It is not the source: the case
above is a RETURN, and refunds and overpayments do the same thing.

**Two new suites, and a reset.**

- `challan_matrix_check.js`, 130 checks: every sale status against every
  settlement state, the order lifecycle walked end to end three ways, the
  feature flag both ways, the migration missing, every challan reason, and
  both screens agreeing about the same goods. It found the two status-route
  faults.
- `flow_check.js`: one order from listing to catalogue to checkout to
  acceptance to challan to delivery to bill to return to refund, checking at
  every step that the khata, the Overview, the statement, the order and the
  sale still agree. It found three of the four sum mismatches.
- `credit_check.js`, 22 checks, pinning the report above and the split case.
- `scripts/reset_books.js` for starting fresh. Scoped to one wholesaler by
  email, dry run by default, one transaction, explicit deletes in dependency
  order rather than TRUNCATE CASCADE so it cannot quietly empty a table nobody
  listed. Clears orders, sales, invoices, challans, credit notes, payments,
  customers and the numbering counters; keeps logins, profile, staff, products,
  listings and invoice settings. It does NOT put reserved stock back, because
  nothing records what the figure was before, so it prints every listing and
  says to correct them by hand. Rehearsed against a local Postgres holding two
  wholesalers: 93 rows cleared for the named one, the other untouched.

**Not finished, and worth knowing.** The browser sweep covered 19 of 22 seller
screens clean; three are still flagged (`overview`, `products`, `promotions`)
and it is not yet established whether those are real or artefacts of the
throwaway mock. The buyer side was never rendered at all, and nothing was shot
at phone width.


### 10 Sept 2026, third batch

**Renamed to KhazanaBMS.** Five screens each held their own copy of the
wordmark; they now read from one constant through a `Wordmark` component. The
browser tab said "wholesale-product". Server side too: email header, welcome
notification, and the fallback on an invoice when a wholesaler has not filled
in his own company name. The support address and the mail sender still point
at marketplace domains, because inventing an address that bounces is worse
than the inconsistency.

**The sign in buttons stopped jumping.** Pressing "Create Account" moved them
126px up the screen, out from under the cursor that had just clicked them,
because the column was vertically centred and Create Account is 252px taller.
Reserving a height would not have fixed it: the column is 436, 688, 790 and
798px in four reachable states. The top edge is anchored instead. Measured
zero movement at 900, 800 and 720.

**Promotions is hidden** behind `FEATURES.PROMOTIONS`, not deleted. The route
redirects rather than 404s. It was never usable: creating a flash sale is
admin only and there is no admin console.

**Delivery challans, to the specification given.** While a sale is unpaid or
part paid the wholesaler gets a challan and the tax invoice waits. No tax on
the challan. This is NOT what section 31(1) says, the wholesaler knows, and it
is going to a legal advisor; it is behind `CHALLAN_WHEN_UNPAID` so it can be
switched off in one word. Rule 55's three copies, provisional quantity and the
six month approval window were deferred by instruction.

One conflict came out of it and is recorded rather than hidden: this rule and
the 50/50 instalment plan cannot both be true, because an invoice that only
exists once settled can never be in the Partial state. `invoice_payment_check`
now sets the flag off and says why.

**The invoice number ring.** Both defects fixed. The counter keys on the
FINANCIAL year, so it no longer rolls over on 1 January and reuses a serial
inside one return period. The whole composed number is checked against Rule
46(b)'s 16 characters and allowed characters, where before only the prefix was
clipped. The shape follows the Busy dialog: prefix, number, suffix, optional
padding, so `OM/2/26-27` is reproducible, and `compose()` is pure so a screen
can show a live sample.

**Six Rule 46 particulars now print.** Copy title, supplier PAN (read out of
the GSTIN, not a second field), total quantity, amount in words, and the
HSN-wise tax summary needed no new data. Place of supply with its state code,
reverse charge and round off got columns. Old invoices are untouched, because
a tax document must not change after it has been handed over.

Verified: 21 suites, 515 checks, plus both smoke shapes. Both PDFs rendered
and looked at, which caught the challan disagreeing with itself: its line
column summed to the pre-tax figure while its total showed the tax inclusive
one.

### 10 Sept 2026, later

**The name on the bill did not match the name on the order.** Reported from
real use, reproduced, and it was two faults sitting on top of each other.

The Orders tab reads `wholesaler_profiles.company_name` off the buyer's
account. The invoice reads the party, and the party created at checkout was
given the delivery address name and nothing else. So the same man was "Kishan
Cloth House" on one tab and "Kishan Kumar" on the other. Checkout now passes
his firm and his GST number into the customer book, filling blanks only, so
nothing a wholesaler wrote himself is rewritten.

The GST number is the half that costs money: no order placed through the shop
has ever carried the customer's GSTIN onto the invoice snapshot, and a bill
without it is one his customer cannot claim input credit against. It only
looked right on screen because the list falls back to joining the account,
which is the fallback the snapshot columns exist to avoid.

**And there were genuinely two invoices.** Checkout raises one from the order
in the background; pressing "raise bill" on the sale raised a second, because
that path only looked for an invoice against the sale. One lot of goods, two
numbers, two rows in the tab, under two different names. Both directions are
closed now and both take the same advisory lock, which matters because the
checkout one is not awaited and loses the race about half the time.

`scripts/repair_invoice_names.js` handles rows already stored. Dry run by
default; `--apply` does the two safe parts. Duplicates are REPORTED only,
because payments may be split across the two numbers and deciding which one
stands is a person's job.

### 10 Sept 2026

**Which state the wholesaler sells from, asked once.** The field that decides
whether a bill charges CGST plus SGST or IGST was never asked for anywhere.
`wholesaler_profiles.city` defaults to `'Delhi'`, so a Surat wholesaler's first
invoice was worked out as though he sat in Delhi. Signup now asks, of anybody
who says he sells, from a list rather than a box: "Gujrat" typed by hand
matches no customer's state and would send every local sale out as
inter-state. Settings has the same list and the server refuses a value that is
not a state.

The question is now asked in one place, `services/placeOfSupply.js`. It was
asked three ways: `invoiceService` read one chain of columns, `saleInvoiceService`
read a slightly different one, and `gstService` then guessed a state by looking
the answer up in a hand written map of about fifty cities. The order is now by
what each source knows: the state he declared, then the state his GST number
carries, then his city. A GSTIN's first two digits ARE the state, which is not
a guess, and that matters most for a customer, who is usually entered with a
name and a phone and nothing else.

Unknown stays null and reads as the same state, so a walk in customer is billed
CGST plus SGST, which is what a local sale is. Same answer as before, honest
route: the old code got there by asserting both sides were in Delhi.

The map pin was already behind `FEATURES.MARKETPLACE`, so that half needed no
change.

**One switch for one delivery.** An accepted order writes a sale, so one lot of
goods was two rows and neither was in charge. The order has the 22 state
lifecycle that stamps a delivery date and opens the return window; the sale had
a plain "Mark delivered" that knew nothing about it. Press the order and the
sale sat at confirmed for ever; press the sale and the order sat at shipped
with no delivery date, so the seven day return window had nothing to count
from. The order is now the only switch and the sale mirrors it, the way
cancelling already worked.

Editing was refused on the same rows, found while writing the tests: nothing
stopped a wholesaler retyping the lines of an order backed sale and moving the
debt away from the figure the customer pressed pay on. `orderSaleService` has
said that was the one rule that matters since it was written, and nothing
enforced it.

**HSN codes, kept to what can be checked.** The shape is enforced, 4, 6 or 8
digits, on listings and on sale lines, with the message naming the line. Blank
stays allowed: most of what a small wholesaler sells was never classified, and
a gap on a bill beats a false description. The box suggests the codes he has
already put on his own goods, commonest first, read from his listings and his
sale lines, and behind those 32 common textile headings labelled Common with
a note telling him to read the description first.

No rate table, and a test asserts there is none. Rates change, the same heading
carries different rates by price slab, and a rate presented as authoritative
puts a wrong tax on a legal document.

**The retired rate list is gone.** `RateList.jsx`, `AddItemModal.jsx`,
`itemController`, `itemRoutes` and the `/api/items` mount, deleted. Two places
were still reading the dead table and both were quietly wrong: `resolveRates`
took a sale line's GST rate from `items`, so a rate changed on the product page
changed nothing it could see, and the overview counted `items` for "products",
so that number froze on the day of the merge. Both now read the listings. The
`items` table itself stays: its rows are the audit trail for the merge, and
dropping data is a separate decision.

**The invoice total is ruled, not filled.** It sat in a rounded dark pill with
white text, which is a web button dropped onto a document, and it is the first
thing a customer looks at. Rules above and below on the PDF and both screens,
plus the credit note total and the statement's closing balance, which had the
same bar.

Verified: 19 suites, 456 checks, plus both smoke shapes. Three of the suites are
new, `place_check.js`, `hsn_check.js` and `follows_order_check.js`. The PDF and
the screens were rendered and looked at rather than read.

### 5 Sept 2026

**The sign in screens fit a laptop.** They were sized for a hoarding: the panel
took 55 percent of the width with a 48px headline, and the form sat at the top
of a tall column with a third of the screen empty below it. Header, form and
small print now share one column. The panel carried an eyebrow, a three line
headline, a paragraph, three feature bullets and an early access card, plus
twelve drifting dots; it now shows one thing, a page of the book, marked as an
example.

**Staff, after real use.** An invite that was turned off could not be turned
back on, which was a trap of my own making: the row sat disabled for ever and a
second invite was the only way out. Somebody who never joined now returns to
invited with a fresh code. Removing a person is possible at all now, and safe:
history rows point at `users.id`, not at `staff_members`, so his name stays on
what he did.

**Switching dashboard tabs.** Hovering a nav item fetches its code. Measured on
the production build over a 250kbps link with 300ms latency: a cold click took
369 to 638ms, the same click after the pointer rested on it took 61ms.

**Staff accounts.** A wholesaler's people can work on his book with their own
logins. Until now every employee used the owner's, so nothing could say who did
a thing and access could not be taken back from somebody who had left.

The feature is one substitution and everything else is consequence. Two ideas
that were the same variable are now apart: the person signed in, who owns the
history entries and the notifications, and the business being acted on, whose
customers and money these are. For an owner they are the same id, which is why
`req.user.id` was doing both jobs and why getting it wrong is invisible in any
test that only has owners in it. `middlewares/businessContext` resolves it once,
chained into `authenticateToken` so a route cannot forget it.

Sixty odd call sites were gone through one at a time rather than swept.
`performedBy` on an invoice log, the name on a status history row and the
recipient of a notification are all still the person; swapping those would have
been the same bug pointing the other way.

Permissions are per employee and changeable whenever. A new employee starts
with everything, which is the rule already agreed, and the owner takes things
away. Four things are owner only and deliberately not grantable: business
settings, the GST number, the UPI id, and staff management itself.

Two decisions worth keeping. Turning somebody off is not the same as never
having employed him: resolving a disabled employee as his own owner handed a
sacked man a working, empty seller dashboard, so he is now refused outright. And
an employee without the money permission still gets the Overview, because the
lists on it are his work; the money block is withheld rather than zeroed, so the
screen can say it is not shown to him instead of telling him the business is
owed nothing.

### 4 Sept 2026

**The location picker does something.** It was ten hardcoded city names, a
piece of local state, and nothing downstream: picking Surat changed a label and
showed the same catalogue, which is worse than having no picker, because the
buyer believes he is looking at Surat. Cities now come from the listings
themselves, so every line in the menu has stock behind it and carries a seller
count. The filter removes listings rather than products, so a filtered card
cannot quote a price or a seller from another city. Warehouse city beats signup
city; spellings are folded; "Delhi" and "New Delhi" are deliberately not merged.

Two invented facts went with it: "Delivering to Delhi NCR" was printed on every
screen in the country with nothing behind it, and search showed every
wholesaler's location as "India" because the catalogue never returned the city.

The picker could not be clicked with a mouse at all, and worked perfectly from
a script. The navbar mounts two copies, one for phones and one for desktop, and
hides the wrong one with CSS. Sharing one open flag meant the hidden copy read
a click on the visible one as a click outside itself and closed the menu on
mousedown, destroying the button before the mouseup could land.

**Part payments reach the invoice.** The bill only heard about a payment once
the whole amount was in, so a buyer who had paid his first instalment looked,
on his own bill, exactly like one who had paid nothing. It now mirrors what the
order says has been received, reads Partial while money is owed, and gets a
timeline entry per payment. Two races were found and fixed on the way, both
older than the change: two callers could each raise an invoice for the same
order (measured: three invoice numbers on one order), and two payment events
could each record the same instalment (measured: 892.50 recorded three times).
Both now take a lock.

**The cancellation window is real, and refunds finish.** Cancel until packed,
return within seven days of delivery, then closed. The map allowed cancelling
from packed, ready_for_pickup and shipped, so the generic status route went
round the refuse button; `failed_delivery` keeps its exit because the goods
never arrived. `actual_delivery_date` is finally written, which is what the
seven days are counted from. `return_completed` to `refunded` existed and
nothing called it, so every returned order stopped one step short with the
customer's money in the till; the wholesaler can now record the refund, capped
at what he received, and the khata adds it back so the customer returns to zero.

### 3 Sept 2026

**Money that could not be trusted.** Three screens each carried their own idea
of what a customer owes, and they disagreed. The Overview billed from sales
alone while subtracting every payment including shop money, so an account
whose customers had paid through the marketplace showed a negative amount
still to collect. Measured at minus 1,000 on a single paid order.

Deeper than the copies: every screen asked one subtraction of the whole
business, total billed less total received. That lets one customer's credit
cancel another's debt, so a wholesaler chasing 5,000 is shown 3,000. Balances
are now worked out per customer and only then added up, debts into one figure
and credits into another. "Still to collect" is structurally incapable of
going negative; money held for customers has its own line.

The rule lives in `server/src/services/khataBalance.js`. Every screen reads
it. Do not write a fourth copy.

**The three Overview figures open the rows behind them.** `/seller/money/:metric`
shows each customer with his sales, his shop orders and what he has paid, so
the arithmetic is on the screen. Totals are added up from the rows on the page
rather than sent down, so a disagreement with the card would be visible.

**One order gets a page of its own,** `/seller/orders/:orderId`, beside the
list rather than instead of it. The list keeps its one tap step for clearing
orders fast; the page gathers the next action, the customer, the money, the
lines, the delivery checkpoints and the history.

**Returns go round.** Buyer asks with a reason, wholesaler accepts or refuses,
and "goods came back" cancels the sale and raises a credit note. The buyer's
way in is hidden behind `FEATURES.BUYER_RETURNS` by request; everything else
stays live, so turning it on is one line.

**Order numbers come from a sequence.** The old function had 10,000 numbers
per second and a retry loop that could not see other sessions. Measured: 11,000
rows in one statement never finished and wrote nothing; 1 in 1,250 concurrent
checkouts was refused. Both now zero.

**A wholesaler can refuse an order,** and a buyer can call his own off. One
transaction unwinds the order, its sale, its stock and its history. Money
already paid is deliberately left alone and the screen says so.

**GST numbers are checked** by their own check digit, free, no API. Caught
1,575 of 1,575 single character corruptions. Two screens disagreed about the
"GST registered" badge and both were wrong; both now read the number's shape.

**The notification bell has never worked.** `notifications.type` is NOT NULL
with no default and every insert wrote only `notification_type`, so every
insert failed and every caller swallowed the error. Fixed.

### Earlier

Parties as the spine; one ledger; products merged into one tab; the
order-to-sale bridge; accept and dispatch screens; per-wholesaler invoice
numbering; shop prices treated as tax inclusive.

---

## Next session, agreed 12 Sept

Taken off the master overview screen and put here, because the screen is for
doing the work and this is the reasoning behind it.

### One device at a time, asked for 14 Sept. NOT BUILT.

Wanted: an account signed in on one device, or one IP, at a time. A second
sign in ends the first.

Nothing today does this or can. Auth is a stateless JWT signed at login with
a 30 day expiry: there is no session table, no record of who is signed in
where, and no way to revoke a token once issued. The server cannot tell one
device from another and cannot reach out to end anything. Sockets use a room
per user, `user:<id>`, which deliberately holds many connections at once.

What it would take, roughly, and the decisions inside it:

- **A session table.** `user_id`, a session id, device label, IP, issued and
  last seen. The JWT carries the session id, and the auth middleware checks
  it is still live on every request. That turns every authenticated request
  into a database read, which is the real cost: today it is pure signature
  arithmetic and touches nothing.
- **What "one device" means.** A new sign in either kicks the old session or
  is itself refused. Kicking is friendlier and is what banking apps do;
  refusing strands somebody whose phone is lost. Kicking needs a socket push
  so the old device finds out rather than discovering it on its next tap.
- **IP is the wrong key.** Two staff on one shop wifi share an IP, and a
  phone on mobile data changes IP as it moves between towers. Locking to an
  IP would sign a wholesaler out while he walked across his own warehouse.
  Device, meaning a session row, is the thing to key on.
- **Staff accounts complicate it.** An owner and three employees are separate
  users, so this is per user and not per business. Worth confirming that is
  what is wanted before building it.
- **It interacts with the 14 Sept sign in fix.** That fix deliberately keeps
  a token alive through a network failure rather than treating an
  unreachable server as a dead session. A revocation check must not undo
  that: "the server did not answer" and "this session was ended" have to
  stay different answers, or flaky mobile data starts signing people out
  again, which is the exact bug that was just removed.

### Why our own checkout window and not Razorpay's?

Asked 12 Sept. Left open deliberately, not answered.

What exists today is `RazorpayCheckoutModal`, a local imitation of the checkout
window: our markup, our method list, our fields. The real integration loads
`checkout.razorpay.com/v1/checkout.js` and calls
`new window.Razorpay(options).open()`, which renders Razorpay's own window in
an iframe they control.

The question to settle is whether the imitation should have been built at all,
or whether the real script should have gone in from the start with test keys
(`rzp_test_...`) driving Razorpay's own sandbox.

Worth weighing tomorrow, without prejudging it:

- What the imitation costs if it is thrown away, against what it taught.
- Whether Razorpay's test mode needs an account and keys before anything can
  be seen on screen, and whether we have them.
- That card details must never reach our code, which is the reason their window
  is an iframe. Any path where our fields become real is the wrong path.
- Whether the sandbox works offline and in this repository's test setup.
- What is genuinely shared either way: the two server calls around the window,
  which is where the signature check lives and which do not change.

### The UPI QR code: how do we know he actually paid?

Raised 12 Sept, and it is the sharpest open question in the product.

**Today there is no verification at all.** The buyer scans the wholesaler's UPI
QR, pays in his own bank app, comes back, and presses a button to say he paid.
`updatePaymentStatus` caps the claim at what is owed, and that is the entire
check. Nothing confirms the money moved. A buyer can press the button having
paid nothing, and the order will read paid, the khata will credit him, and the
invoice will be raised.

It has held so far because this is a closed network where the two parties know
each other and the wholesaler sees his own bank alerts. It does not scale, and
the reconcile button is the wholesaler's only recourse.

**The options, roughly in order of cost:**

| Approach | What it buys | What it costs |
|---|---|---|
| Wholesaler confirms receipt | A second pair of eyes before the khata moves | A step, and a delay, on every order |
| UPI reference typed by the buyer | Something to match against a bank statement | Still self-declared, just harder to fake casually |
| Bank statement import, matched on reference and amount | Real confirmation, no gateway needed | Parsing per bank, and a matching rule |
| A payment gateway with a webhook (Razorpay) | Actual confirmation from the network | Fees, KYC, and Route for per-wholesaler settlement |

The reference field already exists and is already stored, so option two is
mostly wiring. Option four is scaffolded, see the Razorpay note above, and the
real blocker there is not the integration but Razorpay Route: money must land
with the wholesaler who was bought from, not in one platform account.

**The question to settle before building any of it:** does the wholesaler want
the money confirmed before the customer's khata moves, or after? Confirming
first is correct and slows every order down. Confirming after is what happens
now and means a khata that can be wrong until somebody notices. That is a
trade for the wholesaler to make, not for us.

### The purchase side, next steps

Built on 12 Sept, and these are the pieces deliberately left out.

- **Let the wholesaler state the tax off the supplier's bill** instead of only
  computing it. See the known limit above: a computed total can land a rupee
  from the printed one, and the printed one is what GSTR-2B matches.
- **Stock movement, both directions at once.** A purchase raising stock while
  a sale does not lower it is worse than neither. Doing it means giving
  `sale_lines` and `purchase_lines` a real link to an inventory row, which is
  a piece of work in its own right, not a column.
- **A purchase return, or debit note.** The mirror of the credit note. Goods
  going back to a supplier reverses part of a claim already made.
- **An input credit total for a period**, across purchases, set against the
  GST charged on sales. Each bill already reports its own claimable figure;
  what is missing is the sum over a month and the comparison.
- **A supplier statement and its PDF**, the mirror of the party statement.
- **Purchases on the Overview.** The home screen answers "who owes me" and
  says nothing yet about who he owes. `payableTotals()` already returns the
  two figures it would need.
- **Enter a purchase from a product.** The form takes typed item names only;
  the sale form has `ItemPicker` reading his own listings, but a supplier's
  description of the goods is usually not his own, so this needs thought
  rather than copying the component across.

### What belongs in master, and what stays with the wholesaler

The split is the thing most likely to be got wrong, and somebody looking for
"invoice settings" will look in the master area first.

**His, and staying on his own Invoice defaults screen:** invoice prefix,
suffix and padding, payment due days, default GST rate, notes, terms, bank
details, GSTIN. If any of those lived in master, one wholesaler changing his
prefix would change everybody's.

**The platform's, and still to build in master:**

| Setting | Why it is platform level |
|---|---|
| Currency decimal places | one convention for every Indian trader |
| Number format mask `9,99,99,999.99` | the lakh and crore grouping is not a preference |
| Currency symbol, character, string and sub-string | the string is what builds the amount in words |
| Date format | same |
| Tax rate decimal places | Busy keeps it separate from currency and so should we |
| Rule 46(b) limits: 16 characters, allowed alphabet | law, so read only in the UI |
| The number shape a brand new wholesaler starts from | a default, not a rule |
| Feature flags | marketplace, promotions, the challan rule |

**Per wholesaler with a platform default:** minimum HSN digits. It follows HIS
turnover, six above 5 crore and four below, so it cannot be one platform
number. Busy makes it a setting with 0 meaning "do not validate".

**The order still matters.** `/master/settings` can be built and can save, but
it must not be wired to the display until the fourteen `money()` copies are
collapsed into one formatter. Wiring it first gives a setting that reaches
some screens and not others, which is worse than the inconsistency it was
meant to fix.

### The state master does not yet decide tax

Adding a state in master fills the dropdowns. It does NOT change how tax is
worked out for it. `placeOfSupply` turns a state name into its GST code
synchronously, at module load, from a built in list, on the path that decides
CGST plus SGST against IGST. Making that path asynchronous so it can read the
table is its own change with its own risk and was deliberately not carried on
the back of the master work.

Until it is done, a state added in master is a label. The place it would bite:
a new state or union territory appears, an admin adds it, a wholesaler there
sets it on his profile, and his bills come out CGST plus SGST when they should
be IGST. There has been one such change recently enough to matter, Ladakh in
2019 and the Daman and Diu merger in 2020, so it is not hypothetical.

---

## The next phase, noted 10 Sept, nothing built yet

Requested in one go and deliberately not started. Written down here so the
shape is agreed before any of it is typed. Photos of the app this is modelled
on are coming; several of the decisions below wait on them.

**Read `docs/MASTER_AND_TRANSACTIONS.md` and `docs/BUSY_MODEL.md` first.**
The first is the plan: what the master dashboard holds, what a purchase record
needs, what to refine in sales and orders, and everything parked. The second is
the reading it came from.

**Read `docs/BUSY_MODEL.md` first.** Fourteen screenshots of a live Busy 21
were shared on 10 Sept and are written up there field by field: the Masters
menu, the whole Transactions menu, a real tax invoice with its IRN and e-way
bill number, the voucher numbering dialog, the regional settings and the GST
config. Most of the questions below are answered by it, and several guesses in
this section turned out to be right for the wrong reasons.

### The shape: masters, transactions, reports

This is how Tally, Busy and Marg are laid out, and it is what a wholesaler who
has used any of them expects. Masters are the things that exist; transactions
are the things that happen; reports read both.

  masters        customers, suppliers, items, units, tax rates, states, HSN
  transactions   sales, purchases, receipts, payments, credit and debit notes
  reports        khata, statement, GST returns, stock

We already have most of the nouns, under other names: `parties` is the party
master, `supplier_inventory` is the item master, `sales` is the sales register.
What is missing is a **purchase** side, which is half the transactions column,
and the menu that says which is which. A wholesaler buys as well as sells, and
right now the product can only describe one direction.

### Super admin, and the platform masters

Some masters belong to the platform, not to any one wholesaler: the state list,
the HSN list, tax rates, the number formats. Today they are constants in the
code, so changing one is a deploy.

**One thing found while looking:** `users.role` carries a CHECK constraint
allowing only `buyer`, `seller` and `both`. `promotionController` already
tests for role `'admin'`, which the database can never contain, so that code
is unreachable rather than merely unbuilt. A super admin needs that constraint
changed, which is a migration, and it is the first step of this whole block.

### GST Rule 46, and two real defects in what we ship

Rule 46 of the CGST Rules lists 16 mandatory particulars for a tax invoice.
Missing or wrong ones cost the customer his input credit and carry a penalty
of up to Rs 25,000 per invoice under Section 122. Against our invoice today,
two are genuinely wrong rather than merely absent:

**The invoice number resets on the wrong day.** `invoiceNumberService` uses
`new Date().getFullYear()`, so the counter rolls over on 1 January. Rule 46(b)
wants a serial unique for the FINANCIAL year, 1 April to 31 March. An invoice
raised in January 2027 would reuse a number already issued in FY 2026-27.
This is live today and it will bite on 1 January.

**The number can exceed 16 characters.** Rule 46(b) caps the serial at 16.
`INV-2026-000001` is 15 and fine, but the prefix is only clipped at 10
characters, so a wholesaler who sets a 10 character prefix gets a 22 character
number. `invoices.invoice_number` is `varchar(50)`, so nothing refuses it.
This is what "fixing the length" means, and the fix is to cap the whole
composed number, not the prefix.

Also missing from the document: **place of supply** is computed but never
printed, the **reverse charge** indicator does not exist, and the delivery
address is not shown for an unregistered buyer over Rs 50,000. Signature is
handled by the "computer generated, no signature required" line, which is
accepted practice.

### Delivery challan, Rule 55

Correctly understood as not a tax invoice. Worth being precise about why,
because the reason matters for what it may say: a challan is for moving goods
where a tax invoice cannot yet be raised, and it carries a **provisional**
quantity and value. Rule 55(2) wants three copies, marked Original for
Consignee, Duplicate for Transporter, Triplicate for Consigner.

One correction to the plan as put: a challan is not "the document you use when
the whole amount has not been paid". Part payment does not change what a
supply is. A tax invoice is still due on a credit sale, which is most of what
a wholesaler does, and that invoice is what the customer claims his credit
against. The challan belongs with **movement**, not with payment. This one
needs settling before it is built, or we will hand wholesalers a document that
does not do what they think it does.

### Razorpay

For verifying that a UPI payment really happened, which is the honest gap in
what we have: payments today are self declared, the buyer presses a button to
say he paid.

Two things to design around, both found while reading:

  the signature   a webhook is signed with an HMAC SHA256 of the raw body
                  under the webhook secret, in `X-Razorpay-Signature`. The
                  raw body, so the JSON body parser has to be bypassed on
                  that route or the signature will never match
  UPI Collect     deprecated by NPCI from 28 February 2026, which has already
                  passed. Any integration has to use UPI Intent or UPI QR

Handlers have to be idempotent, because the same event arrives more than once.
That is the same discipline the invoice reconcile already needed.

### Keyboard first

No mouse: numpad for moving up and down, shortcut keys for everything else.
This is the single thing most likely to decide whether a working wholesaler
adopts this over the software he already has, and it is also the one that has
to be designed before it is built rather than sprinkled on afterwards, because
it constrains every screen. It wants its own pass.

### Numbers

Decimal and thousands separators, configurable. Worth doing carefully: the
Indian grouping is 12,34,567 not 1,234,567, and the codebase already calls
`toLocaleString("en-IN")` in about fourteen places with its own copy of a
`money()` helper. Those want collapsing into one formatter first, or a setting
will reach some screens and not others.

---

## 16 Sept: Administration, UQC, and the HSN summary

The first phases of `ROADMAP.md`. Most of it came from the `sanskriti` branch
and was merged here.

**Done on that branch.** The master area renamed to Administration at `/admin`,
across routes, nav, page titles and comments. Gendered language taken out of
the whole codebase, 149 files: the wholesaler is no longer "he" in comments,
and UI copy that said "what he owed you" now addresses the reader. Escape on
the last three overlays. `trust_score` and `response_rate` dropped from the
schema, not only from the screens. The dead `/api/dashboard/stats` removed.
Then UQC on the units master, an HSN summary, and a Rule 46(b) check on
document numbers.

**Corrected on top of it.** The HSN summary read the taxable value as quantity
times unit price. A shop order is priced tax inclusive, so `unit_price` already
has the tax inside it: a 1180 rupee line at 18 per cent was declared as 1180
taxable with a 1360 total, against a bill that says 1000 and 1180, and GSTR-1
Table 12 gets filled in from that table. It now sums `total - tax_amount` and
the stored `total`, which is right whichever way the line was priced. It also
took an invoice id with no owner check, so it read any wholesaler's invoice.

Document numbers were refused correctly but threw into the generic catch, so
the wholesaler saw "Server error" and nothing else. The refusal now carries a
status and says which prefix is too long. Rule 46(b) applies to sales and
challans, not to purchase vouchers, which are our own note of somebody else's
bill.

UQC no longer guesses. `master_uqc` holds the published list with a foreign key
onto it, so a unit cannot carry a code that does not exist. Units map only
where the word means what the GST list means by it, and Case is deliberately
blank: there is no CAS code, and BOX, CTN and PAC are each a guess. Nothing
defaults to OTH, which is a real declaration rather than a fallback.

**Migration to run:** `wholesale3_uqc_master_units.sql`, again even if the
earlier version of it was already applied, and
`drop_trust_score_and_response_rate.sql`.

Still open in that area: the minimum HSN digit setting, and the Administration
screens for units and tax terms. See phase 4 in `ROADMAP.md`.

## 16 Sept: the invoice carries its own particulars

Phase 2 of `ROADMAP.md`. Columns and the write path. Nothing on a form or on
the PDF yet, which is phase 3.

The invoice gained the seller block, the recipient's state and code, a
dispatch-from address, a ship-to address, GR number and date, bank details, the
transport block, the IRN and acknowledgement fields, and cess. Lines gained a
UQC and their own cess. `invoice_settings` gained the live bank details the
copy is taken from, and `wholesaler_profiles` gained a registered address,
because the warehouse columns are where goods leave from and that is a
different question from where a firm is registered.

All of it is copied onto the invoice, not joined to it. An invoice already
snapshotted who it was billed to, for the reason that a party can be edited and
a tax document must not change once it is handed over. The seller's own block
and bank details are the same kind of fact. Join them and a reprint six months
later shows an address the firm has moved out of and an account it has closed.

The snapshot is taken inside `createInvoice`, not at its three call sites. A
snapshot a caller has to remember to take is one a fourth caller will forget.

Proved against a local Postgres: raise a bill, then change the firm name,
GSTIN, address, state and bank account it was copied from, and nothing on the
bill moves, while the next bill picks up all of it. The state code is derived
through `placeOfSupply` rather than typed, so it follows the same rule as the
tax decision.

Two things left blank on purpose. `parties` has no pincode, so the recipient
pincode is empty rather than invented. `invoice_items.uqc` has no foreign key
onto `master_uqc`, because a frozen line must not be coupled to a table
somebody can edit, which is the same mistake as joining the addresses.

**Migration to run:** `wholesale3_invoice_document_block.sql`

## 16 Sept: UQC on the Administration screen, and the bill prints its block

Phase 3, and the UQC part of phase 4.

**Administration.** Every unit now shows the GST code it is filed as, or says
"UQC not set", and the editor offers the statutory list as a dropdown with the
meaning beside each code. Blank is allowed and means nobody has decided yet,
which is deliberately not the same as OTH. A unit cannot be saved with a code
that is not on the list: the foreign key refuses it and the screen says so in
words rather than reporting a fault.

**The bill.** The PDF now prints the seller block with its address, state and
state code, the customer's state and code, dispatched-from and shipped-to when
they differ from the registered addresses, the transport band with the GR
number, bank details, and the UQC beside each quantity. An e-invoice block with
the IRN, acknowledgement and signed QR appears only once a real submission has
filled them in. Nothing is computed locally, because an IRN cannot be.

**A fault found while doing it.** The printed HSN summary computed the taxable
value as quantity times unit price, exactly as the SQL one did before it was
fixed this morning. On a tax inclusive bill that overstates the taxable value by
the tax, which is every marketplace order. It now reads the line total minus its
tax, and the summary ties to the total above it on the page.

The invoice screen now says why the tax split is what it is: "IGST, because you
are in Maharashtra and they are in Gujarat". Shown only when the invoice
recorded both states, since guessing at the reason would be worse than silence.

Rendered and looked at: a bill with every field, a bill with an IRN and QR, an
old bill with none of them which prints as it always did, and the units screen
at desktop and phone width.

## 16 Sept: the invoice form, and the HSN digit rule actually bites

Phases 3 and 4 finished.

**The form.** The new invoice screen has a "Dispatch, delivery and transport"
section, closed by default because most bills go from the registered address to
the registered address with no lorry to record. Inside it: dispatched from,
shipped to, the transporter block and the GR number. Each line gained a Unit
picker, which is also how the line gets its UQC: the wholesaler picks Metre and
the bill is filed as MTR. Nobody is asked to know that Bundle is BDL.

State CODES are derived from the state name on the server, never typed. It is
the number that decides CGST and SGST against IGST, and asking somebody to type
27 beside Maharashtra is asking them to get it wrong on a tax document.

**The HSN digit rule.** `default_hsn_min_digits` has been in `master_settings`
since the platform masters were built, and it is on the Administration settings
screen. Nothing read it. `hsnService` checked that a code was 4, 6 or 8 digits
and stopped there, so a platform set to 6 accepted 4 digit codes everywhere.

It is enforced now on sales, purchases, products and manual invoices. The
manual invoice path was not checking the HSN at all, so the same code could be
refused on a sale and accepted on a bill. `checkHsn` stays pure and takes the
minimum as an argument; the caller reads the setting once before looping.

No migration. The column and the screen were already there.

**Verified.** Eighteen checks against a local Postgres: changing the setting
changes what is accepted, a short code is refused with the line named, the
dispatch and transport fields reach the invoice, the state codes are derived,
the customer's state is frozen from their own record, the seller block is
copied without the form sending it, a line that picked a unit carries its UQC
and a line that did not is left blank. The form was rendered at desktop and
phone width, which caught the unit dropdown showing "Metr".

---

## 16 Sept: transport on a sale, and a tick for "paid in full"

Phase 5, plus a small thing asked for alongside it.

**Transport on the sale.** The invoice has carried these fields since this
morning, but a sale often has no invoice yet: a wholesaler records the sale and
loads the lorry the same afternoon, and the bill may go out days later or never.
The vehicle number is only known at the moment the goods leave. So `sales` has
its own transporter, transporter ID, mode, vehicle, LR or RR number and date,
and GR number and date, and when a bill is raised from the sale they are copied
onto it. Typed once. Copied and not joined, so editing the sale afterwards
cannot change a bill already handed over.

There is one definition of the block on each side, `services/transportDetails.js`
and `components/TransportFields.jsx`, used by both the sale and the invoice
screens. Two copies of eight fields is how one screen starts offering a mode the
other refuses.

**Paid in full.** A tick beside every box where somebody would otherwise read a
total off the screen and type it back in: recording a sale, entering a purchase,
taking a payment from a customer, paying a supplier. It writes the exact figure
to the paisa and locks the box so the two cannot disagree. It unticks itself if
the total moves, rather than silently sitting at the old figure and understating
what was taken.

**A hazard found and cleared.** Running the migrations through a splitter, as
CLAUDE.md says to, showed `wholesale3_invoice_from_sale.sql` failing with
`syntax error at or near "every"`. It had a semicolon in the middle of a prose
comment, the exact trap that cost a debugging round on 14 Sept. A scan found 20
of them across 13 files. All replaced with full stops. A semicolon at the END of
a commented out example is harmless, because the fragment it makes is comment
only, and those were left alone.

**Migration to run:** `wholesale3_sale_transport.sql`

## 16 Sept: transport on orders too, and the three roads made to agree

Asked: does a bill raised from a shop order carry the transport as well? It did
not. Checked rather than assumed, and the answer was no on both counts.

**Orders had nowhere to put it.** `orders` held `shipping_carrier` and
`tracking_number`, which are a courier and a consignment number, not the e-way
bill fields. The dispatch box asked for a vehicle number but sent it to
`shipment_tracking_links`, which is the link a customer opens to watch the
lorry: a courtesy that expires, and not something a tax document should be built
out of. So `orders` gets the same eight columns the sale and the invoice have.

**The timing is different from a sale, and that shapes the design.** A shop
order raises its bill the moment the order is placed, long before anything is
loaded. The transport cannot be copied at billing time because nobody knows it
yet, so it is stamped at despatch onto the order AND onto the invoice that
already exists. That is a deliberate exception to the freezing rule and a narrow
one: the addresses and the amounts are frozen because they were true at issue,
while the vehicle is decided afterwards, and the e-way bill rules themselves
allow a vehicle number to be changed in transit.

**Then the three roads were compared.** One bill raised by each, from the same
firm to the same customer, and every column printed side by side. They agreed on
the seller block, the bank details, the transport and the tax particulars, and
disagreed on who the bill was made out to:

  - from a sale, fully frozen
  - from an order, nothing frozen at all, joined at read time
  - typed by hand, only the state frozen

So a bill from an order, reprinted after the customer changed their firm name or
moved, showed today's details on a document issued months ago. That is the exact
thing the recipient snapshot exists to prevent, and only one of the three roads
was doing it. `createInvoice` now writes the recipient itself, so all three
freeze it and a fourth caller cannot forget. The order path prefers the delivery
address the customer gave for that order, since that is where the goods went.

Re-run after the fix: all three agree on every field.

**Migration to run:** `wholesale3_order_transport.sql`

---

## 16 Sept: tax terms, and cess into the money path

Phase 6, the one where a mistake lands in somebody's ledger rather than on a
screen. The audit came before the code.

**What the audit found.** Every reader of a total was mapped first, and it
turned up the thing that would have broken this. `orders.total_amount` is the
CART GROSS, written at checkout, and it never goes through `gstService` at all.
The bill for an order derives its tax out of that same gross, which is why the
two agree today. Add cess ON TOP for that path and the buyer agrees one figure
at checkout, the bill says a second, and the khata says a third.

**So cess follows the pricing mode, exactly as the GST already does.** On a
counter sale the rate quoted is before tax, so every levy goes on top and the
total grows. On a shop order the price on the page is what the customer pays,
so the cess comes out of it beside the GST and the total does not move. That is
what keeps the money path together by construction instead of by remembering to
update a second place.

Cess is its own levy throughout: its own rate per line, its own total on the
sale and on the bill, its own column in the HSN summary, its own line in the
totals. It is never a share of the GST. Eighteen plus twelve is thirty per cent
of the taxable value, not eighteen split three ways.

**Tax terms.** A named combination a line can be billed under, in Administration
at `/administration/tax-terms`. Entering the GST derives CGST and SGST as half
each. Those halves are not stored: two stored halves are two things that can
disagree with the whole.

**A second fault found while doing it.** The HSN summary's taxable value
subtracted only the GST from the line total. With cess in the total that
overstates it again, the same shape of fault the table was fixed for this
morning. It now subtracts both levies.

**The twelve per cent is a test default.** `GST28_CESS12` is seeded so the
arithmetic can be tested end to end. Nothing carries cess unless a line says so,
so no existing bill changes. Real cess is commodity specific and a blanket rate
on a live bill is a wrong number on a legal document. Remove that term, or set
its cess to zero, before this goes near a real customer.

**Verified.** 24 arithmetic checks with no database, then 17 against a local
Postgres: the sale total, the customer's khata, the invoice grand total and the
invoice line all carry the same cess to the paisa, a bill raised from a sale
equals the sale, a sale without cess is exactly what it always was, and a
billed sale still cannot be edited. Every earlier suite was re-run, 107 checks
in all, and the three ways of raising an invoice still agree on every field.

**Migration to run:** `wholesale3_tax_terms_and_cess.sql`

---

## 16 Sept: a run of invoice numbers per sales channel

Phase 7. Four books: counter, this shop, Flipkart, Amazon. Each keeps a run of
invoice numbers that is consecutive in ITSELF, which is what Rule 46(b) asks
for and what lets a marketplace settlement report be matched against ours. One
shared counter gave Flipkart a run reading 4, 9, 11, with the gaps filled by
counter sales.

A dropdown on the sale form says which book a sale belongs to, and the bill
raised from it draws on that run. An order placed on this marketplace is the
shop channel by definition rather than by choosing.

**Nothing was renumbered.** The counter channel keeps the wholesaler's own
configured prefix, so a firm numbering OM/1/26-27 carries straight on, and the
three new channels start their own run at 1. Renumbering a bill already handed
over would break the customer's GSTR-2B against ours, and the instrument for
correcting an issued invoice is a credit note.

**It is not an import.** Choosing Flipkart records where a sale came from. It
fetches nothing from Flipkart, and the hint under the field says so rather than
letting anybody expect an integration that does not exist. Pulling orders out
of those marketplaces needs a developer account and a seller authorisation, and
is its own piece of work.

An unknown channel is refused rather than quietly filed under the default,
because a sale in the wrong book is a run of numbers nobody can reconcile.

**Verified.** 16 checks against a local Postgres, including that four channels
billed in turn each produce their own consecutive run, that the counter keeps
the wholesaler's prefix, that Flipkart starts at 1, that every number is inside
Rule 46(b)'s sixteen characters, and that the counters really are separate
rows. Every earlier suite re-run, 123 checks, and the three ways of raising an
invoice still agree.

**Migration to run:** `wholesale3_sales_channels.sql`

---

## 16 Sept: the wholesaler can take his book and leave

Phase 8. `GET /api/exports/zip` hands back one zip holding nine spreadsheets,
one per list, plus the bills as PDFs and a readme in plain English. The button
is on Settings, with a second one for the figures alone when somebody does not
want to wait for the bills to draw.

**The whole point of the feature is to hand over a file, which is what makes
getting the scope wrong so bad.** So the owner comes from the token and there
is no id in the route, no `/:id` and no `?wholesaler=`. Child tables join up to
their parent rather than being queried on their own, so a purchase line is
reached through its purchase and a missing WHERE cannot leak a table.
`buildZip` takes the owner as a required argument with no default and throws
without one.

**Owner only, and that was a change from the plan.** The roadmap said gate it
on a permission. Every other seller route is gated on the one list it touches,
but this route is the whole book at once: customers, sales, money received,
suppliers, purchases and every bill. Gating it on `invoices` would have quietly
widened that permission into all the others and let an employee walk out of the
shop with the customer list. It sits with the GST number and the UPI id, behind
`requireOwner`, which is deliberately not grantable.

**The zip is written by hand**, `services/zipWriter.js`, stored rather than
deflated. About eighty lines against a dependency to keep updated, audit and
carry on every deploy, on a server whose package list is fourteen entries long.
The CRC table is written out rather than taken from `zlib`, because
`zlib.crc32` only arrived in Node 20.15. Names are stored as UTF-8 with the
flag at bit 11 set, so a Devanagari filename does not arrive as mojibake.

**A customer name is somewhere a person types free text, and a spreadsheet runs
what it opens.** A cell starting with `=`, `+`, `-` or `@` is prefixed with an
apostrophe before it is quoted, in that order, because prefixing after quoting
leaves the formula sitting inside a quoted field where Excel still evaluates
it. This is the one place in the product where another program runs our data.
The readme explains the apostrophe rather than leaving it looking like a bug.

The PDFs stop at 200, newest first, because each one is drawn on the spot and
the archive is built in memory. The readme says how many were left out. The
spreadsheets always carry every row, however many there are.

**Verified.** `server/scripts/export_check.js`, 82 checks against a local
Postgres built from the migrations, with two wholesalers in one database. The
route was driven as wholesaler A with B's id set in the query string under six
different names, in the params, in the body and in a header at the same time:
the file that came back contained none of B's rows, none of B's ids, and none
of B's bills. The archive is read back by a parser written from the ZIP format
rather than out of `zipWriter`, because a reader built on the writer's own
assumptions would agree with it about a malformed file, and real `unzip` gets a
look at it too. Staff holding every permission there is were refused 403, and
so was a turned off employee. Then the button was clicked in a real browser
against the real route, and the zip that landed in the downloads folder opened
clean.

Three things the suite caught that reading would not have. A cell holding a
line break made a naive line count read 412 records for 206 bills, which was
the quoting working correctly. The readme originally said "1 invoice PDFs
included". And the first fixture paid a sale in part, so with
`CHALLAN_WHEN_UNPAID` on, which is the default, every sale got a delivery
challan and no bill was ever raised to export.

**Migration to run:** none. Phase 8 adds no columns.

---

## 17 Sept: and the other direction, a book coming in

Phase 8.5, which was not on the roadmap. It got added when the question "where
is the option to upload a zip for invoices, sales and so on" turned out to
have the answer "there isn't one, anywhere". The only file inputs in the whole
product were message attachments, review photos and product images. The export
had been built first and went one way, which is the wrong half to have on its
own: a wholesaler with a year of sales in a spreadsheet cannot start using
this at all until he can get them in.

`POST /api/imports/preview`, `POST /api/imports/commit`,
`GET /api/imports/template`. Customers, suppliers, purchases, sales and old
bills, with their line items. A zip of CSVs, so the export round-trips, or one
CSV on its own. Owner only and scoped by the token, same as the export and for
a stronger reason: this side writes.

**Three rules hold it up.** Nothing is overwritten, ever: a row already in the
book is skipped and counted, because a merge done wrong replaces a figure a
customer agreed to with one out of a spreadsheet. It is all or nothing, one
transaction, because half a year in a book with no way to tell which half is
worse than a failed upload. And you see it before it happens: preview does
every read and every check and writes nothing.

**The figure on the paper wins.** If the file gives a total, that is the
total, even when the lines add up to something else. An old bill was handed to
a customer who paid what it said, and recomputing it here would move the debt
away from the figure he agreed to. The same reasoning the sale side already
uses when a sale follows an order. Only when there is no total at all are the
lines added up.

**Old bills are records of bills issued elsewhere.** They keep their own
numbers, carry `import_batch_id` so nothing can re-issue them, and a bill
carrying an IRN is refused, because an IRN is issued by the IRP against a
submission and cannot be checked from a spreadsheet.

**The counter has to move past them, which is the opposite of what it sounds
like.** Import KT/000001 to KT/000400 with the counter at zero and the next
bill raised here is numbered KT/000001, hits the unique index on
(supplier, invoice_number) and fails. The wholesaler could not raise a bill at
all, and the error would say nothing about the import. So the run is advanced
past the imported numbers and the preview says what the next bill will be
called. Nothing is renumbered: every imported bill keeps the number it was
issued under, and the run carries on after them. The suite proves it by
importing five bills, then recording a sale and raising a bill the ordinary
way, and checking it comes out numbered 000006.

**Dates are read day first, as a rule rather than a guess**, and it says so on
the template and on the screen. 03/04/2026 is the third of April. This is the
one place in the import where a wrong guess is invisible: both readings are
real dates, nothing errors, and a bill silently moves into a different month
and therefore a different GST return.

**A value that cannot be read is an error, not a zero.** "N/A", "see note" and
"-" in an amount column are named with their line number and their column
rather than quietly becoming nothing. A book built out of best efforts is
worse than no book, because it looks finished.

Two readers were written for this, both deliberately not sharing a line with
`zipWriter` or `exportService`. `csvReader` handles quoted cells with line
breaks in them, doubled quotes, CRLF, Excel's byte order mark, and takes back
off the apostrophe our own exporter adds to defuse a formula. `zipReader`
handles DEFLATE as well as stored, because every zip made by Windows, macOS or
7-Zip is deflated and a reader that only understood our own would reject
almost every real file.

**Verified.** `server/scripts/import_check.js`, 76 checks, and
`format_check` covered the pure half with 70 more. A file sent twice writes
nothing the second time and leaves exactly one copy of everything. A failure
partway through leaves not one row, proved by standing a constraint in the way
of a row the plan could not have known would fail. Staff holding every
permission are refused. The route driven as one wholesaler with another's id
in the query string, the params, the body and a header at once still wrote
only to the caller's own book. Then a real deflated zip made by the `zip`
command was uploaded through a real browser, and the two bad rows in it came
back named by line and column while the good ones went in.

The tax split is worth seeing: a bill with one tax figure of 100 to a Gujarat
customer came out as IGST 100, and the same bill to a Maharashtra customer as
CGST 25 plus SGST 25. That question is asked of `placeOfSupply` and of nothing
else, the same as everywhere else.

Two bugs the tests found that reading would not have. `COALESCE($10, 0)` makes
Postgres infer the parameter as an INTEGER, so an opening balance of 123456.78
failed on insert while a whole number passed. And a `.xlsx` IS a zip, so it
went down the zip path and came back "nothing in that file is a list this
recognises", which is true and useless to the person who uploaded the most
likely wrong file in the world. It is now checked for by name, before
anything else, and told which button to press.

Products and stock are not in this phase. They were not asked for.

**Migration to run:** `wholesale3_imports.sql`

---

## 17 Sept: where the import lives, and the tax terms list

Two things from looking at the screens rather than the code.

**"Where is the option to import a zip?"** Asked twice, about a card that was
on the screen the whole time. It sat at the bottom of Settings, below a Save
button that reads like the end of the page, under a long form. So import and
export now have their own sidebar entry, **Your data**, between Staff and
Settings, with the import first because somebody arriving there for the first
time is bringing a book in rather than taking one out. The page also lists
what has been brought in before, so it is possible to tell whether a file has
already been sent. Settings keeps a one line link to it, the way it already
links to Bill numbering and terms. Owner only, and the server refuses an
employee on every one of the routes rather than trusting the screen to hide
the buttons.

**The tax terms list on Administration.**

Not a fault, a look. Every row had the same weight: a bold title and one grey
line reading `GST 18% | CGST 9% + SGST 9% within a state | no cess`. Eight of
those read as a wall, because the only thing that differed between them was a
number buried in the middle of a sentence that repeated itself.

What changed, and why each one:

- **The rate leads, as a figure in a chip on the left.** A tax term IS a
  number, and the number is what somebody scans for.
- **The split is said once, quietly.** CGST and SGST are always half each, so
  spelling both halves out on every row was one rule written eight times.
- **"no cess" is gone.** It was on seven rows out of eight. An absence said
  seven times is not seven facts. The row that HAS cess now carries a mark
  instead, because that is the unusual one and the dangerous one to pick by
  mistake, and its chip shows `+12` under the rate.
- **Off is lighter than Edit.** Withdrawing a rate and editing one are not the
  same weight of action and used to look identical.
- **The row wraps on a phone**, so a name is never truncated to "GS...".

Two faults the render caught that reading did not. Computing the halves as
`igstPercent / 2` printed `0.125% + 0.125%` for the 0.25 per cent term, when
the stored split is 0.13 and 0.12: half of a quarter per cent does not land on
a figure a bill can carry. The halves now come from the row. And "Nil rated"
read "Splits 0% + 0% inside one state", which says nothing.

`lead` and `tag` are optional hooks on the list spec rather than a special
case inside `MasterList`, so States, Units, Tax rates and HSN codes are
unchanged. All four were rendered to confirm it.

---

## 17 Sept: an empty date box refused a whole sale

Reported from the running app: recording a sale failed with

    invalid input syntax for type date: ""   on parameter $18

$18 was `transport_doc_date`. The two dates in the transport block were the
only fields in it that skipped `clean`, on the reasoning written into the
comment above them: a date should reach Postgres exactly as it was typed
rather than being half parsed here, because a guess is worse than a refusal.

That reasoning is right. The code did not follow it. An untouched date input
posts an EMPTY STRING, `"" ?? null` is `""`, and an empty string is not a date
somebody typed, it is the absence of one. `clean` only trims and nulls an
empty string, so using it keeps the rule intact: a real date still goes
through untouched.

Both dates now use the same `pick` as every other field in the block. Checked
the rest of the codebase for the same shape: every other date path already
uses `clean` or `|| null`, so these two were the only ones.

**Why nothing caught it.** Every suite either left the field out, which
arrives as undefined and becomes null, or sent a real date. A browser form
sends neither. `scripts/transport_check.js` now sends exactly what a browser
sends, which was the missing case, and 24 checks cover the rest of the block:
a typed date surviving as typed, an invented mode getting a 400 rather than a
500, an empty block not claiming a transporter on a bill, the lorry carrying
across to the invoice raised from the sale, and all eight columns existing on
sales, invoices and orders.

Confirmed the suite fails on the old code and passes on the new, rather than
assuming it would.

**Migration to run:** none.

---

## 17 Sept: a challan said Outstanding, the bill it linked to said Paid

Reported from the running app: a delivery challan on a part paid sale showed
an outstanding balance, and clicking through to its tax invoice showed
Generated, Paid, nothing owing.

**Both were right, and neither number was wrong.** `delivery_challans.total_value`
and `amount_paid` are written once, when the challan is raised, and nothing
updates them. That is correct and must stay that way: a challan left the gate
with the goods, and its figures are what the driver carried on the paper.
Refreshing them would be rewriting a document already handed over, which is
the thing this codebase refuses to do everywhere else.

The fault was the SCREEN calling a frozen figure "Outstanding" for ever.
Reproduced against a local Postgres by walking the whole journey:

    goods out, part paid   CHALLAN  outstanding 1600   INVOICE  no link yet
    money in, bill raised  CHALLAN  outstanding 1600   INVOICE  Paid, owing 0

That ₹1600 sat directly above a link reading "Raised once the money came in".
Two true statements that read as a contradiction.

Fixed on the screens, with the data left frozen:

- The challan detail money block is headed "On the day the goods left" once
  billed, the last line becomes "Owing then" in muted grey rather than
  "Outstanding" in black, and a line underneath says the balance was settled
  since and points at the invoice.
- The challan LIST no longer prints "1600 due" in clay beside a green "Billed"
  badge. That figure now shows only while the challan is unbilled.
- The challan PDF said "Received so far" and "Outstanding", both of which read
  as live. Now "Received by this date" and "Balance on this date", anchored to
  the date printed on the paper. Same figures, printed truthfully whether the
  document is printed that day or a year later.

`challan_check.js` gained the invariant, because the obvious wrong fix is to
make the snapshot live: after the bill is raised the challan still shows what
was owed on the day, while the invoice it points at is settled.

**Migration to run:** none.

---

## 17 Sept: the challan becomes a document in its own right

Asked for after looking at how Marg, Tally and Busy actually do it, and the
research settled the design. All three have the same pair. Marg: Sale Challan
and Purchase Challan under Transactions, converted into a Sale Bill or a
Purchase Bill afterwards, with `Daily Working > Challan To Bill` for several at
once. Tally: Delivery Note and Receipt Note, linked to the invoice by a
Tracking Number. Busy: Material Issued to Party and Material Received from
Party.

**In all three the challan is MOVEMENT driven.** It exists because goods moved,
before any bill, and it does not care whether anybody has paid.

Ours was payment driven. It was raised BECAUSE a sale was unpaid and it held
the tax invoice back until the money came in, which conflated two different
documents. That waiting was also the part that was never compliant: section
31(1) ties the invoice to REMOVAL of the goods, not to payment, so holding it
back understated outward supply in GSTR-1 and left the customer unable to claim
input credit.

So there are two kinds now, `kind = sale` and `kind = purchase`, each with its
own run of numbers. `SC/` and `PC/` replace `DC/`, and the counter was NOT
reset: a wholesaler at DC/5 gets SC/6 next and no number is reused.

**THE RULE THE WHOLE THING RESTS ON.** A challan moves stock and nothing else.
It never touches the party balance and it carries no GST. A challan that also
moved the ledger would have every sale counted twice in the khata, once when
the goods left and again when the bill went out, and the error would be
invisible because both entries would look correct on their own. The lines carry
`gst_percent`, which is the rate the line WILL be billed at so the sale form
need not be retyped, and nothing sums it.

**A bill is not converted server side.** The challan loads INTO the sale or
purchase form, where it can be adjusted, and the ordinary path prices it. That
is Marg's flow: modify the challan, press F7, it loads into the bill screen.
Converting server side would mean a second copy of the GST, cess, channel and
transport logic, and two copies of money arithmetic is how the khata and the
bill start disagreeing. The form posts back the challan ids and they are
stamped in the same transaction that writes the bill, so the same goods cannot
be billed twice: a request naming four challans that closes three gets a 409
rather than a quiet partial bill.

`CHALLAN_WHEN_UNPAID` now decides ONE thing, whether an unpaid sale holds its
bill back, and defaults OFF. Challans exist either way. Setting it true
restores the old behaviour exactly, for a wholesaler who has not re-trained
their counter.

**Taking money moved onto the sale.** It used to mean leaving the sale, opening
Customers, finding the customer and picking the sale back out of a list. Four
steps to answer a question the screen was already showing. The customer page
keeps its own version for a round sum against several old bills at once, which
is real and does not belong on one sale.

### What a sweep of the new system found

Ten faults, all fixed, all now pinned in `challan_book_check.js`:

- **The sequence key.** Widening it to (wholesaler, kind) dropped the unique
  constraint the allocator upserts on. The next challan of any kind would have
  failed outright. The financial year has to stay in the key.
- **`SET status = CASE WHEN $3 ...` is not a guard.** Postgres parses the whole
  statement before running it, so a database without the migration answered
  `column "status" does not exist` on every sale that billed a challan.
  Migrations here are applied by hand, so the window between a deploy and
  somebody pasting the SQL is real. Two statements now, and the suite hides the
  column to prove it.
- **A challan raised against an already billed sale** sat pending for ever and
  would have been offered for billing a second time. Born billed now.
- **A billed purchase challan read "Not billed"**, because the screen tested
  `invoice_id` and a purchase challan points at a purchase.
- **The PDF pointed the wrong way on a purchase challan**: FROM us, DELIVER TO
  the supplier the goods came from.
- **The money block invented a debt.** `amount_paid` is zero on a movement
  challan because nothing was ever paid against a challan, not because the
  whole value is owed. Keyed off money actually received, not off `sale_id`,
  which `stampBilled` sets and which therefore came back the moment a challan
  was used.
- **Three wording faults on a purchase challan**: "your customer cannot claim
  input credit" when it is us, "What went out" when it came in, and a link to a
  tax invoice that does not exist, which went to `/seller/invoices/null`.
- **A false probe result was cached**, so running the migration on a live
  server would not take effect until a restart. Only a true is cached now.

The PDF assertions were also wrong at first: pdfkit compresses the content
stream, so searching the buffer for "DELIVER TO" is false on a document that
says it in letters an inch high. They go through `pdftotext` now.

**Verified.** `challan_book_check.js`, 52 checks. `challan_check`,
`challan_matrix_check` and `flow_check` rewritten where they pinned the old
rule, each change explained at the assertion. Nine suites green, including the
three that run on databases WITHOUT the new migration. Both PDF directions and
the challan screens rendered and read.

**Migration to run:** `wholesale3_challans_two_kinds.sql`

---

## 17 Sept: the two books made to match, and a challan that makes its own bill

Reported: "the sales and purchases arent symmetric, purchases have add a bill
add a supplier but not sales", the Record sale button should come off the top
bar "since its not primary anymore", and "how does sale get added when we
create a challan".

**The asymmetry was real and it had a cause.** Purchases carried Add supplier
and Enter a bill at the top of its list, and a `+ New` beside the supplier
dropdown inside the bill form. Sales carried neither. Not an oversight: there
is a comment in `Sales.jsx` and another in `Overview.jsx` saying the workspace
header already had a Record sale button on every screen, so a second one on
the list looked like a mistake. That reasoning was sound while the header
button existed. Taking it away makes the two books read the same way round:
add the party, then write the document, on whichever side you are on.

Done:
- the header Record sale link is gone from `SellerLayout`, and the `Plus`
  import with it. The comment left in its place says why, so it does not get
  put back.
- `Sales.jsx` gained Add customer and Record a sale, the same pair Purchases
  has, in the same order and the same two styles.
- `RecordSale.jsx` gained the `+ New` beside the customer dropdown, and the
  `PartyFormModal` behind it, mirroring what `RecordPurchase` has done since a
  bill from a new mill meant abandoning what was typed.
- the stale comments on `Sales.jsx` and `Overview.jsx` were rewritten rather
  than left to mislead the next session.

**How a sale gets added when a challan is created: it does not, and that is
deliberate.** A challan moves stock. It carries no GST, touches no balance,
and creates nothing on the money side. The bill is a separate act, which is
the whole point of having two documents and is how Marg, Tally and Busy all
work. What WAS missing is the road between them.

Until now the only road was: remember the challan, open Record a sale, pick
the customer, find the challan in the panel, tick it. The wholesaler standing
on the challan had no way forward from the document in front of him.

So an unbilled challan now carries **Make the bill** (a sale challan) or
**Enter the bill for this** (a purchase challan), linking to
`/seller/sales/new?party=<id>&challan=<id>` or the purchase equivalent.
`PendingChallans` takes an `autoSelect` prop and ticks that row the moment the
list lands, which runs the same `pullChallan` a human tick runs: the items
load, priced by the form's one GST path, and the ids ride along so
`stampBilled` closes the challan in the transaction that writes the bill.
Nothing new on the server. The button only appears where there is a party to
bill, because an old challan raised against an order can carry none, and a
link to `?party=null` opens a form that cannot be saved.

**A bug found while mirroring the pattern.** `PartyFormModal` and
`SupplierFormModal` open from inside the sale and purchase forms. A React
portal puts them outside that `<form>` in the DOM but still bubbles their
submit up the REACT tree to it, and `preventDefault` does not stop that: it
stops the browser navigating, not the event travelling. So adding a supplier
mid-bill also tried to save the bill. Rendered it and watched it happen: a
green "Supplier added" toast with a red "Choose a supplier" behind it, and on
the sale side "Choose a customer." over the customer that had just been added.
Pre-existing on the purchase side; both now call `stopPropagation`.

**Verified in a browser, not by reading.** A mock API on 5000 and Playwright
against both directions. Sale challan SC/4/26-27 to Make the bill: form opens
with the customer chosen, the challan ticked, two lines at 30 mtr x 88 and
10 mtr x 90, total 3540 plus 5 per cent GST reading 3717. Purchase challan
PC/2/26-27 the same way into Enter a supplier's bill. Confirmed the header
Record sale link is absent and that the leaked submit fires once before the
fix and not after. `npm run lint` clean on every touched file, the one
remaining `SellerLayout` error pre-dating this and confirmed by stashing.
`npx vite build` green.

**Migration to run:** none.

---

## 17 Sept: a guard that hid a missing column, found by running all 37 suites

Found while checking whether the branch was fit to merge. Ran every suite in
`server/scripts` against databases built from the migrations. Three failed.
Two of them, `opening_balance_check` and `purchase_check`, were one bug:

```
column "opening_balance" of relation "suppliers" does not exist
```

**A database built from these migrations had no `suppliers.opening_balance`,
and the runner reported 57 of 57 applied.** Adding a supplier answered 500 on
a schema the runner called complete.

`wholesale3_opening_balance.sql` sorts alphabetically BEFORE
`wholesale3_purchases.sql`, which is the file that creates `suppliers`. It
knew that, and guarded the supplier half in a `DO $$` block that asked
`to_regclass` first and raised a NOTICE when the table was missing.

That guard is what broke it. `run_migrations.js` makes up to five passes and
retries any file that FAILED, precisely so a file that arrives before its
prerequisite can succeed on the next pass. The DO block turned "not ready yet"
into SUCCESS, so the file was marked applied on pass 1 and never revisited.
The parties half ran; the suppliers half never did, on any pass, ever.
`ALTER TABLE IF EXISTS` would have had the identical fault. **A guard that
turns a missing prerequisite into a quiet success defeats the retry.**

Fixed by deleting the DO block and letting the plain `ALTER TABLE suppliers`
fail on pass 1 and be retried on pass 2, which is the mechanism the runner is
built around. Now reads `3 file(s) not ready on pass 1, retrying` and
`58 of 58 migrations applied`, with both columns present.

There is no migrations table. Every run replays every file and leans on
idempotency, so this repairs a database that already exists rather than only
helping fresh ones. Confirmed by running the corrected file against a schema
built from `main` and watching the columns appear.

Checked the way CLAUDE.md asks: split on semicolons and ran the five pieces
one at a time, against a database that already had the columns and against one
that did not. 5 of 5 both times. No semicolon inside any comment, no DO block
left in the file.

The third failure, `scale_check`, is not a failure. It is a performance
benchmark that reads an already seeded database and divides by what it finds,
so on an empty one it throws on `typical.n`. Nothing to fix. It needs a seeded
database, and it is the one suite not in the count below.

**36 of 36 suites green** on databases rebuilt from the corrected migrations.

**Migration to run:** `wholesale3_opening_balance.sql`, again. It is
idempotent and safe to re-run. If `suppliers.opening_balance` already exists
on Neon, because the file was pasted by hand after the purchases one, it
changes nothing.

---

## 18 Sept: the item box suggests from the product list, everywhere

Asked: "shouldn't when typing product name in challan, a list appear to select
from our existing products as well?" Yes, and it did not.

`ItemPicker` existed and was wired into ONE screen, the sale form. The challan
form and the purchase form both had a plain text box, so the item name, the
HSN and the GST rate were typed by hand on two of the three places a line is
entered. The server had been ready for this the whole time: `challanBook`
already reads `productId` off a line and writes `delivery_challan_items.
product_id`. The client simply never sent it.

Done:
- the challan form uses `ItemPicker`, filling name, rate, unit, HSN and the
  GST rate, and sends `productId` so the line remembers what it was picked
  from. Typing a name that is on no list still works and leaves it null, which
  is the rule the sale line has always had: the NAME is the content and the
  product is a reference beside it.
- typing over a picked name clears the id, so the reference cannot end up
  pointing at a product whose name has been replaced.
- the purchase form uses it too, filling name, unit, HSN and the GST rate but
  DELIBERATELY NOT the rate. On a sale the list price is what he charges. On a
  purchase the number that matters is what the mill charged, printed on the
  bill in his hand. Filling it would put a plausible wrong number in a box he
  might not check.

**Two bugs found underneath it.**

`challanService.findById` is what the edit form reloads, and it selected six
columns: not `gst_percent`, not `product_id`. So opening a challan and saving
it again dropped the GST rate off every line that had one, and would have
dropped the product link with it. Nothing failed and nothing was said: the
form loaded a blank where a number had been and wrote the blank back. Now
picks its column list from a probe, as two separate SQL strings rather than
one with a conditional column, because Postgres parses before it runs.

`hasStatus` cached a FALSE answer. Migrations here are pasted by hand into a
database the server is already connected to, so caching "the column is not
there" pinned it for the life of the process: run the migration, see no
change, with nothing on any screen saying a restart was what was needed. Only
a true answer is cached now, which is the rule `challanBook` already followed
and this file did not. The same trap would have bitten on the challan
migration this week.

**Verified.** `challan_book_check` extended with the round trip: a line saves
a product, `findById` gives the GST rate and the product back, both survive an
edit, and the same read works on a database where `product_id` is hidden.
Seven challan suites green. Rendered all three forms: the challan picker
filters as you type, excludes an Inactive product, and fills HSN 5208, rate 72
and GST 5 on a pick; the purchase picker fills HSN 5515 and GST 12 and leaves
the rate empty.

**Migration to run:** none.

---

## 18 Sept: the stock ledger, and a credit limit that is no longer a lie

Asked for straight off the 18 Sept survey: "do this one and the other stuff
that can be easily done".

**Nothing in the khata moved stock before this.** `supplier_inventory.stock`
was written in exactly two files, both on the marketplace order path. A sale
did not lower it, a purchase did not raise it, and a challan did not touch it,
so the figure meant nothing to a wholesaler working from the sales book.

`stock_ledger` is a LEDGER, not a counter. Quantity on hand is the SUM of its
rows. A stored number written from six documents is how a figure drifts with
nothing to say which write was wrong, and this product already had one of
those. Every row names the document that caused it, so the register answers
not just what the figure is but why.

**The two numbers are kept apart, on purpose.** `supplier_inventory.stock` is
what he OFFERS on the shop page, a reservation the marketplace decrements when
an order is placed. The ledger is his own book stock. The Stock screen shows
both side by side under "In your book" and "On your shop page" and explains
the difference at the bottom, because a trader seeing two numbers for the same
cloth will otherwise assume one is broken.

**The double counting problem, which is the whole difficulty.** Goods leave on
a sale challan and the bill is raised from that challan afterwards. If both
move stock the goods leave twice, and each row looks correct on its own. Tally
ties the two together with a Tracking Number; the same idea here is
`sale_lines.from_challan_id`. The challan moves the goods. The bill raised
from it moves nothing. A line typed straight onto a bill has no challan and
moves the goods itself. The client had tracked this per line since the challan
rework and simply never sent it.

Who writes to it: sale (out), purchase (in), sale challan (out), purchase
challan (in), and a reversing row on any cancel. Orders need no hook of their
own, because accepting an order writes a sale and that sale moves the stock
through the ordinary path. A hook here would double count for the same reason
as above.

**Reversal, never deletion.** Cancelling writes an opposite row pointing at
the one it undoes. A cancelled document still happened and the register says
so, greyed rather than hidden. Reversing twice is a no op, because cancel is
exactly the button somebody presses twice on a slow connection.

Two transactions had to grow to take this. `saleController.updateSaleStatus`
was a bare `pool.query` and could stay one while cancelling moved only a
status; it cannot now, because a cancel that marked the sale dead and then
failed to give the goods back would leave stock permanently short.
`challanBook.cancel` was the same.

**The credit limit stops being a lie.** `parties.credit_limit` has existed
since the opening balance migration, has been importable all along, and was
read by no controller anywhere: a field that looked like a control and was
not. It now warns, and deliberately does not block. Marg and Busy both offer a
hard block, and both are entered at the counter BEFORE the goods move, which
is the case where a block means something. Here the wholesaler is writing down
a sale whose goods have already gone, and refusing it would not undo the sale,
it would only leave the sale missing from the khata. There is a box for it on
the customer form now too, since there was none.

**Verified.** `stock_check.js`, a new suite, 30 checks. The one that matters
is billing a challan and asserting the figure does NOT move again: 50, not 30,
and three ledger rows rather than four. Also the purchase direction, editing a
challan down from 20 to 15 giving 5 back rather than sending 15 out again,
cancelling twice, and the whole thing running on a database where the ledger
table is hidden. **37 of 37 suites green** on databases rebuilt from the
migrations. Migration checked against a semicolon splitter, both on a database
that had it and one that did not.

Rendered the Stock screen, which caught a bug lint and the build both missed:
the `Boxes` icon was used in the nav and never imported, so every seller screen
threw `Boxes is not defined`. The guard in my own edit script had matched the
line it had just written. Nothing but rendering would have found it.

**Migration to run:** `wholesale3_stock_ledger.sql`

---

## 18 Sept: the day book, and what you owe by age

Two more off the survey, both cheap because everything they need already
existed.

**The day book.** Marg has Day Book, Tally and Busy have the same screen, and
this product made a wholesaler open six to answer "what did we actually do
today". One list now: sales, purchases, money in, money out, bills and both
kinds of challan, newest first, with presets for today, yesterday, 7 days and
30 days.

READS ONLY, and that is the point. Every row already exists on some other
screen and links back to it. A day book that computed anything of its own
could disagree with the screen the entry came from.

Money in and money out are shown apart and never netted. A day with a lakh in
and a lakh out is not a quiet day, and one figure would say it was.

Built as separate SELECTs unioned rather than one clever query. They have
genuinely different shapes, and forcing them together is how a join quietly
multiplies rows when a sale has two payments against it. Tables a database may
not have yet are left OUT by a probe rather than guarded in SQL, because
Postgres parses the whole statement before running any of it: naming
`purchases` is enough to fail on a database without them, whatever the WHERE
says.

**What you owe, by age.** The ageing report has existed since the invoice work
and reads the `invoices` table, which is the sales side. So a wholesaler could
see what his customers owed him by age and had nothing at all for what he owed
his mills, which is the one that gets a trader into trouble. Same buckets as
the receivable side so the two read the same way round, dated from the
SUPPLIER's own bill date where there is one, because that is when his credit
period starts.

**Verified.** Both endpoints driven against a real database with real rows
from the stock suite: 14 entries across four kinds, the cancelled sale listed
but correctly left out of the sold total, and the payable ageing agreeing with
the two open purchases at 33,600. Both screens rendered. 37 of 37 suites
green.

**Migration to run:** none. Both read tables that already exist.

---

## 18 Sept: a new challan claimed a debt it did not have

Reported from the running app: "when i created challan, push some sale and
then made challan again, it showed not billed while the earlier challan showed
billed, and the new unbilled challan showed wrong due money".

Reproduced by driving the exact sequence. Both halves were real, and both came
from reading the wrong column on the CHALLAN LIST. The detail screen and the
PDF had been fixed on 17 Sept; the list was never touched.

**1. Every challan showed its whole value as a debt.** The row worked out
`total_value - amount_paid` and printed it as "due". On a movement challan
`amount_paid` is always zero, so a brand new challan for 400 rupees of cloth
printed "400 due" on a document whose entire point is that nothing is owed
until the bill. A challan carries no GST and never touches the party balance.

Worse: `challanBook.list` did not SELECT `amount_paid` at all. The subtraction
was `total - undefined` on every row, so the figure could not have been right
even for the old payment-driven challans it was written for.

**2. A challan billed by a SALE still printed a due.** The badge tested
`status === 'billed' || invoice_id || purchase_id` and was right. The due
beside it tested only `!invoice_id && !purchase_id`. A challan billed through a
sale gets `status = 'billed'` and a `sale_id` and NEVER an `invoice_id`, so it
printed a due in clay directly under its own green "Billed" badge. The comment
sitting above that line claimed this had already been fixed.

Fixed by the same rule the detail screen and the PDF use: only a challan that
genuinely RECEIVED money has anything to say, and what it says is worded as a
snapshot, "250 owing then", not a live balance. `amount_paid` is now selected
by both list queries so the test is a real test.

**The same fault was found on two more screens by sweeping for it.**
`SaleDetail` and `SellerOrderDetail` both showed their Billed badge on
`c.invoice_id` alone, so a challan closed by the very sale it was sitting on
showed no badge at all. `listForSale` and `listForOrder` did not return
`status`; they do now, probed, as separate SQL strings.

**Verified.** Reproduced before and after: the old code printed "400 due" on
the new challan and "1000 due" under the billed one, the new code prints
nothing for either, and a genuine part-paid challan still shows "250 owing
then" so the fix did not simply delete the figure. Pinned with new assertions
in `challan_book_check`. 37 of 37 suites green.

**Also, alignment.** The day book sized each kind badge to its own text, so
"Sale", "Money in" and "Sale challan" started their party names at three
different places and the list read as ragged. The badge now sits in a fixed
width column, so every name lines up.

**Migration to run:** none.

---

## 18 Sept: stock on the product screens, and the box that was never there

Asked: "where is the stock option showing in product page? i dont see it there
should we make it there? and when creating new product should we enter stock
there ourselves too?"

Both answers were no, and the second one was a bug.

**The Add product form had no stock box at all.** `formData` carried a `stock`
key, the form never asked for it, and line 230 sent `Number(formData.stock)`,
which for an empty string is ZERO. So every product ever added through that
screen was created holding nothing, silently. Nobody would have noticed,
because until yesterday the figure was not used for anything.

**And the product list never showed stock.** It lived on its own screen only,
which is not where a wholesaler looks for it.

Fixed:
- a "How much do you have now" box on the product form, beside the rate.
- the product list shows "145 mtr in your book" under each name, linking to
  the Stock screen. Only where the ledger has something to say, so a
  wholesaler who does not count stock sees nothing rather than a zero that
  reads as a claim.

**The figure does TWO things, and they are deliberately not the same thing.**
It sets `supplier_inventory.stock`, what the shop page offers, and it writes
an `opening` row to the stock ledger, where his book starts counting. The
migration already had `'opening'` in its document_kind list for this.

Without the ledger half the Stock screen would show nothing until his first
sale and then show a NEGATIVE, because goods would be leaving a book that
never recorded them arriving. That is checked: adding at 500 and selling 30
leaves 470, not minus 30.

One transaction, because an opening figure is not decoration. A listing that
committed without its ledger row would leave the book short from day one with
nothing on any screen saying why.

A product added with no stock writes NO row, so somebody who does not count
stock is not handed a zero he never claimed.

**Verified.** Driven against a real database, then pinned in `stock_check`.
Both screens rendered. 37 of 37 suites green.

**Migration to run:** none beyond `wholesale3_stock_ledger.sql`, already
listed.

---

## 18 Sept: an outside audit, checked claim by claim

An audit report was handed over listing 13 findings. Every one was checked
against the code rather than taken on trust. **Twelve were real, three of them
bugs introduced by this session's own stock ledger work, and one was
overclaimed.**

**The overclaim.** The checkout `remainingAmount` finding was right that there
is a bug and wrong about what it is. The second use of that figure IS
correctly gated by a ternary. The real fault is that the 50/50 OPTION CARD is
always on screen and printed variables that fall back to the whole subtotal
when "full" is selected, so it advertised "Pay 50% Now 10,000, Remaining 50%
10,000" on a 10,000 order: the card misdescribed the plan it was offering and
its two halves came to twice the order. Fixed by computing the halves from the
subtotal unconditionally, which the proposed fix would not have done.

One other item, "credit limit never displayed on RecordSale", was already
stale: that warning was built earlier the same day.

**Fixed, in the order they matter:**

*The payment screen could kill a paid order.* Leaving the QR view called
`markPaymentFailed` on unmount, and `payment_failed` is terminal, so an order
could never be paid again. Payments here are self declared: the buyer scans in
their UPI app and comes back to press the button, so a back tap killed an
order whose money may already have gone. There is no safe client side version
of this, because the browser cannot tell "changed their mind" from "switched
to GPay and is coming back", and the one it guesses wrong is unrecoverable.
The unmount hook is gone. The explicit back BUTTON still cancels, which is a
person deciding rather than a lifecycle event.

*Deleting a listing was broken in both directions at once.* The query tested
`status NOT IN ('Delivered','Cancelled')` against data the CHECK constraint
proves is lowercase, so every delivered order counted as active and blocked
the delete for ever. And it read `orders.inventory_item_id` only, so a live
CART order did not protect the listing at all. `order_items` has NO foreign
key to `supplier_inventory`, which was checked: a cart-only listing would have
been hard deleted, orphaning the order history. That is worse than the report
said.

*Three of my own ledger bugs.* Free typed lines collapsed into one bucket
because the GROUP BY named only `product_id`, and my comment claimed
otherwise. Shop orders moved no book stock at all, because `orderSaleService`
writes its own SQL rather than going through `saleController`, and my header
comment claimed the opposite. Manual stock edits wrote no row. All three fixed
and both false comments corrected.

The manual edit fix needed a second pass. Writing the delta of
`supplier_inventory.stock` was wrong, because that column is the shop offer
and the two numbers are deliberately allowed to differ: correcting a count to
400 would have left the book at 370. The adjustment now moves the BOOK to the
figure typed, so counting the shelf leaves the book agreeing with the shelf.

*Credit notes did not reduce what a customer owed.* A note had its own number
and its own PDF and changed no figure anywhere, so a customer who returned
fifty thousand rupees of cloth still showed as owing it, on his page, on the
dashboard and on the statement asking him to pay. Now subtracted, and listed
on the statement as its own kind.

ONLY where the bill it reverses is still standing. `flow_check` caught the
first attempt ending at minus 1420 on an account that should close at zero: a
cancelled sale has already left the billed sum, so subtracting its note as
well takes the same money off twice. The suite earned its keep.

*The statement ignored the opening balance*, so a customer carried over from
an old ledger got one short by whatever he arrived owing, disagreeing with his
own page.

*Payable ageing ignored on account payments.* It joined on `sp.purchase_id`,
and in this trade most money to a mill is a round lumpsum against the account
with no bill named, all of which carry NULL. Untagged money is now applied
oldest bill first, which is what both sides assume when they reconcile.

*Smaller ones:* the day book now lists credit notes and its payment rows link
to the party account instead of nowhere; the platform master screen gained
cards for Tax terms and Platform settings, whose pages existed with nothing
linking to them; the customer page shows the credit limit beside the balance
it limits, flagged in red when past it.

**Not done, and deliberately:** debit notes, supplier statements, transporter
and broker masters, multi godown and GSTR-1 JSON. All are real gaps, all are
on ROADMAP.md, and none is a bug.

**Verified.** 37 of 37 suites green. Six of the fixes are pinned with new
assertions in `stock_check`, including the two that are easy to get subtly
wrong: the adjustment moving the book rather than the offer, and on account
money reducing the ageing.

**Migration to run:** none.

---

## 19 Sept: orders taken by hand, cards on challans, a proper invoice register

The first three off the 19 Sept design. The research and the corrections that
shaped it are in ROADMAP.md.

**An order can be typed.** Everything on the Orders screen had arrived from
the shop page, so a wholesaler whose customer rang up had nowhere to put it.
`POST /api/orders/manual` and a Take an order screen.

An order is a PROMISE, and the screen says so by what it does not have. It
writes no sale, moves no stock, touches no balance and shows no money box,
because all three of those start when the goods go and the bill is raised. An
order that also moved the khata would count every sale twice, once when it was
promised and again when it was billed. No GST either: what the customer is
charged is settled on the bill, and a tax figure printed on a promise is one
somebody will quote back.

**Orders have their own run of numbers**, `SO/1/26-27`. They were numbered
`ORD-<timestamp>-<8 chars of the buyer id>` in the controller, which is unique
and is not a series: unreadable over a phone, never restarting on 1 April, and
giving no hint that two orders are consecutive. Every other document here
already had one. In Tally a sales order is its own voucher type for exactly
this reason.

**Two things were found while building it.**

The seller's order list INNER joined `users` on `buyer_id`. A manual order has
no buyer user at all, so every one of them would have been invisible on the
screen that is supposed to list them. Now a LEFT join, falling back to the
party's own name.

And `orderController.js` replaces `module.exports` wholesale part way down, so
the new handler appended below it was assigned to a dead alias and the route
resolved to undefined. Assigned onto `module.exports` directly, with a note,
because the next person appending to that file will hit the same thing.

**Cards on the Challans screen**, per kind, because sale challans and purchase
challans are two jobs usually done by two different people and a blended
figure helps neither. Waiting to be billed, with the VALUE of the goods
exposed; open over a week, which is the one that costs money; billed; today.
Built on the principle that a screen somebody lives on all day has to answer
its own questions rather than sending them to the Overview.

**The invoice register, the way Marg and Busy show one.** Date first, because
a register is read down the date column and a wholesaler looking for "the bill
I raised on the 4th" was scanning the third. Then the number, the customer
with their GSTIN, and the tax SPLIT as its own columns, because CGST, SGST and
IGST are what get copied onto the return and one combined figure has to be
taken apart by hand. A nil tax prints as a dash rather than 0.00, since every
interstate bill has two nil columns and a page of zeroes hides the real
figures.

And column totals at the foot, which is the part that makes it a register
rather than a list. Summed from the rows ON SCREEN rather than asked of the
server, because that is the only total that cannot disagree with what is
printed above it. Cancelled bills are listed but left out of the total: the
number is spent, the money is not real.

**Verified.** The manual order driven against a real database: numbered in its
own run, consecutive, marked manual, no buyer, no sale, no stock, refused on a
zero quantity, and both orders visible on the seller list. 37 of 37 suites
green. All three screens rendered, and the register's footer checked against
the rows: 58,000 taxable and 60,900 total with the cancelled bill correctly
excluded.

**Migration to run:** `wholesale3_order_sequences.sql`

---

## 19 Sept: shipping raises the bill, and one run of order numbers

Both of the changes that needed a yes, plus the four things asked for while
they were being built.

**Shipping an order raises the tax invoice**, in `services/shipOrder.js`.
s.31(1)(a) puts the invoice before or at REMOVAL, and shipping is removal, so
this is the step that ties order, sale, invoice and challan together. A Rule
55 challan is the exception and has to be ASKED for: the wholesaler picks a
reason, and silence means an ordinary supply and an ordinary bill. The
opposite default was this product's 17 Sept mistake and is not being repeated.

Every step is idempotent, so shipping twice cannot bill twice. Checked:
one invoice, and the stock does not move again.

**The invoice creates the sale**, in the sense that mattered. Rather than
inverting the spine, shipping ensures a sale exists and raises the bill from
it, so a manual order that never went through the acceptance hook still ends
with one sale, one invoice, and both pointing at each other.

**Partial closure** writes `order_items.quantity_billed`, so a part shipment
is a measurable state rather than a flag. Tally closes a sales order fully
when completely billed and partially otherwise, which is what part shipment in
this trade needs.

**A manual order starts at `supplier_accepted`.** The lifecycle sends
`pending` only to `payment_pending`, because on the marketplace a buyer pays
before the wholesaler sees the order. Here the wholesaler wrote it down
himself, so it IS accepted, and starting it there puts it on the ordinary
spine with no new transition invented.

### A deadlock that would have reached production

`invoiceRepository.ensureSchema()`, called without a client, runs its DDL on a
POOL connection. That is a different connection from whatever transaction the
caller has open. `CREATE EXTENSION IF NOT EXISTS pgcrypto` takes heavy locks,
the open transaction holds conflicting ones, and the two wait on each other
for ever. No error, no timeout: the request simply never returns.

`schemaEnsured` is per process, so it only ever bit the FIRST invoice raised
from inside a transaction after a restart, which is the kind of fault that
survives every test and then happens to a customer. Found because the new ship
path is the first thing in this codebase to raise an invoice inside a
transaction on a fresh process.

It now probes for the table first and returns. The migrations own this schema,
so on a migrated database nothing is built at all.

### One run of order numbers, which was the right correction

Asked: "i dont like the new id of manual order, its diff than that of regular
order, shouldnt we show the old type order id instead?"

Right that they must match, and the fix runs the other way. A shop order and
one taken on the phone are the SAME document entered two ways, so they are one
voucher type and take one series. But `ORD-<timestamp>-<8 chars of the buyer
id>` is not a series at all: unreadable aloud, never restarting on 1 April,
and giving no hint two orders are consecutive. So both draw on `SO/n/FY` now.
Orders already numbered the old way keep their numbers, because a number read
out to a customer cannot be restated.

**That broke something, and the suite caught it.** `order_number` had a
PLATFORM WIDE unique index, which the timestamp satisfied by accident. A real
series restarts at 1 for every wholesaler, so the second wholesaler's first
order was refused outright. `phase2_check` failed with "duplicate key value
violates unique constraint". The index is now per wholesaler, which is what a
series means.

### The other four

**A manual order carries the same particulars as a shop one:** where the goods
go, who to ring, and the customer's own reference, prefilled from their record
and typed over freely because goods often go to a godown or a transporter.
Without them the detail screen rendered blanks.

**The detail screen stopped depending on a buyer user.** It read the customer
from `users` through `buyer_id` and the goods through a single
`inventory_item_id`, both null on a manual order, so the page showed nothing
where the customer and the goods belong. Now falls back to the party and to
`order_items`, and finds the wholesaler through `orders.supplier_id` rather
than only through the listing.

**Stock movements are signed and coloured.** Goods in are green with a plus,
out red with a minus, so a purchase is recognisable without reading which
column it landed in.

**The page no longer jumps when a scrollbar appears.** `scrollbar-gutter:
stable` on the root element reserves the space whether or not the bar is
drawn. It replaces the old trick of forcing `overflow-y: scroll` everywhere,
which left a dead grey bar on short pages.

**Verified.** `ship_check.js` is new: the spine from taken to shipped, the
bill and the sale it raised, 40 metres leaving the book, the line marked
billed, shipping twice not billing twice, and a Rule 55 reason producing a
challan and no invoice. **38 of 38 suites green.**

**Migration to run:** `wholesale3_order_number_per_owner.sql`

---

## 19 Sept: a pending order with nowhere to go, and an empty day book

Two reports, both real.

**An order left at `pending` was stranded.** The lifecycle had `pending`
going only to `payment_pending` or `cancelled`, so a seller looking at one
had no Accept button and no way forward at all. Manual orders are written in
as `supplier_accepted` and never sit there, but every order taken before that
was built does, and so does any shop order whose buyer walked away from the
payment screen. Fixed at both ends: `orderStatusService` now allows
`pending -> supplier_accepted`, and `client/src/utils/orderStatus.js` offers
"Accept order" as the next step from `pending`, which is what it already
offered from `payment_completed`.

**The day book showed nothing, and orders were the reason.** It listed
sales, payments, purchases, bills, credit notes and challans, and not orders.
So on a day spent taking orders, which is most of what the manual order work
was for, the screen said "Nothing on these days" and was telling the truth
about the wrong question. Tally's Day Book and Marg's both list every voucher
of the day, order vouchers included. Orders are now a row, linking to the
order, and are deliberately left OUT of the four money figures: an order is a
promise, and counting it beside the sale under it would say the same goods
twice. Verified: a day whose only activity is one typed order now has a row,
and after shipping it, Sold still reads 4,000 once and not 8,000.

**A second fault found while looking, not reported.** The credit note branch
added on 18 Sept was the only one of the seven not behind a schema probe. On
a database without `credit_notes` the WHOLE day book returned 500, because
Postgres parses a statement before it runs any of it, so one missing table
loses the other six sources with it. That is the exact trap the comment at
the top of the file warns about and it was walked into anyway. Now guarded by
`has_credit_notes`, with a suite that drops the table and asks again.

**Raw statuses in the list.** An order row read `supplier_accepted`, an
underscore and a machine word on a screen for traders. Every status now goes
through `formatOrderStatus`, and payment methods through a small map so a row
says UPI rather than "Upi".

**A stale assertion in `smoke.js`**, failing since 17 Sept and nothing to do
with either report. It branched on whether the challan tables existed to
decide whether a part paid sale may be billed. That stopped being the
question when `CHALLAN_WHEN_UNPAID` was defaulted OFF: what decides it is the
flag, and with the flag off the bill is raised at removal, as section 31(1)
requires. It now branches on the flag, and passes both ways.

**Verified.** `daybook_check.js` is new: a day whose only activity is an
order, that order shipped so the bill and the sale sit beside it without
double counting, and a database with the credit note table dropped. The day
book itself was rendered in a browser against a mock, which is how the raw
`supplier_accepted` was spotted. **41 of 41 suites green**, smoke passing
both with and without `CHALLAN_WHEN_UNPAID`.

**No migration.** Nothing here adds a column.

---

## 24 Sept: the server would not start, and marketplace accounts made to fit

Reported: "the server isn't working on Render" after a commit to `main` on
22 Sept, `add multiple marketplace linkages with independent series numbers`.

**Why it would not start.** `routes/marketplaceLinkageRoutes.js` imported
`requireBusiness` from `middlewares/businessContext`, which exports no such
thing. `router.use(undefined)` throws at require time, so the whole app died
before it listened on a port. Every route was down, not just the new ones.
Reproduced locally with `node -e "require('./src/app')"`: `TypeError: argument
handler is required`. Render's own logs were not looked at, since this session
cannot reach them, so this is the cause the code shows rather than one read
off the host.

**A second break was hiding behind it.** With the boot fixed, on a database
where the new migration had not been run, which is how Neon sits until
somebody runs it, taking an order by hand returned 500 and accepting an order
wrote no sale. The new lookup for an account tried the missing table INSIDE the
order's transaction, caught the error, and carried on, but Postgres had
already aborted the transaction: every statement after it failed with "current
transaction is aborted". `ship_check` against an unmigrated database showed it
at once. Catching an error inside a transaction does not un-abort it. Probes
now ask `to_regclass` first, which cannot fail.

**What was kept.** The idea is right and is now built properly: a wholesaler
with two Amazon seller accounts gets two settlement reports, and each has to be
matched against its own run of bills. So an extra account is one more book,
with its own prefix and its own counter in `invoice_sequences`, which was
already keyed by series. The built in Amazon and Flipkart books are the first
account on each and do not change.

**What was taken back out, and why.**

- *A run of ORDER numbers per account.* Orders were put on one run on 19 Sept,
  on request, because a phone order and a shop order are the same document.
  The new code gave each channel its own counter but printed `SO/` on all of
  them, so a shop order and a phone order could both be `SO/1/26-27`. Orders
  now carry a channel, which decides the run their BILL takes, and every order
  is still numbered on the one `SO/` run.
- *A run of SALE numbers per account.* A sale number is the wholesaler's own
  reference, not a GST document, so Rule 46(b) asks nothing of it. Shop sales
  had also quietly moved from `S/` to a new `S-SA/` run.
- *A suffix and padding per account.* The built in Amazon and Flipkart books
  follow the wholesaler's own number format. Extra accounts now do too, so one
  screen decides what every bill looks like.
- *The typed "channel identifier".* The code a sale stores is made by the
  server, `amazon-2`, `amazon-3`, because it can never change once anything is
  filed under it and nobody should have to invent one.
- *Delete that silently paused instead.* Remove now removes, and only an
  account with nothing in it. One with sales or bills is refused with the
  reason and can be paused.
- *The mock database suite.* It passed against an in memory stand in while the
  real server could not boot. Replaced, see below.

**Found while rebuilding, and fixed.**

- A paused account's sales could not be billed into its own run. The lookup
  read active accounts only, fell back to the counter's prefix, and opened a
  fresh counter for it: a second `OM/1/26-27`. Paused accounts now still own
  their run. They take no new sales, and the forms leave them out, except on a
  sale already filed under one, so saving an edit does not move it to the
  counter.
- Nothing stopped two books sharing a prefix, which is the same bill number
  twice. An account's prefix is refused if it equals, or begins, or is begun
  by, the built in books' (`SA/`, `FK/`, `AZ/`), the wholesaler's own, or
  another account's. The invoice settings screen checks the same thing when
  the wholesaler's own prefix changes.
- An account's prefix is fixed once a bill has gone out on it.
- A typed order from the phone defaulted to "This shop" on the new form. It is
  the counter now, which is what every typed order was before.
- The sale written when a shop order is accepted is now filed under `shop`,
  matching the bill raised at payment, which was always `shop`. It used to take
  the column default, `counter`.

**Where it lives.** "Selling on Amazon or Flipkart" on the bill numbering
screen, `/seller/invoices/settings`, since bill numbers are all it changes.
The sale, order and bill forms pick accounts up through `/api/masters`, which
now returns each wholesaler's own. Routes are `/api/marketplace-accounts`,
behind the `settings` permission. The table keeps the name
`marketplace_linkages` so a database that ran the 22 Sept file is not left
with an orphan.

**The migration was rewritten, not added to**, because it may or may not have
been run. It is safe either way and twice over: it drops the sale and order
series columns if present, keeping the highest counter per year so the next
number is past every number already issued, and puts the one-run keys back.
Tested split on semicolons, the way the Neon editor runs it, against a
database that never saw the old version and one that did, twice each. That
test caught a semicolon in a comment in the first draft, exactly the trap
CLAUDE.md describes.

**Verified.** `scripts/marketplace_account_check.js`, 61 checks, against a
migrated database and, in a child process, an unmigrated one. 38 of the other
41 suites green against a fresh migrated database. The three that fail do so
identically on the code as it was before today and for reasons outside this
work: `challan_book_check` needs `pdftotext`, `master_settings_check` and
`party_state_check` expect extra named databases. 13 of the main suites also
green against an UNMIGRATED database, which is what production is right now.
The real server booted and served the new routes over HTTP, and the settings
card, the modal refusing a clashing prefix, and the order form were rendered
in a browser at desktop and phone width.

**Not done.** The import still accepts only the four built in books in its
channel column, not an extra account. Nothing is pulled from Amazon or
Flipkart, as before.

**Migration to run:** `wholesale3_marketplace_linkages.sql`. Until it is run
nothing changes: the settings card says adding accounts is not switched on,
and filing a typed order under a marketplace is a 503.

---

## Left to do

Roughly in the order agreed. `ROADMAP.md` has the full list, in phases.

Items 1 to 4 were done on 10 Sept, see above.

1. **Mobile OTP.** Deferred. There is no genuinely free SMS OTP in India that
   we know of; every gateway charges per message.
2. **e-Way Bill against the free sandbox**, once the GSP question below is
   settled. It is the one GST integration worth doing, see the note.
3. **Rewrite the git history** to take out the committed password and the
   invoice PDF. The Neon credential in git is already rotated, the one pasted
   into chat on 14 Sept is not. Needs a moment when nobody else is pushing,
   because it changes every commit hash.

The invented demo products on the home page and the 4.5 star rating that search
used to invent were both dealt with on 14 Sept and are no longer on this list.

### GST APIs, looked into 4 Sept

Answering "is there a free one we can test against". There is, for both.

**e-Way Bill is the one worth doing.** GSTN runs a free pre-production sandbox;
credentials come by emailing `ewaybill.api.helpdesk@gmail.com` from a GST
registered address. It applies to any consignment over ₹50,000 regardless of
turnover, which is a wholesaler's ordinary week, so it is relevant to the people
actually using this.

**e-Invoice can wait.** NIC's sandbox at `einv-apisandbox.nic.in` is free and
self-registration, but e-invoicing is only mandatory above ₹5 crore annual
turnover. Most of our sellers are below that, so it would be compliance nobody
on the platform needs. Revisit when we go after larger sellers.

Faster to prototype against: WhiteBooks, Masters India and sandbox.co.in hand
out free sandbox keys instantly rather than by email. Production is paid and
couples us to that provider, so keep any integration behind an interface.

**Settle this before writing code.** Both official sandboxes assume one taxpayer
testing his own ERP. A platform raising e-way bills for hundreds of different
wholesalers cannot use one set of credentials: either each seller enrols his own
API access and we hold his credentials, or we sign with a GSP licensed to act
for many taxpayers. That is a commercial decision and it shapes the schema.

---

## Known problems, not yet fixed

## Testing

Forty two suites in `server/scripts/*_check.js`. They drive the real
controllers against a local Postgres, so they catch schema drift that reading
the code does not.

Three of them are worth knowing by name, because they are the ones that find
things the others cannot:

- `flow_check.js` walks one order the whole way and checks after every step
  that the khata, the Overview, the statement, the order and the sale agree
  with each other. Cross-screen disagreement is the failure mode this codebase
  actually has, and a suite that leans on one seam will never see it.
- `challan_matrix_check.js` walks the grid rather than the story: every status
  against every settlement state, and the order lifecycle driven through the
  CONTROLLER rather than the service. Two faults hid in exactly that gap.
- `credit_check.js` covers a customer's money being held and then spent.
- `export_check.js` puts two wholesalers in one database and asks one of them
  for his export. Everything else in the product leaks a row onto a screen when
  the scope is wrong. This one leaks a whole book into a file somebody keeps.
- `import_check.js` is the same two wholesalers with the file going the other
  way, which is worse, because this side writes. The checks that matter are
  that the same file sent twice writes nothing the second time, and that a
  failure partway through leaves not one row behind.
- `transport_check.js` posts what a BROWSER posts, empty strings and all. It
  exists because a suite that omits an optional field tests undefined, and a
  form sends "". That gap refused every sale with the transport section on
  screen.

**Drive the route the screens use, not the service behind it.** Both faults
found on 11 Sept had a passing suite standing next to them, because the suite
asked `orderStatusService` and the button asks `PATCH /orders/:id/status`.

```bash
# once
su postgres -c "initdb -D /var/tmp/pgt/data"        # see CLAUDE.md for why
createdb qa0

# src/config/db.js hardcodes ssl, which a local server does not offer, and the
# connection string is the one place that overrides it. Without sslmode=disable
# the run stops at "The server does not support SSL connections".
DATABASE_URL="postgres://postgres@127.0.0.1:5433/qa0?sslmode=disable" npm run migrate

# each suite takes a database name
node scripts/overview_check.js qa_overview
```

Build every database from the migrations, never by hand. Two real bugs were
found the week the hand built stub was replaced, both of them constraints the
stub did not have.

For UI work, render it. A mock API on port 5000 plus `npx vite --port 5174`
and Playwright at `/opt/pw-browsers/chromium`. Screenshotting has caught a
clipped tab, quantities printed as "10.000", a credit printed as "Rs.-2,000.00"
and cards half empty on a phone. None of those were visible in the code.
