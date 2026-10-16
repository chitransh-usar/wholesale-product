import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BadgeCheck, Clock, TriangleAlert } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { rupees, dateLabel } from "../../utils/money";
import { INDIAN_STATES } from "../../utils/gstin";

/**
 * Getting set up to be paid through the gateway.
 *
 * Until this is done, a buyer paying by card or netbanking would send money
 * to the platform's account rather than to the wholesaler, so the product
 * does not offer them that at all and buyers pay them by UPI instead. That is
 * not a degraded mode: the UPI QR pays them directly and always has. This adds
 * card and netbanking, and takes the confirmation problem away with them.
 *
 * The verification itself is RAZORPAY'S. Nothing on this screen or behind it
 * decides whether a PAN is real or a bank account belongs to anybody. This
 * collects what Razorpay asks for, submits it, and reports back what they
 * say. A marketplace that self-certified its own sellers is how buyers' money
 * goes missing.
 */

const STATUS_VIEW = {
  not_started: {
    tone: "bg-slate-100 text-slate-600",
    label: "Not set up",
    icon: Clock,
  },
  created: {
    tone: "bg-amber-50 text-amber-700",
    label: "Sent to Razorpay",
    icon: Clock,
  },
  under_review: {
    tone: "bg-amber-50 text-amber-700",
    label: "Being checked",
    icon: Clock,
  },
  needs_clarification: {
    tone: "bg-rose-50 text-rose-700",
    label: "They need something",
    icon: TriangleAlert,
  },
  activated: {
    tone: "bg-emerald-50 text-emerald-700",
    label: "Ready",
    icon: BadgeCheck,
  },
  suspended: {
    tone: "bg-rose-50 text-rose-700",
    label: "Stopped",
    icon: TriangleAlert,
  },
};

const BUSINESS_TYPES = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "private_limited", label: "Private limited" },
  { value: "public_limited", label: "Public limited" },
  { value: "llp", label: "LLP" },
  { value: "individual", label: "Individual" },
  { value: "trust", label: "Trust" },
  { value: "society", label: "Society" },
  { value: "not_yet_registered", label: "Not registered yet" },
];

const PaymentSetup = () => {
  const [state, setState] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    legalBusinessName: "",
    businessType: "proprietorship",
    pan: "",
    gstin: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    beneficiaryName: "",
    accountNumber: "",
    ifsc: "",
  });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/seller/razorpay/status");
      setState(data);
      setNotSetUp(false);
      setForm((prev) => ({
        ...prev,
        // Only fills the empty boxes, so a half typed form is not wiped by a
        // background refresh.
        legalBusinessName: prev.legalBusinessName || data.prefill?.companyName || "",
        gstin: prev.gstin || data.prefill?.gstin || "",
        address: prev.address || data.prefill?.address || "",
        city: prev.city || data.prefill?.city || "",
        state: prev.state || data.prefill?.state || "",
        pincode: prev.pincode || data.prefill?.pincode || "",
        phone: prev.phone || data.prefill?.phone || "",
      }));
      if (data.accountId) {
        const list = await api.get("/api/seller/razorpay/transfers");
        setTransfers(Array.isArray(list.data) ? list.data : []);
      }
    } catch (error) {
      if (error.response?.data?.code === "ROUTE_NOT_SET_UP") {
        setNotSetUp(true);
      } else {
        toast.error("Could not read your payment setup.");
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Wrapped rather than called straight, so the state writes happen in the
    // promise and not synchronously inside the effect body.
    void (async () => {
      await load();
    })();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("/api/seller/razorpay/onboard", form);
      toast.success(data.message || "Sent to Razorpay.");
      await load();
    } catch (error) {
      // Razorpay names the field it objected to. Passed through, because
      // "could not set up payments" hides the one sentence that helps.
      toast.error(
        error.response?.data?.message || "Could not set up payments.",
      );
    }
    setSaving(false);
  };

  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

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
        <TriangleAlert className="mx-auto mb-3 h-10 w-10 text-amber-400" />
        <p className="font-semibold text-espresso">
          Card payments are not switched on yet
        </p>
        <p className="mt-1 text-sm text-slate-500">
          This part of the product needs a database change that has not been
          run. Your buyers can still pay you by UPI, exactly as now.
        </p>
      </div>
    );
  }

  const view = STATUS_VIEW[state?.status] || STATUS_VIEW.not_started;
  const StatusIcon = view.icon;
  const done = state?.canBePaid;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          to="/seller/settings"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-clay"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
        <h2 className="text-2xl font-black text-espresso">
          Taking card payments
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          So a buyer can pay you by card, netbanking or UPI through the app,
          and the money comes to your bank account.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${view.tone}`}
        >
          <StatusIcon className="h-3.5 w-3.5" />
          {view.label}
        </span>
        {state?.onboardedAt && (
          <span className="text-xs text-slate-500">
            Ready since {dateLabel(state.onboardedAt)}
          </span>
        )}
        {state?.accountId && (
          <span className="font-mono text-[11px] text-slate-400">
            {state.accountId}
          </span>
        )}
      </div>

      {/* Razorpay's own words when it wants something, shown as given. A
          paraphrase of a compliance requirement is worse than useless. */}
      {state?.note && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-bold text-amber-900">Razorpay says:</p>
          <p className="mt-0.5 text-xs text-amber-800">{state.note}</p>
        </div>
      )}

      {!state?.configured && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold text-espresso">
            Card payments are not configured on this server yet.
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Nothing you fill in here can be sent until they are. Your buyers
            can still pay you by UPI.
          </p>
        </div>
      )}

      {/* Said out loud, because a wholesaler who thinks the app is holding their
          money behaves differently from one who knows it is not. */}
      {!done && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-600">
            Until this is done, buyers pay you by UPI straight to your own
            account, which works today and is not going away. This adds card
            and netbanking, and means the app can tell you for certain when a
            payment has gone through.
          </p>
        </div>
      )}

      <form
        onSubmit={submit}
        className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div>
          <h3 className="text-sm font-bold text-espresso">Your business</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            As it is registered. Razorpay checks these against government
            records, so they have to match exactly.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="rz-legal"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Registered business name <span className="text-clay">*</span>
            </label>
            <input
              id="rz-legal"
              value={form.legalBusinessName}
              onChange={set("legalBusinessName")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
            />
          </div>

          <div>
            <label
              htmlFor="rz-type"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Kind of business <span className="text-clay">*</span>
            </label>
            <select
              id="rz-type"
              value={form.businessType}
              onChange={set("businessType")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
            >
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="rz-pan"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              PAN <span className="text-clay">*</span>
            </label>
            <input
              id="rz-pan"
              value={form.pan}
              onChange={set("pan")}
              placeholder="AAAPZ1234C"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm uppercase outline-none focus:border-clay"
            />
          </div>

          <div>
            <label
              htmlFor="rz-gstin"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              GST number
            </label>
            <input
              id="rz-gstin"
              value={form.gstin}
              onChange={set("gstin")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm uppercase outline-none focus:border-clay"
            />
          </div>

          <div>
            <label
              htmlFor="rz-contact"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Owner&apos;s name <span className="text-clay">*</span>
            </label>
            <input
              id="rz-contact"
              value={form.contactName}
              onChange={set("contactName")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
            />
          </div>

          <div>
            <label
              htmlFor="rz-email"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Email <span className="text-clay">*</span>
            </label>
            <input
              id="rz-email"
              type="email"
              value={form.email}
              onChange={set("email")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
            />
          </div>

          <div>
            <label
              htmlFor="rz-phone"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Phone <span className="text-clay">*</span>
            </label>
            <input
              id="rz-phone"
              value={form.phone}
              onChange={set("phone")}
              inputMode="tel"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-bold text-espresso">
            Registered address
          </h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="rz-address"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Address <span className="text-clay">*</span>
              </label>
              <input
                id="rz-address"
                value={form.address}
                onChange={set("address")}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
              />
            </div>
            <div>
              <label
                htmlFor="rz-city"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                City <span className="text-clay">*</span>
              </label>
              <input
                id="rz-city"
                value={form.city}
                onChange={set("city")}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
              />
            </div>
            <div>
              <label
                htmlFor="rz-state"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                State <span className="text-clay">*</span>
              </label>
              {/* A list, not a box, for the same reason Settings uses one:
                  Razorpay matches this against government records, and a
                  typed "Gujrat" is a rejection two days later with a message
                  nobody reads carefully. */}
              <select
                id="rz-state"
                value={form.state}
                onChange={set("state")}
                className="w-full cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
              >
                <option value="">Choose a state</option>
                {INDIAN_STATES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="rz-pincode"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                PIN code <span className="text-clay">*</span>
              </label>
              <input
                id="rz-pincode"
                value={form.pincode}
                onChange={set("pincode")}
                inputMode="numeric"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-bold text-espresso">
            Where the money should go
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Your own current account. Razorpay settles to it directly; this
            product never holds your money.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="rz-benef"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Account holder name
              </label>
              <input
                id="rz-benef"
                value={form.beneficiaryName}
                onChange={set("beneficiaryName")}
                placeholder="Same as the business name"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
              />
            </div>
            <div>
              <label
                htmlFor="rz-account"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Account number <span className="text-clay">*</span>
              </label>
              <input
                id="rz-account"
                value={form.accountNumber}
                onChange={set("accountNumber")}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay"
              />
            </div>
            <div>
              <label
                htmlFor="rz-ifsc"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                IFSC code <span className="text-clay">*</span>
              </label>
              <input
                id="rz-ifsc"
                value={form.ifsc}
                onChange={set("ifsc")}
                placeholder="HDFC0001234"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm uppercase outline-none focus:border-clay"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || !state?.configured}
          className="w-full rounded-lg bg-clay py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-50 sm:w-auto sm:px-6"
        >
          {saving
            ? "Sending..."
            : state?.accountId
              ? "Send again"
              : "Send to Razorpay"}
        </button>
      </form>

      {transfers.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-bold text-espresso">
              What has been sent to you
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              As Razorpay reported it, not as this product worked it out.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {transfers.map((t) => (
              <li
                key={t.razorpay_transfer_id}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-espresso">
                    {t.order_number || "Order"}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {dateLabel(t.created_at)} · {t.status || "pending"}
                    {t.settlement_status ? ` · ${t.settlement_status}` : ""}
                  </p>
                  {t.failure_reason && (
                    <p className="text-xs text-rose-600">{t.failure_reason}</p>
                  )}
                </div>
                <p className="shrink-0 text-sm font-black text-espresso">
                  {rupees(Number(t.amount_paise || 0) / 100, { document: true })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PaymentSetup;
