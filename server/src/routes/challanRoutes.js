const express = require("express");
const {
  createForSale,
  createForOrder,
  listForOrder,
  listChallans,
  listForSale,
  getChallan,
  getChallanPdf,
  recordChallan,
  editChallan,
  cancelChallan,
  listByKind,
  pendingForParty,
  challanReasons,
  getChallanStats,
} = require("../controllers/challanController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

// A challan is a billing document, so it sits behind the same permission as
// invoices: whoever may raise a bill may send goods out against one.
router.use(authenticateToken, authorizeRoles("seller", "both"));

// The two tabs. `kind` picks sales or purchases; without one this answers as
// the old single list did, so an older client is not left with a blank screen.
router.get("/", requirePermission("invoices"), (req, res, next) =>
  (req.query.kind ? listByKind : listChallans)(req, res, next));

// Recording one directly, which is the point of the rewrite: a challan exists
// because goods moved, not because a sale went unpaid.
router.post("/", requirePermission("invoices"), recordChallan);
router.get("/reasons", requirePermission("invoices"), challanReasons);

// The cards at the top of the screen. Before /:id, or "stats" is read as an id.
router.get("/stats", requirePermission("invoices"), getChallanStats);
// What a customer or supplier still has waiting to be billed. Read by the
// sale and purchase forms the moment a party is picked.
router.get("/pending/:id", requirePermission("invoices"), pendingForParty);
router.get("/sale/:id", requirePermission("invoices"), listForSale);
router.post("/sale/:id", requirePermission("invoices"), createForSale);
// The same, from the order screen. An accepted order has a sale behind it.
router.get("/order/:id", requirePermission("invoices"), listForOrder);
router.post("/order/:id", requirePermission("invoices"), createForOrder);
router.get("/:id", requirePermission("invoices"), getChallan);
router.put("/:id", requirePermission("invoices"), editChallan);
router.post("/:id/cancel", requirePermission("invoices"), cancelChallan);
router.get("/:id/pdf", requirePermission("invoices"), getChallanPdf);

module.exports = router;
