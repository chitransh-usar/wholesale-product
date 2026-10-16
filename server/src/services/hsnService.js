/**
 * HSN codes, kept to what can actually be checked.
 *
 * An HSN code is the number that says what a thing IS on a tax document. It
 * is printed on every invoice line, and above ₹5 crore turnover it has to be
 * six digits rather than four. Get it wrong and the bill misdescribes the
 * goods, which is the customer's problem as much as the wholesaler's, because
 * it is what they claim their input credit against.
 *
 * Three things are done here, and only three, because only three can be done
 * honestly without a paid data source:
 *
 *   the shape       a code is 4, 6 or 8 digits. Nothing else is a code, and
 *                   this catches a slipped keystroke on the spot.
 *   their own history what this wholesaler has typed before, which is by far
 *                   the best suggestion available: they sell the same goods
 *                   every week and they already classified them once.
 *   a short list    common textile headings, offered as a starting point for
 *                   a wholesaler who has never entered one.
 *
 * What is deliberately NOT here: a rate table. Nothing maps an HSN to a GST
 * percentage in this file and nothing should. Rates change, the same heading
 * carries different rates by price slab, and a rate presented as authoritative
 * puts a wrong tax on a legal document. The rate stays where it is, a number
 * the wholesaler sets on their own listing.
 *
 * The curated list below is a starting point, not an authority. It is common
 * knowledge about the textile chapters, not a licensed dataset, and the screen
 * says so: a wholesaler is told to check a suggestion against their own goods,
 * never that it has been verified.
 */

/** 4, 6 or 8 digits. Spaces and dots are what people type, not what it is. */
const tidyHsn = (value) => String(value ?? "").replace(/[\s.-]/g, "");

/**
 * Is this a usable HSN code?
 *
 * Blank is fine and comes back ok. Most of what a small wholesaler sells has
 * never been classified by anybody, and a blank field on a bill is a gap they
 * can fill in later. A wrong code is a false statement about the goods, which
 * is worse, so this refuses anything that is not a code rather than storing it
 * and hoping.
 *
 * @returns {{ ok: boolean, hsn: string|null, reason?: string }}
 */
const checkHsn = (value, { minDigits = 4 } = {}) => {
  const hsn = tidyHsn(value);
  if (!hsn) return { ok: true, hsn: null };

  if (!/^\d+$/.test(hsn)) {
    return { ok: false, hsn, reason: "An HSN code is digits only." };
  }
  if (![4, 6, 8].includes(hsn.length)) {
    return {
      ok: false,
      hsn,
      reason: `An HSN code is 4, 6 or 8 digits. This one has ${hsn.length}.`,
    };
  }
  // How many digits this platform bills at, from the Administration setting.
  //
  // The notification ties this to turnover: four digits up to 5 crore, six
  // above it, eight on exports and imports. Nothing here knows anybody's
  // turnover, and inventing a figure to derive a rule from would be worse than
  // asking. So it is a setting somebody sets, and the screen says as much.
  if (hsn.length < minDigits) {
    return {
      ok: false,
      hsn,
      reason: `This bill needs at least ${minDigits} digit HSN codes. "${hsn}" has ${hsn.length}. Change it in Administration if that is not right for you.`,
    };
  }
  return { ok: true, hsn };
};

/**
 * The minimum digit count in force, read once and cached by masterService.
 *
 * Async, which is why it is separate from checkHsn: the check itself stays
 * pure and synchronous so it can be called from anywhere, including a loop
 * over invoice lines, and the caller fetches the number once before it starts.
 *
 * Falls back to 4 rather than throwing. A bill that is checked against the
 * shipped floor beats a bill that cannot be raised at all.
 */
const minHsnDigits = async () => {
  try {
    const settings = await require("./masterService").settings();
    const n = Number(settings.defaultHsnMinDigits);
    return [4, 6, 8].includes(n) ? n : 4;
  } catch {
    return 4;
  }
};

/**
 * Common textile headings, at four digits.
 *
 * Four digits because that is the level a wholesaler can pick correctly by
 * reading it. Six and eight narrow it down by fibre content and weight, which
 * they can add themselves once they know which heading they are in, and which we would
 * be guessing at on their behalf.
 *
 * Chapters 50 to 63 are textiles and made up articles. This is a slice of them
 * biased towards what the wholesalers using this product actually sell.
 */
const TEXTILE_HSN = [
  { code: "5007", label: "Woven fabrics of silk" },
  { code: "5111", label: "Woven fabrics of carded wool" },
  { code: "5112", label: "Woven fabrics of combed wool" },
  { code: "5205", label: "Cotton yarn, 85% or more cotton" },
  { code: "5208", label: "Cotton fabric, light, 85% or more cotton" },
  { code: "5209", label: "Cotton fabric, heavy, 85% or more cotton" },
  { code: "5210", label: "Cotton fabric mixed with man made fibres" },
  { code: "5407", label: "Woven fabrics of synthetic filament yarn" },
  { code: "5408", label: "Woven fabrics of artificial filament yarn" },
  { code: "5512", label: "Fabric of synthetic staple fibres, 85% or more" },
  { code: "5513", label: "Synthetic staple fabric mixed with cotton, light" },
  { code: "5514", label: "Synthetic staple fabric mixed with cotton, heavy" },
  { code: "5801", label: "Woven pile fabrics, velvet and corduroy" },
  { code: "5804", label: "Lace and net fabrics" },
  { code: "5806", label: "Narrow woven fabrics, tape and ribbon" },
  { code: "5810", label: "Embroidery in the piece" },
  { code: "6001", label: "Knitted or crocheted pile fabrics" },
  { code: "6006", label: "Other knitted or crocheted fabrics" },
  { code: "6104", label: "Women's suits, dresses and skirts, knitted" },
  { code: "6109", label: "T shirts and vests, knitted" },
  { code: "6110", label: "Jerseys, pullovers and cardigans, knitted" },
  { code: "6203", label: "Men's suits, jackets and trousers, not knitted" },
  { code: "6204", label: "Women's suits, dresses and skirts, not knitted" },
  { code: "6205", label: "Men's shirts, not knitted" },
  { code: "6206", label: "Women's blouses and shirts, not knitted" },
  { code: "6211", label: "Track suits and other garments" },
  { code: "6214", label: "Shawls, scarves, dupattas and stoles" },
  { code: "6302", label: "Bed linen, table linen and towels" },
  { code: "6303", label: "Curtains and blinds" },
  { code: "6304", label: "Other furnishing articles, covers and cushions" },
  { code: "6305", label: "Sacks and bags for packing goods" },
  { code: "6310", label: "Rags and used textile pieces" },
];

/**
 * What this wholesaler has used before, most used first.
 *
 * Two places hold an HSN they have typed: their shop listings, and the lines of
 * the sales they have recorded. Both are read, because a wholesaler who has been
 * working on one screen should not have to start again on the other.
 *
 * The item name comes back with the code so a suggestion reads "5208, cotton
 * shirting" rather than four bare digits, and the count is how many times they
 * has used it, so their commonest goods come first.
 */
const historyFor = async (db, wholesalerId, limit = 12) => {
  const sql = `
    WITH used AS (
      SELECT si.hsn_code, p.name AS item_name, si.updated_at
        FROM supplier_inventory si
        JOIN products p ON p.id = si.product_id
       WHERE si.supplier_id = $1 AND si.hsn_code IS NOT NULL AND si.hsn_code <> ''
      UNION ALL
      SELECT sl.hsn_code, sl.item_name, sl.created_at
        FROM sale_lines sl
        JOIN sales s ON s.id = sl.sale_id
       WHERE s.wholesaler_id = $1 AND sl.hsn_code IS NOT NULL AND sl.hsn_code <> ''
    )
    SELECT hsn_code AS code,
           COUNT(*)::int AS times,
           MAX(item_name) AS label
      FROM used
     GROUP BY hsn_code
     ORDER BY times DESC, MAX(updated_at) DESC
     LIMIT $2`;

  try {
    const result = await db.query(sql, [wholesalerId, limit]);
    return result.rows.map((row) => ({
      code: row.code,
      label: row.label || "",
      times: row.times,
      from: "yours",
    }));
  } catch (err) {
    // A database behind on migrations has no sale_lines. Their own history is a
    // convenience; losing it must not take the curated list down with it.
    console.error("Could not read this wholesaler's HSN history:", err.message);
    return [];
  }
};

/**
 * Suggestions for a box the wholesaler is typing in.
 *
 * Their own codes come first and always, because they are the only ones anybody
 * has actually decided about. The curated list fills in behind them, and is
 * filtered by whatever they have typed so far, whether that is digits or words.
 */
const suggest = async (db, wholesalerId, query = "", limit = 8) => {
  const text = String(query ?? "").trim().toLowerCase();
  const digits = tidyHsn(query);

  const mine = await historyFor(db, wholesalerId);
  // From the master when the migration is in, from the built in list when it
  // is not. Required lazily: masterService falls back to TEXTILE_HSN, so a
  // require at the top of the file would be a cycle.
  const list = await require("./masterService").hsn();
  const curated = list.map((row) => ({ ...row, from: "common" }));

  const matches = (row) => {
    if (!text) return true;
    if (digits && row.code.startsWith(digits)) return true;
    return String(row.label || "").toLowerCase().includes(text);
  };

  const seen = new Set();
  const out = [];
  for (const row of [...mine, ...curated]) {
    if (!matches(row) || seen.has(row.code)) continue;
    seen.add(row.code);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
};

module.exports = { checkHsn, minHsnDigits, tidyHsn, suggest, historyFor, TEXTILE_HSN };
