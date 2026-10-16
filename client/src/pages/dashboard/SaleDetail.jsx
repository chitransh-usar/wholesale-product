import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  IndianRupee,
  Package,
  Pencil,
  RotateCcw,
  Truck,
  X,
} from "lucide-react";
import api from "../../utils/axios";
import { downloadFile } from "../../utils/download";
import { toast } from "sonner";
import RecordPaymentModal from "../../components/RecordPaymentModal";
import { amount as money, dateLabel } from "../../utils/money";
import { useMasters } from "../../hooks/useMasters";
import { channelLabel } from "../../utils/salesChannels";

// Which book a sale belongs to. Shown so a wholesaler can see why its bill
// carries the number it does.
const CHANNEL_TEXT = {
  counter: "Counter or phone",
  shop: "This shop",
  flipkart: "Flipkart",
  amazon: "Amazon",
};

// Stored as a word for the screen. The e-way bill API numbers these 1 to 4,
// which is an encoding detail of that API and means nothing to a wholesaler.
const TRANSPORT_MODE_TEXT = {
  road: "By road",
  rail: "By rail",
  air: "By air",
  ship: "By ship",
};

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

// Mirrors ALLOWED_NEXT in the sale controller. The server is the authority;
// this only decides which buttons are worth showing.
const NEXT_ACTIONS = {
  draft: [
    { status: "confirmed", label: "Confirm", icon: Check },
    { status: "cancelled", label: "Cancel", icon: X },
  ],
  confirmed: [
    { status: "delivered", label: "Mark delivered", icon: Truck },
    { status: "cancelled", label: "Cancel", icon: X },
  ],
  delivered: [],
  cancelled: [],
};

const SaleDetail = () => {
  const { salesChannels } = useMasters();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [billing, setBilling] = useState(false);
  // Set when the bill for this sale has been reversed. Kept beside the sale
  // rather than inside it because it is a document in its own right.
  const [creditNote, setCreditNote] = useState(null);
  const [downloading, setDownloading] = useState("");
  // Set when the server refuses to bill because money is still outstanding.
  // Carries the figures, so the panel can say how much is left.
  const [unpaid, setUnpaid] = useState(null);
  const [challans, setChallans] = useState([]);
  const [paying, setPaying] = useState(false);
  // Bumped to re-run the loader below. Simpler than hoisting it out of its
  // effect, and the effect already owns the "is this still mounted" guard.
  const [refresh, setRefresh] = useState(0);
  const [makingChallan, setMakingChallan] = useState(false);

  const handleDownloadInvoice = async () => {
    if (!invoice) return;
    setDownloading("invoice");
    try {
      await downloadFile(
        `/api/invoices/${invoice.id}/pdf`,
        `${invoice.invoice_number || "Invoice"}.pdf`,
      );
      toast.success("Invoice downloaded");
    } catch (err) {
      console.error("Invoice download error:", err);
      toast.error(err.message || "Could not download the invoice PDF");
    } finally {
      setDownloading("");
    }
  };

  const handleDownloadCreditNote = async () => {
    if (!creditNote) return;
    setDownloading("creditNote");
    try {
      await downloadFile(
        `/api/credit-notes/${creditNote.id}/pdf`,
        `${creditNote.note_number || "credit-note"}.pdf`,
      );
      toast.success("Credit note downloaded");
    } catch (err) {
      console.error("Credit note download error:", err);
      toast.error(err.message || "Could not download the credit note");
    } finally {
      setDownloading("");
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get(`/api/sales/${id}`);
        if (alive) {
          setData(res.data);
          setCreditNote(res.data.creditNote || null);
        }
      } catch (error) {
        if (alive) {
          toast.error(
            error.response?.status === 404
              ? "That sale is not in your book."
              : "Could not load this sale.",
          );
        }
      }

      // A 404 here is the normal case: most sales have no invoice yet. Only a
      // real failure is worth saying anything about.
      try {
        const res = await api.get(`/api/sales/${id}/invoice`);
        if (alive) setInvoice(res.data);
      } catch (error) {
        if (alive && error.response?.status !== 404) {
          console.error("Could not check for an invoice", error);
        }
      }

      // Goods may already have gone out on one or more challans while the
      // money was outstanding. An empty list is the ordinary case.
      try {
        const res = await api.get(`/api/challans/sale/${id}`);
        if (alive) setChallans(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (alive) setChallans([]);
      }

      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [id, refresh]);

  const makeBill = async () => {
    setBilling(true);
    try {
      const { data: raised } = await api.post(`/api/sales/${id}/invoice`);
      setInvoice(raised);
      setUnpaid(null);
      toast.success(`Invoice ${raised.invoice_number} is ready.`);
    } catch (error) {
      // Not paid in full is not a failure, it is "not yet". The panel turns
      // it into an offer to send the goods out on a challan.
      if (error.response?.data?.code === "UNPAID") {
        setUnpaid(error.response.data);
      } else {
        toast.error(
          error.response?.data?.message || "Could not raise the invoice.",
        );
      }
    }
    setBilling(false);
  };

  const makeChallan = async () => {
    setMakingChallan(true);
    try {
      const { data } = await api.post(`/api/challans/sale/${id}`, {});
      setChallans((prev) => [data, ...prev]);
      toast.success(`Challan ${data.challan_number} is ready.`);
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Could not make the challan.",
      );
    }
    setMakingChallan(false);
  };

  const downloadChallan = async (challan) => {
    setDownloading(challan.id);
    try {
      await downloadFile(
        `/api/challans/${challan.id}/pdf`,
        `${challan.challan_number}.pdf`,
      );
    } catch (err) {
      toast.error(err.message || "Could not download the challan");
    }
    setDownloading("");
  };

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      const { data: updated } = await api.patch(`/api/sales/${id}/status`, {
        status,
      });
      const { creditNote: raised, ...sale } = updated;
      setData((prev) => ({ ...prev, sale: { ...prev.sale, ...sale } }));

      // Cancelling a billed sale reverses the bill with a credit note. Saying
      // so here matters: they expect the invoice to disappear, and it does not.
      if (raised) {
        setCreditNote(raised);
        toast.success(`Sale cancelled. Credit note ${raised.note_number} raised.`);
      } else {
        toast.success(`Sale marked ${status}.`);
      }
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Could not update this sale.",
      );
    }
    setBusy(false);
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
        <p className="font-semibold text-espresso">Sale not found</p>
        <Link
          to="/seller/sales"
          className="mt-4 inline-block text-sm font-bold text-clay hover:underline"
        >
          Back to sales
        </Link>
      </div>
    );
  }

  const { sale, lines, payments, settlement, challansOn } = data;

  /**
   * How the goods went out, with the blanks dropped.
   *
   * Built once rather than twice, because the same list decides both whether
   * the card appears at all and what is inside it. Two copies of it is how one
   * of them ends up listing a field the other does not.
   *
   * Empty on a sale collected from the shop counter, which is most of them, and
   * then the card is not rendered: a card headed Transport with nothing in it
   * reads as though somebody forgot to fill it in.
   */
  const transportRows = [
    ["Transporter", sale.transporter_name],
    ["Transporter ID", sale.transporter_id],
    ["Mode", TRANSPORT_MODE_TEXT[sale.transport_mode] || sale.transport_mode],
    ["Vehicle", sale.vehicle_number],
    ["LR or RR number", sale.transport_doc_number],
    ["LR or RR date", sale.transport_doc_date ? dateLabel(sale.transport_doc_date) : null],
    ["GR number", sale.gr_number],
    ["GR date", sale.gr_date ? dateLabel(sale.gr_date) : null],
  ].filter(([, value]) => value);

  // The server owns the rule. An order backed sale has money on the order as
  // well as in party_payments, so summing the rows on this screen would say
  // a settled sale still owed money.
  const settled = settlement ? settlement.settled : false;
  const outstanding = settlement
    ? Number((settlement.total - settlement.received).toFixed(2))
    : 0;
  // Goods can go out on a challan whenever the sale is live and unsettled.
  // This used to appear only after pressing "Make invoice" and being refused,
  // which meant the right button was hidden behind the wrong one.
  const canChallan =
    challansOn && !settled && sale.status !== "draft" && sale.status !== "cancelled";

  /**
   * What is still owed, from the server's figure and not from this list.
   *
   * The list below holds party_payments tagged to this sale, and a sale
   * written from a shop order has none: the buyer paid at checkout and that
   * money sits on the order. Adding up the list gave zero, so a fully paid
   * order showed a sale reading "₹1,420 still due" while the order it links
   * to read "all paid". Reported by a wholesaler, and it was the same rule
   * being answered by two different sums.
   */
  const received = settlement
    ? Number(settlement.received)
    : payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const due = Number((Number(sale.total) - received).toFixed(2));
  // Money that came in through the shop rather than being entered here, so
  // the empty payments list below is explained rather than just puzzling.
  const paidElsewhere =
    received - payments.reduce((sum, p) => sum + Number(p.amount), 0);

  // A sale written from a shop order belongs to that order. It gets no
  // buttons of its own, because delivering the goods is one event and it had
  // two switches: the order's, which stamps a delivery date and opens the
  // return window, and this page's, which did neither. The server refuses the
  // change anyway; hiding the button is so nobody presses it and reads an
  // error they did not deserve.
  const fromOrder = Boolean(sale.order_id);
  const actions = fromOrder ? [] : NEXT_ACTIONS[sale.status] || [];
  const canEdit = !fromOrder && sale.status !== "cancelled" && !invoice;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to="/seller/sales"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition-colors hover:text-clay"
      >
        <ArrowLeft className="h-4 w-4" />
        Sales
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black text-espresso">
                {sale.sale_number}
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  STATUS_STYLES[sale.status] || STATUS_STYLES.draft
                }`}
              >
                {sale.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {dateLabel(sale.sale_date)}
              {sale.channel && sale.channel !== "counter"
                ? `  |  ${CHANNEL_TEXT[sale.channel] || channelLabel(salesChannels, sale.channel)}`
                : ""}
            </p>
            <Link
              to={`/seller/customers/${sale.party_id}`}
              className="mt-3 inline-block text-sm font-bold text-clay hover:underline"
            >
              {sale.party_name}
              {sale.party_business_name ? ` · ${sale.party_business_name}` : ""}
            </Link>
          </div>

          <div className="w-full text-left sm:w-auto sm:text-right">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Bill total
            </p>
            <p className="text-3xl font-black text-espresso">
              ₹{money(sale.total)}
            </p>
            {sale.status !== "cancelled" && (
              <p
                className={`text-xs font-bold ${
                  due > 0 ? "text-amber-600" : "text-emerald-600"
                }`}
              >
                {due > 0 ? `₹${money(due)} still due` : "Fully paid"}
              </p>
            )}
          </div>
        </div>

        {/* Where the switches used to be, for a sale that has none. Saying
            which order runs it is more use than an empty strip. */}
        {fromOrder && (
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-5">
            <Link
              to={`/seller/orders/${sale.order_id}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Package className="h-4 w-4" />
              Open order {sale.order_number || ""}
            </Link>
            <p className="text-xs text-slate-500">
              This sale follows its order. Confirm, deliver or cancel it there
              and this updates with it.
            </p>
          </div>
        )}

        {!fromOrder && (actions.length > 0 || canEdit) && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
            {/* Once an invoice exists the sale is frozen: an invoice is a fixed
                document and is corrected with a credit note, not by editing
                what it was raised from. The server refuses either way. */}
            {canEdit && (
              <Link
                to={`/seller/sales/${sale.id}/edit`}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            )}
            {actions.map((action) => (
              <button
                key={action.status}
                onClick={() => changeStatus(action.status)}
                disabled={busy}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50 ${
                  action.status === "cancelled"
                    ? "border-slate-200 text-rose-600 hover:bg-rose-50"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <action.icon className="h-4 w-4" />
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* A cancelled sale can still have an invoice behind it, reversed by a
          credit note. Hiding the panel made an issued, numbered document
          vanish from the screen with nothing saying what became of it. */}
      {(sale.status !== "cancelled" || invoice) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          {invoice ? (
            <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <p className="text-sm font-bold text-espresso">
                    {invoice.invoice_number}
                  </p>
                  {creditNote && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      Credited
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {creditNote
                    ? "This bill has been reversed. It stays as it was issued, because a bill that has gone out cannot be rewritten."
                    : invoice.recipient_gstin
                      ? `GST invoice for ${invoice.recipient_name || sale.party_name}`
                      : `Invoice for ${invoice.recipient_name || sale.party_name}. Add their GST number so they can claim input credit.`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownloadInvoice}
                  disabled={downloading === "invoice"}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {downloading === "invoice" ? "Downloading..." : "Open PDF"}
                </button>
                <Link
                  to={`/seller/invoices/${invoice.id}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Details
                </Link>
              </div>
            </div>

            {/* The reversing document. Its own number, because the customer
                needs it for their books as much as the wholesaler does. */}
            {creditNote && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sky-50 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <RotateCcw className="h-4 w-4 shrink-0 text-sky-700" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-sky-900">
                      Credit note {creditNote.note_number}
                    </p>
                    <p className="mt-0.5 text-xs text-sky-800">
                      ₹{money(creditNote.grand_total)} credited back against{" "}
                      {invoice.invoice_number}. Give this to{" "}
                      {sale.party_name} along with the original bill.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadCreditNote}
                  disabled={downloading === "creditNote"}
                  className="flex shrink-0 items-center gap-2 rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm font-bold text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {downloading === "creditNote" ? "Downloading..." : "Open PDF"}
                </button>
              </div>
            )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-espresso">No invoice yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  {sale.status === "draft"
                    ? "Confirm the sale first."
                    : "Raise it once. The number is then fixed."}
                </p>
              </div>
              {/* No longer gated on the sale being settled. It used to be,
                  under the rule that an unpaid sale got a challan instead of
                  a bill. That rule was dropped on 17 Sept: section 31(1) ties
                  the invoice to removal of the goods, not to payment, so
                  holding it back understated outward supply and left the
                  customer unable to claim input credit. */}
              {sale.status !== "cancelled" && sale.status !== "draft" && (
                <button
                  onClick={makeBill}
                  disabled={billing}
                  className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-50"
                >
                  <FileText className="h-4 w-4" />
                  {billing ? "Making..." : "Make invoice"}
                </button>
              )}
            </div>
          )}

          {/* Taking the money, on the sale it is for.
              
              This used to mean leaving the sale, opening Customers, finding
              the customer, pressing Record payment and picking this sale back
              out of a list. Four steps to answer a question the screen was
              already showing. The customer page keeps its own version, which
              is the one to use for a round sum paid against several old bills
              at once: that is a real thing and it does not belong on one
              sale. */}
          {outstanding > 0 && sale.status !== "cancelled" && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-espresso">
                  ₹{money(outstanding)} still to come in
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Record it here. It lands on the customer's account either way.
                </p>
              </div>
              <button
                onClick={() => setPaying(true)}
                className="flex items-center gap-2 rounded-lg bg-espresso px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-clay"
              >
                <IndianRupee className="h-4 w-4" />
                Record payment
              </button>
            </div>
          )}

          {/* Standing, not hidden behind a failed billing attempt. Goods go
              out whenever they go out, and the wholesaler should not have to
              press the wrong button to find the right one.

              Shown even when an invoice already exists, because it can: a
              sale billed before this rule came in, or billed by hand, can
              still have goods leaving against an unpaid balance. */}
          {canChallan && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-900">
                ₹{money(unpaid?.outstanding ?? outstanding)} is still to come in
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {invoice
                  ? "Already billed, before it was settled. Goods can still go out on a challan."
                  : "The bill follows once this is paid in full. Send goods out on a challan meanwhile."}
              </p>
              <button
                onClick={makeChallan}
                disabled={makingChallan}
                className="mt-3 flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:opacity-50"
              >
                <Truck className="h-4 w-4" />
                {makingChallan
                  ? "Making challan..."
                  : challans.length > 0
                    ? "Make another challan"
                    : "Make challan"}
              </button>
            </div>
          )}

          {challans.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Challans
              </p>
              <ul className="space-y-1.5">
                {challans.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="flex items-center gap-2 text-espresso">
                      <Truck className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-bold">{c.challan_number}</span>
                      <span className="text-xs text-slate-500">
                        {dateLabel(c.issue_date)}
                      </span>
                      {/* status is the authority, not invoice_id. A challan
                          billed through a SALE gets status 'billed' and a
                          sale_id and never an invoice_id, so reading
                          invoice_id alone showed no badge at all on a challan
                          the very sale it sits on had just closed. */}
                      {(c.status === "billed" || c.invoice_id) && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Billed
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => downloadChallan(c)}
                      disabled={downloading === c.id}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {downloading === c.id ? "..." : "PDF"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Lines */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Items
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/50">
              <tr>
                <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Item
                </th>
                <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                  Qty
                </th>
                <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                  Rate
                </th>
                <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-6 py-3 font-semibold text-espresso">
                    {line.item_name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-slate-600">
                    {Number(line.quantity)} {line.unit || ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-slate-600">
                    ₹{money(line.rate)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right font-bold text-espresso">
                    ₹{money(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 border-t border-slate-100 px-6 py-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Items total</span>
            <span className="font-semibold text-espresso">
              ₹{money(sale.subtotal)}
            </span>
          </div>
          {Number(sale.discount) > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Less discount</span>
              <span className="font-semibold text-espresso">
                -₹{money(sale.discount)}
              </span>
            </div>
          )}
          {/* Shown whenever there is tax, so the three numbers add up on the
              page. Sales recorded before GST moved onto the sale have none,
              and on those the row would only be a confusing zero. */}
          {Number(sale.tax_amount) > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">GST</span>
              <span className="font-semibold text-espresso">
                ₹{money(sale.tax_amount)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-100 pt-2">
            <span className="font-bold text-espresso">Bill total</span>
            <span className="text-lg font-black text-espresso">
              ₹{money(sale.total)}
            </span>
          </div>
        </div>
      </div>

      {/*
        How the goods went out.

        Shown only when something was recorded. A sale collected from the shop
        counter has no transport, and an empty card headed "Transport" reads as
        though somebody forgot to fill it in.
      */}
      {transportRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              How the goods went out
            </h3>
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 px-6 py-5 sm:grid-cols-2">
            {transportRows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-sm">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-right font-semibold text-espresso">{value}</dd>
                </div>
            ))}
          </dl>
        </div>
      )}

      {/* Payments against this sale */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Money received against this sale
          </h3>
        </div>

        {payments.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">
            {paidElsewhere > 0.01 ? (
              <>
                ₹{money(paidElsewhere)} came in through the shop, on order{" "}
                {sale.order_number || ""}. Payments entered here would be
                listed below.
              </>
            ) : (
              <>
                Nothing received against this sale yet. Payments recorded on
                the customer's account without naming a sale are not listed
                here.
              </>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex items-center justify-between px-6 py-3.5"
              >
                <div>
                  <p className="text-sm font-bold text-espresso">
                    {METHOD_LABELS[payment.method] || payment.method}
                  </p>
                  <p className="text-xs text-slate-500">
                    {dateLabel(payment.paid_on)}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </p>
                </div>
                <p className="text-sm font-black text-emerald-700">
                  ₹{money(payment.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sale.notes && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">
            Note
          </h3>
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {sale.notes}
          </p>
        </div>
      )}

      {paying && (
        <RecordPaymentModal
          partyId={sale.party_id}
          partyName={sale.party_name}
          outstanding={outstanding}
          forSale={sale}
          onClose={() => setPaying(false)}
          onSaved={() => {
            setPaying(false);
            setRefresh((n) => n + 1);
          }}
        />
      )}
    </div>
  );
};

export default SaleDetail;
