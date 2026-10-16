/**
 * Writing an accepted order into the wholesaler's sales book.
 *
 * An order is a fulfilment record and a sale is a commercial record, so they
 * stay separate tables. This is the join: when a wholesaler accepts an order,
 * the same goods appear in their book as a sale, and every flow that already
 * reads sales starts working on it, the invoice, the statement and the credit
 * note included.
 *
 * The one rule that matters more than any other here: the sale must owe
 * exactly what the order charged. A customer agreed a figure at checkout and
 * that figure is the debt. Recomputing it, adding tax to it, or rounding it
 * would change what they owe after they have already paid part of it.
 */
const { clean, fromPaise, toPaise } = require("../utils/money");
const { nextSaleNumber } = require("./seriesNumbers");
const stockLedger = require("./stockLedger");

/**
 * Is this database ready to link a sale to an order?
 *
 * Cached, and separate from the other probes because the migrations are
 * separate. Accepting an order must never fail because the sales book could
 * not be written to.
 */
let bridgeReady = null;

const hasSaleLink = async (client) => {
  if (bridgeReady !== null) return bridgeReady;
  try {
    const probe = await client.query(
      `SELECT
         to_regclass('public.sales') IS NOT NULL AS has_sales,
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sales'
                    AND column_name = 'order_id') AS has_order_id,
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sales'
                    AND column_name = 'tax_amount') AS has_tax,
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sales'
                    AND column_name = 'channel') AS has_channel,
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sale_lines'
                    AND column_name = 'gst_percent') AS has_line_gst`,
    );
    const row = probe.rows[0] || {};
    bridgeReady = row.has_sales && row.has_order_id ? row : false;
  } catch {
    bridgeReady = false;
  }
  return bridgeReady;
};

const resetSaleLink = () => { bridgeReady = null; };


/**
 * Write one accepted order into the sales book.
 *
 * Does nothing, rather than failing, when the order has no customer or the
 * migration has not been run. Accepting an order is the wholesaler's action
 * and must succeed; the book catching up is secondary and the backfill can
 * finish the job later.
 *
 * @returns {Promise<object|null>} the sale row, or null if none was written
 */
const createSaleFromOrder = async (client, orderId) => {
  const schema = await hasSaleLink(client);
  if (!schema) return null;

  // channel and source through to_jsonb, so this reads the same on a
  // database where either column has not arrived yet: a missing key is a
  // null, where naming a missing column is an error that aborts the
  // caller's transaction.
  const found = await client.query(
    `SELECT o.id, o.order_number, o.supplier_id, o.party_id, o.subtotal,
            o.total_amount, o.created_at,
            to_jsonb(o) ->> 'channel' AS channel,
            to_jsonb(o) ->> 'source' AS source
       FROM orders o
      WHERE o.id = $1`,
    [orderId],
  );
  const order = found.rows[0];
  if (!order || !order.party_id || !order.supplier_id) return null;

  // One order, one sale. The unique index backs this up, but asking first
  // keeps a re-accept from burning a sale number on a row that is refused.
  const already = await client.query(
    "SELECT * FROM sales WHERE order_id = $1",
    [orderId],
  );
  if (already.rows.length > 0) return already.rows[0];

  const lines = await client.query(
    `SELECT oi.product_name, oi.quantity, oi.total_price,
            COALESCE(oi.unit_price, 0) AS unit_price,
            oi.inventory_item_id,
            si.unit, si.hsn_code, si.gst_percent
       FROM order_items oi
       LEFT JOIN supplier_inventory si ON si.id = oi.inventory_item_id
      WHERE oi.order_id = $1
      ORDER BY oi.id`,
    [orderId],
  );

  // The order's own figures, carried across untouched. order_items holds the
  // real content of an order; orders.inventory_item_id is a single item
  // leftover and reading that would drop everything after the first product.
  const totalPaise = toPaise(order.total_amount);
  const subtotalPaise = toPaise(order.subtotal ?? order.total_amount);

  const saleNumber = await nextSaleNumber(client, order.supplier_id);

  /**
   * The book the sale, and so its bill, belongs to. What the order was
   * filed under when it was taken, and otherwise where it came from: a shop
   * order is the shop channel by definition, which is also the run the bill
   * raised at payment draws on, and one typed from a phone call is the
   * counter, which is what every such sale was before orders had a channel.
   */
  const channel = order.channel || (order.source === "manual" ? "counter" : "shop");

  const sale = await client.query(
    `INSERT INTO sales
       (wholesaler_id, party_id, order_id, sale_number, sale_date, source,
        status, subtotal, discount, ${schema.has_tax ? "tax_amount," : ""}
        ${schema.has_channel ? "channel," : ""} total, notes)
     VALUES ($1, $2, $3, $4, $5::date, 'retailer', 'confirmed',
             $6, 0, ${schema.has_tax ? "0," : ""}
             ${schema.has_channel ? "$9," : ""} $7, $8)
     RETURNING *`,
    [
      order.supplier_id,
      order.party_id,
      orderId,
      saleNumber,
      // Dated when the order was placed, not when it was accepted. The
      // statement should show the goods on the day the customer bought them.
      new Date(order.created_at).toISOString().slice(0, 10),
      fromPaise(subtotalPaise),
      fromPaise(totalPaise),
      `${order.source === "manual" ? "Order" : "Shop order"} ${order.order_number || orderId}`,
      ...(schema.has_channel ? [channel] : []),
    ],
  );
  const saleId = sale.rows[0].id;

  for (const line of lines.rows) {
    // The line rate is derived from what was actually charged for the line,
    // not from the listing's price today. A wholesaler who changed their rate
    // after the order must still bill what the customer agreed.
    const amountPaise = toPaise(line.total_price);
    const quantity = Number(line.quantity) || 1;
    const rate = fromPaise(Math.round(amountPaise / quantity));

    await client.query(
      `INSERT INTO sale_lines
         (sale_id, item_name, quantity, unit, rate, amount, hsn_code
          ${schema.has_line_gst ? ", gst_percent" : ""})
       VALUES ($1, $2, $3, $4, $5, $6, $7${schema.has_line_gst ? ", $8" : ""})`,
      [
        saleId,
        clean(line.product_name) || "Item",
        quantity,
        clean(line.unit) || "pcs",
        rate,
        fromPaise(amountPaise),
        clean(line.hsn_code),
        ...(schema.has_line_gst ? [line.gst_percent ?? null] : []),
      ],
    );
  }

  /**
   * THE GOODS LEAVE, and until 18 Sept this path did not say so.
   *
   * stockLedger's own header claimed accepting a shop order moved stock
   * "through the ordinary sale path". It does not: this function writes raw
   * SQL into `sales` and `sale_lines` rather than going through
   * saleController, so every marketplace order left the book stock untouched
   * while supplier_inventory.stock went down. The two numbers drifted apart
   * permanently and the register had no row to explain the gap.
   *
   * No double counting. supplier_inventory.stock is the marketplace
   * RESERVATION, decremented when the order was placed. The ledger is book
   * stock, and this is the first and only time these goods are taken out of
   * it, because the sale that would otherwise have done it is this one.
   */
  await stockLedger.record(client, order.supplier_id, {
    kind: "sale",
    documentId: saleId,
    documentNumber: saleNumber,
    movedOn: new Date(order.created_at).toISOString().slice(0, 10),
    direction: "out",
    note: `Shop order ${order.order_number || orderId}`,
    lines: lines.rows.map((line) => ({
      itemName: clean(line.product_name) || "Item",
      productId: line.inventory_item_id || null,
      quantity: Number(line.quantity) || 1,
      unit: clean(line.unit) || null,
    })),
  });

  return sale.rows[0];
};

/**
 * The order was delivered, so its sale was delivered.
 *
 * One copy, called from both places that move an order to `delivered`:
 * orderStatusService.updateOrderStatus and the PATCH /status route in
 * orderController, which writes the status itself rather than going through
 * the service. It lived only in the service, and the screens call the route,
 * so in the running product marking an order delivered left its sale sitting
 * at "confirmed" for ever: the wholesaler's own book said they still owed the
 * man their goods. follows_order_check.js did not catch it because it drives
 * the service, which was the half that was right.
 *
 * Only from confirmed. A cancelled sale stays cancelled: an order that
 * somehow reaches delivered after its sale was written off is a problem for
 * a person to look at, not one to paper over here.
 */
const markSaleDelivered = async (client, orderId) => {
  if (!(await hasSaleLink(client))) return 0;
  const done = await client.query(
    `UPDATE sales SET status = 'delivered', updated_at = CURRENT_TIMESTAMP
      WHERE order_id = $1 AND status = 'confirmed'`,
    [orderId],
  );
  return done.rowCount;
};

module.exports = { createSaleFromOrder, hasSaleLink, resetSaleLink, markSaleDelivered };
