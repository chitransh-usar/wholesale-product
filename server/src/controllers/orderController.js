const pool = require("../config/db");
const { FEATURES } = require("../config/features");
const { clean, fromPaise, fullName, toPaise } = require("../utils/money");
const {
  findOrCreateParty,
  hasPartyLink,
  recordOrderPayment,
} = require("../services/partyService");
const { createSaleFromOrder, hasSaleLink, markSaleDelivered } = require("../services/orderSaleService");
const { shipOrder } = require("../services/shipOrder");
const { nextOrderNumber } = require("../services/seriesNumbers");
const { resolveChannel, DEFAULT_CHANNEL } = require("../services/salesChannels");

/**
 * Whether orders can say which book they belong to, from
 * wholesale3_marketplace_linkages.sql. Caches only a TRUE, so running the
 * migration takes effect on the next request.
 */
let orderChannelReady = false;
const hasOrderChannel = async () => {
  if (orderChannelReady) return true;
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'orders'
                       AND column_name = 'channel') AS ok`,
  );
  orderChannelReady = Boolean(rows[0]?.ok);
  return orderChannelReady;
};
const { validateStatusTransition, mapPaymentStatusToOrderStatus, getOrderTimeline, recordStatusChange, cancelOrder } = require("../services/orderStatusService");
const { geocodeOrderDestination } = require("../services/geocodingService");
const { businessId } = require("../middlewares/businessContext");
const {
  RETURN_WINDOW_DAYS,
  returnWindowForOrder,
} = require("../services/orderWindows");
const invoiceService = require("../services/invoiceService");
const invoiceRepository = require("../repositories/invoiceRepository");
const challanService = require("../services/challanService");
const creditNoteService = require("../services/creditNoteService");
const pdfService = require("../services/pdfService");
const { parseTransport, stampTransport } = require("../services/transportDetails");
const {
  enqueueNotification,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} = require("../services/notificationManager");

// Money is handled in paise so that splitting a bill never loses or invents a
// fraction of a rupee.

// A part-paid order still owes money, so "can this be paid" cannot be asked of
// the lifecycle alone: an order can sit at payment_completed, or even be
// shipped, and still be waiting on its second instalment. Two things decide
// it - the order has not been killed, and there is a balance left.
const PAYMENT_BLOCKING_STATUSES = new Set([
  "cancelled",
  "refunded",
  "payment_failed",
  "return_completed",
]);

const remainingFor = (order) => {
  const total = Number(order.total_amount || 0);
  const paid = Number(order.amount_paid || 0);
  return order.remaining_amount != null
    ? Number(order.remaining_amount)
    : fromPaise(toPaise(total) - toPaise(paid));
};

const canAcceptPayment = (order) =>
  !PAYMENT_BLOCKING_STATUSES.has(order.status) && toPaise(remainingFor(order)) > 0;

// What to tell a buyer who lands on the payment screen for an order that has
// moved on. Lifecycle messages name internal states, so they are logged
// rather than shown.
const notPayableReason = (order) => {
  switch (order.status) {
    case "payment_failed":
      return "This payment was cancelled. Place a new order to buy these items.";
    case "cancelled":
      return "This order was cancelled and can no longer be paid.";
    case "refunded":
      return "This order was refunded.";
    case "return_completed":
      return "This order was returned.";
    default:
      return toPaise(remainingFor(order)) <= 0
        ? "This order is fully paid."
        : "This order is no longer awaiting payment.";
  }
};

// What the buyer owes next. On the 50/50 plan the first instalment is half,
// rounded in paise, and the second is whatever is actually left, so the two
// always add up to the total exactly.
const nextInstalment = (order) => {
  const total = Number(order.total_amount || 0);
  const paid = Number(order.amount_paid || 0);
  const remaining = remainingFor(order);

  if ((order.payment_plan || "full") !== "installment_50_50") {
    return { amount: remaining, installmentNumber: 1, paymentType: "full" };
  }

  if (toPaise(paid) <= 0) {
    return {
      amount: fromPaise(Math.round(toPaise(total) / 2)),
      installmentNumber: 1,
      paymentType: "initial",
    };
  }

  return { amount: remaining, installmentNumber: 2, paymentType: "remaining" };
};

const ensureOrderAccess = async (req, res, orderId, { requireBuyer = true, requireSupplier = true } = {}) => {
  // The business, not the person. An employee working on their employer's book
  // is the supplier on that book's orders; comparing their own id would refuse
  // them every order their employer has, which is all of them.
  //
  // Buying is still personal: an order they placed themselves is their, not their
  // employer's, so both ids are considered.
  const userId = businessId(req);
  const personId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized: Missing user credentials." });
    return null;
  }

  const role = req.user?.role || "buyer";
  if (role === "admin") {
    return { authorized: true };
  }

  const orderResult = await pool.query(
    "SELECT buyer_id, supplier_id FROM orders WHERE id = $1",
    [orderId],
  );

  if (orderResult.rows.length === 0) {
    res.status(404).json({ success: false, message: "Order not found" });
    return null;
  }

  const order = orderResult.rows[0];
  const isBuyer = order.buyer_id === userId || order.buyer_id === personId;
  const isSupplier = order.supplier_id === userId;

  if (role === "buyer") {
    if (requireBuyer && isBuyer) {
      return { authorized: true, order };
    }
    res.status(403).json({ success: false, message: "Access Denied: Unauthorized access verification layer." });
    return null;
  }

  if (role === "seller" || role === "both") {
    if (requireBuyer && isBuyer) {
      return { authorized: true, order };
    }
    if (requireSupplier && isSupplier) {
      return { authorized: true, order };
    }
  }

  res.status(403).json({ success: false, message: "Access Denied: Unauthorized access verification layer." });
  return null;
};

const getSupplierOrders = async (req, res) => {
  const supplierId = businessId(req);

  try {
    // Goods already out on a challan, so the list can show which orders have
    // stock away from the godown. Zero until the migration has been run,
    // rather than the whole list failing.
    const hasChallans = await challanService.challanTablesExist();
    const challanCount = hasChallans
      ? `(SELECT COUNT(*) FROM delivery_challans dc
           WHERE dc.order_id = o.id
              OR dc.sale_id IN (SELECT id FROM sales s WHERE s.order_id = o.id))`
      : "0";

    const query = `
      SELECT 
        o.id,
        o.order_number,
        -- A manual order has no buyer user at all, so the party's own name is
        -- what to show. Without this it read as an empty row, or vanished
        -- entirely on the inner join below.
        COALESCE(wp.company_name, NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                 pt.name, 'Customer') as buyer,
        COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), pt.name) as contact,
        COALESCE(items.first_product, p.name) as product,
        COALESCE(items.item_count, 1) as item_count,
        o.quantity as qty,
        o.total_amount as amount,
        -- What has actually been received. The refuse screen warns about it,
        -- because refusing an order does not send money back and a
        -- wholesaler needs to know they are now holding their customer's cash.
        o.amount_paid,
        o.status,
        o.payment_status,
        ${challanCount}::int AS challan_count,
        o.created_at as date
      FROM orders o
      LEFT JOIN supplier_inventory si ON o.inventory_item_id = si.id
      LEFT JOIN products p ON si.product_id = p.id
      -- LEFT, not inner. A manual order is typed by the wholesaler and has no
      -- buyer_id, so an inner join here hid every one of them.
      LEFT JOIN users u ON o.buyer_id = u.id
      LEFT JOIN parties pt ON pt.id = o.party_id
      LEFT JOIN wholesaler_profiles wp ON u.id = wp.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count, MIN(oi.product_name) AS first_product
        FROM order_items oi WHERE oi.order_id = o.id
      ) items ON TRUE
      WHERE o.supplier_id = $1 OR si.supplier_id = $1
      ORDER BY o.created_at DESC
    `;
    const result = await pool.query(query, [supplierId]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching supplier orders:", err);
    res.status(500).json({ message: "Server error fetching orders" });
  }
};

const getBuyerOrders = async (req, res) => {
  const buyerId = req.user.id;
  try {
    // An order can hold several products from one wholesaler, so describe it
    // by its lines rather than naming whichever product happened to be first.
    const result = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status,
              o.total_amount, o.amount_paid, o.remaining_amount, o.payment_plan,
              o.created_at, o.quantity,
              COALESCE(wp.company_name, u.first_name || ' ' || u.last_name) AS supplier_name,
              COALESCE(o.supplier_id, si.supplier_id) AS supplier_user_id,
              COALESCE(items.item_count, 1) AS item_count,
              COALESCE(items.first_product, p.name) AS product,
              COALESCE(items.image, si.image_url, p.global_image_url) AS image
       FROM orders o
       LEFT JOIN supplier_inventory si ON o.inventory_item_id = si.id
       LEFT JOIN products p ON si.product_id = p.id
       LEFT JOIN users u ON u.id = o.supplier_id
       LEFT JOIN wholesaler_profiles wp ON wp.user_id = o.supplier_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS item_count,
                MIN(oi.product_name) AS first_product,
                MIN(COALESCE(isi.image_url, ip.global_image_url)) AS image
         FROM order_items oi
         LEFT JOIN supplier_inventory isi ON isi.id = oi.inventory_item_id
         LEFT JOIN products ip ON ip.id = oi.product_id
         WHERE oi.order_id = o.id
       ) items ON TRUE
       WHERE o.buyer_id = $1
       ORDER BY o.created_at DESC`,
      [buyerId],
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching buyer orders:", error);
    res.status(500).json({ message: "Server error fetching buyer orders" });
  }
};

const createOrder = async (req, res) => {
  const {
    products,
    deliveryAddress,
    billingAddress,
    paymentMethod = "upi",
    paymentPlan = "full",
  } = req.body;
  // Only plans the server knows about. Anything else falls back to paying in
  // full rather than creating an order nobody can settle.
  const plan = paymentPlan === "installment_50_50" ? "installment_50_50" : "full";
  const buyerId = req.user?.id;

  if (!buyerId) {
    return res.status(401).json({ success: false, message: "Unauthorized: Missing user credentials." });
  }

  if (!Array.isArray(products) || products.length === 0 || !deliveryAddress) {
    return res.status(400).json({ success: false, message: "Missing required order checkout fields." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Resolve every requested line against live inventory. Prices, MOQ and
    // stock all come from the database - amounts sent by the client are
    // ignored, otherwise a crafted request could set its own price.
    const lines = [];
    for (const entry of products) {
      const productId = String(entry.productId || "").split("#")[0].trim();
      const inventoryId = entry.inventoryId
        ? String(entry.inventoryId).split("#")[0].trim()
        : null;
      const quantity = parseInt(entry.quantity, 10) || 0;

      if (!productId) throw new Error("Invalid product reference in order.");
      if (quantity <= 0) throw new Error("Every item needs a quantity of at least 1.");

      // Prefer the exact listing the buyer chose. A storefront listing is
      // orderable this way: the buyer reached it through the wholesaler's own
      // page, which is the point of it.
      let lookup = { rows: [] };
      if (inventoryId) {
        lookup = await client.query(
          `SELECT si.id, si.supplier_id, si.product_id, si.stock, si.moq,
                  si.price, si.discount_price, si.shipping_days, p.name AS product_name
           FROM supplier_inventory si
           JOIN products p ON p.id = si.product_id
           WHERE si.id = $1 AND si.status = 'Active'
             AND si.visibility IN ('public', 'storefront')`,
          [inventoryId],
        );
      }
      // Fall back to the cheapest listing of that product. Only public
      // listings take part: picking the cheapest is the comparison engine, and
      // an off-catalogue listing is precisely the one that opted out of it.
      if (lookup.rows.length === 0) {
        lookup = await client.query(
          `SELECT si.id, si.supplier_id, si.product_id, si.stock, si.moq,
                  si.price, si.discount_price, si.shipping_days, p.name AS product_name
           FROM supplier_inventory si
           JOIN products p ON p.id = si.product_id
           WHERE si.product_id = $1 AND si.status = 'Active'
             AND si.visibility = 'public'
           ORDER BY si.price ASC
           LIMIT 1`,
          [productId],
        );
      }
      if (lookup.rows.length === 0) {
        throw new Error("A product in your order is no longer available.");
      }

      const inv = lookup.rows[0];

      if (String(inv.supplier_id) === String(buyerId)) {
        throw new Error("You cannot order your own inventory.");
      }
      if (quantity < inv.moq) {
        throw new Error(`${inv.product_name} has a minimum order quantity of ${inv.moq}.`);
      }
      // Only enforced when stock counts are believed. See config/features.
      if (FEATURES.STOCK_TRACKING && inv.stock < quantity) {
        throw new Error(`${inv.product_name} only has ${inv.stock} left in stock.`);
      }

      // Bulk price applies once the MOQ threshold is met.
      const unitPrice = Number(
        inv.discount_price && quantity >= inv.moq ? inv.discount_price : inv.price,
      );

      lines.push({
        inventoryId: inv.id,
        productId: inv.product_id,
        supplierId: inv.supplier_id,
        productName: inv.product_name,
        quantity,
        unitPrice,
        listPrice: Number(inv.price),
        discountPrice: inv.discount_price ? Number(inv.discount_price) : null,
        moq: inv.moq,
        shippingDays: inv.shipping_days,
        lineTotal: Number((unitPrice * quantity).toFixed(2)),
      });
    }

    // One order ships from one wholesaler on one truck.
    const supplierIds = new Set(lines.map((l) => String(l.supplierId)));
    if (supplierIds.size > 1) {
      throw new Error("An order can only contain items from a single wholesaler.");
    }

    const supplierId = lines[0].supplierId;
    const subtotal = Number(lines.reduce((sum, l) => sum + l.lineTotal, 0).toFixed(2));
    const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
    const maxShippingDays = Math.max(...lines.map((l) => Number(l.shippingDays) || 7));

    // The buyer joins this wholesaler's customer book, so one man has one
    // page and one balance whether they ordered through the shop or the
    // wholesaler wrote them down by hand. Skipped, without failing checkout,
    // on a database where the customer book migration has not been run.
    let partyId = null;
    const partyLinked = await hasPartyLink(client);
    if (partyLinked) {
      // The firm and the GST number come off the buyer's own account, and both
      // reach the bill. Without them the customer page showed the man's firm
      // and their invoice showed their personal name, because the order screen
      // reads wholesaler_profiles.company_name and the invoice reads the
      // party, and nothing ever copied one to the other. The GST number is
      // worse than cosmetic: a bill without it is a bill their customer cannot
      // claim input credit against.
      const buyer = await client.query(
        `SELECT u.first_name, u.last_name, u.phone,
                wp.company_name, wp.gstin
           FROM users u
           LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
          WHERE u.id = $1`,
        [buyerId],
      );
      const b = buyer.rows[0] || {};
      const party = await findOrCreateParty(client, {
        wholesalerId: supplierId,
        userId: buyerId,
        // The name on the delivery address is who the goods are actually for,
        // so it beats the account name when the two differ.
        name: clean(deliveryAddress.name) || fullName(b.first_name, b.last_name),
        businessName: clean(b.company_name),
        gstin: clean(b.gstin),
        phone: clean(deliveryAddress.phone) || clean(b.phone),
        city: clean(deliveryAddress.city),
        address: clean(deliveryAddress.street || deliveryAddress.address),
      });
      partyId = party.id;
    }

    // party_id is named only when the column is really there, so an order
    // still saves on a database that is behind on migrations.
    const orderResult = await client.query(
      `INSERT INTO orders (
        buyer_id, supplier_id, ${partyLinked ? "party_id," : ""} inventory_item_id, quantity,
        total_amount, subtotal, amount_paid, remaining_amount, payment_plan,
        status, payment_status,
        delivery_address, billing_address, contact_phone, notes,
        order_number, expected_delivery_date, updated_at
      )
       VALUES (${Array.from({ length: partyLinked ? 18 : 17 }, (_, i) => `$${i + 1}`).join(", ")}, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        buyerId,
        supplierId,
        ...(partyLinked ? [partyId] : []),
        // kept for backwards compatibility with single-item readers
        lines[0].inventoryId,
        totalQuantity,
        subtotal,
        subtotal,
        0,
        subtotal,
        plan,
        "payment_pending",
        "pending",
        JSON.stringify(deliveryAddress),
        JSON.stringify(billingAddress || deliveryAddress),
        String(deliveryAddress.phone || ""),
        `Order with ${lines.length} item${lines.length === 1 ? "" : "s"}`,
        // THE SAME RUN A MANUAL ORDER DRAWS ON. A shop order and one taken
        // on the phone are the same document entered two ways, so they are
        // one voucher type and take one series: two shapes for one kind of
        // document is how a wholesaler ends up unable to tell somebody his
        // own order number.
        //
        // This used to be `ORD-<timestamp>-<8 chars of the buyer id>`, which
        // is unique and is not a series. Orders already numbered that way
        // keep their numbers, because a number that has been read out to a
        // customer cannot be restated.
        await nextOrderNumber(client, supplierId),
        new Date(Date.now() + maxShippingDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      ],
    );

    const orderId = orderResult.rows[0].id;

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (
           order_id, inventory_item_id, product_id, supplier_id, product_name,
           quantity, unit_price, discount_price, total_price, moq, shipping_days, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          orderId,
          line.inventoryId,
          line.productId,
          line.supplierId,
          line.productName,
          line.quantity,
          line.listPrice,
          line.discountPrice,
          line.lineTotal,
          line.moq,
          line.shippingDays,
          "pending",
        ],
      );

      // Still decremented while stock is hidden, so a wholesaler who keeps
      // real counts keeps them moving and switching tracking back on does not
      // need a stock take. The guard against overselling only applies when
      // the counts are believed.
      //
      // The floor is not cosmetic. supplier_inventory carries
      // CHECK (stock >= 0), and every listing created since stock came off
      // the screens has a count of zero, so an unfloored decrement makes the
      // constraint reject the row and the buyer gets a 400 on the checkout
      // button for every new product. Stopping at zero is also the honest
      // reading of a count nobody maintains.
      const stockUpdate = await client.query(
        FEATURES.STOCK_TRACKING
          ? `UPDATE supplier_inventory SET stock = stock - $1
              WHERE id = $2 AND stock >= $1 RETURNING id`
          : `UPDATE supplier_inventory SET stock = GREATEST(stock - $1, 0)
              WHERE id = $2 RETURNING id`,
        [line.quantity, line.inventoryId],
      );
      if (FEATURES.STOCK_TRACKING && stockUpdate.rows.length === 0) {
        throw new Error(`${line.productName} went out of stock while checking out.`);
      }
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, status, previous_status, updated_by, updated_by_role, remarks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, "payment_pending", null, buyerId, "buyer", "Order created"],
    );

    await client.query(
      `INSERT INTO payment_transactions (order_id, amount, payment_method, payment_status, gateway_response)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, subtotal, paymentMethod, "pending", JSON.stringify({ method: paymentMethod })],
    );

    await client.query("COMMIT");

    // A pin dropped at checkout is authoritative - only fall back to
    // geocoding the typed address when the buyer did not place one. Geocoding
    // is rate limited, so it is never awaited: it must not delay checkout,
    // and the map degrades gracefully until it lands.
    const pinnedLat = Number(deliveryAddress?.lat);
    const pinnedLng = Number(deliveryAddress?.lng);
    if (Number.isFinite(pinnedLat) && Number.isFinite(pinnedLng)) {
      pool
        .query("UPDATE orders SET delivery_lat = $1, delivery_lng = $2 WHERE id = $3", [
          pinnedLat,
          pinnedLng,
          orderId,
        ])
        .catch(() => { });
    } else {
      geocodeOrderDestination(orderId, deliveryAddress).catch(() => { });
    }

    // Trigger automatic invoice creation in background
    invoiceService.createInvoiceFromOrder(orderId).catch((invErr) => {
      console.warn("Background invoice creation notice:", invErr.message);
    });

    return res.status(201).json({ success: true, orderId, subtotal, itemCount: lines.length });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Order creation failed:", error);
    return res.status(400).json({ success: false, message: error.message || "Could not create order" });
  } finally {
    client.release();
  }
};

const getPaymentDetails = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    const orderQuery = await pool.query(
      `SELECT o.id, o.total_amount, o.amount_paid, o.remaining_amount, o.payment_plan,
              o.buyer_id, o.supplier_id, o.delivery_address, si.product_id,
              p.name as product_name, wp.company_name, wp.upi_id, o.order_number,
              o.payment_status, o.status
       FROM orders o
       JOIN supplier_inventory si ON o.inventory_item_id = si.id
       JOIN products p ON si.product_id = p.id
       -- LEFT so an order still loads while the seller's profile is incomplete
       LEFT JOIN wholesaler_profiles wp ON si.supplier_id = wp.user_id
       WHERE o.id = $1`,
      [orderId],
    );

    if (orderQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order records not found." });
    }

    const orderRecord = orderQuery.rows[0];
    const isBuyer = orderRecord.buyer_id === userId;
    const isSupplier = orderRecord.supplier_id === userId;

    if (req.user.role !== "admin" && !isBuyer && !isSupplier) {
      return res.status(403).json({ success: false, message: "Access Denied: Unauthorized access verification layer." });
    }

    const payable = canAcceptPayment(orderRecord);
    const due = nextInstalment(orderRecord);

    res.json({
      success: true,
      orderId: orderRecord.id,
      orderNumber: orderRecord.order_number,
      // `amount` is what to pay right now, which on an instalment plan is not
      // the order total. Kept under this name because the QR code reads it.
      amount: due.amount,
      totalAmount: Number(orderRecord.total_amount || 0),
      amountPaid: Number(orderRecord.amount_paid || 0),
      remainingAmount: remainingFor(orderRecord),
      paymentAmount: due.amount,
      paymentPlan: orderRecord.payment_plan || "full",
      installmentNumber: due.installmentNumber,
      supplierName: orderRecord.company_name || "Wholesale Merchant",
      supplierUpiId: orderRecord.upi_id,
      productName: orderRecord.product_name,
      deliveryAddress: orderRecord.delivery_address,
      paymentStatus: orderRecord.payment_status,
      status: orderRecord.status,
      // Told to the client so the QR code and the pay button are never shown
      // for an order that cannot accept a payment. Returning to this screen
      // through browser history is the usual way that happens.
      payable,
      notPayableReason: payable ? null : notPayableReason(orderRecord),
    });
  } catch (error) {
    console.error("Error processing dynamic payment extraction routing:", error);
    res.status(500).json({ success: false, message: "Internal server query resolution failure." });
  }
};

/**
 * Open a payment session. Records what the buyer owes right now so the amount
 * is decided by the server, not posted by the browser. Any earlier unfinished
 * session for the order is superseded, otherwise revisiting the payment screen
 * leaves a trail of pending rows that later payments could pick up.
 */
const initiatePayment = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;
  const paymentMethod = req.body?.paymentMethod || "upi";

  const client = await pool.connect();
  try {
    const accessCheck = await ensureOrderAccess(req, res, orderId, { requireBuyer: true, requireSupplier: false });
    if (!accessCheck) return;

    await client.query("BEGIN");
    const orderRes = await client.query(
      `SELECT id, total_amount, amount_paid, remaining_amount, payment_plan,
              buyer_id, supplier_id, status
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (orderRes.rows.length === 0) throw new Error("Order not found");
    const order = orderRes.rows[0];
    if (String(order.buyer_id) !== String(userId)) {
      throw new Error("This order belongs to someone else.");
    }

    if (!canAcceptPayment(order)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        code: "ORDER_NOT_AWAITING_PAYMENT",
        status: order.status,
        message: notPayableReason(order),
      });
    }

    await client.query(
      `UPDATE payment_transactions SET payment_status = 'superseded', updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $1 AND payment_status = 'pending'`,
      [orderId],
    );

    const due = nextInstalment(order);
    const inserted = await client.query(
      `INSERT INTO payment_transactions
         (order_id, buyer_id, supplier_id, amount, payment_method, payment_status,
          installment_number, payment_type, created_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,CURRENT_TIMESTAMP) RETURNING id`,
      [orderId, order.buyer_id, order.supplier_id, due.amount, paymentMethod, due.installmentNumber, due.paymentType],
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      paymentId: inserted.rows[0].id,
      totalAmount: Number(order.total_amount || 0),
      amountPaid: Number(order.amount_paid || 0),
      remainingAmount: remainingFor(order),
      paymentAmount: due.amount,
      paymentPlan: order.payment_plan || "full",
      installmentNumber: due.installmentNumber,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("initiatePayment error:", error);
    return res.status(400).json({ success: false, message: error.message || "Failed to start this payment." });
  } finally {
    client.release();
  }
};

const updatePaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const {
    paymentStatus,
    paymentMethod = "upi",
    remarks,
    paymentId,
    upiTransactionReference,
    markFailed,
  } = req.body;
  const userId = req.user.id;

  // `failed` is the buyer abandoning the screen. Everything else is a payment
  // of whatever is currently owed, so the browser never names an amount.
  const abandoning = markFailed === true || paymentStatus === "failed";

  if (!abandoning && paymentStatus && !["paid", "pending", "partial", "partially_paid", "cod"].includes(paymentStatus)) {
    return res.status(400).json({ success: false, message: "Unrecognised payment status." });
  }

  const client = await pool.connect();
  try {
    const accessCheck = await ensureOrderAccess(req, res, orderId, { requireBuyer: true, requireSupplier: false });
    if (!accessCheck) return;

    await client.query("BEGIN");
    // party_id is only there once the customer book migration has run, and
    // naming a column that does not exist would take the payment screen down.
    const partyColumn = (await hasPartyLink(client)) ? "party_id" : "NULL AS party_id";
    const orderRes = await client.query(
      `SELECT id, buyer_id, supplier_id, order_number, status, payment_status,
              total_amount, amount_paid, remaining_amount, payment_plan, quantity,
              ${partyColumn}
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (orderRes.rows.length === 0) throw new Error("Order not found.");
    const order = orderRes.rows[0];
    if (String(order.buyer_id) !== String(userId)) {
      throw new Error("This order belongs to someone else.");
    }

    const previousStatus = order.status;
    const alreadyPaid = Number(order.amount_paid || 0);

    // ---- Buyer abandoned the payment screen -------------------------------
    if (abandoning) {
      // Only an order that has taken no money at all can be failed this way.
      // Walking away from a second instalment must not cancel an order the
      // seller may already have shipped, nor hand its stock back.
      if (toPaise(alreadyPaid) > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          code: "ORDER_PART_PAID",
          message: "This order has already been part paid, so it cannot be cancelled here. Contact the seller.",
        });
      }

      const validation = validateStatusTransition(previousStatus, "payment_failed");
      if (!validation.valid) {
        await client.query("ROLLBACK");
        console.warn(`Rejected abandon on order ${orderId}: ${validation.message}`);
        return res.status(409).json({
          success: false,
          code: "ORDER_NOT_AWAITING_PAYMENT",
          status: previousStatus,
          message: notPayableReason(order),
        });
      }

      await client.query(
        `UPDATE orders SET payment_status = 'failed', status = 'payment_failed',
                remaining_amount = total_amount, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [orderId],
      );

      // Stock is reserved when the order is created. Hand it back, otherwise
      // abandoned checkouts silently consume inventory. payment_failed is
      // terminal in the lifecycle, so this cannot run twice.
      await client.query(
        `UPDATE supplier_inventory si
            SET stock = si.stock + oi.quantity
           FROM order_items oi
          WHERE oi.order_id = $1 AND si.id = oi.inventory_item_id`,
        [orderId],
      );

      await client.query(
        `UPDATE payment_transactions SET payment_status = 'superseded', updated_at = CURRENT_TIMESTAMP
          WHERE order_id = $1 AND payment_status = 'pending'`,
        [orderId],
      );

      await client.query(
        `INSERT INTO order_status_history (order_id, status, previous_status, updated_by, updated_by_role, remarks)
         VALUES ($1,'payment_failed',$2,$3,$4,$5)`,
        // The payer, always. An account that both buys and sells is "both",
        // and writing that here put "by the both" in the timeline.
        [orderId, previousStatus, userId, "buyer", remarks || "Buyer left the payment screen before paying"],
      );

      await client.query("COMMIT");
      return res.json({ success: true, message: "Payment cancelled." });
    }

    // ---- Buyer says they have paid ----------------------------------------
    if (!canAcceptPayment(order)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        code: "ORDER_NOT_AWAITING_PAYMENT",
        status: previousStatus,
        message: notPayableReason(order),
      });
    }

    const remaining = remainingFor(order);
    const due = nextInstalment(order);

    // Settle the session opened by initiatePayment when there is one, so the
    // amount shown on the QR code is the amount recorded. Its value is still
    // checked against what is owed, because the row is older than this moment.
    let session = null;
    if (paymentId) {
      const found = await client.query(
        "SELECT * FROM payment_transactions WHERE id = $1 AND order_id = $2 FOR UPDATE",
        [paymentId, orderId],
      );
      if (found.rows.length === 0) throw new Error("Payment session not found.");
      session = found.rows[0];
    } else {
      const found = await client.query(
        `SELECT * FROM payment_transactions
          WHERE order_id = $1 AND payment_status = 'pending'
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [orderId],
      );
      session = found.rows[0] || null;
    }

    if (session && ["completed", "paid"].includes(session.payment_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        code: "PAYMENT_ALREADY_RECORDED",
        message: "This payment has already been recorded.",
      });
    }

    // Never take more than is owed, whatever a stale session says.
    const paidNow = Math.min(
      toPaise(session ? session.amount : due.amount),
      toPaise(remaining),
    );
    if (paidNow <= 0) throw new Error("There is nothing left to pay on this order.");
    const paidNowRupees = fromPaise(paidNow);

    let created = null;
    if (session) {
      await client.query(
        `UPDATE payment_transactions
            SET payment_status = 'completed', amount = $1, upi_transaction_reference = $2,
                payment_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`,
        [paidNowRupees, upiTransactionReference || null, session.id],
      );
    } else {
      created = await client.query(
        `INSERT INTO payment_transactions
           (order_id, buyer_id, supplier_id, amount, payment_method, payment_status,
            installment_number, payment_type, upi_transaction_reference,
            gateway_response, payment_date, created_at)
         SELECT $1, o.buyer_id, o.supplier_id, $2, $3, 'completed', $4, $5, $6, $7,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           FROM orders o WHERE o.id = $1
         RETURNING id`,
        [orderId, paidNowRupees, paymentMethod, due.installmentNumber, due.paymentType,
         upiTransactionReference || null, JSON.stringify({ method: paymentMethod })],
      );
    }

    const newPaidPaise = toPaise(alreadyPaid) + paidNow;
    const newRemainingPaise = toPaise(order.total_amount) - newPaidPaise;
    const settled = newRemainingPaise <= 0;
    const newPaymentStatus = settled ? "paid" : "partially_paid";

    await client.query(
      `UPDATE orders SET amount_paid = $1, remaining_amount = $2, payment_status = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $4`,
      [fromPaise(newPaidPaise), fromPaise(Math.max(newRemainingPaise, 0)), newPaymentStatus, orderId],
    );

    // Advance the lifecycle only when it is actually waiting on this payment.
    // A second instalment lands on an order the seller may already be
    // processing, and must not drag it back to payment_completed.
    const nextOrderStatus = mapPaymentStatusToOrderStatus(newPaymentStatus);
    const transition = validateStatusTransition(previousStatus, nextOrderStatus);
    const statusMoved = transition.valid && nextOrderStatus !== previousStatus;
    if (statusMoved) {
      await client.query(
        "UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [nextOrderStatus, orderId],
      );
    }

    // The same money, in the wholesaler's khata. Without this the customer
    // page answers "how much does they owe me" using hand written sales only,
    // so a retailer who paid half a large order through the shop still showed
    // their full old balance.
    await recordOrderPayment(client, {
      orderId,
      partyId: order.party_id,
      wholesalerId: order.supplier_id,
      amount: paidNowRupees,
      method: paymentMethod,
      transactionId: session ? session.id : created?.rows[0]?.id || null,
      note: `Order ${order.order_number || orderId}, instalment ${due.installmentNumber}`,
    });

    await client.query(
      `INSERT INTO order_status_history (order_id, status, previous_status, updated_by, updated_by_role, remarks)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        orderId,
        statusMoved ? nextOrderStatus : previousStatus,
        previousStatus,
        userId,
        // Only the buyer of this order reaches here, whatever their account
        // role happens to be.
        "buyer",
        remarks ||
          `Payment of ${paidNowRupees.toFixed(2)} recorded (instalment ${due.installmentNumber}). Outstanding ${fromPaise(Math.max(newRemainingPaise, 0)).toFixed(2)}.`,
      ],
    );

    await client.query("COMMIT");

    // Reconcile, not create: the invoice was raised when the order was placed
    // and is sitting on Pending, so creating again returned early and left it
    // stamped UNPAID over money that had just been received.
    //
    // Run on every payment, not only the last one. This used to be guarded by
    // `settled`, so a first instalment left the bill showing nothing received
    // while the order screen showed a receipt for it. Reconciling is
    // idempotent, so calling it on a payment that changes nothing is free.
    invoiceService.reconcileInvoiceForOrder(orderId).catch((invErr) => {
      console.warn("Background invoice reconcile notice:", invErr.message);
    });

    notifyPaymentRecorded(orderId, paidNowRupees, fromPaise(Math.max(newRemainingPaise, 0)));

    res.json({
      success: true,
      message: settled ? "Payment complete." : "Payment recorded.",
      amountPaid: fromPaise(newPaidPaise),
      remainingAmount: fromPaise(Math.max(newRemainingPaise, 0)),
      paymentStatus: newPaymentStatus,
      fullyPaid: settled,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error updating transaction records pipeline:", error);
    res.status(400).json({ success: false, message: error.message || "Internal server state error processing updates." });
  } finally {
    client.release();
  }
};

const getOrderById = async (req, res) => {
  try {
    const accessCheck = await ensureOrderAccess(req, res, req.params.orderId, { requireBuyer: true, requireSupplier: true });
    if (!accessCheck) return;

    // Include what was actually ordered - the detail page needs the product,
    // its image and the supplier, not just the raw order row.
    const result = await pool.query(
      `SELECT
         o.*,
         p.id            AS product_id,
         p.name          AS product_name,
         p.category      AS product_category,
         COALESCE(si.image_url, p.global_image_url) AS product_image,
         si.price        AS unit_price,
         si.discount_price AS unit_discount_price,
         si.moq,
         si.shipping_days,
         su.id           AS supplier_user_id,
         COALESCE(wp.company_name, su.first_name || ' ' || su.last_name) AS supplier_name,
         wp.city         AS supplier_city,
         wp.country      AS supplier_country,
         wp.contact_phone AS supplier_phone,
         -- A MANUAL ORDER HAS NO BUYER USER and no single inventory item, so
         -- every one of these used to come back null and the detail screen
         -- rendered blanks where the customer and the goods belong. The party
         -- is who the order is for, and order_items is what is on it.
         COALESCE(
           NULLIF(TRIM(bu.first_name || ' ' || bu.last_name), ''),
           pt.name,
           'Customer'
         ) AS buyer_name,
         COALESCE(pt.phone, o.contact_phone) AS party_phone,
         pt.city AS party_city,
         items.first_product AS first_item,
         items.item_count
       FROM orders o
       LEFT JOIN supplier_inventory si ON o.inventory_item_id = si.id
       LEFT JOIN products p ON si.product_id = p.id
       -- Falls back to the order's own supplier_id, because a manual order has
       -- no inventory_item_id to reach the wholesaler through.
       LEFT JOIN users su ON su.id = COALESCE(si.supplier_id, o.supplier_id)
       LEFT JOIN wholesaler_profiles wp ON wp.user_id = su.id
       LEFT JOIN users bu ON o.buyer_id = bu.id
       LEFT JOIN parties pt ON pt.id = o.party_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS item_count, MIN(oi.product_name) AS first_product
           FROM order_items oi WHERE oi.order_id = o.id
       ) items ON TRUE
       WHERE o.id = $1`,
      [req.params.orderId],
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Not found" });

    // Line items for multi-product orders. Older single-item orders have no
    // rows here, so the caller falls back to the flattened product columns.
    const itemsResult = await pool.query(
      `SELECT oi.id, oi.product_id, oi.product_name, oi.quantity,
              oi.unit_price, oi.discount_price, oi.total_price, oi.moq,
              oi.shipping_days,
              COALESCE(si.image_url, p.global_image_url) AS image,
              p.category
       FROM order_items oi
       LEFT JOIN supplier_inventory si ON si.id = oi.inventory_item_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at ASC`,
      [req.params.orderId],
    );

    // Real payments taken against this order. Without these the instalment
    // timeline has nothing to show and falls back to placeholders, which
    // leaves a paid instalment looking unpaid.
    const paymentsResult = await pool.query(
      // 'paid' is the word the timeline reads, and only completed rows are
      // listed, so the status is fixed rather than selected.
      `SELECT id, amount, payment_method, 'paid' AS status,
              installment_number AS "installmentNumber",
              payment_type AS "paymentType",
              upi_transaction_reference AS "upiReference",
              COALESCE(payment_date, created_at) AS "createdAt"
         FROM payment_transactions
        WHERE order_id = $1 AND payment_status = 'completed'
        ORDER BY installment_number ASC, created_at ASC`,
      [req.params.orderId],
    );

    // How long the goods can still be sent back. Worked out here rather than
    // on the screen, so one rule decides it and the screen can say "3 days
    // left" instead of letting somebody press a button and be refused.
    const window = await returnWindowForOrder(req.params.orderId);

    res.json({
      ...result.rows[0],
      items: itemsResult.rows,
      payments: paymentsResult.rows,
      returnWindow: {
        days: RETURN_WINDOW_DAYS,
        open: window.open,
        daysLeft: window.daysLeft,
        closesAt: window.closesAt,
        knownDelivery: window.knownDelivery,
        reason: window.reason,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// The lifecycle status the wholesaler moves the order to, and the shorter
// word the older return_status column uses for the same thing. Both are kept
// current because screens and reports read one or the other.
const RETURN_ANSWERS = {
  return_approved: "approved",
  return_rejected: "rejected",
  return_completed: "completed",
};

/**
 * Goods are back. Stop billing for them.
 *
 * Two things happen, and only the first one changes what anybody owes.
 *
 * The sale is cancelled. An accepted order writes itself a sale, and from
 * that moment the sale is what the khata bills, not the order. partyController
 * already leaves an order at return_completed out of the billed side, but for
 * an order that reached delivery, and every returned order did, that clause
 * has no effect: the debt is coming from the sale, which is still confirmed.
 * So the sale is what has to be cancelled, or the customer goes on owing for
 * goods sitting back in the godown.
 *
 * A credit note is raised against the invoice, if there is one. That is the
 * document GST asks for when goods come back: the invoice stands and is
 * reversed by a note, rather than being deleted as though it never happened.
 *
 * The credit note does NOT move the balance, and must not start doing so
 * while this cancels the sale, or a return would be subtracted twice. If
 * credit notes are ever made to reduce the khata, this needs the guard that
 * a note against an already cancelled sale counts for nothing.
 *
 * Money paid stays where it is, exactly as it does when an order is refused:
 * it is real money, and the customer sits in credit until somebody refunds
 * them. That is what the refunded state further along the lifecycle is for.
 *
 * Best effort, on its own transaction. A credit note that cannot be written
 * is worth a line in the log; it is not worth refusing to accept goods that
 * are physically back.
 */
/**
 * The bill for these goods, by whichever road it was raised.
 *
 * Looking only at invoices.order_id missed two real cases and left a returned
 * order with a tax invoice standing and nothing reversing it:
 *
 *   the bill was raised from the SALE, which happens whenever the wholesaler
 *   takes the balance in cash and records it on the khata. That invoice
 *   carries a sale_id and no order_id.
 *
 *   the bill had not landed yet. Checkout and the payment handler both raise
 *   it in the background, so a return completed briskly, or on a busy
 *   database, can outrun it.
 */
const billForOrder = async (client, orderId) => {
  const bridged = await invoiceRepository.schemaExtras();
  const bySale = bridged.has_sale_id && bridged.has_sale_order_id
    ? `OR i.sale_id IN (SELECT id FROM sales WHERE order_id = $1)`
    : "";
  const found = await client.query(
    `SELECT i.id, i.supplier_id FROM invoices i
      WHERE i.order_id = $1 ${bySale}
      LIMIT 1`,
    [orderId],
  );
  return found.rows[0] || null;
};

const unwindReturnedOrder = async (orderId, userId) => {
  /**
   * Make sure the bill exists BEFORE anything is cancelled.
   *
   * Raising it afterwards is not possible: the sale is cancelled two lines
   * below and both billing paths refuse a cancelled sale, which is correct.
   * So an order that is settled but whose bill has not caught up gets it
   * raised here, and is then reversed properly. An order that was never paid
   * has no bill and there is nothing to reverse, which is also right.
   *
   * Outside the transaction, because reconcile opens its own.
   */
  let existing = await billForOrder(pool, orderId);
  if (!existing) {
    try {
      await invoiceService.reconcileInvoiceForOrder(orderId);
      existing = await billForOrder(pool, orderId);
    } catch (billErr) {
      console.warn(`Order ${orderId} returned, could not settle its bill first: ${billErr.message}`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hasBridge = await hasSaleLink(client);
    if (hasBridge) {
      await client.query(
        `UPDATE sales SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE order_id = $1 AND status <> 'cancelled'`,
        [orderId],
      );
    }

    const invoice = { rows: existing ? [existing] : [] };
    if (invoice.rows.length > 0) {
      const result = await creditNoteService.createCreditNote(
        {
          invoiceId: invoice.rows[0].id,
          wholesalerId: invoice.rows[0].supplier_id,
          reason: "goods_returned",
        },
        client,
      );
      // "exists" is not a failure: the note was already raised, which is what
      // running this twice looks like.
      if (result?.error && result.error !== "exists") {
        console.warn(`Order ${orderId} returned but no credit note: ${result.error}`);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.warn(`Order ${orderId} returned but not unwound: ${err.message}`);
  } finally {
    client.release();
  }
};

/**
 * The last step of a return: the wholesaler hands the money back.
 *
 * The lifecycle has always allowed return_completed to become refunded and
 * nothing has ever called it, so every returned order stopped one step short.
 * The goods were back on the shelf, the sale was cancelled, the credit note
 * was raised, and the customer's money was still in the till with the Overview
 * correctly reporting it as owed back to them. Nothing could clear that line.
 *
 * There is no payment gateway here, so this records a refund the wholesaler
 * has made themselves, exactly as payments are recorded: they say they have paid,
 * and the books follow. The amount is capped at what was actually received, so
 * no amount of typing can hand back more than came in.
 */
const refundOrder = async (req, res) => {
  const { orderId } = req.params;
  const method = clean(req.body?.method) || "upi";
  const reference = clean(req.body?.reference);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const found = await client.query(
      `SELECT id, status, supplier_id, buyer_id, amount_paid, refund_amount,
              refund_status, order_number
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    const order = found.rows[0];

    // Only the wholesaler can pay money back, because they are the one paying it.
    // Not role gated at the route, because a 403 clears the token.
    if (order.supplier_id !== businessId(req)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "Only the seller can record a refund on this order.",
      });
    }

    const transition = validateStatusTransition(order.status, "refunded");
    if (!transition.valid) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message:
          order.status === "refunded"
            ? "This order has already been refunded."
            : "A refund can only be recorded once the goods have come back.",
      });
    }

    const received = toPaise(order.amount_paid || 0);
    if (received <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Nothing was ever paid on this order, so there is nothing to refund.",
      });
    }

    // Whatever the request says, never more than came in.
    const askedPaise = req.body?.amount === undefined
      ? received
      : toPaise(Number(req.body.amount) || 0);
    if (askedPaise <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Enter a refund amount greater than zero.",
      });
    }
    const refundPaise = Math.min(askedPaise, received);
    const refund = fromPaise(refundPaise);

    await client.query(
      `UPDATE orders
          SET status = 'refunded',
              refund_amount = $2,
              refund_status = 'processed',
              refund_id = COALESCE($3, refund_id),
              refund_processed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [orderId, refund, reference || null],
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, previous_status, updated_by, updated_by_role, remarks)
       VALUES ($1,'refunded',$2,$3,'supplier',$4)`,
      [
        orderId,
        order.status,
        req.user.id,
        `Refund of ${refund.toFixed(2)} paid back by ${method}${reference ? `, reference ${reference}` : ""}.`,
      ],
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Refund recorded.",
      refundAmount: refund,
      // True whenever the wholesaler chose to hand back less than they received,
      // so the screen can say so rather than implying the account is square.
      partial: refundPaise < received,
      stillHeld: fromPaise(received - refundPaise),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error recording refund:", error);
    res.status(500).json({ success: false, message: "Failed to record the refund" });
  } finally {
    client.release();
  }
};

const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status, remarks } = req.body;
  // What shipping raised, so the screen can name the bill rather than making
  // the wholesaler go and look for it.
  let shipped = null;
  const userId = req.user.id;
  // What this person is on THIS order, not what their account says. An
  // account may be "both", a wholesaler who also buys, and the timeline was
  // printing that straight out: "Accepted, by the both". Only the supplier
  // can reach this route, so that is what gets written down.
  const userRole = "supplier";

  if (!status) {
    return res.status(400).json({ success: false, message: "Status is required" });
  }

  try {
    const accessCheck = await ensureOrderAccess(req, res, orderId, { requireBuyer: false, requireSupplier: true });
    if (!accessCheck) return;

    const orderLookup = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
    if (orderLookup.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const previousStatus = orderLookup.rows[0].status;
    const validation = validateStatusTransition(previousStatus, status);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    /**
     * Two states are not a step, they are an unwinding, and this route cannot
     * do one.
     *
     * Cancelling has to cancel the sale behind the order, put the reserved
     * stock back and account for anything already paid. Refunding has to move
     * money. Both live in their own handlers, POST /cancel and POST /refund,
     * and both were reachable through here as a plain status write: the order
     * went to `cancelled`, the sale stayed `confirmed`, and the customer went
     * on being billed for goods they were never going to get. The screens use the
     * proper endpoints, so nothing in the product did this; the route allowed
     * it, which is enough.
     */
    if (status === "cancelled" || status === "refunded") {
      return res.status(400).json({
        success: false,
        message:
          status === "cancelled"
            ? "Use the refuse or cancel button. Cancelling has to return the stock and unwind the sale."
            : "Use the refund button. A refund has to move the money, not just the status.",
        code: "USE_DEDICATED_ROUTE",
      });
    }

    // The delivery date is stamped here as well as in orderStatusService,
    // because this route writes the status itself rather than going through
    // it. The return window is counted from that date, and the column had
    // never been written to by anything.
    // Despatch is the only moment the transport is known, and on a shop order
    // the bill was raised when the order was placed. So it is stamped onto the
    // order AND onto the invoice that already exists. See transportDetails for
    // why that is not a breach of the freezing rule.
    const { values: transport, error: transportError } = parseTransport(req.body);
    if (transportError) {
      return res.status(400).json({ success: false, message: transportError });
    }

    await pool.query(
      `UPDATE orders
          SET status = $1,
              -- $3 is a plain boolean, not a comparison against $1. Postgres
              -- deduces $1 as varchar from the SET and as text from a
              -- comparison, refuses to pick one, and the whole update fails.
              actual_delivery_date = CASE WHEN $3
                                          THEN COALESCE(actual_delivery_date, CURRENT_DATE)
                                          ELSE actual_delivery_date END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [status, orderId, status === "delivered"],
    );

    // Its own try. Transport details that could not be written are worth a
    // line in the log; they are not worth refusing a despatch the wholesaler
    // has already made.
    if ((await invoiceRepository.schemaExtras()).has_order_transport) {
      try {
        await stampTransport(pool, "orders", orderId, transport);
      } catch (transportErr) {
        console.warn("Could not record the transport on this order:", transportErr.message);
      }
    }

    // Accepting is the moment the order becomes business. It goes into the
    // sales book here, and from there the invoice, the statement and the
    // credit note all work on it without any of them being taught about
    // orders. Before this, an order was fulfilment only and never reached the
    // book at all.
    //
    // Its own transaction, and its own try. A sales book that could not be
    // written is worth a line in the log and a backfill later; it is not
    // worth refusing a wholesaler's acceptance of an order.
    /**
     * THE GOODS LEAVE, SO THE BILL EXISTS. s.31(1)(a) puts the tax invoice
     * before or at removal, and this is removal. See services/shipOrder.js
     * for why a challan is the exception here and not the default.
     *
     * Outside the response path on purpose, like the acceptance hook below:
     * a bill that could not be raised is a line in the log and a backfill,
     * not a reason to refuse a dispatch that has physically happened.
     */
    if (status === "shipped") {
      try {
        const raised = await shipOrder(orderId, businessId(req), {
          challanReason: req.body.challanReason || null,
        });
        shipped = {
          saleNumber: raised.sale?.sale_number || null,
          invoiceNumber: raised.invoice?.invoice_number || null,
          challanNumber: raised.challan?.challan_number || null,
        };
      } catch (shipErr) {
        console.warn(`Order ${orderId} shipped but not billed: ${shipErr.message}`);
      }
    }

    if (status === "supplier_accepted") {
      const saleClient = await pool.connect();
      try {
        await saleClient.query("BEGIN");
        await createSaleFromOrder(saleClient, orderId);
        await saleClient.query("COMMIT");
      } catch (saleErr) {
        await saleClient.query("ROLLBACK");
        console.warn(
          `Order ${orderId} accepted but not written to the sales book: ${saleErr.message}`,
        );
      } finally {
        saleClient.release();
      }
    }

    // The return states. Approving and rejecting are answers; completing is
    // the one that moves money, because that is when the goods are actually
    // back on the shelf.
    if (RETURN_ANSWERS[status]) {
      await pool.query(
        // $2 is cast explicitly because it is used both as a value to store
        // and inside a comparison, and Postgres will not deduce one type for
        // both on its own.
        `UPDATE orders SET return_status = $2::text,
                           return_completed_at = CASE WHEN $2::text = 'completed'
                                                      THEN CURRENT_TIMESTAMP
                                                      ELSE return_completed_at END
          WHERE id = $1`,
        [orderId, RETURN_ANSWERS[status]],
      );
    }

    if (status === "return_completed") {
      await unwindReturnedOrder(orderId, userId);
    }

    /**
     * The sales book follows the order, from this route too.
     *
     * This lived only in orderStatusService, and the screens do not go through
     * it: the "Mark delivered" button PATCHes here, which writes the status
     * itself. So in the running product an order could be marked delivered
     * and its sale would sit at "confirmed" for ever, which is the exact
     * drift the sale's own delivered button was removed to prevent.
     */
    if (status === "delivered") {
      const saleClient = await pool.connect();
      try {
        await markSaleDelivered(saleClient, orderId);
      } catch (mirrorErr) {
        console.warn(
          `Order ${orderId} delivered but its sale was not: ${mirrorErr.message}`,
        );
      } finally {
        saleClient.release();
      }
    }

    // No default remark. The screen already prints the status in plain
    // English as the heading of the entry, so "Status updated to
    // ready_for_pickup" underneath it added nothing but an internal name.
    await recordStatusChange(orderId, status, previousStatus, userId, userRole, remarks || null);
    // `shipped` names the bill that was just raised, so the screen can say
    // so instead of leaving the wholesaler to go and find it.
    res.json({ success: true, message: "Order status updated", shipped });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to update status" });
  }
};

/**
 * Refuse an order, or call one off.
 *
 * Both sides land here. A wholesaler who cannot fill an order refuses it; a
 * buyer who changes their mind before it goes out cancels it. The unwinding is
 * identical, so there is one path rather than two that could drift apart.
 *
 * Who may do it, and from which states, is decided inside cancelOrder against
 * the order itself, so this does not repeat the rule in a second place.
 */
const cancelOrderHandler = async (req, res) => {
  const { orderId } = req.params;
  const reason = clean(req.body?.reason);

  try {
    const accessCheck = await ensureOrderAccess(req, res, orderId, {
      requireBuyer: true,
      requireSupplier: true,
    });
    if (!accessCheck) return;

    const result = await cancelOrder(orderId, req.user.id, reason, businessId(req));
    res.json(result);
  } catch (error) {
    // The service throws for the ordinary refusals as well as for faults:
    // wrong person, wrong state, order gone. Those are the caller's problem,
    // not the server's, and answering all of them with a 500 would tell a
    // wholesaler their order failed to cancel when it simply cannot be.
    const isRefusal =
      /cannot cancel|already been sent|not found|not allowed|Invalid status/i.test(error.message || "");
    if (!isRefusal) console.error("Error cancelling order:", error);
    res
      .status(isRefusal ? (/(not found)/i.test(error.message) ? 404 : 400) : 500)
      .json({ success: false, message: error.message || "Failed to cancel order" });
  }
};

const getOrderTimelineHandler = async (req, res) => {
  try {
    const accessCheck = await ensureOrderAccess(req, res, req.params.orderId, { requireBuyer: true, requireSupplier: true });
    if (!accessCheck) return;

    const timeline = await getOrderTimeline(req.params.orderId);
    res.json({ success: true, timeline });
  } catch (error) {
    console.error("Error fetching timeline:", error);
    res.status(500).json({ success: false, message: "Failed to load timeline" });
  }
};

/**
 * The buyer asks to send goods back.
 *
 * This used to set return_status and nothing else, so orders.status stayed at
 * "delivered" and the request existed only as a flag nobody read. The
 * wholesaler was never told, and there was no screen where they could have
 * answered. A return was a note in a bottle.
 *
 * The order now moves to return_requested, which is a real state the
 * lifecycle already knew about, so it appears on the wholesaler's list with
 * something to do about it.
 *
 * A reason is required. It is the only thing the wholesaler has to decide on,
 * and "returned" with no explanation is how a disagreement starts.
 */
const requestReturn = async (req, res) => {
  const { orderId } = req.params;
  const reason = clean(req.body?.reason);

  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "Please say what is wrong with the goods.",
    });
  }

  try {
    const accessCheck = await ensureOrderAccess(req, res, orderId, { requireBuyer: true, requireSupplier: false });
    if (!accessCheck) return;

    const lookup = await pool.query(
      "SELECT status, buyer_id FROM orders WHERE id = $1",
      [orderId],
    );
    if (lookup.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    // The seller's own return route is different; this one is the buyer's.
    if (lookup.rows[0].buyer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "This is not your order." });
    }

    const previousStatus = lookup.rows[0].status;
    const validation = validateStatusTransition(previousStatus, "return_requested");
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message:
          previousStatus === "return_requested"
            ? "You have already asked to return this order."
            : "Goods can only be sent back once the order has been delivered.",
      });
    }

    // The lifecycle says a delivered order may be returned. It cannot say
    // whether the goods arrived on Tuesday or last February, so the clock is
    // asked separately. Without this the door never shut: an order delivered a
    // year ago could still be sent back, and the wholesaler had nothing to
    // point at when they said no.
    const window = await returnWindowForOrder(orderId);
    if (!window.open) {
      return res.status(400).json({
        success: false,
        code: "RETURN_WINDOW_CLOSED",
        message: window.reason,
      });
    }

    await pool.query(
      `UPDATE orders
          SET status = 'return_requested',
              return_status = 'requested',
              return_reason = $3,
              return_requested_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND buyer_id = $2`,
      [orderId, req.user.id, reason],
    );

    await recordStatusChange(orderId, "return_requested", previousStatus, req.user.id, "buyer", reason);

    res.json({ success: true, message: "The seller has been asked about this return." });
  } catch (error) {
    console.error("Error requesting return:", error);
    res.status(500).json({ success: false, message: "Failed to request return" });
  }
};

/**
 * The buyer's copy of the seller's invoice.
 *
 * This used to draw its own six-line PDF with an invented "INV-<order-uuid>"
 * number, so the same order had two different invoices with two different
 * numbers depending on who downloaded it - and the buyer's copy carried no
 * GST breakdown, no HSN codes and only the first line of a multi-item order.
 *
 * There is one invoice per order and the seller issues it. This now serves
 * exactly that document; the route is kept so existing links keep working.
 */
const generateInvoice = async (req, res) => {
  try {
    const invoice = await invoiceService.getInvoiceForOrder(
      req.params.orderId,
      req.user.id,
      req.user.role,
    );
    await pdfService.generateInvoicePDF(invoice, res);
  } catch (error) {
    console.error("Invoice generation error:", error);
    if (res.headersSent) return;
    const denied = /access denied/i.test(error.message || "");
    res
      .status(denied ? 403 : 500)
      .json({ success: false, message: denied ? error.message : "Failed to generate invoice" });
  }
};

const generatePackingSlip = async (req, res) => {
  try {
    const accessCheck = await ensureOrderAccess(req, res, req.params.orderId, { requireBuyer: true, requireSupplier: true });
    if (!accessCheck) return;

    const { rows } = await pool.query(
      `SELECT o.*, p.name as product_name, p.category, u.first_name || ' ' || u.last_name as buyer_name, su.first_name || ' ' || su.last_name as supplier_name
       FROM orders o
       JOIN supplier_inventory si ON o.inventory_item_id = si.id
       JOIN products p ON si.product_id = p.id
       JOIN users u ON o.buyer_id = u.id
       JOIN users su ON si.supplier_id = su.id
       WHERE o.id = $1`,
      [req.params.orderId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    const order = rows[0];
    res.json({ success: true, packingSlip: { orderId: order.id, supplierName: order.supplier_name, buyerName: order.buyer_name, productName: order.product_name, category: order.category, quantity: order.quantity, status: order.status } });
  } catch (error) {
    console.error("Packing slip error:", error);
    res.status(500).json({ success: false, message: "Failed to generate packing slip" });
  }
};

/**
 * Tell both sides that money moved. Deliberately not awaited by the caller and
 * never allowed to throw: a notification channel being down must not fail a
 * payment that has already been committed.
 */
const notifyPaymentRecorded = async (orderId, paidNow, outstanding) => {
  try {
    const { rows } = await pool.query(
      "SELECT buyer_id, supplier_id, order_number FROM orders WHERE id = $1",
      [orderId],
    );
    if (rows.length === 0) return;
    const { buyer_id: buyerId, supplier_id: supplierId, order_number: orderNumber } = rows[0];
    const tail = outstanding > 0
      ? `Outstanding balance ₹${outstanding.toFixed(2)}.`
      : "This order is now fully paid.";

    const send = (userId, title, message) =>
      userId &&
      enqueueNotification({
        userId,
        title,
        message,
        notificationType: NOTIFICATION_TYPES.payment_update,
        channels: [NOTIFICATION_CHANNELS.IN_APP],
        referenceId: orderId,
        referenceType: "order",
      });

    await send(buyerId, "Payment recorded", `We recorded ₹${paidNow.toFixed(2)} for order ${orderNumber}. ${tail}`);
    await send(supplierId, "Payment received", `₹${paidNow.toFixed(2)} received for order ${orderNumber}. ${tail}`);
  } catch (err) {
    console.warn("Payment notification notice:", err.message);
  }
};

/**
 * Seller nudges a buyer who still owes an instalment.
 * @route POST /api/orders/:orderId/send-installment-reminder
 */
const sendInstallmentReminder = async (req, res) => {
  const { orderId } = req.params;
  try {
    const accessCheck = await ensureOrderAccess(req, res, orderId, { requireBuyer: false, requireSupplier: true });
    if (!accessCheck) return;

    const { rows } = await pool.query(
      `SELECT o.id, o.buyer_id, o.supplier_id, o.order_number, o.total_amount,
              o.amount_paid, o.remaining_amount, o.status,
              COALESCE(wp.company_name, u.first_name || ' ' || u.last_name) AS supplier_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.supplier_id
         LEFT JOIN wholesaler_profiles wp ON wp.user_id = o.supplier_id
        WHERE o.id = $1`,
      [orderId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const order = rows[0];
    // Only the seller on the order, never another seller who guessed the id.
    if (req.user.role !== "admin" && String(order.supplier_id) !== String(businessId(req))) {
      return res.status(403).json({ success: false, message: "This is not your order." });
    }

    const outstanding = remainingFor(order);
    if (toPaise(outstanding) <= 0) {
      return res.status(400).json({ success: false, message: "This order has nothing outstanding." });
    }
    if (PAYMENT_BLOCKING_STATUSES.has(order.status)) {
      return res.status(409).json({ success: false, message: "This order can no longer take a payment." });
    }

    await enqueueNotification({
      userId: order.buyer_id,
      title: "Payment reminder",
      message: `${order.supplier_name || "Your supplier"} is waiting on ₹${outstanding.toFixed(2)} for order ${order.order_number}.`,
      notificationType: NOTIFICATION_TYPES.payment_update,
      channels: [NOTIFICATION_CHANNELS.IN_APP],
      referenceId: order.id,
      referenceType: "order",
    });

    return res.json({ success: true, message: "Reminder sent.", remainingAmount: outstanding });
  } catch (error) {
    console.error("sendInstallmentReminder error:", error);
    return res.status(500).json({ success: false, message: "Could not send the reminder." });
  }
};

module.exports = {
  createOrder,
  getPaymentDetails,
  initiatePayment,
  updatePaymentStatus,
  sendInstallmentReminder,
  getOrderById,
  getSupplierOrders,
  getBuyerOrders,
  updateOrderStatus,
  cancelOrderHandler,
  getOrderTimelineHandler,
  requestReturn,
  refundOrder,
  generateInvoice,
  generatePackingSlip,
};
/**
 * An order typed by the wholesaler, for one taken on the phone or at the
 * counter.
 *
 * WHAT AN ORDER IS, and what it is not. It is a PROMISE: the customer has
 * asked for goods and nothing has happened yet. So this writes no sale, moves
 * no stock and touches no balance. All three start when the goods go and the
 * bill is raised, which is the ship step, not this one. An order that also
 * moved the khata would have every sale counted twice, once when it was
 * promised and again when it was billed.
 *
 * NO BUYER USER. A shop order belongs to somebody with an account. This one
 * belongs to a party in the wholesaler's own book and has `buyer_id` null,
 * which is why the seller's order list had to stop inner joining `users`.
 *
 * IT STARTS AT `supplier_accepted`, which is not a fudge. The lifecycle sends
 * `pending` only to `payment_pending`, because on the marketplace a buyer pays
 * before a wholesaler ever sees the order. Here the wholesaler wrote the order
 * down himself, so it IS accepted the moment it exists, and starting it there
 * puts it on the ordinary spine: processing, packed, ready for pickup,
 * shipped, with no new transition invented for it.
 *
 * `payment_status` stays pending. Nobody has been asked for money: the bill
 * goes out when the goods do.
 */
// Assigned onto module.exports rather than the `exports` alias, because this
// file replaces module.exports wholesale further up and anything hung off the
// alias after that point is silently dropped.
module.exports.createManualOrder = async (req, res) => {
  const wholesalerId = businessId(req);
  const {
    partyId, lines, notes, expectedOn,
    // The same particulars a shop order carries, so the detail screen, the
    // challan and the bill all have what they need and a manual order is not
    // a second class document. Marg and Busy ask for exactly these on a sales
    // order: where it goes, who to ring, and their own reference.
    deliveryAddress, contactPhone, theirReference,
    channel: askedChannel,
  } = req.body || {};

  if (!partyId) return res.status(400).json({ message: "Choose the customer." });
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "Add at least one item to this order." });
  }

  /**
   * Which book the order belongs to, so the sale and the bill it becomes land
   * in that run. It does NOT pick the order's number: every order, typed or
   * from the shop page, takes the one SO/ run, which is what was agreed on
   * 19 Sept. Counter by default, since that is what a phone order is.
   *
   * Asymmetric before the migration, the same as the customer's state: naming
   * a channel it cannot store is a loud 503, leaving it at the counter changes
   * nothing.
   */
  const { channel, error: channelError } = await resolveChannel(askedChannel, wholesalerId);
  if (channelError) return res.status(400).json({ message: channelError });
  const canFile = await hasOrderChannel();
  if (channel !== DEFAULT_CHANNEL && !canFile) {
    return res.status(503).json({
      message: "Orders cannot be filed under a marketplace yet. Leave it at Counter or phone for now.",
      code: "ORDER_CHANNEL_NOT_SET_UP",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const party = await client.query(
      `SELECT id, name FROM parties WHERE id = $1 AND wholesaler_id = $2`,
      [partyId, wholesalerId],
    );
    if (party.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Customer not found" });
    }

    const clean = [];
    for (const [i, raw] of lines.entries()) {
      const name = String(raw.itemName ?? raw.item_name ?? "").trim();
      if (!name) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `Line ${i + 1} has no item name.` });
      }
      const quantity = Number(raw.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `Enter a quantity for ${name}.` });
      }
      const rate = Number(raw.rate);
      if (!Number.isFinite(rate) || rate < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `Enter a rate for ${name}.` });
      }
      clean.push({
        name,
        quantity,
        rate,
        // Rounded in paise, the same as everywhere else, so an odd rate does
        // not drift a paisa from what the sale will later say.
        amount: Math.round(rate * quantity * 100) / 100,
        inventoryId: raw.productId || raw.inventory_item_id || null,
        unit: String(raw.unit ?? "").trim() || null,
      });
    }

    const subtotal =
      Math.round(clean.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

    // Where it goes. Falls back to what is on the customer's own record, so
    // the usual case is nothing to type: the address is already in the book.
    const line1 = String(deliveryAddress ?? "").trim();
    const address = line1
      ? { address: line1, phone: String(contactPhone ?? "").trim() || null,
          reference: String(theirReference ?? "").trim() || null }
      : null;
    const orderNumber = await nextOrderNumber(client, wholesalerId);

    const order = await client.query(
      `INSERT INTO orders
         (supplier_id, party_id, buyer_id, source, order_number, quantity,
          subtotal, total_amount, amount_paid, remaining_amount,
          status, payment_status, notes, expected_delivery_date, updated_at,
          delivery_address, billing_address, contact_phone)
       VALUES ($1,$2,NULL,'manual',$3,$4,$5,$5,0,$5,
               'supplier_accepted','pending',$6,$7::date,CURRENT_TIMESTAMP,
               $8,$9,$10)
       RETURNING *`,
      [
        wholesalerId, partyId, orderNumber,
        clean.reduce((n, l) => n + l.quantity, 0),
        subtotal,
        String(notes ?? "").trim() || null,
        expectedOn || null,
        // Stored as JSON, the shape the shop order uses and the detail screen
        // already reads, rather than a second shape it would have to learn.
        address ? JSON.stringify(address) : null,
        address ? JSON.stringify(address) : null,
        String(contactPhone ?? "").trim() || null,
      ],
    );
    if (canFile) {
      await client.query("UPDATE orders SET channel = $1 WHERE id = $2", [
        channel,
        order.rows[0].id,
      ]);
      order.rows[0].channel = channel;
    }

    for (const line of clean) {
      await client.query(
        `INSERT INTO order_items
           (order_id, inventory_item_id, product_name, quantity, unit_price, total_price, moq)
         VALUES ($1,$2,$3,$4,$5,$6,1)`,
        [order.rows[0].id, line.inventoryId, line.name,
         line.quantity, line.rate, line.amount],
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ ...order.rows[0], party_name: party.rows[0].name });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.status) return res.status(err.status).json({ message: err.message, code: err.code });
    console.error("Error recording a manual order:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};
