const pool = require("../config/db");
const { FEATURES } = require("../config/features");
const { markSaleDelivered } = require("./orderSaleService");

/**
 * Order Status Service
 * 
 * Handles all order status transitions, validation, and related operations
 * including inventory synchronization and timeline tracking.
 */

/**
 * Every status an order can be in, and what it is allowed to become.
 *
 * This is the authority. Nothing should write orders.status without asking
 * validateStatusTransition first, and nothing should write a status that is
 * not a key here.
 *
 * This map used to repeat four keys: payment_completed, return_approved,
 * replacement_requested and replacement_issued each appeared twice. A later
 * entry silently wins in an object literal, so half the lines a reader could
 * find were dead, and anyone editing the first payment_completed would have
 * watched their change do nothing. The pairs were identical, so removing the
 * second of each changed no behaviour. Do not let them back in.
 */
const ORDER_STATUS_FLOW = {
  // supplier_accepted is here for an order the WHOLESALER took, on the phone
  // or at the counter. Manual orders are written straight in as accepted, so
  // they do not normally pass through pending at all, but any that were
  // created before that was true sit here with nowhere to go: the screen
  // offers no step for pending and the only other exits are payment_pending,
  // which is a marketplace idea, and cancelled. Without this they are
  // stranded for ever.
  //
  // It is also a real move in its own right. A wholesaler accepting an order
  // nobody has paid for yet is ordinary credit trade, and payment_status is a
  // separate column that stays pending until money actually arrives.
  pending: ['supplier_accepted', 'payment_pending', 'cancelled'],
  payment_pending: ['payment_completed', 'payment_failed', 'cancelled'],
  payment_completed: ['supplier_accepted', 'cancelled'],
  supplier_accepted: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  // Packed is the cut-off, and the map has to say so or the rule is only a
  // rule on the screens that ask nicely. Cancelling was reachable from packed,
  // ready_for_pickup and shipped through the generic status handler, so a
  // seller could kill an order whose goods were already with a driver by
  // posting a status directly, going round the refuse button that refuses.
  // Once goods are boxed the way out is a return.
  packed: ['ready_for_pickup'],
  ready_for_pickup: ['shipped'],
  shipped: ['in_transit'],
  in_transit: ['out_for_delivery'],
  out_for_delivery: ['delivered', 'failed_delivery'],
  delivered: ['completed', 'return_requested'],
  completed: ['return_requested'],
  return_requested: ['return_approved', 'return_rejected'],
  return_approved: ['return_completed', 'replacement_requested'],
  replacement_requested: ['replacement_issued'],
  replacement_issued: ['completed'],
  return_completed: ['refunded'],
  // The one place a cancellation still makes sense after dispatch. The goods
  // never arrived, so there is nothing to send back, and without this exit a
  // failed delivery could only be retried for ever.
  failed_delivery: ['out_for_delivery', 'cancelled'],
  // Terminal. Nothing follows these.
  cancelled: [],
  refunded: [],
  payment_failed: [],
  return_rejected: []
};

// When a buyer may still call their own order off.
const BUYER_CANCELLABLE_STATUSES = ['pending', 'payment_pending', 'payment_completed', 'supplier_accepted'];

// When a wholesaler may still refuse an order.
//
// payment_pending belongs here, and its absence made the whole idea useless:
// a new order sits at payment_pending from the moment it is placed, so
// without it a wholesaler could not refuse an order they had only just
// received, which is precisely when they want to.
//
// The line is drawn at packed. Once goods are boxed and a driver may be on
// their way, the way out is a return, not a cancellation.
const SUPPLIER_CANCELLABLE_STATUSES = [
  'pending',
  'payment_pending',
  'payment_completed',
  'supplier_accepted',
  'processing',
  // Not a late cancellation, an admission that the delivery never happened.
  // The goods are back with them, so there is nothing to return.
  'failed_delivery',
];

// Define status that can be returned
const RETURNABLE_STATUSES = ['delivered', 'completed'];

/**
 * Validate if a status transition is allowed
 */
const validateStatusTransition = (currentStatus, newStatus) => {
  if (!ORDER_STATUS_FLOW[currentStatus]) {
    return { valid: false, message: `Invalid current status: ${currentStatus}` };
  }
  
  if (!ORDER_STATUS_FLOW[currentStatus].includes(newStatus)) {
    return { 
      valid: false, 
      message: `Cannot transition from ${currentStatus} to ${newStatus}. Valid transitions: ${ORDER_STATUS_FLOW[currentStatus].join(', ')}` 
    };
  }
  
  return { valid: true };
};

const mapPaymentStatusToOrderStatus = (paymentStatus) => {
  switch (paymentStatus) {
    case 'paid':
    case 'partial':
    case 'partially_paid':
      return 'payment_completed';
    case 'pending':
      return 'payment_pending';
    case 'failed':
    case 'cod':
      return 'payment_failed';
    default:
      return 'payment_pending';
  }
};

/**
 * Update order status with validation and history tracking
 */
const updateOrderStatus = async (orderId, newStatus, userId, userRole, remarks = null) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get current order status
    const orderResult = await client.query(
      'SELECT status, buyer_id, supplier_id FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      throw new Error('Order not found');
    }
    
    const currentStatus = orderResult.rows[0].status;
    const order = orderResult.rows[0];
    
    // Validate status transition
    const validation = validateStatusTransition(currentStatus, newStatus);
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    
    // Update order status.
    //
    // The delivery date is stamped here because the return window is counted
    // from it. orders.actual_delivery_date existed from the beginning and
    // nothing had ever written to it, so the only record of when goods
    // arrived was a row in the history table. COALESCE keeps the first
    // arrival: an order can be delivered, returned, replaced and delivered
    // again, and the window belongs to the first one.
    await client.query(
      `UPDATE orders
          SET status = $1,
              -- A plain boolean rather than comparing $1 to 'delivered' in
              -- here. Postgres deduces $1 as varchar from the SET and as text
              -- from the comparison, refuses to pick one, and every status
              -- change fails with "inconsistent types deduced for parameter".
              actual_delivery_date = CASE WHEN $3
                                          THEN COALESCE(actual_delivery_date, CURRENT_DATE)
                                          ELSE actual_delivery_date END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [newStatus, orderId, newStatus === 'delivered']
    );

    // Record status change in history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, previous_status, updated_by, updated_by_role, remarks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, newStatus, currentStatus, userId, userRole, remarks]
    );

    /**
     * The sales book follows the order.
     *
     * An accepted order writes itself a sale, and that sale used to carry its
     * own "Mark delivered" button, so the same event had two switches and
     * nothing kept them in step. A wholesaler who marked the order delivered
     * left the sale reading "confirmed" for ever; one who marked the sale
     * delivered left the order sitting at "shipped" with no delivery date, so
     * the return window had nothing to count from.
     *
     * Now the order is the only switch and the sale mirrors it. Cancelling
     * already worked this way, in cancelOrder below.
     */
    if (newStatus === 'delivered') {
      await markSaleDelivered(client, orderId);
    }

    await client.query('COMMIT');
    
    return { success: true, currentStatus, newStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Cancel an order, and unwind everything cancelling it should unwind.
 *
 * Four things have to move together, which is why this is one transaction on
 * one client rather than a status write plus a few helpers:
 *
 *   the order          goes to cancelled, but only through a transition the
 *                      map above allows, so a delivered order cannot be
 *                      quietly undone
 *   the sales book     an order that was accepted has already written itself
 *                      a sale. Leaving that standing bills a customer for
 *                      goods they are never going to get
 *   the stock          goes back on the shelf, from order_items, which is the
 *                      real content of an order. The old version of this read
 *                      orders.inventory_item_id, a single item leftover, so a
 *                      cart of five products returned the stock of one
 *   the history        one row saying who cancelled it and why
 *
 * Money is deliberately left alone. A payment that was made is real money the
 * customer handed over, so it stays in the khata and they sits in credit until
 * somebody refunds them or sets it against their next order. Deleting it here
 * would make the money disappear from the books without anyone deciding to
 * give it back.
 *
 * Stock only comes back when nothing has been paid. That is the rule the rest
 * of this codebase already follows: once money is against an order, unwinding
 * it is a refund, which is a decision a person makes, not a side effect of
 * pressing cancel.
 */
const cancelOrder = async (orderId, userId, reason = null, actingFor = null) => {
  // Who the permission belongs to. An employee refusing an order on their
  // employer's behalf is the supplier here; the history row below still
  // records them by name, because they are the one who did it.
  const businessId = actingFor || userId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // FOR UPDATE, because two people pressing cancel at once would otherwise
    // both read "not cancelled yet" and both put the stock back.
    const orderResult = await client.query(
      `SELECT status, buyer_id, supplier_id, amount_paid
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      throw new Error('Order not found');
    }

    const order = orderResult.rows[0];

    // Who is allowed. A seller account browsing as a buyer is still the buyer
    // of their own order, so this asks who this person is on THIS order rather
    // than what their account role says.
    const isBuyer = order.buyer_id === userId;
    const isSupplier = order.supplier_id === businessId;
    if (!isBuyer && !isSupplier) {
      throw new Error('You cannot cancel this order');
    }

    const allowed = isSupplier ? SUPPLIER_CANCELLABLE_STATUSES : BUYER_CANCELLABLE_STATUSES;
    if (!allowed.includes(order.status)) {
      throw new Error(
        isSupplier
          ? 'This order has already been sent out, so it cannot be refused. Use a return instead.'
          : 'This order has already been sent out, so it cannot be cancelled. Ask the seller about a return.'
      );
    }

    // The map is the authority on what a status may become, and cancelled is
    // not reachable from everywhere. Asking it keeps the two lists above from
    // drifting away from the lifecycle they are meant to sit inside.
    const validation = validateStatusTransition(order.status, 'cancelled');
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    await client.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['cancelled', orderId]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, previous_status, updated_by, updated_by_role, remarks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orderId,
        'cancelled',
        order.status,
        userId,
        // What this person is on this order, not what their account says. A
        // wholesaler cancelling their own purchase is a buyer here.
        isSupplier ? 'supplier' : 'buyer',
        reason || (isSupplier ? 'Order refused by the seller' : 'Order cancelled by the buyer'),
      ]
    );

    // The sale, if the order got far enough to write one. Cancelled sales are
    // not counted in any balance, so this is what stops the customer being
    // billed. The column may not exist yet on a database that is behind on
    // migrations, hence the check.
    const bridged = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'order_id'
       ) AS yes`
    );
    if (bridged.rows[0].yes) {
      await client.query(
        `UPDATE sales SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE order_id = $1 AND status <> 'cancelled'`,
        [orderId]
      );
    }

    // Stock, every line of it. Nothing paid means nothing was sold, so the
    // goods were only ever reserved.
    //
    // Only while stock is being tracked. With tracking off, checkout floors
    // the subtraction at zero instead of refusing the order, so a listing
    // that sat at zero gave nothing up, and adding the quantity back here
    // would invent stock that never existed. An invented count is exactly
    // what turning the feature off was meant to avoid.
    const nothingPaid = Number(order.amount_paid || 0) === 0;
    let stockReturned = 0;
    if (nothingPaid && FEATURES.STOCK_TRACKING) {
      const lines = await client.query(
        `SELECT inventory_item_id, quantity FROM order_items
          WHERE order_id = $1 AND inventory_item_id IS NOT NULL`,
        [orderId]
      );

      for (const line of lines.rows) {
        const restored = await client.query(
          `UPDATE supplier_inventory SET stock = stock + $1 WHERE id = $2 RETURNING stock`,
          [line.quantity, line.inventory_item_id]
        );
        if (restored.rows.length > 0) stockReturned++;
      }
    }

    await client.query('COMMIT');

    return {
      success: true,
      message: 'Order cancelled',
      stockReturned,
      paymentLeftInPlace: !nothingPaid,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Record status change in history
 */
const recordStatusChange = async (orderId, status, previousStatus, userId, userRole, remarks = null) => {
  try {
    await pool.query(
      `INSERT INTO order_status_history (order_id, status, previous_status, updated_by, updated_by_role, remarks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, status, previousStatus, userId, userRole, remarks]
    );
  } catch (error) {
    console.error('Error recording status change:', error);
    throw error;
  }
};

/**
 * Deduct inventory stock when order is placed
 */
const deductInventoryStock = async (inventoryId, quantity, orderId, userId) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get current stock
    const stockResult = await client.query(
      'SELECT stock FROM supplier_inventory WHERE id = $1',
      [inventoryId]
    );
    
    if (stockResult.rows.length === 0) {
      throw new Error('Inventory item not found');
    }
    
    const currentStock = stockResult.rows[0].stock;
    
    if (currentStock < quantity) {
      throw new Error(`Insufficient stock. Available: ${currentStock}, Required: ${quantity}`);
    }
    
    // Deduct stock
    await client.query(
      'UPDATE supplier_inventory SET stock = stock - $1 WHERE id = $2',
      [quantity, inventoryId]
    );
    
    // Log inventory change
    await client.query(
      `INSERT INTO inventory_log (inventory_id, order_id, user_id, action, quantity_change, previous_stock, new_stock, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [inventoryId, orderId, userId, 'deducted', -quantity, currentStock, currentStock - quantity, 'Order placed']
    );
    
    await client.query('COMMIT');
    
    return { success: true, previousStock: currentStock, newStock: currentStock - quantity };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Restore inventory stock when order is cancelled or returned
 */
const restoreInventoryStock = async (inventoryId, quantity, orderId, userId) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get current stock
    const stockResult = await client.query(
      'SELECT stock FROM supplier_inventory WHERE id = $1',
      [inventoryId]
    );
    
    if (stockResult.rows.length === 0) {
      throw new Error('Inventory item not found');
    }
    
    const currentStock = stockResult.rows[0].stock;
    
    // Restore stock
    await client.query(
      'UPDATE supplier_inventory SET stock = stock + $1 WHERE id = $2',
      [quantity, inventoryId]
    );
    
    // Log inventory change
    await client.query(
      `INSERT INTO inventory_log (inventory_id, order_id, user_id, action, quantity_change, previous_stock, new_stock, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [inventoryId, orderId, userId, 'restored', quantity, currentStock, currentStock + quantity, 'Order cancelled/returned']
    );
    
    await client.query('COMMIT');
    
    return { success: true, previousStock: currentStock, newStock: currentStock + quantity };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get complete order timeline
 */
const getOrderTimeline = async (orderId) => {
  try {
    const result = await pool.query(
      `SELECT 
        osh.id,
        osh.status,
        osh.previous_status,
        osh.updated_by,
        osh.updated_by_role,
        osh.remarks,
        osh.created_at,
        u.first_name,
        u.last_name
       FROM order_status_history osh
       LEFT JOIN users u ON osh.updated_by = u.id
       WHERE osh.order_id = $1
       ORDER BY osh.created_at ASC`,
      [orderId]
    );
    
    return result.rows;
  } catch (error) {
    console.error('Error fetching order timeline:', error);
    throw error;
  }
};

/**
 * Check if order can be cancelled by buyer
 */
const canCancelOrder = (orderStatus, userRole) => {
  if (userRole === 'buyer') {
    return BUYER_CANCELLABLE_STATUSES.includes(orderStatus);
  }
  if (userRole === 'supplier') {
    return SUPPLIER_CANCELLABLE_STATUSES.includes(orderStatus);
  }
  return false;
};

/**
 * Check if order can be returned
 */
const canReturnOrder = (orderStatus) => {
  return RETURNABLE_STATUSES.includes(orderStatus);
};

/**
 * Get next possible statuses for current status
 */
const getNextPossibleStatuses = (currentStatus) => {
  return ORDER_STATUS_FLOW[currentStatus] || [];
};

/**
 * Get all valid statuses
 */
const getAllStatuses = () => {
  return Object.keys(ORDER_STATUS_FLOW);
};

module.exports = {
  validateStatusTransition,
  mapPaymentStatusToOrderStatus,
  updateOrderStatus,
  cancelOrder,
  recordStatusChange,
  deductInventoryStock,
  restoreInventoryStock,
  getOrderTimeline,
  canCancelOrder,
  canReturnOrder,
  getNextPossibleStatuses,
  getAllStatuses,
  ORDER_STATUS_FLOW,
  BUYER_CANCELLABLE_STATUSES,
  SUPPLIER_CANCELLABLE_STATUSES,
  RETURNABLE_STATUSES
};
