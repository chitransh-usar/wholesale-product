/**
 * The customer book, shared by every way business arrives.
 *
 * A wholesaler has one list of customers. They write some of them into it by
 * hand, and others arrive by placing an order through the shop. Both have to
 * land on the same row, or they ends up with the same man twice and two
 * different balances for one khata.
 *
 * That is what this module is for, and it is the only place allowed to decide
 * whether a person is already in the book.
 */
const { clean } = require("../utils/money");

/**
 * The last ten digits of a phone number, or null.
 *
 * Indian mobile numbers get typed a dozen ways: 98765 43210, +91 9876543210,
 * 09876543210. They are the same number, and matching them as raw strings
 * would put the same customer in the book three times.
 */
const phoneKey = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Find this person in the wholesaler's book, or add them.
 *
 * Matching, in order, because each rule is more certain than the next:
 *
 *   1. An account already linked to a party. Unambiguous.
 *   2. The same phone number. This is the one that matters in practice: the
 *      wholesaler wrote "Kishan 98200 11223" in their diary months ago, and now
 *      Kishan has signed up and ordered. Same man, same row, and the account
 *      gets linked to it so rule 1 answers next time.
 *   3. Nobody matched, so add them.
 *
 * Runs on the caller's client so it joins the caller's transaction. If the
 * order rolls back, the party goes with it.
 *
 * @param {object} client   a pg client already inside a transaction
 * @param {object} details
 * @param {string} details.wholesalerId  whose book to look in
 * @param {string} [details.userId]      the buyer's account, if they have one
 * @returns {Promise<object>} the party row
 */
const findOrCreateParty = async (client, details) => {
  const {
    wholesalerId,
    userId = null,
    name,
    businessName = null,
    phone = null,
    city = null,
    address = null,
    gstin = null,
  } = details;

  if (!wholesalerId) throw new Error("findOrCreateParty needs a wholesaler.");

  const key = phoneKey(phone);

  /**
   * Fill in what this party does not know yet, and nothing else.
   *
   * A customer who orders through the shop carries details their wholesaler may
   * never have written down: the name of their firm, and their GST number. Both
   * belong on the bill. The firm is who a tax invoice is addressed to, and
   * without the GST number the customer cannot claim their input credit, which
   * costs them money.
   *
   * Strictly blanks only. What the wholesaler typed into their own book is their,
   * and an order must never talk over it. That is the same rule the user_id
   * link below already follows.
   */
  const fillBlanks = async (party) => {
    const wanted = {
      business_name: clean(businessName),
      gstin: clean(gstin),
      phone: clean(phone),
      city: clean(city),
      address: clean(address),
    };

    const sets = [];
    const params = [party.id];
    for (const [column, value] of Object.entries(wanted)) {
      const held = party[column];
      if (!value) continue;
      if (held !== null && held !== undefined && String(held).trim() !== "") continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return party;

    const filled = await client.query(
      `UPDATE parties SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING *`,
      params,
    );
    return filled.rows[0] || party;
  };

  // 1. Already linked to this account.
  if (userId) {
    const byUser = await client.query(
      "SELECT * FROM parties WHERE wholesaler_id = $1 AND user_id = $2 LIMIT 1",
      [wholesalerId, userId],
    );
    if (byUser.rows.length > 0) return fillBlanks(byUser.rows[0]);
  }

  // 2. Same phone number, however it was typed. Scoped to one wholesaler, so
  // this reads a handful of rows off idx_parties_wholesaler.
  if (key) {
    const byPhone = await client.query(
      `SELECT * FROM parties
       WHERE wholesaler_id = $1
         AND phone IS NOT NULL
         AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [wholesalerId, key],
    );
    if (byPhone.rows.length > 0) {
      const party = byPhone.rows[0];
      // The diary entry now has an account behind it. Only ever fill a blank:
      // never move a party from one account to another.
      if (userId && !party.user_id) {
        const linked = await client.query(
          `UPDATE parties SET user_id = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND user_id IS NULL
           RETURNING *`,
          [userId, party.id],
        );
        if (linked.rows.length > 0) return fillBlanks(linked.rows[0]);
      }
      return fillBlanks(party);
    }
  }

  // 3. New customer. Nothing here overwrites anything, so the wholesaler's own
  // notes on a party they already had are never touched by an order.
  try {
    const created = await client.query(
      `INSERT INTO parties
         (wholesaler_id, user_id, name, business_name, phone, city, address, gstin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        wholesalerId,
        userId,
        clean(name) || "Customer",
        clean(businessName),
        clean(phone),
        clean(city),
        clean(address),
        clean(gstin),
      ],
    );
    return created.rows[0];
  } catch (err) {
    // The partial unique index on (wholesaler_id, phone) fired, which means
    // two checkouts raced for the same new customer. The other one won, so
    // read its row rather than failing a checkout over a duplicate.
    if (err.code === "23505" && key) {
      const raced = await client.query(
        `SELECT * FROM parties
         WHERE wholesaler_id = $1
           AND phone IS NOT NULL
           AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2
         ORDER BY created_at ASC
         LIMIT 1`,
        [wholesalerId, key],
      );
      if (raced.rows.length > 0) return raced.rows[0];
    }
    throw err;
  }
};

/**
 * Is the database new enough to link an order to a party?
 *
 * Migrations here are applied by hand, so the code is routinely ahead of the
 * schema it is talking to. Twice already a query has named a column that had
 * not been added yet and taken a whole screen down with a 500. Checkout is the
 * worst possible place for that, so it asks first and does without if the
 * answer is no.
 *
 * Cached after the first look: the schema does not change under a running
 * server, and this would otherwise be a round trip on every order.
 */
let partyLinkReady = null;

const hasPartyLink = async (client) => {
  if (partyLinkReady !== null) return partyLinkReady;
  try {
    const probe = await client.query(
      `SELECT to_regclass('public.parties') IS NOT NULL AS has_parties,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'orders'
                  AND column_name = 'party_id'
              ) AS has_column`,
    );
    const row = probe.rows[0] || {};
    partyLinkReady = Boolean(row.has_parties && row.has_column);
  } catch {
    partyLinkReady = false;
  }
  return partyLinkReady;
};

/**
 * Can a marketplace payment be written into the khata yet?
 *
 * Separate from hasPartyLink because the two migrations are separate: a
 * database can know which customer an order belongs to without yet being able
 * to record that customer's payments in one ledger.
 */
let ledgerReady = null;

const hasLedgerLink = async (client) => {
  if (ledgerReady !== null) return ledgerReady;
  try {
    const probe = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'party_payments'
           AND column_name = 'payment_transaction_id'
       ) AS ready`,
    );
    ledgerReady = Boolean(probe.rows[0]?.ready) && (await hasPartyLink(client));
  } catch {
    ledgerReady = false;
  }
  return ledgerReady;
};

/**
 * Put money that came in through the shop into the customer's khata.
 *
 * The khata is one ledger: cash the wholesaler wrote down and a UPI payment a
 * retailer made on their phone have to sit in the same column, or the customer
 * page answers "how much does they owe me" with only half the story.
 *
 * Does nothing, rather than failing, when the order has no customer or the
 * migration has not been run. A payment must never be lost because the
 * bookkeeping could not keep up, and orders.amount_paid is still the record
 * of what was actually taken.
 *
 * Idempotent through the unique index on payment_transaction_id: a buyer
 * double clicking "I have paid", a retried request, and the backfill all land
 * on the same transaction and only the first one writes.
 *
 * @returns {Promise<boolean>} whether a new ledger row was written
 */
const recordOrderPayment = async (client, details) => {
  const {
    orderId,
    partyId,
    wholesalerId,
    amount,
    method = "upi",
    transactionId = null,
    paidOn = null,
    note = null,
  } = details;

  if (!partyId || !wholesalerId || !orderId) return false;
  if (!(Number(amount) > 0)) return false;
  if (!(await hasLedgerLink(client))) return false;

  // party_payments.method is a CHECK list. A marketplace payment method that
  // is not on it becomes 'other' rather than failing the whole payment.
  const known = ["cash", "upi", "bank", "cheque", "other"];
  const safeMethod = known.includes(String(method)) ? String(method) : "other";

  const written = await client.query(
    `INSERT INTO party_payments
       (wholesaler_id, party_id, order_id, payment_transaction_id,
        amount, method, paid_on, note)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8)
     ON CONFLICT (payment_transaction_id) WHERE payment_transaction_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [wholesalerId, partyId, orderId, transactionId, amount, safeMethod, paidOn, note],
  );
  return written.rows.length > 0;
};

// For tests, which build a schema after the module is already loaded.
const resetPartyLink = () => { partyLinkReady = null; ledgerReady = null; };

module.exports = {
  findOrCreateParty,
  phoneKey,
  hasPartyLink,
  hasLedgerLink,
  recordOrderPayment,
  resetPartyLink,
};
