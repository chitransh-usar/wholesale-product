const pool = require("../config/db");
const { businessId } = require("../middlewares/businessContext");
const {
  CHANNELS,
  MARKETPLACES,
  MARKETPLACE_BY_ID,
  hasAccounts,
  listAccounts,
  headOf,
  prefixClash,
} = require("../services/salesChannels");
const invoiceNumberService = require("../services/invoiceNumberService");

/**
 * A wholesaler's extra Amazon and Flipkart accounts.
 *
 * Each one is a run of invoice numbers and nothing more: its own prefix, its
 * own counter, restarting on 1 April like every other run. The number format
 * after the prefix, the suffix and the padding, is the wholesaler's own from
 * the invoice settings, exactly as it is for the built in Flipkart and Amazon
 * books, so one screen decides what every bill of theirs looks like.
 *
 * See services/salesChannels.js for why sales and orders are NOT given a run
 * per account.
 */

const NOT_SET_UP = {
  message: "Extra marketplace accounts are not switched on yet.",
  code: "MARKETPLACE_ACCOUNTS_NOT_SET_UP",
};

/** Upper case, a slash on the end if it has no separator, at most 8 long. */
const cleanPrefix = (value) => {
  const p = String(value ?? "").trim().toUpperCase();
  if (!p) return "";
  return p.endsWith("/") || p.endsWith("-") ? p : `${p}/`;
};
const PREFIX_SHAPE = /^[A-Z0-9][A-Z0-9/-]{0,7}$/;

const settingsOf = async (wholesalerId) => {
  const { rows } = await pool.query(
    "SELECT prefix, number_suffix, number_pad_to FROM invoice_settings WHERE user_id = $1",
    [wholesalerId],
  );
  const row = rows[0] || {};
  return {
    prefix: row.prefix || "INV",
    suffix: row.number_suffix || "",
    padTo: row.number_pad_to ?? 6,
  };
};

/**
 * What bill number 1 in this run would read, with the wholesaler's format,
 * and whether the widest number the run can reach still fits Rule 46(b).
 */
const sampleFor = (prefix, settings) => {
  const first = invoiceNumberService.compose({
    prefix: headOf(prefix),
    suffix: settings.suffix,
    padTo: settings.padTo,
    sequence: 1,
  });
  return {
    sample: first.number,
    ok: first.ok,
    reason: first.reason || null,
    roomFor: invoiceNumberService.roomFor({ prefix: headOf(prefix), suffix: settings.suffix }),
  };
};

/** Has any bill been numbered in this account's run? */
const hasBills = async (wholesalerId, code) => {
  const { rows } = await pool.query(
    "SELECT 1 FROM invoices WHERE supplier_id = $1 AND channel = $2 LIMIT 1",
    [wholesalerId, code],
  );
  return rows.length > 0;
};

/** Anything at all filed under it: a bill, a sale, or an order. */
const isUsed = async (wholesalerId, code) => {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM invoices WHERE supplier_id = $1 AND channel = $2)
         OR EXISTS (SELECT 1 FROM sales WHERE wholesaler_id = $1 AND channel = $2)
         OR EXISTS (SELECT 1 FROM orders WHERE supplier_id = $1 AND channel = $2) AS used`,
    [wholesalerId, code],
  );
  return Boolean(rows[0]?.used);
};

const refuse = (res, status, message, code) =>
  res.status(status).json({ success: false, message, code });

/**
 * GET /api/marketplace-accounts
 *
 * The built in books are listed alongside, read only, so the screen can show
 * the whole picture: "Amazon, AZ/" is the first Amazon account and the ones
 * below it are the extra ones.
 */
exports.listAccounts = async (req, res) => {
  try {
    const wholesalerId = businessId(req);
    const settings = await settingsOf(wholesalerId);
    const builtIn = CHANNELS.filter((c) => c.marketplace).map((c) => ({
      marketplace: c.marketplace,
      name: c.label,
      prefix: c.prefix,
      ...sampleFor(c.prefix, settings),
    }));

    if (!(await hasAccounts())) {
      return res.json({
        success: true,
        setUp: false,
        accounts: [],
        builtIn,
        marketplaces: MARKETPLACES,
      });
    }

    const accounts = await listAccounts(wholesalerId);
    res.json({
      success: true,
      setUp: true,
      accounts: accounts.map((a) => ({
        ...a,
        marketplace_name: MARKETPLACE_BY_ID.get(a.marketplace)?.name || a.marketplace,
        ...sampleFor(a.invoice_prefix, settings),
      })),
      builtIn,
      marketplaces: MARKETPLACES,
      numberFormat: { suffix: settings.suffix, padTo: settings.padTo },
    });
  } catch (err) {
    console.error("Error listing marketplace accounts:", err);
    res.status(500).json({ success: false, message: "Could not load your marketplace accounts." });
  }
};

/**
 * Checks shared by adding and editing. Returns the message to refuse with,
 * or null.
 */
const checkPrefix = async (wholesalerId, prefix, exceptAccountId, db) => {
  if (!PREFIX_SHAPE.test(prefix)) {
    return "The bill prefix can use letters, digits, hyphen and slash, and at most 8 of them.";
  }
  const settings = await settingsOf(wholesalerId);
  const sample = sampleFor(prefix, settings);
  if (!sample.ok) return sample.reason;
  // Room for at least four digits, so the run does not break at bill 1,000.
  if (sample.roomFor < 4) {
    return `With your number format, ${prefix} leaves room for only ${sample.roomFor} digits. Rule 46(b) allows 16 characters in all. Use a shorter prefix.`;
  }
  const clash = await prefixClash(wholesalerId, prefix, db, {
    exceptAccountId,
    settingsPrefix: settings.prefix,
  });
  if (clash) {
    return `${prefix} is too close to ${clash}. Two books starting the same way would print the same bill numbers.`;
  }
  return null;
};

/**
 * POST /api/marketplace-accounts  { marketplace, name, invoicePrefix }
 *
 * The code is made here, `amazon-2`, `amazon-3`, rather than typed. It is
 * what a sale stores to say which book it is in, it can never change once
 * something is filed under it, and nobody should have to invent one.
 */
exports.addAccount = async (req, res) => {
  const wholesalerId = businessId(req);
  if (!(await hasAccounts())) return refuse(res, 503, NOT_SET_UP.message, NOT_SET_UP.code);

  const marketplace = String(req.body?.marketplace ?? "").trim().toLowerCase();
  const market = MARKETPLACE_BY_ID.get(marketplace);
  if (!market) {
    return refuse(res, 400, `Choose the marketplace: ${MARKETPLACES.map((m) => m.name).join(" or ")}.`);
  }
  const name = String(req.body?.name ?? "").trim().slice(0, 100);
  if (name.length < 2) {
    return refuse(res, 400, "Give this account a name you will recognise, such as \"Amazon, second store\".");
  }
  const prefix = cleanPrefix(req.body?.invoicePrefix);
  if (!prefix) return refuse(res, 400, "Give this account its own bill prefix, such as AZ2/.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One writer per wholesaler at a time, so two tabs cannot both take
    // amazon-2, or both pass the prefix check with the same prefix.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mkt:${wholesalerId}`]);

    const problem = await checkPrefix(wholesalerId, prefix, null, client);
    if (problem) {
      await client.query("ROLLBACK");
      return refuse(res, 400, problem, "BAD_PREFIX");
    }
    const taken = await client.query(
      "SELECT 1 FROM marketplace_linkages WHERE wholesaler_id = $1 AND LOWER(linkage_name) = LOWER($2)",
      [wholesalerId, name],
    );
    if (taken.rows.length) {
      await client.query("ROLLBACK");
      return refuse(res, 400, `You already have an account called "${name}".`);
    }

    // The built in book is account 1, so the first extra one is 2.
    const codes = await client.query(
      "SELECT code FROM marketplace_linkages WHERE wholesaler_id = $1 AND marketplace = $2",
      [wholesalerId, marketplace],
    );
    const used = new Set(codes.rows.map((r) => r.code));
    let n = 2;
    while (used.has(`${marketplace}-${n}`)) n += 1;
    const code = `${marketplace}-${n}`;

    const { rows } = await client.query(
      `INSERT INTO marketplace_linkages
         (wholesaler_id, marketplace, linkage_name, code, invoice_prefix, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, marketplace, linkage_name, code, invoice_prefix, is_active, created_at`,
      [wholesalerId, marketplace, name, code, prefix],
    );
    await client.query("COMMIT");
    res.status(201).json({ success: true, account: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error adding a marketplace account:", err);
    res.status(500).json({ success: false, message: "Could not add the account." });
  } finally {
    client.release();
  }
};

/**
 * PUT /api/marketplace-accounts/:id  { name, invoicePrefix, isActive }
 *
 * The prefix is fixed once a bill has gone out in this run. A number already
 * handed to a customer is what their books and their input tax credit refer
 * to, and changing the prefix halfway through a year leaves one run printed
 * two ways.
 */
exports.updateAccount = async (req, res) => {
  const wholesalerId = businessId(req);
  if (!(await hasAccounts())) return refuse(res, 503, NOT_SET_UP.message, NOT_SET_UP.code);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mkt:${wholesalerId}`]);

    const found = await client.query(
      "SELECT * FROM marketplace_linkages WHERE id = $1 AND wholesaler_id = $2",
      [req.params.id, wholesalerId],
    );
    const current = found.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return refuse(res, 404, "Account not found.");
    }

    const name = req.body?.name !== undefined
      ? String(req.body.name).trim().slice(0, 100)
      : current.linkage_name;
    if (name.length < 2) {
      await client.query("ROLLBACK");
      return refuse(res, 400, "Give this account a name you will recognise.");
    }

    const prefix = req.body?.invoicePrefix !== undefined
      ? cleanPrefix(req.body.invoicePrefix)
      : current.invoice_prefix;
    if (prefix !== current.invoice_prefix) {
      if (await hasBills(wholesalerId, current.code)) {
        await client.query("ROLLBACK");
        return refuse(
          res, 409,
          "Bills have already gone out with this prefix, so it cannot change. Add a new account if you need a new run.",
          "PREFIX_IN_USE",
        );
      }
      const problem = await checkPrefix(wholesalerId, prefix, current.id, client);
      if (problem) {
        await client.query("ROLLBACK");
        return refuse(res, 400, problem, "BAD_PREFIX");
      }
    }

    const active = typeof req.body?.isActive === "boolean" ? req.body.isActive : current.is_active;

    const { rows } = await client.query(
      `UPDATE marketplace_linkages
          SET linkage_name = $1, invoice_prefix = $2, is_active = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND wholesaler_id = $5
        RETURNING id, marketplace, linkage_name, code, invoice_prefix, is_active, created_at`,
      [name, prefix, active, current.id, wholesalerId],
    );
    await client.query("COMMIT");
    res.json({ success: true, account: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error updating a marketplace account:", err);
    res.status(500).json({ success: false, message: "Could not save the account." });
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/marketplace-accounts/:id
 *
 * Only an account nothing has been filed under. One that has sales or bills
 * owns a run of numbers that must stay explainable, so it can be paused and
 * never removed. Refused with a reason rather than quietly paused instead,
 * so pressing Remove never does something other than what it says.
 */
exports.removeAccount = async (req, res) => {
  const wholesalerId = businessId(req);
  if (!(await hasAccounts())) return refuse(res, 503, NOT_SET_UP.message, NOT_SET_UP.code);
  try {
    const found = await pool.query(
      "SELECT id, code, linkage_name FROM marketplace_linkages WHERE id = $1 AND wholesaler_id = $2",
      [req.params.id, wholesalerId],
    );
    const account = found.rows[0];
    if (!account) return refuse(res, 404, "Account not found.");

    if (await isUsed(wholesalerId, account.code)) {
      return refuse(
        res, 409,
        `"${account.linkage_name}" already has sales or bills in it, so it cannot be removed. Pause it instead.`,
        "ACCOUNT_IN_USE",
      );
    }
    await pool.query("DELETE FROM marketplace_linkages WHERE id = $1 AND wholesaler_id = $2", [
      account.id,
      wholesalerId,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error removing a marketplace account:", err);
    res.status(500).json({ success: false, message: "Could not remove the account." });
  }
};
