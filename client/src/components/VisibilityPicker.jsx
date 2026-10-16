import { Globe, Store, Lock } from "lucide-react";

// Where a listing is allowed to appear. Mirrors the visibility column on
// supplier_inventory, see server/migrations/listing_visibility.sql.
const VISIBILITY_OPTIONS = [
  {
    value: "public",
    label: "Everyone",
    icon: Globe,
    summary: "Shows in search",
    detail:
      "Buyers find it by searching. Your price is shown next to other sellers of the same item. Good for normal stock that brings new buyers to you.",
  },
  {
    value: "storefront",
    label: "Only my shop page",
    icon: Store,
    summary: "Not in search",
    detail:
      "Does not come up in search, and your price is never shown next to other sellers. Buyers see it only when they open your shop page. Good for your special items.",
  },
  {
    value: "private",
    label: "Only with my link",
    icon: Lock,
    summary: "Hidden from everyone",
    detail:
      "Nobody can find this item on the site. You get a link to send on WhatsApp, and only people you send it to can open it.",
  },
];

/**
 * Three-way visibility selector shared by the add and edit listing forms.
 * Renders as radio cards so the trade-off is readable without a tooltip.
 */
const VisibilityPicker = ({ value, onChange, name = "visibility" }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
    {VISIBILITY_OPTIONS.map((option) => {
      const Icon = option.icon;
      const selected = value === option.value;

      return (
        <label
          key={option.value}
          className={`relative flex flex-col gap-2 rounded-xl border p-4 cursor-pointer transition-colors ${
            selected
              ? "border-clay bg-clay/5 ring-1 ring-clay"
              : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={selected}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          <div className="flex items-center gap-2">
            <Icon
              className={`w-4 h-4 shrink-0 ${
                selected ? "text-clay" : "text-slate-400"
              }`}
            />
            <span
              className={`text-sm font-bold ${
                selected ? "text-espresso" : "text-slate-700"
              }`}
            >
              {option.label}
            </span>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {option.summary}
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            {option.detail}
          </p>
        </label>
      );
    })}
  </div>
);

export default VisibilityPicker;
