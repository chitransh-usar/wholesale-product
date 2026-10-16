const pool = require("../config/db");
const { createSaleFromOrder } = require("./orderSaleService");
const saleInvoiceService = require("./saleInvoiceService");
const challanBook = require("./challanBook");

/**
 * What happens when an order is marked SHIPPED.
 *
 * THE TAX INVOICE GOES WITH THE GOODS. CGST s.31(1)(a) requires the invoice
 * before or at the time of REMOVAL, so the moment the goods leave is the
 * moment the bill exists. This is the step that ties the four documents
 * together: order, sale, invoice, and where it applies, challan.
 *
 * WHY NOT A CHALLAN BY DEFAULT. A Rule 55 delivery challan is for movement
 * that is NOT an ordinary supply: job work, goods on approval, liquid gas
 * where the quantity is not known at removal, and transport for reasons other
 * than supply. Rule 55(4) does allow shipping on a challan and billing after
 * delivery WHERE THE INVOICE COULD NOT BE ISSUED AT REMOVAL, and that is a
 * real provision, but it is the exception and the wholesaler has to say which
 * of those cases he is in. He picks a reason; silence means an ordinary sale
 * and an ordinary invoice.
 *
 * This product already made the opposite mistake once. Until 17 Sept a
 * challan was raised INSTEAD of an invoice whenever a sale was unpaid, which
 * understated outward supply in GSTR-1 and left the customer unable to claim
 * input credit. The reversal is in PROGRESS.md and this file exists so the
 * rule is in one place rather than spread across a status handler.
 *
 * EVERY STEP IS IDEMPOTENT. `createSaleFromOrder` returns the existing sale
 * for an order it has already bridged, and `createInvoiceFromSale` returns
 * the existing invoice. So shipping twice, or a retry after a dropped
 * connection, cannot produce a second bill for the same goods.
 */

/**
 * Mark how much of each order line has now been billed.
 *
 * Tally closes a sales order when it is completely billed and leaves it
 * PARTIALLY closed otherwise, which is the behaviour copied here: part
 * shipment is ordinary in this trade and is not an error state.
 *
 * Written as the quantity billed rather than a closed flag, because "how much
 * is still owed to this customer" is a quantity question and a flag cannot
 * answer it.
 */
const markLinesBilled = async (client, orderId) => {
  try {
    await client.query(
      `UPDATE order_items SET quantity_billed = quantity WHERE order_id = $1`,
      [orderId],
    );
  } catch (err) {
    // The column arrives with wholesale3_order_sequences.sql. Without it the
    // order still ships and still bills; only the part-billed figure is
    // missing, which is not worth refusing a dispatch over.
    if (err.code !== "42703") throw err;
  }
};

/**
 * Raise what the goods need, and return what was raised.
 *
 * `challanReason` is a Rule 55 code, or nothing. Nothing is the ordinary case
 * and means a tax invoice.
 */
const shipOrder = async (orderId, wholesalerId, { challanReason = null } = {}) => {
  const out = { sale: null, invoice: null, challan: null };

  // The sale first, because the invoice is raised FROM it and because a
  // manual order has never been through the acceptance hook that writes one.
  // Its own transaction: a sales book that cannot be written is worth a line
  // in the log and a backfill, not a refused dispatch.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    out.sale = await createSaleFromOrder(client, orderId);
    if (out.sale) await markLinesBilled(client, orderId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.warn(`Order ${orderId} shipped but not written to the sales book: ${err.message}`);
    return out;
  } finally {
    client.release();
  }

  if (!out.sale) return out;

  if (challanReason) {
    // The exception. Goods move on a challan and the bill follows, which is
    // only lawful for the Rule 55 cases, so the reason he picked is recorded
    // ON the document rather than assumed.
    const made = await challanBook.create(wholesalerId, {
      kind: "sale",
      partyId: out.sale.party_id,
      reason: challanReason,
      lines: await linesForOrder(orderId),
    });
    if (!made.error) out.challan = made.challan;
    return out;
  }

  const billed = await saleInvoiceService.createInvoiceFromSale(
    out.sale.id, wholesalerId);
  out.invoice = billed.invoice || null;
  return out;
};

/** The order's own lines, shaped for a challan. */
const linesForOrder = async (orderId) => {
  const { rows } = await pool.query(
    `SELECT oi.product_name, oi.quantity, oi.unit_price, oi.inventory_item_id,
            si.unit
       FROM order_items oi
       LEFT JOIN supplier_inventory si ON si.id = oi.inventory_item_id
      WHERE oi.order_id = $1 ORDER BY oi.id`,
    [orderId],
  );
  return rows.map((r) => ({
    itemName: r.product_name,
    quantity: Number(r.quantity),
    unit: r.unit || null,
    rate: Number(r.unit_price),
    productId: r.inventory_item_id || null,
  }));
};

module.exports = { shipOrder };
