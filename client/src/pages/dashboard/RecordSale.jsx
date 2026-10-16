import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import PendingChallans from "../../components/PendingChallans";
import PartyFormModal from "../../components/PartyFormModal";
import { useHotkey } from "../../hooks/useHotkey";
import ItemPicker from "../../components/ItemPicker";
import TransportCard from "../../components/TransportFields";
import PaidInFull from "../../components/PaidInFull";
import {
  blankTransport,
  transportFromRow,
  hasTransport,
} from "../../utils/transport";

// Short values on purpose here: this select sits beside the quantity box on a
// phone, where "Kilogram (kg)" would not fit.
import { useMasters } from "../../hooks/useMasters";
import { channelChoices } from "../../utils/salesChannels";
import { amount as money } from "../../utils/money";

// Same paise arithmetic as the server, so the total on screen and the total
// that gets saved cannot drift apart on an odd rate.
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const fromPaise = (paise) => Number((Number(paise || 0) / 100).toFixed(2));

const blankLine = () => ({
  key: crypto.randomUUID(),
  itemName: "",
  quantity: "",
  unit: "pcs",
  rate: "",
  // Carried from the rate list when an item is picked. moq only drives the
  // warning below and is never sent. hsnCode is sent, and is snapshot onto
  // the line so a bill raised today keeps its HSN if the rate list changes.
  moq: null,
  hsnCode: null,
  // Resolved when the item is picked, or left null to mean "use my default".
  // The server resolves it the same way and is the authority; this is only
  // so the total on screen is the total that gets saved.
  gstPercent: null,
  // The listing this line was picked off, when it was. Sent, so the stock
  // ledger can attribute the movement to a product rather than to a name.
  productId: null,
});

/**
 * Records a sale, and edits one. The same form does both: the fields are
 * identical, and a second copy is how the paise arithmetic on one side drifts
 * from the other.
 *
 * Editing does not offer the customer or the money received. Moving a sale to
 * another customer would move money between two khatas, and payments are
 * recorded from the customer's own page. A sale that has been billed cannot
 * be edited at all, which the server enforces.
 */
const RecordSale = () => {
  const { units , salesChannels } = useMasters();
  // Just the codes, for checking whether an item's stored unit is one the
  // platform still offers.
  const unitCodes = units.map((u) => u.code);

  const navigate = useNavigate();
  const { id: editingId } = useParams();
  const editing = Boolean(editingId);
  const [searchParams] = useSearchParams();

  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [partyId, setPartyId] = useState(searchParams.get("party") || "");
  const [addingParty, setAddingParty] = useState(false);
  const [saleDate, setSaleDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState([blankLine()]);
  // Challans this customer has waiting. Ticking one loads its items in, and
  // the ids ride along so the server closes them with the sale.
  const [challanIds, setChallanIds] = useState([]);
  const [discount, setDiscount] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");

  /**
   * Which book this sale belongs to.
   *
   * It decides which run of invoice numbers a bill from this sale draws on,
   * so a Flipkart sale gets an FK number consecutive with the other Flipkart
   * ones and Flipkart's own report can be matched against it.
   *
   * Picking Flipkart here does NOT fetch anything from Flipkart. It records
   * where the sale came from, and the hint under the field says so rather
   * than letting somebody expect an integration that does not exist.
   */
  const [channel, setChannel] = useState("counter");

  /**
   * The lorry, if there is one.
   *
   * Recorded on the SALE rather than only on the bill, because a bill may be
   * raised days later or never, and the vehicle number is only known at the
   * moment the goods go out. saleInvoiceService carries it onto the invoice
   * when one is raised, so it is typed once.
   */
  const [transport, setTransport] = useState(blankTransport());
  const [showTransport, setShowTransport] = useState(false);
  const setTransportField = (name, value) =>
    setTransport((prev) => ({ ...prev, [name]: value }));
  const [sale, setSale] = useState(null);
  // The wholesaler's own default GST rate, used for any line the rate list
  // has no rate for. Falls back to 18 only until the settings arrive.
  const [defaultGst, setDefaultGst] = useState(18);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/api/parties");
        if (alive) setParties(data || []);
      } catch (error) {
        console.error("Failed to load customers", error);
        if (alive) toast.error("Could not load your customer list.");
      }

      // The product list only fills in suggestions. A wholesaler who has not
      // built one yet must still be able to record a sale by typing, so a
      // failure here is not worth telling them about.
      //
      // This reads the one product list, the same rows the Products screen
      // shows. It used to read the separate rate list, which meant a product
      // added in the shop could not be picked on a bill.
      try {
        const { data } = await api.get("/api/dashboard/inventory");
        if (alive) {
          setItems(
            (data || [])
              // A product they have stopped selling is noise in a picker.
              .filter((row) => row.status === "Active")
              // The listing calls it price. Everything downstream of the
              // picker calls it rate, and they are the same number.
              .map((row) => ({ ...row, rate: row.price })),
          );
        }
      } catch (error) {
        console.error("Failed to load the products", error);
      }

      // Their own default GST rate, for any line the product list has no rate
      // for. The server resolves it the same way and is the authority; this
      // is only so the total on screen is the total that gets saved.
      try {
        const { data } = await api.get("/api/invoices/settings");
        const rate = Number(data?.settings?.defaultTaxRate);
        if (alive && Number.isFinite(rate)) setDefaultGst(rate);
      } catch (error) {
        console.error("Failed to load the tax settings", error);
      }

      if (editingId) {
        try {
          const { data } = await api.get(`/api/sales/${editingId}`);
          if (alive) {
            setSale(data.sale);
            setPartyId(data.sale.party_id);
            setSaleDate(String(data.sale.sale_date).slice(0, 10));
            setNotes(data.sale.notes || "");
            setChannel(data.sale.channel || "counter");
            const saved = transportFromRow(data.sale);
            setTransport(saved);
            // Opened only when there is something to see. A sale that went
            // out in the customer's own auto should not reopen on eight
            // empty boxes.
            setShowTransport(hasTransport(saved));
            setDiscount(
              Number(data.sale.discount) > 0
                ? String(Number(data.sale.discount))
                : "",
            );
            setLines(
              data.lines.map((line) => ({
                key: crypto.randomUUID(),
                itemName: line.item_name,
                quantity: String(Number(line.quantity)),
                unit: line.unit || "pcs",
                rate: String(Number(line.rate)),
                moq: null,
                hsnCode: line.hsn_code || null,
                gstPercent:
                  line.gst_percent === null || line.gst_percent === undefined
                    ? null
                    : Number(line.gst_percent),
              })),
            );
          }
        } catch (error) {
          if (alive) {
            toast.error(
              error.response?.status === 404
                ? "That sale is not in your book."
                : "Could not load this sale.",
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

  // Picking from the rate list fills several fields at once.
  const fillFromItem = (key, item) =>
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              itemName: item.name,
              productId: item.id,
              rate: String(Number(item.rate)),
              unit: unitCodes.includes(item.unit) ? item.unit : line.unit,
              moq: item.moq === null ? null : Number(item.moq),
              hsnCode: item.hsn_code || null,
              gstPercent:
                item.gst_percent === null || item.gst_percent === undefined
                  ? null
                  : Number(item.gst_percent),
            }
          : line,
      ),
    );

  const removeLine = (key) =>
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((line) => line.key !== key),
    );

  // Mirrors the server. The rate a wholesaler quotes is before GST, so the
  // tax goes on top and the customer owes the total below, not the subtotal.
  // A discount comes off before the tax is worked out, and is spread across
  // the lines in proportion because they can be taxed differently.
  const totals = useMemo(() => {
    const priced = lines
      .map((line) => {
        const qty = Number(line.quantity);
        const rate = Number(line.rate);
        if (!Number.isFinite(qty) || !Number.isFinite(rate)) return null;
        return {
          amountPaise: Math.round(toPaise(rate) * qty),
          gst: line.gstPercent ?? defaultGst,
        };
      })
      .filter(Boolean);

    const subtotalPaise = priced.reduce((sum, line) => sum + line.amountPaise, 0);
    const discountPaise = Math.min(
      Math.max(0, toPaise(discount)),
      subtotalPaise,
    );
    const taxedShare =
      subtotalPaise > 0 ? 1 - discountPaise / subtotalPaise : 1;

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
  }, [lines, discount, defaultGst]);

  /**
   * What this customer owed BEFORE this sale, off the list already fetched
   * for the dropdown. Zero while editing, because an existing sale's own
   * total is already inside that figure and showing it would double count
   * the very bill being edited.
   */
  const owedBefore = editing
    ? 0
    : Math.max(
        0,
        Number(parties.find((p) => p.id === partyId)?.outstanding || 0),
      );

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
   * A challan ticked or unticked on the panel above.
   *
   * Ticking appends its items, tagged with the challan they came from.
   * Unticking removes exactly those, so a mis-tick is one click to undo
   * rather than hunting for the rows it added. Anything typed by hand has no
   * tag and is never touched.
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
            hsnCode: l.hsnCode || null,
            gstPercent: l.gstPercent ?? null,
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
    group: "Entering a sale",
    allowInInput: true,
  });

  useHotkey(
    "mod+s",
    () => {
      // Submitted through the form so every check and every toast is the same
      // as pressing the button. A second save path is how the two drift.
      document.getElementById("record-sale")?.requestSubmit();
    },
    {
      label: "Save this sale",
      group: "Entering a sale",
      allowInInput: true,
    },
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!partyId) {
      toast.error("Choose a customer.");
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
      saleDate,
      discount: discount || 0,
      notes,
      channel,
      ...transport,
      lines: filled.map((line) => ({
        itemName: line.itemName,
        quantity: line.quantity,
        unit: line.unit,
        rate: line.rate || 0,
        hsnCode: line.hsnCode || undefined,
        gstPercent: line.gstPercent ?? undefined,
        // Which listing this is, and which challan the goods already left on.
        // The second one is why the stock ledger does not take the same cloth
        // out twice: the challan moved it, so this line must not.
        productId: line.productId || undefined,
        fromChallan: line.fromChallan || undefined,
      })),
    };

    setSaving(true);
    try {
      const { data } = editing
        ? await api.put(`/api/sales/${editingId}`, payload)
        : await api.post("/api/sales", {
            ...payload,
            partyId,
            amountPaid: amountPaid || 0,
            paymentMethod,
            challanIds,
          });
      toast.success(
        editing ? `${data.sale_number} saved.` : `${data.sale_number} recorded.`,
      );
      // The sale is saved either way. A customer past his limit is something
      // the wholesaler wants to know, not something that should have stopped
      // him writing down goods that have already gone.
      if (data.creditWarning?.message) {
        toast.warning(data.creditWarning.message, { duration: 8000 });
      }
      navigate(`/seller/sales/${data.id}`, { replace: true });
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          (editing ? "Could not save this sale." : "Could not record this sale."),
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

  if (parties.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">Add a customer first</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          A sale is always to somebody. Add the shop you sold to, then come
          back here.
        </p>
        <button
          onClick={() => navigate("/seller/customers")}
          className="mt-5 rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          Go to my customers
        </button>
      </div>
    );
  }

  return (
    <form id="record-sale" onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-6 pb-28">
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
          {editing ? `Edit ${sale?.sale_number || "sale"}` : "Record a sale"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {editing
            ? "Fix what was written down. The customer's balance moves with it."
            : "Write down what you sold and to whom. It goes straight onto that customer's account."}
        </p>
      </div>

      {/* Who and when */}
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <div>
          <label
            htmlFor="sale-party"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Customer <span className="text-clay">*</span>
          </label>
          {editing ? (
            <>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-600">
                {sale?.party_name}
                {sale?.party_business_name ? ` (${sale.party_business_name})` : ""}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                A sale cannot move to another customer. If this is the wrong
                one, cancel it and record it again.
              </p>
            </>
          ) : (
            /* The list, and a way out of it. Same as the purchase form, which
               has had this since a bill from a new mill meant abandoning what
               was typed, walking to Suppliers, and starting again. A sale to a
               customer who is not in the book yet is the identical problem. */
            <div className="flex gap-2">
              <select
                id="sale-party"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              >
                <option value="">Choose a customer</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                    {party.business_name ? ` (${party.business_name})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAddingParty(true)}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-espresso transition-colors hover:border-clay hover:text-clay"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="sale-date"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Date
          </label>
          <input
            id="sale-date"
            type="date"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
        </div>

        <div>
          <label
            htmlFor="sale-channel"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Where the sale came from
          </label>
          <select
            id="sale-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          >
            {channelChoices(salesChannels, channel).map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            {salesChannels.find((c) => c.code === channel)?.hint
              || "Each one keeps its own run of bill numbers."}
          </p>
        </div>
      </div>

      {/* Anything already sent to this customer and not yet billed. Above the
          items, because ticking one fills them in. Nothing shows when there is
          nothing waiting, which is the usual case. */}
      {!editing && (
        <PendingChallans
          kind="sale"
          otherId={partyId}
          selected={challanIds}
          onChange={pullChallan}
          autoSelect={searchParams.get("challan") || ""}
        />
      )}

      {/* The lines. Dense on purpose: this is a bill book, not a shopping cart. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Items
          </h3>
        </div>

        <div className="divide-y divide-slate-100">
          {lines.map((line, index) => {
            const amount = fromPaise(
              Math.round(toPaise(line.rate) * Number(line.quantity || 0)),
            );
            // A note, not a rule. Nothing enforces a minimum, and a wholesaler
            // undercutting their own is their business, but they should see it.
            const belowMoq =
              line.moq > 0 &&
              Number(line.quantity) > 0 &&
              Number(line.quantity) < line.moq;
            return (
              <div key={line.key} className="p-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <span className="mt-2.5 w-4 shrink-0 text-xs font-bold text-slate-300">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-2">
                    <ItemPicker
                      value={line.itemName}
                      items={items}
                      placeholder="Item name"
                      // Typed over, so the id no longer describes the line.
                      onChange={(name) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key
                              ? { ...l, itemName: name, productId: null }
                              : l,
                          ),
                        )
                      }
                      onPick={(item) => fillFromItem(line.key, item)}
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
                        onChange={(e) =>
                          setLine(line.key, "unit", e.target.value)
                        }
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
                        onChange={(e) =>
                          setLine(line.key, "rate", e.target.value)
                        }
                        inputMode="decimal"
                        placeholder="Rate"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-clay"
                      />
                    </div>

                    {belowMoq && (
                      <p className="text-xs font-semibold text-amber-600">
                        You usually do not sell less than {line.moq}{" "}
                        {line.unit} of this.
                      </p>
                    )}

                    {/* On a phone the amount sits under the inputs. Keeping it
                        in its own column squeezed qty, unit and rate down to
                        about thirty pixels each, which was unusable. */}
                    <p className="text-right text-sm font-black text-espresso sm:hidden">
                      {amount > 0 ? `₹${money(amount)}` : ""}
                    </p>
                  </div>

                  <div className="hidden w-24 shrink-0 pt-2 text-right sm:block">
                    <p className="text-sm font-black text-espresso">
                      {amount > 0 ? `₹${money(amount)}` : "-"}
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
            Bill
          </h3>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Items total</span>
            <span className="font-bold text-espresso">
              ₹{money(totals.subtotal)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="sale-discount"
              className="text-sm text-slate-500"
            >
              Less discount
            </label>
            <input
              id="sale-discount"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-28 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm outline-none transition-colors focus:border-clay"
            />
          </div>

          {/* Shown separately because the rate they typed is before tax, and
              the total underneath is what the customer actually pays. Seeing
              only the two ends of that sum is how a wholesaler quotes one
              number and bills another. */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">GST</span>
            <span className="font-bold text-espresso">
              ₹{money(totals.tax)}
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm font-bold text-espresso">Bill total</span>
            <span className="text-xl font-black text-espresso">
              ₹{money(totals.total)}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Your rates are before GST, so the tax is added on top. This is what
            the customer owes.
          </p>
        </div>

        {editing ? (
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Money received
            </h3>
            <p className="text-xs text-slate-500">
              Payments are not changed here. Record or correct them from the
              customer's page, so the money and the bill stay separate.
            </p>
          </div>
        ) : (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Money received now
          </h3>
          <p className="text-xs text-slate-500">
            Leave this empty if they will pay later. Whatever is left shows up
            on their account.
          </p>

          {/* WHAT HE ALREADY OWED, BEFORE THIS BILL.
              "Paid the whole bill" below settles THIS bill and nothing else,
              which is correct and was invisible: a wholesaler ticking it on a
              customer carrying 40,000 from last week reasonably read it as
              "he is square now". Marg and Busy both show the party balance on
              the entry screen for exactly this reason.

              Read off the customer list already loaded for the dropdown, so
              it costs no extra request, and stated as at before this sale
              because this sale is not saved yet. */}
          {owedBefore > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-bold text-amber-900">
                {parties.find((p) => p.id === partyId)?.name || "This customer"}{" "}
                already owes ₹{money(owedBefore)}
              </p>
              <p className="mt-0.5 text-[11px] text-amber-800">
                From earlier bills. The tick below settles this bill only, so
                after it they would still owe ₹{money(owedBefore)}.
              </p>
            </div>
          )}

          <PaidInFull
            id="sale-paid-in-full"
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
              aria-label="Amount received"
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
              They will still owe
            </span>
            <span
              className={`text-xl font-black ${
                dueAfter > 0 ? "text-amber-600" : "text-emerald-600"
              }`}
            >
              ₹{money(dueAfter)}
            </span>
          </div>
        </div>
        )}
      </div>

      <TransportCard
        value={transport}
        onChange={setTransportField}
        open={showTransport}
        onToggle={() => setShowTransport((o) => !o)}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label
          htmlFor="sale-notes"
          className="mb-1.5 block text-sm font-bold text-espresso"
        >
          Note
        </label>
        <textarea
          id="sale-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything you want to remember about this sale"
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
        />
      </div>

      {/* Sticky, because the total is what they check before saving */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Bill total
            </p>
            <p className="text-lg font-black text-espresso">
              ₹{money(totals.total)}
            </p>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-clay px-6 py-3 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            {saving ? "Saving..." : editing ? "Save changes" : "Save sale"}
          </button>
        </div>
      </div>

      {/* Adding the customer without losing the sale being typed. The list is
          reloaded from the server rather than patched locally, so the new row
          is exactly what every other row is. */}
      {addingParty && (
        <PartyFormModal
          onClose={() => setAddingParty(false)}
          onSaved={async (created) => {
            setAddingParty(false);
            try {
              const { data } = await api.get("/api/parties");
              setParties(Array.isArray(data) ? data : []);
            } catch {
              // The customer was created either way. A stale list is better
              // than losing the sale being typed.
            }
            if (created?.id) setPartyId(created.id);
          }}
        />
      )}
    </form>
  );
};

export default RecordSale;
