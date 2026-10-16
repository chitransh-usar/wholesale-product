import { useEffect, useRef, useState } from "react";
import { Check, Truck } from "lucide-react";
import api from "../utils/axios";
import { amount as money, dateLabel } from "../utils/money";

/**
 * Challans this customer or supplier is still waiting to be billed for.
 *
 * The whole reason a challan is worth recording. A wholesaler who sent goods
 * out three times last week should not have to remember that when he comes to
 * bill them, and should certainly not have to retype the items.
 *
 * Ticking one loads its lines into the form, where they can be changed like
 * any other line, and the ids ride along with the sale or purchase so the
 * server can close them in the same transaction that writes the bill. That is
 * Marg's flow: pick the challan, it loads into the bill screen, adjust, save.
 *
 * Nothing here prices anything. The form does that, through the one path that
 * already knows about GST, cess and the rest.
 *
 * `autoSelect` is a challan id arriving from the URL, which is what the Make
 * the bill button on a challan sends. It ticks that one row the moment the
 * list lands, so the wholesaler arrives at a form already filled in rather
 * than at a form where he has to find and tick the challan he just came from.
 * It fires once per form: after that the ticks are his.
 */
const PendingChallans = ({ kind, otherId, selected = [], onChange, autoSelect }) => {
  const [challans, setChallans] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);
  // The tick is fired from inside the fetch, not from an effect watching the
  // rows, so it cannot run twice and cannot set state during a render. The
  // ref holds the newest onChange so a fetch that started a render ago does
  // not call a stale one.
  const latestChange = useRef(onChange);
  const autoFired = useRef(false);
  // Written in an effect, never during a render: the parent rebuilds
  // pullChallan every render and touching a ref in the render body is the
  // thing React tells you not to do.
  useEffect(() => {
    latestChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let alive = true;
    // No party chosen, so nothing to ask for. Deliberately sets no state:
    // `loadedFor !== otherId` below already hides stale rows, and setting
    // state synchronously in an effect body is the cascading-render pattern.
    if (!otherId) return undefined;
    api
      .get(`/api/challans/pending/${otherId}?kind=${kind}`)
      .then(({ data }) => {
        if (!alive) return;
        const rows = data.challans || [];
        setChallans(rows);
        setLoadedFor(otherId);

        if (!autoSelect || autoFired.current) return;
        const wanted = rows.find((c) => String(c.id) === String(autoSelect));
        // Not in the list means it is billed, cancelled, or belongs to
        // somebody else. Silently nothing: the form still works, it just has
        // not been filled in, which is better than an error about a shortcut.
        if (!wanted) return;
        autoFired.current = true;
        latestChange.current([wanted.id], wanted, true);
      })
      // Silent. A database without the challan migration answers an error, and
      // a form that shouts about it would be worse than one that simply does
      // not offer the shortcut.
      .catch(() => {
        if (!alive) return;
        setChallans([]);
        setLoadedFor(otherId);
      });
    return () => {
      alive = false;
    };
    // autoSelect is read through the fetch and guarded by a ref, so it is not
    // a dependency: adding it would refetch the list when the URL is cleaned
    // up and nothing about the party had changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, otherId]);

  if (loadedFor !== otherId || challans.length === 0) return null;

  const toggle = (challan) => {
    const on = selected.includes(challan.id);
    onChange(
      on ? selected.filter((x) => x !== challan.id) : [...selected, challan.id],
      challan,
      !on,
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-clay/30 bg-clay/5 shadow-sm">
      <div className="flex items-center gap-3 border-b border-clay/20 p-4 sm:px-5">
        <Truck className="h-5 w-5 shrink-0 text-clay" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-espresso">
            {challans.length} challan{challans.length === 1 ? "" : "s"} not billed yet
          </h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Tick to pull the items in. Once billed a challan is finished and
            drops off this list, so the same goods cannot be billed twice.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-clay/15">
        {challans.map((c) => {
          const on = selected.includes(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c)}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-clay/10 sm:px-5"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                    on ? "border-clay bg-clay text-cream" : "border-slate-300 bg-white"
                  }`}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-espresso">
                    {c.challan_number}
                    {c.supplier_challan_number ? ` · theirs ${c.supplier_challan_number}` : ""}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {dateLabel(c.issue_date)} ·{" "}
                    {(c.lines || []).length} item
                    {(c.lines || []).length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-black text-espresso">
                  ₹{money(c.total_value)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PendingChallans;
