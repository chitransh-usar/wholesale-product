const pool = require("../config/db");
const invoiceRepository = require("../repositories/invoiceRepository");
const invoiceNumberService = require("./invoiceNumberService");
const gstService = require("./gstService");
const challanService = require("./challanService");
const { placeOfSupply, stateCode } = require("./placeOfSupply");
const { checkHsn, minHsnDigits } = require("./hsnService");
const { clean, fullName } = require("../utils/money");

/**
 * The delivery address on an order, as one line for the bill.
 *
 * Stored as JSON from the checkout form, whose shape is house, street, area,
 * city, state, pincode. Only the street part is wanted here, because the city,
 * state and pincode are their own columns on the invoice and repeating them
 * inside the address line prints them twice.
 *
 * Returns null rather than an empty string when there is nothing, so the
 * caller's fallback to the profile address actually fires.
 */
const addressLine = (address) => {
  if (!address || typeof address !== "object") return null;
  const parts = [address.house, address.street, address.area]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  // Older orders stored a single `address` string instead of the parts.
  if (parts.length === 0 && address.address) return String(address.address).trim() || null;
  return parts.length ? parts.join(", ") : null;
};
const { toInvoiceFields } = require("./transportDetails");
const { resolveChannel } = require("./salesChannels");
const pdfService = require("./pdfService");
const emailService = require("./emailService");

class InvoiceService {
  /**
   * Automatically creates an invoice record from an existing order upon order confirmation or payment completion.
   */
  async createInvoiceFromOrder(orderId, externalClient = null) {
    // Check if invoice already exists for this order
    const existing = await invoiceRepository.findInvoiceByOrderId(orderId);
    if (existing) {
      return existing;
    }

    const client = externalClient || (await pool.connect());
    const shouldManageTransaction = !externalClient;

    try {
      if (shouldManageTransaction) await client.query("BEGIN");

      /**
       * One order, one invoice, even when two callers ask at once.
       *
       * The check above is a read outside any lock, so two calls arriving
       * together both saw nothing and both created. There is no unique index
       * on invoices.order_id to stop them (there is one on sale_id, which is
       * how the sales side avoids this), so the order genuinely ended up with
       * two invoice numbers, each with its own share of the payments.
       *
       * The lock is held to the end of this transaction and keyed on the
       * order, so it blocks only the second caller for this same order. The
       * re-read after it is the point: by then the first caller has committed
       * and this one returns the invoice it made.
       *
       * migrations/wholesale3_one_invoice_per_order.sql adds the index that
       * makes this belt and braces. Until it has been run, this is the belt.
       */
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [orderId],
      );
      const raced = await invoiceRepository.findInvoiceByOrderId(orderId);
      if (raced) {
        if (shouldManageTransaction) await client.query("ROLLBACK");
        return raced;
      }

      /**
       * The same goods can also be billed from the other side.
       *
       * An accepted order writes a sale, and the wholesaler can press "raise
       * bill" on that sale. That invoice carries a sale_id and no order_id, so
       * the check above did not see it, and this method went on to raise a
       * second one: one lot of goods, two invoice numbers, and two rows in the
       * invoices tab under two different names.
       *
       * saleInvoiceService closes the other direction by adopting this
       * invoice when it already exists. This is the same guard the other way
       * round, for the ordering where the sale is billed first. Both take this
       * advisory lock on the order, so one of them always waits for the other
       * rather than both reading "nothing yet".
       */
      const bridged = await invoiceRepository.schemaExtras();
      const billedAsSale = bridged.has_sale_id && bridged.has_sale_order_id
        ? await client.query(
            `SELECT i.* FROM invoices i
               JOIN sales s ON s.id = i.sale_id
              WHERE s.order_id = $1
              LIMIT 1`,
            [orderId],
          )
        : { rows: [] };
      if (billedAsSale.rows.length > 0) {
        // Point it at the order too, so a later reconcile finds it by either
        // road and the payments land on one document.
        const linked = await client.query(
          "UPDATE invoices SET order_id = $2 WHERE id = $1 RETURNING *",
          [billedAsSale.rows[0].id, orderId],
        );
        if (shouldManageTransaction) await client.query("COMMIT");
        return linked.rows[0];
      }

      // Fetch order metadata along with buyer and supplier profiles
      const orderQuery = `
        SELECT 
          o.id, o.order_number, o.buyer_id, o.supplier_id, o.total_amount,
          o.subtotal, o.status, o.payment_status, o.amount_paid, o.created_at, o.delivery_address,
          ${bridged.has_order_transport
            ? `o.transporter_name, o.transporter_id, o.transport_mode, o.vehicle_number,
               o.transport_doc_number, o.transport_doc_date, o.gr_number, o.gr_date,`
            : ""}
          bu.first_name AS buyer_first_name, bu.last_name AS buyer_last_name, bu.email AS buyer_email,
          bu.phone AS buyer_phone,
          bwp.company_name AS buyer_company, bwp.gstin AS buyer_gstin, bwp.city AS buyer_city,
          bwp.warehouse_state AS buyer_state, bwp.warehouse_address AS buyer_address,
          su.first_name AS supplier_first_name, su.last_name AS supplier_last_name, su.email AS supplier_email,
          swp.company_name AS supplier_company, swp.gstin AS supplier_gstin, swp.upi_id AS supplier_upi_id,
          swp.warehouse_state AS supplier_state,
          COALESCE(NULLIF(swp.warehouse_city, ''), swp.city) AS supplier_city
        FROM orders o
        JOIN users bu ON o.buyer_id = bu.id
        LEFT JOIN wholesaler_profiles bwp ON bu.id = bwp.user_id
        JOIN users su ON o.supplier_id = su.id
        LEFT JOIN wholesaler_profiles swp ON su.id = swp.user_id
        WHERE o.id = $1
      `;
      const orderResult = await client.query(orderQuery, [orderId]);
      if (orderResult.rows.length === 0) {
        throw new Error("Order not found for automatic invoice creation");
      }
      const order = orderResult.rows[0];

      /**
       * A tax invoice only once the money is in, on this side too.
       *
       * Checkout calls this in the background the moment an order is placed,
       * so without this an unpaid order would be invoiced within a second of
       * being created and the rule asked for on 10 Sept would only hold on
       * the sales book side.
       *
       * Not an error: an unpaid order having no bill yet is the intended
       * state, and the caller ignores the return anyway. When the money
       * lands, reconcileInvoiceForOrder calls back in here and the invoice is
       * raised then.
       *
       * Behind the same flag. See challanService.js for why this rule is not
       * what section 31(1) says.
       */
      if (challanService.invoiceWaitsForPayment() && await challanService.challanTablesExist(client)) {
        const total = Number(order.total_amount || 0);
        const paid = Number(order.amount_paid || 0);
        if (total > 0 && paid < total - 0.01) {
          if (shouldManageTransaction) await client.query("ROLLBACK");
          return null;
        }
      }

      // Fetch order line items
      const itemsQuery = `
        SELECT 
          oi.product_id, oi.product_name, oi.quantity, oi.unit_price, oi.total_price
        FROM order_items oi
        WHERE oi.order_id = $1
      `;
      const itemsResult = await client.query(itemsQuery, [orderId]);
      const orderItems = itemsResult.rows;

      // pg hands back jsonb already parsed, but an older row may hold a string.
      let deliveryAddress = order.delivery_address || null;
      if (typeof deliveryAddress === "string") {
        try { deliveryAddress = JSON.parse(deliveryAddress); } catch { deliveryAddress = null; }
      }

      // Where each side sits, for CGST plus SGST against IGST. The GST number
      // goes along with the address because the first two digits of a GSTIN
      // are the state, which beats reading a city off a profile.
      const supplierLocation = {
        state: order.supplier_state,
        gstin: order.supplier_gstin,
        city: order.supplier_city,
      };
      // The declared state goes in on the buyer's side too. It was selected
      // for the supplier and not for the buyer, out of the same table, so the
      // first and strongest source placeOfSupply asks for was never given for
      // half the bill: a buyer who had set their state and had no GST number
      // was placed by the city map, or nowhere.
      const buyerLocation = {
        state: order.buyer_state,
        gstin: order.buyer_gstin,
        city: order.buyer_city,
      };

      // The seller's own defaults, falling back to platform values.
      const settings = await invoiceRepository.getSettings(order.supplier_id);

      const gstCalculation = gstService.calculateGST({
        items: orderItems.map((item) => ({
          productId: item.product_id,
          productName: item.product_name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          gstPercent: settings.defaultTaxRate,
          // Marketplace orders carry no HSN, so the line goes out blank
          // rather than declaring every product as electrical transformers.
          hsnCode: item.hsn_code || null,
        })),
        discount: 0.00,
        shippingCharge: 0.00,
        supplierLocation,
        buyerLocation,
        /**
         * The shop price is the whole price.
         *
         * A buyer who saw 142 a metre and pressed pay was charged 2100 for
         * ten metres and a dupatta, and that is all they will ever be asked
         * for. Adding tax on top here made the bill say 2205: the customer
         * had already paid in full and the invoice asked them for 105 more,
         * and the customer page and the bill disagreed by exactly the tax.
         *
         * So the tax comes out of the price rather than going on top. The
         * wholesaler still declares and remits the same GST; it is taken from
         * what they collected instead of being billed afterwards.
         *
         * This is the opposite of a hand written sale, where the rate a
         * wholesaler quotes is understood to be before tax. The difference is
         * real and not an inconsistency to tidy away: a rate quoted across a
         * counter is pre-tax, and a price on a shop page is what you pay.
         */
        isTaxInclusive: true,
      });

      // Sequential within this wholesaler's own run, not the platform's.
      const pos = placeOfSupply(buyerLocation);

      const invoiceNumber = await invoiceNumberService.generateInvoiceNumber(
        client,
        settings.prefix,
        null,
        order.supplier_id,
        // An order placed on this marketplace is the shop channel, by
        // definition. Nobody chooses it.
        { suffix: settings.numberSuffix, padTo: settings.numberPadTo, channel: "shop" },
      );

      const issueDate = new Date();
      const dueDate = new Date();
      dueDate.setDate(issueDate.getDate() + settings.dueDays);

      // Determine initial invoice and payment status
      const initialPaymentStatus = order.payment_status === "paid" || order.payment_status === "completed" ? "Paid" : "Pending";
      const initialInvoiceStatus = initialPaymentStatus === "Paid" ? "Paid" : "Generated";

      const invoiceData = {
        invoiceNumber,
        orderId: order.id,
        buyerId: order.buyer_id,
        supplierId: order.supplier_id,
        subtotal: gstCalculation.subtotal,
        discount: gstCalculation.discount,
        shippingCharge: gstCalculation.shippingCharge,
        taxableAmount: gstCalculation.taxableAmount,
        cgst: gstCalculation.cgst,
        sgst: gstCalculation.sgst,
        igst: gstCalculation.igst,
        totalTax: gstCalculation.totalTax,
        grandTotal: gstCalculation.grandTotal,
        totalCess: gstCalculation.totalCess,
        placeOfSupply: pos.state,
        placeOfSupplyCode: pos.code,
        supplierState: gstCalculation.supplierState,
        reverseCharge: false,
        roundOff: gstCalculation.roundOff,
        paymentStatus: initialPaymentStatus,
        invoiceStatus: initialInvoiceStatus,
        issueDate,
        dueDate,
        notes: `Invoice generated for Order ${order.order_number || order.id}`,
        termsConditions: settings.defaultTerms,
        pdfUrl: `/api/invoices/by-order/${order.id}/pdf`,

        /**
         * Who the bill was made out to, frozen.
         *
         * This path stored none of it and joined the buyer's profile at read
         * time, so a bill reprinted after the customer changed their firm name
         * or moved showed today's details on a document issued months ago. The
         * sale path has always snapshotted these. All three roads now do.
         *
         * The delivery address on the order is preferred, because that is the
         * address the customer actually gave for THIS order, and it is what the
         * goods were sent to.
         */
        recipientName: order.buyer_company
          || fullName(order.buyer_first_name, order.buyer_last_name) || null,
        recipientGstin: order.buyer_gstin || null,
        recipientCity: deliveryAddress?.city || order.buyer_city || null,
        recipientAddress: addressLine(deliveryAddress) || order.buyer_address || null,
        recipientPhone: deliveryAddress?.phone || order.buyer_phone || null,
        recipientState: pos.state,
        recipientStateCode: pos.code,
        recipientPincode: deliveryAddress?.pincode || null,

        // Usually empty, because a shop order raises its bill the moment the
        // order is placed and nothing has been loaded yet. Carried anyway for
        // the case where a bill is made after despatch, such as a reconcile,
        // so this path behaves the same as the sale path rather than being the
        // one that quietly drops it.
        ...toInvoiceFields(order),
        channel: "shop",
      };

      const createdInvoice = await invoiceRepository.createInvoice(
        invoiceData,
        gstCalculation.items,
        client
      );

      // Log invoice creation
      await invoiceRepository.addLog(
        {
          invoiceId: createdInvoice.id,
          action: "Created",
          performedBy: order.buyer_id,
          details: `Invoice ${invoiceNumber} created automatically from Order ${order.order_number || order.id}`,
        },
        client
      );

      // Goods may already have gone out on one or more challans while the
      // money was outstanding. Point them at the bill that superseded them,
      // so they stop reading as open. The sale side has always done this; this
      // side never did, so a challan raised against an order sat in "Not
      // billed yet" for ever.
      await challanService.markInvoicedForOrder(client, order.id, createdInvoice.id);

      // If already paid, record initial payment entry
      if (initialPaymentStatus === "Paid") {
        await invoiceRepository.addPayment(
          {
            invoiceId: createdInvoice.id,
            amount: gstCalculation.grandTotal,
            paymentMethod: "UPI",
            remarks: "Initial payment completed at checkout",
          },
          client
        );

        await invoiceRepository.addLog(
          {
            invoiceId: createdInvoice.id,
            action: "Paid",
            performedBy: order.buyer_id,
            details: `Invoice marked as Paid via initial checkout transaction`,
          },
          client
        );
      }

      if (shouldManageTransaction) await client.query("COMMIT");

      // Generate & Cache PDF on disk, then send invoice email asynchronously
      this.generateAndSendInvoiceEmailAsync(createdInvoice.id, order.buyer_email);

      return createdInvoice;
    } catch (error) {
      if (shouldManageTransaction) await client.query("ROLLBACK");
      console.error("Error creating invoice from order:", error);
      throw error;
    } finally {
      if (shouldManageTransaction) client.release();
    }
  }

  /**
   * Brings an order's invoice in line with what the order actually says.
   *
   * createInvoiceFromOrder only ever creates: it returns early when an invoice
   * already exists. Since an invoice is raised the moment the order is placed
   * - while payment is still pending - paying afterwards left the invoice on
   * Pending forever, and the PDF kept stamping UNPAID over money that had
   * already been received.
   *
   * This is the call the payment path wants. It is idempotent: safe to run on
   * every payment event, and safe to run again over rows that are already
   * correct, which is what makes the backfill migration possible.
   *
   * Part payments count. This used to wait for the whole amount, so a buyer on
   * the 50/50 plan who had paid their first instalment looked, on their own bill,
   * exactly like a buyer who had paid nothing: no entry, no date, no amount,
   * and an UNPAID stamp over the PDF. They had a receipt on the order screen and
   * a bill that disagreed with it. The invoice now mirrors what the order says
   * has been received, instalment by instalment.
   */
  async reconcileInvoiceForOrder(orderId, retried = false) {
    const invoice = await invoiceRepository.findInvoiceByOrderId(orderId);
    if (!invoice) {
      /**
       * Nothing to reconcile yet, so create. Creation stamps the status from
       * the order as it stood at that moment.
       *
       * Then ask again, once. Checkout raises the invoice in the background,
       * so a buyer who pays straight away has two callers arriving together:
       * checkout creating the bill from an order with nothing on it, and this
       * one finding no bill, creating, losing the race under the lock, and
       * being handed back the other one with the payment never recorded. The
       * bill then read Pending with nothing received while the order screen
       * showed a receipt for half the money, which is exactly the fault
       * invoice_payment_check was written to stop, coming back through a race.
       *
       * Only reachable with CHALLAN_WHEN_UNPAID=false, because with the rule
       * on there is no bill until the money is all in. The flag is expected to
       * be flipped after legal review, so this is fixed rather than left.
       */
      const created = await this.createInvoiceFromOrder(orderId);
      if (!created || retried) return created;
      return this.reconcileInvoiceForOrder(orderId, true);
    }

    const orderResult = await pool.query(
      `SELECT payment_status, total_amount, amount_paid, buyer_id, order_number
         FROM orders WHERE id = $1`,
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new Error("Order not found.");

    const order = orderResult.rows[0];
    const invoicePaid = String(invoice.payment_status || "").toLowerCase() === "paid";

    // A settled invoice and a cancelled one are both left exactly as they are.
    // This only ever moves an invoice forward.
    if (invoicePaid || invoice.invoice_status === "Cancelled") return invoice;

    const grandTotal = Number(invoice.grand_total || 0);
    const settledOrder = ["paid", "completed"].includes(
      String(order.payment_status || "").toLowerCase(),
    );

    /**
     * How much this invoice should show as received.
     *
     * A settled order closes the invoice on the invoice's own total, not the
     * order's. The two differ by a rupee or so once GST has been worked out,
     * and settling against the order's figure would leave a bill owing four
     * paise forever.
     *
     * Anything short of settled is mirrored from amount_paid, capped so a
     * part payment can never overshoot the bill.
     */
    const target = settledOrder
      ? grandTotal
      : Math.min(Number(order.amount_paid || 0), grandTotal);

    const client = await pool.connect();
    let nowSettled = false;
    try {
      await client.query("BEGIN");

      /**
       * Read what is already on the bill, decide, and write, all under one
       * lock on this invoice.
       *
       * Working it out from the copy fetched above is a read outside any
       * transaction, and two payment events arriving close together both read
       * the same "already paid" figure, both saw the same gap, and both wrote
       * it. One instalment of 892.50 went onto the bill three times and the
       * invoice claimed 2,677.50 had been received against a bill for 1,785.
       * Reconcile is called from a background handler on every payment, so
       * two of them overlapping is the normal case, not a rare one.
       */
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [invoice.id],
      );

      // Anything already recorded against the invoice counts, so a payment the
      // wholesaler entered by hand is not billed twice.
      const alreadyPaid = Number(
        (await client.query(
          "SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1",
          [invoice.id],
        )).rows[0].paid,
      );
      const gap = Number((target - alreadyPaid).toFixed(2));

      // Nothing new has arrived since the last run. Idempotence lives here.
      if (gap <= 0) {
        await client.query("ROLLBACK");
        return invoice;
      }

      nowSettled = Number((target - grandTotal).toFixed(2)) >= 0;
      const stillOwed = Number((grandTotal - target).toFixed(2));

      await invoiceRepository.addPayment(
        {
          invoiceId: invoice.id,
          amount: gap,
          paymentMethod: "UPI",
          remarks: nowSettled
            ? "Payment completed at checkout"
            : "Part payment received at checkout",
        },
        client,
      );

      await invoiceRepository.updateInvoice(
        invoice.id,
        nowSettled
          ? { payment_status: "Paid", invoice_status: "Paid" }
          : // Pending, not "Partial". A bill is paid or it is not, and there
            // is no third answer: the rule settled on 11 Sept is that an
            // invoice exists only once the money is all in, so a half paid
            // bill is a contradiction the product should not be able to hold.
            // What HAS come in is still recorded as payment rows against the
            // bill, so the Invoices header can show received and outstanding
            // separately; it is only the status word that stops lying about
            // a state that is not supposed to exist.
            //
            // invoice_status is left alone. It tracks the life of the document
            // (Generated, Sent, Cancelled), and a payment does not change what
            // has happened to the document.
            { payment_status: "Pending" },
        client,
      );

      await invoiceRepository.addLog(
        {
          invoiceId: invoice.id,
          action: nowSettled ? "Paid" : "Payment",
          performedBy: order.buyer_id,
          details: nowSettled
            ? `Invoice settled. ₹${gap.toFixed(2)} received against order ${order.order_number || orderId}.`
            : `₹${gap.toFixed(2)} received against order ${order.order_number || orderId}. ₹${stillOwed.toFixed(2)} still to pay.`,
        },
        client,
      );

      // Any challan still reading as open against this order now points at
      // the bill. Creation does this too; it is repeated here for a challan
      // written after the bill existed, which a sale billed under the old
      // rule can still have.
      await challanService.markInvoicedForOrder(client, orderId, invoice.id);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Only a settled bill is re-rendered and posted. The PDF carries an UNPAID
    // stamp until the last rupee is in, which is correct while money is still
    // owed, and emailing the same half paid bill after every instalment would
    // be noise.
    if (nowSettled) this.generateAndSendInvoiceEmailAsync(invoice.id, null);

    return invoiceRepository.findInvoiceById(invoice.id);
  }

  /**
   * Helper to generate PDF and dispatch email in background without blocking API response.
   */
  async generateAndSendInvoiceEmailAsync(invoiceId, targetEmail = null) {
    try {
      const fullInvoice = await invoiceRepository.findInvoiceById(invoiceId);
      if (!fullInvoice) return;

      const { pdfBuffer } = await pdfService.generateAndSaveInvoicePDF(fullInvoice);
      await invoiceRepository.addLog({
        invoiceId,
        action: "PDF Generated",
        performedBy: fullInvoice.buyer_id,
        details: `PDF generated and cached at ${fullInvoice.pdf_path || `/uploads/invoices/${fullInvoice.invoice_number}.pdf`}`,
      });

      const recipient = targetEmail || fullInvoice.buyer_email;
      if (recipient) {
        await emailService.sendInvoiceEmailWithRetry({
          invoice: fullInvoice,
          pdfBuffer,
          recipientEmail: recipient,
          performedBy: fullInvoice.buyer_id,
        });
      }
    } catch (err) {
      console.error("Background PDF/Email generation failed for invoice:", invoiceId, err.message);
    }
  }

  /**
   * Allows suppliers to create manual custom invoices.
   */
  async createManualInvoice(payload, supplierId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { buyerId, items = [], discount = 0, shippingCharge = 0, notes, termsConditions, dueDate } = payload;
      if (!buyerId || items.length === 0) {
        throw new Error("Buyer ID and at least one item are required.");
      }

      // The HSN was not checked on this path at all, so a manual bill could go
      // out with a three digit code on it while the same code was refused on a
      // sale. Same check, same setting, same message.
      // Which book this bill belongs to. Refused rather than defaulted on a
      // bad value, because a bill filed in the wrong run is a set of numbers
      // nobody can reconcile.
      const { channel, account, error: channelError } = await resolveChannel(
        payload.channel,
        supplierId,
        client,
      );
      if (channelError) throw new Error(channelError);

      const minDigits = await minHsnDigits();
      for (const item of items) {
        const hsn = checkHsn(item.hsnCode ?? item.hsn_code, { minDigits });
        if (!hsn.ok) {
          throw new Error(`${hsn.reason} Check the HSN for ${item.productName || "this line"}.`);
        }
      }
      // A tax invoice needs two parties. Ordering already blocks buying your
      // own stock; this closes the same hole on the manual path.
      if (String(buyerId) === String(supplierId)) {
        throw new Error("An invoice cannot be raised against your own account.");
      }

      const buyerQuery = await client.query(
        `SELECT u.id, u.email, u.phone, u.first_name, u.last_name,
                wp.company_name, wp.city, wp.gstin,
                wp.warehouse_state AS state, wp.warehouse_address
           FROM users u
           LEFT JOIN wholesaler_profiles wp ON u.id = wp.user_id
          WHERE u.id = $1`,
        [buyerId]
      );
      if (buyerQuery.rows.length === 0) throw new Error("Buyer user not found.");
      const buyerUser = buyerQuery.rows[0];

      const supplierQuery = await client.query(
        `SELECT warehouse_state AS state, gstin,
                COALESCE(NULLIF(warehouse_city, ''), city) AS city
           FROM wholesaler_profiles WHERE user_id = $1`,
        [supplierId]
      );
      const supplierProfile = supplierQuery.rows[0] || {};

      const settings = await invoiceRepository.getSettings(supplierId);

      const gstCalculation = gstService.calculateGST({
        items: items.map((item) => ({
          ...item,
          gstPercent: item.gstPercent ?? settings.defaultTaxRate,
        })),
        discount,
        shippingCharge,
        supplierLocation: {
          state: supplierProfile.state,
          gstin: supplierProfile.gstin,
          city: supplierProfile.city,
        },
        buyerLocation: {
          state: buyerUser.state,
          gstin: buyerUser.gstin,
          city: buyerUser.city,
        },
      });

      const pos = placeOfSupply({
        state: buyerUser.state,
        gstin: buyerUser.gstin,
        city: buyerUser.city,
      });

      const invoiceNumber = await invoiceNumberService.generateInvoiceNumber(
        client,
        settings.prefix,
        null,
        supplierId,
        // A bill typed by hand, so it belongs to whichever book the wholesaler
        // says. Defaults to the counter, which is where a typed bill usually
        // comes from.
        { suffix: settings.numberSuffix, padTo: settings.numberPadTo, channel, account },
      );

      const invoiceData = {
        invoiceNumber,
        orderId: null,
        buyerId,
        supplierId,
        subtotal: gstCalculation.subtotal,
        discount: gstCalculation.discount,
        shippingCharge: gstCalculation.shippingCharge,
        taxableAmount: gstCalculation.taxableAmount,
        cgst: gstCalculation.cgst,
        sgst: gstCalculation.sgst,
        igst: gstCalculation.igst,
        totalTax: gstCalculation.totalTax,
        grandTotal: gstCalculation.grandTotal,
        totalCess: gstCalculation.totalCess,
        channel,
        placeOfSupply: pos.state,
        placeOfSupplyCode: pos.code,
        supplierState: gstCalculation.supplierState,
        reverseCharge: false,
        roundOff: gstCalculation.roundOff,
        paymentStatus: "Pending",
        invoiceStatus: "Generated",
        issueDate: new Date(),
        dueDate: dueDate
          ? new Date(dueDate)
          : new Date(Date.now() + settings.dueDays * 86400000),
        notes: notes || settings.defaultNotes,
        termsConditions: termsConditions || settings.defaultTerms,

        /**
         * The document block, as typed on the form.
         *
         * State CODES are derived here rather than asked for. The form offers a
         * state by name, because that is what somebody knows, and the two digit
         * code is looked up from it. Asking a wholesaler to type 27 beside
         * Maharashtra is asking them to get it wrong on a tax document, and it
         * is the one number that decides CGST and SGST against IGST.
         *
         * The seller block and the bank details are NOT here. createInvoice
         * copies those from the profile itself, so they cannot be forgotten
         * and cannot be forged from the request body.
         */
        /**
         * Who the bill was made out to, frozen.
         *
         * This path used to store only the state and leave the name, GSTIN and
         * address to a join, so a bill reprinted after the customer changed
         * their firm name showed the new one. The sale path has always
         * snapshotted these. All three roads now do.
         */
        recipientName: buyerUser.company_name || fullName(buyerUser.first_name, buyerUser.last_name) || null,
        recipientGstin: buyerUser.gstin || null,
        recipientCity: buyerUser.city || null,
        recipientAddress: buyerUser.warehouse_address || null,
        recipientPhone: buyerUser.phone || null,
        recipientState: pos.state,
        recipientStateCode: pos.code,

        dispatchFromName: clean(payload.dispatchFromName),
        dispatchFromAddress: clean(payload.dispatchFromAddress),
        dispatchFromCity: clean(payload.dispatchFromCity),
        dispatchFromState: clean(payload.dispatchFromState),
        dispatchFromStateCode: stateCode(payload.dispatchFromState),
        dispatchFromPincode: clean(payload.dispatchFromPincode),

        shipToName: clean(payload.shipToName),
        shipToGstin: clean(payload.shipToGstin),
        shipToAddress: clean(payload.shipToAddress),
        shipToCity: clean(payload.shipToCity),
        shipToState: clean(payload.shipToState),
        shipToStateCode: stateCode(payload.shipToState),
        shipToPincode: clean(payload.shipToPincode),

        grNumber: clean(payload.grNumber),
        grDate: payload.grDate || null,

        transporterName: clean(payload.transporterName),
        transporterId: clean(payload.transporterId),
        transportMode: clean(payload.transportMode),
        vehicleNumber: clean(payload.vehicleNumber),
        transportDocNumber: clean(payload.transportDocNumber),
        transportDocDate: payload.transportDocDate || null,
      };

      /**
       * The UQC each line is filed under, carried across from the form.
       *
       * gstService rebuilds the items as it prices them and knows nothing about
       * units, so the code is put back afterwards, matched by position. Absent
       * when the wholesaler has not picked a unit, which is honest: a made up
       * UQC is a wrong declaration on an e-invoice.
       */
      const pricedItems = gstCalculation.items.map((priced, i) => ({
        ...priced,
        uqc: clean(items[i]?.uqc) || null,
      }));

      const invoice = await invoiceRepository.createInvoice(invoiceData, pricedItems, client);

      await invoiceRepository.addLog(
        {
          invoiceId: invoice.id,
          action: "Created",
          performedBy: supplierId,
          details: `Manual invoice ${invoiceNumber} created by supplier`,
        },
        client
      );

      await client.query("COMMIT");

      // Generate PDF & Dispatch email in background
      this.generateAndSendInvoiceEmailAsync(invoice.id, buyerUser.email);

      return invoice;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves an invoice by ID with authorization verification.
   */
  async getInvoiceById(id, userId, role) {
    const invoice = await invoiceRepository.findInvoiceById(id);
    if (!invoice) throw new Error("Invoice not found.");

    // Authorization: Admin or owning Buyer/Supplier
    if (role !== "admin" && invoice.buyer_id !== userId && invoice.supplier_id !== userId) {
      throw new Error("Access Denied: You do not have permission to view this invoice.");
    }

    return invoice;
  }

  /**
   * Resolves the invoice for an order, creating it on first access.
   *
   * The order is authorized before anything is created or returned: the order
   * id alone is not a capability, so only its buyer, its supplier or an admin
   * gets past this point.
   */
  async getInvoiceForOrder(orderId, userId, role) {
    const orderResult = await pool.query(
      `SELECT buyer_id, supplier_id FROM orders WHERE id = $1`,
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new Error("Order not found.");

    const order = orderResult.rows[0];
    if (role !== "admin" && order.buyer_id !== userId && order.supplier_id !== userId) {
      throw new Error("Access Denied: You do not have permission to view this order's invoice.");
    }

    const existing = await invoiceRepository.findInvoiceByOrderId(orderId);
    if (existing) return existing;

    return this.createInvoiceFromOrder(orderId);
  }

  /**
   * Search, filter, and paginate invoices.
   */
  async getInvoices(queryParams, userId, role) {
    return invoiceRepository.findInvoices({ ...queryParams, userId, role });
  }

  /**
   * Records a full or partial payment against an invoice.
   */
  async recordPayment(invoiceId, paymentPayload, userId, role) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const invoice = await invoiceRepository.findInvoiceById(invoiceId);
      if (!invoice) throw new Error("Invoice not found.");

      if (role !== "admin" && invoice.supplier_id !== userId && invoice.buyer_id !== userId) {
        throw new Error("Access Denied: Unauthorized to record payment for this invoice.");
      }

      const amountPaid = Number(paymentPayload.amount);
      if (isNaN(amountPaid) || amountPaid <= 0) {
        throw new Error("Payment amount must be a positive number.");
      }

      const grandTotal = Number(invoice.grand_total);
      let newPaymentStatus = "Pending";
      let newInvoiceStatus = invoice.invoice_status;

      // Paid or not paid. See reconcileInvoiceForOrder above for why there is
      // no "Partial": a bill that only exists once it is settled can never
      // honestly be in a half paid state, and the money that has come in is
      // carried by the payment rows rather than by the status word.

      // Add payment entry.
      //
      // Comes back null when an ORDER backed invoice already shows everything
      // the order has received. That is not a failure to hide: the money for a
      // shop order is recorded against the ORDER, and reconcile mirrors it
      // here, so typing it again on the bill is the wrong door and would count
      // it twice. See invoiceRepository.addPayment for the race this closes.
      const payment = await invoiceRepository.addPayment(
        {
          invoiceId,
          amount: amountPaid,
          paymentMethod: paymentPayload.paymentMethod || "UPI",
          transactionId: paymentPayload.transactionId || null,
          paymentReference: paymentPayload.paymentReference || null,
          remarks: paymentPayload.remarks || null,
        },
        client
      );

      if (!payment) {
        const err = new Error(
          "This bill already shows everything its order has received. Record the payment against the order instead, and the bill will follow.",
        );
        err.code = "FOLLOWS_ORDER";
        throw err;
      }

      /**
       * Read back what the bill NOW holds, inside the same transaction, rather
       * than adding the requested figure to a total read before the lock.
       *
       * Two reasons. The amount actually recorded can be less than the amount
       * asked for, since addPayment clamps an order backed bill at what the
       * order has received, and stamping Paid from the unclamped figure would
       * mark a bill settled that is not. And the old sum came from a copy
       * fetched outside any transaction, which is the same read-modify-write
       * that let two payments each see the other as not yet there.
       *
       * Paid or not paid, nothing between. See reconcileInvoiceForOrder for
       * why there is no "Partial".
       */
      const nowOnBill = Number(
        (await client.query(
          "SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1",
          [invoiceId],
        )).rows[0].paid,
      );

      if (Number((nowOnBill - grandTotal).toFixed(2)) >= 0) {
        newPaymentStatus = "Paid";
        newInvoiceStatus = "Paid";
      }

      // Update invoice payment and invoice status
      const updatedInvoice = await invoiceRepository.updateInvoice(
        invoiceId,
        {
          payment_status: newPaymentStatus,
          invoice_status: newInvoiceStatus,
        },
        client
      );

      // Also update the linked order once the invoice is fully settled.
      //
      // This wrote status = 'confirmed', which is not a state the lifecycle
      // knows: it bricked every later transition with "Invalid current status:
      // confirmed", and fails outright against the chk_order_status
      // constraint. payment_completed is the real state, and it is only set
      // from the payment_pending stage so a dispatched order is not dragged
      // backwards.
      if (invoice.order_id && newPaymentStatus === "Paid") {
        await client.query(
          `UPDATE orders
              SET payment_status = 'paid',
                  status = CASE WHEN status IN ('pending', 'payment_pending')
                                THEN 'payment_completed' ELSE status END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [invoice.order_id]
        );
      }

      // Log activity
      await invoiceRepository.addLog(
        {
          invoiceId,
          action: "Paid",
          performedBy: userId,
          details: `Recorded payment of ₹${Number(payment.amount).toFixed(2)} via ${paymentPayload.paymentMethod || "UPI"}. Total paid: ₹${nowOnBill.toFixed(2)} / ₹${grandTotal.toFixed(2)}`,
        },
        client
      );

      await client.query("COMMIT");

      // Re-generate PDF on disk to reflect PAID watermark & status
      this.generateAndSendInvoiceEmailAsync(invoiceId, null);

      return { invoice: updatedInvoice, payment, newPaymentStatus, newInvoiceStatus, totalPaid: nowOnBill };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Dispatches invoice PDF via email manually upon request.
   */
  async sendInvoiceEmail(invoiceId, userId, role, recipientEmail = null) {
    const invoice = await this.getInvoiceById(invoiceId, userId, role);
    const { pdfBuffer } = await pdfService.generateAndSaveInvoicePDF(invoice);

    const targetEmail = recipientEmail || invoice.buyer_email;
    const result = await emailService.sendInvoiceEmailWithRetry({
      invoice,
      pdfBuffer,
      recipientEmail: targetEmail,
      performedBy: userId,
    });

    return { success: true, message: `Invoice email sent to ${targetEmail}`, result };
  }

  /**
   * Logs payment reminder sending.
   */
  async sendPaymentReminder(invoiceId, userId, role) {
    const invoice = await this.getInvoiceById(invoiceId, userId, role);
    const { pdfBuffer } = await pdfService.generateAndSaveInvoicePDF(invoice);

    await emailService.sendInvoiceEmailWithRetry({
      invoice,
      pdfBuffer,
      recipientEmail: invoice.buyer_email,
      performedBy: userId,
    });

    await invoiceRepository.addLog({
      invoiceId,
      action: "Reminder Sent",
      performedBy: userId,
      details: `Payment reminder sent to buyer (${invoice.buyer_email}) for due date ${invoice.due_date}`,
    });

    return { success: true, message: `Payment reminder sent to ${invoice.buyer_email}` };
  }

  /**
   * Aggregates supplier/buyer dashboard metrics.
   */
  async getDashboardStats(userId, role, side) {
    return invoiceRepository.getDashboardStats(userId, role, side);
  }

  /**
   * Aggregates financial reports.
   */
  async getReportData(userId, role, startDate, endDate, side) {
    return invoiceRepository.getReportData(userId, role, startDate, endDate, side);
  }

  /**
   * Generates CSV format string for invoice exports.
   */
  async exportInvoicesCSV(userId, role, queryParams) {
    const data = await invoiceRepository.findInvoices({ ...queryParams, userId, role, page: 1, limit: 10000 });
    const headers = [
      "Invoice Number",
      "Issue Date",
      "Due Date",
      "Buyer Name",
      "Buyer GSTIN",
      "Supplier Name",
      "Supplier GSTIN",
      "Subtotal",
      "Total Tax",
      "Grand Total",
      "Payment Status",
      "Invoice Status",
    ];

    const rows = data.invoices.map((inv) => [
      inv.invoice_number,
      inv.issue_date ? new Date(inv.issue_date).toLocaleDateString() : "",
      inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "",
      `"${inv.buyer_name || ""}"`,
      `"${inv.buyer_gstin || ""}"`,
      `"${inv.supplier_name || ""}"`,
      `"${inv.supplier_gstin || ""}"`,
      inv.subtotal,
      inv.total_tax,
      inv.grand_total,
      inv.payment_status,
      inv.invoice_status,
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  /**
   * The HSN summary for the foot of a bill, and for GSTR-1 Table 12.
   *
   * The wholesaler is required, not optional. Passing it on from the caller's
   * token is what keeps one wholesaler out of another's invoices, and a default
   * here would quietly remove that.
   *
   * An HSN of null means the line was billed without one. Show it as not set.
   * Do not print a stand in code, because a made up HSN on a tax document is a
   * false statement, and a real looking one is worse than a blank.
   */
  async getHsnSummary(invoiceId, wholesalerId) {
    if (!wholesalerId) {
      throw new Error("getHsnSummary needs the wholesaler it is reading for");
    }
    return invoiceRepository.getHsnSummary(invoiceId, wholesalerId);
  }
}

module.exports = new InvoiceService();
