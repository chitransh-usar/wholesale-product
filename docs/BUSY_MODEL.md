# What Busy does, and what we would take from it

Written 10 Sept 2026 from fourteen screenshots of a live Busy 21 (GST edition)
belonging to OM Consultancy and Engineering, FY 2026-27.

Nothing here is built. This is the reading, so the next argument is about
which parts we want rather than about what the parts are.

The point of the exercise is NOT to rebuild Busy. Busy is a full double entry
accounting package with production, job work and a balance sheet. We are a
wholesaler's billing and khata book. The value in the screenshots is the
**vocabulary**: a wholesaler who has used Busy, Tally or Marg expects certain
words in certain places, and where we use different words for the same thing
we are making him translate.

---

## 1. Masters

From the Administration menu. A master is a thing that EXISTS, as against a
transaction, which is a thing that HAPPENS. Every master screen is the same
three verbs: Add, Modify, List.

| Busy master | What it is | What we have | Gap |
|---|---|---|---|
| Account | A party. Customer or supplier, told apart by its group | `parties` | No opening balance, no Dr/Cr, no print name, no bank details, no group |
| Account Group | Sundry Debtors, Sundry Creditors, and so on | nothing | The customer/supplier split lives nowhere |
| Item | A thing sold, with unit, HSN, tax rate | `supplier_inventory` + `products` | Close. We already carry unit, HSN and GST percent |
| Item Group | Category, for grouping and reporting | `products.category`, free text | Not a master, so it cannot be renamed or reported on |
| Unit | Pcs, Mtr, Kgs, Box | a hardcoded `UNITS` array in the client | Not a master |
| Unit Conversion | 1 Box = 12 Pcs | nothing | Missing. Wholesale sells by the box and stocks by the piece |
| Bill Sundry | Freight, insurance, packing, discount, as taxable lines | `invoices.shipping_charge`, one untaxed number | Wrong shape, see section 3 |
| Bill of Material | Manufacturing | nothing | Not wanted |
| Sale Type | B2B, B2C, export, nil rated. Decides the tax treatment AND whether the document prints as "Tax Invoice" or "Bill of Supply" | nothing | Missing, and load bearing |
| Purchase Type | The same, on the buying side | nothing | Missing |
| Tax Category | Named rates: "GST 5%", "GST 18%" | a number per listing | Works, but a rate change means editing every item |
| Discount Structure | Standing discount rules per party or item | nothing | Missing |
| **State** | The state list, with codes. Add / Modify / List | `INDIAN_STATES`, built 10 Sept, a constant in code | This is exactly the master that was asked for |
| Country | Country list | the string "India" | Fine for now |

**What this settles about "super admin".** The masters that belong to the
platform rather than to one wholesaler are State, Country, Tax Category, Unit
and the HSN list. Everything else is his own. That is the boundary, and it is
narrower than it first sounded: a super admin is a small screen over five
reference tables, not a second application.

### The party master, in detail

Worth its own note because it is the master we already have and the one our
name bug came out of.

Busy's Account form carries, beyond what we store: **Print Name** separate
from Name (the name that goes on the document, as against the one you search
by), Alias, Group, **Opening Balance with a Dr/Cr flag**, Previous Year
Balance, four address lines, **State / POS with its code**, Type of Dealer,
GSTIN with a **Validate GSTIN Online** button, Aadhaar, PAN, ward, email,
mobile, **WhatsApp number**, telephone, fax, contact person, **Transport**,
**Station**, **PIN code**, **Distance in KM with a Check Distance button**,
and the party's **bank name, account number, IFSC and Swift**.

Two of those matter more than the rest:

- **Print Name.** Busy separates what you call a party from what the document
  calls him. Our name mismatch bug was exactly this distinction missing: the
  order screen showed the firm and the invoice showed the person. We fixed it
  by filling `business_name`, which is the same idea arrived at from the other
  end.
- **Distance in KM.** Not decoration. The e-way bill's validity period is
  calculated from the distance, so it has to be on the party.

### GSTIN validation, confirmed

The screenshots show Busy's **Validate GSTIN Online**, which returns trade
name, legal name, constitution, registration date, jurisdiction codes, filing
frequency and **e-invoice applicability**. The footnote on that screen reads:

> GSTIN Validation service is available only if you have an active annual
> subscription of BUSY.

That confirms what we already concluded and shipped: the free part is the
check digit arithmetic, which catches a mistyped number. Turning a GSTIN into
a name is a paid service. We are not missing a free API; there isn't one.

---

## 2. Transactions

The whole Transactions menu, in Busy's own order and grouping. The grouping is
the interesting part: it separates documents that move **goods** from ones
that move **money** from ones that move **stock between your own places**.

**Orders** (a promise, no accounting effect)
- Sales Order
- Purchase Order

**Goods** (the ones that create a tax document)
- Sales
- Purchase
- Sales Return (Cr. Note)
- Purchase Return (Dr. Note)

**Money**
- Payment (money going out)
- Receipt (money coming in)
- Journal (an adjustment)
- Contra (moving your own money, bank to cash)
- Dr. Note (w/o Items)
- Cr. Note (w/o Items)

**Stock, no party involved**
- Production, Unassemble, Stock Journal, Physical Stock

**Job work**
- Mat. Issued to Party, Mat. Rcvd. from Party

### Against ours

| Busy | Ours | State |
|---|---|---|
| Sales Order | `orders` | Have it, as marketplace orders |
| Purchase Order | nothing | Missing |
| Sales | `sales` | Have it |
| **Purchase** | nothing | **Missing, and it is half the product** |
| Sales Return (Cr. Note) | `return_requests` + `credit_notes` | Have it |
| Purchase Return (Dr. Note) | nothing | Missing |
| Receipt | `party_payments` | Have it |
| Payment | nothing | Missing. We cannot record money he pays out |
| Journal, Contra | nothing | Missing. These need ledgers we do not have |
| Cr. Note without items | `credit_notes` | Have it |
| Dr. Note without items | nothing | Missing |
| Production, job work, stock journal | nothing | Not wanted |

**The single biggest hole is Purchase.** A wholesaler buys as well as sells.
Today the product can only describe one direction, so his khata is half a
book: it knows what his customers owe him and nothing about what he owes his
suppliers. Purchase, Purchase Return and Payment are the mirror of three
things we already have, which makes them the cheapest large feature available.

Journal and Contra are a different matter. They are double entry primitives,
they need a chart of accounts, and a wholesaler who wants them wants Tally.
Recommend not building them.

---

## 3. The invoice

Busy's tax invoice, field by field, against what our PDF prints today.

### What we already print

Heading, supplier name and address, supplier GSTIN, buyer name and GSTIN,
invoice number, issue date, due date, the line table with description, HSN,
quantity, rate, GST percent, tax and amount, then subtotal, taxable value,
CGST/SGST/IGST, total tax, grand total, terms, notes, a UPI QR, the
"computer generated" line and the signatory block.

### What Busy prints and we do not

Ordered by how much it matters, not by where it sits on the page.

**Legally required, missing today**

1. **Place of supply, with the state code.** "Haryana (06)". We compute this,
   as of 10 Sept, and then throw it away. Rule 46 requires it on every
   inter-state invoice. This is the cheapest compliance win we have.
2. **Reverse charge, Y or N.** A required field. We have no column for it.
3. **Supplier PAN.** Printed under the address.
4. **Copy title.** "Original Copy" top right. Rule 46 wants Original for
   Recipient, Duplicate for Transporter, Triplicate for Supplier.
5. **HSN/SAC-wise tax summary.** A second small table under the totals:
   HSN, tax rate, taxable amount, tax amount, total tax, and a Total row. In
   practice this is what a buyer's accountant reconciles against GSTR-2B.
6. **Amount in words.** "Rupees Twenty Seven Lakh Five Thousand Eight Hundred
   Eleven Only". Universal on Indian invoices.

**Trade practice, missing today**

7. **Billed to and Shipped to as two separate blocks.** Our invoice knows one
   buyer. Busy prints both, each with PAN, state, pincode and GSTIN. A bill
   to the head office of goods delivered to a site is ordinary wholesale.
8. **Round off, shown as its own line.** "Less: Rounded Off (-) 0.18". Our
   `gstService` already computes `roundOff` and nothing prints it.
9. **Total quantity.** "Grand Total 42,660.000 Units" beside the money.
10. **Bank details.** Account number, bank, branch, IFSC, so the customer can
    pay by transfer. We print a UPI QR and nothing else.
11. **Receiver's signature box.**
12. **A sub-description line per item.** "SARIA (TMT BAR)" then "20 MM"
    underneath. Wholesale items have a size or a shade that is not part of the
    name.

**Transport, for the e-way bill**

13. Station, E-Way Bill No., Vehicle No., Transport, GR/RR No., Dispatch From,
    Order No. and Order Date, all in the header block.

**E-invoice**

14. IRN, Ack. No., Ack. Date, and the **e-invoice QR code**, which is a
    different thing from our UPI QR and would have to sit beside it.

### The one structural difference: Bill Sundry

The example invoice bills five lines. Three are goods (TMT bar, three sizes).
Two are **INSURANCE CHARGES** under SAC 9971 and **FREIGHT** under SAC 996511,
each with its own 18% GST, each in the line table like any other line.

We hold `invoices.shipping_charge`, a single number that is added to the
taxable value and never carries its own tax rate or SAC code. That is wrong in
a way that matters: freight is a supply of service, it has its own SAC and it
can be taxed at a different rate from the goods it carries. A wholesaler who
charges freight on our invoice is under-describing it.

Fixing this is not cosmetic, it is a line table that accepts two kinds of row.

---

## 4. Invoice numbering, settled

Busy's Voucher Numbering dialog is exactly the "ring system" that was asked
for, and it confirms the two defects already recorded against our own code.

The dialog holds:

- Voucher Type (Sales) and **Series** (Main), so one voucher type can have
  several independent runs
- **Numbering Type**: Automatic or Manual, and if manual, whether to validate
  duplicate and blank numbers
- **Renumbering Frequency**: Yearly
- Embed Year in Vch. No., and a Year and Vch. No. separator
- **Prefix**: `OM/`
- **Suffix**: `/26-27`
- **Starting No.**: 1
- Specify Ending No., with a warning when so many vouchers are left
- Maintain Book No.
- **Fix Length of Numeric Part**, with a total length (maximum 9) and a
  padding character
- A live **Sample Voucher No.**: `OM/1/26-27`

And the invoice in the other screenshot reads `OM/2/26-27`, which is the same
scheme one invoice later.

Two things fall straight out of this:

- **The ring is the financial year, not the calendar year.** The suffix is
  `26-27`. Our `invoiceNumberService` uses `new Date().getFullYear()`, so our
  counter rolls over on 1 January. Already recorded as a live defect; this is
  independent confirmation of the right answer.
- **"Fixing the length" means padding the numeric part**, to a configured
  width, with a configured character. Not the same as capping the whole
  string, which is the separate 16 character limit in Rule 46(b). Both are
  real; they are different settings.

A live sample as you type is a good idea worth stealing outright.

---

## 5. Numbers and regional settings

Busy's Regional Settings screen is the "decimal, comma, thousand separator"
item on the list:

- Date Format `DD/MM/YYYY`, with its own separator
- Currency Symbol `Rs.`, Currency Character `₹`
- **Currency String `Rupees`, Sub-string `Paisa`**, which is what builds the
  amount in words
- **Currency Decimal Places: 2**
- **Format for displaying numbers: `9,99,99,999.99`**, a mask, so the Indian
  lakh and crore grouping is a setting rather than a locale guess
- Skip currency separator in number formatting
- Country and State for the company

Also on the GST screen: **Tax Rate Decimal Places: 2**, separately from the
currency, because a tax rate can want more precision than money.

Our position: we call `toLocaleString("en-IN")` in about fourteen places,
each with its own copy of a `money()` helper. Any setting added now would
reach some screens and not others. **Collapse the helpers first, then add the
setting.** That order is not negotiable or we will ship a setting that half
the product ignores.

---

## 6. What the GST config screen tells us

Busy keeps a company level GST master holding: dealer type (Regular or
Composition), return filing frequency, GSTIN, portal login, and then a set of
switches that are each a feature of ours:

- **E-Way Bill Required** Y/N, with a Config button and a **GSP Configuration**
  button beside it. Independent confirmation that the GSP question is real and
  that Busy solves it by letting each company configure its own.
- **E-Invoice Required** Y/N with its own config
- B2C QR Code Required
- ITC Tagging Required
- Enable Tax on Advance Receipts
- Default Tax Category, Default HSN Code
- **Minimum Digits for HSN Code: 6**, with the note "leave it as 0 if you do
  not want to validate minimum digits"
- Transport Details in Local Sales/Purchase

The HSN one is worth noting: we shipped a 4/6/8 digit shape check on 10 Sept.
Busy makes the **minimum** configurable, because the required number of digits
depends on the taxpayer's turnover. A wholesaler over ₹5 crore must give six
digits; under it, four is enough. Making our check a setting rather than a
constant is a small change and a more correct one.

---

## 7. What I would actually do, in order

Not a commitment, a recommendation, and each of these is a separate decision.

1. **Print what we already compute.** Place of supply with its state code,
   round off, total quantity, supplier PAN, amount in words, and the HSN-wise
   tax summary. No new concepts, no migration beyond a couple of columns, and
   it closes most of the Rule 46 gap. This is the highest value per hour of
   anything on this page.
2. **Fix the invoice number ring.** Financial year, configurable prefix and
   suffix, padded numeric part, live sample, and a cap so the whole thing
   cannot exceed 16 characters.
3. **Bill sundry as real lines.** Freight and insurance with their own SAC and
   their own rate. This one needs a schema change and should not be rushed.
4. **Purchase, Purchase Return, Payment.** The mirror of three things we
   already have, and the half of the book that is missing today.
5. **Ship-to as a separate party on the invoice.**
6. **The masters screens**, once there is a super admin to own them.

Deliberately not recommended: Journal, Contra, production, job work, bill of
material. They need double entry and a chart of accounts, and a wholesaler who
wants those wants Tally.
