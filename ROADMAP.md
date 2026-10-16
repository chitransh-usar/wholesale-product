# What we are building next

Agreed 15 Sept 2026. Nine items. Work started 16 Sept.

`PROGRESS.md` is the record of what HAS been built. This is the record of what
has been decided, and how much of it is done, so the two do not get mixed up.
Phases 0 to 8.5 are finished. Phase 9, the e-invoice payload, is next.

Read the assessment at the bottom before promising a date on any of this. Two
of these nine cannot be finished by writing code alone.

**Start here: the plan of work is at the bottom of this file, under THE PHASES.
One phase at a time, each finished and verified before the next starts. Above
it, THE FULL LIST OF WORK is the numbered inventory the phases draw from, and
the sections between those two are the reasoning behind each item.**

---

## Decisions taken, 15 Sept

Asked for and settled, so nobody re-opens them by accident.

**The master area is renamed "Administration"**, route `/admin`. Not "Platform
settings", which collides with the wholesaler's own Settings page at
`/seller/settings` and so recreates the confusion the rename exists to remove.
Not "Control panel", which reads consumer-ish.

**Turnover is skipped.** It was going to drive the 4/6/8 HSN digit rule, and
without it that rule cannot be turnover-driven. So for now the minimum HSN
digit count is a SETTING in Administration, default 4. That is honest: it does
not invent a turnover figure, and swapping it for the real rule later is a
one line change. Say so on the screen.

**Cess defaults to 12 per cent, PER ITEM, and this is a TEST DEFAULT THAT MUST
NOT SHIP.** Real cess is commodity specific: 12 per cent on some goods, 60 on
others, a flat 400 rupees a tonne on coal. A global 12 per cent on a live bill
is a wrong number on a legal document, which is the one thing this codebase
has a standing rule against. Mark it in the code where it is set.

**Series prefixes.** `PREFIX/26-27/00001` spends 12 characters before the
prefix, and Rule 46(b) allows 16, so the budget is 4. Two characters each,
for symmetry and headroom:

| Series | Number | Length |
|---|---|---|
| Manual sale | `SM/26-27/00001` | 14 |
| From a shop order | `SA/26-27/00001` | 14 |
| Flipkart | `FK/26-27/00001` | 14 |
| Amazon | `AZ/26-27/00001` | 14 |

Two spare characters each, so a six digit sequence still fits at 15. The
originally suggested `FLPKT` would have produced a 17 character number, which
is illegal.

---

## 1. Exporting a wholesaler's own data

Invoices, sales, purchases, customers, out to a ZIP or to Google Sheets.

**ZIP is straightforward.** CSV per table plus the invoice PDFs, streamed as a
zip. No new dependency is strictly needed, though `archiver` would save
writing a zip encoder. Wholly ours, no third party, no credentials.

**Google Sheets is not the same job.** It needs a Google Cloud project, OAuth
consent (and Google's review if this ships to real users), a per-wholesaler
token store, and refresh handling. The export itself is the easy part.

Recommendation: build ZIP first and ship it. Treat Sheets as its own piece of
work with its own decision about who owns the Google project.

One rule to hold: an export is the wholesaler's own data and must be scoped by
`businessId` exactly like every screen. An export endpoint that takes an id
from the query string is how one wholesaler reads another's book.

## 2. More on invoices, starting with state code

See item 9, which is the full list. State code specifically is nearly done
already: `placeOfSupply.stateCode()` returns the two digit code and the
invoice already stores `place_of_supply`. What is missing is printing it
beside the state on the PDF and the screen.

## 3. UQC, e-invoice and e-way bill compliance, HSN digit rules

**UQC** is a fixed list from the GST portal: NOS, KGS, MTR, PCS, BOX, BAG and
so on, about forty of them. The units master currently holds free text. This
becomes: a UQC column on the units master, seeded with the official list, and
the UQC rather than the typed unit is what goes on an e-invoice.

**HSN digits by turnover.** The rule as the user stated it: 8 digits ideally,
6 if turnover is above 5 crore, 4 below. The actual notification is close to
that and worth getting exactly right before coding:

  - aggregate turnover up to 5 crore: 4 digits on B2B, optional on B2C
  - above 5 crore: 6 digits
  - exports and imports: 8 digits regardless

So this needs a turnover figure on the wholesaler's profile, and validation
that reads it. `hsnService` already checks the shape is 4, 6 or 8; what it
does not do is require a minimum, because nothing told it the turnover.

**e-invoice and e-way bill are the two items that are not just code.** See the
assessment.

## 4. Rename the master area, and drop gendered language

"Platform master" and "master table" to something plainer. Candidates:
Platform settings, Control panel, Administration. Decide before starting,
because the word appears in routes, nav, page titles and several comments.

**Gender neutral throughout.** This is a bigger sweep than it looks. The
codebase refers to the wholesaler as "he" and "him" in a great many comments,
and some UI copy does too ("what he owed you", "he is holding your money").
Every one of those becomes "they" or is rewritten to address the reader
directly, which is usually better anyway: "what you owed them".

It is a real change, not cosmetic. Half this product's users will be women and
the copy currently assumes otherwise.

## 5. GST terms and ledgers in the master area

A row in the master area for tax heads, where entering IGST derives the rest:

    IGST = 18  ->  CGST = 9, SGST = 9

That relationship is already true in `gstService`, which splits the rate in
half for an intra-state sale. What is new is naming the combination so it can
be picked by name on a line rather than typed as a number.

**Cess**, at 12 per cent for now. Cess is an additional levy on top of GST on
particular goods, not a share of it, so it is a separate column on the line
and a separate total on the bill. It does not come out of the 18.

## 6. Separate number series per sales channel

One series for automatic sales, one for manual, one for Flipkart, one for
Amazon, each independent.

`invoice_sequences` and `seriesNumbers.js` already do per-wholesaler,
per-financial-year numbering. This adds a series key to that.

**Rule 46(b) is the constraint:** an invoice number is at most 16 characters,
alphanumeric with dash and slash only, unique within the financial year, and
consecutive within its series. Four series means four counters and four
prefixes that must all still fit in 16 characters. `FLPKT/26-27/00001` is 17.
Plan the prefixes against the limit before building.

## 7. Sales type from the GSTIN

If the first two digits of both GSTINs match it is intra-state, so CGST plus
SGST; if they differ it is IGST.

**This is already built and working.** `services/placeOfSupply.js` does
exactly this, and it is the only thing allowed to decide. Nothing further is
needed here unless the intent is to SHOW the decision on the sale screen,
which would be worth doing: a wholesaler seeing "IGST, because he is in
Maharashtra" can catch a wrong customer record before the bill goes out.

## 8. Transport details on invoices and sales

Transport number, transporter name, mode (air, water, road, rail), transporter
ID or GSTIN, vehicle number.

These are the e-way bill fields, which is why they matter beyond printing. Data
model plus form plus PDF. No third party needed for the fields themselves.

## 9. Everything else the invoice needs

- Seller name, address, city, state, state code, pincode
- Dispatch-from address, which is not always the seller's registered address
- Customer's registered address as per GST
- Shipping address, which is not always the registered one
- GR number and date
- HSN summary table, totalled by HSN and rate
- Seller's bank details
- IRN, acknowledgement number and the e-invoice QR code

Most of this is data and layout. The last line is not: see below.

---

# Can this be built? An honest assessment

**Seven of the nine are ordinary work.** Items 1 (ZIP), 2, 4, 5, 6, 7, 8 and
most of 9 are schema, forms, PDF layout and validation. They are large but
there is nothing in them this codebase has not done before, and every one can
be verified here against a local Postgres and a real browser.

**Two cannot be finished by writing code alone**, and it is better to say so
now than to discover it at the end.

### e-invoice: IRN, acknowledgement number, QR code

An IRN is not something this product can generate. It is issued by the
Invoice Registration Portal after the invoice JSON is submitted and accepted,
and the QR code on the bill is a signed payload the IRP returns. Nothing
computed locally is valid.

To submit, you need either:
  - direct NIC IRP access, which requires enrolment and is normally limited to
    taxpayers above the e-invoicing threshold, or
  - a GSP or ASP, such as ClearTax, Masters India or similar, with an API
    contract and per-client credentials

So the work splits cleanly:
  - **buildable here**: the e-invoice JSON schema, every field it demands,
    validation before submission, storage of IRN and ack number, printing the
    returned QR, and the whole retry and cancellation flow
  - **not buildable here**: proving any of it against the real IRP

That is the same position Razorpay Route is in, and it turned out fine: written
to the documented contract, tested against a stubbed transport, with the first
live call treated as the real test. I would do the same again and say so in
the same words.

### e-way bill API

Same shape. NIC's e-way bill API needs credentials tied to a GSTIN, and in
practice a GSP. The fields, the validation, the distance and validity rules
and the storage are all buildable. The live call is not, from here.

### The honest version of "can you do all this?"

Yes, with two qualifications:

1. **Not in one pass.** This is several weeks of work. Items 4, 5 and 6 touch
   tax arithmetic and document numbering, which are the two areas of this
   codebase where a mistake shows up on a legal document rather than on a
   screen. They want doing one at a time with the database tests this
   repository already has the habit of.

2. **Two of them end in somebody else's hands.** e-invoice and e-way bill can
   be complete in code and still not working, because they need an account,
   credentials and a GSP contract. Get that decision started early: it has a
   lead time, and it does not depend on any of the code being finished.

### The order I would do them in

Superseded. See THE PHASES at the foot of this file, which is the same
reasoning turned into a sequence, with one change: the rename and de-gender
sweep moved from last to first. It was put last because it touches nearly every
file and wants a quiet moment. But phases 4 and 6 add three new screens to the
master area, and renaming after they exist means building them under the old
name and then renaming them. Nothing was mid-flight, so the quiet moment was
already here.

Item 7 needs nothing built. Item 1's Google Sheets half is its own decision.

---

# THE FULL LIST OF WORK

Everything outstanding as of 15 Sept, in three groups: the agreed features, the
debt already found, and the things that need somebody other than a programmer.

Nothing below is started.

## A. The nine agreed items, as tasks

### Schema, five migrations

1. `invoices` and `invoice_items`: seller address block (address, city, state,
   state code, pincode), dispatch-from address, shipping address, GR number and
   date, bank details, transport block, IRN and acknowledgement number and
   signed QR, cess columns, UQC on each line.
2. `master_units` gains a `uqc` column, seeded with the official list of about
   forty codes from the GST portal.
3. `invoice_sequences` gains a `series` key. The unique constraint becomes
   (wholesaler, series, financial year).
4. A new `master_tax_terms` table for the IGST to CGST/SGST grouping.
5. `master_settings` gains the minimum HSN digit count.

Every one of these is hand-run against Neon. No semicolons in comments, no
DO blocks: see CLAUDE.md for why, it cost a debugging round already.

### Server

6. `seriesNumbers.js` allocates per series, and refuses at write time anything
   that would exceed 16 characters rather than discovering it on a bill.
7. `gstService` treats cess as an additional levy, NOT a share of the GST rate.
   18 per cent GST plus 12 per cent cess is 30 per cent of the taxable value,
   not 18 split three ways.
8. **Cess has to reach the money path, not just the bill.** `grand_total` is
   read by the 50/50 instalment split, by `canAcceptPayment`, by
   `reconcileInvoiceForOrder` and by the khata mirror. Miss one and the
   customer's balance and his bill disagree by exactly the cess. This is the
   same shape as the double-counting race that was fixed on 14 Sept, and it is
   the single most dangerous item on this list.
9. `hsnService` enforces the minimum digit setting.
10. HSN summary: `GROUP BY hsn_code, gst_percent` over `invoice_items`, which
    already carries both. Cheap. Needs a cess column added to the grouping.
11. **Freeze the new addresses onto the invoice, never join them.** Invoices
    already copy the recipient onto the row on purpose, so a tax document does
    not change when somebody edits a contact afterwards. Dispatch-from,
    ship-to, the seller block and the bank details must follow the same rule,
    or a reprint six months later shows an address the customer never signed
    for.
12. ZIP export: a CSV per table plus the invoice PDFs. Scoped by `businessId`
    exactly like every screen. An export endpoint that takes an id from the
    query string is how one wholesaler reads another's book.
13. e-invoice JSON builder and validator. Payload and validation only, no
    submission. See group C.

### Client

14. Invoice form: seller block, dispatch-from, ship-to, GR number and date,
    transport block.
15. Sale form: transport block, and a series picker.
16. Administration: UQC column on units, the tax terms screen, the HSN digit
    setting.
17. PDF: every new field, the HSN summary table, bank details, and a slot for
    the QR that stays empty until an IRN exists.
18. Show WHY a sale is IGST, in words, on the sale screen. "IGST, because they
    are in Maharashtra" lets somebody catch a wrong customer record before the
    bill goes out, which is the cheapest possible moment to catch it.

### One sweep, best done when nothing else is mid-flight

19. Rename the master area to Administration: routes, nav, page titles,
    comments.
20. Remove gendered language throughout. The codebase calls the wholesaler
    "he" and "him" in a great many comments, and some UI copy does too, such
    as "what he owed you" and "he is holding your money". Rewrite to "they",
    or better, address the reader directly: "what you owed them". Half this
    product's users will be women and the copy currently assumes otherwise.

## B. Debt already found, not on the nine

21. Three overlays still do not close on Escape: `CartDrawer`, which is a side
    drawer and needs its own handler rather than ModalShell, plus
    `components/invoice/PaymentHistory.jsx` and
    `components/invoice/InvoicePreview.jsx`, which are document views.
22. **`trust_score` and `response_rate` columns still exist** on
    `wholesaler_profiles`, defaulting to `'95%'` and `'98%'`. Nothing displays
    them any more, but they are live invented data waiting to be picked up by
    accident. Drop them.
23. Rewrite the git history to remove the committed password and the invoice
    PDF. Needs a moment when nobody else is pushing.
24. **Rotate the Neon password.** It was pasted into a chat transcript and a
    screenshot on 14 Sept.
25. No screen advances an order past `payment_completed`. The API is correct
    and nothing calls it.
26. `/api/dashboard/stats` is dead.
27. Seller-side discovery, "textile wholesalers in Surat", is not built.
28. `README.md` is still substantially out of date.
29. Mobile OTP: deferred, no genuinely free SMS gateway in India.
30. `PROGRESS.md` "Left to do" is stale: its items 3 and 4, the invented demo
    products and the 4.5 star rating, were both done on 14 Sept.

## C. Needs somebody other than a programmer

31. **The GSP decision, which shapes the schema.** Free sandboxes DO exist for
    both: NIC e-invoice at `einv-apisandbox.nic.in` by self-registration, and a
    GSTN e-way bill pre-production sandbox whose credentials come by email from
    a GST registered address. So these CAN be tested, just not from inside this
    development environment, which blocks outbound hosts.

    The real blocker is not the sandbox. Both official sandboxes assume ONE
    taxpayer testing his own ERP. A platform raising documents for hundreds of
    different wholesalers cannot use one set of credentials: either every
    seller enrols his own API access and we hold his credentials, or we sign
    with a GSP licensed to act for many taxpayers. That is a commercial
    decision, it has a lead time, it does not depend on any code being
    finished, and it changes the schema. Start it now.

32. Razorpay: `RAZORPAY_WEBHOOK_SECRET` is unset, so the webhook endpoint
    refuses every delivery by design. Route is not enabled on the account.
    Whether Partner access exists, for creating linked accounts by API rather
    than by hand in the dashboard, is unknown.

33. The `razorpay-integration` branch changes, described on 15 Sept, are still
    not pushed anywhere. Checked `razorpay-integration`, `main`, `rimjhim` and
    `ronak`: none has the state dropdown, the supplier and purchase
    repositioning, or the add-supplier button. They are local on one machine.

---

# THE PHASES

One phase at a time. A phase is finished when it is verified, not when it is
written, and nothing from the next phase starts until then. The numbers in
brackets are the items above.

Phases 0, 1 and most of 4 are already done, on the `sanskriti` branch, merged
here on 16 Sept. What is left starts at phase 2.

## How a phase ends

The same bar every time, so "done" is not a matter of opinion:

- `npx vite build` clean
- `npm run lint` at or below the 39 problem baseline, and no new problems
- every controller or repository touched is driven against a local Postgres
  with a real `req` and `res`, not read and reasoned about
- every screen touched is rendered at phone width and at desktop
- every migration is split on semicolons and run one statement at a time, then
  run a second time, because a hand applied file gets pasted twice
- `PROGRESS.md` updated in the same commit as the work
- the migration named explicitly in the closing message, because nothing here
  applies them for you

## Phase 0. Clear the ground. DONE

No feature code. Debt that every later phase would otherwise inherit, plus the
things only a person can do.

- [x] Escape closes the last three overlays (21)
- [x] `trust_score` and `response_rate` dropped, code and column (22).
      Migration: `drop_trust_score_and_response_rate.sql`
- [x] `/api/dashboard/stats` deleted (26)
- [ ] **Rotate the Neon password (24). Yours, not a programmer's.** It was
      pasted into a chat transcript and a screenshot on 14 Sept and is still
      live.
- [ ] **Start the GSP conversation (31). Yours.** The longest lead time on this
      whole plan. Phases 9 and 10 cannot finish without it and it changes the
      schema, so it starts here and not at phase 9.
- [ ] **Razorpay dashboard (32). Yours.** `RAZORPAY_WEBHOOK_SECRET` is unset so
      the webhook refuses every delivery by design, Route is not enabled, UPI
      needs turning on.
- [ ] Rewrite the git history to drop the committed password and the invoice
      PDF (23). Needs a moment when nobody else is pushing.

## Phase 1. Administration, and language. DONE

Moved to the front, not the back. Three new screens arrive in phases 4 and 6,
and renaming after they exist means building them twice.

- [x] Master area renamed Administration at `/admin`: routes, nav, titles,
      comments (19)
- [x] Gendered language removed throughout (20)

## Phase 2. The invoice data model, frozen. DONE

Write path only. No form, no PDF, nothing on screen. The point of doing it
alone was that the freezing could be proved before anything depends on it.

- [x] Migration: the whole invoice column set in one file (1). File:
      `wholesale3_invoice_document_block.sql`. Seller block, dispatch-from,
      ship-to, GR number and date, bank details, transport block, IRN and
      acknowledgement placeholders, cess columns, UQC per line. One file rather
      than five, because each hand applied migration is a round trip through
      you. The unused columns are nullable until the phase that fills them.
- [x] The seller block and bank details are copied onto the invoice at
      creation, inside `createInvoice` itself rather than at its three call
      sites, so a fourth caller cannot forget to take the snapshot (11)
- [x] The recipient's state and state code frozen on the sale path (11)
- [x] **Frozen. Never joined.** (11)

Proved by raising a bill, changing the firm name, GSTIN, address, state and
bank account it was copied from, and showing not one field on the bill moved,
while the next bill picked up all of it. Eighteen checks against a local
Postgres.

Two deliberate gaps. `parties` holds no pincode, so the recipient pincode stays
blank rather than being invented. `invoice_items.uqc` has no foreign key onto
`master_uqc`, because a frozen line must not be coupled to a table somebody can
edit.

## Phase 3. The invoice on screen and on paper. DONE

- [x] PDF: the seller block with its address, both addresses when they differ,
      GR number and date, the transport band, bank details, UQC beside each
      quantity, and an e-invoice block that appears only once an IRN exists (17)
- [x] The state code printed beside the state, on both sides of the bill (2)
- [x] Say WHY the tax split is what it is, in words, on the invoice screen (18)
- [x] The printed HSN summary had the same arithmetic fault as the SQL one and
      was overstating the taxable value on every tax inclusive bill. Fixed and
      it now ties to the total above it.
- [x] Invoice form: the new fields entered rather than only printed (14). A
      "Dispatch, delivery and transport" section, closed by default because
      most bills need none of it, plus a Unit picker on each line that carries
      the UQC. State codes are derived from the state name on the server, never
      typed: it is the number that decides CGST and SGST against IGST.

Rendered and looked at, not just written: a bill with every field filled in, a
bill with an IRN and a signed QR, and an old bill carrying none of them, which
still prints exactly as it did before.

The explanation of the tax split is shown only when the invoice actually
recorded both states it compared. Guessing at the reason would be worse than
saying nothing.

## Phase 4. UQC, HSN digits, HSN summary. DONE

- [x] Migration: `master_uqc` holding the official list, `master_units.uqc`
      with a foreign key onto it (2). File:
      `wholesale3_uqc_master_units.sql`
- [x] HSN summary grouped by HSN and rate, tying to the bill (10). No cess
      column yet, that arrives in phase 6.
- [x] Document numbers refused at write time if they break Rule 46(b), with a
      reason the wholesaler can act on
- [x] Administration: the UQC on the units screen (16, one of its three).
      Every unit lists the code it is filed as, or says "UQC not set", and the
      editor offers the statutory list as a dropdown. Blank is allowed and
      means nobody has decided.
- [x] Migration: minimum HSN digit count on `master_settings` (5). Already
      existed as `default_hsn_min_digits` in `wholesale3_master_settings.sql`,
      with a CHECK of 4, 6 or 8. No new migration was needed.
- [x] Administration: the HSN digit setting (16, its second). Already on the
      settings screen. It was being read and ignored.
- [x] `hsnService` enforces the minimum digit setting (9). It checked the shape
      and nothing else, so the setting had no effect anywhere. Enforced now on
      sales, purchases, products and manual invoices. The manual invoice path
      was not checking the HSN at all, so a bill could go out with a code the
      same product would have been refused for.

`checkHsn` stays pure and synchronous and takes the minimum as an argument.
The caller reads the setting once with `minHsnDigits()` before looping over
lines, rather than every line awaiting a cached read.

The units master leaves Case blank on purpose. Nothing is defaulted to OTH. The
Administration screen is where somebody decides the blanks and the decision is
recorded, which is why it says "not set" rather than filling it in quietly.

## Phase 5. Transport details. DONE

- [x] Transporter name, ID or GSTIN, mode, vehicle number, transport document
      number and date, on an INVOICE, entered and printed (8)
- [x] The same block on a SALE (15 in part), with its own columns rather than a
      join, because a sale often has no invoice yet and the vehicle number is
      only known at the moment the goods go out. Migration:
      `wholesale3_sale_transport.sql`
- [x] Carried onto the bill when one is raised from the sale, so it is typed
      once. Copied, not joined, so editing the sale later cannot change a bill
      already handed over.
- [x] Shown on the sale detail screen, and only when something was recorded.
- [x] The same block on an ORDER, stamped at despatch onto the order and onto
      the bill already raised from it, because a shop order is billed when it
      is placed and the lorry is not known until later. Migration:
      `wholesale3_order_transport.sql`
- [x] All three ways of raising an invoice compared field by field and made to
      agree. The order path froze no recipient at all and the manual path froze
      only the state, so a bill reprinted after a customer changed their firm
      name showed today's details on an old document.

One definition of the block on each side, `services/transportDetails.js` and
`components/TransportFields.jsx`, because two copies of eight fields is how one
screen starts offering a mode the other refuses.

## Phase 6. Tax terms and cess. DONE

The one where a mistake lands in somebody's ledger rather than on a screen.

- [x] Migration: `master_tax_terms`, plus cess columns on sale and purchase
      lines and totals. File: `wholesale3_tax_terms_and_cess.sql`
- [x] A named combination a line can be billed under. Entering the GST derives
      CGST and SGST as half each. They are NOT stored: two stored halves are
      two things that can disagree with the whole.
- [x] `gstService` treats cess as an additional levy on the same taxable value,
      never a share of the GST. 18 plus 12 is 30 per cent of the taxable value.
- [x] **Cess reaches the money path.** Proved, not assumed.
- [x] The tax terms screen in Administration
- [x] A cess column in the HSN summary, in SQL and on the PDF, with the taxable
      value corrected to the line total less BOTH levies
- [x] A cess line in the totals, on the PDF and in the preview

### How the money path was kept together

The audit came first. Every reader of a total was mapped before a line was
written, and it turned up the thing that would have broken this:

`orders.total_amount` is the CART GROSS, set at checkout, and never goes
through `gstService` at all. The bill for an order derives its tax out of that
same gross. So they agree by construction today. Add cess ON TOP for that path
and the buyer agrees X at checkout, the bill says X plus cess, and the khata
says X. Three figures, one order.

So cess follows the pricing mode exactly as the GST already does:

  - tax exclusive, a counter sale: the rate quoted is before tax, so every levy
    goes on top and the total grows
  - tax inclusive, a shop order: the shop price is what the customer pays, so
    the cess comes OUT of it beside the GST and the total does not move

That is what makes the path safe by construction rather than by remembering to
update a second place. `sales.total` grows because a counter rate is pre-tax,
and the khata and the bill both read through `gstService`, so they follow
automatically.

Verified against a local Postgres: the sale total, the customer's khata, the
invoice grand total and the invoice line all carry the same cess to the paisa,
a bill raised from the sale equals the sale, and a sale without cess is exactly
what it always was.

### The twelve per cent is a test default

`GST28_CESS12` is seeded so the arithmetic can be tested end to end. Nothing is
charged cess unless a line says so, so no existing bill changes. Real cess is
commodity specific, and a blanket rate on a live bill is a wrong number on a
legal document. Take that term out, or set its cess to zero, before this goes
near a real customer.

## Phase 7. A number series per channel. DONE

- [x] Migration: a `series` key on `invoice_sequences`, unique on (wholesaler,
      series, year), plus a channel on sales and on invoices. File:
      `wholesale3_sales_channels.sql`
- [x] `invoiceNumberService` draws on the run its channel owns
- [x] A channel dropdown on the sale form and on the manual invoice form, and
      the channel shown on the sale
- [x] A bill raised from a sale inherits that sale's channel. An order placed
      on this marketplace is the shop channel by definition, not by choosing.

Four books: counter, this shop, Flipkart, Amazon. Each keeps a run that is
consecutive in ITSELF, which is what Rule 46(b) asks and what lets a
marketplace settlement report be matched against our numbers. One shared
counter gave Flipkart a run reading 4, 9, 11 with the gaps filled by counter
sales.

**Nothing renumbered, and the counter channel kept the wholesaler's own
prefix.** A firm numbering `OM/1/26-27` carries straight on. The three new
channels start their own run at 1, which is what a new series is allowed to do.
Renumbering a bill already handed over would break the customer's GSTR-2B
against ours, and the instrument for correcting an issued invoice is a credit
note.

**This is not an import.** Choosing Flipkart records where a sale came from. It
does not fetch anything from Flipkart, and the hint under the field says so.
Pulling orders out of those marketplaces is a CSV parser per marketplace, or
their APIs, which need a developer account and a seller authorisation that
cannot be arranged from inside this codebase. Worth its own phase once you know
which report you actually get.

## Phase 8. Export. DONE

- [x] ZIP: a CSV per table plus the invoice PDFs (12)

`GET /api/exports/zip`. Nine CSVs, the bills as PDFs, and a readme in plain
English. Settings carries the button.

Scoped by `businessId`, taken from the token and never from the query string.
Verified by putting two wholesalers in one database and driving the route as
one of them with the other's id set in the query string, the params, the body
and a header at once: the file that came back had none of the other's rows,
none of their ids and none of their bills.

It ended up OWNER ONLY rather than behind a permission, which was a change from
the plan. Every other seller route is gated on the one list it touches, but
this route is the whole book at once, so gating it on `invoices` would have
quietly widened that permission into all of them and let an employee walk out
with the customer list. It sits with the GST number and the UPI id.

The ZIP is written by hand, stored rather than deflated, in
`services/zipWriter.js`. Eighty lines against a dependency to keep updated on
a server whose package list is fourteen entries long. Checked against the
standard CRC vector and against real `unzip`.

CSV cells starting with `=`, `+`, `-` or `@` are prefixed with an apostrophe.
Excel and Sheets run those as formulas on open, and a customer name is
somewhere a person types free text, so this is the one place in the product
where another program runs our data. The readme says why the apostrophe is
there.

The PDFs stop at 200, newest first, and the readme says how many were left out
rather than handing over a quiet partial set. The CSVs always carry every row.

Google Sheets is NOT in this phase. It needs a Google Cloud project, OAuth
consent and a per-wholesaler token store, and first a decision about who owns
the project.

## Phase 8.5. Import. DONE

Not on the original nine. Added 17 Sept, when the question "where is the
option to upload a zip" turned out to have the answer "there isn't one".
The export was built first and only went one way, which is the wrong half to
have on its own: a wholesaler with a year of sales in a spreadsheet cannot
start using this product at all until he can get them in.

- [x] `POST /api/imports/preview`, `POST /api/imports/commit`,
      `GET /api/imports/template`

Customers, suppliers, purchases, sales and old bills, with their line items.
A zip of CSVs, so the export round-trips, or one CSV on its own. Owner only
and scoped by the token, same as the export and for a stronger reason: this
side writes.

Three rules hold the whole thing up. **Nothing is overwritten**, ever: a row
already in the book is skipped and counted, because a merge done wrong
replaces a figure a customer agreed to with one out of a spreadsheet. **It is
all or nothing**, one transaction, because half a year in a book with no way
to tell which half is worse than a failed upload. **You see it before it
happens**: preview does every read and every check and writes nothing.

**Old bills come in as records of bills issued elsewhere.** They keep their
own numbers, are marked with `import_batch_id` so nothing can re-issue them,
and a bill carrying an IRN is refused outright, because an IRN is issued by
the IRP against a submission and cannot be checked from a spreadsheet.

**But the counter has to move past them**, and this is the part that is easy
to get backwards. Import KT/000001 to KT/000400 with the counter at zero and
the next bill raised here is numbered KT/000001, hits the unique index and
fails: the wholesaler cannot raise a bill at all. So the run is advanced past
the imported numbers and the preview says what the next bill will be called.
Nothing is renumbered by this. Every imported bill keeps the number it was
issued under and the run simply carries on after them.

Dates are read **day first**, as a rule rather than a guess, and it is written
on the template and on the screen. 03/04/2026 is the third of April. Both
readings are real dates, so a wrong guess errors nowhere and silently moves a
bill into a different GST return.

Products and stock are NOT in this phase. They were not asked for.

## Phase 9. e-invoice payload. NEXT

- [ ] The JSON builder, the validator, IRN and acknowledgement storage, the
      retry and cancellation flow, and the QR slot filled (13)

Buildable here. Proving it against the real IRP is not, and that half waits on
item 31. Written to the documented contract against a stubbed transport, with
the first live call treated as the real test, and said in those words rather
than claimed as working. That is how Razorpay Route was done and it held up.

## Phase 10. e-way bill payload

Same shape. Fields, validation, the distance and validity rules, storage.

## Phase 11. The rest

- [x] ~~A screen that advances an order past `payment_completed` (25)~~. Checked
      17 Sept: this already exists. `client/src/utils/orderStatus.js` holds the
      chain through to `completed`, and Orders and SellerOrderDetail both call
      it. It was carried on this list after it had been built.
- [ ] Seller-side discovery, "textile wholesalers in Surat" (27)
- [ ] `README.md` (28)
- [ ] Mobile OTP (29), still deferred, no genuinely free Indian SMS gateway
- [ ] Google Sheets export, if the Google project question is answered
- [ ] Products and stock import (Phase 8.5 covers everything else). Left out
      because it was not asked for, not because it is hard.
- [ ] The `razorpay-integration` branch changes, still local on one machine (33)

---

# 18 Sept: what this is missing against Marg and Busy

**NOTHING HERE IS AGREED.** Everything above this line was decided and then
built. This section is a survey, asked for on 18 Sept: "find out what our
project is lacking, that is needed desperately, anything that is there in
Marg, Busy etc", and "make the master table or dashboard to be similar to
that of an ERP system as well".

Every claim below was checked against the code, not remembered. Where a thing
turned out to exist, it is not listed. Where a comment in this repository says
something the code does not do, that is called out as its own item, because a
false comment is worse than a missing feature.

## The one that matters most: there is no stock ledger

`supplier_inventory.stock` is written in exactly two files, `orderController.js`
and `orderStatusService.js`, both on the marketplace order path. Checked by
grepping every `SET stock` in the server.

**A sale does not lower stock. A purchase does not raise it. A challan does
not move it either.** So the stock figure on a product is only meaningful for
a wholesaler who sells through the shop page, and means nothing at all for one
who uses the khata, which is the product we have been building for a month.

This is deliberate and self-consistent. `purchaseController.js` says so at the
top: a sale does not lower stock, so a purchase must not raise it, or the
figure only ever climbs. Given that a sale was never wired up, refusing to
wire up the purchase was the right call at the time.

But it leaves the comments wrong. `challanBook.js` opens with "A challan moves
STOCK and nothing else", and `CLAUDE.md` repeats it as "A challan moves stock,
never the ledger". The ledger half is true and enforced. The stock half is
aspiration: a challan moves nothing. **Fix the comments in the same change
that either builds the stock ledger or admits there is not one.**

What Marg and Busy have that this does not follow from:
- a stock register, item by item, opening plus in minus out equals closing
- closing stock value, which is the single number a trader needs at year end
- reorder level and a shortfall list
- multi godown, and stock transfer between them
- batch and expiry, which matters enormously in pharma and not much in cloth

The honest sequencing: **one `stock_ledger` table written by every document
that moves goods (sale, purchase, both challan kinds, order, credit note,
debit note), with the current figure derived from it rather than stored.** A
stored counter updated from six places is how the figure silently drifts, and
this repository already has one of those.

## GSTR-1 and GSTR-3B: nothing comes out of this

`GSTR` appears six times in the server and every one is a comment explaining
why some other decision was made. There is no return, no JSON, no filing
export.

What IS built, and is most of the hard part: CGST/SGST/IGST decided properly
through `placeOfSupply.js`, place of supply and its code on every invoice,
reverse charge, cess, the HSN summary that is literally GSTR-1 Table 12, and
an invoice number series that satisfies Rule 46(b).

So the data is there and shaped right. What is missing is the mapping: B2B
(Table 4), B2C large and small (5, 7), credit and debit notes (9B), HSN (12),
documents issued (13), and the GSTN JSON schema around them. **This is the
single most commercially important gap.** A wholesaler files every month. If
he still has to retype the month into Marg to file, he has not replaced Marg.

## Purchase returns have no document

`credit_notes` exists, with reasons `sale_cancelled`, `goods_returned`,
`rate_revised`, `other`, its own consecutive run, a snapshot recipient, and a
PDF. That is the sales side and it is done properly.

**There is no debit note.** Grepped: no `debit note`, no `debit_note`,
anywhere. So goods sent back to the mill have no document, the supplier
balance cannot be reduced correctly, and the GST on the return is not
reversed. On the sales side this was treated as important enough to build a
whole numbered document type. The purchase side has nothing.

## The purchase side is thinner than the sales side generally

- the ageing report reads the `invoices` table only, which is sales. There is
  no "what I owe, by age". A wholesaler needs both, and the one that gets him
  into trouble is the one he owes.
- no purchase order. A wholesaler orders from a mill, the goods arrive against
  it, and the bill arrives after that. We have the last two and not the first.

## No day book

Marg has Day Book, Busy and Tally have the same thing. One chronological list
of every voucher of every type for a date or a range: sales, purchases,
receipts, payments, challans, notes. It is how a trader checks his day before
going home.

Everything needed for it exists, spread across six screens. This is a query
and one page, not a subsystem, and it is the cheapest large win on this list.

## The master area is not what an ERP calls masters

This is the second question asked, and the answer is that the word means two
different things in the two products.

**Here**, `/administration` is PLATFORM level, guarded by `requirePlatformAdmin`,
and holds four lookup lists (states, units, tax rates, HSN) plus formatting
settings: decimals, digit grouping, Indian or western commas, currency words,
date format, minimum HSN digits. A wholesaler cannot see it and should not.
That is correct for what it is: it keeps a unit or a tax slab from being a
deploy.

**In Marg and Busy**, Masters is the WHOLESALER'S own menu, and it is where he
spends his first day. Item master, Ledger or party master with groups, Unit,
Tax category, Salesman, Transporter, Godown, Price list, Company.

The wholesaler's masters do exist here, but scattered under separate nav
entries (Customers, Suppliers, Products) with no shared shape. What is missing
outright:

| Master | State here |
|---|---|
| Price list, rate per customer or per group | nothing. A wholesaler quotes different rates to different buyers, and today every rate is retyped per bill |
| Transporter | typed free text on every single sale, `transporter_name` and `transporter_id` on the row |
| Salesman or agent, with commission | nothing. Most wholesalers of this size sell through agents |
| Party groups | nothing. No way to say "Surat retailers" and act on it |
| Credit limit | `parties.credit_limit` EXISTS, is importable, and is read by no controller anywhere. A stored field that nothing enforces is worse than no field: it looks like a control and is not |
| Item groups | only `products.category`, a free text column |
| Godown | one warehouse on the profile, no second, no transfers |

**Smallest change that is worth doing:** one Masters section in the seller nav
that gathers Customers, Suppliers, Products and the new ones under a single
roof, so the wholesaler has one place to set his business up rather than four.
Then fill the gaps in the table, cheapest first: transporter master, party
groups, credit limit actually enforced, then price lists.

The credit limit is the one to do first. The field is already there and
already imported, so the work is a check on the sale form and a line on the
customer screen, and until it is done the field is a lie.

## The Overview is a summary, not an ERP dashboard

Today: three money cards (still to collect, billed this month, received this
month), a customer count, an item count, recent sales, top debtors, and a
three step setup checklist for a new seller. It is clear and honest, and every
number on it is computed rather than invented, which is the rule here.

What a Marg or Busy dashboard puts next to those, all of which need something
above to exist first:
- stock value, and a shortfall list (needs the stock ledger)
- payable ageing beside receivable ageing (needs the purchase ageing)
- this month's GST liability, output minus input (needs the GSTR work)
- cheques due, in and out
- today's day book, as a strip

## Deliberately NOT recommended

- **Full double entry, trial balance, P&L, balance sheet.** Marg and Busy have
  them. This product has a khata, which is a running balance per party, and
  that is what a wholesaler of this size actually reads. Adding account groups
  and a trial balance is months of work for a screen his accountant already
  produces from the data we can export. Revisit only if customers ask.
- **Barcode.** Real in retail and in pharma. In cloth, sold by the metre off a
  than, it is not.
- **Batch and expiry.** Same reasoning. Build it when there is a pharma or a
  food customer, not before.

## If it were one at a time

1. **Day book.** A query and a page. Everything it needs exists.
2. **Credit limit enforced.** The column is already there and already a lie.
3. **Debit note.** Mirror `credit_notes`, which is a worked example.
4. **Purchase ageing**, beside the sales one.
5. **The Masters section** in the nav, then transporter and party groups.
6. **The stock ledger.** The largest, and the one everything about inventory
   waits on. Do the comment correction on the same day, whichever way it goes.
7. **GSTR-1 JSON.** The most commercially valuable and the one that needs the
   most care, because it is filed and wrong is expensive.

---

# 19 Sept: orders, and one chain from order to money

**NOT AGREED YET.** Asked for on 19 Sept, with "do research first on this and
correct me where im wrong". This is the research and the proposal. The
corrections are at the top because two of them change what gets built.

## Correction 1, the important one: a shipped order takes an INVOICE, not a challan

Asked: "once order is marked shipped we create a delivery challan (or sales
challan? idk please research)".

**For an ordinary order, the tax invoice travels with the goods.** CGST s.31(1)(a)
requires the invoice before or at the time of REMOVAL of the goods. A Rule 55
delivery challan is for movement that is NOT a normal supply: job work, goods
on approval, liquid gas where the quantity is not known at removal, and
transport for reasons other than supply.

There is one escape hatch and it is worth knowing: Rule 55(4) allows shipping
on a delivery challan and raising the tax invoice after delivery WHERE THE
INVOICE COULD NOT BE ISSUED AT REMOVAL. That is a real provision, not a
loophole, but it is the exception. A marketplace order with a known quantity
and a known price is not it.

**This repository has already been burned by exactly this.** The 10 Sept
challan was raised INSTEAD of an invoice whenever a sale was unpaid, and the
17 Sept rework reversed it: holding the invoice back understated outward
supply in GSTR-1 and left the customer unable to claim input credit. Wiring
"shipped" to a challan would walk straight back into it.

**So: marking an order shipped raises the TAX INVOICE.** The challan stays
available on the same step, behind a Rule 55 reason the wholesaler picks, for
the cases that genuinely need one.

## Correction 2: the naming is already settled

Tally calls it a Delivery Note. Marg calls it a Sale Challan. Busy calls it
Material Issued to Party. All three are the same document.

This product settled on **Sale challan** and **Purchase challan** on 17 Sept,
and the instruction at the time was to drop "delivery challan" wording
because a challan is not specifically a delivery note and now comes in two
directions. Keep that. It pairs correctly with the purchase side, which
"delivery challan" does not.

## Correction 3: think hard before making the sale follow the invoice

Asked: "sale is now generated after an invoice is raised".

In Tally and Marg there is no separate sale and invoice. The Sales Voucher IS
the tax invoice AND the accounting entry, one document. This product split
them, and the split is load bearing: `sales` is the khata. The party balance,
the statement, the settlement path, the stock ledger, the 22 state order
lifecycle and `orderSaleService` all key off it.

Inverting the direction is a large migration for no gain, because the thing
actually wanted is the LINK, not the direction. The same outcome is reached by
letting the invoice CREATE the sale where none exists, while keeping the sale
as the record everything else reads:

    order --ship--> invoice --> sale (written automatically)
    counter sale --> sale --> invoice (unchanged, still the daily path)

Both directions end with one sale and one invoice pointing at each other. The
guard that matters: a sale must never be written twice for the same goods, so
the invoice path writes a sale only when the invoice has no `sale_id` yet,
the same way `orderSaleService` already refuses to write a second sale for an
order it has already bridged.

## Where the ask is right

**Separate numbering per document type.** Correct, and it is how every one of
these systems works: in Tally each voucher type carries its own numbering, so
a sales order, a delivery note and a sales invoice never share a run. This
product already does it for invoices, sales, challans (per kind), purchases
and credit notes. What is missing is orders.

**Several series inside one document type.** Also correct, and also standard.
Tally calls it multiple voucher numbering series and the documented use is
exactly this one: separate runs for wholesale against retail, or local
against interstate. Here that is the sales channel, and invoices already have
it. Sales and challans do not, and should.

**A wholesaler defining his own series.** Correct. Tally's series configuration
is prefix, suffix, starting number, width of the numeric part, whether to pad
with zeroes, and an applicable-from date. That is the shape to copy. Today the
four channels are hardcoded in `services/salesChannels.js`, so a wholesaler
selling on Meesho has nowhere to put it.

**Manual order entry.** Correct and standard: it is Tally's Sales Order
voucher, entered by hand for an order taken on the phone or in person. Note
that an order is not a sale and not stock: it is a promise. Tally closes it
when fully billed and leaves it PARTIALLY closed otherwise, which is the
behaviour to copy, because part shipment is normal in this trade.

**Stats on the challan page, series stats on the Overview, a fuller invoice
register.** All fine, all cheap once the links exist.

**One screen per person per day.** Worth stating as a rule rather than a
feature: if a member of staff lives on the Challans screen all day, that
screen needs its own filters, its own totals, and its own keyboard path,
rather than assuming they will hop to the Overview for a number.

## The invoice register, as Marg and Busy show it

Asked for: date first, and more on the row.

Their sale registers carry, left to right: Date, Invoice number, Party, GSTIN,
Taxable value, CGST, SGST, IGST, Invoice total, Received, Balance, Status.
With column totals at the foot, which is the part that makes it a register
rather than a list, and the part this product's screen does not have.

## What this actually needs, in order

1. **`order_sequences`,** so orders stop sharing a run with anything else.
2. **A series master** the wholesaler can add to, replacing the hardcoded four
   channels: code, label, prefix, next number, padding, applicable from.
   Applied to invoices (already), sales and challans (not yet).
3. **Manual order entry**, with partial closure.
4. **Ship raises the invoice**, with a Rule 55 challan as the picked exception.
5. **Invoice creates the sale** when there is not one, guarded against doubles.
6. **The invoice register**, date first, tax columns, column totals.
7. **Cards on Challans, series breakdown on the Overview.**

1, 2 and 6 are self contained and can go first. 4 and 5 are the ones that
touch the money path and want their own suite before they are trusted.
