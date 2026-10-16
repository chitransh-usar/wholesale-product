import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import axios from "../../utils/axios";
import { downloadFile } from "../../utils/download";

export default function InvoiceReports() {
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);

      const res = await axios.get(`/api/invoices/report?${params.toString()}`);
      if (res.data.success) {
        setReport(res.data.report);
      }
    } catch (err) {
      console.error("Error fetching reports:", err);
      toast.error("Could not load the report");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await fetchReports();
    })();
    return () => {
      active = false;
    };
    // Only on mount and when Filter is pressed; the date inputs alone should
    // not refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = async () => {
    try {
      await downloadFile("/api/invoices/export/excel", "invoices-report.xls", {
        params: { startDate, endDate },
      });
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Could not prepare that export");
    }
  };

  const gstSummary = report?.gstSummary || {};
  const agingReport = report?.agingReport || [];

  if (loading && !report) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/seller/invoices")}
            className="p-2 text-slate-500 hover:text-espresso border border-slate-200 rounded-xl hover:bg-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-espresso">
              GST and ageing
            </h1>
            <p className="mt-0.5 text-sm text-espresso/60">
              Tax collected, and how long your receivables have been sitting.
            </p>
          </div>
        </div>

        {/* Date Filter & Export */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-espresso/70"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-espresso/70"
          />
          <button
            onClick={fetchReports}
            className="rounded-xl bg-clay px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-espresso"
          >
            Apply
          </button>

          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-espresso/70 transition-colors hover:bg-slate-100"
          >
            <FileSpreadsheet className="w-4 h-4 text-sage" /> Export
          </button>
        </div>
      </div>

      {/* GST Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Total Taxable
          </span>
          <div className="text-2xl font-black text-espresso mt-2">
            ₹{Number(gstSummary.total_taxable || 0).toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            CGST Collected
          </span>
          <div className="text-2xl font-black text-clay mt-2">
            ₹{Number(gstSummary.total_cgst || 0).toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            SGST Collected
          </span>
          <div className="text-2xl font-black text-sage mt-2">
            ₹{Number(gstSummary.total_sgst || 0).toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            IGST Collected
          </span>
          <div className="text-2xl font-black text-sage mt-2">
            ₹{Number(gstSummary.total_igst || 0).toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs bg-emerald-50/50">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
            Total GST Tax
          </span>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            ₹{Number(gstSummary.total_gst || 0).toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      {/* Invoice Aging Table */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-espresso">
          <Clock className="w-5 h-5 text-clay" /> How long payments have been
          outstanding
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                <th className="py-3 px-4">Aging Bracket</th>
                <th className="py-3 px-4 text-center">Overdue Invoice Count</th>
                <th className="py-3 px-4 text-right">Outstanding Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-espresso/70">
              {agingReport.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-400">
                    No overdue receivables recorded.
                  </td>
                </tr>
              ) : (
                agingReport.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/40">
                    <td className="py-3 px-4 font-bold text-espresso">
                      {row.aging_bucket}
                    </td>
                    <td className="py-3 px-4 text-center font-bold">
                      {row.count}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-rose-600">
                      ₹{Number(row.amount).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
