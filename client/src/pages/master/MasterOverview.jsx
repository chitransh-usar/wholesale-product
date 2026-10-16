import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Hash, MapPin, Percent, Ruler, Receipt, Settings } from "lucide-react";
import api from "../../utils/axios";

/**
 * What the administration dashboard holds.
 *
 * Four lists that were constants in the code, so correcting one meant a
 * deploy. What belongs here and what stays with each wholesaler is written up
 * in PROGRESS.md rather than on the screen; the screen is for doing the work.
 */

const CARDS = [
  {
    to: "/administration/states",
    field: "states",
    icon: MapPin,
    title: "States",
    note: "The two digit code that decides CGST plus SGST against IGST.",
  },
  {
    to: "/administration/units",
    field: "units",
    icon: Ruler,
    title: "Units",
    note: "Metre, kilogram, bale. How goods are counted on a bill.",
  },
  {
    to: "/administration/tax-rates",
    field: "taxRates",
    icon: Percent,
    title: "Tax rates",
    note: "The GST slabs a wholesaler may pick from.",
  },
  {
    to: "/administration/hsn",
    field: "hsn",
    icon: Hash,
    title: "HSN codes",
    note: "What the goods are. Codes and descriptions, never a rate.",
  },
  // Both of these had pages already and nothing linked to them, so the only
  // way in was to know the URL. `field` is left off because neither is a
  // counted list.
  {
    to: "/administration/tax-terms",
    icon: Receipt,
    title: "Tax terms",
    note: "Named GST and cess combinations a wholesaler can put on a line.",
  },
  {
    to: "/administration/settings",
    icon: Settings,
    title: "Platform settings",
    note: "Decimals, digit grouping, currency words, date format, HSN digits.",
  },
];

const MasterOverview = () => {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/masters")
      .then(({ data }) => {
        if (!alive) return;
        setCounts({
          states: data?.states?.length ?? 0,
          units: data?.units?.length ?? 0,
          taxRates: data?.taxRates?.length ?? 0,
          hsn: data?.hsn?.length ?? 0,
        });
      })
      .catch(() => alive && setCounts(null));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-black text-espresso">Platform Administration</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          The lists every wholesaler on the platform picks from. They were
          constants in the code until now, so correcting one meant a deploy.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-clay"
          >
            <div className="flex items-start justify-between gap-3">
              <card.icon className="h-5 w-5 shrink-0 text-clay" />
              {/* Only the counted lists show a number. The two cards without
                  a `field` are screens rather than lists, and a "-" where a
                  count belongs reads as a list that failed to load. */}
              {card.field && (
                <span className="text-2xl font-black text-espresso">
                  {counts ? counts[card.field] : "-"}
                </span>
              )}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-espresso">
              {card.title}
              <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5" />
            </p>
            <p className="mt-1 text-xs text-slate-500">{card.note}</p>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default MasterOverview;
