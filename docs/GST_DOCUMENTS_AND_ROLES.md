# GST documents, master codes and staff accounts

An assessment, not a plan. Nothing built. The question was whether this is
buildable; the short answer is that most of it is, one part of it is not
ours to build, and one part probably does not apply to our users yet.

Anything with a rupee threshold or a date in it should be re-checked against
the current rules before it is built. Those numbers have moved repeatedly.

## 1. What "master codes" actually means

This was the part that was unclear, so it is worth being precise.

The e-invoice portal publishes **master code lists**: the government's
canonical vocabularies that any e-invoice JSON must use. They are reference
data, not an API you call per transaction. The ones that matter to us:

| List | What it is | Where we would use it |
| --- | --- | --- |
| **UQC** | Unit Quantity Codes, three letters: `MTR`, `KGS`, `PCS`, `DOZ`, `BOX`, `BDL`, `NOS`, `LTR` | our unit field |
| **HSN / SAC** | commodity and service codes | `items.hsn_code`, today free text |
| **Tax rates** | the legal set: 0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28 | `gst_percent`, today any number |
| **State codes** | 01 to 38, and the first two digits of every GSTIN | the CGST/SGST versus IGST decision |
| **Document types** | `INV` invoice, `CRN` credit note, `DBN` debit note | the document tables |
| **Supply types** | `B2B`, `SEZWP`, `EXPWP` and so on | later, exports |
| Country, port, currency | exports | later |

"Add and remove options for these codes" makes sense now: nobody wants to
scroll twenty thousand HSN codes. The wholesaler picks the handful he
actually trades in, and those become his dropdown.

**This is free, static, published data.** No licence, no GSP, no per call
cost. It is a dataset we ship and refresh occasionally. Buildable now.

### What we have today, measured against that

- **Units are ours, not the government's.** `itemController.js:13` has
  `["pcs", "dozen", "case", "mtr", "kg", "box", "bundle"]`, and the same
  array is copy pasted into `AddItemModal.jsx` and `RecordSale.jsx`. None of
  those are UQCs. `mtr` is `MTR`, `kg` is `KGS`, `dozen` is `DOZ`, `bundle`
  is `BDL`, but **`case` has no UQC at all**; the nearest is `CTN`, cartons.
  A unit that cannot be mapped cannot go on an e-invoice.
- **HSN is free text.** Nothing validates it, and until recently the code
  invented `8504` for anything blank.
- **The tax rate is any number.** `default_tax_rate NUMERIC(5,2)` accepts
  `17.5`, which is not a GST rate.

None of that is broken for a paper bill. All of it blocks e-invoicing, and
fixing it is cheap **now** and expensive after there is data.

## 2. The seven documents, split by who can build them

### Group A: entirely ours, no government involvement

| Document | Status | Notes |
| --- | --- | --- |
| Tax invoice | **built** | needs the Rule 46 particulars finishing |
| Credit note | **built** | whole bill only; part returns need a quantity per line |
| **Debit note** | not built | the mirror of a credit note: the bill was too low. Same table, a `kind` column, its own number series |
| **Delivery note** | not built | a delivery challan. Goods moving without a sale yet, or ahead of the bill |
| **Receipt note** | not built | acknowledges money received. We record payments but issue no document |

All four missing ones are the same shape as work already done: a numbered
document, a snapshot of who and what, a PDF. **Buildable now**, and the
credit note is the template.

Worth noting: a delivery note is not just paperwork. It is the document that
travels with the goods, and it is what an e-way bill is generated against.
Building it early makes the e-way bill easier later.

### Group B: needs government integration, not ours to build

**e-invoice.** An invoice is uploaded to the Invoice Registration Portal,
which returns an IRN and a signed QR code that must be printed on the bill.
Reaching the IRP means either a GSP, or direct API access, both of which are
commercial arrangements with credentials and testing.

**But it very likely does not apply to our users yet.** E-invoicing is
mandatory only above an annual turnover threshold, which has been lowered in
steps over the years and currently sits in the low crores. A wholesaler in a
pilot is probably below it. That makes e-invoice **the lowest priority of
the seven**, despite sounding like the most important.

The thing to get right now is the *data*: if HSN, UQC and rates are clean,
turning e-invoicing on later is an integration. If they are not, it is a
migration of every product and every historical bill.

**e-way bill.** A separate portal and a separate API from e-invoicing.
Required when goods move above a consignment value threshold, currently
fifty thousand rupees, with state variations for movement inside a state.

**This one bites much sooner than e-invoice**, because it is keyed to the
value of the consignment, not the turnover of the business. A wholesaler
sending one bale of cloth crosses it; his annual turnover is irrelevant. If
either government integration is worth doing first, it is this one.

## 3. Staff accounts for a wholesaler

**Buildable, entirely ours, and the largest of these in code terms.**

Today authorisation is one column. `roleMiddleware.js` reads `req.user.role`
and compares it to a list, and every route declares
`authorizeRoles("seller", "both")`. There is no notion of acting *for*
somebody. Every 3.0 query is scoped by `req.user.id` as the wholesaler,
which is exactly what makes an employee impossible right now: an employee
logging in would see his own empty book.

What it needs:

1. A table of memberships: this user works for that wholesaler, with a role
   like owner, manager or clerk.
2. **A wholesaler context separate from the logged in user.** Every query
   that says `wholesaler_id = req.user.id` becomes
   `wholesaler_id = req.context.wholesalerId`. That is a mechanical change
   across every 3.0 controller, and it must be complete: one missed query is
   an employee reading or writing the wrong book.
3. Permissions worth having from day one, because they are the reason to
   want this: can record sales, can see rates and margins, can record
   payments, can raise bills, can see the whole khata. A clerk entering
   sales should not necessarily see what everything cost.
4. An audit trail. Once more than one person can act, "who cancelled this
   sale" stops being obvious. `invoice_logs` already does this for invoices;
   sales and payments have nothing.

**Do this before there is much data, and before the merge multiplies the
number of queries to change.** It gets more expensive every week.

## 4. "Retailer can order and pay later" — what we actually have

Partly. Two different things are being conflated.

**Representing an unpaid balance: yes, already works.**

- Marketplace orders carry `payment_plan` (`full` or `installment_50_50`),
  `amount_paid` and `remaining_amount`.
- A 3.0 sale can be recorded with nothing received, and the customer's khata
  shows the whole amount owing.
- Part payments already show correctly on the customer page, the statement
  and the invoice status.

**Credit control: no, nothing.**

- No credit limit per customer.
- No payment terms per customer. `invoice_settings.due_days` is one number
  for everybody, not "Kishan gets 30 days, Modern Fabrics gets 15".
- No warning when a customer goes past his limit or his terms.
- Nothing marks a customer as blocked for new orders.

That is the khata work already agreed: terms negotiable per pair, warn on
limit, no interest. It is a couple of columns on `parties` and a check when
a sale or order is created. **Buildable now, small, and it is what "pay
later" means to a wholesaler** — not the ability to owe, which he already
has, but the ability to control how much.

## 5. Suggested order, if these were to be built

Cheapest and most load bearing first.

1. **Master code data: UQC, HSN, tax rates.** Small, free, and it makes
   everything downstream possible. Doing it after there are thousands of
   products means remapping them.
2. **Credit terms per customer.** Small, and it is what was actually being
   asked for under "pay later".
3. **Debit note, delivery note, receipt.** Same shape as the credit note,
   which is already built and tested.
4. **Staff accounts.** Larger, and gets worse the longer it waits.
5. **e-way bill.** The first government integration that will actually be
   needed.
6. **e-invoice.** Last, because it probably does not apply to our users yet,
   and because step 1 is what makes it easy when it does.

## 6. Nothing here changes the merge plan

None of this contradicts `MERGE_2_AND_3.md`. Two things reinforce it:

- The document types all want one numbering service per wholesaler, which
  the audit already flagged as broken: `invoice_sequences` is keyed on year
  alone and shared platform wide.
- Staff accounts want every query to go through a wholesaler context, which
  is the same discipline as routing every query through the price seam, the
  khata or the party.
