const pool = require('../config/db');
const { calculateCouponDiscount, isFlashSaleActive, generateReferralCode } = require('../services/promotionService');

const getFlashSales = async (req, res) => {
  try {
    const activeOnly = req.query.active === 'true';
    const whereClause = activeOnly
      ? "WHERE is_active = true AND start_date <= NOW() AND end_date >= NOW()"
      : '';
    const result = await pool.query(`SELECT * FROM flash_sales ${whereClause} ORDER BY start_date ASC`);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error fetching flash sales' });
  }
};

const createFlashSale = async (req, res) => {
  const { name, description, discountType = 'percentage', discountValue, startDate, endDate, productIds = [] } = req.body;
  if (!name || !discountValue || !startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'Missing flash sale fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saleResult = await client.query(
      `INSERT INTO flash_sales (name, description, discount_type, discount_value, start_date, end_date, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
      [name, description, discountType, discountValue, startDate, endDate, req.user.id],
    );
    const saleId = saleResult.rows[0].id;
    for (const productId of productIds) {
      await client.query('INSERT INTO flash_sale_products (flash_sale_id, product_id) VALUES ($1, $2)', [saleId, productId]);
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, saleId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to create flash sale' });
  } finally {
    client.release();
  }
};

const updateFlashSale = async (req, res) => {
  const { id } = req.params;
  const { name, description, discountType, discountValue, startDate, endDate, isActive } = req.body;
  try {
    await pool.query(
      `UPDATE flash_sales SET name = COALESCE($1, name), description = COALESCE($2, description), discount_type = COALESCE($3, discount_type), discount_value = COALESCE($4, discount_value), start_date = COALESCE($5, start_date), end_date = COALESCE($6, end_date), is_active = COALESCE($7, is_active) WHERE id = $8`,
      [name, description, discountType, discountValue, startDate, endDate, isActive, id],
    );
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to update flash sale' });
  }
};

const deleteFlashSale = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM flash_sales WHERE id = $1', [id]);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to delete flash sale' });
  }
};

const getDiscountedProducts = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT fs.id AS flash_sale_id, fs.name, fs.discount_type, fs.discount_value, fsp.product_id, p.name AS product_name, p.category
      FROM flash_sales fs
      JOIN flash_sale_products fsp ON fs.id = fsp.flash_sale_id
      JOIN products p ON fsp.product_id = p.id
      WHERE fs.is_active = true AND fs.start_date <= NOW() AND fs.end_date >= NOW()
      ORDER BY fs.start_date ASC
    `);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error fetching discounted products' });
  }
};

const validateCoupon = async (req, res) => {
  const { couponCode, subtotal = 0 } = req.query;
  if (!couponCode) {
    return res.status(400).json({ success: false, message: 'Coupon code is required' });
  }

  try {
    const couponResult = await pool.query('SELECT * FROM coupons WHERE code = $1', [String(couponCode).toUpperCase()]);
    if (couponResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    const coupon = couponResult.rows[0];
    const now = new Date();
    const isActive = coupon.is_active && new Date(coupon.start_date) <= now && new Date(coupon.end_date) >= now;
    if (!isActive) {
      return res.status(400).json({ success: false, message: 'Coupon is inactive or expired' });
    }

    const usageCount = await pool.query('SELECT COUNT(*) FROM coupon_usage WHERE coupon_id = $1', [coupon.id]);
    if (parseInt(usageCount.rows[0].count, 10) >= coupon.max_usage) {
      return res.status(400).json({ success: false, message: 'Coupon usage limit reached' });
    }

    const subtotalValue = Number(subtotal || 0);
    if (subtotalValue < Number(coupon.min_order_amount || 0)) {
      return res.status(400).json({ success: false, message: 'Order does not meet minimum amount' });
    }

    const calculation = calculateCouponDiscount({ coupon, subtotal: subtotalValue });
    res.status(200).json({ success: true, valid: true, coupon, calculation });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error validating coupon' });
  }
};

const applyCoupon = async (req, res) => {
  const { couponCode, subtotal = 0, orderId } = req.body;
  const userId = req.user?.id;
  try {
    const validation = await validateCouponLogic({ pool, couponCode, subtotal, userId, orderId });
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const result = calculateCouponDiscount({ coupon: validation.coupon, subtotal: Number(subtotal || 0) });
    await pool.query('INSERT INTO coupon_usage (coupon_id, user_id, order_id) VALUES ($1, $2, $3)', [validation.coupon.id, userId, orderId || null]);
    res.status(200).json({ success: true, coupon: validation.coupon, calculation: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error applying coupon' });
  }
};

const validateCouponLogic = async ({ pool, couponCode, subtotal, userId, orderId }) => {
  const couponResult = await pool.query('SELECT * FROM coupons WHERE code = $1', [String(couponCode).toUpperCase()]);
  if (couponResult.rows.length === 0) {
    return { valid: false, message: 'Coupon not found' };
  }
  const coupon = couponResult.rows[0];
  const now = new Date();
  if (!coupon.is_active || new Date(coupon.start_date) > now || new Date(coupon.end_date) < now) {
    return { valid: false, message: 'Coupon is inactive or expired' };
  }
  const usageCount = await pool.query('SELECT COUNT(*) FROM coupon_usage WHERE coupon_id = $1', [coupon.id]);
  if (parseInt(usageCount.rows[0].count, 10) >= coupon.max_usage) {
    return { valid: false, message: 'Coupon usage limit reached' };
  }
  if (Number(subtotal || 0) < Number(coupon.min_order_amount || 0)) {
    return { valid: false, message: 'Order does not meet minimum amount' };
  }
  return { valid: true, coupon, userId, orderId };
};

const removeCoupon = async (req, res) => {
  res.status(200).json({ success: true, couponCode: null, message: 'Coupon removed' });
};

const getLoyaltyDashboard = async (req, res) => {
  const userId = req.user?.id;
  try {
    const accountResult = await pool.query('SELECT * FROM loyalty_accounts WHERE user_id = $1', [userId]);
    if (accountResult.rows.length === 0) {
      await pool.query('INSERT INTO loyalty_accounts (user_id) VALUES ($1)', [userId]);
      return res.status(200).json({ success: true, account: { points_balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, membership_tier: 'Bronze' }, transactions: [] });
    }
    const transactions = await pool.query('SELECT * FROM loyalty_transactions WHERE account_id = $1 ORDER BY created_at DESC', [accountResult.rows[0].id]);
    res.status(200).json({ success: true, account: accountResult.rows[0], transactions: transactions.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error fetching loyalty dashboard' });
  }
};

const getReferralsDashboard = async (req, res) => {
  const userId = req.user?.id;
  try {
    const code = generateReferralCode(userId);
    const refs = await pool.query('SELECT * FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC', [userId]);
    res.status(200).json({ success: true, referralCode: code, referrals: refs.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error fetching referrals' });
  }
};

const purchaseGiftCard = async (req, res) => {
  const userId = req.user?.id;
  const { amount, recipientEmail } = req.body;
  try {
    const code = `GC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const result = await pool.query(
      `INSERT INTO gift_cards (gift_card_code, user_id, recipient_email, amount, balance, expires_at) VALUES ($1, $2, $3, $4, $4, NOW() + INTERVAL '1 year') RETURNING *`,
      [code, userId, recipientEmail || '', amount],
    );
    res.status(201).json({ success: true, giftCard: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error purchasing gift card' });
  }
};

const redeemGiftCard = async (req, res) => {
  const userId = req.user?.id;
  const { code, amount } = req.body;
  try {
    const giftCardResult = await pool.query('SELECT * FROM gift_cards WHERE gift_card_code = $1', [code]);
    if (giftCardResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gift card not found' });
    }
    const giftCard = giftCardResult.rows[0];
    if (giftCard.balance < Number(amount || 0)) {
      return res.status(400).json({ success: false, message: 'Insufficient gift card balance' });
    }
    await pool.query('UPDATE gift_cards SET balance = balance - $1 WHERE id = $2', [Number(amount || 0), giftCard.id]);
    await pool.query('INSERT INTO gift_card_transactions (gift_card_id, user_id, transaction_type, amount) VALUES ($1, $2, $3, $4)', [giftCard.id, userId, 'redeem', Number(amount || 0)]);
    res.status(200).json({ success: true, balance: giftCard.balance - Number(amount || 0) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error redeeming gift card' });
  }
};

const getGiftCardBalance = async (req, res) => {
  const userId = req.user?.id;
  try {
    const result = await pool.query('SELECT * FROM gift_cards WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.status(200).json({ success: true, giftCards: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error fetching gift cards' });
  }
};

const getGiftCardHistory = async (req, res) => {
  const userId = req.user?.id;
  try {
    const result = await pool.query(
      `SELECT ggt.*, gc.gift_card_code FROM gift_card_transactions ggt JOIN gift_cards gc ON gc.id = ggt.gift_card_id WHERE ggt.user_id = $1 ORDER BY ggt.created_at DESC`,
      [userId],
    );
    res.status(200).json({ success: true, history: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error fetching gift card history' });
  }
};

module.exports = {
  getFlashSales,
  createFlashSale,
  updateFlashSale,
  deleteFlashSale,
  getDiscountedProducts,
  validateCoupon,
  applyCoupon,
  removeCoupon,
  getLoyaltyDashboard,
  getReferralsDashboard,
  purchaseGiftCard,
  redeemGiftCard,
  getGiftCardBalance,
  getGiftCardHistory,
};
