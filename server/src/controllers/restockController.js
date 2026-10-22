const pool = require("../config/db");
const {
  getSellerForecastRows,
  recalculateSellerForecasts,
  getForecastSummary,
  getProductForecast,
  notifyUrgentRestock,
} = require("../services/inventoryForecastService");

const parseIntOr = (value, fallback = 0) => {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
};

const getSummary = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const rows = await getSellerForecastRows(sellerId);
    const summary = await getForecastSummary(sellerId);
    const urgent = [...rows].filter((row) => ["critical", "warning", "out_of_stock"].includes(row.forecastStatus)).sort((a, b) => {
      const left = Number(a.predictedDaysRemaining || Number.MAX_SAFE_INTEGER);
      const right = Number(b.predictedDaysRemaining || Number.MAX_SAFE_INTEGER);
      return left - right;
    });

    if (!summary.total || rows.length === 0) {
      return res.status(200).json({
        summary: {
          healthy: 0,
          low: 0,
          warning: 0,
          critical: 0,
          out_of_stock: 0,
          total: 0,
        },
        products: [],
        urgent: [],
      });
    }

    res.status(200).json({
      summary,
      products: rows,
      urgent: urgent.slice(0, 5),
    });
  } catch (error) {
    console.error("Error loading restock summary:", error);
    res.status(500).json({ message: "Server error loading restock summary" });
  }
};

const getProducts = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { search = "", status = "all", sortBy = "urgency", page = 1, limit = 25 } = req.query;
    const rows = await getSellerForecastRows(sellerId);

    const filtered = rows.filter((row) => {
      const matchesSearch = !search || row.productName.toLowerCase().includes(String(search).toLowerCase());
      const matchesStatus = status === "all" || row.forecastStatus === status;
      return matchesSearch && matchesStatus;
    });

    const sortFns = {
      urgency: (a, b) => {
        const left = Number(a.predictedDaysRemaining ?? Number.MAX_SAFE_INTEGER);
        const right = Number(b.predictedDaysRemaining ?? Number.MAX_SAFE_INTEGER);
        return left - right;
      },
      stock: (a, b) => a.currentStock - b.currentStock,
      sales: (a, b) => b.averageDailySales - a.averageDailySales,
      name: (a, b) => a.productName.localeCompare(b.productName),
    };

    const sorted = [...filtered].sort(sortFns[sortBy] || sortFns.urgency);
    const pageNumber = Math.max(1, parseIntOr(page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(limit, 25)));
    const start = (pageNumber - 1) * pageSize;
    const payload = sorted.slice(start, start + pageSize);

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total: sorted.length,
      products: payload,
    });
  } catch (error) {
    console.error("Error loading restock products:", error);
    res.status(500).json({ message: "Server error loading restock products" });
  }
};

const getProductDetail = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { id } = req.params;
    const row = await getProductForecast(sellerId, id);
    if (!row) {
      return res.status(404).json({ message: "Forecast not found" });
    }

    const { rows } = await pool.query(
      `SELECT
         date_trunc('day', o.created_at)::date AS sale_day,
         COALESCE(SUM(oi.quantity), 0)::int AS units
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = $1
         AND o.supplier_id = $2
         AND o.status IN ('delivered', 'completed')
         AND o.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1
       ORDER BY 1 ASC`,
      [id, sellerId],
    );

    const salesHistory = rows.map((entry) => ({
      date: entry.sale_day,
      units: Number(entry.units),
    }));

    res.status(200).json({
      ...row,
      salesHistory,
    });
  } catch (error) {
    console.error("Error loading product forecast:", error);
    res.status(500).json({ message: "Server error loading product forecast" });
  }
};

const recalculateForecasts = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const rows = await recalculateSellerForecasts(sellerId);
    await notifyUrgentRestock(sellerId, rows);
    const summary = await getForecastSummary(sellerId);
    res.status(200).json({
      success: true,
      message: "Restock forecasts recalculated.",
      summary,
      products: rows,
    });
  } catch (error) {
    console.error("Error recalculating forecasts:", error);
    res.status(500).json({ message: "Server error recalculating forecasts" });
  }
};

const getReport = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const rows = await getSellerForecastRows(sellerId);
    const report = {
      generatedAt: new Date().toISOString(),
      products: rows,
      fastestSelling: [...rows].sort((a, b) => b.averageDailySales - a.averageDailySales).slice(0, 5),
      slowMoving: [...rows].filter((item) => item.averageDailySales <= 1).slice(0, 5),
      overstocked: [...rows].filter((item) => item.currentStock > (item.reorderLevel || 0) * 2).slice(0, 5),
      outOfStock: rows.filter((item) => item.currentStock <= 0),
      recommendations: rows.filter((item) => item.recommendedReorderQuantity > 0).slice(0, 10),
    };

    const format = String(req.query.format || "json").toLowerCase();
    if (format === "csv") {
      const header = ["product_name", "current_stock", "average_daily_sales", "predicted_days_remaining", "recommended_reorder_quantity", "forecast_status"];
      const body = rows.map((row) => [row.productName, row.currentStock, row.averageDailySales, row.predictedDaysRemaining, row.recommendedReorderQuantity, row.forecastStatus].join(","));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=inventory-intelligence-report.csv");
      return res.status(200).send([header.join(","), ...body].join("\n"));
    }

    if (format === "pdf") {
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ margin: 32 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=inventory-intelligence-report.pdf");
      doc.pipe(res);
      doc.fontSize(18).text("Inventory Intelligence Report", { align: "center" });
      doc.moveDown();
      doc.fontSize(11).text(`Generated: ${new Date().toLocaleString("en-IN")}`);
      doc.moveDown();
      rows.slice(0, 12).forEach((row) => {
        doc.text(`${row.productName}: ${row.forecastStatus} | stock ${row.currentStock} | reorder ${row.recommendedReorderQuantity}`);
      });
      doc.end();
      return;
    }

    res.status(200).json(report);
  } catch (error) {
    console.error("Error generating restock report:", error);
    res.status(500).json({ message: "Server error generating restock report" });
  }
};

module.exports = {
  getSummary,
  getProducts,
  getProductDetail,
  recalculateForecasts,
  getReport,
};
