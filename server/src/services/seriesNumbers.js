const invoiceRepository = require("../repositories/invoiceRepository");
const { financialYear } = require("./invoiceNumberService");

/**
 * Sale and challan numbers, in one place.
 *
 * There were two copies of the sale numbering, one in saleController for a
 * sale the wholesaler types and one in orderSaleService for a sale written
 * when an order is accepted. Changing the shape in one of them and not the
 * other is exactly what happened on 12 Sept: sales from the sales book got the
 * new number and sales from an accepted order crashed on an ON CONFLICT that
 * no longer matched. Two copies of a rule is how this codebase has been bitten
 * repeatedly, so there is one now.
 *
 * THE SHAPE. S/1/26-27 and DC/1/26-27, restarting each 1 April, which is the
 * same shape the invoice uses. All three used to differ:
 *
 *   invoice   INV-000001   restarts yearly
 *   sale      S-0001       never restarts
 *   challan   DC-0001      never restarts
 *
 * Three documents describing the same goods, three shapes, three padding
 * widths, and no year on any of them.
 *
 * Unlike the invoice this is not a legal requirement. Rule 46(b) constrains a
 * tax invoice; a sale is the wholesaler's own record and a challan under this
 * product's rule is explicitly not a tax document. The reason is legibility,
 * not law.
 *
 * BOTH FALL BACK. Until wholesale3_series_financial_year.sql is run the old
 * shapes are produced, because migrations here are applied by hand and a sale
 * that cannot be written is far worse than one numbered the old way.
 *
 * Must be called inside a transaction: the upsert locks the counter row until
 * commit, which is what stops two sales taking the same number.
 */

/**
 * Refused because the number itself is not legal, not because the server broke.
 * Carries a status and a code so a controller can hand the wholesaler the real
 * reason. Without them this arrives at the generic catch and a trader who
 * cannot record a sale is told only "Server error", which tells them nothing
 * and tells whoever they ring for help even less.
 */
class SequenceNumberError extends Error {
  constructor(message) {
    super(message);
    this.name = "SequenceNumberError";
    this.status = 409;
    this.code = "DOCUMENT_NUMBER_INVALID";
  }
}

/**
 * Rule 46(b) of the CGST Rules: a tax invoice number is at most 16 characters
 * and holds only letters, digits, hyphen and slash.
 *
 * This governs the documents a seller ISSUES under GST, so it is applied to
 * sale and challan numbers. A purchase voucher is this wholesaler's own record
 * of somebody else's bill and Rule 46(b) has nothing to say about it, so the
 * shape is still checked there but the 16 character ceiling is not imposed.
 */
const GST_NUMBER_CHARS = /^[A-Za-z0-9/-]+$/;
const RULE_46B_MAX = 16;

function validateSequenceNumber(number, { statutory = true } = {}) {
  if (!number || typeof number !== "string") {
    throw new SequenceNumberError("A document number could not be generated.");
  }
  if (statutory && number.length > RULE_46B_MAX) {
    throw new SequenceNumberError(
      `Number "${number}" is ${number.length} characters. GST allows at most ` +
        `${RULE_46B_MAX}, so this series needs a shorter prefix before it can ` +
        `be used again.`,
    );
  }
  if (!GST_NUMBER_CHARS.test(number)) {
    throw new SequenceNumberError(
      `Number "${number}" has characters GST does not allow. Only letters, ` +
        `digits, hyphen and slash are permitted.`,
    );
  }
  return true;
}

/**
 * One upsert, and the number it returns is the one that is checked.
 *
 * There is no point reading the counter first to guess what the number will be:
 * the read is not under the lock, so two sales starting together both guess the
 * same value, and the guess is thrown away a line later anyway. The upsert is
 * the only authority. Checking its result is the whole guard, and every caller
 * runs inside a transaction that rolls back on a throw, so a refused number is
 * not consumed.
 */
const take = async (client, wholesalerId, table, legacyPrefix, prefix, opts = {}) => {
  const has = await invoiceRepository.schemaExtras();

  if (!has.has_series_fy) {
    const legacy = await client.query(
      `INSERT INTO ${table} (wholesaler_id, last_number)
       VALUES ($1, 1)
       ON CONFLICT (wholesaler_id)
       DO UPDATE SET last_number = ${table}.last_number + 1
       RETURNING last_number`,
      [wholesalerId],
    );
    const generated = `${legacyPrefix}${String(legacy.rows[0].last_number).padStart(4, "0")}`;
    validateSequenceNumber(generated, opts);
    return generated;
  }

  const fy = financialYear();
  const result = await client.query(
    `INSERT INTO ${table} (wholesaler_id, financial_year, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (wholesaler_id, financial_year)
     DO UPDATE SET last_number = ${table}.last_number + 1
     RETURNING last_number`,
    [wholesalerId, fy],
  );
  const generated = `${prefix}${result.rows[0].last_number}/${fy}`;
  validateSequenceNumber(generated, opts);
  return generated;
};

/** S/1/26-27, or S-0001 before the migration. */
const nextSaleNumber = (client, wholesalerId) =>
  take(client, wholesalerId, "sale_sequences", "S-", "S/");

/**
 * SC/1/26-27 for a sale challan, PC/1/26-27 for a purchase challan.
 *
 * Its own allocator rather than `take`, because this is the only counter with
 * a KIND in its key: goods going out and goods coming in are two runs, for
 * the same reason a Flipkart bill and a counter bill are. take() upserts on
 * (wholesaler_id, financial_year) and cannot carry a third column without
 * every other caller growing one it has no use for.
 *
 * The prefix changed from DC. The document is a challan, not specifically a
 * delivery note, and it now comes in two directions, so one prefix could not
 * name both. The COUNTER is untouched: the sale row keeps its number, so a
 * wholesaler who had reached DC/5/26-27 gets SC/6/26-27 next and no number is
 * reused.
 *
 * Not statutory. A challan number is our own reference, so Rule 46(b)'s
 * sixteen characters are not imposed, only the character set.
 *
 * Must be called inside a transaction: the upsert locks the row until commit.
 */
const CHALLAN_PREFIX = { sale: "SC/", purchase: "PC/" };
const CHALLAN_LEGACY = { sale: "SC-", purchase: "PC-" };

const nextChallanNumber = async (client, wholesalerId, kind = "sale") => {
  const key = CHALLAN_PREFIX[kind] ? kind : "sale";
  const has = await invoiceRepository.schemaExtras();

  if (!has.has_series_fy) {
    const legacy = await client.query(
      `INSERT INTO delivery_challan_sequences (wholesaler_id, last_number)
       VALUES ($1, 1)
       ON CONFLICT (wholesaler_id)
       DO UPDATE SET last_number = delivery_challan_sequences.last_number + 1
       RETURNING last_number`,
      [wholesalerId],
    );
    const generated =
      `${CHALLAN_LEGACY[key]}${String(legacy.rows[0].last_number).padStart(4, "0")}`;
    validateSequenceNumber(generated, { statutory: false });
    return generated;
  }

  const fy = financialYear();
  // The kind column arrives with wholesale3_challans_two_kinds.sql. Without
  // it there is one run, which is exactly how the product behaved before
  // purchase challans existed, rather than a refusal to number anything.
  const hasKind = await client
    .query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'delivery_challan_sequences' AND column_name = 'kind'`,
    )
    .then((r) => r.rows.length > 0)
    .catch(() => false);

  const result = hasKind
    ? await client.query(
        `INSERT INTO delivery_challan_sequences (wholesaler_id, financial_year, kind, last_number)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (wholesaler_id, financial_year, kind)
         DO UPDATE SET last_number = delivery_challan_sequences.last_number + 1
         RETURNING last_number`,
        [wholesalerId, fy, key],
      )
    : await client.query(
        `INSERT INTO delivery_challan_sequences (wholesaler_id, financial_year, last_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (wholesaler_id, financial_year)
         DO UPDATE SET last_number = delivery_challan_sequences.last_number + 1
         RETURNING last_number`,
        [wholesalerId, fy],
      );

  const generated = `${CHALLAN_PREFIX[key]}${result.rows[0].last_number}/${fy}`;
  validateSequenceNumber(generated, { statutory: false });
  return generated;
};

/**
 * PUR/1/26-27.
 *
 * No legacy shape and no fallback, because purchase_sequences is created with
 * financial_year already in its key: there is no older database that has the
 * table without the column. It does not route through take() for the same
 * reason, since take() branches on has_series_fy, which describes whether the
 * SALE and CHALLAN counters were migrated and says nothing about this one. A
 * wholesaler who has run the purchase migration but not the series one would
 * otherwise get purchases numbered PUR-0001 off a table with no such key.
 *
 * Must be called inside a transaction, like the other two: the upsert locks
 * the counter row until commit.
 */
const nextPurchaseNumber = async (client, wholesalerId) => {
  const fy = financialYear();
  const result = await client.query(
    `INSERT INTO purchase_sequences (wholesaler_id, financial_year, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (wholesaler_id, financial_year)
     DO UPDATE SET last_number = purchase_sequences.last_number + 1
     RETURNING last_number`,
    [wholesalerId, fy],
  );
  const generated = `PUR/${result.rows[0].last_number}/${fy}`;
  // A purchase voucher is this wholesaler's own note of somebody else's bill.
  // Rule 46(b) governs what a seller issues, so the shape is checked but the
  // 16 character ceiling is not imposed on it.
  validateSequenceNumber(generated, { statutory: false });
  return generated;
};

/**
 * SO/1/26-27, the order's own run.
 *
 * Orders used to be numbered `ORD-<timestamp>-<buyer id>` in the controller,
 * which is unique and is not a series: unreadable over a phone, never
 * restarting on 1 April, and giving no clue that two orders are consecutive.
 *
 * Its own allocator rather than take(), because take() branches on
 * has_series_fy, which describes whether the SALE and CHALLAN counters were
 * migrated and says nothing about this one. order_sequences is created with
 * financial_year already in its key, so there is no older shape to fall back
 * to and no legacy prefix.
 *
 * Not statutory: an order is not a document GST governs, so Rule 46(b)'s
 * sixteen characters are not imposed, only the character set.
 *
 * Must be called inside a transaction: the upsert locks the row until commit.
 */
const nextOrderNumber = async (client, wholesalerId) => {
  const fy = financialYear();
  const result = await client.query(
    `INSERT INTO order_sequences (wholesaler_id, financial_year, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (wholesaler_id, financial_year)
     DO UPDATE SET last_number = order_sequences.last_number + 1
     RETURNING last_number`,
    [wholesalerId, fy],
  );
  const generated = `SO/${result.rows[0].last_number}/${fy}`;
  validateSequenceNumber(generated, { statutory: false });
  return generated;
};

module.exports = {
  nextSaleNumber,
  nextOrderNumber,
  nextChallanNumber,
  nextPurchaseNumber,
  validateSequenceNumber,
  SequenceNumberError,
};
