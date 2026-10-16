/**
 * Fix the customer names already stored wrong.
 *
 * The code fix only helps orders placed from now on. This is for the rows
 * already in the database, and it is deliberately three separate things,
 * because they carry three different levels of risk.
 *
 *   1  parties     fill a blank firm name or GST number from the account the
 *                  party is already linked to. Blanks only, never an
 *                  overwrite, so nothing the wholesaler typed is touched.
 *                  Low risk: this is their own customer's own details.
 *
 *   2  invoices    re-address an invoice that was made out to the person when
 *                  their firm is now known, and fill a blank GST number. Only
 *                  where the stored name is exactly the party's contact name,
 *                  so an invoice a wholesaler addressed by hand is left alone.
 *                  HIGHER RISK: these are issued tax documents. If one has
 *                  already been handed to a customer, its replacement should
 *                  match what they hold. Read the dry run before applying.
 *
 *   3  duplicates  REPORT ONLY. Orders holding more than one invoice, from
 *                  before the two billing paths were made to agree. Nothing is
 *                  merged automatically: payments may be split across the two,
 *                  and deciding which number stands, and moving the payments,
 *                  is a person's job. See the notes it prints.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *     node scripts/repair_invoice_names.js            # show what would change
 *     node scripts/repair_invoice_names.js --apply    # do parts 1 and 2
 *
 * Reads DATABASE_URL, so it talks to whatever the server talks to. Safe to run
 * more than once: every statement filters on the broken state.
 */
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");

const heading = (text) => console.log(`\n${text}\n${"-".repeat(text.length)}`);

(async () => {
  console.log(APPLY ? "\nAPPLYING CHANGES\n" : "\nDRY RUN, nothing will be written\n");

  // ---------------------------------------------------------------
  heading("1. Customers missing a firm name or a GST number");
  // ---------------------------------------------------------------
  const parties = await pool.query(
    `SELECT p.id, p.name, p.business_name, p.gstin,
            wp.company_name AS account_company, wp.gstin AS account_gstin
       FROM parties p
       JOIN wholesaler_profiles wp ON wp.user_id = p.user_id
      WHERE p.user_id IS NOT NULL
        AND (
          (COALESCE(btrim(p.business_name), '') = '' AND COALESCE(btrim(wp.company_name), '') <> '')
          OR
          (COALESCE(btrim(p.gstin), '') = '' AND COALESCE(btrim(wp.gstin), '') <> '')
        )
      ORDER BY p.created_at`,
  );

  if (parties.rows.length === 0) {
    console.log("  nothing to fill in");
  } else {
    for (const row of parties.rows) {
      const bits = [];
      if (!String(row.business_name || "").trim() && row.account_company) {
        bits.push(`firm -> ${row.account_company}`);
      }
      if (!String(row.gstin || "").trim() && row.account_gstin) {
        bits.push(`GST -> ${row.account_gstin}`);
      }
      console.log(`  ${row.name.padEnd(28)} ${bits.join(", ")}`);
    }
    if (APPLY) {
      const done = await pool.query(
        `UPDATE parties p SET
           business_name = CASE WHEN COALESCE(btrim(p.business_name), '') = ''
                                THEN NULLIF(btrim(wp.company_name), '') ELSE p.business_name END,
           gstin         = CASE WHEN COALESCE(btrim(p.gstin), '') = ''
                                THEN NULLIF(btrim(wp.gstin), '') ELSE p.gstin END,
           updated_at    = CURRENT_TIMESTAMP
         FROM wholesaler_profiles wp
        WHERE wp.user_id = p.user_id
          AND p.user_id IS NOT NULL
          AND (
            (COALESCE(btrim(p.business_name), '') = '' AND COALESCE(btrim(wp.company_name), '') <> '')
            OR
            (COALESCE(btrim(p.gstin), '') = '' AND COALESCE(btrim(wp.gstin), '') <> '')
          )`,
      );
      console.log(`  ${done.rowCount} customer page(s) filled in`);
    }
  }

  // ---------------------------------------------------------------
  heading("2. Invoices made out to the person rather than the firm");
  // ---------------------------------------------------------------
  // Only where the stored name is still exactly the party's contact name.
  // Anything a wholesaler edited themselves reads differently and is skipped.
  // The firm and the GST number as they will stand once part 1 has run, so a
  // dry run reports what applying would really do rather than what the rows
  // happen to say this second.
  const EFFECTIVE = `
       LEFT JOIN wholesaler_profiles wp ON wp.user_id = p.user_id
  `;
  const FIRM = `COALESCE(NULLIF(btrim(p.business_name), ''), NULLIF(btrim(wp.company_name), ''))`;
  const GST = `COALESCE(NULLIF(btrim(p.gstin), ''), NULLIF(btrim(wp.gstin), ''))`;

  const wrong = await pool.query(
    `SELECT i.id, i.invoice_number, i.recipient_name, i.recipient_gstin,
            p.name AS party_name,
            ${FIRM} AS business_name, ${GST} AS party_gstin
       FROM invoices i
       JOIN parties p ON p.id = i.party_id
       ${EFFECTIVE}
      WHERE i.party_id IS NOT NULL
        AND (
          (${FIRM} IS NOT NULL AND i.recipient_name IS NOT DISTINCT FROM p.name)
          OR
          (COALESCE(btrim(i.recipient_gstin), '') = '' AND ${GST} IS NOT NULL)
        )
      ORDER BY i.created_at`,
  );

  if (wrong.rows.length === 0) {
    console.log("  nothing to re-address");
  } else {
    for (const row of wrong.rows) {
      const bits = [];
      // Only the rows the UPDATE will really rename. An invoice the
      // wholesaler addressed themselves reads differently from the party's
      // contact name, so it is left exactly as they wrote it.
      if (row.business_name && row.recipient_name === row.party_name) {
        bits.push(`"${row.recipient_name}" -> "${row.business_name}"`);
      }
      if (!String(row.recipient_gstin || "").trim() && row.party_gstin) {
        bits.push(`GST -> ${row.party_gstin}`);
      }
      if (bits.length === 0) continue;
      console.log(`  ${String(row.invoice_number).padEnd(20)} ${bits.join(", ")}`);
    }
    console.log(
      "\n  These are issued tax documents. If any has already been given to a\n" +
      "  customer, check that changing it is what you want before applying.",
    );
    if (APPLY) {
      const done = await pool.query(
        `UPDATE invoices i SET
           recipient_name  = CASE WHEN ${FIRM} IS NOT NULL
                                   AND i.recipient_name IS NOT DISTINCT FROM p.name
                                  THEN ${FIRM} ELSE i.recipient_name END,
           recipient_gstin = CASE WHEN COALESCE(btrim(i.recipient_gstin), '') = ''
                                  THEN ${GST} ELSE i.recipient_gstin END
         FROM parties p
         ${EFFECTIVE}
        WHERE p.id = i.party_id
          AND (
            (${FIRM} IS NOT NULL AND i.recipient_name IS NOT DISTINCT FROM p.name)
            OR
            (COALESCE(btrim(i.recipient_gstin), '') = '' AND ${GST} IS NOT NULL)
          )`,
      );
      console.log(`  ${done.rowCount} invoice(s) re-addressed`);
    }
  }

  // ---------------------------------------------------------------
  heading("3. Orders holding more than one invoice, REPORT ONLY");
  // ---------------------------------------------------------------
  const dupes = await pool.query(
    `WITH billed AS (
       SELECT COALESCE(i.order_id, s.order_id) AS order_id,
              i.id, i.invoice_number, i.grand_total, i.recipient_name, i.created_at
         FROM invoices i
         LEFT JOIN sales s ON s.id = i.sale_id
        WHERE COALESCE(i.order_id, s.order_id) IS NOT NULL
     )
     SELECT b.order_id, o.order_number,
            b.invoice_number, b.grand_total, b.recipient_name,
            COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = b.id), 0) AS received
       FROM billed b
       JOIN orders o ON o.id = b.order_id
      WHERE b.order_id IN (
        SELECT order_id FROM billed GROUP BY order_id HAVING COUNT(*) > 1
      )
      ORDER BY b.order_id, b.created_at`,
  );

  if (dupes.rows.length === 0) {
    console.log("  none, every order has one bill");
  } else {
    let current = null;
    for (const row of dupes.rows) {
      if (row.order_id !== current) {
        current = row.order_id;
        console.log(`\n  order ${row.order_number}`);
      }
      console.log(
        `    ${String(row.invoice_number).padEnd(20)} total ${row.grand_total}` +
        `  received ${row.received}  to "${row.recipient_name || "(from the account)"}"`,
      );
    }
    console.log(
      "\n  Nothing above was changed. To sort one out: decide which number\n" +
      "  stands, move any payments off the other onto it, then cancel the\n" +
      "  spare. If a duplicate has no payments against it and was never sent,\n" +
      "  cancelling it is the whole job. New duplicates cannot appear: both\n" +
      "  billing paths now take the same lock and adopt the other's invoice.",
    );
  }

  console.log(
    APPLY
      ? "\nDone.\n"
      : "\nDry run. Re-run with --apply to do parts 1 and 2.\n",
  );
  await pool.end();
})().catch((err) => {
  console.error("Repair failed:", err.message);
  process.exit(1);
});
