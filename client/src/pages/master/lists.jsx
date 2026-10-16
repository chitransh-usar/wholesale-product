import MasterList from "./MasterList";

/**
 * The four administration lists, as data.
 *
 * Same shape as the server's LISTS map and for the same reason: four screens
 * that each keep their own copy of "validate, save, refresh" is how three of
 * them end up behaving slightly differently from the fourth.
 *
 * The validation lives on the server. What is here is labels, hints and what
 * a blank row looks like, so a person filling one in knows what is wanted
 * before they are told no.
 */

const SPECS = {
  states: {
    list: "states",
    field: "states",
    key: "code",
    title: "States",
    singular: "State",
    blurb:
      "The two digit code at the front of every GSTIN. It is what decides whether a bill charges CGST and SGST or IGST, so it is a number on a legal document rather than a label.",
    columns: [{ field: "code" }, { field: "name" }],
    fields: [
      { name: "code", label: "GST code", hint: "Exactly two digits, like 24 for Gujarat.", fixedOnEdit: true },
      { name: "name", label: "Name" },
      { name: "isUnionTerritory", label: "Union territory", type: "checkbox", hint: "Recorded, not yet used: nothing computes UTGST." },
    ],
    blank: () => ({ code: "", name: "", isUnionTerritory: false, active: true }),
    toDraft: (r) => ({ code: r.code, name: r.name, isUnionTerritory: Boolean(r.isUnionTerritory), active: r.active !== false }),
    primary: (r) => `${r.code}  ${r.name}`,
    secondary: (r) => (r.isUnionTerritory ? "Union territory" : "State"),
  },

  units: {
    list: "units",
    field: "units",
    key: "code",
    title: "Units",
    singular: "Unit",
    blurb:
      "How goods are counted. Cloth by the metre, oil by the litre, and a wholesaler who sells in bales needs the word bale. Each one also needs the GST code it is filed as, which is the UQC.",
    columns: [{ field: "code" }, { field: "name" }],
    fields: [
      { name: "code", label: "Code", hint: "What is stored and shown on a bill, like mtr.", fixedOnEdit: true },
      { name: "name", label: "Name", hint: "What a person reads, like Metre." },
      {
        name: "uqc",
        label: "GST code (UQC)",
        type: "select",
        optionsFrom: "uqcCodes",
        blankLabel: "Not decided yet",
        hint: "What this unit is filed as on an e-invoice, an e-way bill and in the HSN summary of GSTR-1. Leave it blank until you are sure. OTH means the unit has no standard code, which is an answer to choose rather than one to fall back on.",
      },
      { name: "allowsDecimals", label: "Allows fractions", type: "checkbox", hint: "2.5 metres makes sense; 2.5 pieces does not." },
      { name: "sortOrder", label: "Order in the list", type: "number", hint: "Lower comes first." },
    ],
    blank: () => ({ code: "", name: "", uqc: "", allowsDecimals: true, sortOrder: 0, active: true }),
    toDraft: (r) => ({ code: r.code, name: r.name, uqc: r.uqc || "", allowsDecimals: r.allowsDecimals !== false, sortOrder: 0, active: r.active !== false }),
    primary: (r) => `${r.name} (${r.code})`,
    secondary: (r) =>
      [
        r.uqc ? `UQC ${r.uqc}` : "UQC not set",
        r.allowsDecimals === false ? "Whole numbers only" : "Fractions allowed",
      ].join("  |  "),
  },

  "tax-terms": {
    list: "tax-terms",
    field: "taxTerms",
    key: "code",
    title: "Tax terms",
    singular: "Tax term",
    blurb:
      "A named combination a bill line can be charged under, so nobody types a rate. Enter the GST and CGST and SGST are half of it each, which is what happens inside one state. Cess is separate: it is charged on the same taxable value, ON TOP of the GST, not out of it.",
    columns: [{ field: "code" }, { field: "label" }],
    fields: [
      { name: "code", label: "Code", hint: "Short and fixed, like GST18. Used by the system, not shown on a bill.", fixedOnEdit: true },
      { name: "label", label: "Name", hint: "What a person picks from a list." },
      { name: "igstPercent", label: "GST (%)", type: "number", hint: "The full rate. Inside one state it splits into CGST and SGST, half each." },
      {
        name: "cessPercent",
        label: "Cess (%)",
        type: "number",
        hint: "On top of the GST, on the same value. Leave blank for the great majority of goods, which carry none. 18 plus 12 means the customer pays 30 per cent, not 18 split three ways.",
      },
      { name: "sortOrder", label: "Order in the list", type: "number", hint: "Lower comes first." },
    ],
    blank: () => ({ code: "", label: "", igstPercent: 18, cessPercent: "", sortOrder: 0, active: true }),
    toDraft: (r) => ({
      code: r.code,
      label: r.label,
      igstPercent: r.igstPercent,
      cessPercent: r.cessPercent ? r.cessPercent : "",
      sortOrder: 0,
      active: r.active !== false,
    }),
    primary: (r) => r.label || r.code,

    /**
     * The rate, as a figure, on the left.
     *
     * A tax term IS a number. Eight of them written as "GST 0.25% | CGST
     * 0.13% + SGST 0.12% within a state | no cess" read as a wall, because the
     * only thing that differs between the rows is buried in the middle of a
     * sentence that repeats itself. The figure is what somebody scans for.
     */
    lead: (r) => ({
      value: `${r.igstPercent}%`,
      note: Number(r.cessPercent) > 0 ? `+${r.cessPercent}` : null,
    }),

    /**
     * Cess is marked, its absence is not.
     *
     * Almost every term carries none, so "no cess" on every row is one rule
     * written out eight times rather than eight facts. The row that HAS cess
     * is the unusual one and the one that is dangerous to pick by mistake, so
     * that is the one that gets a mark.
     */
    tag: (r) => (Number(r.cessPercent) > 0 ? `+ ${r.cessPercent}% cess` : null),

    /**
     * The quiet line. What the rate does, not a restatement of the rate.
     *
     * The halves come from the ROW, not from dividing by two. They are usually
     * the same thing and at 0.25 per cent they are not: the stored split is
     * 0.13 and 0.12, because a half of a quarter per cent does not land on a
     * figure a bill can carry. Computing it here printed 0.125 and 0.125,
     * which adds up correctly and is not what the system charges.
     */
    secondary: (r) => {
      const cgst = r.cgstPercent ?? r.igstPercent / 2;
      const sgst = r.sgstPercent ?? r.igstPercent / 2;
      if (!Number(r.igstPercent) && !Number(r.cessPercent)) {
        return "No tax is charged on a line at this rate";
      }
      const split = `Splits ${cgst}% + ${sgst}% inside one state`;
      return Number(r.cessPercent) > 0
        ? `${split}. The cess is on top, so the customer pays ${Number(r.igstPercent) + Number(r.cessPercent)}%.`
        : split;
    },
  },

  "tax-rates": {
    list: "tax-rates",
    field: "taxRates",
    key: "rate",
    title: "Tax rates",
    singular: "Tax rate",
    blurb:
      "The GST slabs actually in force. A fixed list rather than a free number box, because a rate that is not a real slab is a rejected return later.",
    columns: [{ field: "rate" }, { field: "label" }],
    fields: [
      { name: "rate", label: "Rate (%)", type: "number", hint: "0, 0.25, 3, 5, 12, 18 and 28 are the real slabs.", fixedOnEdit: true },
      { name: "label", label: "Label", hint: "What a person picks from a list." },
    ],
    blank: () => ({ rate: "", label: "", active: true }),
    toDraft: (r) => ({ rate: r.rate, label: r.label, active: r.active !== false }),
    primary: (r) => r.label || `GST ${r.rate}%`,
    secondary: (r) => `${r.rate}%`,
  },

  hsn: {
    list: "hsn",
    field: "hsn",
    key: "code",
    title: "HSN codes",
    singular: "HSN code",
    blurb:
      "What the goods ARE on a tax bill, and what the customer claims their input credit against. Codes and descriptions only: nothing here maps a code to a GST rate, because rates change and the same heading carries several by price slab.",
    columns: [{ field: "code" }, { field: "label" }],
    fields: [
      { name: "code", label: "Code", hint: "4, 6 or 8 digits. Six is required above 5 crore turnover.", fixedOnEdit: true },
      { name: "description", label: "What the goods are" },
    ],
    blank: () => ({ code: "", description: "", active: true }),
    toDraft: (r) => ({ code: r.code, description: r.label, active: r.active !== false }),
    primary: (r) => `${r.code}  ${r.label}`,
    secondary: () => "Listed as common, not as verified",
  },
};

export const MasterStates = () => <MasterList spec={SPECS.states} />;
export const MasterUnits = () => <MasterList spec={SPECS.units} />;
export const MasterTaxRates = () => <MasterList spec={SPECS["tax-rates"]} />;
export const MasterTaxTerms = () => <MasterList spec={SPECS["tax-terms"]} />;
export const MasterHsn = () => <MasterList spec={SPECS.hsn} />;

export default SPECS;
