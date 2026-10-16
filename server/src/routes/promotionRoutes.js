const express = require('express');
const {
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
} = require('../controllers/promotionController');
const authenticateToken = require('../middlewares/authMiddleware');
const { requirePlatformAdmin } = require('../middlewares/platformAdmin');
const authorizeRoles = require('../middlewares/roleMiddleware');

const router = express.Router();

router.get('/flash-sales', authenticateToken, getFlashSales);
// Flash sales are a platform thing, not a wholesaler's. These were guarded by
// authorizeRoles('admin'), and users.role carries a CHECK allowing only buyer,
// seller and both, so 'admin' was a value the database could never hold and
// every one of these routes was unreachable rather than merely unbuilt. They
// read the is_platform_admin flag now, which is a real column.
router.post('/flash-sales', authenticateToken, requirePlatformAdmin, createFlashSale);
router.put('/flash-sales/:id', authenticateToken, requirePlatformAdmin, updateFlashSale);
router.delete('/flash-sales/:id', authenticateToken, requirePlatformAdmin, deleteFlashSale);
router.get('/discounted-products', authenticateToken, getDiscountedProducts);
router.get('/coupons/validate', authenticateToken, validateCoupon);
router.post('/coupons/apply', authenticateToken, applyCoupon);
router.delete('/coupons/remove', authenticateToken, removeCoupon);
router.get('/loyalty', authenticateToken, getLoyaltyDashboard);
router.get('/referrals', authenticateToken, getReferralsDashboard);
router.post('/gift-cards/purchase', authenticateToken, purchaseGiftCard);
router.post('/gift-cards/redeem', authenticateToken, redeemGiftCard);
router.get('/gift-cards/balance', authenticateToken, getGiftCardBalance);
router.get('/gift-cards/history', authenticateToken, getGiftCardHistory);

module.exports = router;
