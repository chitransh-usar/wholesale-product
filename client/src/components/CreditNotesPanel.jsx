import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, RotateCcw, Search } from "lucide-react";
import api from "../utils/axios";
import { downloadFile } from "../utils/download";
import { toast } from "sonner";
import { money, dateLabel } from "../utils/money";

// The stored code is for the database. This is what they read.
const REASON_LABELS = {
  sale_cancelled: "Sale cancelled",
  goods_returned: "Goods returned",
  rate_revised: "Rate corrected",
  other: "Other",
};

/**
 * Every bill this wholesaler has reversed.
 *
 * Its own list rather than a filter on the invoice list, because a credit
 * note is a document in its own right with its own number series, and at the
 * end of a month it is the thing they have to total separately.
 */
const CreditNotesPanel = () => {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const handleDownload = async (note) => {
    setDownloadingId(note.id);
    try {
      await downloadFile(
        `/api/credit-notes/${note.id}/pdf`,
        `${note.note_number || "credit-note"}.pdf`,
      );
      toast.success("Credit note downloaded");
    } catch (error) {
      console.error("Credit note download failed:", error);
      toast.error(error.message || "Could not download the credit note");
    } finally {
      setDownloadingId(null);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get("/api/credit-notes");
        if (alive) setNotes(res.data || []);
      } catch (error) {
        console.error("Failed to load credit notes", error);
        if (alive) toast.error("Could not load your credit notes.");
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const term = search.trim().toLowerCase();
  const visible = term
    ? notes.filter((note) =>
        [note.note_number, note.invoice_number, note.recipient_name, note.sale_number]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(term)),
      )
    : notes;

  const total = visible.reduce((sum, note) => sum + Number(note.grand_total || 0), 0);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <RotateCcw className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="font-semibold text-espresso">No credit notes yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          When a bill has to be reversed, because the sale was cancelled or the
          goods came back, a credit note is raised against it. It gets its own
          number and the customer keeps it with the original bill.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:px-6">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search note, bill or customer"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-clay"
          />
        </div>
        <p className="text-xs font-semibold text-slate-500">
          {visible.length} note{visible.length === 1 ? "" : "s"} · ₹{money(total)}{" "}
          credited
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="px-6 py-14 text-center text-sm text-slate-500">
          Nothing matches "{search}".
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visible.map((note) => (
            <li
              key={note.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-6"
            >
              {/* Full width on a phone, so the amount and the PDF button drop
                  to a second row. Sharing one row squeezed the bill number
                  down to "IN...", which is the one thing on the line a
                  wholesaler is looking for. */}
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-bold text-espresso">
                    {note.note_number}
                  </p>
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700">
                    {REASON_LABELS[note.reason] || "Reversed"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  {note.recipient_name || "Customer"} · against{" "}
                  <Link
                    to={`/seller/invoices/${note.invoice_id}`}
                    className="font-bold text-clay hover:underline"
                  >
                    {note.invoice_number}
                  </Link>{" "}
                  · {dateLabel(note.issue_date)}
                </p>
                {note.reason_note && (
                  <p className="mt-0.5 text-xs italic text-slate-400">
                    {note.reason_note}
                  </p>
                )}
              </div>

              <p className="shrink-0 text-sm font-black text-espresso">
                ₹{money(note.grand_total)}
              </p>

              <button
                type="button"
                onClick={() => handleDownload(note)}
                disabled={downloadingId === note.id}
                className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:ml-0"
              >
                <Download className="h-3.5 w-3.5" />
                {downloadingId === note.id ? "Downloading..." : "PDF"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default CreditNotesPanel;
