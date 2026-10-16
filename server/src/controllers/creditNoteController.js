const creditNoteService = require("../services/creditNoteService");
const pdfService = require("../services/pdfService");
const { businessId } = require("../middlewares/businessContext");

/**
 * Credit notes are the wholesaler's own documents, so every route is scoped
 * to the id on their token. Nothing here takes a wholesaler id from the body.
 */

const FAILURES = {
  notFound: [404, "That bill is not in your books"],
  cancelled: [400, "This bill was cancelled, so there is nothing to credit"],
  reason: [400, "Choose a reason for the credit note"],
};

exports.createCreditNote = async (req, res) => {
  const wholesalerId = businessId(req);
  const { invoiceId, reason, reasonNote, issueDate } = req.body;

  if (!invoiceId) {
    return res.status(400).json({ message: "Choose the bill to credit" });
  }

  try {
    const result = await creditNoteService.createCreditNote({
      invoiceId,
      wholesalerId,
      reason: reason || "goods_returned",
      reasonNote: reasonNote || null,
      issueDate: issueDate || null,
    });

    if (result.error === "exists") {
      // Not an error the wholesaler caused. They asked for a credit note and
      // there is one, so hand it back rather than making them hunt for it.
      const existing = await creditNoteService.findByInvoiceId(invoiceId, wholesalerId);
      return res.status(200).json(existing);
    }

    if (result.error) {
      const [status, message] = FAILURES[result.error] || [400, "Could not raise this credit note"];
      return res.status(status).json({ message });
    }

    res.status(201).json(result.creditNote);
  } catch (err) {
    console.error("Error raising credit note:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.listCreditNotes = async (req, res) => {
  try {
    const notes = await creditNoteService.listCreditNotes(businessId(req), {
      partyId: req.query.partyId || null,
    });
    res.status(200).json(notes);
  } catch (err) {
    console.error("Error listing credit notes:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getCreditNote = async (req, res) => {
  try {
    const note = await creditNoteService.getCreditNote(req.params.id, businessId(req));
    if (!note) return res.status(404).json({ message: "Credit note not found" });
    res.status(200).json(note);
  } catch (err) {
    console.error("Error fetching credit note:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getCreditNotePDF = async (req, res) => {
  try {
    const note = await creditNoteService.getCreditNote(req.params.id, businessId(req));
    if (!note) return res.status(404).json({ message: "Credit note not found" });
    await pdfService.generateCreditNotePDF(note, res);
  } catch (err) {
    console.error("Error generating credit note PDF:", err);
    res.status(500).json({ message: "Could not generate the credit note" });
  }
};

exports.getCreditNoteForInvoice = async (req, res) => {
  try {
    const note = await creditNoteService.findByInvoiceId(
      req.params.invoiceId,
      businessId(req),
    );
    if (!note) {
      return res.status(404).json({ message: "No credit note against this bill" });
    }
    res.status(200).json(note);
  } catch (err) {
    console.error("Error fetching credit note for invoice:", err);
    res.status(500).json({ message: "Server error" });
  }
};
