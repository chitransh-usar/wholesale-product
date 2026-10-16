const express = require("express");
const path = require("path");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const profileRoutes = require("./routes/profileRoutes");
const orderRoutes = require("./routes/orderRoutes");
const messagesRoutes = require("./routes/messagesRoutes");
const promotionRoutes = require("./routes/promotionRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const trackRoutes = require("./routes/trackRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const partyRoutes = require("./routes/partyRoutes");
const saleRoutes = require("./routes/saleRoutes");
const overviewRoutes = require("./routes/overviewRoutes");
const creditNoteRoutes = require("./routes/creditNoteRoutes");
const staffRoutes = require("./routes/staffRoutes");
const hsnRoutes = require("./routes/hsnRoutes");
const challanRoutes = require("./routes/challanRoutes");
const masterRoutes = require("./routes/masterRoutes");
const exportRoutes = require("./routes/exportRoutes");
const importRoutes = require("./routes/importRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const stockRoutes = require("./routes/stockRoutes");
const dayBookRoutes = require("./routes/dayBookRoutes");
const routeRoutes = require("./routes/routeRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const marketplaceAccountRoutes = require("./routes/marketplaceAccountRoutes");

const app = express();

app.use(cors());

/**
 * Webhooks are mounted BEFORE express.json, and the order is load bearing.
 *
 * Razorpay signs the raw bytes of the request. Once express.json has parsed
 * the body there is no way back to those bytes: re-serialising the object
 * changes key order, spacing and unicode escaping, so the HMAC would never
 * match and every genuine webhook would look forged. The route supplies its
 * own express.raw parser.
 */
app.use("/api/webhooks", webhookRoutes);

app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/reviews", reviewRoutes);
// Public driver tracking links (token in the URL is the credential)
app.use("/api/track", trackRoutes);
// Enterprise Invoice Management API
app.use("/api/invoices", invoiceRoutes);
// The notification bell in the navbar calls these on every page; without the
// mount every request 404s.
app.use("/api/notifications", notificationRoutes);
// Wholesale 3.0: the wholesaler's own customer book.
app.use("/api/parties", partyRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/overview", overviewRoutes);
app.use("/api/credit-notes", creditNoteRoutes);
// A wholesaler's employees. Owner only, except the invite acceptance.
app.use("/api/staff", staffRoutes);
// HSN suggestions for the boxes on the product and sale screens.
app.use("/api/hsn", hsnRoutes);
// Goods sent out while payment is outstanding. See challanService.js.
app.use("/api/challans", challanRoutes);
// The platform administrations: states, units, tax slabs, HSN codes.
app.use("/api/masters", masterRoutes);
// A wholesaler's own data, out as a zip. No id in the route, on purpose:
// see exportRoutes for why.
app.use("/api/exports", exportRoutes);
// And the other direction: a book coming in from a spreadsheet. No id in
// these routes either, and this side writes.
app.use("/api/imports", importRoutes);
// The other direction: goods coming in, who they came from, and what is owed
// for them. See services/supplierBalance.js for why this is not the party book.
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchases", purchaseRoutes);

// What is on hand, summed from the stock ledger rather than stored.
app.use("/api/stock", stockRoutes);

// The day book, and what is payable by age.
app.use("/api/daybook", dayBookRoutes);
// Getting a wholesaler ready to be paid through the gateway, and what they have
// been sent. See controllers/routeController.js for why only 'activated'
// opens the gate.
app.use("/api/seller/razorpay", routeRoutes);
// Extra Amazon and Flipkart accounts, each with its own run of bill numbers.
app.use("/api/marketplace-accounts", marketplaceAccountRoutes);

module.exports = app;
