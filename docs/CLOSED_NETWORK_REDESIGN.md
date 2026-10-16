RARS INNOVENTA

# Vyapari, closed network redesign

## Working notes, not a final design

| | |
| --- | --- |
| Product | Vyapari |
| Document | Closed network redesign |
| Date | 18 August 2026 |
| Status | **DRAFT. Not agreed. To be discussed and finalised.** |
| Supersedes | The marketplace direction in `docs/PRODUCT_BLUEPRINT.md` |

**Read this first.** Nothing in this document is settled. It captures where the
thinking reached on 18 August 2026, after the product review meeting, so the
discussion can start from something concrete rather than from memory. Sections
marked "open" have not been decided at all. Do not start building from this
without confirming it first.

`docs/PRODUCT_BLUEPRINT.md` describes the older marketplace model. It is not
wrong about what the code does today, but it no longer describes where the
product is going. Treat it as history until it is rewritten.

---

## 1. What changed

The product was a B2B marketplace. A retailer signed up, browsed every
wholesaler, compared prices side by side, and ordered from whoever was cheapest.
Discovery was the product.

The review meeting on 18 August 2026 replaced that with a closed network. The
wholesaler already knows his retailers. The relationship lives in WhatsApp, phone
calls and a paper diary today. The product's job is to be the IT backbone for
that existing relationship, not to introduce strangers to each other.

Two lines from the meeting notes carry most of the weight:

- **No B2B marketplace, no Amazon type.** Nothing is browsable across sellers.
- **No Products.** There is no shared product catalogue.

The second one is easy to misread. It does not mean the system has no items. It
means there is no global `products` entity that several wholesalers list against.
Items belong to one wholesaler. His rate list is his own, and nobody compares it
to anyone else's.

## 2. Decisions taken so far

These were confirmed in conversation and are the least likely parts to move.

| Question | Decision |
| --- | --- |
| Can a retailer buy from several wholesalers? | Yes. Many to many. |
| Do retailers place orders in the app? | Yes, but against one wholesaler's private rate list. No browsing, no comparison. |
| Where does a sale come from first? | Manual entry, both retailer-placed and wholesaler-typed. Bulk import comes later. |
| Is analytics for both sides? | Wholesaler only. |
| Security and compliance work | Explicitly deferred. Prototype first. |
| B2C | Last, after everything else. |

## 3. The principle worth keeping

**A wholesaler must get full value with zero retailers signed up.**

He should be able to type his rate list, record sales by hand, see his customer
book, print invoices and read his analytics on day one, before a single retailer
joins. Retailer ordering is then additive, and it saves him the typing.

This matters for the pilot. If the product only works once a wholesaler has
persuaded his customers to sign up, there is a chicken and egg problem across
every account at once.

## 4. Data model, proposed

```
wholesaler_retailers   wholesaler, retailer, status, label, joined_at
retailer_invites       token, phone, wholesaler, expires_at
items                  wholesaler_id, name, unit, pack_size, rate, moq
item_rates             item_id, retailer_id, rate
sales                  wholesaler, retailer, source, lines, status
```

Notes on each:

**`wholesaler_retailers`** is the membership table the whole pivot rests on.
Every buyer-facing query gains a join against it, the same defence in depth used
for listing visibility, so that no single missed path becomes the leak. `label`
is the name the wholesaler uses for that customer internally, which is often not
the registered business name.

**`items`** replaces the shared `products` table. Pack size, unit and minimum
order quantity live here, because "1 item" is not how anything is sold in
wholesale. It is sold by case, dozen, metre or kilo.

**`item_rates`** carries the special price a wholesaler gives a particular
customer. Every wholesaler does this quietly today and no ecommerce data model
supports it.

**`sales.source`** is the important one. A sale either arrives from a retailer or
is typed by the wholesaler, and both land in the same table with a flag saying
which. If they become two tables, the ledger and the analytics have to reconcile
two shapes forever.

## 5. Wholesaler side

Nav: **Today, Retailers, Items, Sales, Invoices, Analytics, Settings.**

**Today** replaces the dashboard overview. Three action queues, no vanity
numbers: orders waiting on you, payments due, stock running low.

**Retailers** is the customer book, and it is the screen that sells the product.
A list of customers with lifetime business, last order date and outstanding
balance. Opening one gives the full purchase history, what they usually buy, what
they owe, their special rates, and a way to message them. Every wholesaler in the
pilot has this information scattered across a phone, a diary and WhatsApp.
Putting it on one screen is the demo.

**Items** is a rate list, not a product catalogue, and should be called a rate
list in the UI because that is what a trader says. Dense table, inline rate
editing, bulk update.

**Sales** is one list holding both incoming retailer orders and manually recorded
sales, with a prominent "Record a sale" action. Pick a customer, add lines, save,
invoice follows.

**Analytics** is wholesaler only. Worth keeping in its own module from the start,
since it is the surface most likely to sit behind a subscription plan later.

## 6. Retailer side

Deliberately thin. Bottom tab bar on mobile: **Suppliers, Orders, Dues,
Profile.** A tab bar rather than a shop header, because this is a tool.

**Suppliers** reads like a chat list. One row per connected wholesaler with last
order and amount due. There is no other way in.

**Order pad** is what opens when a supplier is tapped. Dense rows, small
thumbnails, quantity steppers, running total pinned to the bottom, special rates
applied where they exist.

```
[img]  Cotton Shirting 2x2      Pack 20 mtr    Rs 142/mtr   [-]  40  [+]   Rs 5,680
[img]  Poplin White 60s         Pack 25 mtr    Rs  98/mtr   [-]   0  [+]          .
[img]  Linen Blend Natural      Pack 20 mtr    Rs 210/mtr   [-]  20  [+]   Rs 4,200
--------------------------------------------------------------------------------
 3 items  Rs 9,880                                              [ Send order ]
```

A trader should see 25 items per screen, not 6 cards. Numbers carry the visual
weight, images are demoted to identifying thumbnails. This density change is most
of what makes the product stop feeling like ecommerce, more than any colour or
font decision.

**Repeat last order** matters more than search. Most orders are last month's
order with two things changed.

The cart today is a single global cart tied to one seller
(`client/src/context/CartContext.jsx`). Switching supplier would discard a half
built order. It needs to become a saved draft per supplier, so the supplier list
can show "draft, 6 items" against a row.

## 7. What gets switched off

Marketplace home, cross-seller search, supplier comparison, wishlist, reviews,
flash sales, public product pages, and the shared `products` table.

Flagged off, not deleted. The meeting put paid retailer acquisition on the
roadmap as an add-on, and B2C is planned for later. Both are this code turned
back on rather than rebuilt. The invoice module survives nearly whole and is the
largest reusable asset in the repository.

## 8. Proposed build order

1. Connection table and invite link, so a wholesaler can attach his retailers
2. `items` as wholesaler-owned, migrated off the shared product table
3. Record a sale, wholesaler side, writing to `sales`
4. Retailers book and the customer page
5. Order pad and per-supplier drafts, retailer side
6. Special rates per customer
7. Order states through to delivered
8. Analytics

Steps 1 to 4 give a wholesaler something usable on his own. Step 5 is where his
retailers join. Import, compliance and B2C sit after all of it.

Step 7 closes a gap that already exists: nothing in the current UI advances an
order past `payment_completed`, so orders stall there. Harmless in a demo, fatal
in a pilot with real deliveries.

## 9. Open, not yet decided

- Whether wholesalers get analytics in the prototype at all, or only after the
  subscription work
- What the khata and credit terms look like. Agreed so far only that terms are
  negotiable per pair, the system warns on limit, and there is no interest
- Whether retailers need a login at launch, or whether the wholesaler operates
  entirely alone during the pilot
- Whether messaging survives, or WhatsApp remains the channel
- Naming throughout the UI. "Rate list" versus "Items", "Sales" versus "Orders"
- Pricing and subscription tiers

## 10. Practical constraints found while planning

**Phone contacts cannot be fetched by a website.** The meeting notes raise
pulling a wholesaler's contacts, with a question mark against it. The question
mark is justified. Chrome on Android offers a limited picker where the user
selects contacts one at a time, and iOS Safari offers nothing. Realistically this
is CSV or Excel upload now, vCard as a second option, and true contact sync only
if a mobile app is built.

**Government GST APIs are not openly available.** Access goes through a licensed
GST Suvidha Provider and is a paid procurement, not a coding task. HSN rate
lookup can be served from a static dataset for free. Worth knowing before it is
put on a sprint.

## 11. Existing GST defects, recorded here so they are not lost

Found while planning, present in the code today, and independent of which
direction the product takes. Deferred by decision, not by oversight.

1. **Every invoice line declares HSN 8504**, which is electrical transformers.
   Hardcoded in `gstService.js`, `invoiceService.js`, `invoiceRepository.js` and
   `pdfService.js`. Listings have no HSN field at all.

2. **Retailers have no GSTIN on any invoice.** `authController.js` only creates a
   `wholesaler_profiles` row when the role is `seller` or `both`, so the buyer
   join in `invoiceService.js` always returns NULL and the PDF prints "N/A".
   Without the recipient GSTIN a retailer cannot claim input tax credit, which is
   the main reason they want the invoice.

3. **The wrong tax head is applied.** The same NULL leaves `buyer_city` empty, so
   the GST calculation falls back to a hardcoded "Delhi" and compares it against
   the seller's real city. A Surat seller billing a Surat retailer is charged
   IGST instead of CGST and SGST. The fix is to read the state code from the
   first two digits of the GSTIN rather than matching city names, and to fail
   loudly rather than defaulting.

4. **`DELETE /api/invoices/:id` exists.** An issued invoice cannot be deleted
   under GST, it is reversed with a credit note.

## 12. Next step

Discuss and finalise. Once the design is agreed, this document should either be
updated to reflect what was decided or folded into a rewritten
`docs/PRODUCT_BLUEPRINT.md`, and `CLAUDE.md` updated so the next session is not
working from the marketplace assumptions.
