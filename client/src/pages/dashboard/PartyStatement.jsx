import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  FileText,
  MessageCircle,
  Receipt,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import api from "../../utils/axios";
import { downloadFile } from "../../utils/download";
import { toast } from "sonner";
import { amount as money, dateLabel } from "../../utils/money";

const iso = (date) => date.toISOString().slice(0, 10);

// The ranges a trader actually asks for. "Everything" is here because a book
// that is a few months old is easier to read whole than sliced.
const RANGES = [
  {
    key: "this-month",
    label: "This month",
    of: () => {
      const now = new Date();
      return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
    },
  },
  {
    key: "last-month",
    label: "Last month",
    of: () => {
      const now = new Date();
      return [
        iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      ];
    },
  },
  {
    key: "three-months",
    label: "Last 3 months",
    of: () => {
      const now = new Date();
      return [iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), iso(now)];
    },
  },
  {
    key: "year",
    label: "This financial year",
    of: () => {
      // April to March, which is what a bill book here runs on.
      const now = new Date();
      const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      return [iso(new Date(startYear, 3, 1)), iso(now)];
    },
  },
  { key: "all", label: "Everything", of: () => ["", ""] },
];

/**
 * One customer's account over a period.
 *
 * The numbers here have to agree with the balance on their customer page, so
 * both are built from the same two facts: confirmed and delivered sales, and
 * money received. A draft is not a debt and a cancelled bill is not owed, so
 * neither appears.
 */
const PartyStatement = () => {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const from = params.get("from") || "";
  const to = params.get("to") || "";
  // No range in the URL means everything, which is the honest default for a
  // book that may only be a few weeks old.
  const activeRange = params.get("range") || "all";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/parties/${id}/statement`, {
          params: {
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
          },
        });
        if (alive) setData(res.data);
      } catch (error) {
        console.error("Failed to load statement", error);
        if (alive) {
          toast.error(
            error.response?.data?.message || "Could not build this statement.",
          );
        }
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [id, from, to]);

  const pickRange = (range) => {
    const [nextFrom, nextTo] = range.of();
    const next = { range: range.key };
    if (nextFrom) next.from = nextFrom;
    if (nextTo) next.to = nextTo;
    setParams(next);
  };

  const setDate = (field, value) => {
    const next = { range: "custom", from, to, [field]: value };
    Object.keys(next).forEach((key) => {
      if (!next[key]) delete next[key];
    });
    setParams(next);
  };

  const periodLabel = useMemo(() => {
    if (!from && !to) return "Everything so far";
    if (from && to) return `${dateLabel(from)} to ${dateLabel(to)}`;
    if (from) return `From ${dateLabel(from)}`;
    return `Up to ${dateLabel(to)}`;
  }, [from, to]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">Statement not available</p>
        <Link
          to={`/seller/customers/${id}`}
          className="mt-4 inline-block text-sm font-bold text-clay hover:underline"
        >
          Back to the customer
        </Link>
      </div>
    );
  }

  const { party, rows, openingBalance, totals, closingBalance } = data;
  const closing = Number(closingBalance);
  const digits = String(party.phone || "").replace(/\D/g, "");

  // Pulled through the authenticated axios instance rather than opened as a
  // link. An /api path in an href resolves against the site origin and
  // carries no Authorization header, so it comes back 401. See utils/download.
  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile(
        `/api/parties/${party.id}/statement/pdf`,
        `Statement-${(party.business_name || party.name || "customer").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`,
        { params: { ...(from ? { from } : {}), ...(to ? { to } : {}) } },
      );
      toast.success("Statement downloaded");
    } catch (error) {
      console.error("Statement download failed:", error);
      toast.error(error.message || "Could not download the statement");
    } finally {
      setDownloading(false);
    }
  };

  // A wa.me link carries text, not a file. There is no way to attach the PDF
  // from a browser, so this sends the figures and says where they came from,
  // and the PDF stays a separate button they can send themselves. Promising to
  // "send the statement" and delivering four lines would be a lie.
  const whatsappText = encodeURIComponent(
    [
      `Statement of account - ${party.business_name || party.name}`,
      periodLabel,
      "",
      `Brought forward: Rs.${money(openingBalance)}`,
      `Billed: Rs.${money(totals.billed)}`,
      `Received: Rs.${money(totals.received)}`,
      closing < 0
        ? `In credit with us: Rs.${money(Math.abs(closing))}`
        : `Balance due: Rs.${money(closing)}`,
      "",
      `${rows.length} entr${rows.length === 1 ? "y" : "ies"} in this period. Tell us if anything does not match your books.`,
    ].join("\n"),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to={`/seller/customers/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition-colors hover:text-clay"
      >
        <ArrowLeft className="h-4 w-4" />
        {party.name}
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-black text-espresso">Statement</h2>
            <p className="mt-1 text-sm text-slate-500">
              {party.business_name || party.name} · {periodLabel}
            </p>
          </div>
          <div className="w-full text-left sm:w-auto sm:text-right">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {closing < 0 ? "They have paid extra" : "Balance"}
            </p>
            <p
              className={`text-3xl font-black ${
                closing > 0
                  ? "text-espresso"
                  : closing < 0
                    ? "text-sky-700"
                    : "text-emerald-600"
              }`}
            >
              ₹{money(Math.abs(closing))}
            </p>
            <p className="text-xs font-medium text-slate-500">
              {closing > 0
                ? "Still to be received"
                : closing < 0
                  ? "In credit with you"
                  : "Account settled"}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 rounded-lg bg-espresso px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-clay disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {downloading ? "Preparing..." : "Download PDF"}
          </button>
          {digits && (
            <a
              href={`https://wa.me/${digits}?text=${whatsappText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
              title="Sends the figures as a message. Send the PDF yourself if they want the full list."
            >
              <MessageCircle className="h-4 w-4" />
              Send figures on WhatsApp
            </a>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {RANGES.map((range) => (
            <button
              key={range.key}
              onClick={() => pickRange(range)}
              className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                activeRange === range.key
                  ? "border-clay bg-clay/10 text-clay"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="statement-from"
              className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400"
            >
              From
            </label>
            <input
              id="statement-from"
              type="date"
              value={from}
              onChange={(e) => setDate("from", e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-clay"
            />
          </div>
          <div>
            <label
              htmlFor="statement-to"
              className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400"
            >
              To
            </label>
            <input
              id="statement-to"
              type="date"
              value={to}
              onChange={(e) => setDate("to", e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-clay"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:rounded-2xl sm:p-5">
          <p className="text-[11px] font-semibold leading-tight text-slate-500 sm:text-sm">
            Brought forward
          </p>
          <p className="mt-1 text-base font-black text-espresso sm:text-2xl">
            ₹{money(openingBalance)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:rounded-2xl sm:p-5">
          <p className="text-[11px] font-semibold leading-tight text-slate-500 sm:text-sm">
            Billed
          </p>
          <p className="mt-1 text-base font-black text-espresso sm:text-2xl">
            ₹{money(totals.billed)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:rounded-2xl sm:p-5">
          <p className="text-[11px] font-semibold leading-tight text-slate-500 sm:text-sm">
            Received
          </p>
          <p className="mt-1 text-base font-black text-emerald-700 sm:text-2xl">
            ₹{money(totals.received)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-espresso">
              Nothing happened in this period
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              No bills and no payments between these dates. Try a wider range,
              or Everything.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50">
                  <tr>
                    <th className="whitespace-nowrap px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Date
                    </th>
                    <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Particulars
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                      Billed
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                      Received
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-slate-50/60">
                    <td className="px-6 py-2.5 text-xs font-semibold text-slate-500">
                      {from ? dateLabel(from) : ""}
                    </td>
                    <td
                      className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500"
                      colSpan={3}
                    >
                      Brought forward
                    </td>
                    <td className="whitespace-nowrap px-6 py-2.5 text-right font-bold text-slate-600">
                      ₹{money(openingBalance)}
                    </td>
                  </tr>
                  {rows.map((row) => (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td className="whitespace-nowrap px-6 py-3 text-slate-600">
                        {dateLabel(row.date)}
                      </td>
                      <td className="px-3 py-3">
                        <Particulars row={row} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-espresso">
                        {row.debit > 0 ? `₹${money(row.debit)}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-emerald-700">
                        {row.credit > 0 ? `₹${money(row.credit)}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right font-black text-espresso">
                        ₹{money(row.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: the five column ledger does not fit, so each entry is a
                stacked row with its running balance under it. */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              <li className="flex items-center justify-between bg-slate-50/60 px-4 py-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Brought forward
                </span>
                <span className="text-sm font-bold text-slate-600">
                  ₹{money(openingBalance)}
                </span>
              </li>
              {rows.map((row) => (
                <li key={`${row.kind}-${row.id}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Particulars row={row} />
                      <p className="mt-0.5 text-xs text-slate-500">
                        {dateLabel(row.date)}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-sm font-bold ${
                        row.credit > 0 ? "text-emerald-700" : "text-espresso"
                      }`}
                    >
                      {row.credit > 0
                        ? `- ₹${money(row.credit)}`
                        : `₹${money(row.debit)}`}
                    </p>
                  </div>
                  <p className="mt-1 text-right text-xs font-bold text-slate-500">
                    Balance ₹{money(row.balance)}
                  </p>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between border-t-2 border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
              <span className="text-sm font-black uppercase tracking-wider text-espresso">
                {closing < 0 ? "In credit" : "Balance due"}
              </span>
              <span className="text-lg font-black text-espresso">
                ₹{money(Math.abs(closing))}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const METHOD_LABELS = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

const Particulars = ({ row }) => {
  // An order the customer placed through the shop. Owed exactly like a sale,
  // but named as what they did, so they recognises it on their own statement.
  if (row.kind === "order") {
    return (
      <span className="flex items-center gap-2">
        <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="text-sm font-semibold text-espresso">
          {row.ref || "Shop order"}
        </span>
        {row.lineCount > 0 && (
          <span className="text-xs text-slate-400">
            {row.lineCount} item{row.lineCount === 1 ? "" : "s"}
          </span>
        )}
      </span>
    );
  }

  if (row.kind === "sale") {
    return (
      <span className="flex items-center gap-2">
        <Receipt className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="text-sm font-semibold text-espresso">
          {row.ref || "Sale"}
        </span>
        {row.lineCount > 0 && (
          <span className="text-xs text-slate-400">
            {row.lineCount} item{row.lineCount === 1 ? "" : "s"}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="flex items-center gap-2">
        <Wallet className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="text-sm font-semibold text-emerald-800">
          Payment by {METHOD_LABELS[row.method] || row.method}
        </span>
      </span>
      {row.ref && (
        <span className="text-xs text-slate-400">
          against {row.ref}
          {row.againstCancelled ? " (cancelled)" : ""}
        </span>
      )}
      {row.note && <span className="text-xs italic text-slate-400">{row.note}</span>}
    </span>
  );
};

export default PartyStatement;
