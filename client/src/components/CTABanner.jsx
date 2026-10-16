import { useNavigate } from "react-router-dom";
import { ArrowRight, Store } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const CTABanner = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  if (user?.role === "seller" || user?.role === "both") {
    return null;
  }

  const handleActionClick = () => {
    if (!isAuthenticated) {
      navigate("/signup?role=seller");
    } else {
      navigate("/seller/settings");
    }
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg mt-8 overflow-hidden relative shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200">
      <div
        className="h-1.5 w-full opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--color-clay) 0px, var(--color-clay) 7px, transparent 7px, transparent 14px)",
        }}
      />

      <div className="px-5 py-7 sm:px-8 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-6 sm:gap-8">
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left max-w-2xl">
          <div className="inline-flex items-center gap-1.5 bg-cream border border-clay/30 text-clay text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-sm mb-3">
            <Store className="w-3 h-3 sm:w-3.5 sm:h-3.5" strokeWidth={2.5} />
            <span>For sellers</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight mb-2">
            List your inventory where wholesalers are already buying
          </h2>

          <p className="text-sm text-slate-500 leading-relaxed mb-4 sm:mb-5">
            Set your own price tiers, take orders directly, and get paid without
            a middleman.
          </p>

          <div className="flex flex-wrap items-stretch justify-center sm:justify-start gap-2">
            <div className="font-mono text-[11px] sm:text-xs text-slate-600 border border-slate-200 rounded-sm px-2.5 py-1">
              <span className="text-slate-900 font-bold">12,400+</span> buyers
            </div>
            <div className="font-mono text-[11px] sm:text-xs text-slate-600 border border-slate-200 rounded-sm px-2.5 py-1">
              <span className="text-slate-900 font-bold">850+</span> sellers
            </div>
            <div className="font-mono text-[11px] sm:text-xs text-slate-600 border border-slate-200 rounded-sm px-2.5 py-1">
              <span className="text-slate-900 font-bold">₹2.4Cr+</span> monthly
              GMV
            </div>
          </div>
        </div>
        <div className="hidden sm:block self-stretch border-l border-dashed border-slate-200" />

        <button
          onClick={handleActionClick}
          className="group flex items-center justify-center gap-2 bg-clay text-white px-6 py-2.5 rounded-sm font-semibold text-sm hover:bg-clay/90 transition-colors cursor-pointer w-full sm:w-auto shrink-0 shadow-sm"
        >
          <span>Become a seller</span>
          <ArrowRight className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
};

export default CTABanner;
