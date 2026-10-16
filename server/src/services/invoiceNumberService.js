const invoiceRepository = require("../repositories/invoiceRepository");
const {
  prefixFor,
  seriesKeyFor,
  findAccount,
  isChannel,
  DEFAULT_CHANNEL,
} = require("./salesChannels");

/**
 * The next invoice number for one wholesaler, in their own run.
 *
 * Rule 46(b) of the CGST Rules sets three conditions, and the old version of
 * this file met one of them:
 *
 *   consecutive per supplier   met. The count is their own. It used to be
 *                              shared across the whole platform, so their book
 *                              read 000001, 000003, 000009 with other firms'
 *                              invoices filling the gaps.
 *   unique per FINANCIAL year  NOT met. It used `new Date().getFullYear()`,
 *                              so the counter rolled over on 1 January. An
 *                              invoice raised in January 2027 would reuse a
 *                              number already issued in FY 2026-27, which is
 *                              a duplicate serial inside one return period.
 *   at most 16 characters      NOT met. The prefix was clipped at 10 and the
 *                              composed number was not clipped at all, so a
 *                              10 character prefix produced a 22 character
 *                              serial. invoices.invoice_number is
 *                              varchar(50), so nothing refused it.
 *
 * Both are fixed here. The shape now follows the Busy voucher numbering
 * dialog a wholesaler showed us, which produces numbers like `OM/2/26-27`:
 *
 *   prefix   +   number   +   suffix
 *   OM/          2            /26-27
 *
 * with the number optionally padded to a fixed width, which is Busy's "Fix
 * Length of Numeric Part".
 */

/** Rule 46(b). Letters, digits, hyphen and slash, at most sixteen. */
const MAX_LENGTH = 16;
const ALLOWED = /^[A-Za-z0-9/-]*$/;

/**
 * The Indian financial year a date falls in, as "26-27".
 *
 * 1 April to 31 March. A date in January, February or March belongs to the
 * year that STARTED the previous April, which is the whole point: the serial
 * must not reset in the middle of a return period.
 */
const financialYear = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? year : year - 1;
  const two = (n) => String(n % 100).padStart(2, "0");
  return `${two(startYear)}-${two(startYear + 1)}`;
};

/** The label the sequence counts against, so the run resets on 1 April. */
const financialYearKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
};

/**
 * Build one number from its parts, and say whether it is legal.
 *
 * Pure, so the settings screen can show a live sample as the wholesaler types
 * without saving anything or touching the counter. Busy does exactly this and
 * it is the reason nobody there configures a number they cannot use.
 *
 * @returns {{ number: string, ok: boolean, reason?: string }}
 */
const compose = ({
  prefix = "INV-",
  suffix = "",
  sequence = 1,
  padTo = 0,
  date = new Date(),
} = {}) => {
  const year = financialYear(date);
  // The year is available to both parts, so a wholesaler can put it wherever
  // their stationery already has it.
  const fill = (text) => String(text ?? "").replace(/\{FY\}/g, year);

  const head = fill(prefix);
  const tail = fill(suffix);
  const digits = String(Math.max(1, Math.floor(Number(sequence) || 1)));
  const body = padTo > 0 ? digits.padStart(padTo, "0") : digits;
  const number = `${head}${body}${tail}`;

  if (!ALLOWED.test(number)) {
    return {
      number,
      ok: false,
      reason:
        "An invoice number may only use letters, digits, hyphen and slash. Rule 46(b).",
    };
  }
  if (number.length > MAX_LENGTH) {
    return {
      number,
      ok: false,
      reason: `That comes to ${number.length} characters. Rule 46(b) allows ${MAX_LENGTH}.`,
    };
  }
  if (!number.trim()) {
    return { number, ok: false, reason: "An invoice number cannot be blank." };
  }
  return { number, ok: true };
};

/**
 * The widest sequence number this format can reach before it breaks the
 * 16 character limit. Shown on the settings screen, because a wholesaler who
 * picks a long prefix should learn now rather than at invoice 1000.
 */
const roomFor = (options = {}) => {
  const sample = compose({ ...options, sequence: 1, padTo: 0 });
  const fixed = sample.number.length - 1;
  return Math.max(0, MAX_LENGTH - fixed);
};

class InvoiceNumberService {
  /**
   * Takes the next number, inside the caller's transaction.
   *
   * @param {object} client        a pg client, so the number is taken in the
   *                               same transaction that writes the invoice
   * @param {string} prefix        their prefix from invoice_settings
   * @param {number} yearOverride  for backdating; otherwise this financial year
   * @param {string} wholesalerId  whose run to draw from
   * @param {object} [format]      { suffix, padTo, channel, account } from
   *                               invoice_settings, plus which sales channel
   *                               this bill belongs to
   */
  async generateInvoiceNumber(
    client = null,
    prefix = "INV",
    yearOverride = null,
    wholesalerId = null,
    format = {},
  ) {
    /**
     * Which run to draw on, and what to stamp on the front of it.
     *
     * The counter channel keeps the wholesaler's OWN configured prefix, so a
     * firm that has been numbering OM/1/26-27 for a year carries straight on.
     * The marketplaces get their own prefix and their own counter, because the
     * point of a separate series is that it is tellable apart at a glance and
     * reconcilable against that marketplace's own report.
     */
    const asked = String(format.channel || DEFAULT_CHANNEL).toLowerCase();

    /**
     * A wholesaler's extra marketplace account is a run of its own. It is
     * looked up even when paused, because a sale filed under it before the
     * pause still bills into it. Not finding one is refused rather than filed
     * under the counter: the counter's prefix on a counter of its own would
     * print a number the counter run has already used.
     */
    let account = format.account || null;
    if (!account && !isChannel(asked)) {
      account = await findAccount(wholesalerId, asked, client || undefined);
      if (!account) {
        throw new Error(`No sales channel called "${asked}" for this wholesaler.`);
      }
    }
    const channel = seriesKeyFor(asked, account);
    const seriesPrefix = prefixFor(channel, prefix, account);
    // The counter is keyed on the financial year, not the calendar year, so
    // it resets on 1 April and an invoice raised in January carries on the
    // run that started the previous April.
    const yearKey = yearOverride || financialYearKey();
    const sequenceNumber = await invoiceRepository.getNextSequenceNumber(
      client,
      yearKey,
      wholesalerId,
      channel,
    );

    const asOf = yearOverride ? new Date(yearOverride, 4, 1) : new Date();

    // The old format, kept as the default so nothing changes for a wholesaler
    // who has not configured anything: INV-26-27-000001 would be 17
    // characters, so the default pads to 6 with no suffix and reads
    // INV-000001 at 10.
    const head = String(seriesPrefix || "INV").trim() || "INV";
    const built = compose({
      prefix: head.endsWith("-") || head.endsWith("/") ? head : `${head}-`,
      suffix: format.suffix ?? "",
      sequence: sequenceNumber,
      padTo: format.padTo ?? 6,
      date: asOf,
    });

    if (built.ok) return built.number;

    /**
     * The configured format cannot hold this number.
     *
     * Refusing would leave a wholesaler unable to raise a bill because of a
     * setting, which is worse than the setting being ignored. So the padding
     * is dropped first, and if it still does not fit the prefix is trimmed
     * from the right until it does. The number stays unique either way,
     * because the sequence is what makes it unique.
     */
    const unpadded = compose({
      prefix: head.endsWith("-") || head.endsWith("/") ? head : `${head}-`,
      suffix: format.suffix ?? "",
      sequence: sequenceNumber,
      padTo: 0,
      date: asOf,
    });
    if (unpadded.ok) return unpadded.number;

    const digits = String(sequenceNumber);
    const room = MAX_LENGTH - digits.length;
    return `${head.slice(0, Math.max(0, room))}${digits}`.slice(0, MAX_LENGTH);
  }
}

module.exports = new InvoiceNumberService();
module.exports.financialYear = financialYear;
module.exports.financialYear = financialYear;
module.exports.financialYearKey = financialYearKey;
module.exports.compose = compose;
module.exports.roomFor = roomFor;
module.exports.MAX_LENGTH = MAX_LENGTH;
