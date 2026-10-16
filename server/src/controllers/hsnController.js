const pool = require("../config/db");
const hsnService = require("../services/hsnService");
const { businessId } = require("../middlewares/businessContext");

/**
 * Codes to offer under an HSN box.
 *
 * Their own first, then a short list of common textile headings. Both are
 * labelled with where they came from, because the screen has to be able to
 * say "you used this before" against one and "check this against your goods"
 * against the other. They are not the same kind of claim.
 */
exports.suggestHsn = async (req, res) => {
  try {
    const suggestions = await hsnService.suggest(
      pool,
      businessId(req),
      req.query.q || "",
    );
    res.status(200).json(suggestions);
  } catch (err) {
    console.error("Error suggesting HSN codes:", err);
    // A suggestion list is a convenience. Failing it should never take down
    // the form it sits under, so this is an empty list rather than a 500.
    res.status(200).json([]);
  }
};
