import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import axios from "../../utils/axios";
import MarketplaceAccounts from "../../components/MarketplaceAccounts";

export default function InvoiceSettings() {
  const navigate = useNavigate();
  const [prefix, setPrefix] = useState("INV/");
  // The two halves of the number that had columns in the database since
  // 10 Sept and no way to reach them: the save route dropped both.
  const [numberSuffix, setNumberSuffix] = useState("/{FY}");
  const [numberPadTo, setNumberPadTo] = useState("0");
  // What a number in this shape would look like, asked of the server so the
  // sixteen character rule is checked by the same code that will enforce it.
  const [preview, setPreview] = useState(null);
  const [dueDays, setDueDays] = useState("15");
  const [defaultTaxRate, setDefaultTaxRate] = useState("18");
  const [defaultNotes, setDefaultNotes] = useState("");
  const [defaultTerms, setDefaultTerms] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Bumped on save, so the account samples below redraw in the new format.
  const [savedVersion, setSavedVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await axios.get("/api/invoices/settings");
        if (!cancelled && res.data.success) {
          const s = res.data.settings;
          setPrefix(s.prefix);
          setNumberSuffix(s.numberSuffix ?? "");
          setNumberPadTo(String(s.numberPadTo ?? 0));
          setDueDays(String(s.dueDays));
          setDefaultTaxRate(String(s.defaultTaxRate));
          setDefaultNotes(s.defaultNotes || "");
          setDefaultTerms(s.defaultTerms || "");
        }
      } catch (err) {
        console.error("Failed to load invoice settings", err);
        if (!cancelled) toast.error("Could not load your invoice settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The live sample, the thing Busy's numbering dialog has and ours did not.
   *
   * Asked of the server rather than worked out here, so the sixteen character
   * limit and the allowed alphabet are checked by the same function that will
   * enforce them when a number is actually taken. A second copy of that rule
   * living in the client is how the screen ends up promising a number the
   * server then refuses.
   *
   * Debounced, because this fires on every keystroke and nothing is saved by
   * it. It takes no number and touches no counter.
   */
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await axios.get("/api/invoices/number-preview", {
          params: { prefix, suffix: numberSuffix, padTo: Number(numberPadTo) || 0 },
        });
        if (!cancelled && res.data?.success) setPreview(res.data);
      } catch {
        // A failed preview leaves the last good sample on screen. There is
        // nothing for them to do about it and the save will still be checked.
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [prefix, numberSuffix, numberPadTo]);

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await axios.put("/api/invoices/settings", {
        prefix,
        numberSuffix,
        numberPadTo: Number(numberPadTo),
        dueDays: Number(dueDays),
        defaultTaxRate: Number(defaultTaxRate),
        defaultNotes,
        defaultTerms,
      });
      if (res.data.success) {
        toast.success("Invoice settings saved");
        setSavedVersion((v) => v + 1);
      }
    } catch (err) {
      console.error("Failed to save invoice settings", err);
      toast.error(err.response?.data?.message || "Could not save settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
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
              Invoice defaults
            </h1>
            <p className="mt-0.5 text-sm text-espresso/60">
              Applied to every invoice you raise from here on.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-espresso pb-3 border-b border-slate-100">
            Invoice Numbering & Defaults
          </h3>

          {/* The sample, and the refusal when the shape is illegal. Rule 46(b)
              constrains the whole string, so a prefix and a suffix that are
              each fine can still be illegal together: they should find that out
              here rather than at invoice 1000. */}
          {preview && (
            <div
              className={`mb-4 rounded-xl border p-4 ${
                preview.ok
                  ? "border-slate-200 bg-slate-50"
                  : "border-rose-200 bg-rose-50"
              }`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Your next invoice will be numbered
              </p>
              <p
                className={`mt-1 font-mono text-2xl font-black ${
                  preview.ok ? "text-espresso" : "text-rose-700"
                }`}
              >
                {preview.sample}
              </p>
              {preview.ok ? (
                <p className="mt-1 text-xs text-slate-500">
                  Financial year {preview.financialYear}. Room for up to{" "}
                  {preview.roomFor} digits before this shape runs out.
                </p>
              ) : (
                <p className="mt-1 text-xs font-semibold text-rose-700">
                  {preview.reason}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-espresso/70 mb-1">
                Invoice Number Prefix
              </label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-espresso"
              />
              <span className="text-[11px] text-slate-400">
                The start of the number. A slash or a hyphen at the end reads
                well.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-espresso/70 mb-1">
                Ends With
              </label>
              <input
                type="text"
                value={numberSuffix}
                onChange={(e) => setNumberSuffix(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-espresso"
              />
              <span className="text-[11px] text-slate-400">
                Put <code className="font-bold">{"{FY}"}</code> where the
                financial year should go and it follows the year forward on its
                own. Typing 26-27 yourself would still say 26-27 next April.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-espresso/70 mb-1">
                Leading Zeros
              </label>
              <input
                type="number"
                min="0"
                max="9"
                value={numberPadTo}
                onChange={(e) => setNumberPadTo(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-espresso"
              />
              <span className="text-[11px] text-slate-400">
                0 for plain numbers: 1, 2, 3. Set 4 for 0001.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-espresso/70 mb-1">
                Default Payment Due Days
              </label>
              <input
                type="number"
                value={dueDays}
                onChange={(e) => setDueDays(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-espresso"
              />
              <span className="text-[11px] text-slate-400">
                Number of days from issue date
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-espresso/70 mb-1">
              Standard GST Tax Rate (%)
            </label>
            <select
              value={defaultTaxRate}
              onChange={(e) => setDefaultTaxRate(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-espresso"
            >
              <option value="0">0% (Exempt)</option>
              <option value="5">5% GST</option>
              <option value="12">12% GST</option>
              <option value="18">18% GST (Standard B2B)</option>
              <option value="28">28% GST</option>
            </select>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-espresso pb-3 border-b border-slate-100">
            Terms & Footers
          </h3>

          <div>
            <label className="block text-xs font-semibold text-espresso/70 mb-1">
              Default Invoice Notes
            </label>
            <textarea
              rows={2}
              value={defaultNotes}
              onChange={(e) => setDefaultNotes(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-espresso"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-espresso/70 mb-1">
              Standard Terms & Conditions
            </label>
            <textarea
              rows={4}
              value={defaultTerms}
              onChange={(e) => setDefaultTerms(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-espresso"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 rounded-xl bg-clay px-6 py-2.5 text-xs font-bold text-white shadow-sm shadow-clay/20 transition-colors hover:bg-espresso disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="w-4 h-4" /> {isSaving ? "Saving" : "Save settings"}
          </button>
        </div>
      </form>

      <MarketplaceAccounts version={savedVersion} />
    </div>
  );
}
