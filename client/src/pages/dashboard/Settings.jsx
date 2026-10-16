import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LocationPicker from "../../components/LocationPicker";
import {
  Building2,
  ChevronRight,
  CreditCard,
  Database,
  FileText,
  Mail,
  MapPin,
  Phone,
  Save,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import api from "../../utils/axios";
import { FEATURES } from "../../config/features";
import { gstinFeedback, INDIAN_STATES } from "../../utils/gstin";

/**
 * The wholesaler's own details.
 *
 * Rebuilt for 3.0. The marketplace version led with a red "Verification
 * Pending" banner promising that verified accounts get three times the
 * inquiries. Nothing in the codebase ever sets is_verified to true, there is
 * no admin console to do it from, and there are no inquiries in a closed
 * network, so it was a red warning about a review that would never happen
 * attached to a number nobody computes. It is gone.
 *
 * Everything left is a field that reaches a bill. The GSTIN, the phone and
 * the UPI id are printed on the invoice, and the state below decides whether
 * that invoice charges CGST and SGST or IGST.
 */
const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    companyName: "",
    contactPhone: "",
    email: "", // Read-only from users table
    gstin: "",
    upiId: "",
    city: "",
    country: "India",
    warehouseAddress: "",
    warehouseCity: "",
    warehouseState: "",
    warehousePincode: "",
  });
  // The exact yard, for the delivery map. That map belongs to the marketplace
  // order flow, which 3.0 has switched off, so the picker follows the flag.
  const [warehousePin, setWarehousePin] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get("/api/profile");
        const data = res.data;
        if (!alive) return;
        setFormData({
          companyName: data.company_name || "",
          contactPhone: data.contact_phone || "",
          email: data.email || "",
          gstin: data.gstin || "",
          upiId: data.upi_id || "",
          city: data.city || "",
          country: data.country || "India",
          warehouseAddress: data.warehouse_address || "",
          warehouseCity: data.warehouse_city || "",
          warehouseState: data.warehouse_state || "",
          warehousePincode: data.warehouse_pincode || "",
        });
        if (data.lat != null && data.lng != null) {
          setWarehousePin({ lat: Number(data.lat), lng: Number(data.lng) });
        }
      } catch (err) {
        console.error("Failed to load profile", err);
        if (alive) toast.error("Could not load your details.");
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const gst = gstinFeedback(formData.gstin);

  // The first two digits of a GST number ARE the state, and the state is what
  // decides whether a bill charges CGST plus SGST or IGST. If the two disagree
  // one of them is wrong, and getting it wrong is a filing problem rather than
  // a display one. Said as a warning, not a block: a man may genuinely be
  // registered in one state and despatching from a godown in another.
  const declaredState = (formData.warehouseState || formData.city || "").trim();
  const stateMismatch =
    gst.state === "good" &&
    declaredState &&
    gst.stateName.toLowerCase() !== declaredState.toLowerCase();

  const handleSave = async () => {
    if (formData.gstin.trim() && gst.state !== "good") {
      toast.error("Please check your GST number, or clear it.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/api/profile", {
        ...formData,
        warehouseLat: warehousePin?.lat,
        warehouseLng: warehousePin?.lng,
      });
      toast.success("Your details are saved.");
    } catch (err) {
      console.error("Failed to save profile", err);
      // The server says which field it refused and why. Replacing that with
      // "Could not save your details" leaves a person retyping at random.
      toast.error(err.response?.data?.message || "Could not save your details.");
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
    "w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-clay focus:bg-white";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-black text-espresso">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Your business details. These are what appear on every bill you raise.
        </p>
      </div>

      {/* Your business */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
          <Building2 className="h-5 w-5 text-slate-500" />
          <h3 className="font-bold text-espresso">Your business</h3>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="settings-company"
                className="mb-2 block text-xs font-semibold text-slate-600"
              >
                Business name <span className="text-rose-500">*</span>
              </label>
              <input
                id="settings-company"
                type="text"
                name="companyName"
                value={formData.companyName}
                onChange={handleChange}
                placeholder="Ram Textiles"
                className={field}
              />
            </div>
            <div>
              <label
                htmlFor="settings-phone"
                className="mb-2 block text-xs font-semibold text-slate-600"
              >
                Phone <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="settings-phone"
                  type="text"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  placeholder="+91 98765 43210"
                  className={`${field} pl-9`}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="settings-email"
                className="mb-2 block text-xs font-semibold text-slate-600"
              >
                Email you signed up with
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="settings-email"
                  type="email"
                  value={formData.email}
                  disabled
                  className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 py-2.5 pl-9 pr-4 text-sm text-slate-500"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="settings-city"
                className="mb-2 block text-xs font-semibold text-slate-600"
              >
                City
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="settings-city"
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="Surat"
                  className={`${field} pl-9`}
                />
              </div>
            </div>
          </div>

          <div className="max-w-md">
            <label
              htmlFor="settings-gstin"
              className="mb-2 block text-xs font-semibold text-slate-600"
            >
              GST number
            </label>
            <input
              id="settings-gstin"
              type="text"
              name="gstin"
              value={formData.gstin}
              onChange={handleChange}
              placeholder="24AAACC1206D1ZM"
              className={
                gst.state === "bad"
                  ? `${field} border-rose-300 focus:border-rose-400`
                  : field
              }
            />
            <p
              className={`mt-2 text-xs ${
                gst.state === "bad"
                  ? "text-rose-600"
                  : gst.state === "good"
                    ? "text-emerald-700"
                    : "text-slate-500"
              }`}
            >
              {gst.state === "good"
                ? `Looks right. Registered in ${gst.stateName}.`
                : gst.state === "bad" || gst.state === "typing"
                  ? gst.message
                  : "Printed on every bill. Your customers need it to claim their input credit, so a wrong one costs them money."}
            </p>
            {stateMismatch && (
              <p className="mt-1.5 text-xs text-amber-700">
                Your GST number is registered in {gst.stateName}, but you send
                goods from {declaredState}. Bills work out CGST and SGST or
                IGST from this, so please check which one is right.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Place of supply. Quietly the most load bearing block on the page. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
          <Truck className="h-5 w-5 text-slate-500" />
          <div>
            <h3 className="font-bold text-espresso">Where you send goods from</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              The state here decides whether a bill charges CGST and SGST, or
              IGST. Leave it blank and your GST number is read instead, since
              its first two digits are the state.
            </p>
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <label
              htmlFor="settings-godown"
              className="mb-2 block text-xs font-semibold text-slate-600"
            >
              Godown address
            </label>
            <input
              id="settings-godown"
              type="text"
              name="warehouseAddress"
              value={formData.warehouseAddress}
              onChange={handleChange}
              placeholder="Godown or building, street"
              className={field}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="settings-wcity"
                className="mb-2 block text-xs font-semibold text-slate-600"
              >
                City
              </label>
              <input
                id="settings-wcity"
                type="text"
                name="warehouseCity"
                value={formData.warehouseCity}
                onChange={handleChange}
                placeholder="Surat"
                className={field}
              />
            </div>
            <div>
              <label
                htmlFor="settings-wstate"
                className="mb-2 block text-xs font-semibold text-slate-600"
              >
                State
              </label>
              {/* A list, not a box. This one field decides whether every bill
                  charges CGST and SGST or IGST, and a typed "Gujrat" matches
                  no customer's state, so every local sale would go out as
                  inter-state. */}
              <select
                id="settings-wstate"
                name="warehouseState"
                value={formData.warehouseState}
                onChange={handleChange}
                className={`${field} cursor-pointer`}
              >
                <option value="">Not set</option>
                {INDIAN_STATES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="settings-wpin"
                className="mb-2 block text-xs font-semibold text-slate-600"
              >
                Pincode
              </label>
              <input
                id="settings-wpin"
                type="text"
                name="warehousePincode"
                value={formData.warehousePincode}
                onChange={handleChange}
                placeholder="395002"
                className={field}
              />
            </div>
          </div>

          {/* Only means something once a delivery has a map to show it on. */}
          {FEATURES.MARKETPLACE && (
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Pin the exact yard
              </p>
              <LocationPicker value={warehousePin} onChange={setWarehousePin} />
            </div>
          )}
        </div>
      </div>

      {/* Getting paid */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
          <CreditCard className="h-5 w-5 text-slate-500" />
          <h3 className="font-bold text-espresso">Getting paid</h3>
        </div>
        <div className="p-5 sm:p-6">
          <div className="max-w-md">
            <label
              htmlFor="settings-upi"
              className="mb-2 block text-xs font-semibold text-slate-600"
            >
              UPI ID
            </label>
            <input
              id="settings-upi"
              type="text"
              name="upiId"
              value={formData.upiId}
              onChange={handleChange}
              placeholder="ramtextiles@upi"
              className={field}
            />
            <p className="mt-2 text-xs text-slate-500">
              Turned into the QR code on your bills, so a customer can scan and
              pay. Money that comes in still has to be recorded by you on the
              customer's page. Nothing here checks a bank account.
            </p>
          </div>
        </div>
      </div>

      {/* The other half of settings, which lives with the invoices. */}
      <Link
        to="/seller/invoices/settings"
        className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:bg-slate-50"
      >
        <div className="flex min-w-0 items-center gap-3">
          <FileText className="h-5 w-5 shrink-0 text-slate-500" />
          <div className="min-w-0">
            <p className="font-bold text-espresso">Bill numbering and terms</p>
            <p className="mt-0.5 text-xs text-slate-500">
              The prefix on your invoice numbers, how many days you give to pay,
              your usual GST rate, the notes printed at the bottom, and any
              second Amazon or Flipkart account.
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
      </Link>

      {/* Import and export live on their own page in the sidebar. They were
          cards down here once, below the Save button, and were asked for twice
          by somebody looking straight at them. A link is enough. */}
      <Link
        to="/seller/data"
        className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:bg-slate-50"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Database className="h-5 w-5 shrink-0 text-slate-500" />
          <div className="min-w-0">
            <p className="font-bold text-espresso">Your data</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Bring an old book in from a spreadsheet, or take a copy of
              everything in this one.
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
      </Link>

      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-espresso px-8 py-3 text-sm font-bold text-cream shadow-sm transition-colors hover:bg-clay disabled:opacity-70"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

    </div>
  );
};

export default Settings;
