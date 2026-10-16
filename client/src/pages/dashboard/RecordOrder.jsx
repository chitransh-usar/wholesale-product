import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import ItemPicker from "../../components/ItemPicker";
import PartyFormModal from "../../components/PartyFormModal";
import { useMasters } from "../../hooks/useMasters";
import { channelChoices } from "../../utils/salesChannels";
import { amount as money } from "../../utils/money";

/**
 * An order taken on the phone or at the counter, typed by the wholesaler.
 *
 * AN ORDER IS A PROMISE and this screen says so. Nothing has moved and nobody
 * owes anything yet: no sale is written, no stock moves, no balance changes.
 * All three start when the goods go and the bill is raised. That is why there
 * is no money box on this form, which is the one thing that makes it look
 * unfinished beside the sale form and is the whole point of the difference.
 *
 * No GST either. What the customer will be charged is decided when the bill
 * is raised, and a tax figure printed on a promise is a figure somebody will
 * quote back later.
 */

const blankLine = () => ({
  key: crypto.randomUUID(),
  itemName: "",
  quantity: "",
  unit: "pcs",
  rate: "",
  productId: null,
});

const RecordOrder = () => {
  const navigate = useNavigate();
  const { units, salesChannels } = useMasters();
  const unitCodes = units.map((u) => u.code);

  const [parties, setParties] = useState([]);
  const [products, setProducts] = useState([]);
  const [partyId, setPartyId] = useState("");
  // Which book the bill for this order will go into. A phone order is the
  // counter, which is what every typed order was before this box existed.
  const [channel, setChannel] = useState("counter");
  const [addingParty, setAddingParty] = useState(false);
  const [expectedOn, setExpectedOn] = useState("");
  const [notes, setNotes] = useState("");
  // The particulars a shop order carries. Without them the order detail
  // screen showed blanks where the address and the phone belong, and the
  // challan raised from it had nowhere to print a delivery address.
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [theirReference, setTheirReference] = useState("");
  const [lines, setLines] = useState([blankLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/parties")
      .then(({ data }) => alive && setParties(data || []))
      .catch(() => alive && toast.error("Could not load your customer list."));
    api
      .get("/api/dashboard/inventory")
      .then(({ data }) => {
        if (!alive) return;
        setProducts(
          (data || [])
            .filter((row) => row.status === "Active")
            .map((row) => ({ ...row, rate: row.price })),
        );
      })
      // Silent: the box still takes a typed name, so a failed lookup costs a
      // shortcut rather than the screen.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const setLine = (key, field, value) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)),
    );

  const fillFromProduct = (key, product) =>
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              itemName: product.name,
              productId: product.id,
              rate: String(Number(product.rate)),
              unit: unitCodes.includes(product.unit) ? product.unit : l.unit,
            }
          : l,
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

  /**
   * Picking the customer fills the address and phone from their own record.
   *
   * Typed over freely: goods often go to a different shop, a godown or a
   * transporter, which is exactly why the boxes exist rather than the order
   * just pointing at the customer row.
   */
  const chooseParty = (id) => {
    setPartyId(id);
    const p = parties.find((x) => x.id === id);
    if (!p) return;
    if (!deliveryAddress) setDeliveryAddress(p.address || p.city || "");
    if (!contactPhone) setContactPhone(p.phone || "");
  };

  const owedBefore = Math.max(
    0,
    Number(parties.find((p) => p.id === partyId)?.outstanding || 0),
  );

  const save = async (e) => {
    e.preventDefault();
    if (!partyId) return toast.error("Choose the customer.");
    const filled = lines.filter((l) => l.itemName.trim());
    if (filled.length === 0) return toast.error("Add at least one item.");

    setSaving(true);
    try {
      const { data } = await api.post("/api/orders/manual", {
        partyId,
        channel,
        notes,
        expectedOn: expectedOn || undefined,
        deliveryAddress: deliveryAddress || undefined,
        contactPhone: contactPhone || undefined,
        theirReference: theirReference || undefined,
        lines: filled.map((l) => ({
          itemName: l.itemName,
          quantity: Number(l.quantity) || 0,
          unit: l.unit,
          rate: Number(l.rate) || 0,
          productId: l.productId || undefined,
        })),
      });
      toast.success(`${data.order_number} taken.`);
      navigate("/seller/orders");
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not save that order.");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-clay";

  return (
    <form onSubmit={save} className="mx-auto max-w-4xl space-y-6 pb-28">
      <div>
        <button
          type="button"
          onClick={() => navigate("/seller/orders")}
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-clay"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <h2 className="text-2xl font-black text-espresso">Take an order</h2>
        <p className="mt-1 text-sm text-slate-500">
          An order taken on the phone or at the counter. Nothing is billed and
          no stock moves until you send the goods.
        </p>
      </div>

      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <div>
          <label
            htmlFor="order-party"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Customer <span className="text-clay">*</span>
          </label>
          <div className="flex gap-2">
            <select
              id="order-party"
              value={partyId}
              onChange={(e) => chooseParty(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
            >
              <option value="">Choose a customer</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.business_name ? ` (${p.business_name})` : ""}
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
          {owedBefore > 0 && (
            <p className="mt-1.5 text-xs font-bold text-amber-700">
              Already owes ₹{money(owedBefore)} on earlier bills.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="order-expected"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Wanted by
          </label>
          <input
            id="order-expected"
            type="date"
            value={expectedOn}
            onChange={(e) => setExpectedOn(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
          <p className="mt-1 text-xs text-slate-500">
            Optional. When the customer wants them.
          </p>
        </div>

        <div>
          <label
            htmlFor="order-channel"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Where the order came from
          </label>
          <select
            id="order-channel"
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
          <p className="mt-1 text-xs text-slate-500">
            Decides which run of bill numbers its bill takes. The order number
            is the same run for every order.
          </p>
        </div>
      </div>

      {addingParty && (
        <PartyFormModal
          onClose={() => setAddingParty(false)}
          onSaved={async (created) => {
            setAddingParty(false);
            try {
              const { data } = await api.get("/api/parties");
              setParties(Array.isArray(data) ? data : []);
            } catch {
              // The customer was created either way.
            }
            if (created?.id) setPartyId(created.id);
          }}
        />
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            What they asked for
          </h3>
          <button
            type="button"
            onClick={() => setLines((p) => [...p, blankLine()])}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-espresso transition-colors hover:border-clay hover:text-clay"
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {lines.map((line, i) => (
            <div key={line.key} className="grid grid-cols-2 gap-3 sm:grid-cols-12">
              <div className="col-span-2 sm:col-span-5">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Item
                </label>
                <ItemPicker
                  value={line.itemName}
                  items={products}
                  placeholder="Cotton shirting"
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
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Qty
                </label>
                <input
                  value={line.quantity}
                  onChange={(e) => setLine(line.key, "quantity", e.target.value)}
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
                  onChange={(e) => setLine(line.key, "unit", e.target.value)}
                  className={`${field} bg-white`}
                >
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Rate
                </label>
                <input
                  value={line.rate}
                  onChange={(e) => setLine(line.key, "rate", e.target.value)}
                  inputMode="decimal"
                  className={field}
                />
              </div>
              <div className="flex items-end justify-end sm:col-span-1">
                <button
                  type="button"
                  onClick={() =>
                    setLines((prev) =>
                      prev.length === 1
                        ? prev
                        : prev.filter((l) => l.key !== line.key),
                    )
                  }
                  aria-label={`Remove line ${i + 1}`}
                  className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* No tax on this figure, on purpose. What they will be charged is
            settled when the bill is raised, and a tax total printed on a
            promise is a number somebody will quote back later. */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Order value
          </span>
          <div className="text-right">
            <p className="text-lg font-black text-espresso">₹{money(total)}</p>
            <p className="text-[11px] text-slate-500">
              Before GST. The bill decides the tax.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label
            htmlFor="order-address"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Where the goods go
          </label>
          <input
            id="order-address"
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
            placeholder="Shop, godown or transporter"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
          <p className="mt-1 text-xs text-slate-500">
            Filled from the customer. Change it if these are going somewhere
            else.
          </p>
        </div>
        <div>
          <label
            htmlFor="order-phone"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Who to ring
          </label>
          <input
            id="order-phone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            inputMode="tel"
            placeholder="98765 43210"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
        </div>
        <div>
          <label
            htmlFor="order-ref"
            className="mb-1.5 block text-sm font-bold text-espresso"
          >
            Their order number
          </label>
          <input
            id="order-ref"
            value={theirReference}
            onChange={(e) => setTheirReference(e.target.value)}
            placeholder="As they gave it"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
          />
          <p className="mt-1 text-xs text-slate-500">
            Optional. What the customer calls this order on their side.
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="order-notes"
          className="mb-1.5 block text-sm font-bold text-espresso"
        >
          Note
        </label>
        <textarea
          id="order-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything you want to remember about this order"
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Order value
            </p>
            <p className="text-lg font-black text-espresso">₹{money(total)}</p>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-clay px-6 py-3 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            {saving ? "Saving..." : "Take the order"}
          </button>
        </div>
      </div>
    </form>
  );
};

export default RecordOrder;
