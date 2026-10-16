-- One order, one invoice.
--
-- invoices.order_id had a plain index, not a unique one, while invoices.sale_id
-- had a unique one. So the sales side was protected and the order side was not,
-- and two callers arriving together could each raise an invoice for the same
-- order. Each then took its own share of the payments, so neither bill was
-- right and the customer had two numbers for one purchase.
--
-- The application now takes a lock on the order before creating, which stops
-- new duplicates. This index is the guarantee underneath it.

-- Run this first. It should return no rows. If it returns any, those orders
-- already have more than one invoice and the index below will refuse to build
-- until you decide which invoice is the real one. Do not delete anything on
-- the strength of this query alone. A duplicate that already carries payments
-- needs those payments moved onto the surviving invoice first.
SELECT
    order_id,
    COUNT(*)                          AS invoices,
    array_agg(invoice_number ORDER BY created_at) AS numbers,
    array_agg(created_at   ORDER BY created_at)   AS raised_at
FROM invoices
WHERE order_id IS NOT NULL
GROUP BY order_id
HAVING COUNT(*) > 1;

-- Partial, so the many invoices that belong to a sale rather than an order
-- (order_id IS NULL) are unaffected. Mirrors idx_invoices_sale exactly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_order
    ON invoices (order_id)
    WHERE order_id IS NOT NULL;
