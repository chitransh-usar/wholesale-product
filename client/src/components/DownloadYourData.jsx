import { useState } from "react";
import { Download, HardDriveDownload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadFile } from "../utils/download";

/**
 * The wholesaler's own book, out of the product and onto his machine.
 *
 * Wording is deliberate. "Export" is a word from software, and the person
 * reading this is a trader. He wants to know three things: what he gets, where
 * it opens, and whether anybody else can see it. So the copy answers those
 * three and nothing else, and it says spreadsheet rather than CSV.
 *
 * There is no place here to choose WHOSE data. The server takes the owner from
 * the signed in token, and putting a picker on this screen is how that stops
 * being true.
 */

// The server renders each bill on the spot, so a full book is minutes of work,
// not seconds. The axios instance defaults to ten seconds, which would cut the
// download off while the server was still doing exactly what it was asked.
const LONG = 5 * 60 * 1000;

const DownloadYourData = () => {
  const [busy, setBusy] = useState(null);

  const take = async (withBills) => {
    setBusy(withBills ? "all" : "figures");
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      await downloadFile(
        "/api/exports/zip",
        `my-data-${stamp}.zip`,
        { params: withBills ? {} : { includePdfs: "false" }, timeout: LONG },
      );
      toast.success("Downloaded. Look in your downloads folder.");
    } catch (error) {
      toast.error(error.message || "Could not build your download.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
        <HardDriveDownload className="h-5 w-5 shrink-0 text-slate-500" />
        <div>
          <h3 className="font-bold text-espresso">Take a copy of your data</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Everything in your book, in one file.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <p className="text-sm text-slate-600">
          A zip with one spreadsheet per list, plus your bills as PDFs. Opens in
          Excel or Google Sheets. The last 200 bills come as PDFs; all of them
          are in the spreadsheet.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => take(true)}
            disabled={busy !== null}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-espresso px-6 py-3 text-sm font-bold text-cream shadow-sm transition-colors hover:bg-clay disabled:opacity-70"
          >
            {busy === "all" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {busy === "all" ? "Getting it ready..." : "Everything, with bills"}
          </button>

          <button
            onClick={() => take(false)}
            disabled={busy !== null}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-espresso transition-colors hover:bg-slate-50 disabled:opacity-70"
          >
            {busy === "figures" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {busy === "figures" ? "Getting it ready..." : "Only the figures"}
          </button>
        </div>

        {busy === "all" && (
          <p className="text-xs text-slate-500">
            This can take a minute. Leave the page open.
          </p>
        )}
      </div>
    </div>
  );
};

export default DownloadYourData;
