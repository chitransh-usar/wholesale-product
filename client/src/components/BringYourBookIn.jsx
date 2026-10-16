import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import api from "../utils/axios";
import { downloadFile } from "../utils/download";

/**
 * A book of accounts, coming in from a spreadsheet.
 *
 * The shape of this screen is the whole point. Choosing a file does NOT import
 * it: it asks the server what WOULD happen and shows the answer, and only then
 * is there a button that writes. Somebody about to put a year of their own
 * sales into a product they started using last week should see the list first.
 *
 * So there are three states and they are always in this order:
 *
 *   nothing chosen   what this does, and a template to fill in
 *   a plan           what would be created, what is already there, what is
 *                    wrong with which line, and what happens to their run of
 *                    invoice numbers
 *   done             what was written
 */

const LONG = 5 * 60 * 1000;

const Row = ({ list }) => (
  <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-espresso">{list.label}</p>
      {list.files?.length > 0 && (
        <p className="truncate text-xs text-slate-400">{list.files.join(", ")}</p>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-2 text-xs">
      {list.create > 0 && (
        <span className="rounded-full bg-sage/15 px-2.5 py-1 font-bold text-sage">
          {list.create} new
        </span>
      )}
      {list.skip > 0 && (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-500">
          {list.skip} already there
        </span>
      )}
      {list.reject > 0 && (
        <span className="rounded-full bg-rose-50 px-2.5 py-1 font-bold text-rose-600">
          {list.reject} cannot be read
        </span>
      )}
      {list.create === 0 && list.skip === 0 && list.reject === 0 && (
        <span className="text-slate-400">nothing</span>
      )}
    </div>
  </div>
);

const BringYourBookIn = () => {
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(null);
  const inputRef = useRef(null);

  const reset = () => {
    setFile(null);
    setPlan(null);
    setDone(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const look = async (chosen) => {
    setFile(chosen);
    setPlan(null);
    setDone(null);
    setBusy("preview");
    try {
      const form = new FormData();
      form.append("file", chosen);
      const { data } = await api.post("/api/imports/preview", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: LONG,
      });
      setPlan(data.plan);
    } catch (error) {
      toast.error(error.response?.data?.message || "That file could not be read.");
      reset();
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    setBusy("commit");
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/api/imports/commit", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: LONG,
      });
      setDone(data.result);
      setPlan(null);
      toast.success("Brought in.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Nothing was brought in.");
    } finally {
      setBusy(null);
    }
  };

  const template = async () => {
    try {
      await downloadFile("/api/imports/template", "import-template.zip");
    } catch (error) {
      toast.error(error.message || "Could not fetch the template.");
    }
  };

  const problems = (plan?.lists || []).flatMap((l) =>
    l.problems.map((p) => ({ ...p, label: l.label })),
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
        <Upload className="h-5 w-5 shrink-0 text-slate-500" />
        <div>
          <h3 className="font-bold text-espresso">Bring your old book in</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            From a spreadsheet you already have.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        {/* ---------------------------------------------------------- */}
        {!plan && !done && (
          <>
            <div className="space-y-1.5 text-sm text-slate-600">
              <p>
                Customers, suppliers, purchases, sales and old bills. Save as
                CSV, then send a zip or one file.
              </p>
              <p>
                You see what will happen before anything is written. Nothing
                already in your book is changed.
              </p>
              <p className="font-semibold text-espresso">
                Dates read day first. 03/04/2026 is 3 April.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={busy !== null}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-espresso px-6 py-3 text-sm font-bold text-cream shadow-sm transition-colors hover:bg-clay disabled:opacity-70"
              >
                {busy === "preview" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                {busy === "preview" ? "Reading it..." : "Choose a file"}
              </button>

              <button
                onClick={template}
                disabled={busy !== null}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-espresso transition-colors hover:bg-slate-50 disabled:opacity-70"
              >
                <Download className="h-4 w-4" />
                Get a blank one to fill in
              </button>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".zip,.csv,text/csv,application/zip"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && look(e.target.files[0])}
            />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {plan && (
          <>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span className="truncate">{file?.name}</span>
            </div>

            <div className="rounded-xl border border-slate-200 px-4">
              {plan.lists.map((list) => (
                <Row key={list.kind} list={list} />
              ))}
            </div>

            {plan.implied?.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {plan.implied.map((item) => (
                  <p key={item.label} className="mb-1 last:mb-0">
                    <span className="font-bold">
                      {item.count}{" "}
                      {item.count === 1
                        ? item.label.toLowerCase().replace(/s$/, "")
                        : item.label.toLowerCase()}
                    </span>{" "}
                    will also be created, {item.why}: {item.names.join(", ")}
                    {item.count > item.names.length ? " and others" : ""}.
                  </p>
                ))}
              </div>
            )}

            {plan.numbering?.moved?.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-bold text-espresso">Your bill numbers</p>
                <p className="mt-1">{plan.numbering.note}</p>
                {plan.numbering.moved.map((m) => (
                  <p key={`${m.series}-${m.year}`} className="mt-1 font-semibold text-espresso">
                    The next bill you raise will be number {m.to + 1}, not {m.from + 1}.
                  </p>
                ))}
              </div>
            )}

            {problems.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-rose-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {plan.totals.reject} row{plan.totals.reject === 1 ? "" : "s"} cannot be
                  brought in
                </p>
                <p className="mt-1 text-xs text-rose-700">
                  The rest still can. Fix these and send the file again.
                </p>
                <ul className="mt-3 space-y-1.5 text-xs text-rose-800">
                  {problems.slice(0, 15).map((p, i) => (
                    <li key={i}>
                      <span className="font-bold">
                        {p.label}, line {p.line}:
                      </span>{" "}
                      {p.message}
                    </li>
                  ))}
                </ul>
                {problems.length > 15 && (
                  <p className="mt-2 text-xs text-rose-700">
                    and {problems.length - 15} more.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={commit}
                disabled={busy !== null || plan.totals.create === 0}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-espresso px-6 py-3 text-sm font-bold text-cream shadow-sm transition-colors hover:bg-clay disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "commit" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {busy === "commit"
                  ? "Bringing it in..."
                  : plan.totals.create === 0
                    ? "Nothing new to bring in"
                    : `Bring in ${plan.totals.create} row${plan.totals.create === 1 ? "" : "s"}`}
              </button>
              <button
                onClick={reset}
                disabled={busy !== null}
                className="cursor-pointer rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-espresso transition-colors hover:bg-slate-50 disabled:opacity-70"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {done && (
          <>
            <div className="rounded-xl border border-sage/30 bg-sage/10 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-espresso">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-sage" />
                Brought in
              </p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {Object.entries(done.written || {})
                  .filter(([, n]) => n > 0)
                  .map(([what, n]) => (
                    <li key={what}>
                      {n} {what}
                    </li>
                  ))}
                {Object.values(done.written || {}).every((n) => n === 0) && (
                  <li>Nothing new. It was all in your book already.</li>
                )}
              </ul>
            </div>
            <button
              onClick={reset}
              className="cursor-pointer rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-espresso transition-colors hover:bg-slate-50"
            >
              Bring in another file
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default BringYourBookIn;
