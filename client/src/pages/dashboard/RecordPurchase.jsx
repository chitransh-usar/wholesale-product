import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import api from "../../utils/axios";
import PaidInFull from "../../components/PaidInFull";
import { toast } from "sonner";
import PendingChallans from "../../components/PendingChallans";
import { useHotkey } from "../../hooks/useHotkey";
import { useMasters } from "../../hooks/useMasters";
import { money, toPaise, fromPaise } from "../../utils/money";
import ItemPicker from "../../components/ItemPicker";
import SupplierFormModal from "../../components/SupplierFormModal";

/**
 * Entering a supplier's bill, and correcting one. The same form does both,
 * for the reason RecordSale gives: two copies is how the paise arithmetic on
 * one side drifts from the other.
 *
 * Three things differ from recording a sale, and all three come from the same
 * fact, that this document was written by somebody else:
 *
 *   * Their bill number and its date are asked for, because they are what the
 *     tax department matches on and cannot be reconstructed afterwards.
 *   * The GST rate starts empty rather than at the wholesaler's own default.
 *     On a sale the rate is their to decide; on a purchase it is whatever the
 *     supplier charged, and defaulting it would invent a figure on somebody
 *     else's document.
 *   * A line can be marked as carrying no input credit.
 */

const blankLine = () => ({
  key: crypto.randomUUID(),
  itemName: "",
  quantity: "",
  unit: "pcs",
  rate: "",
  gstPercent: "",
  hsnCode: "",
  itcEligible: true,
  productId: null,
});

const RecordPurchase = () => {
  const { units, taxRates } = useMasters();
  const unitCodes = units.map((u) => u.code);

  const navigate = useNavigate();
  const { id: editingId } = useParams();
  const editing = Boolean(editingId);
  const [searchParams] = useSearchParams();

  const [suppliers, setSuppliers] = useState([]);
  // His own products, for the item box. Same source the sale and challan
  // forms read.
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notSetUp, setNotSetUp] = useState(false);

  const [supplierId, setSupplierId] = useState(searchParams.get("supplier") || "");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState("");
  const [lines, setLines] = useState([blankLine()]);
  // Goods received from this supplier that his bill has not caught up with.
  const [challanIds, setChallanIds] = useState([]);
  const [discount, setDiscount] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [purchase, setPurchase] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // His own products, for the item box. Silent on failure: the box still
      // takes a typed name, which is what it did before there was a list.
      try {
        const { data } = await api.get("/api/dashboard/inventory");
        if (alive) {
          setProducts(
            (data || [])
              .filter((row) => row.status === "Active")
              .map((row) => ({ ...row, rate: row.price })),
          );
        }
      } catch {
        if (alive) setProducts([]);
      }

      try {
        const { data } = await api.get("/api/suppliers");
        if (alive) setSuppliers(data || []);
      } catch (error) {
        if (error.response?.data?.code === "PURCHASES_NOT_SET_UP") {
          if (alive) setNotSetUp(true);
        } else {
          console.error("Failed to load suppliers", error);
          if (alive) toast.error("Could not load your supplier list.");
        }
      }

      if (editingId) {
        try {
          const { data } = await api.get(`/api/purchases/${editingId}`);
          if (alive) {
            setPurchase(data.purchase);
            setSupplierId(data.purchase.supplier_id);
            setPurchaseDate(String(data.purchase.purchase_date).slice(0, 10));
            setBillNumber(data.purchase.supplier_invoice_number || "");
            setBillDate(
              data.purchase.supplier_invoice_date
                ? String(data.purchase.supplier_invoice_date).slice(0, 10)
                : "",
            );
            setNotes(data.purchase.notes || "");
            setDiscount(
              Number(data.purchase.discount) > 0
                ? String(Number(data.purchase.discount))
                : "",
            );
            setLines(
              data.lines.map((line) => ({
                key: crypto.randomUUID(),
                itemName: line.item_name,
                quantity: String(Number(line.quantity)),
                unit: line.unit || "pcs",
                rate: String(Number(line.rate)),
                gstPercent:
                  line.gst_percent === null || line.gst_percent === undefined
                    ? ""
                    : String(Number(line.gst_percent)),
                hsnCode: line.hsn_code || "",
                itcEligible: line.itc_eligible !== false,
              })),
            );
          }
        } catch (error) {
          if (alive) {
            toast.error(
              error.response?.status === 404
                ? "That purchase is not in your book."
                : "Could not load this purchase.",
            );
          }
        }
      }

      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [editingId]);

  const setLine = (key, field, value) =>
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, [field]: value } : line)),
    );

  /**
   * A product picked off the list fills what it can.
   *
   * The rate is deliberately NOT one of them. On a sale the product list
   * price is what he charges, so filling it is right. On a purchase the
   * number that matters is what the mill charged, which is printed on the
   * bill in front of him and has nothing to do with his own selling price.
   * Filling it would be a plausible wrong number in a box he might not check,
   * which is the one kind of mistake this book must not make.
   */
  const fillFromProduct = (key, product) =>
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              itemName: product.name,
              productId: product.id,
              unit: unitCodes.includes(product.unit) ? product.unit : line.unit,
              hsnCode: product.hsn_code || line.hsnCode,
              gstPercent:
                product.gst_percent === null || product.gst_percent === undefined
                  ? line.gstPercent
                  : String(Number(product.gst_percent)),
            }
          : line,
      ),
    );

  /**
   * What he already owed this supplier, off the list already fetched for the
   * dropdown. Zero while editing, because this bill's own total is already
   * inside that figure.
   */
  const owedBefore = editing
    ? 0
    : Math.max(
        0,
        Number(suppliers.find((x) => x.id === supplierId)?.balance || 0),
      );

  const removeLine = (key) =>
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((line) => line.key !== key),
    );

  // Mirrors the server exactly: the supplier's rate is before tax, a discount
  // comes off before the tax is worked out, and it is spread across the lines
  // in proportion because they can be taxed differently.
  const totals = useMemo(() => {
    const priced = lines
      .map((line) => {
        const qty = Number(line.quantity);
        const rate = Number(line.rate);
        if (!Number.isFinite(qty) || !Number.isFinite(rate)) return null;
        return {
          amountPaise: Math.round(toPaise(rate) * qty),
          // Empty means zero here, not "use a default". See the note at the
          // top: guessing a rate on somebody else's bill invents a tax figure.
          gst: Number(line.gstPercent) || 0,
        };
      })
      .filter(Boolean);

    const subtotalPaise = priced.reduce((sum, line) => sum + line.amountPaise, 0);
    const discountPaise = Math.min(Math.max(0, toPaise(discount)), subtotalPaise);
    const taxedShare = subtotalPaise > 0 ? 1 - discountPaise / subtotalPaise : 1;

    const taxPaise = priced.reduce(
      (sum, line) =>
        sum + Math.round((line.amountPaise * taxedShare * Number(line.gst)) / 100),
      0,
    );

    return {
      subtotal: fromPaise(subtotalPaise),
      discount: fromPaise(discountPaise),
      tax: fromPaise(taxPaise),
      total: fromPaise(subtotalPaise - discountPaise + taxPaise),
    };
  }, [lines, discount]);

  const dueAfter = fromPaise(
    Math.max(0, toPaise(totals.total) - Math.max(0, toPaise(amountPaid))),
  );

  /**
   * The two keys somebody entering a stack of bills actually wants.
   *
   * Both carry a modifier, because they are inside a field when they want them
   * and a bare letter would land in the item name. Adding a line is the most
   * repeated action in this form by a wide margin.
   */
  /**
   * A challan ticked or unticked above. Same shape as the sale form: ticking
   * appends its items tagged with the challan, unticking removes exactly
   * those, and anything typed by hand carries no tag and is left alone.
   */
  const pullChallan = (ids, challan, added) => {
    setChallanIds(ids);
    if (added) {
      setLines((prev) => {
        const typed = prev.filter((l) => l.itemName || l.fromChallan);
        return [
          ...typed,
          ...(challan.lines || []).map((l) => ({
            ...blankLine(),
            fromChallan: challan.id,
            itemName: l.itemName || "",
            productId: l.productId || null,
            quantity: l.quantity ?? "",
            unit: l.unit || "pcs",
            rate: l.rate ?? "",
            hsnCode: l.hsnCode || "",
            gstPercent: l.gstPercent ?? "",
          })),
        ];
      });
    } else {
      setLines((prev) => {
        const kept = prev.filter((l) => l.fromChallan !== challan.id);
        return kept.length ? kept : [blankLine()];
      });
    }
  };

  const addLine = () => setLines((prev) => [...prev, blankLine()]);

  useHotkey("alt+n", addLine, {
    label: "Add another line",
    group: "Entering a purchase",
    allowInInput: true,
  });

  useHotkey(
    "mod+s",
    () => {
      // Submitted through the form so every check and every toast is the same
      // as pressing the button. A second save path is how the two drift.
      document.getElementById("record-purchase")?.requestSubmit();
    },
    {
      label: "Save this purchase",
      group: "Entering a purchase",
      allowInInput: true,
    },
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!supplierId) {
      toast.error("Choose a supplier.");
      return;
    }

    const filled = lines.filter(
      (line) => line.itemName.trim() && Number(line.quantity) > 0,
    );
    if (filled.length === 0) {
      toast.error("Add at least one item with a quantity.");
      return;
    }

    const payload = {
      purchaseDate,
      supplierInvoiceNumber: billNumber || undefined,
      supplierInvoiceDate: billDate || undefined,
      discount: discount || 0,
      notes,
      lines: filled.map((line) => ({
        itemName: line.itemName,
        quantity: line.quantity,
        unit: line.unit,
        rate: line.rate || 0,
        gstPercent: line.gstPercent === "" ? undefined : line.gstPercent,
        hsnCode: line.hsnCode || undefined,
        itcEligible: line.itcEligible,
        // The listing, and the challan the goods already arrived on. The
        // second is what stops the stock ledger bringing them in twice.
        productId: line.productId || undefined,
        fromChallan: line.fromChallan || undefined,
      })),
    };

    setSaving(true);
    try {
      const { data } = editing
        ? await api.put(`/api/purchases/${editingId}`, payload)
        : await api.post("/api/purchases", {
            ...payload,
            supplierId,
            amountPaid: amountPaid || 0,
            paymentMethod,
            challanIds,
          });
      toast.success(
        editing
          ? `${data.purchase_number} saved.`
          : `${data.purchase_number} entered.`,
      );
      navigate(`/seller/purchases/${data.id}`, { replace: true });
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          (editing
            ? "Could not save this purchase."
            : "Could not enter this purchase."),
      );
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

  if (notSetUp) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">
          The purchase book is not switched on yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Its tables have not been added to this database.
        </p>
      </div>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">Add a supplier first</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          A purchase always comes from somebody. Add the mill or agent you
          bought from, then come back here.
        </p>
        <button
          onClick={() => navigate("/seller/suppliers")}
          className="mt-5 rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          Go to my suppliers
        </button>
      </div>
    );
  }

  return (
    <form id="record-purchase" onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-6 pb-28">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition-colors hover:text-clay"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div>
        <h2 className="text-2xl font-black text-espresso">
          {editing
            ? `Edit ${purchase?.purchase_number || "purchase"}`
            : "Enter a supplier's bill"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {editing
            ? "Fix what was entered. What you owe this supplier moves with it."
            : "Copy across what the supplier billed you. It goes onto their account and its GST counts towards your input credit."}
        </p>
      </div>

      {/* Who, when, and whose bill */}
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <div>
          <label
            htmlFor="purchase-supplier"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Supplier <span className="text-clay">*</span>
          </label>
          {editing ? (
            <>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-600">
                {purchase?.supplier_name}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                A purchase cannot move to another supplier. If this is the
                wrong one, cancel it and enter it again.
              </p>
            </>
          ) : (
            /* The list, and a way out of it.

               A bill from a mill not yet in the book used to mean abandoning
               a half typed purchase, going to Suppliers, adding them, and
               starting again. The modal adds them here and selects them. */
            <div className="flex gap-2">
              <select
                id="purchase-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              >
                <option value="">Choose a supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                    {supplier.business_name ? ` (${supplier.business_name})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAddingSupplier(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-espresso transition-colors hover:border-clay hover:text-clay"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="purchase-date"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Date you received it
          </label>
          <input
            id="purchase-date"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
        </div>

        <div>
          <label
            htmlFor="purchase-bill"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Their bill number
          </label>
          <input
            id="purchase-bill"
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            placeholder="As printed on their bill"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
          <p className="mt-1 text-xs text-slate-500">
            The number on their paper, not ours. This is what your GST return is
            matched on, and the same bill cannot be entered twice.
          </p>
        </div>

        <div>
          <label
            htmlFor="purchase-bill-date"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Date on their bill
          </label>
          <input
            id="purchase-bill-date"
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave empty if it is the same day. A bill dated last month belongs
            to last month's return even if the goods arrived this month.
          </p>
        </div>
      </div>

      {/* Goods already received from this supplier, waiting on his bill. */}
      {!editing && (
        <PendingChallans
          kind="purchase"
          otherId={supplierId}
          selected={challanIds}
          onChange={pullChallan}
          autoSelect={searchParams.get("challan") || ""}
        />
      )}

      {/* The lines */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            What you bought
          </h3>
        </div>

        <div className="divide-y divide-slate-100">
          {lines.map((line, index) => {
            const amount = fromPaise(
              Math.round(toPaise(line.rate) * Number(line.quantity || 0)),
            );
            return (
              <div key={line.key} className="p-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <span className="mt-2.5 w-4 shrink-0 text-xs font-bold text-slate-300">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-2">
                    {/* The same picker the sale and challan forms use. What
                        the mill calls a cloth and what this wholesaler calls
                        it are often different, so the name stays typeable and
                        the list is only a shortcut. What it saves is the HSN
                        and the GST rate, which are the two fields on a
                        purchase line nobody remembers. */}
                    <ItemPicker
                      value={line.itemName}
                      items={products}
                      placeholder="Item name"
                      onChange={(name) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key
                              ? { ...l, itemName: name, productId: null }
                              : l,
                          ),
                        )
                      }
                      onPick={(product) => fillFromProduct(line.key, product)}
                    />

                    <div className="grid grid-cols-3 gap-2">
                      <input
                        value={line.quantity}
                        onChange={(e) =>
                          setLine(line.key, "quantity", e.target.value)
                        }
                        inputMode="decimal"
                        placeholder="Qty"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-clay"
                      />
                      <select
                        value={line.unit}
                        onChange={(e) => setLine(line.key, "unit", e.target.value)}
                        aria-label="Unit"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none transition-colors focus:border-clay"
                      >
                        {units.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.code}
                          </option>
                        ))}
                      </select>
                      <input
                        value={line.rate}
                        onChange={(e) => setLine(line.key, "rate", e.target.value)}
                        inputMode="decimal"
                        placeholder="Rate"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-clay"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={line.gstPercent}
                        onChange={(e) =>
                          setLine(line.key, "gstPercent", e.target.value)
                        }
                        aria-label="GST rate they charged"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none transition-colors focus:border-clay"
                      >
                        <option value="">GST they charged</option>
                        {taxRates.map((rate) => (
                          <option key={rate.rate} value={rate.rate}>
                            {rate.label || `GST ${rate.rate}%`}
                          </option>
                        ))}
                      </select>
                      <input
                        value={line.hsnCode}
                        onChange={(e) =>
                          setLine(line.key, "hsnCode", e.target.value)
                        }
                        placeholder="HSN (optional)"
                        aria-label="HSN code"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-clay"
                      />
                    </div>

                    {/* Off by default on nothing. Almost every purchase a
                        wholesaler makes is claimable, so this is the exception
                        they ticks, not a box they have to clear each time. */}
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={!line.itcEligible}
                        onChange={(e) =>
                          setLine(line.key, "itcEligible", !e.target.checked)
                        }
                        className="h-3.5 w-3.5 accent-clay"
                      />
                      No input credit on this line
                    </label>

                    <p className="text-right text-sm font-black text-espresso sm:hidden">
                      {amount > 0 ? `₹${money(amount, { document: true })}` : ""}
                    </p>
                  </div>

                  <div className="hidden w-24 shrink-0 pt-2 text-right sm:block">
                    <p className="text-sm font-black text-espresso">
                      {amount > 0 ? `₹${money(amount, { document: true })}` : "-"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    className="mt-1.5 shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-100 p-4 sm:px-5">
          <button
            type="button"
            onClick={addLine}
            className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-bold text-slate-500 transition-colors hover:border-clay hover:text-clay"
          >
            <Plus className="h-4 w-4" />
            Add another item
          </button>
        </div>
      </div>

      {/* Money */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Their bill
          </h3>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Goods total</span>
            <span className="font-bold text-espresso">
              ₹{money(totals.subtotal, { document: true })}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label htmlFor="purchase-discount" className="text-sm text-slate-500">
              Less discount
            </label>
            <input
              id="purchase-discount"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-28 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm outline-none transition-colors focus:border-clay"
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">GST</span>
            <span className="font-bold text-espresso">
              ₹{money(totals.tax, { document: true })}
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm font-bold text-espresso">Bill total</span>
            <span className="text-xl font-black text-espresso">
              ₹{money(totals.total, { document: true })}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Check this against the figure printed on their bill. If they differ by
            a rupee their software has rounded a line differently, and the printed
            one is the one that counts.
          </p>
        </div>

        {editing ? (
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Money paid
            </h3>
            <p className="text-xs text-slate-500">
              Payments are not changed here. Record or correct them from the
              supplier's page, so the money and the bill stay separate.
            </p>
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Paid now
            </h3>
            <p className="text-xs text-slate-500">
              Leave this empty if you will pay later. Whatever is left shows on
              their account.
            </p>

            {/* What he already owed this mill, before this bill. Same reason
                as the sale form: the tick below settles THIS bill only, and a
                wholesaler on a supplier he already owes 40,000 reads it as
                being square. Read off the supplier list already loaded for
                the dropdown. */}
            {owedBefore > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-bold text-amber-900">
                  You already owe{" "}
                  {suppliers.find((x) => x.id === supplierId)?.name || "this supplier"}{" "}
                  ₹{money(owedBefore)}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  From earlier bills. The tick below settles this bill only.
                </p>
              </div>
            )}

            <PaidInFull
              id="purchase-paid-in-full"
              total={totals.total}
              value={amountPaid}
              onChange={setAmountPaid}
              label="Paid the whole bill"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-label="Amount paid"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              />
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                aria-label="Payment method"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-sm font-bold text-espresso">
                You will still owe
              </span>
              <span
                className={`text-xl font-black ${
                  dueAfter > 0 ? "text-amber-600" : "text-emerald-600"
                }`}
              >
                ₹{money(dueAfter, { document: true })}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label
          htmlFor="purchase-notes"
          className="mb-1.5 block text-sm font-bold text-espresso"
        >
          Note
        </label>
        <textarea
          id="purchase-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything you want to remember about this purchase"
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Bill total
            </p>
            <p className="text-lg font-black text-espresso">
              ₹{money(totals.total, { document: true })}
            </p>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-clay px-6 py-3 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            {saving ? "Saving..." : editing ? "Save changes" : "Save purchase"}
          </button>
        </div>
      </div>

      {/* Adds them and selects them, so the purchase being typed carries on
          rather than being abandoned. The list is reloaded from the server
          instead of being patched locally, so the new row is exactly what
          every other row is. */}
      {addingSupplier && (
        <SupplierFormModal
          onClose={() => setAddingSupplier(false)}
          onSaved={async (created) => {
            setAddingSupplier(false);
            try {
              const { data } = await api.get("/api/suppliers");
              setSuppliers(Array.isArray(data) ? data : []);
            } catch {
              // The supplier was created either way. Leaving the list stale
              // is better than losing the purchase being typed.
            }
            if (created?.id) setSupplierId(created.id);
          }}
        />
      )}
    </form>
  );
};

export default RecordPurchase;
