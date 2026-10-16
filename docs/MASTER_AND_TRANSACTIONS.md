# The master dashboard, purchases, and what we already have

Written 10 Sept 2026, answering three questions asked that day. Nothing in
here is built unless it says so. `docs/BUSY_MODEL.md` is the reading this
comes from; this is the plan that follows it.

---

## 1. What the master dashboard will hold

A master is a thing that EXISTS, as against a transaction, which is a thing
that HAPPENS. The dashboard is a small screen over the masters that belong to
the PLATFORM rather than to any one wholesaler. That distinction is the whole
design, and it makes the job much smaller than it sounds.

### Platform masters, the super admin's

Five lists, plus the settings that shape documents.

| Master | What it holds | Where it is today |
|---|---|---|
| **State** | 37 states and union territories, each with its two digit GST code | `INDIAN_STATES` and `CODE_BY_STATE`, constants derived from the GSTIN table |
| **Country** | Country list | the string "India" |
| **Tax Category** | Named rates: GST 0, 5, 12, 18, 28 | a `gst_percent` number on each listing |
| **Unit** | Pcs, Mtr, Kgs, Box, Bale, Than | a `UNITS` array in the client |
| **HSN** | Curated codes with descriptions, plus the shape rule | `TEXTILE_HSN`, 32 rows, in `hsnService` |

Every one of those is a constant in code today, so changing one is a deploy.
Moving them into tables is the actual work; the screens are CRUD over five
small tables.

### Platform settings, also the super admin's

| Setting | Why it is platform level |
|---|---|
| Number format defaults | The Rule 46(b) rules, 16 characters and the allowed characters, are law and must not be per-wholesaler |
| Decimal places | Currency 2, tax rate 2. Busy keeps these separate and so should we |
| Number grouping | `9,99,99,999.99`, the Indian lakh and crore mask |
| HSN minimum digits | 4 below ₹5 crore turnover, 6 above. Busy makes it a setting with 0 meaning "do not validate" |
| Feature flags | Marketplace, promotions, returns, the challan rule |

### What is NOT the super admin's

Everything a wholesaler owns: his customers, his items, his sale types, his
own invoice prefix and suffix, his terms, his bank details, his staff. Those
belong on his settings screen, and several already are.

### The first step is a migration, not a screen

`users.role` carries a CHECK constraint allowing only `buyer`, `seller` and
`both`. `promotionController` already tests for role `'admin'`, which the
database can never contain, so that code is unreachable rather than merely
unbuilt. A super admin needs that constraint changed before anything else can
be built, and it wants a separate `is_platform_admin` flag rather than a
fourth role, because an admin is not a fourth kind of trader.

### On money formatting, which prompted this

"In some places it is 14,000 and on the invoice it is 14000.00."

Both are right for where they are and neither is chosen deliberately. The
screens call `toLocaleString("en-IN")` through about fourteen separate copies
of a `money()` helper, and the PDF uses its own `rupees()` which is
`toFixed(2)` with no grouping at all.

**The order matters.** Collapse the fourteen helpers into one formatter
first, then make it read the setting. Adding the setting first would produce
a setting that reaches some screens and not others, which is worse than the
inconsistency it was meant to fix.

---

## 2. What a purchase record will hold

The single biggest hole in the product. A wholesaler buys as well as sells,
and today his khata knows what his customers owe him and nothing about what he
owes his suppliers. That is half a book.

The good news is that it is a mirror of things that already exist and work.

| Sales side, built | Purchase side, to build | Mirror? |
|---|---|---|
| `parties` (customers) | suppliers | Same table, plus an account group to tell them apart |
| `sales` | `purchases` | Yes |
| `sale_lines` | `purchase_lines` | Yes |
| `party_payments` (money in) | payments out | Same table, plus a direction |
| Sales Return, credit note | Purchase Return, debit note | Yes |
| khata: he owes me | khata: I owe him | Same arithmetic, opposite sign |

### The fields, and the ones that are not mirrors

A purchase carries what a sale carries: supplier, date, lines with item, HSN,
quantity, unit, rate, GST rate, and the totals. Four things differ:

1. **His supplier's invoice number and date**, not ours. We do not number a
   purchase; the supplier did. We record his number so it can be matched
   against GSTR-2B, and our own reference is separate.
2. **Input tax credit**, which is the entire point. The GST on a purchase is
   money the wholesaler gets BACK, as against tax he collects and pays on. A
   purchase is where ITC is claimed, so `itc_eligible` per line matters: some
   purchases are blocked from credit under section 17(5).
3. **Stock goes UP**, where a sale takes it down.
4. **No place of supply decision of ours.** His supplier decided it and it is
   printed on his supplier's invoice. We record what it says.

### Why it is worth doing early

- It is the mirror of code that already works, so it is the cheapest large
  feature available.
- It makes the khata a real book instead of a receivables list.
- It is what makes GSTR-2B reconciliation possible later, which is the thing
  wholesalers actually lose money on.
- It gives HSN suggestions a second source: what he BUYS is what he sells.

---

## 3. Do we have Busy's Sales and Sales Order? Yes, and what to refine

We have both, and they are the same two ideas, arrived at from the other end.

| Busy | Ours | State |
|---|---|---|
| Sales Order | `orders` | A retailer's order through the shop. Has a 22 state lifecycle Busy does not have |
| Sales | `sales` | The wholesaler's own record. Four states: draft, confirmed, delivered, cancelled |

An accepted order writes a sale, and since 10 Sept the order is the authority
over both: the sale follows it and cannot be steered or retyped on its own.
That is the same relationship Busy has, where a sales order is a promise with
no accounting effect and the sale is the thing that counts.

### What to refine, in the order I would do it

**a. The sale status spine is too short, and its own comment says so.**
`draft, confirmed, delivered, cancelled`. Busy's order flow tracks how much of
an order has been delivered and how much invoiced, separately, because a
wholesaler part-delivers constantly: two bales today, three next week. We
model that as one delivered flag. Now that challans exist and there can be
several against one sale, the shape for tracking part delivery is already
half here.

**b. An order cannot be partly accepted.** A retailer orders ten items, the
wholesaler has eight. Today it is all or nothing. Busy handles it as a
short-supplied order line.

**c. There is no purchase order at all**, so the mirror is missing on the
buying side too.

**d. Sale Type is missing, and it is load bearing.** In Busy the sale type
decides the tax treatment AND whether the document prints as "Tax Invoice" or
"Bill of Supply". A composition dealer or an exempt sale must print Bill of
Supply, and we have no way to express that: every document we print says Tax
Invoice. This is the highest value item in this section.

**e. The order lifecycle has 22 states and a wholesaler uses about five.**
It came from marketplace delivery tracking. Worth trimming to what is used,
carefully, since it is the authority for the return window.

**f. A payment recorded against the customer is not a payment against a
sale.** Found while updating the smoke test on 10 Sept: `recordPayment`
without a `saleId` moves the khata but does not move that sale towards
settled, so under the challan rule the bill stays refused while the customer's
balance looks paid. Correct behaviour, confusing screen. Recording a payment
from a sale page should tag the sale.

---

## 4. Everything else, parked

Written down so it is not rediscovered.

### Documents

- **Rule 55 challans proper**: three copies marked Original for Consignee,
  Duplicate for Transporter, Triplicate for Consigner; provisional quantity;
  tax shown where the movement is a supply. Deferred by instruction 10 Sept.
- **The six month approval window** under section 31(7), with a reminder
  before it expires. Deferred by instruction 10 Sept.
- **Bill of Supply**, needed once Sale Type exists.
- **Proforma invoice**, which is what most people mean by "a bill that is not
  a bill yet".

### The invoice, what is still missing after 10 Sept

Six particulars were added that day. What remains:

- **Billed to and Shipped to as separate parties.** Busy prints both with
  their own PAN, state, pincode and GSTIN. Ordinary wholesale: bill the head
  office, deliver to the site.
- **Bill sundry as real lines.** Freight under SAC 996511 and insurance under
  9971, each with its own GST rate, in the line table. We hold one untaxed
  `shipping_charge` number, which under-describes a supply of service. Needs
  a line table that accepts two kinds of row.
- **Bank details** on the document.
- **A sub-description per line**, the "20 MM" under "SARIA (TMT BAR)".
- **Transport block**: station, e-way bill number, vehicle number, GR/RR
  number, dispatch from.
- **E-invoice**: IRN, Ack No., Ack Date and the e-invoice QR, which is a
  different code from the UPI QR and would sit beside it.

### Integrations

- **Razorpay**, for verifying that a UPI payment really happened. Payments are
  self declared today. Webhook signature is an HMAC SHA256 of the RAW body, so
  the JSON parser has to be bypassed on that route. UPI Collect was deprecated
  by NPCI from 28 February 2026, so an integration must use Intent or QR.
  Handlers must be idempotent.
- **E-way bill** against GSTN's free sandbox, once the GSP question is
  settled. Busy's own GST screen has a "GSP Configuration" button next to
  "E-Way Bill Required", which is independent confirmation that the question
  is real and that the answer is per-company credentials.
- **GSTIN name lookup** is paid, confirmed by Busy's own footnote that its
  Validate GSTIN Online needs an active subscription. The check digit is free
  and we already do it.

### Keyboard first

No mouse: numpad for up and down, shortcuts for everything else. This is the
single thing most likely to decide whether a working wholesaler adopts this
over software he already has, and it constrains every screen, so it wants its
own design pass before any of it is typed.

### Known problems still open

- The `wholesaler_profiles.city` default of `'Delhi'` still applies to any
  direct INSERT. Signup writes an explicit NULL, but a profile created any
  other way still silently claims Delhi.
- The home page invents demo products when the catalogue fails to load.
- Search invents a 4.5 star rating for a wholesaler who has none.
- The abandoned payment path credits stock that was never taken.
- Three list endpoints are unpaginated.
- Git history contains a committed password and an invoice PDF. Credential
  rotated; the rewrite is outstanding.
- `README.md` is substantially out of date.
