import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Pencil, ShieldOff, TriangleAlert } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { money, dateLabel } from "../../utils/money";

/**
 * One supplier bill in full.
 *
 * The money figures all come from the server's `settlement` block rather than
 * being summed here. That is not caution for its own sake: four screens in
 * this product once each worked out what a sale had received in their own way
 * and three of them disagreed. One rule, on the server, read by whatever needs
 * it.
 */

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-600",
  received: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const PurchaseDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  /**
   * The migration not having been run is NOT the same as the purchase not
   * existing, and saying "Purchase not found" when the tables are absent tells
   * a wholesaler their bill has been lost. Distinguished here on the code the
   * server sends, the same way the list screens do it.
   */
  const [notSetUp, setNotSetUp] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/api/purchases/${id}`);
      setData(body);
      setNotSetUp(false);
    } catch (error) {
      if (error.response?.data?.code === "PURCHASES_NOT_SET_UP") {
        setNotSetUp(true);
      } else {
        toast.error(
          error.response?.status === 404
            ? "That purchase is not in your book."
            : "Could not load this purchase.",
        );
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    let alive = true;
    api
      .get(`/api/purchases/${id}`)
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
              ? "That purchase is not in your book."
              : "Could not load this purchase.",
          );
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const cancel = async () => {
    if (
      !window.confirm(
        "Cancel this purchase? It stops counting towards what you owe. Money already paid stays on the supplier's account.",
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      const { data: body } = await api.patch(`/api/purchases/${id}/status`, {
        status: "cancelled",
      });
      toast.success(
        Number(body.releasedToAccount) > 0
          ? `Cancelled. ₹${money(body.releasedToAccount)} already paid is now on their account.`
          : "Cancelled.",
      );
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not cancel this purchase.");
    }
    setWorking(false);
  };

  const receive = async () => {
    setWorking(true);
    try {
      await api.patch(`/api/purchases/${id}/status`, { status: "received" });
      toast.success("Marked received.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not update this purchase.");
    }
    setWorking(false);
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
          read back. This purchase is not lost.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">Purchase not found</p>
        <button
          onClick={() => navigate("/seller/purchases")}
          className="mt-5 rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          Back to purchases
        </button>
      </div>
    );
  }

  const { purchase, lines, payments, settlement, inputTaxCredit } = data;
  const cancelled = purchase.status === "cancelled";

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
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black text-espresso">
              {purchase.purchase_number}
            </h2>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                STATUS_STYLES[purchase.status] || STATUS_STYLES.draft
              }`}
            >
              {purchase.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            From{" "}
            <Link
              to={`/seller/suppliers/${purchase.supplier_id}`}
              className="font-bold text-clay hover:underline"
            >
              {purchase.supplier_name}
            </Link>{" "}
            · {dateLabel(purchase.purchase_date)}
          </p>
        </div>

        {!cancelled && (
          <div className="flex flex-wrap gap-2">
            {purchase.status === "draft" && (
              <button
                onClick={receive}
                disabled={working}
                className="rounded-lg bg-clay px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
              >
                Mark received
              </button>
            )}
            <Link
              to={`/seller/purchases/${id}/edit`}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
            <button
              onClick={cancel}
              disabled={working}
              className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-4 py-2 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-60"
            >
              <Ban className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Their bill reference, given its own strip because it is the thing a
          wholesaler comes to this page looking for when a return does not
          match what the supplier filed. */}
      {(purchase.supplier_invoice_number || purchase.supplier_gstin) && (
        <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Their bill number
            </p>
            <p className="mt-0.5 text-sm font-bold text-espresso">
              {purchase.supplier_invoice_number || "Not recorded"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Date on their bill
            </p>
            <p className="mt-0.5 text-sm font-bold text-espresso">
              {purchase.supplier_invoice_date
                ? dateLabel(purchase.supplier_invoice_date)
                : dateLabel(purchase.purchase_date)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Their GST number
            </p>
            <p className="mt-0.5 text-sm font-bold text-espresso">
              {purchase.supplier_gstin || "Not registered"}
            </p>
          </div>
        </div>
      )}

      {/* The lines */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            What you bought
          </h3>
        </div>
        <ul className="divide-y divide-slate-100">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start gap-4 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-espresso">
                  {line.item_name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {Number(line.quantity)} {line.unit || ""} × ₹
                  {money(line.rate, { document: true })}
                  {line.hsn_code ? ` · HSN ${line.hsn_code}` : ""}
                  {Number(line.gst_percent) > 0
                    ? ` · GST ${Number(line.gst_percent)}%`
                    : " · no GST"}
                </p>
                {line.itc_eligible === false && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <ShieldOff className="h-3 w-3" />
                    No input credit on this line
                  </p>
                )}
              </div>
              <p className="shrink-0 text-sm font-black text-espresso">
                ₹{money(line.amount, { document: true })}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* What it came to, and what is left */}
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Their bill
          </h3>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Goods</span>
            <span className="font-bold text-espresso">
              ₹{money(purchase.subtotal, { document: true })}
            </span>
          </div>
          {Number(purchase.discount) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Less discount</span>
              <span className="font-bold text-espresso">
                -₹{money(purchase.discount, { document: true })}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">GST</span>
            <span className="font-bold text-espresso">
              ₹{money(purchase.tax_amount, { document: true })}
            </span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-3">
            <span className="text-sm font-bold text-espresso">Bill total</span>
            <span className="text-lg font-black text-espresso">
              ₹{money(settlement.total, { document: true })}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Paid</span>
            <span className="font-bold text-espresso">
              ₹{money(settlement.paid, { document: true })}
            </span>
          </div>
          {!cancelled && (
            <div className="flex justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-bold text-espresso">You owe</span>
              <span
                className={`text-lg font-black ${
                  settlement.settled ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                ₹{money(settlement.outstanding, { document: true })}
              </span>
            </div>
          )}
          {cancelled && (
            <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
              This purchase is cancelled, so nothing is owed on it. Anything
              already paid is sitting on the supplier's account.
            </p>
          )}
          {!cancelled && !settlement.settled && (
            <Link
              to={`/seller/suppliers/${purchase.supplier_id}`}
              className="mt-2 block rounded-lg bg-clay px-4 py-2.5 text-center text-sm font-bold text-cream transition-colors hover:bg-espresso"
            >
              Record a payment
            </Link>
          )}
        </div>

        {/* Input tax credit */}
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Input tax credit
          </h3>
          <div className="flex justify-between">
            <span className="text-sm text-slate-500">Claimable on this bill</span>
            <span className="text-lg font-black text-espresso">
              ₹{money(inputTaxCredit.claimable, { document: true })}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            The GST on this bill that can be set against the GST you have
            charged your own customers.
          </p>
          {inputTaxCredit.blocked && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              A line on this bill is marked as carrying no input credit, so the
              claimable figure is less than the GST total above.
            </p>
          )}
          {!purchase.supplier_gstin && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              This supplier has no GST number recorded. A purchase from an
              unregistered dealer carries no input credit at all, so check
              whether this figure should be zero.
            </p>
          )}
          {cancelled && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              This purchase is cancelled, so nothing on it is claimable.
            </p>
          )}
        </div>
      </div>

      {/* Money paid against this bill */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Money paid against this bill
          </h3>
        </div>
        {payments.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Nothing paid against this bill yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-espresso">
                    {dateLabel(payment.paid_on)}
                  </p>
                  <p className="text-xs capitalize text-slate-500">
                    {payment.method}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-black text-espresso">
                  ₹{money(payment.amount, { document: true })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {purchase.notes && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Note
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
            {purchase.notes}
          </p>
        </div>
      )}
    </div>
  );
};

export default PurchaseDetail;
