const { pick, normaliseHeader } = require("./csvReader");
const { asState, stateCode } = require("./placeOfSupply");
const { checkHsn } = require("./hsnService");
const { CHANNELS, DEFAULT_CHANNEL } = require("./salesChannels");

/**
 * What a spreadsheet row means, before any database is involved.
 *
 * Kept apart from importService on purpose. Everything here is pure, so the
 * awkward half of an import, a person's idea of a date and a person's idea of
 * a number, can be tested to death without a Postgres anywhere near it.
 *
 * THE RULE THIS FILE KEEPS. Nothing is guessed. A value that cannot be read is
 * an error naming the column, the line and what was in it, never a silent zero
 * and never a best effort. A book of accounts built out of best efforts is
 * worse than no book, because it looks finished.
 */

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * A number a person typed, in rupees.
 *
 * Handles what actually turns up: a rupee sign, Indian digit grouping
 * (1,23,456.78, which groups in twos after the first three and breaks any
 * parser that assumes thousands), a space as a separator, and a trailing minus
 * which is what some accounting exports write for a credit.
 *
 * Refuses anything else. "N/A", "-", "see note" and "1.2.3" are all errors,
 * because each of them read as zero would quietly understate a balance.
 */
const money = (value, { field }) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return { ok: true, value: null };

  // The separators and the currency come off first: a rupee sign, Indian
  // digit grouping, and the spaces somebody typed lining a column up.
  let cleaned = raw.replace(/₹/g, "").replace(/\s+/g, "").replace(/,/g, "");
  // Rs and Rs. in front, which is how half the spreadsheets in India write it.
  cleaned = cleaned.replace(/^rs\.?/i, "");

  // A minus on either side, and the CR and DR an accounting export writes.
  let negative = false;
  if (/^-/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1);
  }
  if (/-$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(0, -1);
  }
  const dr = /dr$/i.test(cleaned);
  const cr = /cr$/i.test(cleaned);
  cleaned = cleaned.replace(/(dr|cr)$/i, "");
  if (cr) negative = true;
  if (dr) negative = false;

  if (cleaned === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, reason: `${field}: "${raw}" is not an amount.` };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, reason: `${field}: "${raw}" is not an amount.` };
  // Two decimal places, because that is what the columns hold and what a
  // rupee is. Rounded rather than truncated, so 0.005 does not vanish.
  return { ok: true, value: Math.round((negative ? -n : n) * 100) / 100 };
};

/** Like money, but a plain count that may have decimals, such as 12.500 metres. */
const quantity = (value, { field }) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  const text = raw.replace(/,/g, "").replace(/\s+/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return { ok: false, reason: `${field}: "${raw}" is not a quantity.` };
  }
  return { ok: true, value: Math.round(Number(text) * 1000) / 1000 };
};

/** A percentage. 18, 18%, 18.00 all mean the same thing. */
const percent = (value, { field }) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  const text = raw.replace(/%/g, "").replace(/\s+/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, reason: `${field}: "${raw}" is not a percentage.` };
  }
  const n = Number(text);
  if (n > 100) return { ok: false, reason: `${field}: "${raw}" is more than 100 per cent.` };
  return { ok: true, value: Math.round(n * 100) / 100 };
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A date, read the way an Indian trader writes one.
 *
 * DAY FIRST, ALWAYS. 03/04/2026 is the third of April, not the fourth of
 * March. This is the one place in the whole import where a wrong guess is
 * invisible: both readings are real dates, nothing errors, and a bill silently
 * moves into a different month and therefore a different GST return.
 *
 * So it is not a guess, it is a rule, and it is written on the template and on
 * the screen. The unambiguous formats are taken as they are:
 *
 *   2026-04-03    ISO, what our own export writes
 *   3 Apr 2026    month by name
 *   03/04/2026    day first, by the rule above
 *
 * A spreadsheet that hands over a real date object rather than text arrives
 * here as an ISO string already, which is the easy case.
 */
const date = (value, { field }) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return { ok: true, value: null };

  const build = (y, m, d) => {
    if (m < 1 || m > 12) return { ok: false, reason: `${field}: "${raw}" has no such month.` };
    if (d < 1 || d > 31) return { ok: false, reason: `${field}: "${raw}" has no such day.` };
    if (y < 1900 || y > 2200) return { ok: false, reason: `${field}: "${raw}" is not a real year.` };
    // Round tripped through a real date, which is what catches the 31st of
    // February. UTC so a server in another timezone does not shift the day.
    const made = new Date(Date.UTC(y, m - 1, d));
    if (made.getUTCMonth() + 1 !== m || made.getUTCDate() !== d) {
      return { ok: false, reason: `${field}: there is no ${raw}.` };
    }
    return { ok: true, value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  };

  // ISO, possibly with a time after it.
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // Day first, with any of the three separators people use.
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (m) {
    let year = Number(m[3]);
    // A two digit year. 26 is 2026, and 99 is 1999, which is the same window
    // every spreadsheet uses and is safe for a book of accounts either way.
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return build(year, Number(m[2]), Number(m[1]));
  }

  // 3 Apr 2026, 3-Apr-26, April 3 2026.
  m = raw.match(/^(\d{1,2})[\s\-]*([A-Za-z]{3,})[\s\-]*(\d{2}|\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!month) return { ok: false, reason: `${field}: "${raw}" has no month this recognises.` };
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return build(year, month, Number(m[1]));
  }

  return {
    ok: false,
    reason: `${field}: "${raw}" is not a date this can read. Use 2026-04-03, or 03/04/2026 for the third of April.`,
  };
};

// ---------------------------------------------------------------------------
// The rest
// ---------------------------------------------------------------------------

/** A GSTIN, checked for shape only. Blank is fine: plenty of customers have none. */
const gstin = (value, { field }) => {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (raw === "") return { ok: true, value: null };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(raw)) {
    return {
      ok: false,
      reason: `${field}: "${raw}" is not the shape of a GST number. It is 15 characters, two digits then five letters and so on.`,
    };
  }
  return { ok: true, value: raw };
};

/** A phone number, digits only, which is how the unique index sees it. */
const phone = (value, { field }) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  const digits = raw.replace(/[\s\-()]/g, "").replace(/^\+?91/, "");
  if (!/^\d{6,15}$/.test(digits)) {
    return { ok: false, reason: `${field}: "${raw}" is not a phone number.` };
  }
  return { ok: true, value: digits };
};

const text = (value, { field, max = 255, required = false } = {}) => {
  const raw = String(value ?? "").trim();
  if (raw === "") {
    if (required) return { ok: false, reason: `${field} cannot be blank.` };
    return { ok: true, value: null };
  }
  if (raw.length > max) {
    return { ok: false, reason: `${field}: "${raw.slice(0, 30)}..." is longer than ${max} characters.` };
  }
  return { ok: true, value: raw };
};

const hsn = (value, { field, minDigits }) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  const checked = checkHsn(raw, { minDigits });
  if (!checked.ok) return { ok: false, reason: `${field}: ${checked.reason}` };
  return { ok: true, value: checked.hsn };
};

const state = (value) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  // asState is the same resolver the rest of the product uses. An unknown
  // state is kept as typed rather than refused: null would read as "not told",
  // which the tax side treats as the same state, and quietly billing CGST on
  // an interstate sale is worse than carrying a spelling we do not know.
  return { ok: true, value: asState(raw) || raw };
};

const channel = (value, { field }) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "") return { ok: true, value: DEFAULT_CHANNEL };
  const found = CHANNELS.find(
    (c) => c.code === raw || c.label.toLowerCase() === raw,
  );
  if (!found) {
    return {
      ok: false,
      reason: `${field}: "${value}" is not one of ${CHANNELS.map((c) => c.code).join(", ")}.`,
    };
  }
  return { ok: true, value: found.code };
};

// ---------------------------------------------------------------------------
// The lists, and what each column in them is called
// ---------------------------------------------------------------------------

/**
 * Column spellings, ours first.
 *
 * The first name is what our own export writes, so a book exported from one
 * account and imported into another is read by its real name. The rest are
 * what a person would type, so a spreadsheet nobody generated also works.
 */
const F = (dbColumn, ...aliases) => ({ column: dbColumn, names: [dbColumn, ...aliases] });

const read = (record, field, reader, options = {}) => {
  const raw = pick(record, ...field.names);
  return reader(raw, { field: field.names[1] || field.names[0], ...options });
};

/**
 * One list that can be imported.
 *
 * `files` are the names it answers to inside a zip, matched on the last part
 * of the path so `data/customers.csv` and `customers.csv` are the same thing.
 */
const KINDS = {
  customers: {
    label: "Customers",
    files: ["customers", "parties", "customer", "party"],
    fields: {
      name: F("name", "customer name", "party name"),
      businessName: F("business_name", "shop name", "firm", "trade name"),
      phone: F("phone", "mobile", "contact"),
      gstin: F("gstin", "gst number", "gst no"),
      city: F("city", "town"),
      state: F("state"),
      address: F("address"),
      notes: F("notes", "remarks"),
      openingBalance: F("opening_balance", "opening", "old balance"),
      openingBalanceOn: F("opening_balance_on", "opening balance date", "balance as on"),
      creditLimit: F("credit_limit", "limit"),
      creditPeriodDays: F("credit_period_days", "credit days", "days"),
    },
  },

  suppliers: {
    label: "Suppliers",
    files: ["suppliers", "supplier"],
    fields: {
      name: F("name", "supplier name"),
      businessName: F("business_name", "firm", "mill", "trade name"),
      phone: F("phone", "mobile", "contact"),
      gstin: F("gstin", "gst number", "gst no"),
      city: F("city", "town"),
      address: F("address"),
      notes: F("notes", "remarks"),
    },
  },

  purchases: {
    label: "Purchases",
    files: ["purchases", "purchase"],
    needs: ["suppliers"],
    fields: {
      supplier: F("supplier_name", "supplier", "from", "party"),
      supplierPhone: F("supplier_phone", "supplier mobile"),
      purchaseNumber: F("purchase_number", "our number", "entry number"),
      purchaseDate: F("purchase_date", "date"),
      supplierInvoiceNumber: F("supplier_invoice_number", "bill number", "invoice number", "bill no"),
      supplierInvoiceDate: F("supplier_invoice_date", "bill date"),
      subtotal: F("subtotal", "taxable", "taxable value"),
      discount: F("discount"),
      taxAmount: F("tax_amount", "gst", "tax"),
      total: F("total", "grand total", "amount"),
      notes: F("notes", "remarks"),
    },
  },

  purchaseLines: {
    label: "Purchase items",
    files: ["purchase-lines", "purchaselines", "purchase items", "purchase_items"],
    needs: ["purchases"],
    child: "purchases",
    fields: {
      billNumber: F("supplier_invoice_number", "bill number", "bill no"),
      purchaseNumber: F("purchase_number", "our number"),
      itemName: F("item_name", "item", "particulars", "description"),
      quantity: F("quantity", "qty"),
      unit: F("unit", "uom"),
      rate: F("rate", "price"),
      amount: F("amount", "value"),
      hsnCode: F("hsn_code", "hsn"),
      gstPercent: F("gst_percent", "gst %", "tax %"),
    },
  },

  sales: {
    label: "Sales",
    files: ["sales", "sale"],
    needs: ["customers"],
    fields: {
      customer: F("customer_name", "customer", "party", "party name", "to"),
      customerPhone: F("customer_phone", "phone", "mobile"),
      saleNumber: F("sale_number", "number", "voucher number", "bill number"),
      saleDate: F("sale_date", "date"),
      channel: F("channel", "sold through", "source"),
      subtotal: F("subtotal", "taxable", "taxable value"),
      discount: F("discount"),
      taxAmount: F("tax_amount", "gst", "tax"),
      totalCess: F("total_cess", "cess"),
      total: F("total", "grand total", "amount"),
      notes: F("notes", "remarks"),
    },
  },

  saleLines: {
    label: "Sale items",
    files: ["sale-lines", "salelines", "sale items", "sale_items"],
    needs: ["sales"],
    child: "sales",
    fields: {
      saleNumber: F("sale_number", "number", "voucher number", "bill number"),
      itemName: F("item_name", "item", "particulars", "description"),
      quantity: F("quantity", "qty"),
      unit: F("unit", "uom"),
      rate: F("rate", "price"),
      amount: F("amount", "value"),
      hsnCode: F("hsn_code", "hsn"),
      gstPercent: F("gst_percent", "gst %", "tax %"),
      cessPercent: F("cess_percent", "cess %"),
      cessAmount: F("cess_amount", "cess"),
    },
  },

  invoices: {
    label: "Old bills",
    files: ["invoices", "invoice", "bills"],
    fields: {
      invoiceNumber: F("invoice_number", "bill number", "number", "bill no"),
      issueDate: F("issue_date", "date", "invoice date", "bill date"),
      dueDate: F("due_date", "due"),
      customer: F("recipient_name", "customer_name", "customer", "party", "to"),
      customerPhone: F("customer_phone", "phone", "mobile"),
      recipientGstin: F("recipient_gstin", "customer gstin", "gstin", "gst number"),
      recipientCity: F("recipient_city", "city"),
      recipientState: F("recipient_state", "state"),
      recipientAddress: F("recipient_address", "address"),
      placeOfSupply: F("place_of_supply", "place of supply"),
      subtotal: F("subtotal"),
      discount: F("discount"),
      taxableAmount: F("taxable_amount", "taxable", "taxable value"),
      cgst: F("cgst"),
      sgst: F("sgst"),
      igst: F("igst"),
      totalTax: F("total_tax", "tax", "gst"),
      totalCess: F("total_cess", "cess"),
      roundOff: F("round_off", "round off", "rounding"),
      grandTotal: F("grand_total", "total", "amount", "bill amount"),
      paymentStatus: F("payment_status", "paid"),
      irn: F("irn"),
      notes: F("notes", "remarks"),
    },
  },

  invoiceLines: {
    label: "Old bill items",
    files: ["invoice-lines", "invoicelines", "invoice items", "invoice_items", "bill items"],
    needs: ["invoices"],
    child: "invoices",
    fields: {
      invoiceNumber: F("invoice_number", "bill number", "bill no"),
      productName: F("product_name", "item_name", "item", "particulars", "description"),
      hsnCode: F("hsn_code", "hsn"),
      quantity: F("quantity", "qty"),
      uqc: F("uqc", "unit", "uom"),
      unitPrice: F("unit_price", "rate", "price"),
      gstPercent: F("gst_percent", "gst %", "tax %"),
      taxAmount: F("tax_amount", "tax"),
      cessPercent: F("cess_percent", "cess %"),
      cessAmount: F("cess_amount", "cess"),
      total: F("total", "amount", "value"),
    },
  },
};

/**
 * Which list a file in the zip belongs to.
 *
 * Matched on the last part of the path with the extension off, so it does not
 * matter whether the person kept our folder layout, flattened the zip, or
 * renamed `customers.csv` to `Customers (1).csv` on their way out of a
 * download folder.
 */
const kindOfFile = (path) => {
  const base = String(path).split("/").pop().replace(/\.[^.]+$/, "");
  // "Customers (1)" and "customers copy" both mean customers.
  const cleaned = normaliseHeader(base.replace(/\(\d+\)|copy|final|new/gi, ""));
  for (const [key, kind] of Object.entries(KINDS)) {
    if (kind.files.some((name) => normaliseHeader(name) === cleaned)) return key;
  }
  return null;
};

/**
 * One row, read into the shape the database wants.
 *
 * Returns { ok, value } or { ok: false, errors: [...] }. EVERY problem in the
 * row is collected rather than stopping at the first, because somebody fixing
 * a spreadsheet wants the whole list, not one error per upload.
 */
const readRow = (kindKey, record, options = {}) => {
  const errors = [];
  const out = {};
  const take = (name, reader, opts = {}) => {
    const field = KINDS[kindKey].fields[name];
    const result = read(record, field, reader, opts);
    if (!result.ok) errors.push(result.reason);
    else out[name] = result.value;
  };

  const readers = {
    customers: () => {
      take("name", text, { required: true });
      take("businessName", text);
      take("phone", phone);
      take("gstin", gstin);
      take("city", text, { max: 100 });
      take("state", state);
      take("address", text, { max: 2000 });
      take("notes", text, { max: 2000 });
      take("openingBalance", money);
      take("openingBalanceOn", date);
      take("creditLimit", money);
      take("creditPeriodDays", quantity);
      // A balance without a date it was struck on is a number nobody can
      // reconcile, so one implies the other.
      if (out.openingBalance && !out.openingBalanceOn) {
        errors.push("An opening balance needs the date it was as on.");
      }
    },

    suppliers: () => {
      take("name", text, { required: true });
      take("businessName", text);
      take("phone", phone);
      take("gstin", gstin);
      take("city", text, { max: 100 });
      take("address", text, { max: 2000 });
      take("notes", text, { max: 2000 });
    },

    purchases: () => {
      take("supplier", text, { required: true });
      take("supplierPhone", phone);
      take("purchaseNumber", text, { max: 50 });
      take("purchaseDate", date);
      take("supplierInvoiceNumber", text, { max: 50 });
      take("supplierInvoiceDate", date);
      take("subtotal", money);
      take("discount", money);
      take("taxAmount", money);
      take("total", money);
      take("notes", text, { max: 2000 });
      if (out.total === null && out.subtotal === null) {
        errors.push("A purchase needs a total, or a taxable value to add tax to.");
      }
    },

    purchaseLines: () => {
      take("billNumber", text, { max: 50 });
      take("purchaseNumber", text, { max: 50 });
      take("itemName", text, { required: true });
      take("quantity", quantity);
      take("unit", text, { max: 20 });
      take("rate", money);
      take("amount", money);
      take("hsnCode", hsn, { minDigits: options.minHsnDigits });
      take("gstPercent", percent);
      if (!out.billNumber && !out.purchaseNumber) {
        errors.push("An item needs the bill number it belongs to.");
      }
    },

    sales: () => {
      take("customer", text, { required: true });
      take("customerPhone", phone);
      take("saleNumber", text, { max: 50 });
      take("saleDate", date);
      take("channel", channel);
      take("subtotal", money);
      take("discount", money);
      take("taxAmount", money);
      take("totalCess", money);
      take("total", money);
      take("notes", text, { max: 2000 });
      if (out.total === null && out.subtotal === null) {
        errors.push("A sale needs a total, or a taxable value to add tax to.");
      }
    },

    saleLines: () => {
      take("saleNumber", text, { required: true, max: 50 });
      take("itemName", text, { required: true });
      take("quantity", quantity);
      take("unit", text, { max: 20 });
      take("rate", money);
      take("amount", money);
      take("hsnCode", hsn, { minDigits: options.minHsnDigits });
      take("gstPercent", percent);
      take("cessPercent", percent);
      take("cessAmount", money);
    },

    invoices: () => {
      take("invoiceNumber", text, { required: true, max: 50 });
      take("issueDate", date);
      take("dueDate", date);
      take("customer", text);
      take("customerPhone", phone);
      take("recipientGstin", gstin);
      take("recipientCity", text, { max: 100 });
      take("recipientState", state);
      take("recipientAddress", text, { max: 2000 });
      take("placeOfSupply", state);
      take("subtotal", money);
      take("discount", money);
      take("taxableAmount", money);
      take("cgst", money);
      take("sgst", money);
      take("igst", money);
      take("totalTax", money);
      take("totalCess", money);
      take("roundOff", money);
      take("grandTotal", money);
      take("paymentStatus", text, { max: 50 });
      take("irn", text, { max: 64 });
      take("notes", text, { max: 2000 });

      if (!out.issueDate) errors.push("An old bill needs the date it was issued.");
      if (out.grandTotal === null) errors.push("An old bill needs its total.");

      /**
       * An IRN is refused, and this is the important one.
       *
       * An IRN and its signed QR are issued by the Invoice Registration Portal
       * against a submission. Accepting one out of a spreadsheet would put a
       * number on a document claiming a registration this system never made
       * and cannot verify, and the QR is a signature we would be storing
       * without the thing it signs. A bill that really has an IRN already
       * exists on the portal, and that is where it is proved.
       */
      if (out.irn) {
        errors.push(
          "This bill carries an IRN. A bill that has already been registered cannot be brought in here, because its registration cannot be checked from a spreadsheet. Leave the IRN column empty to bring in the bill as a record.",
        );
      }

      // Both halves of an intra-state split, or neither. One alone is a bill
      // that adds up to the wrong tax on a legal document.
      const half = (v) => v !== null && v !== undefined;
      if (half(out.cgst) !== half(out.sgst)) {
        errors.push("A bill has CGST and SGST together, or neither. This one has one of them.");
      }
      if (half(out.igst) && (half(out.cgst) || half(out.sgst))) {
        errors.push("A bill is either IGST, or CGST plus SGST. This one has both.");
      }
    },

    invoiceLines: () => {
      take("invoiceNumber", text, { required: true, max: 50 });
      take("productName", text, { required: true });
      take("hsnCode", hsn, { minDigits: options.minHsnDigits });
      take("quantity", quantity);
      take("uqc", text, { max: 20 });
      take("unitPrice", money);
      take("gstPercent", percent);
      take("taxAmount", money);
      take("cessPercent", percent);
      take("cessAmount", money);
      take("total", money);
    },
  };

  readers[kindKey]();
  if (errors.length) return { ok: false, errors, line: record.__line };
  return { ok: true, value: out, line: record.__line };
};

module.exports = {
  KINDS,
  kindOfFile,
  readRow,
  money,
  quantity,
  percent,
  date,
  gstin,
  phone,
  text,
  state,
  channel,
  stateCode,
};
