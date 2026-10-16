const crypto = require('crypto');

const calculateCouponDiscount = ({ coupon, subtotal = 0 }) => {
  const subtotalValue = Number(subtotal || 0);
  if (!coupon) {
    return { discount: 0, finalTotal: subtotalValue };
  }

  let discount = 0;
  if (coupon.discount_type === 'percentage') {
    discount = subtotalValue * (Number(coupon.value || 0) / 100);
    if (coupon.max_discount_amount && discount > Number(coupon.max_discount_amount)) {
      discount = Number(coupon.max_discount_amount);
    }
  } else if (coupon.discount_type === 'flat') {
    discount = Math.min(subtotalValue, Number(coupon.value || 0));
  }

  const finalTotal = Math.max(0, subtotalValue - discount);
  return { discount, finalTotal };
};

const isFlashSaleActive = (sale, now = new Date()) => {
  if (!sale) return false;
  const current = new Date(now);
  const start = new Date(sale.start_date);
  const end = new Date(sale.end_date);
  return Boolean(sale.is_active) && current >= start && current <= end;
};

const generateReferralCode = (userId) => {
  const hash = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8).toUpperCase();
  return `REF-${hash}`;
};

module.exports = {
  calculateCouponDiscount,
  isFlashSaleActive,
  generateReferralCode,
};
