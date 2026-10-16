import { Navigate, Link } from "react-router-dom";
import { Store, Clock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { FEATURES } from "../config/features";
import MarketplaceHome from "./MarketplaceHome";

/**
 * What lives at "/" depends on whether the marketplace is switched on.
 *
 * With it on, this is the old browsing home page, unchanged. With it off,
 * a wholesaler goes straight to their workspace, and a retailer gets an honest
 * hold message rather than a redirect. RequireRole sends unauthorised users
 * back to "/", so this route must never redirect them onward or the two
 * bounce off each other forever.
 */
const Home = () => {
  const { user, isLoading } = useAuth();

  if (FEATURES.MARKETPLACE) return <MarketplaceHome />;

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (user?.role === "seller" || user?.role === "both") {
    return <Navigate to="/seller" replace />;
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-clay/10 text-clay">
          <Clock className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-black text-espresso">
          Ordering is not open yet
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Right now this is a tool wholesalers use to manage their own sales.
          Ordering from your wholesaler through the app is being built. Your
          wholesaler will send you a link when it is ready.
        </p>

        {!user && (
          <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              to="/login"
              className="rounded-lg bg-espresso px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-clay"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Store className="h-4 w-4" />
              I am a wholesaler
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
