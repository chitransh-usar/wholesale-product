import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Check, Plus, Search, X } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { resetMasters } from "../../hooks/useMasters";

/**
 * One administration list, edited.
 *
 * All four screens are this component with a different spec, for the same
 * reason the server keeps its four lists as data: four near identical
 * "validate, save, refresh" screens is how three of them end up behaving
 * slightly differently from the fourth.
 *
 * SWITCHING OFF IS NOT DELETING, and the screen says so where a person can
 * see it. A unit or an HSN code printed on an invoice already issued must
 * still read properly a year later, so a row that is no longer offered is
 * kept and marked rather than removed.
 */
const MasterList = ({ spec }) => {
  const { fromMasters } = useOutletContext() || {};
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showOff, setShowOff] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  /**
   * Fixed lists a field offers choices from, such as the GST UQC codes. They
   * ride along on the same response as the rows, so a select does not cost a
   * second request.
   */
  const [extras, setExtras] = useState({});

  const load = async () => {
    try {
      const { data } = await api.get("/api/masters");
      setRows(data?.[spec.field] || []);
      setExtras({ uqcCodes: data?.uqcCodes || [] });
    } catch {
      toast.error("Could not load this list.");
    }
    setLoading(false);
  };

  /**
   * The first read.
   *
   * Written as a promise chain rather than calling load(), so the state
   * updates are visibly in a callback and not in the effect body. That also
   * guards against setting state after the screen has gone, which calling an
   * async helper does not.
   *
   * Each of the four routes renders its own wrapper, so this mounts fresh per
   * list and `loading` starts true from useState. There is nothing to reset.
   */
  useEffect(() => {
    let alive = true;
    api
      .get("/api/masters")
      .then(({ data }) => {
        if (!alive) return;
        setRows(data?.[spec.field] || []);
        setExtras({ uqcCodes: data?.uqcCodes || [] });
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Could not load this list.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The read endpoint only returns ACTIVE rows, because that is what every
   * dropdown in the product wants. To show what has been switched off, this
   * asks the table through the same endpoint and merges: a row the admin has
   * just turned off vanishes from the list, which would otherwise look like
   * it had been deleted.
   */
  const [inactive, setInactive] = useState([]);
  const loadInactive = async () => {
    try {
      const { data } = await api.get("/api/masters", { params: { includeInactive: 1 } });
      const live = new Set((data?.[spec.field] || []).map((r) => String(r[spec.key])));
      setInactive((data?.[`${spec.field}Inactive`] || []).filter(
        (r) => !live.has(String(r[spec.key])),
      ));
    } catch {
      setInactive([]);
    }
  };
  useEffect(() => {
    let alive = true;
    if (!showOff) {
      Promise.resolve().then(() => alive && setInactive([]));
      return () => {
        alive = false;
      };
    }
    api
      .get("/api/masters", { params: { includeInactive: 1 } })
      .then(({ data }) => {
        if (!alive) return;
        const live = new Set((data?.[spec.field] || []).map((r) => String(r[spec.key])));
        setInactive(
          (data?.[`${spec.field}Inactive`] || []).filter((r) => !live.has(String(r[spec.key]))),
        );
      })
      .catch(() => alive && setInactive([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOff]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/masters/${spec.list}`, draft);
      toast.success(`${spec.singular} saved.`);
      setDraft(null);
      resetMasters();
      await load();
      if (showOff) await loadInactive();
    } catch (err) {
      toast.error(err.response?.data?.message || `Could not save that ${spec.singular.toLowerCase()}.`);
    }
    setSaving(false);
  };

  const setActive = async (row, active) => {
    try {
      await api.put(`/api/masters/${spec.list}/${encodeURIComponent(row[spec.key])}/active`, { active });
      toast.success(active ? "Switched back on." : "Switched off. The row is kept, not deleted.");
      resetMasters();
      await load();
      if (showOff) await loadInactive();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not change that.");
    }
  };

  const shown = useMemo(() => {
    const all = showOff ? [...rows, ...inactive] : rows;
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      spec.columns.some((c) => String(r[c.field] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, inactive, query, showOff, spec.columns]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-espresso">{spec.title}</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-500">{spec.blurb}</p>
        </div>
        <button
          onClick={() => setDraft(spec.blank())}
          disabled={!fromMasters}
          className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add {spec.singular.toLowerCase()}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${spec.title.toLowerCase()}`}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-clay"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <input
            type="checkbox"
            checked={showOff}
            onChange={(e) => setShowOff(e.target.checked)}
            className="h-4 w-4 accent-clay"
          />
          Show switched off
        </label>
        <span className="text-xs text-slate-400">{shown.length} shown</span>
      </div>

      {draft && (
        <div className="rounded-2xl border border-clay/30 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
            {draft[spec.key] && rows.some((r) => String(r[spec.key]) === String(draft[spec.key]))
              ? `Edit ${spec.singular.toLowerCase()}`
              : `New ${spec.singular.toLowerCase()}`}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {spec.fields.map((f) => (
              <div key={f.name}>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  {f.label}
                </label>
                {f.type === "select" ? (
                  <>
                    <select
                      value={draft[f.name] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
                    >
                      <option value="">{f.blankLabel || "Not set"}</option>
                      {(extras[f.optionsFrom] || []).map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.code}  {o.description}
                        </option>
                      ))}
                    </select>
                    {/* A fixed statutory list. If it is empty the migration
                        that seeds it has not been run, and saying so beats an
                        empty dropdown with no explanation. */}
                    {(extras[f.optionsFrom] || []).length === 0 && (
                      <p className="mt-1 text-[11px] text-clay">
                        This list is empty. Run the UQC migration to fill it.
                      </p>
                    )}
                    {f.hint && <p className="mt-1 text-[11px] text-slate-400">{f.hint}</p>}
                  </>
                ) : f.type === "checkbox" ? (
                  <label className="flex items-center gap-2 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(draft[f.name])}
                      onChange={(e) => setDraft({ ...draft, [f.name]: e.target.checked })}
                      className="h-4 w-4 accent-clay"
                    />
                    {f.hint}
                  </label>
                ) : (
                  <>
                    <input
                      type={f.type || "text"}
                      value={draft[f.name] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                      disabled={f.fixedOnEdit && rows.some((r) => String(r[spec.key]) === String(draft[spec.key]))}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay disabled:opacity-60"
                    />
                    {f.hint && <p className="mt-1 text-[11px] text-slate-400">{f.hint}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-clay px-4 py-2 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-slate-500">
            {query ? "Nothing matches that." : "This list is empty."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((row) => {
              const off = row.active === false;
              return (
                <li
                  key={String(row[spec.key])}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 ${off ? "bg-slate-50" : ""}`}
                >
                  {/* An optional figure on the left, for a list whose rows
                      ARE a number. Eight tax terms reading "GST 0.25%",
                      "GST 3%", "GST 5%" are eight rows whose only difference
                      is buried in the middle of a repeated sentence, and the
                      number is what somebody scans for. Lists that are not
                      numbers do not define this and are unchanged. */}
                  {spec.lead && (
                    <div
                      className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-lg border py-1.5 ${
                        off
                          ? "border-slate-200 bg-slate-100 text-slate-400"
                          : "border-slate-200 bg-slate-50 text-espresso"
                      }`}
                    >
                      <span className="text-sm font-black leading-none">
                        {spec.lead(row).value}
                      </span>
                      {spec.lead(row).note && (
                        <span className="mt-0.5 text-[10px] font-bold leading-none text-clay">
                          {spec.lead(row).note}
                        </span>
                      )}
                    </div>
                  )}
                  {/* basis-full on a phone, so the buttons and any badge drop
                      to their own line rather than squeezing the name down to
                      "GS...". Back to sharing the row from sm upwards. */}
                  <div className="min-w-0 flex-1 basis-[60%] sm:basis-0">
                    <p className={`text-sm font-bold ${off ? "text-slate-400" : "text-espresso"}`}>
                      {spec.primary(row)}
                    </p>
                    <p className="text-xs text-slate-500">{spec.secondary(row)}</p>
                  </div>
                  {/* Marks what is UNUSUAL about a row. An absence, said on
                      every row, is not a fact eight times over. */}
                  {spec.tag?.(row) && !off && (
                    <span className="shrink-0 rounded-full bg-clay/10 px-2.5 py-1 text-[11px] font-bold text-clay">
                      {spec.tag(row)}
                    </span>
                  )}
                  {off && (
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      Switched off
                    </span>
                  )}
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setDraft(spec.toDraft(row))}
                      disabled={!fromMasters}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-espresso transition-colors hover:bg-slate-50 disabled:opacity-40"
                    >
                      Edit
                    </button>
                    {/* Lighter than Edit on purpose. Editing a rate and
                        withdrawing one are not the same weight of action, and
                        they used to look identical. */}
                    <button
                      onClick={() => setActive(row, off)}
                      disabled={!fromMasters}
                      title={off ? "Offer this again" : "Stop offering this. The row is kept."}
                      className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${
                        off
                          ? "border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      }`}
                    >
                      {off ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      {off ? "On" : "Off"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Switching a row off stops it being offered anywhere. It is not deleted,
        because a document already issued may name it and must still read
        properly.
      </p>
    </div>
  );
};

export default MasterList;
