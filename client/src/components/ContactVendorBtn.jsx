import { useState } from "react";
import { MessageSquare } from "lucide-react";
import ContactChoiceModal from "./ContactChoiceModal";
import WhatsAppModal from "./WhatsAppModal";
import api from "../utils/axios";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

const ContactVendorBtn = ({
  vendorId,
  vendorName,
  company,
  productName,
  vendorPhone,
  productId,
  trigger,
}) => {
  const { user } = useAuth();
  // Nobody should be able to open a conversation with themselves. The server
  // rejects it on both the socket and the REST routes, so surfacing the entry
  // point here would only ever lead to an error.
  const isOwnListing =
    user?.id != null && vendorId != null && String(user.id) === String(vendorId);

  const [view, setView] = useState(null); // null | "choice" | "whatsapp"
  const [loading, setLoading] = useState(false);
  const [dynamicWhatsappUrl, setDynamicWhatsappUrl] = useState(null);
  const [resolvedPhone, setResolvedPhone] = useState(null);
  const openChoice = () => setView("choice");

  const handleWhatsAppClick = async () => {
    if (productId) {
      setLoading(true);
      try {
        const response = await api.get(`/api/products/${productId}/contact`, {
          params: { supplierId: vendorId },
        });

        if (response.data.success && response.data.whatsappUrl) {
          setDynamicWhatsappUrl(response.data.whatsappUrl);
          // The phone lets the modal compose the buyer's own message
          if (response.data.phone) setResolvedPhone(response.data.phone);
          setView("whatsapp");
        } else {
          toast.error(
            response.data.message || "Failed to generate WhatsApp link",
          );
        }
      } catch (error) {
        console.error("Failed to contact supplier:", error);
        if (error.response?.status === 401) {
          toast.error("Please login to contact suppliers");
        } else if (error.response?.status === 403) {
          toast.error("Only buyers can contact suppliers");
        } else {
          toast.error("Failed to connect with supplier");
        }
      } finally {
        setLoading(false);
      }
    } else {
      // Fallback to hardcoded phone if no productId
      setView("whatsapp");
    }
  };

  if (isOwnListing) return null;

  return (
    <>
      {trigger ? (
        trigger(openChoice)
      ) : (
        <button
          type="button"
          onClick={openChoice}
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 sm:gap-2 py-3 bg-transparent text-espresso border border-sage/50 rounded-xl hover:bg-sage/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Contact ${vendorName} about ${productName}`}
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-espresso border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-bold">Loading...</span>
            </>
          ) : (
            <>
              <MessageSquare className="w-5 h-5 shrink-0" />
              <span className="text-sm font-bold">Message Supplier</span>
            </>
          )}
        </button>
      )}

      {view === "choice" && (
        <ContactChoiceModal
          vendorId={vendorId}
          vendorName={vendorName}
          company={company}
          productName={productName}
          onClose={() => setView(null)}
          onSelectWhatsApp={handleWhatsAppClick}
        />
      )}

      {view === "whatsapp" && (
        <WhatsAppModal
          vendorName={vendorName}
          productName={productName}
          vendorPhone={resolvedPhone || vendorPhone}
          productImage={undefined}
          dynamicWhatsappUrl={dynamicWhatsappUrl}
          onBack={() => setView("choice")}
          onClose={() => setView(null)}
        />
      )}
    </>
  );
};

export default ContactVendorBtn;
