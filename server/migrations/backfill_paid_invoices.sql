-- =====================================================
-- BACKFILL: settle invoices whose order was already paid
--
-- An invoice is raised the moment an order is placed, while payment is still
-- pending, so it starts on Pending. When the buyer paid, the code called
-- createInvoiceFromOrder again - and that function returns early when an
-- invoice already exists, so the invoice was never moved to Paid. Every one
-- of them stayed Pending and the PDF kept stamping UNPAID over money that had
-- already been received.
--
-- The code path is fixed (reconcileInvoiceForOrder). This repairs the rows
-- that are already wrong.
--
-- Safe to run more than once: every statement filters on the broken state, so
-- a second run touches nothing. Wrapped in a transaction - if any part fails,
-- none of it applies.
--
-- Run the SELECT at the top first if you want to see the damage before
-- changing anything.
-- =====================================================

-- Preview (read-only): invoices that will be settled by this migration.
SELECT
  i.invoice_number,
  i.grand_total,
  i.payment_status AS invoice_says,
  o.payment_status AS order_says,
  o.order_number,
  i.issue_date
FROM invoices i
JOIN orders o ON o.id = i.order_id
WHERE o.payment_status IN ('paid', 'completed')
  AND i.payment_status <> 'Paid'
  AND i.invoice_status <> 'Cancelled'
ORDER BY i.issue_date;

BEGIN;

-- 1. Record the outstanding amount as a payment, so the invoice's payment
--    history matches its status instead of showing Paid with no payments
--    against it. Anything already recorded manually is subtracted, so a part
--    payment taken by hand is not billed twice.
INSERT INTO payments (invoice_id, amount, payment_method, remarks, paid_at)
SELECT
  i.id,
  i.grand_total - COALESCE(p.paid_so_far, 0),
  'UPI',
  'Payment completed at checkout (backfilled)',
  COALESCE(o.updated_at, o.created_at, CURRENT_TIMESTAMP)
FROM invoices i
JOIN orders o ON o.id = i.order_id
LEFT JOIN (
  SELECT invoice_id, SUM(amount) AS paid_so_far
  FROM payments GROUP BY invoice_id
) p ON p.invoice_id = i.id
WHERE o.payment_status IN ('paid', 'completed')
  AND i.payment_status <> 'Paid'
  AND i.invoice_status <> 'Cancelled'
  -- the payments table requires amount > 0
  AND i.grand_total - COALESCE(p.paid_so_far, 0) > 0;

-- 2. Leave an audit entry, the same one the live code writes.
INSERT INTO invoice_logs (invoice_id, action, performed_by, details, created_at)
SELECT
  i.id,
  'Paid',
  o.buyer_id,
  'Invoice settled against order payment (backfilled)',
  CURRENT_TIMESTAMP
FROM invoices i
JOIN orders o ON o.id = i.order_id
WHERE o.payment_status IN ('paid', 'completed')
  AND i.payment_status <> 'Paid'
  AND i.invoice_status <> 'Cancelled';

-- 3. Move the invoice itself. Cancelled invoices are deliberately untouched.
UPDATE invoices i
   SET payment_status = 'Paid',
       invoice_status = 'Paid',
       updated_at     = CURRENT_TIMESTAMP
  FROM orders o
 WHERE o.id = i.order_id
   AND o.payment_status IN ('paid', 'completed')
   AND i.payment_status <> 'Paid'
   AND i.invoice_status <> 'Cancelled';

-- 4. Repair orders stranded on 'confirmed'.
--    recordPayment used to write that value, which the lifecycle does not
--    know, so those orders could not transition anywhere afterwards.
UPDATE orders
   SET status = 'payment_completed',
       updated_at = CURRENT_TIMESTAMP
 WHERE status = 'confirmed';

COMMIT;

-- =====================================================
-- Verification: both queries should return no rows.
-- =====================================================
-- SELECT i.invoice_number, i.payment_status, o.payment_status
--   FROM invoices i JOIN orders o ON o.id = i.order_id
--  WHERE o.payment_status IN ('paid','completed')
--    AND i.payment_status <> 'Paid'
--    AND i.invoice_status <> 'Cancelled';
--
-- SELECT id, order_number FROM orders WHERE status = 'confirmed';
--
-- Cached PDFs under server/storage/invoices are not touched and do not need
-- to be: downloads render fresh from the invoice row, so the watermark
-- corrects itself immediately. Only the copies already emailed are stale.
-- =====================================================
