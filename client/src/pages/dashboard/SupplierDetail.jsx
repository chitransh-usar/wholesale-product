import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, TriangleAlert } from "lucide-react";
import api from "../../utils/axios";
import PaidInFull from "../../components/PaidInFull";
import { toast } from "sonner";
import { money, dateLabel } from "../../utils/money";

/**
 * One supplier: what they have billed, what has been paid, and what is left.
 *
 * The payment box offers a bill to pay against, and "nothing in particular".
 * Both are real. A trader pays a round sum across several old bills without
 * saying which, and forcing them to allocate it makes them invent an allocation,
 * which is worse data than none. Money against no bill sits on the account and
 * comes off the balance either way.
 */

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-600",
  received: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const SupplierDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  // See the note on PurchaseDetail: "not set up" and "not found" are different
  // answers, and showing the second for the first loses a supplier on screen.
  const [notSetUp, setNotSetUp] = useState(false);
  const [payment, setPayment] = useState({
    amount: "",
    method: "cash",
    paidOn: new Date().toISOString().slice(0, 10),
    purchaseId: "",
    note: "",
  });

  const load = async () => {
    try {
      const { data: body } = await api.get(`/api/suppliers/${id}`);
      setData(body);
      setNotSetUp(false);
    } catch (error) {
      if (error.response?.data?.code === "PURCHASES_NOT_SET_UP") {
        setNotSetUp(true);
      } else {
        toast.error(
          error.response?.status === 404
            ? "That supplier is not in your book."
            : "Could not load this supplier.",
        );
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    let alive = true;
    api
      .get(`/api/suppliers/${id}`)
      .then(({ data: body }) => {
        if (!alive) return;
        setData(body);
        setLoading(false);
      })
      .catch((error) => {
        if (!alive) return;
        if (error.response?.data?.code === "PURCHASES_NOT_SET_UP") {
          setNotSetUp(true);
        } else {
          toast.error(
            error.response?.status === 404
              ? "That supplier is not in your book."
              : "Could not load this supplier.",
          );
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const pay = async (e) => {
    e.preventDefault();
    if (!(Number(payment.amount) > 0)) {
      toast.error("Enter how much was paid.");
      return;
    }
    setPaying(true);
    try {
      await api.post(`/api/suppliers/${id}/payments`, {
        amount: payment.amount,
        method: payment.method,
        paidOn: payment.paidOn,
        note: payment.note || undefined,
        purchaseId: payment.purchaseId || undefined,
      });
      toast.success("Payment recorded.");
      setPayment((prev) => ({ ...prev, amount: "", note: "", purchaseId: "" }));
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not record that payment.");
    }
    setPaying(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (notSetUp) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <TriangleAlert className="mx-auto mb-3 h-10 w-10 text-amber-400" />
        <p className="font-semibold text-espresso">
          The purchase book is not switched on yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Its tables have not been added to this database, so nothing can be
          read back. This supplier is not lost.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">Supplier not found</p>
        <button
          onClick={() => navigate("/seller/suppliers")}
          className="mt-5 rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          Back to suppliers
        </button>
      </div>
    );
  }

  const { supplier, purchases, payments } = data;
  const balance = Number(supplier.balance || 0);
  // Only a live bill with something left on it can be paid against. A
  // cancelled one is refused by the server, so offering it here would be an
  // invitation to an error message.
  const payable = purchases.filter(
    (purchase) =>
      purchase.status === "received" &&
      Number(purchase.total) - Number(purchase.paid) > 0,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition-colors hover:text-clay"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-espresso">{supplier.name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {[supplier.business_name, supplier.city, supplier.phone]
              .filter(Boolean)
              .join(" · ") || "No contact details recorded"}
          </p>
          {supplier.gstin ? (
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              GST {supplier.gstin}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-amber-700">
              No GST number recorded, so their bills carry no input credit.
            </p>
          )}
        </div>
        <Link
          to={`/seller/purchases/new?supplier=${supplier.id}`}
          className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          <Plus className="h-4 w-4" />
          Enter a bill
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {balance > 0
            ? "You owe them"
            : balance < 0
              ? "They are holding your money"
              : "Settled"}
        </p>
        <p
          className={`mt-1 text-3xl font-black ${
            balance > 0
              ? "text-amber-600"
              : balance < 0
                ? "text-emerald-600"
                : "text-espresso"
          }`}
        >
          ₹{money(Math.abs(balance))}
        </p>
      </div>

      {/* Record a payment */}
      <form
        onSubmit={pay}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
          Record money paid to them
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="pay-amount"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Amount
            </label>
            <input
              id="pay-amount"
              value={payment.amount}
              onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-clay"
            />
            {/* Only when there is a balance to clear. A supplier who is square,
                or who owes US money, has no "in full" to offer. */}
            <div className="mt-2">
              <PaidInFull
                id="supplier-paid-in-full"
                total={balance > 0 ? balance : 0}
                value={payment.amount}
                onChange={(next) => setPayment({ ...payment, amount: next })}
                label="Clearing everything you owe them"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="pay-method"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              How
            </label>
            <select
              id="pay-method"
              value={payment.method}
              onChange={(e) => setPayment({ ...payment, method: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-clay"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="pay-date"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              When
            </label>
            <input
              id="pay-date"
              type="date"
              value={payment.paidOn}
              onChange={(e) => setPayment({ ...payment, paidOn: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-clay"
            />
          </div>
          <div>
            <label
              htmlFor="pay-against"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Against
            </label>
            <select
              id="pay-against"
              value={payment.purchaseId}
              onChange={(e) =>
                setPayment({ ...payment, purchaseId: e.target.value })
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-clay"
            >
              <option value="">Nothing in particular</option>
              {payable.map((purchase) => (
                <option key={purchase.id} value={purchase.id}>
                  {purchase.purchase_number} · ₹
                  {money(Number(purchase.total) - Number(purchase.paid))} left
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">
              Leave as is if it is a round sum against the account.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="pay-note"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Note
            </label>
            <input
              id="pay-note"
              value={payment.note}
              onChange={(e) => setPayment({ ...payment, note: e.target.value })}
              placeholder="Cheque number, or anything worth remembering"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-clay"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={paying}
          className="rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
        >
          {paying ? "Saving..." : "Record payment"}
        </button>
      </form>

      {/* Their bills */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Their bills
          </h3>
        </div>
        {purchases.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No bills from them yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {purchases.map((purchase) => {
              const due = Number(purchase.total) - Number(purchase.paid);
              return (
                <li key={purchase.id}>
                  <Link
                    to={`/seller/purchases/${purchase.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-espresso">
                        {purchase.purchase_number}
                        {purchase.supplier_invoice_number
                          ? ` · their bill ${purchase.supplier_invoice_number}`
                          : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        {dateLabel(purchase.purchase_date)}
                      </p>
                    </div>
                    <span
                      className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider sm:inline ${
                        STATUS_STYLES[purchase.status] || STATUS_STYLES.draft
                      }`}
                    >
                      {purchase.status}
                    </span>
                    <div className="w-24 shrink-0 text-right">
                      <p className="text-sm font-black text-espresso">
                        ₹{money(purchase.total)}
                      </p>
                      {purchase.status !== "cancelled" && due > 0 && (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                          ₹{money(due)} left
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Money paid to them */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Money paid to them
          </h3>
        </div>
        {payments.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            Nothing paid to them yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-espresso">
                    {dateLabel(entry.paid_on)}
                  </p>
                  <p className="truncate text-xs capitalize text-slate-500">
                    {entry.method}
                    {entry.purchase_id ? "" : " · on account"}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-black text-espresso">
                  ₹{money(entry.amount, { document: true })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {supplier.notes && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Your private note
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
            {supplier.notes}
          </p>
        </div>
      )}
    </div>
  );
};

export default SupplierDetail;
