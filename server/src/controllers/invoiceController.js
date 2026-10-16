const pool = require("../config/db");
const invoiceService = require("../services/invoiceService");
const pdfService = require("../services/pdfService");
const invoiceRepository = require("../repositories/invoiceRepository");
const invoiceNumberService = require("../services/invoiceNumberService");
// Whose invoices these are. The person doing the work is still req.user.id:
// they are the name on a log entry, not the business the bill belongs to.
const { businessId } = require("../middlewares/businessContext");
const { headOf, prefixClash } = require("../services/salesChannels");

class InvoiceController {
  async getInvoices(req, res) {
    try {
      const result = await invoiceService.getInvoices(req.query, businessId(req), req.user.role);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("Error fetching invoices:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to fetch invoices" });
    }
  }

  async getInvoiceById(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id, businessId(req), req.user.role);
      res.json({ success: true, invoice });
    } catch (err) {
      console.error("Error fetching invoice details:", err);
      res.status(404).json({ success: false, message: err.message || "Invoice not found" });
    }
  }

  async getInvoicePDF(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id, businessId(req), req.user.role);
      
      // Log PDF download event
      await invoiceRepository.addLog({
        invoiceId: invoice.id,
        action: "Downloaded",
        performedBy: req.user.id,
        details: `PDF downloaded by ${req.user.role} (${req.user.email || req.user.id})`,
      });

      await pdfService.generateInvoicePDF(invoice, res);
    } catch (err) {
      console.error("Error generating invoice PDF:", err);
      res.status(500).json({ success: false, message: err.message || "Could not generate invoice PDF" });
    }
  }

  async getInvoiceByOrderId(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceForOrder(
        req.params.orderId,
        businessId(req),
        req.user.role,
      );
      res.json({ success: true, invoice });
    } catch (err) {
      console.error("Error fetching invoice by order:", err);
      const denied = /access denied/i.test(err.message || "");
      res.status(denied ? 403 : 500).json({ success: false, message: err.message || "Failed to fetch order invoice" });
    }
  }

  async getInvoicePDFByOrderId(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceForOrder(
        req.params.orderId,
        businessId(req),
        req.user.role,
      );

      await invoiceRepository.addLog({
        invoiceId: invoice.id,
        action: "Downloaded",
        performedBy: req.user.id,
        details: `PDF downloaded for Order #${req.params.orderId}`,
      });

      await pdfService.generateInvoicePDF(invoice, res);
    } catch (err) {
      console.error("Error generating PDF by order ID:", err);
      const denied = /access denied/i.test(err.message || "");
      res.status(denied ? 403 : 500).json({ success: false, message: err.message || "Failed to generate invoice PDF" });
    }
  }

  async createInvoice(req, res) {
    try {
      const invoice = await invoiceService.createManualInvoice(req.body, businessId(req));
      res.status(201).json({ success: true, invoice });
    } catch (err) {
      console.error("Error creating manual invoice:", err);
      res.status(400).json({ success: false, message: err.message || "Failed to create invoice" });
    }
  }

  async updateInvoice(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id, businessId(req), req.user.role);
      if (invoice.payment_status === "Paid" && req.user.role !== "admin") {
        return res.status(400).json({ success: false, message: "Paid invoices cannot be modified." });
      }

      const updated = await invoiceRepository.updateInvoice(req.params.id, req.body);
      
      await invoiceRepository.addLog({
        invoiceId: req.params.id,
        action: "Updated",
        performedBy: req.user.id,
        details: "Invoice header details updated",
      });

      res.json({ success: true, invoice: updated });
    } catch (err) {
      console.error("Error updating invoice:", err);
      res.status(400).json({ success: false, message: err.message || "Failed to update invoice" });
    }
  }

  async deleteInvoice(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id, businessId(req), req.user.role);
      
      await invoiceRepository.updateInvoice(req.params.id, {
        invoice_status: "Cancelled",
        payment_status: "Refunded",
      });

      await invoiceRepository.addLog({
        invoiceId: req.params.id,
        action: "Cancelled",
        performedBy: req.user.id,
        details: "Invoice cancelled",
      });

      res.json({ success: true, message: "Invoice marked as Cancelled" });
    } catch (err) {
      console.error("Error cancelling invoice:", err);
      res.status(400).json({ success: false, message: err.message || "Failed to cancel invoice" });
    }
  }

  async sendInvoice(req, res) {
    try {
      const result = await invoiceService.sendInvoiceEmail(req.params.id, businessId(req), req.user.role);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("Error sending invoice email:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to send invoice email" });
    }
  }

  async sendReminder(req, res) {
    try {
      const result = await invoiceService.sendPaymentReminder(req.params.id, businessId(req), req.user.role);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("Error sending payment reminder:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to send payment reminder" });
    }
  }

  /**
   * Money against a bill raised from a sale is recorded on the customer, not
   * here. Both used to be possible and they wrote to different tables, so a
   * bill could read Paid while the customer's balance still showed the whole
   * amount owing. This refuses rather than creating that split again.
   *
   * Marketplace invoices, which have no sale behind them, still use the old
   * path because the customer book knows nothing about them.
   */
  async recordPayment(req, res) {
    try {
      // Assembled from what this database has. On one that has not had the
      // 3.0 migrations run there are no sale invoices and no credit notes, so
      // neither guard below can apply, and asking for them would only turn
      // recording a payment into a 400.
      const has = await invoiceRepository.schemaExtras();
      const owned = await pool.query(
        has.has_sale_id
          ? `SELECT i.sale_id, i.party_id${has.has_credit_notes ? ", cn.note_number" : ", NULL AS note_number"}
               FROM invoices i
               ${has.has_credit_notes ? "LEFT JOIN credit_notes cn ON cn.invoice_id = i.id" : ""}
              WHERE i.id = $1 AND i.supplier_id = $2`
          : `SELECT NULL AS sale_id, NULL AS party_id, NULL AS note_number
               FROM invoices i
              WHERE i.id = $1 AND i.supplier_id = $2`,
        [req.params.id, businessId(req)],
      );
      // A reversed bill is not owed, so nothing can be received against it.
      if (owned.rows.length > 0 && owned.rows[0].note_number) {
        return res.status(400).json({
          success: false,
          message: `This bill was reversed by credit note ${owned.rows[0].note_number}, so nothing is owed on it.`,
        });
      }
      if (owned.rows.length > 0 && owned.rows[0].sale_id) {
        return res.status(400).json({
          success: false,
          message:
            "Record this payment on the customer's page. It updates their balance and this bill together.",
          partyId: owned.rows[0].party_id,
        });
      }

      const result = await invoiceService.recordPayment(req.params.id, req.body, businessId(req), req.user.role);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("Error recording payment:", err);
      res.status(400).json({ success: false, message: err.message || "Failed to record payment" });
    }
  }

  async getDashboardStats(req, res) {
    try {
      const stats = await invoiceService.getDashboardStats(businessId(req), req.user.role, req.query.side);
      res.json({ success: true, stats });
    } catch (err) {
      console.error("Error fetching invoice dashboard stats:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to load dashboard metrics" });
    }
  }

  async getReportData(req, res) {
    try {
      const { startDate, endDate, side } = req.query;
      const report = await invoiceService.getReportData(businessId(req), req.user.role, startDate, endDate, side);
      res.json({ success: true, report });
    } catch (err) {
      console.error("Error fetching report data:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to load report data" });
    }
  }

  async exportCSV(req, res) {
    try {
      const csv = await invoiceService.exportInvoicesCSV(businessId(req), req.user.role, req.query);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=invoices_export.csv");
      res.status(200).send(csv);
    } catch (err) {
      console.error("Error exporting CSV:", err);
      res.status(500).json({ success: false, message: "CSV export failed" });
    }
  }

  async exportExcel(req, res) {
    try {
      const csv = await invoiceService.exportInvoicesCSV(businessId(req), req.user.role, req.query);
      res.setHeader("Content-Type", "application/vnd.ms-excel");
      res.setHeader("Content-Disposition", "attachment; filename=invoices_export.xls");
      res.status(200).send(csv);
    } catch (err) {
      console.error("Error exporting Excel:", err);
      res.status(500).json({ success: false, message: "Excel export failed" });
    }
  }

  async exportPDF(req, res) {
    try {
      const data = await invoiceRepository.findInvoices({
        ...req.query,
        userId: businessId(req),
        role: req.user.role,
        page: 1,
        limit: 100,
      });

      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ size: "A4", margin: 36 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=invoices_summary_report.pdf");
      doc.pipe(res);

      doc.fontSize(16).font("Helvetica-Bold").text("INVOICES SUMMARY REPORT", { align: "center" });
      doc.fontSize(9).font("Helvetica").text(`Generated on: ${new Date().toLocaleString()}`, { align: "center" });
      doc.moveDown(1.5);

      data.invoices.forEach((inv, i) => {
        doc.fontSize(9).font("Helvetica-Bold").text(`${i + 1}. ${inv.invoice_number} | Buyer: ${inv.buyer_name || 'N/A'}`);
        doc.fontSize(8).font("Helvetica").text(`   Date: ${inv.issue_date ? new Date(inv.issue_date).toLocaleDateString() : 'N/A'} | Status: ${inv.invoice_status} | Payment: ${inv.payment_status} | Total: Rs. ${Number(inv.grand_total || 0).toFixed(2)}`);
        doc.moveDown(0.5);
      });

      doc.end();
    } catch (err) {
      console.error("Error exporting PDF report:", err);
      res.status(500).json({ success: false, message: "PDF report export failed" });
    }
  }

  async getSettings(req, res) {
    try {
      const settings = await invoiceRepository.getSettings(businessId(req));
      res.json({ success: true, settings });
    } catch (err) {
      console.error("Error fetching invoice settings:", err);
      res.status(500).json({ success: false, message: "Failed to load invoice settings" });
    }
  }

  async saveSettings(req, res) {
    try {
      const prefix = String(req.body.prefix || "INV").trim().slice(0, 10) || "INV";
      const dueDays = Number(req.body.dueDays);
      const defaultTaxRate = Number(req.body.defaultTaxRate);

      /**
       * The number format, which this route used to drop on the floor.
       *
       * invoice_settings has carried number_suffix and number_pad_to since
       * 10 Sept and the repository has always written them, but this handler
       * never passed them through, so the columns were unreachable and every
       * wholesaler was stuck on INV-000001 whatever they set.
       *
       * Checked by composing a real number rather than by validating the parts
       * separately. Rule 46(b) constrains the WHOLE string, sixteen characters
       * and a short alphabet, so a prefix and a suffix that are each fine can
       * still be illegal together. Refusing it here means they find out while they
       * is looking at the setting, not at invoice 1000.
       */
      const numberSuffix = String(req.body.numberSuffix ?? "").trim().slice(0, 16);
      const padRaw = Number(req.body.numberPadTo);
      const numberPadTo = Number.isFinite(padRaw)
        ? Math.min(Math.max(Math.round(padRaw), 0), 9)
        : 0;

      // The widest sequence this format will ever reach, not just number 1.
      const worst = invoiceNumberService.compose({
        prefix,
        suffix: numberSuffix,
        padTo: numberPadTo,
        sequence: 10 ** Math.max(numberPadTo, 1) - 1,
      });
      if (!worst.ok) {
        return res.status(400).json({
          success: false,
          message: worst.reason,
          code: "BAD_NUMBER_FORMAT",
          sample: worst.number,
        });
      }

      /**
       * The counter run must not take a prefix another run already prints,
       * or both hand out the same numbers. Asked only when the prefix
       * actually changes, so a wholesaler who happens to be on a clashing one
       * already can still save the rest of this screen.
       */
      const current = await pool
        .query("SELECT prefix FROM invoice_settings WHERE user_id = $1", [businessId(req)])
        .then((r) => r.rows[0]?.prefix);
      if (headOf(current || "INV") !== headOf(prefix)) {
        const clash = await prefixClash(businessId(req), prefix, pool, { skipSettings: true });
        if (clash) {
          return res.status(400).json({
            success: false,
            message: `${headOf(prefix)} is too close to ${clash}. Two books starting the same way would print the same bill numbers.`,
            code: "PREFIX_TAKEN",
          });
        }
      }

      if (!Number.isFinite(dueDays) || dueDays < 0 || dueDays > 365) {
        return res.status(400).json({ success: false, message: "Payment due days must be between 0 and 365." });
      }
      if (!Number.isFinite(defaultTaxRate) || defaultTaxRate < 0 || defaultTaxRate > 100) {
        return res.status(400).json({ success: false, message: "GST rate must be between 0 and 100." });
      }

      const settings = await invoiceRepository.saveSettings(businessId(req), {
        prefix,
        dueDays: Math.round(dueDays),
        defaultTaxRate,
        defaultNotes: req.body.defaultNotes || null,
        defaultTerms: req.body.defaultTerms || null,
        numberSuffix,
        numberPadTo,
      });

      res.json({ success: true, settings });
    } catch (err) {
      console.error("Error saving invoice settings:", err);
      res.status(500).json({ success: false, message: "Failed to save invoice settings" });
    }
  }

  /**
   * What a number in this format would look like, without taking one.
   *
   * Pure: it touches no counter and saves nothing, so the settings screen can
   * call it on every keystroke. Busy shows a live Sample Voucher No. in its
   * numbering dialog and it is the reason nobody there configures a format
   * they cannot use.
   */
  async previewNumber(req, res) {
    try {
      const prefix = String(req.query.prefix ?? "INV-").slice(0, 10);
      const suffix = String(req.query.suffix ?? "").slice(0, 16);
      const padRaw = Number(req.query.padTo);
      const padTo = Number.isFinite(padRaw)
        ? Math.min(Math.max(Math.round(padRaw), 0), 9)
        : 0;

      const first = invoiceNumberService.compose({ prefix, suffix, padTo, sequence: 1 });
      // Number 1 can fit while number 1000 does not, and the one that matters
      // is the one they will hit in a year.
      const later = invoiceNumberService.compose({
        prefix, suffix, padTo,
        sequence: 10 ** Math.max(padTo, 1) - 1,
      });

      res.json({
        success: true,
        sample: first.number,
        ok: first.ok && later.ok,
        reason: first.reason || later.reason || null,
        // How high the sequence can go before the whole string breaks the
        // sixteen character limit.
        roomFor: invoiceNumberService.roomFor({ prefix, suffix }),
        financialYear: invoiceNumberService.financialYear(),
        maxLength: invoiceNumberService.MAX_LENGTH,
      });
    } catch (err) {
      console.error("Error previewing an invoice number:", err);
      res.status(500).json({ success: false, message: "Could not preview that format" });
    }
  }

  async getBuyers(req, res) {
    try {
      const buyers = await invoiceRepository.getBuyers(businessId(req));
      res.json({ success: true, buyers });
    } catch (err) {
      console.error("Error fetching buyers:", err);
      res.status(500).json({ success: false, message: "Failed to fetch buyers" });
    }
  }
}

module.exports = new InvoiceController();
