const Twilio = require("twilio");

const provider = process.env.SMS_PROVIDER || "twilio";

const twilioClient = provider === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const sendSms = async ({ to, body }) => {
  if (!to || !body) throw new Error("SMS recipient and message body are required");

  if (provider === "twilio") {
    if (!twilioClient) {
      throw new Error("Twilio is not configured properly");
    }
    const message = await twilioClient.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to,
      body,
    });
    return { provider: "twilio", response: message }; 
  }

  throw new Error(`Unsupported SMS provider: ${provider}`);
};

module.exports = {
  sendSms,
};
