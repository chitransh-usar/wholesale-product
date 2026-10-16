import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, Users, FileText } from "lucide-react";
import ModalShell from "./ModalShell";
import { listHotkeys, prettyCombo } from "../hooks/useHotkey";
import api from "../utils/axios";
import { amount as money } from "../utils/money";

/**
 * Type where you want to go, or who you are looking for, and press Enter.
 *
 * Opened two ways on purpose. Ctrl+K is what anybody who uses software
 * expects, and a visible Search box in the sidebar is how everybody else ever
 * finds out it exists. Users here are traders, not people who read release
 * notes, so a shortcut with no visible way in is a shortcut nobody uses.
 *
 * ---------------------------------------------------------------------------
 * PAGES ARE LOCAL, RECORDS COME FROM THE SERVER
 * ---------------------------------------------------------------------------
 * The page list is a dozen items and is filtered in the browser, so it is
 * instant and works with no connection. Customers and invoices cannot be:
 * there may be thousands, so they are searched where they live.
 *
 * Both reuse the list endpoints that already exist rather than a new search
 * route. Those are already scoped to this wholesaler and already respect
 * staff permissions, and a second query over the same tables is a second
 * place for that scoping to be got wrong.
 *
 * Debounced, and only past two characters. A request per keystroke from the
 * first letter would fire a dozen queries to find one customer, and "a" matches
 * most of the book anyway.
 */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

const CommandPalette = ({ items, onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState({ customers: [], invoices: [] });
  const [searching, setSearching] = useState(false);
  const listRef = useRef(null);

  const pages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const hay = `${item.label} ${(item.keywords || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  /**
   * Everything happens inside the timer, including clearing.
   *
   * Written this way so nothing sets state synchronously while the effect
   * body runs, which React 19 flags as a cascading render. It also means a
   * query shrinking back below two characters clears on the same beat as a
   * search would have landed, instead of flickering empty first.
   */
  useEffect(() => {
    const q = query.trim();
    let alive = true;

    const timer = setTimeout(async () => {
      if (q.length < MIN_QUERY) {
        if (alive) {
          setRecords({ customers: [], invoices: [] });
          setSearching(false);
        }
        return;
      }

      // Settled, not all: a wholesaler without the purchase book, or an
      // employee without the invoices permission, gets a 503 or a 403 on one
      // of these. That must narrow the results, not empty them.
      const [customers, invoices] = await Promise.allSettled([
        api.get("/api/parties", { params: { search: q } }),
        api.get("/api/invoices", { params: { search: q, limit: 5 } }),
      ]);
      if (!alive) return;
      setRecords({
        customers:
          customers.status === "fulfilled" && Array.isArray(customers.value.data)
            ? customers.value.data.slice(0, 5)
            : [],
        invoices:
          invoices.status === "fulfilled"
            ? (invoices.value.data?.invoices || []).slice(0, 5)
            : [],
      });
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  /**
   * Every row as one flat list, so the arrow keys walk through the groups
   * without each group having to know where it starts.
   */
  const rows = useMemo(() => {
    const out = pages.map((p) => ({
      kind: "page",
      key: p.path,
      path: p.path,
      icon: p.icon,
      label: p.label,
    }));
    records.customers.forEach((c) =>
      out.push({
        kind: "customer",
        key: `c-${c.id}`,
        path: `/seller/customers/${c.id}`,
        icon: Users,
        label: c.business_name || c.name,
        hint: [c.phone, c.city].filter(Boolean).join(" · "),
        right:
          Number(c.outstanding) > 0 ? `${money(c.outstanding)} due` : undefined,
      }),
    );
    records.invoices.forEach((i) =>
      out.push({
        kind: "invoice",
        key: `i-${i.id}`,
        path: `/seller/invoices/${i.id}`,
        icon: FileText,
        label: i.invoice_number,
        hint: i.buyer_name || i.recipient_name || "",
        right: i.grand_total ? money(i.grand_total) : undefined,
      }),
    );
    return out;
  }, [pages, records]);

  const go = (row) => {
    if (!row) return;
    onClose();
    navigate(row.path);
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(rows[active]);
    }
    // Escape is ModalShell's, so it is not handled here twice.
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const shortcuts = listHotkeys();
  const heading = (text) => (
    <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
      {text}
    </p>
  );

  let lastKind = null;

  return (
    <ModalShell onClose={onClose} maxWidth="sm:max-w-lg" labelledBy="palette-title">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          id="palette-title"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Back to the top, because the list underneath has just changed
            // and the old highlighted row is not the same row any more.
            setActive(0);
            setSearching(e.target.value.trim().length >= MIN_QUERY);
          }}
          onKeyDown={onKeyDown}
          placeholder="Go to a page, or find a customer or bill..."
          className="w-full bg-transparent text-sm text-espresso outline-none placeholder:text-slate-400"
        />
        {searching && (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-clay" />
        )}
      </div>

      <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-slate-500">
            {searching
              ? "Looking..."
              : query.trim().length < MIN_QUERY
                ? "Keep typing to search your customers and bills."
                : `Nothing found for "${query.trim()}".`}
          </p>
        ) : (
          rows.map((row, i) => {
            const Icon = row.icon;
            const showHeading = row.kind !== lastKind;
            lastKind = row.kind;
            return (
              <div key={row.key}>
                {showHeading &&
                  heading(
                    row.kind === "page"
                      ? "Pages"
                      : row.kind === "customer"
                        ? "Customers"
                        : "Bills",
                  )}
                <button
                  data-index={i}
                  onClick={() => go(row)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    i === active
                      ? "bg-clay/10 text-espresso"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {Icon && (
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        i === active ? "text-clay" : "text-slate-400"
                      }`}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {row.label}
                    </span>
                    {row.hint && (
                      <span className="block truncate text-xs text-slate-400">
                        {row.hint}
                      </span>
                    )}
                  </span>
                  {row.right && (
                    <span className="shrink-0 text-xs font-bold text-slate-500">
                      {row.right}
                    </span>
                  )}
                  {i === active && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  )}
                </button>
              </div>
            );
          })
        )}

        {/* Only with an empty box. Once they are typing they are going somewhere,
            and a list of shortcuts under the results is just noise. */}
        {!query.trim() && shortcuts.length > 0 && (
          <div className="mt-2 border-t border-slate-100 px-3 pt-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Shortcuts
            </p>
            <ul className="space-y-1.5">
              {shortcuts.map((s) => (
                <li
                  key={`${s.combo}-${s.label}`}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="truncate text-slate-500">{s.label}</span>
                  <kbd className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold tracking-tight text-slate-500">
                    {prettyCombo(s.combo)}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ModalShell>
  );
};

export default CommandPalette;
