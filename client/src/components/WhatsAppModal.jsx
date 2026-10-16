import { useState } from "react";
import { MessageCircle, ArrowLeft, X, Sparkles } from "lucide-react";
import ModalShell from "./ModalShell";

const WhatsAppModal = ({
  vendorName,
  productName,
  vendorPhone,
  productImage,
  dynamicWhatsappUrl,
  onBack,
  onClose,
}) => {
  const defaultMessage = `Hi ${vendorName || "seller"}, I'm interested in ${productName || "this product"} and would like to discuss pricing and availability.`;
  const [message, setMessage] = useState(defaultMessage);

  // Always compose the URL from the buyer's chosen message. Previously the
  // API URL short-circuited this, so the suggestions and the custom textarea
  // were silently discarded and everyone sent the same server-side default.
  const whatsappUrl = (() => {
    // Prefer an explicit phone; otherwise recover it from the API URL.
    let phone = String(vendorPhone || "").replace(/\D/g, "");
    if (!phone && dynamicWhatsappUrl) {
      const match = String(dynamicWhatsappUrl).match(/wa\.me\/(\d+)/);
      if (match) phone = match[1];
    }
    if (!phone) return dynamicWhatsappUrl || "";
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  })();

  const suggestedMessages = [
    {
      label: "Pricing & Info",
      text: defaultMessage,
    },
    {
      label: "Bulk & MOQ",
      text: `Hello! What's the minimum order quantity and bulk pricing for ${productName || "this product"}?`,
    },
    {
      label: "Stock & Delivery",
      text: `Hi, can you share stock availability and delivery timeline for ${productName || "this product"}?`,
    },
    {
      label: "Best Offer",
      text: `Hello, I'm comparing suppliers - what's your best offer for ${productName || "this product"}?`,
    },
  ];

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between gap-3 p-5 sm:p-6 pb-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <div className="flex items-center gap-2 text-emerald-600">
            <MessageCircle className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-widest">
              WhatsApp
            </span>
          </div>
        )}

        <button
          onClick={onClose}
          className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-5 sm:px-6 flex flex-col gap-6">
        <div>
          <h3 className="text-xl font-bold text-slate-900 leading-tight">
            Message {vendorName || "the seller"}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Connect directly to negotiate terms.
          </p>
        </div>

        {/* NEW: Show a small preview of what will be linked */}
        {productImage && (
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-2 rounded-lg">
            <img
              src={productImage}
              alt={productName}
              className="w-10 h-10 object-cover rounded border border-slate-200"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-700 truncate">
                {productName}
              </p>
              <p className="text-[10px] text-slate-500">
                Image link will be attached
              </p>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Quick Replies
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {suggestedMessages.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => setMessage(suggestion.text)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition-all duration-200 border cursor-pointer ${
                  message === suggestion.text
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/50"
                }`}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Your Message
          </label>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 resize-none shadow-sm"
          />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3 p-5 sm:p-6 pt-0">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
        >
          Cancel
        </button>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          onClick={onClose}
          className="flex flex-2 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 shadow-sm cursor-pointer"
        >
          <MessageCircle className="h-4 w-4" />
          Send on WhatsApp
        </a>
      </div>
    </ModalShell>
  );
};

export default WhatsAppModal;
