const validateManualInvoicePayload = (req, res, next) => {
  const { buyerId, items } = req.body;

  if (!buyerId) {
    return res.status(400).json({ success: false, message: "Buyer ID is required." });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "At least one item is required for invoice creation." });
  }

  for (const item of items) {
    if (!item.productName || typeof item.productName !== "string") {
      return res.status(400).json({ success: false, message: "Every invoice item must have a valid productName." });
    }

    if (!item.quantity || Number(item.quantity) <= 0) {
      return res.status(400).json({ success: false, message: "Every invoice item must have a quantity greater than 0." });
    }

    if (item.unitPrice === undefined || Number(item.unitPrice) < 0) {
      return res.status(400).json({ success: false, message: "Every invoice item must have a valid unitPrice." });
    }
  }

  // The database has a CHECK on this column. Caught here so a wholesaler reads
  // what the four choices are, rather than a constraint violation.
  const MODES = ["road", "rail", "air", "ship"];
  const mode = req.body.transportMode;
  if (mode && !MODES.includes(String(mode).toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: `How the goods travel has to be one of: ${MODES.join(", ")}.`,
    });
  }

  next();
};

const validatePaymentPayload = (req, res, next) => {
  const { amount, paymentMethod } = req.body;

  if (amount === undefined || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: "A valid positive payment amount is required." });
  }

  const validMethods = ["UPI", "Cash", "Bank Transfer", "Card", "Cheque"];
  if (paymentMethod && !validMethods.includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: `Invalid paymentMethod. Allowed: ${validMethods.join(", ")}`,
    });
  }

  next();
};

module.exports = {
  validateManualInvoicePayload,
  validatePaymentPayload,
};
