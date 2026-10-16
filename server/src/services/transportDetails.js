/**
 * The transport block, in one place.
 *
 * A sale carries it and an invoice carries it, and when a bill is raised from a
 * sale the block is copied across. Three copies of "trim these eight fields and
 * check the mode" is how two of them end up accepting something the third
 * refuses, which this codebase has been bitten by before.
 *
 * These are the e-way bill fields. They matter beyond printing, because the
 * payload that eventually goes to NIC is built from exactly these.
 */

const { clean } = require("../utils/money");

/**
 * How the goods travel. The e-way bill form numbers these 1 to 4, but the
 * number is an encoding detail of that API and means nothing to a wholesaler
 * reading a screen, so the word is stored and the number can be derived when
 * there is something to send it to.
 */
const TRANSPORT_MODES = ["road", "rail", "air", "ship"];

/** The columns, in one list, so a writer cannot name seven of the eight. */
const TRANSPORT_COLUMNS = [
  "transporter_name",
  "transporter_id",
  "transport_mode",
  "vehicle_number",
  "transport_doc_number",
  "transport_doc_date",
  "gr_number",
  "gr_date",
];

/**
 * Reads the transport block off a request body.
 *
 * Accepts both spellings, camelCase from the client and snake_case from
 * anything reading a row back, because both reach this from somewhere.
 *
 * Returns `{ error }` for a mode that is not one of the four, rather than
 * letting the database CHECK refuse it: the constraint gives a wholesaler a
 * violation message, this gives them the four choices.
 *
 * A date is passed through as whatever was sent, or null. Postgres parses it,
 * and a half parsed date guessed at here is worse than one the database
 * refuses outright.
 *
 * But BLANK IS NOT A DATE SOMEBODY SENT, it is the absence of one, and the two
 * dates used to be the only fields here that skipped `clean`. An untouched date
 * input posts an empty string, `"" ?? null` is `""`, and Postgres answered
 * `invalid input syntax for type date: ""` on parameter $18, which refused the
 * whole sale. `clean` only trims and nulls an empty string. It never parses or
 * reformats, so the rule above still holds: a real date still goes to Postgres
 * exactly as it was typed.
 */
const parseTransport = (body = {}) => {
  const pick = (camel, snake) => clean(body[camel] ?? body[snake]);

  const mode = (pick("transportMode", "transport_mode") || "").toLowerCase();
  if (mode && !TRANSPORT_MODES.includes(mode)) {
    return {
      error: `How the goods travel has to be one of: ${TRANSPORT_MODES.join(", ")}.`,
    };
  }

  return {
    values: {
      transporter_name: pick("transporterName", "transporter_name"),
      transporter_id: pick("transporterId", "transporter_id"),
      transport_mode: mode || null,
      vehicle_number: pick("vehicleNumber", "vehicle_number"),
      transport_doc_number: pick("transportDocNumber", "transport_doc_number"),
      transport_doc_date: pick("transportDocDate", "transport_doc_date"),
      gr_number: pick("grNumber", "gr_number"),
      gr_date: pick("grDate", "gr_date"),
    },
  };
};

/** Did the wholesaler actually record any of it? */
const hasAnyTransport = (values = {}) =>
  TRANSPORT_COLUMNS.some((c) => values[c] !== null && values[c] !== undefined && values[c] !== "");

/**
 * The same block, keyed the way invoiceRepository.createInvoice wants it.
 *
 * Used when a bill is raised from a sale, so the lorry the wholesaler recorded
 * once on the sale prints on the invoice without them typing it twice.
 */
const toInvoiceFields = (row = {}) => ({
  transporterName: row.transporter_name || null,
  transporterId: row.transporter_id || null,
  transportMode: row.transport_mode || null,
  vehicleNumber: row.vehicle_number || null,
  transportDocNumber: row.transport_doc_number || null,
  transportDocDate: row.transport_doc_date || null,
  grNumber: row.gr_number || null,
  grDate: row.gr_date || null,
});

/**
 * Writes the transport block onto a row, and onto the invoice already raised
 * from it if there is one.
 *
 * WHY THE INVOICE IS UPDATED AT ALL, given that a tax document is frozen.
 *
 * A shop order raises its bill the moment the order is placed, long before
 * anything is loaded onto a lorry. So the transport cannot be copied at
 * billing time: nobody knows it yet. Stamping it at despatch is the only
 * moment the information exists.
 *
 * This is a deliberate exception and a narrow one. The addresses and the
 * amounts are frozen because they were true when the document was issued. The
 * vehicle is not that kind of fact. It is decided afterwards, and the e-way
 * bill rules themselves allow the vehicle number to be changed in transit,
 * because lorries break down and goods get moved. Nothing else on the invoice
 * is touched here.
 *
 * @param db      a pool or a client, so the caller decides the transaction
 * @param table   'orders' or 'sales'
 * @param id      the row's id
 * @param values  from parseTransport
 */
const stampTransport = async (db, table, id, values) => {
  if (!hasAnyTransport(values)) return { row: false, invoice: false };

  const set = TRANSPORT_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const args = TRANSPORT_COLUMNS.map((c) => values[c]);

  await db.query(`UPDATE ${table} SET ${set} WHERE id = $1`, [id, ...args]);

  // The bill raised from it, if one exists. The column it is linked by differs
  // by table and there are only two, so it is named rather than derived.
  const link = table === "orders" ? "order_id" : "sale_id";
  const stamped = await db.query(
    `UPDATE invoices SET ${set} WHERE ${link} = $1`,
    [id, ...args],
  );

  return { row: true, invoice: stamped.rowCount > 0 };
};

module.exports = {
  TRANSPORT_MODES,
  TRANSPORT_COLUMNS,
  parseTransport,
  hasAnyTransport,
  toInvoiceFields,
  stampTransport,
};
