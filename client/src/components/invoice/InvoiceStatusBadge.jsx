const STYLES = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  "partial paid": "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-clay/10 text-clay border-clay/30",
  generated: "bg-clay/10 text-clay border-clay/30",
  overdue: "bg-rose-50 text-rose-700 border-rose-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-600 border-slate-300",
  refunded: "bg-slate-100 text-slate-600 border-slate-300",
  draft: "bg-sage/10 text-sage border-sage/30",
  sent: "bg-sage/10 text-sage border-sage/30",
  viewed: "bg-sage/10 text-sage border-sage/30",
};

const FALLBACK = "bg-slate-100 text-slate-600 border-slate-200";

export default function InvoiceStatusBadge({ status, className = "" }) {
  if (!status) return null;

  const normalized = String(status).trim();
  const badgeStyles = STYLES[normalized.toLowerCase()] || FALLBACK;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors duration-150 ${badgeStyles} ${className}`}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-75" />
      {normalized}
    </span>
  );
}
