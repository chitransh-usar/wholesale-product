import { useEffect, useState } from "react";
import api from "../utils/axios";

const RetailDashboard = () => {
  const [loyalty, setLoyalty] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [giftCards, setGiftCards] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [loyaltyRes, referralsRes, giftCardsRes] = await Promise.all([
          api.get("/api/promotions/loyalty"),
          api.get("/api/promotions/referrals"),
          api.get("/api/promotions/gift-cards/balance"),
        ]);
        setLoyalty(loyaltyRes.data.account);
        setReferrals(referralsRes.data.referrals || []);
        setGiftCards(giftCardsRes.data.giftCards || []);
      } catch (error) {
        console.error(error);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Loyalty Points</p>
          <p className="text-3xl font-bold text-slate-900">
            {loyalty?.points_balance || 0}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Membership Tier</p>
          <p className="text-3xl font-bold text-slate-900">
            {loyalty?.membership_tier || "Bronze"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Gift Cards</p>
          <p className="text-3xl font-bold text-slate-900">
            {giftCards.length}
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-lg font-bold text-slate-900">
          Recent referrals
        </h3>
        <div className="space-y-2">
          {referrals.length ? (
            referrals.map((item) => (
              <div key={item.id} className="text-sm text-slate-600">
                {item.status}
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No referrals yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RetailDashboard;
