const pool = require("../config/db");
const { FEATURES } = require("../config/features");
const invoiceRepository = require("../repositories/invoiceRepository");
const { businessId } = require("../middlewares/businessContext");

// See productController: a zero count means "unknown" while stock is hidden.
const IN_STOCK = FEATURES.STOCK_TRACKING ? " AND stock > 0" : "";

exports.getInventory = async (req, res) => {
  const supplierId = businessId(req);
  try {
    // The billing columns arrive with wholesale3_listing_billing_fields.sql.
    // Naming them unconditionally takes the whole product screen down with a
    // 500 on any database that has not had it run, which has happened twice.
    const has = await invoiceRepository.schemaExtras();
    const billing = has.has_listing_billing
      ? "si.unit, si.pack_size, si.hsn_code, si.gst_percent, si.notes,"
      : `'pcs' AS unit, NULL AS pack_size, NULL AS hsn_code,
         NULL AS gst_percent, NULL AS notes,`;

    const query = `
      SELECT
        si.id,
        p.name,
        p.category,
        si.price,
        si.discount_price,
        si.moq,
        si.stock,
        si.status,
        si.visibility,
        ${billing}
        COALESCE(si.image_url, p.global_image_url) as image
      FROM supplier_inventory si
      JOIN products p ON p.id = si.product_id
      WHERE si.supplier_id = $1
      ORDER BY p.name ASC
    `;
    const result = await pool.query(query, [supplierId]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching inventory:", err);
    res.status(500).json({ message: "Server error" });
  }
};
