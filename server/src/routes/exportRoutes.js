const express = require("express");
const exportService = require("../services/exportService");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { businessId, requireOwner } = require("../middlewares/businessContext");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("seller", "both"));

/**
 * The wholesaler's own book, as a zip.
 *
 * THERE IS NO ID IN THIS ROUTE, and there must never be one. No `/:id`, no
 * `?wholesaler=`. The owner comes from `businessId(req)`, which reads the
 * token, so the only book anybody can export is the one they are signed in to.
 * A path parameter here would be a single request that hands over another
 * firm's entire ledger, customer list and bills, in one file, and it would
 * look exactly like the feature working.
 *
 * OWNER ONLY, and not expressible as a permission. Every other seller route is
 * gated on the one list it touches, so an employee given "invoices" sees
 * invoices and nothing else. This route is the whole book at once: customers,
 * sales, the money received, suppliers, purchases and every bill. Gating it on
 * any single permission would quietly widen that permission into all of them,
 * and the employee walks out of the shop with the customer list. It sits beside
 * the GST number and the UPI id, on the settings screen, behind the same guard.
 *
 * `includePdfs=false` skips rendering the bills, which is much faster when
 * somebody only wants the figures.
 */
router.get("/zip", requireOwner, async (req, res) => {
  const wholesalerId = businessId(req);
  try {
    const buffer = await exportService.buildZip(wholesalerId, {
      includePdfs: req.query.includePdfs !== "false",
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=my-data-${stamp}.zip`);
    res.setHeader("Content-Length", buffer.length);
    res.status(200).send(buffer);
  } catch (err) {
    console.error("Export failed:", err);
    res.status(500).json({ success: false, message: "Could not build your export." });
  }
});

module.exports = router;
