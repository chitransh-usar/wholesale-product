/**
 * The units and tax rates a product can carry.
 *
 * These were copied into two screens and were about to be copied into a
 * third. They have to agree with the server, which validates the unit against
 * the same list in itemController, so one copy on this side is one fewer place
 * for the two to drift apart.
 */

// value is what the database stores. label is what a trader reads, which is
// not always the same word: "mtr" is what fits in a table cell, "Metre" is
// what someone picking from a list expects to see.
export const UNITS = [
  { value: "pcs", label: "Pieces (pcs)" },
  { value: "dozen", label: "Dozen" },
  { value: "case", label: "Case" },
  { value: "mtr", label: "Metre (mtr)" },
  { value: "kg", label: "Kilogram (kg)" },
  { value: "box", label: "Box" },
  { value: "bundle", label: "Bundle" },
];

// Just the stored values, for the screens that only need to check one.
export const UNIT_VALUES = UNITS.map((u) => u.value);

/**
 * The GST slabs in force in India.
 *
 * A fixed list rather than a free number box, because a rate that is not a
 * real slab is a rejected return later. 0.25 and 3 are narrow but real: rough
 * diamonds sit at 0.25, gold and silver at 3.
 */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
