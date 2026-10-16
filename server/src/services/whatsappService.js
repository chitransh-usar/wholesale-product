const Twilio = require("twilio");

const provider = process.env.WHATSAPP_PROVIDER || "twilio";
const twilioClient = provider === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const sendWhatsApp = async ({ to, body, templateName, variables = {} }) => {
  if (!to || !body) throw new Error("WhatsApp recipient and message body are required");

  if (provider === "twilio") {
    if (!twilioClient) {
      throw new Error("Twilio WhatsApp is not configured properly");
    }

    const messageText = templateName ? `${templateName}: ${body}` : body;
    const message = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${to}`,
      body: messageText,
    });
    return { provider: "twilio_whatsapp", response: message };
  }

  throw new Error(`Unsupported WhatsApp provider: ${provider}`);
};

module.exports = {
  sendWhatsApp,
};
