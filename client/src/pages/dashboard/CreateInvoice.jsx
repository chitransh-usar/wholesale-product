import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Trash2, ArrowLeft, Save, Users, Calculator, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import axios from "../../utils/axios";
import { rupees } from "../../utils/money";
import { useMasters } from "../../hooks/useMasters";
import { channelChoices } from "../../utils/salesChannels";
import {
  Field,
  StateField,
  TransportGrid,
} from "../../components/TransportFields";
import { blankTransport } from "../../utils/transport";

// Document precision, the same as the bill this form is about to produce.
// These totals used to be hard coded to two decimals with no grouping, so a
// wholesaler read 1500.00 here and 1,500 everywhere else.
const inr = (value) => rupees(value, { document: true });

export default function CreateInvoice() {
  const navigate = useNavigate();
  const [buyerId, setBuyerId] = useState("");
  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [defaultTaxRate, setDefaultTaxRate] = useState(18);
  const [discount, setDiscount] = useState("0");
  const [shippingCharge, setShippingCharge] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [termsConditions, setTermsConditions] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Which run of numbers this bill draws on. A typed bill is usually a counter
  // sale, which keeps the prefix from your invoice settings.
  const [channel, setChannel] = useState("counter");
  const { units, states, salesChannels } = useMasters();

  /**
   * Dispatch, delivery and transport.
   *
   * One piece of state rather than eighteen, because they are filled in
   * together or not at all, and eighteen setters is eighteen chances to wire
   * one to the wrong field.
   *
   * Collapsed by default. Most bills go from the registered address to the
   * registered address with no lorry to record, and opening the form on
   * eighteen empty boxes makes the common case look like work.
   */
  const [showDespatch, setShowDespatch] = useState(false);
  const [despatch, setDespatch] = useState({
    dispatchFromName: "",
    dispatchFromAddress: "",
    dispatchFromCity: "",
    dispatchFromState: "",
    dispatchFromPincode: "",
    shipToName: "",
    shipToGstin: "",
    shipToAddress: "",
    shipToCity: "",
    shipToState: "",
    shipToPincode: "",
    // The eight transport fields, from the shared definition, so this screen
    // and the sale screen cannot drift apart on what they send.
    ...blankTransport(),
  });
  const setField = (name, value) =>
    setDespatch((prev) => ({ ...prev, [name]: value }));

  const [items, setItems] = useState([
    {
      productName: "",
      hsnCode: "",
      quantity: 1,
      unitPrice: 0,
      gstPercent: 18,
    },
  ]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // Your saved defaults fill the form, so a manual invoice matches the
        // ones raised automatically from orders.
        const [buyersRes, settingsRes] = await Promise.all([
          axios.get("/api/invoices/buyers"),
          axios.get("/api/invoices/settings"),
        ]);

        if (cancelled) return;

        if (buyersRes.data.success) {
          const list = buyersRes.data.buyers || [];
          setBuyers(list);
          if (list.length > 0) setBuyerId(list[0].id);
        }

        if (settingsRes.data.success) {
          const s = settingsRes.data.settings;
          setDefaultTaxRate(s.defaultTaxRate);
          setNotes(s.defaultNotes || "");
          setTermsConditions(s.defaultTerms || "");
          setItems((prev) =>
            prev.map((item) => ({ ...item, gstPercent: s.defaultTaxRate })),
          );
        }
      } catch (err) {
        console.error("Failed to prepare the invoice form:", err);
        if (!cancelled) toast.error("Could not load your customers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        productName: "",
        hsnCode: "",
        quantity: 1,
        unitPrice: 0,
        gstPercent: defaultTaxRate,
      },
    ]);
  };

  const handleRemoveItem = (index) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Compute live calculations
  const calculateTotals = () => {
    let subtotal = 0;
    let totalTax = 0;

    items.forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const gst = Number(item.gstPercent) || 0;

      const lineTaxable = qty * price;
      const lineTax = (lineTaxable * gst) / 100;

      subtotal += lineTaxable;
      totalTax += lineTax;
    });

    const disc = Number(discount) || 0;
    const ship = Number(shippingCharge) || 0;

    const taxableAmount = Math.max(0, subtotal - disc + ship);
    const grandTotal = Math.round((taxableAmount + totalTax) * 100) / 100;

    return { subtotal, totalTax, taxableAmount, grandTotal };
  };

  const { subtotal, totalTax, taxableAmount, grandTotal } = calculateTotals();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!buyerId) {
      toast.error("Pick the customer this invoice is for");
      return;
    }

    if (items.some((item) => !item.productName || Number(item.quantity) <= 0)) {
      toast.error("Every line needs a name and a quantity above zero");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await axios.post("/api/invoices", {
        buyerId: buyerId,
        items: items.map((i) => ({
          productName: i.productName,
          hsnCode: i.hsnCode,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          gstPercent: Number(i.gstPercent),
          // The GST code the chosen unit is filed under, looked up from the
          // units master. Absent when the unit has no UQC decided yet, because
          // a made up code is a wrong declaration on an e-invoice.
          uqc: units.find((u) => u.code === i.unit)?.uqc || null,
        })),
        discount: Number(discount),
        shippingCharge: Number(shippingCharge),
        dueDate: dueDate || null,
        notes,
        termsConditions,
        channel,
        ...despatch,
      });

      if (res.data.success) {
        toast.success("Invoice created");
        navigate(`/seller/invoices/${res.data.invoice.id}`);
      }
    } catch (err) {
      console.error("Create invoice error:", err);
      toast.error(
        err.response?.data?.message || "Failed to create the invoice",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  // Manual invoices go to people you already trade with, so with no customers
  // yet there is nothing sensible to select and no point showing the form.
  if (buyers.length === 0) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
        <Users className="mb-3 h-10 w-10 text-espresso/15" />
        <h2 className="text-lg font-bold text-espresso">No customers yet</h2>
        <p className="mt-1 text-sm text-espresso/60">
          You can raise a manual invoice once someone has ordered from you.
          Orders generate their own invoice automatically.
        </p>
        <Link
          to="/seller/invoices"
          className="mt-5 rounded-xl bg-clay px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-espresso"
        >
          Back to invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/seller/invoices")}
            className="p-2 text-slate-500 hover:text-espresso border border-slate-200 rounded-xl hover:bg-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-espresso">
              New invoice
            </h1>
            <p className="mt-0.5 text-sm text-espresso/60">
              For billing outside a marketplace order. The number and GST are
              worked out for you.
            </p>
          </div>
        </div>
      </div>

      {/* Form Container */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header Metadata Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-xs font-semibold text-espresso/70 mb-1">
              Select Buyer Account *
            </label>
            <select
              value={buyerId}
              onChange={(e) => setBuyerId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-bold text-espresso focus:outline-none focus:ring-2 focus:ring-clay/20"
              required
            >
              <option value="">Select a customer</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.company_name} ({b.email})
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-400">
              People who have ordered from you
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-espresso/70 mb-1">
              Payment Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-espresso focus:ring-2 focus:ring-clay/20 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="invoice-channel"
              className="block text-xs font-semibold text-espresso/70 mb-1"
            >
              Where it came from
            </label>
            <select
              id="invoice-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-bold text-espresso focus:outline-none focus:ring-2 focus:ring-clay/20"
            >
              {channelChoices(salesChannels, channel).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-400">
              Each one keeps its own run of bill numbers
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-espresso/70 mb-1">
              Invoice number
            </label>
            <p className="rounded-xl border border-slate-200 bg-slate-100/50 px-3.5 py-2 font-mono text-sm text-slate-500">
              Assigned on save
            </p>
            <Link
              to="/seller/invoices/settings"
              className="text-[11px] font-semibold text-clay hover:underline"
            >
              Change the prefix and defaults
            </Link>
          </div>
        </div>

        {/* Dynamic Line Items Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-espresso">
              Line Items Breakdown
            </h3>
            <button
              type="button"
              onClick={handleAddItem}
              className="px-3 py-1.5 bg-clay/10 text-clay hover:bg-clay/20 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Row
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-3 items-center p-3 bg-slate-50 rounded-xl border border-slate-200"
              >
                <div className="col-span-12 sm:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                    Product Description *
                  </label>
                  <input
                    type="text"
                    placeholder="Item name / spec..."
                    value={item.productName}
                    onChange={(e) =>
                      handleItemChange(idx, "productName", e.target.value)
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-espresso"
                    required
                  />
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                    HSN Code
                  </label>
                  <input
                    type="text"
                    value={item.hsnCode}
                    onChange={(e) =>
                      handleItemChange(idx, "hsnCode", e.target.value)
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-center text-espresso"
                  />
                </div>

                <div className="col-span-4 sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                    Qty *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      handleItemChange(idx, "quantity", e.target.value)
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-center text-espresso"
                    required
                  />
                </div>

                {/*
                  The unit, which is also how the line gets its UQC.

                  The wholesaler picks the word they use, Metre or Bundle, and
                  the GST code it is filed under comes from the units master.
                  Nobody should be asked to know that Bundle is BDL. A unit with
                  no UQC decided yet is still offered and still perfectly
                  usable; the line simply goes out without one, which is the
                  honest state of it.
                */}
                <div className="col-span-4 sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                    Unit
                  </label>
                  <select
                    value={item.unit || ""}
                    onChange={(e) => handleItemChange(idx, "unit", e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-espresso"
                  >
                    <option value="">--</option>
                    {units.map((u) => (
                      <option key={u.code} value={u.code}>
                        {u.name}
                        {u.uqc ? ` (${u.uqc})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                    Unit Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) =>
                      handleItemChange(idx, "unitPrice", e.target.value)
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-right text-espresso"
                    required
                  />
                </div>

                <div className="col-span-10 sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                    GST %
                  </label>
                  <select
                    value={item.gstPercent}
                    onChange={(e) =>
                      handleItemChange(idx, "gstPercent", e.target.value)
                    }
                    className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-center text-espresso"
                  >
                    <option value="0">0%</option>
                    <option value="5">5%</option>
                    <option value="12">12%</option>
                    <option value="18">18%</option>
                    <option value="28">28%</option>
                  </select>
                </div>

                <div className="col-span-2 sm:col-span-1 text-center pt-3">
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(idx)}
                    disabled={items.length <= 1}
                    className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/*
          Dispatch, delivery and transport.

          Everything here is optional and everything here is frozen onto the
          bill once it is raised. Left empty, the registered addresses already
          on the invoice are the answer and none of this prints, which is why
          the section starts closed rather than showing eighteen empty boxes.
        */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs">
          <button
            type="button"
            onClick={() => setShowDespatch((open) => !open)}
            aria-expanded={showDespatch}
            className="flex w-full items-center justify-between gap-3 p-6 text-left"
          >
            <span>
              <span className="block text-sm font-bold text-espresso">
                Dispatch, delivery and transport
              </span>
              <span className="mt-0.5 block text-xs text-espresso/60">
                Only if the goods leave from somewhere other than your
                registered address, go somewhere other than the billing address,
                or travel with a transporter. These are the e-way bill details.
              </span>
            </span>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
                showDespatch ? "rotate-180" : ""
              }`}
            />
          </button>

          {showDespatch && (
            <div className="space-y-6 border-t border-slate-100 p-6 pt-5">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <fieldset className="space-y-3">
                  <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Dispatched from
                  </legend>
                  <Field label="Name of the place" name="dispatchFromName" value={despatch} onChange={setField} placeholder="Bhiwandi godown" />
                  <Field label="Address" name="dispatchFromAddress" value={despatch} onChange={setField} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="City" name="dispatchFromCity" value={despatch} onChange={setField} />
                    <Field label="Pincode" name="dispatchFromPincode" value={despatch} onChange={setField} />
                  </div>
                  <StateField label="State" name="dispatchFromState" value={despatch} onChange={setField} states={states} />
                </fieldset>

                <fieldset className="space-y-3">
                  <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Shipped to
                  </legend>
                  <Field label="Name" name="shipToName" value={despatch} onChange={setField} placeholder="Unit 2, or the buyer's godown" />
                  <Field label="GSTIN" name="shipToGstin" value={despatch} onChange={setField} />
                  <Field label="Address" name="shipToAddress" value={despatch} onChange={setField} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="City" name="shipToCity" value={despatch} onChange={setField} />
                    <Field label="Pincode" name="shipToPincode" value={despatch} onChange={setField} />
                  </div>
                  <StateField label="State" name="shipToState" value={despatch} onChange={setField} states={states} />
                </fieldset>
              </div>

              <fieldset className="space-y-3 border-t border-slate-100 pt-5">
                <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Transport
                </legend>
                <TransportGrid value={despatch} onChange={setField} />
              </fieldset>
            </div>
          )}
        </div>

        {/* Financial Totals & Terms Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
            <div>
              <label className="block text-xs font-semibold text-espresso/70 mb-1">
                Invoice Notes
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-espresso"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-espresso/70 mb-1">
                Terms & Conditions
              </label>
              <textarea
                rows={3}
                value={termsConditions}
                onChange={(e) => setTermsConditions(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-espresso"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 text-xs">
            <h4 className="flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-bold text-espresso">
              <Calculator className="w-4 h-4 text-clay" /> Summary
            </h4>

            <div className="flex justify-between text-espresso/60">
              <span>Subtotal:</span>
              <span>{inr(subtotal)}</span>
            </div>

            <div className="flex justify-between items-center gap-4">
              <span className="text-espresso/60">Discount (₹):</span>
              <input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-28 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-right font-semibold"
              />
            </div>

            <div className="flex justify-between items-center gap-4">
              <span className="text-espresso/60">Shipping Charge (₹):</span>
              <input
                type="number"
                value={shippingCharge}
                onChange={(e) => setShippingCharge(e.target.value)}
                className="w-28 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-right font-semibold"
              />
            </div>

            <div className="flex justify-between font-bold text-espresso pt-2 border-t border-slate-100">
              <span>Taxable Amount:</span>
              <span>{inr(taxableAmount)}</span>
            </div>

            <div className="flex justify-between text-espresso/60">
              <span>Total Tax (GST):</span>
              <span>{inr(totalTax)}</span>
            </div>

            <div className="flex justify-between text-base font-black text-white bg-slate-900 p-3 rounded-xl mt-2">
              <span>Grand Total:</span>
              <span>{inr(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={() => navigate("/seller/invoices")}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-espresso/70 rounded-xl text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2.5 bg-clay hover:bg-espresso text-white text-xs font-bold rounded-xl flex items-center gap-2 transition-colors shadow-sm shadow-clay/20 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />{" "}
            {isSubmitting ? "Generating..." : "Generate Invoice"}
          </button>
        </div>
      </form>
    </div>
  );
}
