/**
 * The seller's own particulars, copied onto an invoice at the moment it is
 * raised.
 *
 * WHY THIS EXISTS AT ALL
 *
 * An invoice is a record of what was issued, not a window onto what is true
 * now. It already snapshots who it was billed to, because a party can be
 * edited afterwards and a tax document must not change once it is handed over.
 * The seller's own block and bank details are the same kind of fact. Join them
 * and a reprint six months later shows an address the firm has since moved out
 * of, and an account it may have closed.
 *
 * So this reads the live profile ONCE, at creation, and everything afterwards
 * reads the copy. `invoiceRepository.createInvoice` calls it itself rather than
 * leaving it to the three callers, because a snapshot that a caller has to
 * remember to take is a snapshot that a fourth caller will forget.
 */

const { stateOf, stateCode } = require("./placeOfSupply");

/**
 * Reads the seller block for one wholesaler.
 *
 * The registered address is preferred over the warehouse address, because the
 * seller block on a tax invoice is the registered place of business. The
 * warehouse is where goods leave from, which is the dispatch-from block and a
 * different question. Falls back to the warehouse only when nothing registered
 * has been filled in, since a bill with an address on it beats a bill without.
 *
 * Every field may come back null. Null means the wholesaler has not told us,
 * and the document prints what it printed before rather than inventing a
 * plausible address.
 */
const sellerSnapshot = async (dbClient, wholesalerId) => {
  if (!wholesalerId) return {};

  const { rows } = await dbClient.query(
    `SELECT
       p.company_name, p.gstin, p.city, p.contact_phone,
       p.registered_address, p.registered_state, p.registered_pincode,
       p.warehouse_address, p.warehouse_city, p.warehouse_state, p.warehouse_pincode,
       u.phone AS user_phone
     FROM wholesaler_profiles p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1
     LIMIT 1`,
    [wholesalerId],
  );

  const p = rows[0];
  if (!p) return {};

  const address = p.registered_address || p.warehouse_address || null;
  const city = p.registered_address ? p.city : p.warehouse_city || p.city;
  const pincode = p.registered_address
    ? p.registered_pincode
    : p.warehouse_pincode || p.registered_pincode;

  // Ask placeOfSupply and nothing else. It reads a declared state, then the
  // state the GSTIN carries, then the city, and it is the only thing allowed
  // to make this decision.
  const state = stateOf({
    state: p.registered_address ? p.registered_state : p.warehouse_state,
    gstin: p.gstin,
    city,
  });

  return {
    sellerName: p.company_name || null,
    sellerGstin: p.gstin || null,
    sellerAddress: address,
    sellerCity: city || null,
    sellerState: state || null,
    sellerStateCode: state ? stateCode(state) : null,
    sellerPincode: pincode || null,
    sellerPhone: p.contact_phone || p.user_phone || null,
  };
};

/**
 * The bank details as they stood when the bill went out.
 *
 * These are not a secret. They are printed on the invoice on purpose, so the
 * customer knows where to send the money. The live copy in invoice_settings is
 * edited freely; this one is fixed to the bill.
 */
const bankSnapshot = async (dbClient, wholesalerId) => {
  if (!wholesalerId) return {};

  const { rows } = await dbClient.query(
    `SELECT bank_account_name, bank_name, bank_account_number, bank_ifsc, bank_branch
       FROM invoice_settings WHERE user_id = $1 LIMIT 1`,
    [wholesalerId],
  );

  const s = rows[0];
  if (!s) return {};

  return {
    bankAccountName: s.bank_account_name || null,
    bankName: s.bank_name || null,
    bankAccountNumber: s.bank_account_number || null,
    bankIfsc: s.bank_ifsc || null,
    bankBranch: s.bank_branch || null,
  };
};

module.exports = { sellerSnapshot, bankSnapshot };
