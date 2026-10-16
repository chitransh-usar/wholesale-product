import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, Save, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import api from "../../utils/axios";
import { useMasters } from "../../hooks/useMasters";
import { amount as money } from "../../utils/money";
import ItemPicker from "../../components/ItemPicker";

/**
 * Recording a challan: goods moved, no bill yet.
 *
 * One form for both directions, because they are the same document pointing
 * opposite ways. Everything that differs is the word for the other party and
 * which list it comes from, and two nearly identical screens is how one of
 * them quietly stops matching the other.
 *
 * NO TAX ANYWHERE ON THIS FORM, on purpose. A challan carries the value of
 * the goods and nothing else. The GST rate IS captured per line, because the
 * bill raised from this later needs it and nobody wants to type the whole
 * list twice, but it is not totalled here and it is not charged here. See
 * services/challanBook.js for why that line matters.
 */

const blankLine = () => ({
  itemName: "",
  hsnCode: "",
  quantity: "",
  unit: "",
  rate: "",
  gstPercent: "",
  // Set only when the name came off the product list. Typing a name that is
  // on no list stays allowed, and stays null, which is the same rule the sale
  // form has always had: the line stores the NAME as text and the product is
  // a reference alongside it, not instead of it.
  productId: null,
});

const RecordChallan = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const editing = Boolean(id);

  const [kind, setKind] = useState(params.get("kind") === "purchase" ? "purchase" : "sale");
  const [others, setOthers] = useState([]);
  const [otherId, setOtherId] = useState("");
  const [reason, setReason] = useState("bill_to_follow");
  const [reasons, setReasons] = useState([]);
  const [reasonNote, setReasonNote] = useState("");
  const [supplierChallanNumber, setSupplierChallanNumber] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([blankLine()]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [number, setNumber] = useState("");
  // The wholesaler's own products, for the item box. Same source the sale
  // form reads, so a product added on the Products screen can be picked here
  // without a second list to keep in step.
  const [products, setProducts] = useState([]);

  const { units } = useMasters();
  const unitCodes = units.map((u) => u.code);
  const isSale = kind === "sale";

  // The other party, and the word for them.
  const who = isSale
    ? { label: "Customer", list: "/api/parties", blank: "Who did the goods go to?" }
    : { label: "Supplier", list: "/api/suppliers", blank: "Who did the goods come from?" };

  useEffect(() => {
    let alive = true;
    api
      .get(who.list)
      .then(({ data }) => {
        if (!alive) return;
        setOthers(Array.isArray(data) ? data : data?.parties || data?.suppliers || []);
      })
      .catch(() => alive && setOthers([]));
    return () => {
      alive = false;
    };
  }, [who.list]);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/dashboard/inventory")
      .then(({ data }) => {
        if (!alive) return;
        setProducts(
          (data || [])
            // Something they have stopped selling is noise in a picker.
            .filter((row) => row.status === "Active")
            // The listing calls it price, the picker calls it rate, and they
            // are the same number. The sale form does this same rename.
            .map((row) => ({ ...row, rate: row.price })),
        );
      })
      // Silent. The box still takes a typed name, which is what it did before
      // there was a list at all, so a failed lookup is not worth a toast.
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get(`/api/challans/reasons?kind=${kind}`)
      .then(({ data }) => alive && setReasons(data.reasons || []))
      .catch(() => alive && setReasons([]));
    return () => {
      alive = false;
    };
  }, [kind]);

  // Editing an existing one.
  useEffect(() => {
    if (!editing) return undefined;
    let alive = true;
    api
      .get(`/api/challans/${id}`)
      .then(({ data }) => {
        if (!alive) return;
        const c = data.challan || data;
        setKind(c.kind === "purchase" ? "purchase" : "sale");
        setOtherId(c.supplier_id || c.party_id || "");
        setReason(c.reason || "bill_to_follow");
        setReasonNote(c.reason_note || "");
        setSupplierChallanNumber(c.supplier_challan_number || "");
        setNumber(c.challan_number || "");
        if (c.issue_date) setIssueDate(String(c.issue_date).slice(0, 10));
        setLines(
          (c.items || []).map((i) => ({
            itemName: i.item_name || "",
            hsnCode: i.hsn_code || "",
            quantity: i.quantity ?? "",
            unit: i.unit || "",
            rate: i.unit_price ?? "",
            gstPercent: i.gst_percent ?? "",
            // Carried through an edit. Without this, opening a challan and
            // saving it again would quietly drop the product link off every
            // line that was not retyped.
            productId: i.product_id || null,
          })),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Could not load that challan.");
        navigate("/seller/challans");
      });
    return () => {
      alive = false;
    };
  }, [editing, id, navigate]);

  const setLine = (index, field, value) =>
    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));

  /**
   * A product picked off the list fills the rest of the line.
   *
   * The rate goes in because a challan states the value of the goods, and the
   * GST rate goes in because the bill raised from this challan needs it and
   * nobody wants to type the whole list twice. Neither is charged here.
   *
   * Typing over any of it afterwards is fine. A challan for 40 metres at a
   * price agreed on the phone is an ordinary thing, and the product list is a
   * starting point, not the authority.
   */
  const fillFromProduct = (index, product) =>
    setLines((rows) =>
      rows.map((r, i) =>
        i === index
          ? {
              ...r,
              itemName: product.name,
              productId: product.id,
              rate: String(Number(product.rate)),
              unit: unitCodes.includes(product.unit) ? product.unit : r.unit,
              hsnCode: product.hsn_code || r.hsnCode,
              gstPercent:
                product.gst_percent === null || product.gst_percent === undefined
                  ? r.gstPercent
                  : String(Number(product.gst_percent)),
            }
          : r,
      ),
    );

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0),
        0,
      ),
    [lines],
  );

  const save = async (e) => {
    e.preventDefault();
    if (!otherId) {
      toast.error(who.blank);
      return;
    }
    const filled = lines.filter((l) => l.itemName.trim());
    if (filled.length === 0) {
      toast.error("Add at least one item.");
      return;
    }

    setSaving(true);
    const body = {
      kind,
      [isSale ? "partyId" : "supplierId"]: otherId,
      reason,
      reasonNote,
      supplierChallanNumber,
      issueDate,
      lines: filled.map((l) => ({
        itemName: l.itemName,
        hsnCode: l.hsnCode,
        quantity: l.quantity === "" ? 1 : Number(l.quantity),
        unit: l.unit,
        rate: l.rate === "" ? 0 : Number(l.rate),
        gstPercent: l.gstPercent === "" ? null : Number(l.gstPercent),
        productId: l.productId || null,
      })),
    };

    try {
      if (editing) {
        await api.put(`/api/challans/${id}`, body);
        toast.success("Challan updated.");
        navigate(`/seller/challans/${id}`);
      } else {
        const { data } = await api.post("/api/challans", body);
        toast.success(`Challan ${data.challan.challan_number} recorded.`);
        navigate(`/seller/challans/${data.challan.id}`);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not save that challan.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  const field =
    "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-clay focus:bg-white";

  return (
    <form onSubmit={save} className="mx-auto max-w-4xl space-y-5">
      <div>
        <button
          type="button"
          onClick={() => navigate("/seller/challans")}
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-clay"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All challans
        </button>
        <h2 className="flex items-center gap-2 text-2xl font-black text-espresso">
          <Truck className="h-6 w-6 text-slate-400" />
          {editing ? `Edit ${number}` : "Record a challan"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Goods moved, bill later. No GST here, and nothing is owed yet.
        </p>
      </div>

      {/* Which book it belongs to. Fixed once it exists: a sale challan and a
          purchase challan are different documents in different runs. */}
      {!editing && (
        <div className="flex gap-2">
          {[
            { code: "sale", label: "Sales" },
            { code: "purchase", label: "Purchases" },
          ].map((k) => (
            <button
              key={k.code}
              type="button"
              onClick={() => {
                setKind(k.code);
                setOtherId("");
              }}
              className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                kind === k.code
                  ? "bg-espresso text-cream"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ch-other" className="mb-1.5 block text-xs font-semibold text-slate-600">
              {who.label} <span className="text-rose-500">*</span>
            </label>
            <select
              id="ch-other"
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              disabled={editing}
              className={`${field} disabled:opacity-60`}
            >
              <option value="">Choose</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.business_name ? `${o.name} (${o.business_name})` : o.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ch-date" className="mb-1.5 block text-xs font-semibold text-slate-600">
              Date
            </label>
            <input
              id="ch-date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className={field}
            />
          </div>

          <div>
            <label htmlFor="ch-reason" className="mb-1.5 block text-xs font-semibold text-slate-600">
              Why no bill yet
            </label>
            <select
              id="ch-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={field}
            >
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {reasons.find((r) => r.code === reason)?.hint || ""}
            </p>
          </div>

          {/* Only on the way in. His challan number is what the godown will be
              asked for when the goods are checked. */}
          {!isSale && (
            <div>
              <label
                htmlFor="ch-theirs"
                className="mb-1.5 block text-xs font-semibold text-slate-600"
              >
                Their challan number
              </label>
              <input
                id="ch-theirs"
                value={supplierChallanNumber}
                onChange={(e) => setSupplierChallanNumber(e.target.value)}
                placeholder="On the paper that came with the goods"
                className={field}
              />
            </div>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="ch-note" className="mb-1.5 block text-xs font-semibold text-slate-600">
            Note
          </label>
          <input
            id="ch-note"
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder="Optional"
            className={field}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 p-5">
          <h3 className="font-bold text-espresso">What moved</h3>
          <button
            type="button"
            onClick={() => setLines((r) => [...r, blankLine()])}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-espresso transition-colors hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {lines.map((line, i) => (
            <div
              key={i}
              className="grid grid-cols-2 gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 sm:grid-cols-12"
            >
              <div className="col-span-2 sm:col-span-4">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Item
                </label>
                <ItemPicker
                  value={line.itemName}
                  items={products}
                  placeholder="Cotton shirting"
                  // Typed over by hand, so whatever product this used to be
                  // is no longer what the line says. Dropping the id keeps
                  // the reference honest rather than pointing at a product
                  // whose name has been replaced.
                  onChange={(name) =>
                    setLines((rows) =>
                      rows.map((r, ix) =>
                        ix === i ? { ...r, itemName: name, productId: null } : r,
                      ),
                    )
                  }
                  onPick={(product) => fillFromProduct(i, product)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  HSN
                </label>
                <input
                  value={line.hsnCode}
                  onChange={(e) => setLine(i, "hsnCode", e.target.value)}
                  inputMode="numeric"
                  className={field}
                />
              </div>
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Qty
                </label>
                <input
                  value={line.quantity}
                  onChange={(e) => setLine(i, "quantity", e.target.value)}
                  inputMode="decimal"
                  className={field}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Unit
                </label>
                <select
                  value={line.unit}
                  onChange={(e) => setLine(i, "unit", e.target.value)}
                  className={field}
                >
                  <option value="">-</option>
                  {(units || []).map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Rate
                </label>
                <input
                  value={line.rate}
                  onChange={(e) => setLine(i, "rate", e.target.value)}
                  inputMode="decimal"
                  className={field}
                />
              </div>
              {/* Captured, never charged here. The bill raised from this needs
                  it and retyping the whole list would be the main reason not
                  to bother with a challan at all. */}
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  GST %
                </label>
                <input
                  value={line.gstPercent}
                  onChange={(e) => setLine(i, "gstPercent", e.target.value)}
                  inputMode="decimal"
                  placeholder="later"
                  className={field}
                />
              </div>
              <div className="flex items-end justify-end sm:col-span-1">
                <button
                  type="button"
                  onClick={() => setLines((r) => (r.length === 1 ? r : r.filter((_, x) => x !== i)))}
                  disabled={lines.length === 1}
                  className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 sm:px-6">
          <div className="ml-auto w-full max-w-xs">
            <div className="flex items-baseline justify-between font-black text-espresso">
              <span className="text-xs uppercase tracking-wider">Value of goods</span>
              <span className="text-base">₹{money(total)}</span>
            </div>
            <p className="mt-1 text-right text-xs text-slate-500">
              Tax is worked out on the bill.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => navigate("/seller/challans")}
          className="cursor-pointer rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-espresso transition-colors hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-espresso px-8 py-3 text-sm font-bold text-cream shadow-sm transition-colors hover:bg-clay disabled:opacity-70"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : editing ? "Save changes" : "Record challan"}
        </button>
      </div>
    </form>
  );
};

export default RecordChallan;
