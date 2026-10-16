import { useState, useEffect } from "react";
import {
  Boxes,
  Plus,
  Search,
  Edit,
  Trash2,
  Globe,
  Store,
  Lock,
  ExternalLink,
  Link as LinkIcon,
  MessageCircle,
  Check,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../utils/axios";
import { useAuth } from "../../context/AuthContext";
import { toast } from "sonner";
import ProductThumb from "../../components/ProductThumb";

// Matches the visibility column on supplier_inventory. Plain English, because
// the people reading this are traders, not shopkeepers of the internet.
const VISIBILITY_OPTIONS = [
  {
    value: "public",
    label: "Everyone",
    icon: Globe,
    className: "bg-sky-50 text-sky-700 border-sky-200",
    title: "Buyers can find this in search, next to other sellers",
  },
  {
    value: "storefront",
    label: "Shop page",
    icon: Store,
    className: "bg-clay/10 text-clay border-clay/20",
    title: "Not in search. Buyers see it only on your shop page",
  },
  {
    value: "private",
    label: "Link only",
    icon: Lock,
    className: "bg-slate-100 text-slate-600 border-slate-200",
    title: "Hidden from the site. Only people you send the link to can see it",
  },
];

const VISIBILITY_BY_VALUE = Object.fromEntries(
  VISIBILITY_OPTIONS.map((o) => [o.value, o]),
);

// Trailing zeros read badly: a pack size of 20.000 should show as 20.
const trim = (value) =>
  value === null || value === undefined || value === ""
    ? ""
    : String(Number(value));

// The link a wholesaler sends on WhatsApp. It opens the product on its own
// page, which works for a hidden listing too because the page is reached by
// the link rather than by browsing.
const shareUrlFor = (inventoryId) =>
  `${window.location.origin}/listing/${inventoryId}`;

/**
 * The rate, editable where it is shown.
 *
 * Changing prices is something a wholesaler does across many products at
 * once, so making them open a form per product would make the screen useless.
 * Saves on blur, and only when the number actually changed.
 *
 * It sends the price alone. The endpoint leaves every other column as it
 * stands, so editing a rate cannot disturb what the shop shows.
 */
const RateCell = ({ item, onSaved }) => {
  const [value, setValue] = useState(String(Number(item.price)));
  const [saving, setSaving] = useState(false);

  const reset = () => setValue(String(Number(item.price)));

  const commit = async () => {
    const next = value.trim();
    if (next === "" || Number(next) === Number(item.price)) return reset();
    if (!Number.isFinite(Number(next)) || Number(next) < 0) {
      toast.error("Enter a valid rate.");
      return reset();
    }

    setSaving(true);
    try {
      const { data } = await api.put(`/api/products/inventory/${item.id}`, {
        price: next,
      });
      onSaved(data);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not save the rate.");
      reset();
    }
    setSaving(false);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-sm text-slate-400">₹</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            reset();
            e.currentTarget.blur();
          }
        }}
        disabled={saving}
        inputMode="decimal"
        aria-label={`Rate for ${item.name}`}
        className="w-24 rounded-lg border border-transparent bg-slate-50 px-2 py-1.5 text-right text-sm font-bold text-espresso outline-none transition-colors hover:border-slate-200 focus:border-clay focus:bg-white disabled:opacity-50"
      />
    </div>
  );
};

/**
 * Where this product is shown, changed in place.
 *
 * A badge would only report it. Deciding what the shop shows is the thing a
 * wholesaler comes to this screen to do, so it is a control, not a label.
 */
const VisibilityCell = ({ item, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const current = VISIBILITY_BY_VALUE[item.visibility] || VISIBILITY_OPTIONS[0];
  const CurrentIcon = current.icon;

  const change = async (visibility) => {
    if (visibility === item.visibility) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/api/products/inventory/${item.id}`, {
        visibility,
      });
      onSaved(data);
      toast.success(
        `${item.name} is now shown to: ${VISIBILITY_BY_VALUE[visibility].label}`,
      );
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Could not change where this shows.",
      );
    }
    setSaving(false);
  };

  return (
    <div
      className={`relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${current.className} ${saving ? "opacity-50" : ""}`}
      title={current.title}
    >
      <CurrentIcon className="h-3 w-3 shrink-0" />
      {current.label}
      {/* The select sits invisibly on top so the badge itself is the control.
          Native on purpose: it is the one picker that works properly on a
          cheap Android phone. */}
      <select
        value={item.visibility || "public"}
        disabled={saving}
        onChange={(e) => change(e.target.value)}
        aria-label={`Where ${item.name} is shown`}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {VISIBILITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const MyProducts = () => {
  const { user } = useAuth();
  const [copiedId, setCopiedId] = useState(null);
  const [inventory, setInventory] = useState([]);
  /**
   * What he holds, per listing, out of the stock ledger.
   *
   * A separate call rather than a column on the inventory row, because the
   * two numbers answer different questions and joining them would invite
   * somebody to treat one as the other. Silent on failure and empty on a
   * database without the migration: the product list is useful without it.
   */
  const [bookStock, setBookStock] = useState({});

  useEffect(() => {
    let alive = true;
    api
      .get("/api/stock")
      .then(({ data }) => {
        if (!alive || data.ready === false) return;
        const byId = {};
        for (const row of data.items || []) {
          if (row.product_id) byId[row.product_id] = Number(row.on_hand);
        }
        setBookStock(byId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const navigate = useNavigate();

  const handleCopyLink = async (item) => {
    const url = shareUrlFor(item.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      toast.success("Link copied. Paste it on WhatsApp to share.");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard is blocked outside a secure context, so show the link
      // instead of failing quietly.
      toast.info(url);
    }
  };

  const handleWhatsApp = (item) => {
    const text = `${item.name} - ₹${item.price}. Minimum order ${trim(item.moq)} ${item.unit || ""}. ${shareUrlFor(item.id)}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener",
    );
  };

  useEffect(() => {
    const fetchInventory = async () => {
      try {
        const response = await api.get("/api/dashboard/inventory");
        setInventory(response.data);
      } catch (error) {
        console.error("Failed to fetch inventory", error);
        toast.error("Could not load your products.");
      } finally {
        setLoading(false);
      }
    };
    fetchInventory();
  }, []);

  // The endpoint returns the listing row, which has no product name on it, so
  // the row that was already on screen supplies the parts it does not carry.
  const applyUpdate = (updated) =>
    setInventory((prev) =>
      prev.map((item) =>
        item.id === updated.id ? { ...item, ...updated } : item,
      ),
    );

  const handleDelete = async (inventoryId) => {
    if (
      !window.confirm(
        "Are you sure you want to remove this product? If you have active orders, it will be marked as 'Draft' instead of deleted.",
      )
    )
      return;

    try {
      const { data } = await api.delete(
        `/api/products/inventory/${inventoryId}`,
      );
      if (data.softDeleted) {
        setInventory((prev) =>
          prev.map((item) =>
            item.id === inventoryId ? { ...item, status: "Draft" } : item,
          ),
        );
        toast.success(data.message);
      } else {
        setInventory((prev) => prev.filter((item) => item.id !== inventoryId));
        toast.success("Product removed successfully");
      }
    } catch (error) {
      console.error("Failed to delete", error);
      toast.error("Could not remove product. Please try again.");
    }
  };

  const displayedInventory = inventory.filter((item) => {
    if (
      searchQuery &&
      !item.name.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }

    if (filter === "Active" && item.status !== "Active") return false;
    if (filter === "Draft" && item.status !== "Draft") return false;
    if (filter === "Shop page" && item.visibility !== "storefront")
      return false;
    if (filter === "Link only" && item.visibility !== "private") return false;
    return true;
  });

  const hiddenCount = inventory.filter(
    (item) => item.visibility === "private" && item.status === "Active",
  ).length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-black text-espresso">Products</h2>
          <p className="mt-1 text-sm text-slate-500">
            Everything you sell, and who can see it. Your rates here are used
            when you make a bill.
            {hiddenCount > 0 && (
              <span className="font-semibold text-clay">
                {" "}
                {hiddenCount} product{hiddenCount === 1 ? " is" : "s are"} not
                on the site. Send the link to show {hiddenCount === 1 ? "it" : "them"}.
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user?.id && (
            <Link
              to={`/wholesaler/${user.id}`}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:border-clay hover:text-clay"
              title="See your shop page the way buyers see it"
            >
              <ExternalLink className="h-4 w-4" />
              My Shop Page
            </Link>
          )}
          <Link
            to="/seller/products/new"
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream shadow-sm transition-colors hover:bg-espresso"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Add Product
          </Link>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
        <div className="flex w-full items-center gap-2 overflow-x-auto pb-2 sm:w-auto sm:pb-0">
          {["All", "Active", "Draft", "Shop page", "Link only"].map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                filter === tab
                  ? "bg-slate-100 text-espresso"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="relative w-full shrink-0 sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search your products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-clay"
          />
        </div>
      </div>

      {/* Phone gets cards, not a table. Seven columns on a 390px screen means
          the rate and the shop switch sit off the right edge behind a
          sideways scroll, and those are the two things they came to change. */}
      <div className="space-y-3 sm:hidden">
        {displayedInventory.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
            {inventory.length === 0
              ? "Nothing here yet. Add what you sell and your rate for it, and you will not have to type the rate again on every bill."
              : "No products found."}
          </div>
        ) : (
          displayedInventory.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <ProductThumb src={item.image} alt={item.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-espresso">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {item.unit || "pcs"}
                    {item.pack_size ? ` · pack of ${trim(item.pack_size)}` : ""}
                    {item.moq ? ` · min ${trim(item.moq)}` : ""}
                  </p>
                  {/* What he actually holds, from the stock ledger, not the
                      shop-page offer figure beside it. Shown here because the
                      product screen is where a wholesaler looks for it and
                      there was nothing: stock lived only on its own screen.
                      Only where the ledger has something to say, so a
                      wholesaler who does not count stock sees nothing rather
                      than a zero that looks like a claim. */}
                  {bookStock[item.id] !== undefined && (
                    <Link
                      to="/seller/stock"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 transition-colors hover:text-clay"
                    >
                      <Boxes className="h-3 w-3" />
                      {trim(bookStock[item.id])} {item.unit || "pcs"} in your book
                    </Link>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    item.status === "Active"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {item.status}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <RateCell item={item} onSaved={applyUpdate} />
                <VisibilityCell item={item} onSaved={applyUpdate} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-[11px] font-medium text-slate-400">
                  {item.hsn_code ? `HSN ${item.hsn_code}` : "No HSN"}
                  {item.gst_percent !== null && item.gst_percent !== undefined
                    ? ` · GST ${trim(item.gst_percent)}%`
                    : ""}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleWhatsApp(item)}
                    className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50"
                    title="Send this product on WhatsApp"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleCopyLink(item)}
                    className="rounded-md p-2 text-slate-500 hover:bg-clay/10 hover:text-clay"
                    title="Copy the link to this product"
                  >
                    {copiedId === item.id ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <LinkIcon className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => navigate(`/seller/products/edit/${item.id}`)}
                    className="rounded-md p-2 text-slate-500 hover:bg-clay/10 hover:text-clay"
                    title="Edit product"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="rounded-md p-2 text-rose-500 hover:bg-rose-50"
                    title="Delete product"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:block">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Product
                </th>
                <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Rate
                </th>
                <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Minimum
                </th>
                <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Tax
                </th>
                <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Shown to
                </th>
                <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedInventory.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-10 text-center text-slate-500">
                    {inventory.length === 0
                      ? "Nothing here yet. Add what you sell and your rate for it, and you will not have to type the rate again on every bill."
                      : "No products found."}
                  </td>
                </tr>
              ) : (
                displayedInventory.map((item) => (
                  <tr
                    key={item.id}
                    className="group transition-colors hover:bg-slate-50/50"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <ProductThumb src={item.image} alt={item.name} />
                        <div>
                          <p className="max-w-50 truncate text-sm font-bold text-espresso sm:max-w-xs">
                            {item.name}
                          </p>
                          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            {item.unit || "pcs"}
                            {item.pack_size
                              ? ` · pack of ${trim(item.pack_size)}`
                              : ""}
                            {item.category ? ` · ${item.category}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <RateCell item={item} onSaved={applyUpdate} />
                      {item.discount_price && (
                        <span className="mt-0.5 ml-5 block w-fit rounded bg-clay/10 px-1.5 text-[10px] font-semibold text-clay">
                          Bulk: ₹{item.discount_price}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <span className="text-[11px] font-medium text-slate-500">
                        {item.moq ? `${trim(item.moq)} ${item.unit || ""}` : "-"}
                      </span>
                    </td>
                    {/* Blank is honest here. An HSN code or a tax rate the
                        wholesaler has not given is not something to guess at,
                        because it goes on a tax document. */}
                    <td className="px-3 py-4">
                      <div className="flex flex-col text-[11px] font-medium text-slate-500">
                        <span>{item.hsn_code || "-"}</span>
                        {item.gst_percent !== null &&
                          item.gst_percent !== undefined && (
                            <span className="text-slate-400">
                              GST {trim(item.gst_percent)}%
                            </span>
                          )}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <VisibilityCell item={item} onSaved={applyUpdate} />
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          item.status === "Active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {/* Always visible, not hover-only: for a "Link only"
                          product the share button is the single way to put it
                          in front of a buyer, so it must not be hidden until
                          the mouse arrives. */}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleWhatsApp(item)}
                          className="rounded-md bg-slate-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 lg:bg-transparent"
                          title="Send this product on WhatsApp"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => handleCopyLink(item)}
                          className="rounded-md bg-slate-50 p-2 text-slate-500 transition-colors hover:bg-clay/10 hover:text-clay lg:bg-transparent"
                          title="Copy the link to this product"
                        >
                          {copiedId === item.id ? (
                            <Check className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <LinkIcon className="h-4 w-4" />
                          )}
                        </button>

                        <button
                          onClick={() =>
                            navigate(`/seller/products/edit/${item.id}`)
                          }
                          className="rounded-md bg-slate-50 p-2 text-slate-500 transition-colors hover:bg-clay/10 hover:text-clay lg:bg-transparent"
                          title="Edit product"
                        >
                          <Edit className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => handleDelete(item.id)}
                          className="rounded-md bg-rose-50/50 p-2 text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-700 lg:bg-transparent"
                          title="Delete product"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        Tap a rate to change it. It saves as soon as you move away.
      </p>
    </div>
  );
};

export default MyProducts;
