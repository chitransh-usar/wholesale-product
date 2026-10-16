import { Suspense, useState, useEffect } from "react";
import CommandPalette from "../components/CommandPalette";
import { useHotkey, prettyCombo } from "../hooks/useHotkey";
import {
  LayoutDashboard,
  Package,
  Boxes,
  BookOpen,
  ShoppingBag,
  ShoppingCart,
  Factory,
  MessageSquare,
  FileText,
  Truck,
  Database,
  Settings,
  UserCog,
  Sparkles,
  LogOut,
  Menu,
  X,
  Store,
  Home,
  Users,
  BarChart3,
  ShieldCheck,
  Search,
} from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import api from "../utils/axios";
import { useAuth } from "../context/AuthContext";
import { useUnread } from "../context/UnreadContext";
import { FEATURES } from "../config/features";
import Wordmark from "../components/Wordmark";

// Wholesale 3.0 nav. "Customers" sits second because the customer book is the
// thing a wholesaler opens the app for. The marketplace-era entries are kept
// but only shown when the marketplace flag is on, so nothing is deleted.
const NAV = [
  { path: "/seller", label: "Overview", icon: LayoutDashboard, exact: true },
  // The day, in one list. Sits under Overview because it answers the same
  // question at a different zoom: Overview is the month, this is today.
  { path: "/seller/daybook", label: "Day book", icon: BookOpen, needs: "sales" },
  { path: "/seller/customers", label: "Customers", icon: Users, needs: "customers" },
  // One list. It used to be two, their own rate list and their shop listings,
  // which meant the same thing to them and differed only in which half of the
  // row each screen could show. Where a product is shown is now a control on
  // the product itself, which is where they look for it.
  { path: "/seller/products", label: "Products", icon: Package, needs: "products" },
  // Behind the products permission, because it answers a question about what
  // is being sold rather than about money.
  { path: "/seller/stock", label: "Stock", icon: Boxes, needs: "products" },
  { path: "/seller/sales", label: "Sales", icon: ShoppingBag, needs: "sales" },
  // Marketplace orders, which are a different thing from a recorded sale.
  {
    path: "/seller/orders",
    label: "Orders",
    icon: ShoppingBag,
    flag: "MARKETPLACE",
    needs: "orders",
  },
  // The other direction. Purchases sits next to Sales because they are the
  // two halves of the same day, and Suppliers next to it because a purchase
  // is always from somebody, the way a sale is always to somebody.
  // Suppliers before Purchases, mirroring Customers before Sales above. You
  // have the man before you have the bill from them, and the order you add
  // them in should read the same way on both sides of the book.
  { path: "/seller/suppliers", label: "Suppliers", icon: Factory, needs: "purchases" },
  { path: "/seller/purchases", label: "Purchases", icon: ShoppingCart, needs: "purchases" },
  { path: "/seller/invoices", label: "Invoices", icon: FileText, needs: "invoices" },
  // Sits under Invoices because it is the other half of the same job: what
  // went out before the bill could be raised.
  { path: "/seller/challans", label: "Challans", icon: Truck, needs: "invoices" },
  { path: "/seller/messages", label: "Messages", icon: MessageSquare, badge: "unread" },
  // Off behind FEATURES.PROMOTIONS, not deleted. See the flag for why.
  {
    path: "/seller/promotions",
    label: "Promotions",
    icon: Sparkles,
    flag: "PROMOTIONS",
  },
  {
    path: "/seller/analytics",
    label: "Analytics",
    icon: BarChart3,
    flag: "ANALYTICS",
  },
  { path: "/seller/staff", label: "Staff", icon: UserCog, ownerOnly: true },
  // Bringing an old book in, and taking a copy out. Its own entry rather than
  // a section of Settings: it sat below the Save button there and was asked
  // for twice by somebody who could not find it.
  { path: "/seller/data", label: "Your data", icon: Database, ownerOnly: true },
  { path: "/seller/settings", label: "Settings", icon: Settings, ownerOnly: true },
].filter((item) => !item.flag || FEATURES[item.flag]);

/**
 * Fetch a tab's code before it is clicked.
 *
 * The pointer rests on a nav item for a moment before the click lands, and
 * that moment is usually enough to pull the chunk down. Vite serves the same
 * module React.lazy will ask for, so this is a warm cache rather than a second
 * download. Keyed by path and matched to the routes in App.jsx.
 *
 * Failures are swallowed on purpose: this is an optimisation, and a prefetch
 * that fails costs nothing because the real navigation will ask again.
 */
const PREFETCH = {
  "/seller": () => import("../pages/dashboard/Overview"),
  "/seller/customers": () => import("../pages/dashboard/Parties"),
  "/seller/products": () => import("../pages/dashboard/MyProducts"),
  "/seller/sales": () => import("../pages/dashboard/Sales"),
  "/seller/orders": () => import("../pages/dashboard/Orders"),
  "/seller/challans": () => import("../pages/dashboard/Challans"),
  "/seller/stock": () => import("../pages/dashboard/Stock"),
  "/seller/daybook": () => import("../pages/dashboard/DayBook"),
  "/seller/staff": () => import("../pages/dashboard/Staff"),
  "/seller/settings": () => import("../pages/dashboard/Settings"),
};

const warmed = new Set();
const prefetch = (path) => {
  if (warmed.has(path) || !PREFETCH[path]) return;
  warmed.add(path);
  PREFETCH[path]().catch(() => warmed.delete(path));
};

/**
 * What the content pane shows while a tab's code arrives.
 *
 * Shaped like a page rather than a spinner in the middle of nothing. The
 * sidebar and header are already on screen and are not going anywhere, so a
 * centred spinner here reads as the page having broken rather than as it
 * being a moment away.
 */
const PaneFallback = () => (
  <div className="mx-auto max-w-4xl animate-pulse space-y-4">
    <div className="h-7 w-48 rounded-lg bg-slate-200" />
    <div className="h-4 w-72 rounded bg-slate-200/70" />
    <div className="mt-6 space-y-3">
      <div className="h-20 rounded-2xl bg-slate-200/60" />
      <div className="h-20 rounded-2xl bg-slate-200/40" />
      <div className="h-20 rounded-2xl bg-slate-200/25" />
    </div>
  </div>
);

const SellerLayout = () => {
  /**
   * Whether this person may reach the platform administration area.
   *
   * Read from the masters endpoint, which already answers it, rather than
   * from the token: the flag is deliberately not in the token so that taking
   * it away takes effect at once. This only decides whether to draw a link.
   * The server refuses every master write on its own authority.
   */
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get("/api/masters")
      .then(({ data }) => alive && setIsPlatformAdmin(Boolean(data?.isPlatformAdmin)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, can, isOwner, staff } = useAuth();
  const { unreadCount } = useUnread();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // What this person can actually reach. The sidebar must not offer a screen
  // the server will refuse: an employee clicking "Customers" and being told no
  // is a worse experience than never seeing it. The server checks again, which
  // is the boundary; this is only politeness.
  const nav = NAV.filter(
    (item) =>
      (!item.ownerOnly || isOwner) && (!item.needs || can(item.needs)),
  );

  /**
   * The words a wholesaler would actually type, beside the ones on the nav.
   *
   * They call a supplier a mill and an invoice a bill, and searching a menu
   * for the word printed on the menu is not much of a search.
   */
  const PALETTE_WORDS = {
    "/seller/customers": "party parties buyer khata account",
    "/seller/stock": "godown inventory maal quantity how much left",
    "/seller/daybook": "day book today rojmel what happened register",
    "/seller/suppliers": "mill vendor party purchase from",
    "/seller/purchases": "bill purchase inward buying",
    "/seller/sales": "sale outward selling kaata",
    "/seller/invoices": "bill tax gst invoice",
    "/seller/challans": "challan sales purchases goods out in",
    "/seller/products": "item stock rate list",
    "/seller/settings": "profile gst upi shop details",
    "/seller/staff": "employee worker munim",
    "/seller": "home dashboard summary",
  };

  const paletteItems = nav.map((item) => ({
    path: item.path,
    label: item.label,
    icon: item.icon,
    keywords: (PALETTE_WORDS[item.path] || "").split(" ").filter(Boolean),
  }));

  useHotkey("mod+k", () => setPaletteOpen(true), {
    label: "Search and jump to a page",
    group: "Getting around",
    // A modifier, so it works from inside a half typed form too.
    allowInInput: true,
  });

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isActive = (item) =>
    item.exact
      ? location.pathname === item.path
      : location.pathname.startsWith(item.path);

  const companyName =
    user?.companyName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim();

  return (
    <div className="font-dmsans flex h-dvh overflow-hidden bg-slate-100">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Rail */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-espresso text-cream transition-transform duration-300 md:relative md:translate-x-0 ${
          isSidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          {/* Clicking the name goes home, which is what clicking the name does
              everywhere. A convenience that costs no room, not the only way
              across: that is the Home button in the header. */}
          {FEATURES.MARKETPLACE ? (
            <Link to="/" className="group" title="Back to the home page">
              <p className="text-base font-black leading-none tracking-tight transition-opacity group-hover:opacity-80">
                <Wordmark />
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cream/40">
                Seller Workspace
              </p>
            </Link>
          ) : (
            <div>
              <p className="text-base font-black leading-none tracking-tight">
                <Wordmark />
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cream/40">
                Seller Workspace
              </p>
            </div>
          )}
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="rounded-lg p-1.5 text-cream/50 transition-colors hover:bg-white/10 hover:text-cream md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* The visible half of the palette. The shortcut is the fast way in
            and this is how anybody finds out the shortcut exists. */}
        <div className="px-3 pt-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2.5 text-sm text-cream/50 transition-colors hover:bg-white/10 hover:text-cream/80"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="hidden shrink-0 rounded-md border border-cream/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-tight text-cream/40 md:block">
              {prettyCombo("mod+k")}
            </kbd>
          </button>
        </div>

        <nav className="nav-scrollbar flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
          {nav.map((item) => {
            const active = isActive(item);
            const showBadge = item.badge === "unread" && unreadCount > 0;
            return (
              <Link
                key={item.path}
                to={item.path}
                onMouseEnter={() => prefetch(item.path)}
                onFocus={() => prefetch(item.path)}
                onTouchStart={() => prefetch(item.path)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-clay text-white font-bold"
                    : "text-cream/60 hover:bg-white/5 hover:text-cream font-semibold"
                }`}
              >
                <span className="flex items-center gap-3">
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </span>
                {showBadge && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3">
          {/* The buyer-facing shop page, not a dashboard screen, so it sits
              with the other ways out rather than in the nav list above.
              Both of these belong to the marketplace, which is switched off
              in 3.0, so they follow the same flag. */}
          {/* The platform administration area, for an admin who is also a wholesaler.
              A separate area rather than a nav entry above, because it is a
              different job and because /seller/* is guarded by role, which a
              platform admin need not have. Shown only when the flag is really
              set: the endpoint says so and the server refuses every write
              regardless of what this draws. */}
          {isPlatformAdmin && (
            <Link
              to="/administration"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-cream/60 transition-colors hover:bg-white/5 hover:text-cream"
              title="The platform's own lists: states, units, tax rates, HSN codes"
            >
              <ShieldCheck className="h-4 w-4" />
              Platform Administration
            </Link>
          )}
          {FEATURES.MARKETPLACE && user?.id && (
            <Link
              to={`/wholesaler/${user.id}`}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-cream/60 transition-colors hover:bg-white/5 hover:text-cream"
              title="See your shop page the way buyers see it"
            >
              <Store className="h-4 w-4" />
              My shop page
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Workspace */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="-ml-2 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">
                {/* An employee is looking at their employer's shop, so the
                    header says whose it is. Two brothers with two firms and
                    one phone between them is not an unusual arrangement. */}
                {isOwner ? companyName || "Your business" : staff.worksFor}
              </p>
              <p className="truncate text-[11px] font-semibold text-slate-400">
                {/* An admin is not a fourth kind of trader, so their role stays
                    what it is and only the label changes. The permission is a
                    separate flag; this is presentation. */}
                {!isOwner
                  ? "You are working here as staff"
                  : isPlatformAdmin
                    ? "Admin account"
                    : "Wholesaler account"}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Out of the workspace to the home page.

                It used to be a full row in the sidebar footer reading "Back to
                marketplace", which spent a line on naming a surface, sitting
                next to "My shop page" which sounds like the same thing and is
                the opposite: that one is their own page as buyers see it.

                Labelled Home, because that is the page it goes to. It was
                briefly "Buy stock", which was worse: this is the ordinary way
                out of the dashboard, not an errand, and a button promising a
                purchase that lands on a home page is a small lie. */}
            {FEATURES.MARKETPLACE && (
              <Link
                to="/"
                className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-clay hover:text-clay"
                title="Back to the home page"
              >
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">Home</span>
              </Link>
            )}

            {/* There used to be a Record sale button here, on every screen.
                It was right when a sale was the only thing this book wrote.
                It is not any more: a challan comes first, and the sale is
                raised from it. One of four daily actions does not belong in
                the header above the other three, so it now lives on the Sales
                screen beside Add customer, exactly as Enter a bill lives on
                Purchases. */}
          </div>
        </header>

        {/* The boundary belongs here, around the content, not around the whole
            dashboard. With only the outer one a lazily loaded page suspended
            past the sidebar and header, so switching to a tab for the first
            time threw the entire shell away and rebuilt it behind a full
            screen spinner. Now the shell stays put and only this pane waits. */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Suspense fallback={<PaneFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
};

export default SellerLayout;
