const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const { renderEmailTemplate } = require("./emailTemplates");
const { BRAND } = require("../config/brand");
const invoiceRepository = require("../repositories/invoiceRepository");

const provider = process.env.EMAIL_PROVIDER || "smtp";
const fromAddress = process.env.EMAIL_FROM || "no-reply@marketplace.example.com";
const fromName = process.env.EMAIL_FROM_NAME || BRAND.name;

if (provider === "sendgrid" && process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const createSmtpTransport = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP configuration is missing. Falling back to log-only email mode.");
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const sendEmail = async ({ to, subject, templateName, variables = {}, attachments = [] }) => {
  const html = renderEmailTemplate(templateName, variables);
  if (!to) throw new Error("Email recipient is required");

  if (provider === "sendgrid" && process.env.SENDGRID_API_KEY) {
    const msg = {
      to,
      from: { email: fromAddress, name: fromName },
      subject,
      html,
      attachments: attachments.map((att) => ({
        content: att.content.toString("base64"),
        filename: att.filename,
        type: att.contentType || "application/pdf",
        disposition: "attachment",
      })),
    };
    const result = await sgMail.send(msg);
    return { provider: "sendgrid", response: result };
  }

  const transport = createSmtpTransport();
  if (!transport) {
    console.log(`[MOCK EMAIL SENT] To: ${to} | Subject: ${subject}`);
    return { provider: "mock", response: "Mock email logged to console" };
  }

  const result = await transport.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    html,
    attachments,
  });
  return { provider: "smtp", response: result };
};

/**
 * Sends tax invoice PDF to buyer with 3 automatic retries and logging.
 */
const sendInvoiceEmailWithRetry = async ({
  invoice,
  pdfBuffer,
  recipientEmail,
  performedBy = null,
  maxRetries = 3,
}) => {
  const targetEmail = recipientEmail || invoice.buyer_email;
  if (!targetEmail) {
    throw new Error("No buyer email available for invoice dispatch");
  }

  const subject = `Invoice ${invoice.invoice_number} from ${invoice.supplier_company || invoice.supplier_name || BRAND.name}`;

  const emailVariables = {
    buyerName: invoice.buyer_company || invoice.buyer_name || "Valued Customer",
    supplierName: invoice.supplier_company || invoice.supplier_name || "B2B Wholesaler",
    invoiceNumber: invoice.invoice_number,
    orderNumber: invoice.order_number || `#${invoice.order_id}`,
    grandTotal: `₹${Number(invoice.grand_total).toFixed(2)}`,
    paymentStatus: invoice.payment_status,
    issueDate: invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN"),
    dueDate: invoice.due_date ? new Date(invoice.due_date).toLocaleDateString("en-IN") : "N/A",
  };

  let lastError = null;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const emailResult = await sendEmail({
        to: targetEmail,
        subject,
        templateName: "invoice_notification",
        variables: emailVariables,
        attachments: [
          {
            filename: `${invoice.invoice_number}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      // Update invoice email status
      await invoiceRepository.updateInvoice(invoice.id, {
        email_sent: true,
        email_sent_at: new Date(),
      });

      // Log success
      await invoiceRepository.addLog({
        invoiceId: invoice.id,
        action: "Email Sent",
        performedBy,
        details: `Successfully sent invoice PDF to ${targetEmail} (Attempt ${attempt}/${maxRetries})`,
      });

      return emailResult;
    } catch (err) {
      lastError = err;
      console.error(`Email attempt ${attempt}/${maxRetries} failed for invoice ${invoice.invoice_number}:`, err.message);

      await invoiceRepository.addLog({
        invoiceId: invoice.id,
        action: "Email Failed",
        performedBy,
        details: `Attempt ${attempt}/${maxRetries} failed to ${targetEmail}: ${err.message}`,
      });

      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  throw new Error(`Failed to send invoice email after ${maxRetries} attempts: ${lastError?.message}`);
};

module.exports = {
  sendEmail,
  sendInvoiceEmailWithRetry,
};
