import { useEffect, useState } from "react";
import { Database, History } from "lucide-react";
import api from "../../utils/axios";
import BringYourBookIn from "../../components/BringYourBookIn";
import DownloadYourData from "../../components/DownloadYourData";

/**
 * Your data: what comes in, and what goes out.
 *
 * Both of these started life at the bottom of Settings, which is where they
 * sat when the person who asked for the import feature could not find it
 * twice. Settings is a long form ending in a Save button, and anything below
 * that button reads as the end of the page rather than as a thing you can do.
 *
 * So they have their own entry in the sidebar. Import is above export on
 * purpose: somebody arriving here for the first time is bringing a book in,
 * not taking one out, and the person taking one out already knows where they
 * are going.
 *
 * Owner only, the same as Settings and Staff, and the server refuses an
 * employee outright on every one of these routes rather than trusting this
 * screen to hide the buttons.
 */
const YourData = () => {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/imports")
      .then(({ data }) => alive && setHistory(data.imports || []))
      // An employee reaching this by URL, or a database that has not had the
      // migration run. Neither is worth an error on a page that still works.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const when = (value) =>
    new Date(value).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const wrote = (summary) => {
    const written = summary?.written || {};
    const parts = Object.entries(written)
      .filter(([, n]) => n > 0)
      .map(([what, n]) => `${n} ${n === 1 ? what.replace(/s$/, "") : what}`);
    return parts.length ? parts.join(", ") : "nothing new";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-black text-espresso">
          <Database className="h-6 w-6 text-slate-400" />
          Your data
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Bring an old book in, or take a copy of this one.
        </p>
      </div>

      <BringYourBookIn />
      <DownloadYourData />

      {history.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
            <History className="h-5 w-5 shrink-0 text-slate-500" />
            <div>
              <h3 className="font-bold text-espresso">What you have brought in before</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                So you can tell if a file has already been sent.
              </p>
            </div>
          </div>
          <div className="px-5 sm:px-6">
            {history.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-espresso">
                    {run.file_name || "a file"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {when(run.created_at)}
                    {run.first_name ? `, by ${run.first_name}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-slate-500">{wrote(run.summary)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default YourData;
