// Which state each side is in, and therefore CGST plus SGST against IGST,
// is now one question asked in one place. See placeOfSupply.js: it reads a
// declared state first, then the state the GST number itself carries, and
// only then falls back to looking a city up.
const placeOfSupply = require("./placeOfSupply");

/**
 * The two sides of a bill, as this service wants them.
 *
 * A caller may pass a string, which is what every caller used to pass and
 * what a lot of stored data still looks like. A string is read as "whatever
 * you have": it could be a state, it could be a city, and placeOfSupply
 * works out which. An object is better, because a GST number settles the
 * question outright.
 */
const asPlace = (value) => {
  if (!value) return {};
  if (typeof value === "string") return { city: value, state: value };
  return value;
};

class GSTService {
  /**
   * Same state, so CGST plus SGST, or different states, so IGST?
   *
   * Either side may be a plain place name or an object carrying a GST number.
   * The defaults are gone: this used to fall back to "Delhi" on both sides,
   * which reached the right answer for a local sale by asserting a location
   * nobody had given it.
   */
  isIntraState(supplier, buyer) {
    return placeOfSupply.isIntraState(asPlace(supplier), asPlace(buyer));
  }

  /** Which state a side is in, and what told us. Null when nothing did. */
  placeOf(value) {
    return placeOfSupply.resolveState(asPlace(value));
  }

  /**
   * Computes GST tax breakdown for line items and invoice summary.
   * Handles tax-inclusive and tax-exclusive pricing mode.
   * Returns itemized breakdown and grand totals with currency rounding.
   */
  calculateGST({
    items = [],
    discount = 0.00,
    shippingCharge = 0.00,
    // A place name, or an object like { state, gstin, city }. No default:
    // "we were not told" has to stay distinguishable from "Delhi".
    supplierLocation = null,
    buyerLocation = null,
    isTaxInclusive = false,
  }) {
    const supplierPlace = this.placeOf(supplierLocation);
    const buyerPlace = this.placeOf(buyerLocation);
    const intraState = this.isIntraState(supplierLocation, buyerLocation);
    let subtotal = 0;
    let totalTax = 0;
    let totalCess = 0;

    // A discount reduces the taxable value, so it has to reduce the tax with
    // it. The tax used to be worked out line by line on the full amount and
    // the discount taken off afterwards, which charged GST on money the
    // customer was never asked for. It went unnoticed while nothing set a
    // discount; a sale can, and now that a sale computes its own tax the two
    // would have disagreed with each other.
    //
    // Spread across the lines in proportion, because lines can be taxed at
    // different rates and a lump discount belongs to all of them.
    const grossTaxable = items.reduce((sum, item) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const gstPercent = Number(item.gstPercent ?? 18.0);
      const cessPercent = Number(item.cessPercent ?? 0);
      const line = unitPrice * qty;
      // Both levies come out of a tax inclusive price, not just the GST. Divide
      // by the GST alone and the taxable value lands high, the cess is charged
      // on a figure that was never the taxable value, and the gross the
      // customer agreed to moves.
      return sum + (isTaxInclusive ? line / (1 + (gstPercent + cessPercent) / 100) : line);
    }, 0);
    const netDiscountRequested = Math.max(0, Number(discount) || 0);
    const taxedShare =
      grossTaxable > 0
        ? Math.max(0, 1 - Math.min(netDiscountRequested, grossTaxable) / grossTaxable)
        : 1;

    const processedItems = items.map((item) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const gstPercent = Number(item.gstPercent ?? 18.00);
      // No invented HSN. This used to default to 8504, which is the code for
      // electrical transformers, so a bill for cotton shirting went out
      // declaring it as transformers. A blank HSN on a tax document is a gap
      // the wholesaler can fill in; a wrong one is a false statement.
      const hsnCode = item.hsnCode || null;

      /**
       * Cess is an ADDITIONAL LEVY on the same taxable value as the GST, not a
       * share of it. 18 per cent GST plus 12 per cent cess is 30 per cent of
       * the taxable value.
       *
       * It follows the pricing mode exactly as the GST does, and that is the
       * whole reason the money path does not come apart:
       *
       *   tax exclusive, a counter sale. The rate quoted is before tax, so
       *   every levy goes on top and the line total grows by the cess.
       *
       *   tax inclusive, a shop order. The price on the shop page is what the
       *   customer pays, so the cess comes OUT of it alongside the GST and the
       *   line total does not move. If cess were added on top here, the buyer
       *   would have agreed one figure at checkout, the bill would say another,
       *   and the khata would say a third.
       */
      const cessPercent = Number(item.cessPercent ?? 0);

      let lineTaxable = 0;
      let lineTaxAmount = 0;
      let lineCessAmount = 0;
      let lineTotal = 0;

      if (isTaxInclusive) {
        // Price includes tax: Taxable = Total / (1 + Rate/100)
        //
        // The tax is the remainder, not the rate applied again. Recomputing
        // it left the two halves a paisa short of the price they were split
        // out of, so a sale of 3550 billed at 3549.99.
        //
        // With cess the remainder covers both levies, so it is split between
        // them in proportion to their rates. Taking the GST out first and
        // calling the rest cess would put the rounding paisa in whichever one
        // happened to be computed second.
        lineTotal = Number((unitPrice * qty).toFixed(2));
        lineTaxable = Number((lineTotal / (1 + (gstPercent + cessPercent) / 100)).toFixed(2));
        const levies = Number(((lineTotal - lineTaxable) * taxedShare).toFixed(2));
        if (cessPercent > 0 && gstPercent + cessPercent > 0) {
          lineTaxAmount = Number((levies * (gstPercent / (gstPercent + cessPercent))).toFixed(2));
          // The remainder, so the two always add back to the levies exactly.
          lineCessAmount = Number((levies - lineTaxAmount).toFixed(2));
        } else {
          lineTaxAmount = levies;
          lineCessAmount = 0;
        }
      } else {
        // Price excludes tax: Taxable = UnitPrice * Qty
        lineTaxable = Number((unitPrice * qty).toFixed(2));
        lineTaxAmount = Number(((lineTaxable * taxedShare * gstPercent) / 100).toFixed(2));
        lineCessAmount = Number(((lineTaxable * taxedShare * cessPercent) / 100).toFixed(2));
        lineTotal = Number((lineTaxable + lineTaxAmount + lineCessAmount).toFixed(2));
      }

      subtotal += lineTaxable;
      totalTax += lineTaxAmount;
      totalCess += lineCessAmount;

      return {
        productId: item.productId || item.product_id || null,
        productName: item.productName || item.product_name || "Wholesale Product",
        hsnCode,
        quantity: qty,
        unitPrice,
        gstPercent,
        cessPercent,
        taxAmount: lineTaxAmount,
        cessAmount: lineCessAmount,
        total: lineTotal,
      };
    });

    const netSubtotal = Number(subtotal.toFixed(2));
    const netDiscount = Number(Number(discount).toFixed(2));
    const netShipping = Number(Number(shippingCharge).toFixed(2));

    const taxableAmount = Math.max(0, Number((netSubtotal - netDiscount + netShipping).toFixed(2)));
    const netTotalTax = Number(totalTax.toFixed(2));
    // Its own total, because it is its own levy. It does not come out of the
    // GST and it is not part of it on the document or in the return.
    const netTotalCess = Number(totalCess.toFixed(2));

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (intraState) {
      // Intra-state: Split tax equally into CGST & SGST
      cgst = Number((netTotalTax / 2).toFixed(2));
      sgst = Number((netTotalTax - cgst).toFixed(2)); // handle odd paise rounding
      igst = 0.00;
    } else {
      // Inter-state: All tax goes to IGST
      cgst = 0.00;
      sgst = 0.00;
      igst = netTotalTax;
    }

    const rawGrandTotal = taxableAmount + netTotalTax + netTotalCess;
    const roundedGrandTotal = Math.round(rawGrandTotal * 100) / 100;
    const roundOff = Number((roundedGrandTotal - rawGrandTotal).toFixed(2));

    return {
      subtotal: netSubtotal,
      discount: netDiscount,
      shippingCharge: netShipping,
      taxableAmount,
      cgst,
      sgst,
      igst,
      totalTax: netTotalTax,
      totalCess: netTotalCess,
      roundOff,
      grandTotal: roundedGrandTotal,
      isIntraState: intraState,
      // Which states this was worked out between, and what said so. Kept on
      // the result so a caller can put it on the bill or say why it split the
      // tax the way it did, instead of working it out a second time.
      supplierState: supplierPlace.state,
      buyerState: buyerPlace.state,
      placeOfSupplyFrom: { supplier: supplierPlace.from, buyer: buyerPlace.from },
      items: processedItems,
    };
  }
}

module.exports = new GSTService();
