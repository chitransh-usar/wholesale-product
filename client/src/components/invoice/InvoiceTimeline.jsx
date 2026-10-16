import {
  Clock,
  CheckCircle2,
  Send,
  Eye,
  Download,
  AlertTriangle,
  ShieldCheck,
  IndianRupee,
} from "lucide-react";
import { dateLabel } from "../../utils/money";

export default function InvoiceTimeline({ logs = [] }) {
  if (!logs || logs.length === 0) return null;

  const getActionIcon = (action) => {
    switch (action.toLowerCase()) {
      case "created":
        return <Clock className="w-4 h-4 text-clay" />;
      case "sent":
        return <Send className="w-4 h-4 text-sage" />;
      case "viewed":
        return <Eye className="w-4 h-4 text-amber-500" />;
      case "downloaded":
        return <Download className="w-4 h-4 text-emerald-500" />;
      case "paid":
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      // Money in, but not all of it. Deliberately a different mark from
      // "paid", so a glance at the timeline does not read a part payment as a
      // settled bill.
      case "payment":
        return <IndianRupee className="w-4 h-4 text-amber-600" />;
      case "cancelled":
        return <AlertTriangle className="w-4 h-4 text-rose-500" />;
      default:
        return <ShieldCheck className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
      <h3 className="text-base font-bold text-espresso mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-sage" />
        Activity Timeline
      </h3>

      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {logs.map((log) => (
          <div key={log.id} className="relative flex items-start group">
            {/* Timeline Dot Icon */}
            <div className="absolute -left-6 top-0.5 p-1 bg-white border border-slate-200 rounded-full shadow-xs">
              {getActionIcon(log.action)}
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-espresso uppercase tracking-wider">
                  {log.action}
                </span>
                <span className="text-[11px] text-slate-400 font-medium">
                  {log.created_at ? dateLabel(log.created_at) : ""}
                </span>
              </div>

              <p className="text-xs text-espresso/60 mt-1">{log.details}</p>

              {log.performer_name && (
                <span className="inline-block mt-1 text-[10px] text-slate-400 font-medium">
                  By: {log.performer_name}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
