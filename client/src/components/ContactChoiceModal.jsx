import {
  MessageCircle,
  MessageSquareText,
  X,
  ChevronRight,
} from "lucide-react";
import ModalShell from "./ModalShell";
import { useLocation, useNavigate } from "react-router-dom";

const ContactChoiceModal = ({
  vendorId,
  vendorName,
  company,
  productName,
  onClose,
  onSelectWhatsApp,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  // Stay within the current shell (dashboard vs marketplace)
  const basePath = location.pathname.startsWith("/seller")
    ? "/seller/messages"
    : "/messages";

  const handleSelectChat = () => {
    onClose();
    navigate(`${basePath}/${vendorId}`, {
      state: {
        openChat: {
          vendorId,
          vendorName,
          company,
          productName,
        },
      },
    });
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-clay">
              Contact Vendor
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">
              How would you like to reach {vendorName || "the seller"}?
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={onSelectWhatsApp}
            className="cursor-pointer flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-slate-900">
                WhatsApp
              </span>
              <span className="block text-xs text-slate-500">
                Opens a chat in a new tab
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-300" />
          </button>
          <button
            type="button"
            onClick={handleSelectChat}
            className="cursor-pointer flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-clay hover:bg-clay/5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-clay/10 text-clay">
              <MessageSquareText className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-slate-900">
                Message here
              </span>
              <span className="block text-xs text-slate-500">
                Keep the conversation in one place
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-300" />
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export default ContactChoiceModal;
