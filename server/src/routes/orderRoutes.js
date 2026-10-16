const express = require("express");
const {
  createOrder,
  createManualOrder,
  getPaymentDetails,
  initiatePayment,
  updatePaymentStatus,
  getOrderById,
  getSupplierOrders,
  getBuyerOrders,
  updateOrderStatus,
  cancelOrderHandler,
  refundOrder,
  getOrderTimelineHandler,
  requestReturn,
  generateInvoice,
  generatePackingSlip,
  sendInstallmentReminder,
} = require("../controllers/orderController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");
const { getTracking, addCheckpoint } = require("../controllers/trackingController");
const { createLink, getOrderLink } = require("../controllers/driverLinkController");
const {
  createRazorpayOrder,
  simulateRazorpayPayment,
  verifyRazorpayPayment,
} = require("../controllers/razorpayController");

const router = express.Router();

// Anything a buyer owns is authorized per order, by buyer_id, inside the
// handler. Gating those on the account role as well hid a seller's own
// purchases from them and, because the client treats 403 as a dead session,
// logged them out mid-browse. Supplier-side routes stay role-gated: they act
// on someone else's order.
router.get("/supplier", authenticateToken, authorizeRoles("seller", "both"), requirePermission("orders"), getSupplierOrders);
router.get("/buyer", authenticateToken, getBuyerOrders);
router.post("/create", authenticateToken, createOrder);

// An order the WHOLESALER types, for one taken on the phone or at the counter.
// Behind the orders permission and the seller roles, unlike /create which is
// the buyer placing one on the marketplace.
router.post("/manual", authenticateToken, authorizeRoles("seller", "both"),
  requirePermission("orders"), createManualOrder);
router.get("/:orderId/payment-details", authenticateToken, getPaymentDetails);
router.post("/:orderId/payment", authenticateToken, initiatePayment);
router.post("/:orderId/send-installment-reminder", authenticateToken, authorizeRoles("seller", "both", "admin"), sendInstallmentReminder);
router.put("/:orderId/payment-status", authenticateToken, updatePaymentStatus);

// Razorpay, scaffolded. Order creation is a stub and verification is real in
// both modes; see services/razorpayService.js for what that buys and what is
// still missing. "simulate" stands in for the gateway and refuses to exist the
// moment a real secret is configured.
router.post("/:orderId/razorpay/order", authenticateToken, createRazorpayOrder);
router.post("/:orderId/razorpay/simulate", authenticateToken, simulateRazorpayPayment);
router.post("/:orderId/razorpay/verify", authenticateToken, verifyRazorpayPayment);
router.patch("/:orderId/status", authenticateToken, authorizeRoles("seller", "both", "admin"), requirePermission("orders"), updateOrderStatus);
// Not role gated. Both sides of an order may call it off, and who is allowed
// is decided against the order itself. Gating this on the seller role would
// take a buyer's own cancel button away, and a 403 logs people out.
router.post("/:orderId/cancel", authenticateToken, cancelOrderHandler);
router.get("/:orderId/timeline", authenticateToken, getOrderTimelineHandler);
router.get("/:orderId/tracking", authenticateToken, getTracking);
router.post("/:orderId/checkpoints", authenticateToken, authorizeRoles("seller", "both"), requirePermission("orders"), addCheckpoint);
router.get("/:orderId/driver-link", authenticateToken, authorizeRoles("seller", "both"), getOrderLink);
router.post("/:orderId/driver-link", authenticateToken, authorizeRoles("seller", "both"), requirePermission("orders"), createLink);
router.post("/:orderId/return", authenticateToken, requestReturn);
// The last step of a return. Not role gated at the route: the handler checks
// that the caller is the seller on this order, and a 403 from the middleware
// would clear the token and log them out mid job.
router.post("/:orderId/refund", authenticateToken, requirePermission("refunds"), refundOrder);
router.get("/:orderId/invoice", authenticateToken, generateInvoice);
router.get("/:orderId/packing-slip", authenticateToken, generatePackingSlip);
router.get("/:orderId", authenticateToken, getOrderById);

module.exports = router;
