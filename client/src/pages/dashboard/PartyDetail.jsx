import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import RecordPaymentModal from "../../components/RecordPaymentModal";
import PartyFormModal from "../../components/PartyFormModal";
import { money, dateLabel } from "../../utils/money";

// A plain capitalize turns "upi" into "Upi", which looks like a typo.
const METHOD_LABELS = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-600",
  confirmed: "bg-sky-50 text-sky-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const PartyDetail = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  // Bumped after a payment is recorded so the balance and both lists reload.
  const [refreshKey, setRefreshKey] = useState(0);
  // Money of their the wholesaler is holding loose, and what it could be set
  // against. Asked for separately because the balance on this page nets the
  // two together and so cannot answer it: the moment they orders again, their
  // credit is cancelled out by the new bill and the page reads zero.
  const [credit, setCredit] = useState(null);
  const [applying, setApplying] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get(`/api/parties/${id}`);
        if (alive) setData(res.data);
      } catch (error) {
        console.error("Failed to load customer", error);
        if (alive) {
          toast.error(
            error.response?.status === 404
              ? "That customer is not in your list."
              : "Could not load this customer.",
          );
        }
      }
      // A 403 here is an employee without the payments permission, which is
      // not an error worth shouting about: the panel simply does not appear.
      try {
        const res = await api.get(`/api/parties/${id}/credit`);
        if (alive) setCredit(res.data);
      } catch {
        if (alive) setCredit(null);
      }

      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [id, refreshKey]);

  const setAgainst = async (target) => {
    setApplying(target.saleId);
    try {
      const { data: done } = await api.post(`/api/parties/${id}/credit`, {
        saleId: target.saleId,
      });
      toast.success(
        `₹${money(done.applied)} set against ${done.saleNumber}.` +
          (done.creditLeft > 0 ? ` ₹${money(done.creditLeft)} of their money left.` : ""),
      );
      setRefreshKey((k) => k + 1);
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Could not set this against that bill.",
      );
    }
    setApplying("");
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">Customer not found</p>
        <Link
          to="/seller/customers"
          className="mt-4 inline-block text-sm font-bold text-clay hover:underline"
        >
          Back to my customers
        </Link>
      </div>
    );
  }

  const { party, sales, payments } = data;
  const due = Number(party.outstanding || 0);
  const creditLimit = Number(party.credit_limit || 0);
  const digits = String(party.phone || "").replace(/\D/g, "");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        to="/seller/customers"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition-colors hover:text-clay"
      >
        <ArrowLeft className="h-4 w-4" />
        My customers
      </Link>

      {/* Who they are, and what they owe */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-clay/10 text-xl font-black text-clay">
              {String(party.name || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-black text-espresso">
                {party.name}
              </h2>
              {party.business_name && (
                <p className="truncate text-sm font-semibold text-slate-500">
                  {party.business_name}
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
                {party.city && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {party.city}
                  </span>
                )}
                {party.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {party.phone}
                  </span>
                )}
                {party.gstin && (
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {party.gstin}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="w-full text-left sm:w-auto sm:text-right">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {due < 0 ? "They have paid extra" : "Outstanding"}
            </p>
            <p
              className={`text-3xl font-black ${
                due > 0
                  ? "text-espresso"
                  : due < 0
                    ? "text-sky-700"
                    : "text-emerald-600"
              }`}
            >
              ₹{money(Math.abs(due))}
            </p>
            <p className="text-xs font-medium text-slate-500">
              {due > 0
                ? "Still to be received"
                : due < 0
                  ? "In credit with you"
                  : "Account settled"}
            </p>
            {/* The credit limit, beside the balance it is a limit ON. It was
                stored, importable and editable and appeared on no screen, so
                the one place a wholesaler looks before extending more credit
                did not tell him what he had decided. */}
            {creditLimit > 0 && (
              <p
                className={`mt-1.5 text-xs font-bold ${
                  due > creditLimit ? "text-rose-600" : "text-slate-500"
                }`}
              >
                Limit ₹{money(creditLimit)}
                {due > creditLimit
                  ? ` · over by ₹${money(due - creditLimit)}`
                  : ""}
              </p>
            )}
          </div>
        </div>

        {/* Money of their that nothing is standing against.
            
            Shown apart from the balance above, because that balance is one
            netted number and netting is what hid this: they return a 2 lakh
            order, orders 4 lakh, and their page reads zero while 2 lakh of their
            money is plainly still in the till. Then they pay the bill in full
            and the 2 lakh reappears as a debt the wholesaler owes. */}
        {credit && credit.credit > 0 && (
          <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <p className="text-sm font-bold text-sky-900">
              You are holding ₹{money(credit.credit)} of their money
            </p>
            <p className="mt-1 text-xs text-sky-800">
              {credit.targets.length > 0
                ? "They paid for something that was cancelled or came back. Set it against a bill of their, or pay it back."
                : "They paid for something that was cancelled or came back. They have no unpaid bill to set it against, so pay it back."}
            </p>
            {credit.targets.length > 0 && (
              <ul className="mt-3 space-y-2">
                {credit.targets.map((t) => (
                  <li
                    key={t.saleId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-bold text-espresso">
                        {t.saleNumber}
                      </span>
                      {t.orderNumber ? (
                        <span className="text-slate-500"> · {t.orderNumber}</span>
                      ) : null}
                      <span className="text-slate-500">
                        {" "}· ₹{money(t.outstanding)} owed
                      </span>
                    </span>
                    <button
                      onClick={() => setAgainst(t)}
                      disabled={Boolean(applying)}
                      className="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-sky-800 disabled:opacity-50"
                    >
                      {applying === t.saleId
                        ? "Setting..."
                        : `Put ₹${money(t.canApply)} against it`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
          <Link
            to={`/seller/sales/new?party=${party.id}`}
            className="flex items-center gap-2 rounded-lg bg-espresso px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-clay"
          >
            <Plus className="h-4 w-4" />
            Record a sale
          </Link>
          <button
            onClick={() => setShowPayment(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Wallet className="h-4 w-4" />
            Record payment
          </button>
          {/* The page above shows the latest fifty of each. The statement is
              the whole account over a period, with a running balance, which
              is the thing you send when you want paying. */}
          <Link
            to={`/seller/customers/${party.id}/statement`}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" />
            Statement
          </Link>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
          {digits && (
            <>
              <a
                href={`tel:${party.phone}`}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <Phone className="h-4 w-4" />
                Call
              </a>
              <a
                href={`https://wa.me/${digits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sales */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-4">
            <Receipt className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Sales
            </h3>
          </div>

          {sales.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-semibold text-espresso">
                No sales recorded yet
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">
                Once you record a sale for this customer, it will show here with
                its running balance.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <Link
                    to={`/seller/sales/${sale.id}`}
                    className="flex items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-espresso">
                        {sale.sale_number || "Sale"}
                      </p>
                      <p className="text-xs font-medium text-slate-500">
                        {dateLabel(sale.sale_date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          STATUS_STYLES[sale.status] || STATUS_STYLES.draft
                        }`}
                      >
                        {sale.status}
                      </span>
                      <p className="w-20 text-right text-sm font-black text-espresso">
                        ₹{money(sale.total)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Payments */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-4">
            <Wallet className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Payments received
            </h3>
          </div>

          {payments.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-semibold text-espresso">
                No payments recorded yet
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">
                Money you receive from this customer gets recorded here and
                comes off their outstanding.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center justify-between gap-3 px-6 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-espresso">
                      {METHOD_LABELS[payment.method] || payment.method}
                    </p>
                    <p className="text-xs font-medium text-slate-500">
                      {dateLabel(payment.paid_on)}
                      {payment.note ? ` · ${payment.note}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-black text-emerald-700">
                    ₹{money(payment.amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {party.notes && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">
            Notes
          </h3>
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {party.notes}
          </p>
        </div>
      )}

      {showEdit && (
        <PartyFormModal
          party={party}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setShowEdit(false);
            toast.success(`${updated.name} saved.`);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      {showPayment && (
        <RecordPaymentModal
          partyId={party.id}
          partyName={party.name}
          outstanding={due}
          sales={sales}
          onClose={() => setShowPayment(false)}
          onSaved={() => {
            setShowPayment(false);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}
    </div>
  );
};

export default PartyDetail;
