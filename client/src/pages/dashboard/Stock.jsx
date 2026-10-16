import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, TriangleAlert, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { trimmed, dateLabel } from "../../utils/money";

/**
 * What is on hand, item by item.
 *
 * Every figure is a SUM of the stock ledger, never a stored counter, so the
 * number and the register behind it cannot disagree: clicking a row shows the
 * rows that add up to it.
 *
 * TWO NUMBERS, SAID APART. "In your book" is what his own documents come to.
 * "On your shop page" is the quantity the marketplace offers and reserves
 * against orders. They answer different questions and this screen refuses to
 * merge them, because a single blended figure would be wrong for both.
 */

const KIND_WORDS = {
  sale: "Sale",
  purchase: "Purchase",
  sale_challan: "Sale challan",
  purchase_challan: "Purchase challan",
  credit_note: "Credit note",
  opening: "Opening",
  adjustment: "Adjustment",
};

const Movements = ({ productId }) => {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .get(`/api/stock/${productId || "none"}`)
      .then(({ data }) => alive && setRows(data.movements || []))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [productId]);

  if (rows === null) {
    return <p className="px-4 py-4 text-xs text-slate-500">Loading...</p>;
  }
  if (rows.length === 0) {
    return <p className="px-4 py-4 text-xs text-slate-500">Nothing yet.</p>;
  }

  return (
    <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/60">
      <table className="w-full text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-4 py-2 font-bold">Date</th>
            <th className="px-4 py-2 font-bold">What</th>
            <th className="px-4 py-2 font-bold">Number</th>
            <th className="px-4 py-2 text-right font-bold">In</th>
            <th className="px-4 py-2 text-right font-bold">Out</th>
            <th className="px-4 py-2 text-right font-bold">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/70">
          {rows.map((row) => {
            const qty = Number(row.quantity);
            return (
              <tr key={row.id} className={row.reverses_id ? "text-slate-400" : ""}>
                <td className="whitespace-nowrap px-4 py-2">{dateLabel(row.moved_on)}</td>
                <td className="px-4 py-2">
                  {KIND_WORDS[row.document_kind] || row.document_kind}
                  {/* A reversal is shown, never hidden. A cancelled document
                      still happened and the register has to say so. */}
                  {row.reverses_id ? " (cancelled)" : ""}
                </td>
                <td className="px-4 py-2 font-medium">{row.document_number || "-"}</td>
                {/* Signed and coloured, because a register is scanned down
                    rather than read. Goods coming in are green with a plus,
                    going out red with a minus, so a purchase is recognisable
                    without reading which column it landed in. */}
                <td className="px-4 py-2 text-right font-bold text-emerald-700">
                  {qty > 0 ? `+${trimmed(qty)}` : ""}
                </td>
                <td className="px-4 py-2 text-right font-bold text-rose-700">
                  {qty < 0 ? `-${trimmed(Math.abs(qty))}` : ""}
                </td>
                <td className="px-4 py-2 text-right font-bold text-espresso">
                  {trimmed(row.running)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Stock = () => {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(true);
  const [notReadyMessage, setNotReadyMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/stock")
      .then(({ data }) => {
        if (!alive) return;
        setReady(data.ready !== false);
        setNotReadyMessage(data.message || "");
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Could not load your stock.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  // The migration is run by hand, so "not switched on yet" is a normal state
  // and gets a plain explanation rather than an error.
  if (!ready) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <TriangleAlert className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-black text-espresso">Stock is not switched on yet</h2>
        <p className="mt-2 text-sm text-slate-600">{notReadyMessage}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-black text-espresso">Stock</h2>
        <p className="mt-1 text-sm text-slate-500">
          What you have, worked out from your own bills and challans.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <Boxes className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="font-semibold text-espresso">Nothing has moved yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Enter a purchase or record a sale and it starts building up here.
            Only what happens from now on is counted, so if you already hold
            stock, enter it as a purchase.
          </p>
          <Link
            to="/seller/purchases/new"
            className="mt-5 inline-block rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
          >
            Enter a bill
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-12 gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 sm:px-5">
            <div className="col-span-6">Item</div>
            <div className="col-span-3 text-right">In your book</div>
            <div className="col-span-3 text-right">On your shop page</div>
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((item) => {
              const key = item.product_id || `typed:${item.typed_name}`;
              const onHand = Number(item.on_hand);
              const open = openId === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : key)}
                    className="grid w-full cursor-pointer grid-cols-12 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 sm:px-5"
                  >
                    <div className="col-span-6 min-w-0">
                      <p className="truncate text-sm font-bold text-espresso">
                        {item.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {item.movements} movement{Number(item.movements) === 1 ? "" : "s"}
                        {item.last_moved ? ` · last ${dateLabel(item.last_moved)}` : ""}
                        {/* A line somebody typed rather than picked cannot be
                            tied to a listing, and saying so is better than
                            showing a total that looks like a product's. */}
                        {!item.product_id ? " · typed by hand" : ""}
                      </p>
                    </div>
                    <div className="col-span-3 text-right">
                      <span
                        className={`text-base font-black ${
                          onHand < 0 ? "text-rose-600" : "text-espresso"
                        }`}
                      >
                        {trimmed(onHand)}
                      </span>
                      {item.unit ? (
                        <span className="ml-1 text-xs font-medium text-slate-400">
                          {item.unit}
                        </span>
                      ) : null}
                    </div>
                    <div className="col-span-3 text-right text-sm font-bold text-slate-500">
                      {item.offered_on_shop === null || item.offered_on_shop === undefined
                        ? "-"
                        : trimmed(item.offered_on_shop)}
                    </div>
                  </button>
                  {open && <Movements productId={item.product_id} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Said out loud, because a wholesaler seeing two different numbers for
          the same cloth will otherwise assume one of them is broken. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-espresso">Why there are two numbers</h3>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex gap-3">
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
            <div>
              <dt className="font-bold text-espresso">In your book</dt>
              <dd className="text-slate-600">
                Added up from your purchases, sales and challans. This is what
                you actually hold.
              </dd>
            </div>
          </div>
          <div className="flex gap-3">
            <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
            <div>
              <dt className="font-bold text-espresso">On your shop page</dt>
              <dd className="text-slate-600">
                The quantity you are offering to buyers online. It goes down
                when somebody orders, and you set it on the product.
              </dd>
            </div>
          </div>
        </dl>
      </div>
    </div>
  );
};

export default Stock;
