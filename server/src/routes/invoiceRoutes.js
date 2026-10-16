const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoiceController");
const authenticateToken = require("../middlewares/authMiddleware");
const {
  validateManualInvoicePayload,
  validatePaymentPayload,
} = require("../middlewares/invoiceValidation");

// Protect all invoice management routes with JWT authentication
router.use(authenticateToken);

// ERP Dashboard & Reports
router.get("/dashboard", (req, res) => invoiceController.getDashboardStats(req, res));
// What a number in this format would look like. Pure: takes no number and
// saves nothing, so the settings screen can call it on every keystroke.
router.get("/number-preview", (req, res) => invoiceController.previewNumber(req, res));
router.get("/report", (req, res) => invoiceController.getReportData(req, res));

// Data Exports
router.get("/export/csv", (req, res) => invoiceController.exportCSV(req, res));
router.get("/export/excel", (req, res) => invoiceController.exportExcel(req, res));
router.get("/export/pdf", (req, res) => invoiceController.exportPDF(req, res));

// Order-linked Invoices
router.get("/by-order/:orderId", (req, res) => invoiceController.getInvoiceByOrderId(req, res));
router.get("/by-order/:orderId/pdf", (req, res) => invoiceController.getInvoicePDFByOrderId(req, res));

// Per-seller defaults. Registered before "/:id" so the word is not swallowed
// as an invoice id.
router.get("/settings", (req, res) => invoiceController.getSettings(req, res));
router.put("/settings", (req, res) => invoiceController.saveSettings(req, res));

// Invoice List & Details
router.get("/buyers", (req, res) => invoiceController.getBuyers(req, res));
router.get("/", (req, res) => invoiceController.getInvoices(req, res));
router.get("/:id", (req, res) => invoiceController.getInvoiceById(req, res));
router.get("/:id/pdf", (req, res) => invoiceController.getInvoicePDF(req, res));
router.get("/:id/download", (req, res) => invoiceController.getInvoicePDF(req, res));

// Invoice Mutation & Lifecycle Actions
router.post("/", validateManualInvoicePayload, (req, res) => invoiceController.createInvoice(req, res));
router.put("/:id", (req, res) => invoiceController.updateInvoice(req, res));
router.delete("/:id", (req, res) => invoiceController.deleteInvoice(req, res));

// Communications & Payments
router.post("/:id/send", (req, res) => invoiceController.sendInvoice(req, res));
router.post("/:id/send-email", (req, res) => invoiceController.sendInvoice(req, res));
router.post("/:id/resend-email", (req, res) => invoiceController.sendInvoice(req, res));
router.post("/:id/reminder", (req, res) => invoiceController.sendReminder(req, res));
router.post("/:id/payment", validatePaymentPayload, (req, res) => invoiceController.recordPayment(req, res));

module.exports = router;
