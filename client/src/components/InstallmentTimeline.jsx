import { CheckCircle2, Clock, CreditCard, ShieldCheck } from "lucide-react";

const InstallmentTimeline = ({ payments = [], totalAmount = 0, paymentPlan = "full" }) => {
  // If paymentPlan is installment_50_50, ensure we construct full 2-stage history array if missing stage 2
  let items = [...payments];

  if (paymentPlan === "installment_50_50" && items.length < 2) {
    const hasInitial = items.some(p => p.installmentNumber === 1);
    if (!hasInitial) {
      const initialAmt = Number((totalAmount * 0.5).toFixed(2));
      items.push({
        installmentNumber: 1,
        paymentType: "initial",
        amount: initialAmt,
        status: "pending",
        createdAt: null
      });
    }
    const hasRemaining = items.some(p => p.installmentNumber === 2);
    if (!hasRemaining) {
      const initialPaid = items.find(p => p.installmentNumber === 1 && p.status === "paid");
      const remAmt = initialPaid 
        ? Number((totalAmount - Number(initialPaid.amount)).toFixed(2))
        : Number((totalAmount * 0.5).toFixed(2));
      
      items.push({
        installmentNumber: 2,
        paymentType: "remaining",
        amount: remAmt,
        status: "pending",
        createdAt: null
      });
    }
  }

  // Sort by installment number
  items.sort((a, b) => (a.installmentNumber || 1) - (b.installmentNumber || 1));

  const formatType = (type, num) => {
    if (type === "initial") return "Initial Installment (50%)";
    if (type === "remaining") return "Remaining Installment (50%)";
    if (type === "full") return "Full Payment (100%)";
    return `Installment #${num}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-clay" />
          <h3 className="font-bold text-slate-900 text-base">Payment History</h3>
        </div>
        {paymentPlan === "installment_50_50" && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-clay/10 text-clay border border-clay/20">
            2 Installments (50/50 Plan)
          </span>
        )}
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 py-2">No payment transactions recorded yet.</p>
        ) : (
          items.map((item, idx) => {
            const isPaid = item.status === "paid" || item.status === "completed";
            const dateText = formatDate(item.createdAt);

            return (
              <div
                key={item.id || idx}
                className={`p-4 rounded-xl border transition-all ${
                  isPaid
                    ? "bg-emerald-50/40 border-emerald-200"
                    : "bg-amber-50/30 border-amber-200"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                        isPaid
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {item.installmentNumber || idx + 1}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900">
                        {formatType(item.paymentType, item.installmentNumber || idx + 1)}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                        {isPaid ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline" />
                            <span className="text-emerald-700 font-medium">Paid on {dateText}</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3.5 h-3.5 text-amber-600 inline" />
                            <span className="text-amber-700 font-medium">Pending Payment</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-base font-black text-slate-900 block">
                      ₹{Number(item.amount || 0).toLocaleString("en-IN")}
                    </span>
                    <span
                      className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border mt-1 ${
                        isPaid
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : "bg-amber-100 text-amber-800 border-amber-300"
                      }`}
                    >
                      {isPaid ? "Paid ✓" : "Pending"}
                    </span>
                  </div>
                </div>

                {item.upiTransactionReference && (
                  <div className="mt-2.5 pt-2 border-t border-emerald-200/60 flex items-center gap-2 text-xs text-emerald-800 font-mono">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>UPI Ref: {item.upiTransactionReference}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default InstallmentTimeline;
