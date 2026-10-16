const pool = require("../config/db");

/**
 * Where a sale came from, and which run of invoice numbers it draws on.
 *
 * Rule 46(b) wants an invoice number that is consecutive WITHIN ITS SERIES and
 * unique within the financial year. A wholesaler selling over the counter, on
 * this marketplace, on Flipkart and on Amazon is running four books, and each
 * marketplace reconciles against its own. One shared counter means Flipkart's
 * run reads 4, 9, 11, with the gaps filled by counter sales, and their
 * settlement report cannot be matched against it.
 *
 * MORE THAN ONE ACCOUNT ON THE SAME MARKETPLACE. Added 24 Sept, from the
 * marketplace linkage work of 22 Sept. A wholesaler with two Amazon seller
 * accounts gets two settlement reports, one per account, and each has to be
 * matched against its own run of bills. So an extra account is one more book:
 * its own prefix, its own counter, nothing else. The built in Amazon and
 * Flipkart books are the first account on each and carry on unchanged.
 *
 * ONLY THE INVOICE RUN IS SPLIT. The 22 Sept version also gave every account
 * its own run of SALE and ORDER numbers. Orders were deliberately put on ONE
 * run on 19 Sept, because an order taken on the phone and one from the shop
 * page are the same document entered two ways, and two counters both printing
 * SO/ handed out SO/1/26-27 twice. A sale number is the wholesaler's own
 * reference, not a GST document, so Rule 46(b) has nothing to say about it.
 * The channel is still recorded on the sale and the order, which is what
 * decides the bill's run.
 *
 * THIS FILE DOES NOT IMPORT ANYTHING FROM FLIPKART OR AMAZON. It records which
 * book a sale belongs to, because somebody said so on the form. Pulling orders
 * out of those marketplaces is a separate piece of work: a CSV parser per
 * marketplace, or their APIs, which need a developer account and a seller
 * authorisation that cannot be arranged from inside this codebase. Saying
 * "Flipkart" on a dropdown is not an integration and the screen does not
 * pretend otherwise.
 *
 * THE PREFIX BUDGET. `PREFIX/1/26-27` spends 9 characters before the prefix
 * and Rule 46(b) allows 16, so there is room for a short one and a sequence
 * that can still grow. Two characters plus a slash leaves five digits, which
 * is 99,999 bills in a year on one channel.
 */

/**
 * The counter channel keeps the wholesaler's OWN configured prefix rather than
 * being given one here, so nothing changes for a wholesaler who has been
 * running on `invoice_settings.prefix` all along. Their existing run carries
 * on, and the three new channels start their own at 1, which is exactly what a
 * new series is allowed to do.
 */
const CHANNELS = [
  {
    code: "counter",
    label: "Counter or phone",
    hint: "A sale you made yourself. Uses the invoice prefix from your settings.",
    prefix: null,
  },
  {
    code: "shop",
    label: "This shop",
    hint: "An order placed through your shop page here.",
    prefix: "SA/",
  },
  {
    code: "flipkart",
    label: "Flipkart",
    hint: "Recorded by you. Nothing is pulled from Flipkart.",
    prefix: "FK/",
    marketplace: "flipkart",
  },
  {
    code: "amazon",
    label: "Amazon",
    hint: "Recorded by you. Nothing is pulled from Amazon.",
    prefix: "AZ/",
    marketplace: "amazon",
  },
];

const BY_CODE = new Map(CHANNELS.map((c) => [c.code, c]));
const DEFAULT_CHANNEL = "counter";

/**
 * The marketplaces a wholesaler can add a second account on. Adding one here
 * is all a new marketplace needs, as long as a built in channel of the same
 * code exists to be its first account.
 */
const MARKETPLACES = [
  { id: "amazon", name: "Amazon" },
  { id: "flipkart", name: "Flipkart" },
];
const MARKETPLACE_BY_ID = new Map(MARKETPLACES.map((m) => [m.id, m]));

/**
 * Whether wholesale3_marketplace_linkages.sql has been run.
 *
 * Asked with to_regclass rather than by trying the table and catching the
 * error, because several callers are inside a transaction, and a failed
 * statement there aborts the whole transaction. The 22 Sept version caught the
 * error and carried on, and every sale and order after it failed with "current
 * transaction is aborted". Caches only a TRUE, like every other probe here, so
 * running the migration takes effect on the next request.
 */
let accountsReady = false;
const hasAccounts = async (db = pool) => {
  if (accountsReady) return true;
  const { rows } = await db.query(
    "SELECT to_regclass('public.marketplace_linkages') IS NOT NULL AS ok",
  );
  accountsReady = Boolean(rows[0]?.ok);
  return accountsReady;
};

const ACCOUNT_COLUMNS = `id, marketplace, linkage_name, code, invoice_prefix,
                         is_active, created_at, updated_at`;

/** Every extra account a wholesaler has, paused ones included. */
const listAccounts = async (wholesalerId, db = pool) => {
  if (!wholesalerId || !(await hasAccounts(db))) return [];
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM marketplace_linkages
      WHERE wholesaler_id = $1
      ORDER BY marketplace, created_at`,
    [wholesalerId],
  );
  return rows;
};

/**
 * One account by its code, paused or not.
 *
 * A paused account is hidden from the forms for NEW sales, but a sale already
 * filed under it can still be billed, and that bill has to land in the
 * account's own run. Looking up only active accounts would have sent it to a
 * fresh counter carrying the wholesaler's own prefix, which is a second
 * INV/1/26-27.
 */
const findAccount = async (wholesalerId, code, db = pool) => {
  if (!wholesalerId || !code || !(await hasAccounts(db))) return null;
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM marketplace_linkages
      WHERE wholesaler_id = $1 AND code = $2`,
    [wholesalerId, String(code).toLowerCase()],
  );
  return rows[0] || null;
};

/** An account as the forms see it: one more entry in the channel list. */
const asChannel = (account) => {
  const market = MARKETPLACE_BY_ID.get(account.marketplace);
  return {
    code: account.code,
    label: account.linkage_name,
    hint: `Your ${market?.name || account.marketplace} account with bills numbered ${account.invoice_prefix}. Nothing is pulled from ${market?.name || "the marketplace"}.`,
    prefix: account.invoice_prefix,
    marketplace: account.marketplace,
    paused: !account.is_active,
  };
};

/**
 * The four built in books, then the wholesaler's extra accounts.
 *
 * Paused accounts are included and marked, so a sale filed under one still
 * shows its own book when it is opened for editing. The forms leave them out
 * of the choices for anything new.
 */
const channelsFor = async (wholesalerId, db = pool) => {
  const accounts = await listAccounts(wholesalerId, db);
  return [...CHANNELS, ...accounts.map(asChannel)];
};

/**
 * The channel a request asked for, or the default, from the four built in
 * books only. For places that have no wholesaler to look accounts up for.
 *
 * Returns `{ error }` for anything else rather than quietly falling back,
 * because a sale silently filed in the wrong book is a run of numbers that
 * cannot be reconciled and nobody was told.
 */
const parseChannel = (value) => {
  const code = String(value ?? "").trim().toLowerCase();
  if (!code) return { channel: DEFAULT_CHANNEL };
  if (!BY_CODE.has(code)) {
    return {
      error: `Unknown sales channel "${code}". It is one of: ${CHANNELS.map((c) => c.code).join(", ")}.`,
    };
  }
  return { channel: code };
};

/**
 * The same, but also accepting this wholesaler's own accounts.
 *
 * `allowPaused` is for editing something already filed: a paused account
 * still owns what was recorded against it, it just takes nothing new.
 */
const resolveChannel = async (value, wholesalerId, db = pool, { allowPaused = false } = {}) => {
  const code = String(value ?? "").trim().toLowerCase();
  if (!code) return { channel: DEFAULT_CHANNEL };
  if (BY_CODE.has(code)) return { channel: code };

  const account = await findAccount(wholesalerId, code, db);
  if (!account) {
    return {
      error: `Unknown sales channel "${code}". It is one of: ${CHANNELS.map((c) => c.code).join(", ")}, or one of your own marketplace accounts.`,
    };
  }
  if (!account.is_active && !allowPaused) {
    return {
      error: `"${account.linkage_name}" is paused. Switch it back on in Settings to record new sales against it.`,
    };
  }
  return { channel: code, account };
};

/**
 * The prefix to number this channel's invoices with.
 *
 * `settingsPrefix` is the wholesaler's own, and it wins for the counter
 * channel. For the others the channel's prefix is used, because the point of a
 * separate series is that it is tellable apart at a glance. An extra account
 * brings its own.
 */
const prefixFor = (channel, settingsPrefix, account = null) => {
  if (account?.invoice_prefix) return account.invoice_prefix;
  const found = BY_CODE.get(channel) || BY_CODE.get(DEFAULT_CHANNEL);
  return found.prefix || settingsPrefix || "INV";
};

/**
 * The key the counter is kept under. One run per wholesaler, channel and year.
 *
 * Built in channels are their own key. Anything else is only a key once the
 * caller has found the account it names, so `account` has to be passed for
 * it: an unrecognised code still falls back to the counter rather than
 * opening a run nobody configured.
 */
const seriesKeyFor = (channel, account = null) => {
  if (account?.code) return account.code;
  return BY_CODE.has(channel) ? channel : DEFAULT_CHANNEL;
};

/**
 * The text an invoice number starts with, as generateInvoiceNumber builds it:
 * a prefix without a separator on the end is given a hyphen.
 */
const headOf = (prefix) => {
  const p = String(prefix ?? "").trim().toUpperCase() || "INV";
  return p.endsWith("-") || p.endsWith("/") ? p : `${p}-`;
};

/**
 * Would a bill numbered from `prefix` ever read the same as one from a run
 * this wholesaler already has?
 *
 * Two runs with the same prefix each start at 1, so the second bill in either
 * is a duplicate number, which Rule 46(b) forbids and which breaks the
 * customer's GSTR-2B against ours. One prefix that begins another is refused
 * too. It is stricter than it strictly has to be, and it is one sentence to
 * explain on a screen, which a rule about digits after a separator is not.
 *
 * @returns {Promise<string|null>} the name of the book it clashes with
 */
const prefixClash = async (
  wholesalerId,
  prefix,
  db = pool,
  { exceptAccountId = null, settingsPrefix, skipSettings = false } = {},
) => {
  const head = headOf(prefix);
  const clashes = (other) => {
    const o = headOf(other);
    return o.startsWith(head) || head.startsWith(o);
  };

  for (const c of CHANNELS) {
    if (c.prefix && clashes(c.prefix)) return `the ${c.label} book (${c.prefix})`;
  }

  if (!skipSettings) {
    let own = settingsPrefix;
    if (own === undefined) {
      const { rows } = await db.query(
        "SELECT prefix FROM invoice_settings WHERE user_id = $1",
        [wholesalerId],
      );
      own = rows[0]?.prefix || "INV";
    }
    if (clashes(own)) return `your own bills (${headOf(own)})`;
  }

  for (const a of await listAccounts(wholesalerId, db)) {
    if (a.id === exceptAccountId) continue;
    if (clashes(a.invoice_prefix)) return `${a.linkage_name} (${a.invoice_prefix})`;
  }
  return null;
};

module.exports = {
  CHANNELS,
  DEFAULT_CHANNEL,
  MARKETPLACES,
  MARKETPLACE_BY_ID,
  hasAccounts,
  listAccounts,
  findAccount,
  channelsFor,
  parseChannel,
  resolveChannel,
  prefixFor,
  seriesKeyFor,
  headOf,
  prefixClash,
  isChannel: (code) => BY_CODE.has(String(code ?? "").toLowerCase()),
  // Tests point one process at more than one database.
  resetAccountsProbe: () => { accountsReady = false; },
};
