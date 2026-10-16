const stockLedger = require("../services/stockLedger");
const { businessId } = require("../middlewares/businessContext");

/**
 * What is on hand, and why.
 *
 * Every figure here is a SUM of the ledger rather than a stored counter, so
 * the list and the register for one product cannot disagree: they are the same
 * rows added up two ways.
 *
 * Scoped by the wholesaler id from the TOKEN, never from the query string. An
 * endpoint that took an id from the caller is how one wholesaler reads
 * another's stock.
 */

/** Not an error. A database without the migration has no ledger to read. */
const notReady = {
  ready: false,
  items: [],
  message:
    "Stock tracking has not been switched on for this book yet. "
    + "Run wholesale3_stock_ledger.sql and it starts recording from the next document.",
};

exports.getStock = async (req, res) => {
  try {
    if (!(await stockLedger.ledgerExists())) return res.status(200).json(notReady);
    const items = await stockLedger.balances(businessId(req));
    res.status(200).json({ ready: true, items });
  } catch (err) {
    console.error("Error reading stock:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getStockRegister = async (req, res) => {
  try {
    if (!(await stockLedger.ledgerExists())) {
      return res.status(200).json({ ...notReady, movements: [] });
    }
    const { from, to } = req.query;
    const movements = await stockLedger.register(
      businessId(req),
      // The literal string "none" is how the client asks for the rows that
      // name no product, which are real movements off typed lines. A bare
      // empty string would be indistinguishable from a missing parameter.
      req.params.productId === "none" ? null : req.params.productId,
      { from: from || null, to: to || null },
    );
    res.status(200).json({ ready: true, movements });
  } catch (err) {
    console.error("Error reading the stock register:", err);
    res.status(500).json({ message: "Server error" });
  }
};
