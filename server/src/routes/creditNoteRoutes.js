const express = require("express");
const {
  createCreditNote,
  listCreditNotes,
  getCreditNote,
  getCreditNoteForInvoice,
  getCreditNotePDF,
} = require("../controllers/creditNoteController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

// Only the issuer raises a credit note. When the retailer side is built it
// will read them, but through a route of its own, not this one.
router.use(authenticateToken, authorizeRoles("seller", "both"));

router.get("/", requirePermission("refunds"), listCreditNotes);
router.post("/", requirePermission("refunds"), createCreditNote);

// Registered before "/:id" so "by-invoice" is not swallowed as a note id.
router.get("/by-invoice/:invoiceId", requirePermission("refunds"), getCreditNoteForInvoice);
router.get("/:id", requirePermission("refunds"), getCreditNote);
router.get("/:id/pdf", requirePermission("refunds"), getCreditNotePDF);

module.exports = router;
