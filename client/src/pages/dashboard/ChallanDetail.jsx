import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, Pencil, Truck, XCircle } from "lucide-react";
import api from "../../utils/axios";
import { downloadFile } from "../../utils/download";
import { toast } from "sonner";
import { rupees, trimmed, dateLabel } from "../../utils/money";

/**
 * One challan in full.
 *
 * The list could only be downloaded from, so the only way to read what was
 * actually sent out was to open a PDF. That is a poor way to answer "what did
 * I send Ramesh on the 4th", and it is worse on a phone.
 *
 * Everything here is FROZEN on the document. The recipient's name, their GSTIN,
 * the quantities and the amount that had been received are all stored on the
 * challan row rather than joined from the customer or the sale, because this
 * is what the paper said on the day the goods were handed over. If the
 * customer later corrects their address, the challan they signed for does not
 * change. So nothing on this page is looked up live, and nothing is
 * recomputed: it is read back exactly as issued.
 *
 * A challan is NOT a tax invoice and carries no GST. The page says so, because
 * a wholesaler seeing a total and an HSN column could reasonably assume it is
 * a bill, and sending one instead of an invoice is their problem, not ours.
 */
const ChallanDetail = () => {
  const { challanId } = useParams();
  const navigate = useNavigate();
  const [challan, setChallan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  /**
   * Cancelled, never deleted. The paper went out of the gate and somebody may
   * still be holding it, so the record of what was sent has to survive being
   * wrong.
   */
  const cancelChallan = async () => {
    const reason = window.prompt("Why is this being cancelled?");
    if (reason === null) return;
    setCancelling(true);
    try {
      await api.post(`/api/challans/${challanId}/cancel`, { reason });
      toast.success("Cancelled. The record is kept.");
      navigate("/seller/challans");
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not cancel it.");
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get(`/api/challans/${challanId}`);
        if (alive) setChallan(data);
      } catch (error) {
        if (alive) {
          toast.error(
            error.response?.status === 404
              ? "That challan is not in your book."
              : "Could not load this challan.",
          );
        }
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [challanId]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(
        `/api/challans/${challanId}/pdf`,
        `${challan?.challan_number || "challan"}.pdf`,
      );
    } catch (err) {
      toast.error(err.message || "Could not download the challan");
    }
    setDownloading(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!challan) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <Truck className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="font-semibold text-espresso">Could not load this challan</p>
        <Link
          to="/seller/challans"
          className="mt-2 inline-block text-sm font-bold text-clay"
        >
          Back to challans
        </Link>
      </div>
    );
  }

  const items = challan.items || [];
  const total = Number(challan.total_value || 0);
  const paid = Number(challan.amount_paid || 0);
  const due = Math.max(total - paid, 0);

  const isPurchase = challan.kind === "purchase";
  // status is the authority. invoice_id alone said "not billed" on a billed
  // PURCHASE challan, which points at a purchase and never at an invoice.
  const billed =
    challan.status === "billed" || Boolean(challan.invoice_id || challan.purchase_id);
  const cancelled = challan.status === "cancelled";

  /**
   * Does this challan carry a money snapshot at all?
   *
   * Money having been RECEIVED, not "was it raised from a sale". The sale link
   * is not the marker it looks like: the server sets sale_id when a challan is
   * billed, so a movement challan acquires one the moment it is used, and the
   * block then reads "Received 0, Outstanding the lot" on a document whose
   * whole point is that nothing is owed until the bill.
   *
   * A part paid challan from the old payment-driven rule carries a real
   * snapshot and still shows it. One with nothing received has nothing to say.
   */
  const hasMoneySnapshot = paid > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <button
          onClick={() => navigate("/seller/challans")}
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-clay"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All challans
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-mono text-xl font-black text-espresso sm:text-2xl">
            {challan.challan_number}
          </h2>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              cancelled
                ? "bg-slate-100 text-slate-500"
                : billed
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            {cancelled ? "Cancelled" : billed ? "Billed" : "Not billed"}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {isPurchase ? "Received" : "Sent out"} {dateLabel(challan.issue_date)}
            {challan.sale_number ? ` · sale ${challan.sale_number}` : ""}
            {challan.purchase_number ? ` · purchase ${challan.purchase_number}` : ""}
            {challan.order_number ? ` · order ${challan.order_number}` : ""}
            {challan.supplier_challan_number
              ? ` · their challan ${challan.supplier_challan_number}`
              : ""}
          </p>
          <button
            onClick={download}
            disabled={downloading}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-espresso transition-colors hover:border-clay hover:text-clay disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Preparing..." : "PDF"}
          </button>
        </div>
      </div>

      {/* Said plainly rather than in small print. A page with a total and an
          HSN column looks like a bill, and this one is not. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs font-bold text-amber-900">
          This is a challan, not a tax invoice.
        </p>
        <p className="mt-0.5 text-xs text-amber-800">
          It carries no GST, so {isPurchase ? "you cannot" : "your customer cannot"}{" "}
          claim input credit on it.
          {billed
            ? isPurchase
              ? " The purchase for these goods has been entered."
              : " The bill for these goods has been raised."
            : isPurchase
              ? " Enter the purchase from it when the supplier's bill comes."
              : " Raise the bill from it when you are ready."}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Sent to. Frozen on the document, not joined from the customer. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {isPurchase ? "Received from" : "Sent to"}
          </h3>
          <p className="mt-2 font-bold text-espresso">
            {challan.recipient_name || "Customer"}
          </p>
          {challan.recipient_address && (
            <p className="mt-1 text-sm text-slate-600">
              {challan.recipient_address}
            </p>
          )}
          {challan.recipient_city && (
            <p className="text-sm text-slate-600">{challan.recipient_city}</p>
          )}
          {challan.recipient_phone && (
            <p className="mt-1 text-sm text-slate-500">
              {challan.recipient_phone}
            </p>
          )}
          {challan.recipient_gstin && (
            <p className="mt-1 font-mono text-xs text-slate-500">
              GSTIN {challan.recipient_gstin}
            </p>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            As it was written on the day the goods moved.
          </p>
        </div>

        {/* Sent by. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {isPurchase ? "Received by" : "Sent by"}
          </h3>
          <p className="mt-2 font-bold text-espresso">
            {challan.supplier?.company_name ||
              [challan.supplier?.first_name, challan.supplier?.last_name]
                .filter(Boolean)
                .join(" ") ||
              "You"}
          </p>
          {challan.supplier?.warehouse_address && (
            <p className="mt-1 text-sm text-slate-600">
              {challan.supplier.warehouse_address}
            </p>
          )}
          {challan.supplier?.warehouse_state && (
            <p className="text-sm text-slate-600">
              {challan.supplier.warehouse_state}
            </p>
          )}
          {(challan.supplier?.contact_phone || challan.supplier?.phone) && (
            <p className="mt-1 text-sm text-slate-500">
              {challan.supplier.contact_phone || challan.supplier.phone}
            </p>
          )}
          {challan.supplier?.gstin && (
            <p className="mt-1 font-mono text-xs text-slate-500">
              GSTIN {challan.supplier.gstin}
            </p>
          )}
        </div>
      </div>

      {/* What moved */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-espresso">
            {isPurchase ? "What came in" : "What went out"}
          </h3>
        </div>

        {items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No items were recorded on this challan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-2.5 text-left font-bold">Item</th>
                  <th className="px-3 py-2.5 text-center font-bold">HSN</th>
                  <th className="px-3 py-2.5 text-center font-bold">Qty</th>
                  <th className="px-3 py-2.5 text-right font-bold">Rate</th>
                  <th className="px-5 py-2.5 text-right font-bold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-5 py-3 font-semibold text-espresso">
                      {item.item_name}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-xs text-slate-400">
                      {item.hsn_code || "-"}
                    </td>
                    {/* Through trimmed: the column is NUMERIC, so 2.500 metres
                        would otherwise read as a typo. */}
                    <td className="px-3 py-3 text-center font-bold">
                      {trimmed(item.quantity)}
                      {item.unit ? ` ${item.unit}` : ""}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600">
                      {rupees(item.unit_price, { document: true })}
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-espresso">
                      {rupees(item.total, { document: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The money as it stood when the goods left, which is the whole
            reason a challan rather than an invoice was raised.

            These three figures are FROZEN. `amount_paid` is written once, when
            the challan is created, and nothing updates it, which is right: a
            challan went out of the gate with the goods and its figures are
            what they were on the paper the driver carried.

            What was wrong was calling a frozen figure "Outstanding" for ever.
            A challan raised on a part paid sale still read "Outstanding 1600"
            months after the money came in and the bill was raised, sitting
            directly above a link that said the invoice was "raised once the
            money came in". Both were true and together they read as a
            contradiction. So once it is billed the block says plainly that
            these are the figures from that day and the balance came in
            after. */}
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
          <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
            {hasMoneySnapshot ? (
              <>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {billed ? "On the day the goods left" : "Money on this sale"}
                </p>
                <div className="flex justify-between text-slate-600">
                  <span>Value of goods</span>
                  <span>{rupees(total, { document: true })}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Received by then</span>
                  <span>{rupees(paid, { document: true })}</span>
                </div>
                <div
                  className={`flex items-baseline justify-between border-t border-slate-200 pt-1.5 font-black ${
                    billed ? "text-slate-500" : "text-espresso"
                  }`}
                >
                  <span className="text-xs uppercase tracking-wider">
                    {billed ? "Owing then" : "Outstanding"}
                  </span>
                  <span className="text-base">
                    {rupees(due, { document: true })}
                  </span>
                </div>
                {billed && due > 0 && (
                  <p className="border-t border-slate-200 pt-2 text-xs font-bold text-sage">
                    Settled since. The bill below is what the customer owes
                    against now.
                  </p>
                )}
              </>
            ) : (
              /* A challan recorded in its own right. No money on it at all,
                 which is the point of the document: nothing is owed until the
                 bill is raised. Showing "Received 0, Outstanding 9,000" here
                 would invent a debt that does not exist yet. */
              <>
                <div className="flex items-baseline justify-between font-black text-espresso">
                  <span className="text-xs uppercase tracking-wider">
                    Value of goods
                  </span>
                  <span className="text-base">
                    {rupees(total, { document: true })}
                  </span>
                </div>
                <p className="text-right text-xs text-slate-500">
                  No GST on a challan. Nothing is owed until the bill.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Changing or dropping one, while it is still open. A billed challan is
          closed: a bill stands on it and editing it would make the two
          disagree with nothing to say which is right.

          The first button is the point of the whole document. A challan moves
          the goods, the bill charges for them, and the wholesaler standing on
          this screen should not have to remember which screen turns one into
          the other. It carries the party and this challan's id, so the form
          opens with the customer picked and these items already in it, ready
          to be changed. Nothing is written until he saves that form, and it
          is that save which marks this challan billed. */}
      {!billed && !cancelled && (
        <div className="flex flex-wrap gap-3">
          {/* Only with somebody to bill. A challan written against an order
              before this screen existed can carry no party row, and a link to
              /seller/sales/new?party=null opens a form that cannot be saved. */}
          {(isPurchase ? challan.supplier_id : challan.party_id) && (
            <Link
              to={
                isPurchase
                  ? `/seller/purchases/new?supplier=${challan.supplier_id}&challan=${challanId}`
                  : `/seller/sales/new?party=${challan.party_id}&challan=${challanId}`
              }
              className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
            >
              <FileText className="h-4 w-4" />
              {isPurchase ? "Enter the bill for this" : "Make the bill"}
            </Link>
          )}
          <Link
            to={`/seller/challans/${challanId}/edit`}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-espresso transition-colors hover:bg-slate-50"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
          <button
            onClick={cancelChallan}
            disabled={cancelling}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" />
            {cancelling ? "Cancelling..." : "Cancel this challan"}
          </button>
        </div>
      )}

      {cancelled && challan.cancelled_reason && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold text-slate-500">Cancelled</p>
          <p className="mt-0.5 text-sm text-slate-600">{challan.cancelled_reason}</p>
        </div>
      )}

      {/* Where the bill for these goods lives. A purchase challan points at a
          PURCHASE and has no invoice_id at all, so following invoice_id here
          sent it to /seller/invoices/null. */}
      {billed && (challan.invoice_id || challan.purchase_id) && (
        <Link
          to={
            isPurchase
              ? `/seller/purchases/${challan.purchase_id}`
              : `/seller/invoices/${challan.invoice_id}`
          }
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition-colors hover:border-clay"
        >
          <FileText className="h-5 w-5 shrink-0 text-clay" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-espresso">
              {isPurchase
                ? "The purchase for these goods"
                : "The tax invoice for these goods"}
            </p>
            <p className="text-xs text-slate-500">
              {isPurchase
                ? "Entered when the supplier's bill arrived. That is where the GST is."
                : "Raised from this challan. That is the document with the GST on it."}
              {" "}This challan is finished: it will not appear again when you
              record another one, so the same goods cannot be billed twice.
              Goods going out again need a new challan.
            </p>
          </div>
        </Link>
      )}
    </div>
  );
};

export default ChallanDetail;
