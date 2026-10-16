import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Hash,
  LayoutGrid,
  MapPin,
  Percent,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import api from "../utils/axios";
import Wordmark from "../components/Wordmark";

/**
 * The administration dashboard: the platform's own lists, not any wholesaler's.
 *
 * A separate area rather than a page inside the seller workspace, for three
 * reasons that all point the same way:
 *
 *   /seller/* is guarded by RequireRole seller|both, so a Master screen living
 *   inside it would be unreachable to a platform admin who does not also sell.
 *   That is fine today and stops being fine the moment there is an admin with
 *   no shop.
 *
 *   CLAUDE.md already says the seller dashboard is for wholesalers and buyer
 *   concepts do not go on it. Platform administration is not a wholesaler
 *   concept either.
 *
 *   They are different jobs. One is running a shop; this is CRUD over lists
 *   that shape documents across every shop.
 *
 * WHAT IS NOT HERE, deliberately: a wholesaler's invoice prefix, their due days,
 * their default tax rate, their terms. Those are their and they stay on their own
 * settings screen. Moving them here would mean one wholesaler changing their
 * prefix changed everybody's.
 *
 * What IS here is the layer above them, on the Settings screen: number and
 * date formatting, the Rule 46(b) constraints shown read only because they are
 * law, and the defaults a new wholesaler starts from. That screen deliberately
 * waited until the scattered money() helpers were collapsed into
 * utils/money.js, because a formatting setting that half the product ignores
 * is worse than none.
 */

const LINKS = [
  { to: "/administration", end: true, label: "Overview", icon: LayoutGrid },
  { to: "/administration/states", label: "States", icon: MapPin },
  { to: "/administration/units", label: "Units", icon: Ruler },
  { to: "/administration/tax-rates", label: "Tax rates", icon: Percent },
  { to: "/administration/tax-terms", label: "Tax terms", icon: Percent },
  { to: "/administration/hsn", label: "HSN codes", icon: Hash },
  { to: "/administration/settings", label: "Settings", icon: SlidersHorizontal },
];

/**
 * The client side guard.
 *
 * A closed door, not a locked one. Every write sits behind the server's
 * requirePlatformAdmin, which reads the flag from the database on the request;
 * this only decides whether to draw the screens. Anyone who forged their way
 * past it would find every button returning 403.
 */
const MasterLayout = () => {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, allowed: false, fromMasters: false });

  useEffect(() => {
    let alive = true;
    api
      .get("/api/masters")
      .then(({ data }) => {
        if (alive) {
          setState({
            loading: false,
            allowed: Boolean(data?.isPlatformAdmin),
            fromMasters: Boolean(data?.fromMasters),
          });
        }
      })
      .catch(() => alive && setState({ loading: false, allowed: false, fromMasters: false }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!state.allowed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
        <ShieldCheck className="mb-4 h-10 w-10 text-slate-300" />
        <h1 className="text-xl font-black text-espresso">This is the platform admin area</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your account does not have platform admin on it. Whoever runs the
          platform can switch it on for you.
        </p>
        <button
          onClick={() => navigate("/seller")}
          className="mt-6 rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          Back to my shop
        </button>
      </div>
    );
  }

  return (
    // h-dvh with overflow hidden, exactly as the seller shell does it. It was
    // min-h-screen, so the PAGE grew and the whole thing scrolled, taking the
    // sidebar up off the top with the content. Only the content pane scrolls
    // now, and the sidebar stays put.
    <div className="flex h-dvh overflow-hidden bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col bg-espresso text-cream lg:flex">
        {/* Drawn exactly as the seller sidebar draws it. Wordmark leaves size
            and weight to the caller, which is right where the callers are
            genuinely different, the navbar against the dark sign in panel. Two
            sidebar headers are not different, and leaving this one bare gave
            the administration area the name in the ambient weight while the seller
            area had it black and tight: the same product looking like two. */}
        <div className="flex h-16 shrink-0 items-center px-5">
          <div>
            <p className="text-base font-black leading-none tracking-tight">
              <Wordmark />
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cream/40">
              Platform Administration
            </p>
          </div>
        </div>

        <nav className="nav-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${
                  isActive ? "bg-clay text-cream" : "text-cream/70 hover:bg-cream/10"
                }`
              }
            >
              <link.icon className="h-4 w-4 shrink-0" />
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-cream/10 px-3 py-4">
          <Link
            to="/seller"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-cream/70 transition-colors hover:bg-cream/10"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Back to my shop
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* The phone nav. The administration screens are lists a person edits sitting
            down, so this is a way across rather than a full second nav. */}
        <div className="hide-scrollbar flex shrink-0 gap-2 overflow-x-auto bg-espresso px-4 py-3 lg:hidden">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold ${
                  isActive ? "bg-clay text-cream" : "text-cream/70"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        {/* Says plainly when the tables are not there, because every screen
            below would otherwise show the built in list and look editable
            while nothing saved. */}
        {!state.fromMasters && (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3">
            <p className="text-sm font-bold text-amber-900">
              The administration tables are not in this database yet
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              What you see below is the built in list the product falls back to.
              Run wholesale3_platform_masters.sql to make these editable.
            </p>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <Outlet context={{ fromMasters: state.fromMasters }} />
        </main>
      </div>
    </div>
  );
};

export default MasterLayout;
