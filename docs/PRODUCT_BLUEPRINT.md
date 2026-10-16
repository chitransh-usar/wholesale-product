RARS INNOVENTA

# Vyapari

## Product Blueprint

A B2B wholesale marketplace connecting wholesalers and retailers across India,
from price discovery through to the GST invoice.

| | |
| --- | --- |
| Product | Vyapari |
| Company | RARS Innoventa |
| Document | Product Blueprint |
| Date | 6 August 2026 |
| Prepared By | RARS Innoventa |
| Status | Working draft |

---

## Table of Contents

1. Executive Summary
2. Introduction
3. Problem Statement
4. Where Existing Platforms Fall Short
5. Vision and Mission
6. About Vyapari
7. Product Objectives
8. Target Audience
9. Solution
10. Core Features
11. Unique Selling Points
12. Competitor Positioning
13. Gap Analysis
14. Business Model
15. Pricing Strategy
16. Future Enhancements
17. Success Metrics
18. Conclusion

**About this document.** Everything describing the product is taken from a
review of the actual code, database migrations and API routes. Anything not yet
built is listed under Future Enhancements rather than written up as a feature.

Sections that would normally carry market data, such as competitor capabilities,
pricing figures and growth targets, do not carry invented numbers here. Where a
figure would be needed, the document says what has to be researched instead of
filling the gap with something that looks authoritative but is not.

---

## 1. Executive Summary

Vyapari is a B2B wholesale marketplace built for Indian trade. A wholesaler
lists what they stock. A retailer finds them, compares them against other
wholesalers selling the same product, places an order, pays by UPI, and watches
the consignment move on a map until it arrives.

The marketplace handles listings, supplier comparison, single-wholesaler orders
with multiple items, UPI payment collection, GST tax invoices with proper
CGST/SGST/IGST treatment, delivery tracking, in-app chat and verified-purchase
reviews.

Two things make it different from a directory. First, the order is a real
transaction with money and paperwork attached, not a lead handed off to a phone
call. Second, prices are recalculated on the server at checkout, so what the
retailer pays is what the wholesaler actually listed.

Section 16 sets out what comes next, including a trade credit ledger and
dedicated storefronts for wholesalers.

---

## 2. Introduction

### How Indian wholesale works

Indian retail runs on a long chain. A manufacturer sells to a distributor, the
distributor sells to a wholesaler, and the wholesaler supplies the neighbourhood
kirana, the chemist, the hardware shop, the garment store. Most of these
businesses are small, family-run, and have been trading with the same two or
three suppliers for years.

The relationships are the business. A retailer stays with a wholesaler because
that wholesaler answers the phone at nine at night, sends stock on credit before
a festival, and takes back what did not sell. None of that is written down
anywhere.

### Why digitisation is picking up

Three things changed at roughly the same time. UPI made small-value business
payments instant, so a retailer can pay a wholesaler without either of them
visiting a bank. GST made invoicing a legal requirement rather than an optional
courtesy, which pushed even small traders towards keeping records. And
smartphones reached the shop counter, so the person running the business is
already comfortable working on a screen.

### Why B2B commerce is harder than B2C

A consumer buying a phone case wants speed and a good price. A retailer buying
stock wants something else entirely.

| B2C shopping | B2B wholesale buying |
| --- | --- |
| One or two units | Minimum order quantities, often 50 or 100+ |
| One fixed price | Price depends on quantity, relationship, season |
| Pay now, always | Part payment, credit, settle next order |
| Buy once, move on | Same supplier every month for years |
| Receipt is optional | GST invoice is a legal and accounting necessity |

A platform that treats wholesale like a bigger version of retail shopping will
get the important parts wrong. That is the starting assumption behind this
product.

---

## 3. Problem Statement

### What the retailer deals with

A shop owner who wants to restock has to work the phone. They call the two
wholesalers they know, ask what today's rate is, and take whatever they are
told. There is no easy way to check whether a third wholesaler two districts
away is selling the same thing for less, because there is no list to check.

Once the order is placed, it disappears. The retailer does not know if it has
been packed, if it has left, or when it will arrive. They call to ask, and get
told it is on the way. Stock planning becomes guesswork.

Payment and paperwork are equally loose. Money moves over UPI or in cash, and
the invoice, if it comes at all, arrives later as a photo of a handwritten bill.
At GST filing time, someone has to reconstruct months of this from memory.

### What the wholesaler deals with

The wholesaler's problem is the mirror image. Their customer base is whoever
happens to know them. Growing means physically travelling to new markets or
paying for a listing on a directory that delivers phone numbers rather than
orders.

They spend a large part of the day repeating themselves on the phone, quoting
rates, confirming stock and chasing payment. Every one of those calls is a
transaction that could have been a form.

They also carry real risk. Stock goes out on trust, and payment comes in later,
if it comes. There is no record of who pays reliably and who does not, other
than what they remember.

### What both sides lose

| Problem | Cost to the business |
| --- | --- |
| No price visibility | Retailers overpay; good wholesalers cannot prove they are cheaper |
| No order visibility | Retailers hold extra stock as a buffer, tying up cash |
| Paperwork after the fact | GST filing is painful and error-prone for both sides |
| Trust is undocumented | A good payment record is worth nothing to a new supplier |
| Everything runs on calls | The working day is consumed by coordination, not selling |

---

## 4. Where Existing Platforms Fall Short

There is no shortage of B2B platforms in India. The gap is that most of them
solve only one slice of the problem.

**Directories stop at the introduction.** IndiaMART and TradeIndia are built
around helping a buyer find a supplier, then handing over contact details.
Everything after that, meaning negotiation, order, payment, invoice and
delivery, happens off-platform with no record. The platform earns from the
introduction, so it has little commercial reason to follow the transaction
further.

**Managed marketplaces take over the relationship.** Udaan operates a
buy-and-resell model. That makes the experience consistent, but it puts the
platform between the wholesaler and their customer. The wholesaler becomes a
supplier to Udaan rather than a business with its own customers.

**Storefront tools assume you already have customers.** Shopify and similar
products are good for running your own shop, but they are not a marketplace. A
wholesaler using one still has to find every buyer themselves.

**Informal trade credit is largely unserved.** Goods now, part payment now,
balance against the next order is how a great deal of this trade actually
settles. Traders keep doing it in a paper khata alongside whatever platform they
use.

---

## 5. Vision and Mission

### Vision

To make wholesale trade in India work the way retail already does. You can see
what things cost, you can see where your order is, and you have the paperwork
when you need it.

### Mission

To reduce the distance between wholesalers and retailers. Practically, that
means:

- Letting a retailer compare real suppliers on real numbers before ordering
- Making every order produce a proper GST invoice without extra work
- Showing the retailer where their consignment is, without needing a driver app
- Keeping the wholesaler's customer relationship theirs, not ours
- Putting the credit that already happens informally onto a record both sides
  can trust

---

## 6. About Vyapari

Vyapari is a marketplace with two connected sides.

### The buying side

A retailer browses by category or search. Products are shared entities, so one
"Steel Bolt" record exists and several wholesalers sell against it. When a
retailer opens a product, they see every wholesaler offering it side by side,
with price, minimum order quantity, stock, shipping days, rating and orders
delivered.

They pick a supplier, set a quantity, and check out. An order can hold several
products but only from one wholesaler, because one order should mean one
consignment on one truck. Payment is a UPI QR generated from that wholesaler's
own UPI ID, so money goes directly from retailer to wholesaler.

After paying, the retailer can follow the delivery on a map and download the GST
invoice from the order page.

### The selling side

A wholesaler gets a separate workspace, styled differently from the storefront
so it reads as its own tool. They list products, manage stock and pricing, see
incoming orders, raise and track invoices, run GST and ageing reports, and
message buyers.

The workspace is restricted to wholesalers. Retailers cannot open it, which is
why anything a retailer needs, such as their orders and their invoices, lives on
the buying side instead.

### Who it is built for

Small and mid-sized Indian wholesalers who want more customers without giving up
control of their pricing, and independent retailers who are tired of buying
blind. It assumes both parties are comfortable with UPI and WhatsApp.

---

## 7. Product Objectives

| Objective | What it means concretely |
| --- | --- |
| Make prices comparable | Show every supplier for a product on one screen with the numbers that matter |
| Make the order a real record | Server-side pricing, stock checks, line items, an audit trail |
| Remove invoice work | A GST invoice is generated automatically from the order |
| Make delivery visible | Track a consignment without asking the driver to install anything |
| Keep the relationship direct | Payment goes wholesaler to retailer; the platform does not sit in the middle |
| Build a usable trust record | Verified-purchase reviews and delivered-order counts, computed from real activity |

---

## 8. Target Audience

| Segment | Who they are | What they need | Supported today |
| --- | --- | --- | --- |
| Wholesalers | Small to mid-sized traders supplying a district or region | More customers, fewer phone calls, automatic invoicing | Full |
| Retailers | Kirana stores, chemists, hardware and garment shops | Price comparison, order visibility, proper bills | Full |
| Distributors | Sit between manufacturer and wholesaler; buy and sell in bulk | Both sides of the platform in one account | Partial |
| Manufacturers | Sell direct to wholesalers, in large lots | Bulk listings, dealer and territory management | Not specifically |

Distributors are served by the `both` role, which lets one account buy and sell,
with purchases and sales kept separate. Manufacturers can list as wholesalers.
Dealer and territory management is on the roadmap rather than in the product.

---

## 9. Solution

Each problem in Section 3 maps to something specific in the product.

| Problem | What Vyapari does about it |
| --- | --- |
| No way to compare prices | One product, many suppliers, side by side with price, MOQ, stock, shipping, rating, orders delivered |
| Orders vanish after placement | A status trail on every order, plus a live map from warehouse to destination |
| Invoices are an afterthought | A GST invoice is raised when the order is placed and settled when payment lands |
| Everything runs on phone calls | In-app chat over websockets, with a WhatsApp fallback |
| Prices manipulated at checkout | The server re-prices every line against live inventory and ignores the client's amount |
| Overselling | Stock deduction is a guarded update that fails rather than going negative |
| Trust is undocumented | Reviews restricted to verified buyers; delivered-order counts computed from real orders |

---

## 10. Core Features

### 10.1 Authentication and Access

Registration captures name, email, phone, password and a role. Passwords are
hashed with bcrypt. Sessions are JWTs carrying the user id and role.

There are three roles. A `buyer` shops, a `seller` sells, and `both` does
either. A buyer who wants to start selling can upgrade through a dedicated
endpoint, which moves them to `both` while keeping their history intact.

The seller workspace is guarded on the route and again on every API call. A
retailer who reaches a seller URL is redirected with an explanation rather than
shown a page they cannot use.

**Why it matters.** Roles decide what someone sees and what they are allowed to
do, on both the interface and the API.

### 10.2 Vendor Management

Each wholesaler has a business profile: company name, GSTIN, contact phone,
city, UPI ID and warehouse address with state and pincode. The warehouse is
stored on the business rather than per product, because deliveries leave from
the same yard regardless of what is in the box.

Public wholesaler profiles show verification status, years in business, city,
orders delivered, rating, review count and the full catalogue.

**Why it matters.** A retailer buying from someone they have never met needs
something to go on. Everything shown is either declared by the wholesaler or
counted from real activity.

### 10.3 Product Management

Products are shared. When a wholesaler lists an item, they either attach to an
existing product or create a new one, then add their own listing against it with
their price, bulk price, MOQ, stock, shipping days and image.

This is what makes comparison possible, with several wholesalers against one
product rather than many near-duplicate listings. A database constraint prevents
a wholesaler listing the same product twice; they are asked to edit the existing
listing instead. Images upload directly to Cloudinary from the browser.

**Why it matters.** Without a shared catalogue, comparison is impossible and
search returns the same item many times over.

### 10.4 Inventory

Stock, MOQ, price and status live on the listing. The seller dashboard reports
active listings, total stock value, items out of stock, and items that have
fallen below their own MOQ, since a listing nobody can order from is as good as
unavailable.

Stock is deducted when an order is placed, and returned if payment never
completes, so abandoned checkouts do not quietly consume inventory.

**Why it matters.** An accurate stock number is the difference between a
confirmed order and an apology.

### 10.5 Pricing

Each listing carries a standard price and an optional bulk price that applies
once quantity reaches the MOQ threshold. The wholesaler sets both.

The important part is where pricing is decided. At checkout the server looks up
every line against live inventory and recalculates the total. Any amount sent by
the client is ignored.

**Why it matters.** This closes the most obvious way to attack a marketplace. It
also means a price change between adding to cart and paying is handled correctly
rather than silently honoured.

### 10.6 Orders

An order can contain several products but only from one wholesaler. Attempting
to mix suppliers is rejected. One order means one consignment.

Every order writes line items, a delivery address with optional map-pinned
coordinates, and a status history entry. The lifecycle is a validated state
machine, so an order moves through its stages in sequence and cannot jump from
placed to delivered.

**Why it matters.** An order that carries its own history is something both
sides can refer back to, rather than an argument about what was agreed.

### 10.7 Payments

Payment is UPI, direct between the two businesses. The platform generates a QR
from the wholesaler's own UPI ID with the amount and order reference pre-filled.
The retailer scans it in any UPI app, pays, and confirms on the platform.

There is no payment gateway. Money never passes through the platform, which
means no settlement delay for the wholesaler and no gateway fee on either side.

**Why it matters.** UPI is how this trade already settles. Putting a gateway in
between would add cost and delay for no benefit.

### 10.8 Invoicing and GST

Every order produces a proper tax invoice.

| Element | How it works |
| --- | --- |
| Numbering | Sequential per year, with a prefix each wholesaler configures |
| Tax split | CGST and SGST within a state, IGST across states, resolved by state |
| Line detail | HSN code, quantity, unit price, GST percent, tax and line total |
| Both parties | Names, GSTINs and contact details for supplier and buyer |
| Payment | UPI QR embedded in the PDF, and a paid or unpaid watermark |
| Defaults | Payment window, tax rate, notes and terms, saved per wholesaler |
| Reporting | GST summary and receivables ageing buckets |
| Export | CSV, Excel and a PDF summary, all matching the filters on screen |

There is exactly one invoice per order, issued by the seller. The buyer
downloads that same document from their order page.

**Why it matters.** This is the part that turns an informal transaction into a
record both sides can file. It is also the feature most likely to bring a
reluctant trader onto the platform, because it removes work they currently do by
hand.

### 10.9 Delivery Tracking

Tracking is built around what exists on the ground. Most delivery in this trade
is done by a driver in a hired vehicle who is not a platform user and will not
install an app.

So the wholesaler generates a link and sends it over WhatsApp or SMS. The driver
opens it in whatever browser their phone has and taps once to share location.
The page reports position while it stays open. No account, no app, no background
permission. Links are scoped to one order and expire.

The wholesaler can also add checkpoints by hand, which covers the case where the
driver does not use the link. The retailer sees a map with the warehouse, the
checkpoints passed so far, the current position and the destination.

**Why it matters.** Any tracking design that depends on a driver app is likely
to fail in this market. This one degrades gracefully, so at worst the wholesaler
adds checkpoints manually and the retailer still sees progress.

### 10.10 Communication

Real-time chat runs over websockets, with unread counts and read receipts. For
traders who prefer WhatsApp, a deep link opens a chat with the product details
pre-filled.

Notifications cover in-app and email, with SMS, WhatsApp and push available once
the relevant provider credentials are configured.

### 10.11 Reviews and Ratings

Retailers can review products and sellers for orders they have actually
purchased. The check is enforced server-side against the order record. Reviews
support helpful votes, seller replies and reporting. Ratings feed the supplier
comparison and the wholesaler profile.

**Why it matters.** An open review system on a B2B marketplace becomes a
competitive weapon quickly. Restricting it to real purchases is what makes it
meaningful.

### 10.12 Seller Analytics

The dashboard shows revenue received over 30 days with a trend against the
previous 30, value awaiting payment, distinct customers, average order value and
buyer rating. Alongside that is a fulfilment pipeline and inventory health.

Every figure is computed from orders, inventory and reviews. Where there is no
data yet, the dashboard shows nothing rather than a zero that reads as failure.

---

## 11. Unique Selling Points

**The order is a transaction, not a lead.** Directories introduce the two
parties and step away. Here the order, the money, the invoice and the delivery
all live in one place with one record.

**Payment goes direct.** UPI from retailer to wholesaler, with no gateway, no
settlement wait and no cut taken in the middle.

**GST invoicing is real, not a receipt.** Correct interstate treatment, HSN
codes, per-seller numbering and ageing reports. Built for the filing, not just
for the customer.

**Tracking that does not need a driver app.** A one-tap browser link and manual
checkpoints, designed for how goods actually move here.

**Comparison on facts.** Orders delivered, verified-purchase ratings and live
stock, every one of them counted from real activity on the platform.

**The wholesaler keeps their customer.** The platform does not buy and resell.
The relationship, the pricing and the terms stay with the trader.

---

## 12. Competitor Positioning

The table below compares business models, which are a matter of public
positioning. It deliberately does not compare features.

| Platform | What it fundamentally is | Who pays it | Role in the transaction |
| --- | --- | --- | --- |
| IndiaMART | Supplier directory and lead engine | Suppliers, for leads | Introduces, then exits |
| TradeIndia | Supplier directory | Suppliers, for listings | Introduces, then exits |
| ExportersIndia | Export-focused directory | Suppliers, for listings | Introduces, then exits |
| Udaan | Managed B2B marketplace | Margin on goods | Buys and resells |
| Shopify | Storefront software | Merchants, subscription | Not a marketplace |
| Vyapari | Transactional B2B marketplace | To be decided, see Section 14 | Hosts the whole transaction |

A feature-by-feature comparison is not included, and should not be produced
without research. Asserting what each competitor does and does not support would
require actually using their products or reading current documentation. Any such
table written from memory would be unreliable, and unreliable competitor claims
tend to get quoted in a pitch and then contradicted by someone in the room who
uses the product.

**Recommended next step.** Sign up as a supplier and as a buyer on IndiaMART,
TradeIndia and Udaan, and record what each one actually does at each stage:
discovery, quoting, ordering, payment, invoicing, delivery and dispute. That
produces a comparison that will survive scrutiny.

What can be said without research is structural. The established players have
reach, mobile apps and operational scale. The argument for Vyapari is not
size; it is that it covers the part of the trade that a directory hands back to
the phone.

---

## 13. Gap Analysis

| Gap in the market | Who leaves it open | How Vyapari addresses it | Status |
| --- | --- | --- | --- |
| Buyer cannot compare suppliers on identical goods | Directories | Shared product catalogue with side-by-side comparison | Built |
| Transaction happens off-platform, leaving no record | Directories | Order, payment, invoice and delivery recorded together | Built |
| Platform inserts itself between the two businesses | Managed marketplaces | Direct UPI, no reselling, wholesaler keeps pricing and terms | Built |
| GST paperwork is manual | Directories, storefront tools | Automatic tax invoice with correct interstate treatment | Built |
| Tracking assumes a driver app | Most logistics tooling | One-tap browser link plus manual checkpoints | Built |
| Reviews are gameable | Directories | Verified-purchase only, enforced server-side | Built |
| Informal trade credit has no record | Most platforms | Credit ledger with per-pair terms and no interest | Roadmap |
| Wholesalers cannot differentiate their range | Directories, marketplaces | Dedicated wholesaler storefronts | Roadmap |

---

## 14. Business Model

Vyapari does not buy or hold stock, so revenue has to come from the service
rather than a margin on goods. These are the options available to a product
shaped like this one.

| Stream | How it would work |
| --- | --- |
| Wholesaler subscription | Recurring fee for the seller workspace beyond a free listing tier |
| Transaction commission | A percentage on completed orders |
| Verification | Paid badge after checking GSTIN and business documents |
| Featured placement | Paid position in category and search results |
| Credit facilitation | Fee for underwriting or guaranteeing trade credit |
| Logistics partnerships | Referral share from transport partners booked through the platform |

**One constraint worth noting.** Because payment goes directly between the two
businesses over UPI, commission cannot be deducted at source. Collecting it
means invoicing the wholesaler separately, which is harder to do before the
platform is visibly generating orders for them.

That points towards leading with subscription and verification, both of which
are collectable from day one, and introducing commission later. This is a
recommendation rather than a decision, and no revenue split or projection has
been modelled.

---

## 15. Pricing Strategy

No price points are proposed in this document, because there is no basis for
them yet. Nothing in the product implies a price, and no wholesalers have been
interviewed. Numbers written now would be guesses that later get treated as
research.

What can be set now is the shape of the plan and the reasoning behind it.

| Decision | Position | Reasoning |
| --- | --- | --- |
| Retailer pricing | Free | Retailers are the demand side. Charging them would prevent the network forming |
| Free tier for wholesalers | Yes, genuinely usable | A crippled free tier means an empty catalogue, and an empty catalogue is worthless to retailers |
| What sits behind payment | Invoicing depth, GST and ageing reports, analytics, tracking | These replace work a wholesaler currently does by hand, which is the easiest value to argue for |
| Verification | Paid | It costs real effort to check a GSTIN and business documents |
| Tier structure | One free, two paid | Enough to separate a small trader from a larger one without becoming a pricing matrix |

**What has to happen before prices are set.** Interview a sample of wholesalers
across at least two categories and two cities. Find out what they currently pay
for listings or leads, and what a month of the seller workspace would have to
save them to be worth paying for. Price against that, not against a competitor's
published rate card.

---

## 16. Future Enhancements

### Wholesaler storefronts

Every wholesaler gets their own space on Vyapari where they can present
their range on their own terms, rather than only appearing as one row in a
comparison table.

The reason this matters is competitive. A wholesaler who has sourced something
genuinely distinctive currently has no way to show it without immediately
inviting every other seller to list the same thing beside it. A dedicated
storefront gives them somewhere to build a presence around what makes their
range worth buying, with their own branding, their own arrangement of products
and a link they can share with their existing customers.

It also gives the platform something to sell. A storefront is a natural paid
tier, and it is the kind of feature a wholesaler will pay for because it is
visibly theirs.

### Order status management

Wholesalers will be able to move an order through its stages from the dashboard:
accepted, packed, dispatched and delivered. The lifecycle already exists
underneath; this puts simple controls on top of it so a wholesaler can mark
progress in a couple of taps.

### Payment verification

Payment confirmation is currently a straightforward acknowledgement from the
buyer. The next step is for the platform to verify the payment itself, or for
the wholesaler to confirm receipt, so that both sides are working from the same
record. This is also the prerequisite for trade credit.

### Trade credit ledger

Terms agreed per wholesaler and retailer pair, with a down payment on delivery
and the balance carried to the next order. No interest, since the point is to
formalise what already happens rather than to lend. The platform warns when a
limit is approached, and a retailer reliability score builds from payment
history.

### Admin console

An internal console for review moderation, promotion management and support.

### Promotions

Flash sales, coupons, loyalty points, referrals and gift cards, with the screens
for wholesalers and the platform team to run them.

### Regional pricing

Prices varying by region based on demand. This needs care, because the logic has
to be predictable enough that a wholesaler can tell what their customer sees.

### Longer term

| Enhancement | Why |
| --- | --- |
| Mobile apps | Most of this trade happens on a phone at a counter |
| Regional languages | English is a real barrier for a large part of the market |
| RFQ and negotiation | Large orders get negotiated; the product assumes list prices |
| Logistics integration | Book transport through the platform |
| GSTIN verification API | Automatic verification instead of manual document checks |
| Return management | A full returns workflow for both sides |
| Dealer and territory management | For manufacturers selling through a dealer network |
| Demand forecasting | Suggest restocking from order history |

---

## 17. Success Metrics

No targets are given below. Vyapari has not launched, so any number here
would be invented, and invented targets are worse than none because teams plan
against them. What follows is what to measure and why it matters. Baselines
should be taken from the first full quarter of live usage, and targets set from
those.

### The metric that matters most

**Repeat order rate**, meaning the share of retailers who place a second order
within 60 days. A wholesale marketplace lives or dies on repeat purchasing. One
order can be curiosity; the second means something was actually solved.

### Growth

| Metric | What it tells us |
| --- | --- |
| Registered wholesalers | Supply depth |
| Registered retailers | Demand |
| Active listings | Whether the catalogue is worth browsing |
| Share of wholesalers with more than a handful of listings | Genuinely committed sellers, as opposed to sign-ups |

### Transaction health

| Metric | What it tells us |
| --- | --- |
| Orders per month | Core volume |
| Repeat order rate over 60 days | Whether the product works |
| Average order value | Whether real restocking is happening, or only trial orders |
| Payment completion rate | How many started checkouts finish |
| Share of orders reaching delivered | End-to-end completion |

### Quality

| Metric | What it tells us |
| --- | --- |
| Average seller rating | Supply-side quality |
| Share of orders that receive a review | Whether the trust signal has enough data behind it |
| Disputes per hundred orders | Friction between the two parties |
| Invoice download rate | Whether the GST feature is genuinely used or merely present |

### Commercial

| Metric | What it tells us |
| --- | --- |
| Free to paid conversion | Whether the paid tier is worth its price |
| Monthly recurring revenue | Predictable income |
| Subscription retention | Whether value persists past the first month |
| Gross merchandise value | Total trade flowing through the platform |

---

## 18. Conclusion

Vyapari sets out to do the part of wholesale trade that existing products
leave to phone calls and paper. A retailer can compare real suppliers on real
numbers, order from one of them, pay directly by UPI, watch the consignment
arrive, and download a GST invoice their accountant can use. A wholesaler gets
customers beyond the ones they have personally met, without handing over their
pricing or their relationships.

The marketplace, ordering with server-verified pricing, UPI collection, GST
invoicing, delivery tracking, messaging and verified reviews are all in place.

What comes next builds on that foundation. Dedicated storefronts give
wholesalers a place to stand out rather than blend into a comparison table. A
trade credit ledger addresses a need most traders have and few platforms serve.
Between them they turn a working marketplace into one that traders have a reason
to stay on.

---

Vyapari · Product Blueprint · RARS Innoventa · 6 August 2026
