-- =====================================================
-- DIAGNOSTIC: orders and invoices where you are both parties
--
-- Ordering your own inventory has been blocked since the cart rework, and
-- manual invoices now refuse it too, but anything created before those guards
-- is still sitting in the table. Such a row is what makes your own company
-- appear as the buyer on your own invoice.
--
-- Read-only. Nothing here changes data. The cleanup is at the bottom,
-- commented out, so you can look before deciding.
-- =====================================================

-- 1. Orders placed by a user against their own listing.
SELECT
  o.id                AS order_id,
  o.order_number,
  o.status,
  o.payment_status,
  o.total_amount,
  o.created_at,
  COALESCE(wp.company_name, u.first_name || ' ' || u.last_name) AS both_parties
FROM orders o
JOIN users u ON u.id = o.buyer_id
LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
WHERE o.buyer_id = o.supplier_id
ORDER BY o.created_at DESC;

-- 2. Invoices carrying the same problem.
SELECT
  i.id                AS invoice_id,
  i.invoice_number,
  i.order_id,
  i.grand_total,
  i.payment_status,
  i.created_at,
  COALESCE(wp.company_name, u.first_name || ' ' || u.last_name) AS both_parties
FROM invoices i
JOIN users u ON u.id = i.buyer_id
LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
WHERE i.buyer_id = i.supplier_id
ORDER BY i.created_at DESC;

-- 3. A different, more likely cause worth ruling out: an order whose
--    supplier_id was never set, so the invoice fell back to the buyer.
SELECT
  o.id AS order_id, o.order_number, o.created_at, o.supplier_id
FROM orders o
WHERE o.supplier_id IS NULL
ORDER BY o.created_at DESC;

-- =====================================================
-- CLEANUP, once you have looked at the rows above.
--
-- Cancelling is safer than deleting: it keeps the numbering sequence honest
-- and leaves an audit trail. Run whichever fits, with the ids from query 2.
--
--   UPDATE invoices
--      SET invoice_status = 'Cancelled', payment_status = 'Refunded'
--    WHERE buyer_id = supplier_id;
--
--   UPDATE orders
--      SET status = 'cancelled'
--    WHERE buyer_id = supplier_id;
--
-- Only delete if these were pure test rows you want gone entirely. The
-- order cascade takes its order_items and invoice with it:
--
--   DELETE FROM orders WHERE buyer_id = supplier_id;
-- =====================================================
