const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCouponDiscount, isFlashSaleActive } = require('../src/services/promotionService');

test('calculateCouponDiscount caps percentage coupon by max discount amount', () => {
  const coupon = {
    discount_type: 'percentage',
    value: 20,
    max_discount_amount: 100,
  };
  const result = calculateCouponDiscount({ coupon, subtotal: 1000 });
  assert.equal(result.discount, 100);
  assert.equal(result.finalTotal, 900);
});

test('isFlashSaleActive returns false for expired flash sales', () => {
  const sale = {
    is_active: true,
    start_date: '2024-01-01T00:00:00.000Z',
    end_date: '2024-01-02T00:00:00.000Z',
  };
  assert.equal(isFlashSaleActive(sale, new Date('2024-01-03T00:00:00.000Z')), false);
});
