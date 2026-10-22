const pool = require('../config/db');
const { enqueueNotification, NOTIFICATION_TYPES } = require('./notificationManager');

const clampNumber = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
};

const calculateAverageDailySales = (sales, days = 30) => {
  const entries = Array.isArray(sales) ? sales : [sales || 0];
  const total = entries.reduce((sum, item) => sum + clampNumber(item, 0), 0);
  const window = Math.max(Number(days) || 1, 1);
  return total / window;
};

const calculateDaysRemaining = (currentStock, averageDailySales) => {
  const stock = clampNumber(currentStock, 0);
  const sales = clampNumber(averageDailySales, 0);

  if (stock <= 0) return 0;
  if (sales <= 0) return Number.POSITIVE_INFINITY;
  return stock / sales;
};

const classifyInventoryStatus = (daysRemaining, currentStock = 0) => {
  const stock = clampNumber(currentStock, 0);
  if (stock <= 0) return 'out_of_stock';
  if (daysRemaining === Number.POSITIVE_INFINITY) return 'healthy';
  if (daysRemaining > 30) return 'healthy';
  if (daysRemaining >= 15) return 'low';
  if (daysRemaining >= 7) return 'warning';
  if (daysRemaining > 0) return 'critical';
  return 'out_of_stock';
};

const calculateRecommendedReorder = ({ currentStock, avgDailySales, leadTimeDays, safetyStock }) => {
  const stock = clampNumber(currentStock, 0);
  const sales = clampNumber(avgDailySales, 0);
  const leadTime = clampNumber(leadTimeDays, 0);
  const safety = clampNumber(safetyStock, 0);
  const quantity = (leadTime * sales) + safety - stock;
  return Math.max(0, Math.ceil(quantity));
};

const getInventorySalesWindow = async (inventoryItemId, days = 30) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(oi.quantity), 0)::numeric AS total_quantity
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.inventory_item_id = $1
       AND o.status IN ('delivered', 'completed')
       AND o.created_at >= NOW() - ($2::int || ' days')::interval`,
    [inventoryItemId, days],
  );
  return Number(rows[0]?.total_quantity || 0);
};

const getSellerForecastRows = async (sellerId) => {
  const { rows } = await pool.query(
    `SELECT
       si.id AS inventory_item_id,
       si.product_id,
       si.supplier_id AS seller_id,
       p.name AS product_name,
       p.category,
       si.stock,
       COALESCE(si.reorder_level, 0) AS reorder_level,
       COALESCE(si.reorder_quantity, 0) AS reorder_quantity,
       COALESCE(si.safety_stock, 0) AS safety_stock,
       COALESCE(si.lead_time_days, 7) AS lead_time_days,
       COALESCE(si.inventory_status, 'healthy') AS inventory_status,
       COALESCE(si.updated_at, si.created_at) AS updated_at
     FROM supplier_inventory si
     JOIN products p ON p.id = si.product_id
     WHERE si.supplier_id = $1 AND si.status = 'Active'`,
    [sellerId],
  );

  const detailed = [];
  for (const row of rows) {
    const windowSales = {
      seven: await getInventorySalesWindow(row.inventory_item_id, 7),
      thirty: await getInventorySalesWindow(row.inventory_item_id, 30),
      ninety: await getInventorySalesWindow(row.inventory_item_id, 90),
    };

    const avgDailySales = calculateAverageDailySales(windowSales.thirty, 30);
    const daysRemaining = calculateDaysRemaining(row.stock, avgDailySales);
    const status = classifyInventoryStatus(daysRemaining, row.stock);
    const recommendedReorder = calculateRecommendedReorder({
      currentStock: row.stock,
      avgDailySales,
      leadTimeDays: row.lead_time_days,
      safety_stock: row.safety_stock,
      safetyStock: row.safety_stock,
    });

    detailed.push({
      inventoryItemId: row.inventory_item_id,
      sellerId: row.seller_id,
      productId: row.product_id,
      productName: row.product_name,
      category: row.category,
      currentStock: Number(row.stock) || 0,
      tenDaySales: windowSales.seven,
      thirtyDaySales: windowSales.thirty,
      ninetyDaySales: windowSales.ninety,
      averageDailySales: Number(avgDailySales || 0),
      predictedDaysRemaining: daysRemaining === Number.POSITIVE_INFINITY ? null : Number(daysRemaining),
      recommendedReorderQuantity: recommendedReorder,
      forecastStatus: status,
      inventoryStatus: status,
      reorderLevel: Number(row.reorder_level) || 0,
      reorderQuantity: Number(row.reorder_quantity) || 0,
      safetyStock: Number(row.safety_stock) || 0,
      leadTimeDays: Number(row.lead_time_days) || 0,
      updatedAt: row.updated_at,
    });
  }

  return detailed;
};

const recalculateSellerForecasts = async (sellerId) => {
  const rows = await getSellerForecastRows(sellerId);
  if (!rows.length) {
    return [];
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM inventory_forecasts WHERE seller_id = $1', [sellerId]);

    const updates = rows.map((row) => client.query(
      `UPDATE supplier_inventory
         SET inventory_status = $1,
             last_restocked_at = CASE
               WHEN stock <= 0 THEN NOW()
               ELSE last_restocked_at
             END,
             updated_at = NOW()
       WHERE supplier_id = $2 AND product_id = $3`,
      [row.forecastStatus, row.sellerId, row.productId],
    ));

    await Promise.all(updates);

    const inserts = rows.map((row) => {
      const generatedAt = new Date();
      return client.query(
        `INSERT INTO inventory_forecasts (
          seller_id,
          product_id,
          current_stock,
          average_daily_sales,
          predicted_days_remaining,
          recommended_reorder_quantity,
          forecast_status,
          generated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.sellerId,
          row.productId,
          row.currentStock,
          row.averageDailySales,
          row.predictedDaysRemaining === null ? null : Number(row.predictedDaysRemaining),
          row.recommendedReorderQuantity,
          row.forecastStatus,
          generatedAt,
        ],
      );
    });

    await Promise.all(inserts);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getForecastSummary = async (sellerId) => {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE forecast_status = 'healthy') AS healthy,
       COUNT(*) FILTER (WHERE forecast_status = 'low') AS low,
       COUNT(*) FILTER (WHERE forecast_status = 'warning') AS warning,
       COUNT(*) FILTER (WHERE forecast_status = 'critical') AS critical,
       COUNT(*) FILTER (WHERE forecast_status = 'out_of_stock') AS out_of_stock,
       COUNT(*) AS total
     FROM inventory_forecasts
     WHERE seller_id = $1`,
    [sellerId],
  );

  return rows[0] || {
    healthy: 0,
    low: 0,
    warning: 0,
    critical: 0,
    out_of_stock: 0,
    total: 0,
  };
};

const getProductForecast = async (sellerId, productId) => {
  const { rows } = await pool.query(
    `SELECT
       ifx.*,
       p.name AS product_name,
       si.stock,
       si.lead_time_days,
       si.safety_stock,
       si.reorder_quantity,
       si.reorder_level
     FROM inventory_forecasts ifx
     JOIN products p ON p.id = ifx.product_id
     LEFT JOIN supplier_inventory si ON si.product_id = ifx.product_id AND si.supplier_id = ifx.seller_id
     WHERE ifx.seller_id = $1 AND ifx.product_id = $2
     ORDER BY ifx.generated_at DESC
     LIMIT 1`,
    [sellerId, productId],
  );

  return rows[0] || null;
};

const notifyUrgentRestock = async (sellerId, products = []) => {
  for (const item of products) {
    if (!['critical', 'out_of_stock', 'warning'].includes(item.forecastStatus)) continue;
    const title = item.currentStock <= 0 ? 'Out of stock' : 'Restock reminder';
    const message = item.currentStock <= 0
      ? `${item.productName} is now out of stock.`
      : `${item.productName} will run out in ${Math.max(0, Math.ceil(item.predictedDaysRemaining || 0))} days.`;

    try {
      await enqueueNotification({
        userId: sellerId,
        title,
        message,
        notificationType: NOTIFICATION_TYPES.inventory,
        channels: ['in_app'],
        referenceId: item.productId,
        referenceType: 'product',
        priority: item.currentStock <= 0 ? 'high' : 'normal',
      });
    } catch (error) {
      console.warn('Restock notification failed:', error.message);
    }
  }
};

module.exports = {
  calculateAverageDailySales,
  calculateDaysRemaining,
  classifyInventoryStatus,
  calculateRecommendedReorder,
  recalculateSellerForecasts,
  getForecastSummary,
  getProductForecast,
  getSellerForecastRows,
  getInventorySalesWindow,
  notifyUrgentRestock,
};
