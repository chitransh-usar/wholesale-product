import { useEffect, useState } from "react";
import api from "../utils/axios";

const PromotionStrip = () => {
  const [flashSales, setFlashSales] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get("/api/promotions/flash-sales?active=true");
        setFlashSales(res.data || []);
      } catch (error) {
        console.error(error);
      }
    };
    load();
  }, []);

  if (!flashSales.length) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
            Flash Sales
          </p>
          <h3 className="text-lg font-bold text-slate-900">
            {flashSales[0]?.name}
          </h3>
        </div>
        <span className="rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white">
          {flashSales[0]?.discount_value}% Off
        </span>
      </div>
    </section>
  );
};

export default PromotionStrip;
