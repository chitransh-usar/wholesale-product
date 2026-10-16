import { useState, useRef, useEffect } from "react";
import {
  Search,
  MapPin,
  ShoppingCart,
  User,
  Heart,
  LogOut,
  LayoutDashboard,
  ChevronDown,
  Check,
  MessageSquare, // <-- Added this import
  Package,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useWishlist } from "../context/WishlistContext";
import { useAuth } from "../context/AuthContext";
import Wordmark from "./Wordmark";
import { useUnread } from "../context/UnreadContext";
import { useLocationFilter } from "../context/LocationContext";
import NotificationBell from "./NotificationBell";
import CartDrawer from "./CartDrawer";

// One line of the city menu. Outside the selector so it is not rebuilt on
// every render, which would reset the row's state each time it opened.
const CityRow = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-between gap-2 ${
      active
        ? "bg-clay/10 text-clay"
        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
    }`}
  >
    {children}
  </button>
);

/**
 * Which city's sellers the shop is showing.
 *
 * The list is whatever the server says has stock, so every line here leads
 * somewhere. It is deliberately not a list of big Indian cities: offering
 * Bangalore when no wholesaler there has listed anything gives the buyer an
 * empty page and no way of telling whether they filtered wrongly.
 *
 * Open state is local to each copy of this, and that is load bearing. The
 * navbar mounts two, one for phones and one for desktop, and only hides the
 * wrong one with CSS. Sharing one flag meant the hidden copy's outside-click
 * handler saw a click on the visible copy as a click outside itself, closed
 * the menu on mousedown, and destroyed the button before the mouseup could
 * land on it. No click event was ever produced and the picker did nothing at
 * all. A keyboard or a script could still choose a city, which is what made it
 * look like it worked.
 */
const LocationSelector = ({ city, setCity, cities, loadingCities, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropRef = useRef(null);
  const activeKey = city?.key || null;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setIsOpen]);

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Showing sellers from ${label}. Change city.`}
        className="flex items-center gap-1 sm:gap-1.5 p-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors group cursor-pointer"
      >
        <MapPin
          className={`w-5 h-5 group-hover:scale-110 transition-transform ${
            activeKey ? "text-clay" : "text-slate-500"
          }`}
        />
        {/* Text hidden on mobile to save space */}
        <span className="hidden sm:inline whitespace-nowrap max-w-[9rem] truncate">
          {label}
        </span>
        <ChevronDown
          className={`hidden sm:block w-3 h-3 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 sm:right-auto sm:left-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
          <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-clay" />
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Show sellers from
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto p-1 hide-scrollbar">
            <CityRow
              active={!activeKey}
              onClick={() => {
                setCity(null);
                setIsOpen(false);
              }}
            >
              <span>All India</span>
              {!activeKey && <Check className="w-4 h-4 shrink-0" />}
            </CityRow>

            {loadingCities && (
              <p className="px-3 py-3 text-xs text-slate-400">Loading...</p>
            )}

            {!loadingCities && cities.length === 0 && (
              <p className="px-3 py-3 text-xs text-slate-400">
                No seller has filled in their city yet, so there is nothing to
                choose from.
              </p>
            )}

            {cities.map((c) => (
              <CityRow
                key={c.key}
                active={activeKey === c.key}
                onClick={() => {
                  setCity(c);
                  setIsOpen(false);
                }}
              >
                <span className="truncate">{c.city}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] font-semibold text-slate-400">
                    {c.sellers}
                  </span>
                  {activeKey === c.key && <Check className="w-4 h-4" />}
                </span>
              </CityRow>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Navbar = () => {
  const { uniqueItemCount, setIsCartOpen } = useCart();
  const { itemCount: wishlistCount } = useWishlist();
  const { isAuthenticated, user, logout } = useAuth();
  const { unreadCount } = useUnread();

  const { city, setCity, cities, loadingCities, label } = useLocationFilter();

  const [searchQuery, setSearchQuery] = useState("");
  /**
   * Which flyout is open, as ONE value.
   *
   * The profile menu and the bell each owned their own boolean, so opening one
   * did not close the other: tap the profile, then tap the bell, and both sat
   * stacked on top of each other. One value makes them mutually exclusive by
   * construction rather than by remembering to close the other one.
   *
   * The two bells get DIFFERENT keys on purpose. The navbar mounts one for
   * phones and one for desktop and hides the wrong one with CSS, and a single
   * shared flag between two such copies is exactly what once broke the city
   * picker: the hidden copy's outside-click handler treated a click on the
   * visible copy as a click outside itself. Distinct keys, and a listener that
   * only exists while that copy is open, keep them apart.
   */
  const [openMenu, setOpenMenu] = useState(null);
  const isProfileOpen = openMenu === "profile";
  const closeMenus = () => setOpenMenu(null);
  const bellProps = (key) => ({
    open: openMenu === key,
    onToggle: () => setOpenMenu((current) => (current === key ? null : key)),
    onClose: () => setOpenMenu((current) => (current === key ? null : current)),
  });
  const navRef = useRef(null);
  const navigate = useNavigate();

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = () => {
    logout();
    closeMenus();
    navigate("/");
  };

  // Plain functions, not components declared during render. Declaring a
  // component inside Navbar gives it a new identity on every render, so React
  // throws its subtree away and builds it again. The city menu could not be
  // clicked at all because of it: the mousedown replaced the DOM node the
  // mouseup was meant to land on, so no click event was ever produced.
  const profileMenu = () => (
    <div className="absolute right-0 mt-2 w-56 sm:w-64 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
        <p className="text-sm font-bold text-slate-900 truncate">
          {user?.firstName} {user?.lastName}
        </p>
        <p className="text-xs text-slate-500 truncate mt-0.5">{user?.email}</p>
        <span className="inline-block mt-2 px-2 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-bold uppercase tracking-wider rounded">
          {user?.role} Account
        </span>
      </div>

      <div className="p-2 flex flex-col gap-1">
        {/* <-- Added Messages Link Here --> */}
        <Link
          to="/orders"
          onClick={() => closeMenus()}
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-clay/5 hover:text-clay rounded-lg transition-colors cursor-pointer"
        >
          <Package className="w-4 h-4" />
          Your Orders
        </Link>

        <Link
          to="/messages"
          onClick={() => closeMenus()}
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-clay/5 hover:text-clay rounded-lg transition-colors cursor-pointer"
        >
          <MessageSquare className="w-4 h-4" />
          Messages
          {/* The count follows the icon in here on a phone, where the icon
              itself is not in the bar. Without this the number a person was
              watching for simply stops existing on small screens. */}
          {unreadCount > 0 && (
            <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>

        {/* Only on a phone. On desktop the heart is in the bar, and offering
            it twice in one screen is clutter rather than convenience. */}
        <Link
          to="/wishlist"
          onClick={() => closeMenus()}
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-clay/5 hover:text-clay rounded-lg transition-colors cursor-pointer md:hidden"
        >
          <Heart className="w-4 h-4" />
          Saved items
          {wishlistCount > 0 && (
            <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {wishlistCount > 9 ? "9+" : wishlistCount}
            </span>
          )}
        </Link>

        {(user?.role === "seller" || user?.role === "both") && (
          <Link
            to="/seller"
            onClick={() => closeMenus()}
            className="flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-clay/5 hover:text-clay rounded-lg transition-colors cursor-pointer"
          >
            <LayoutDashboard className="w-4 h-4" />
            Supplier Dashboard
          </Link>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors w-full text-left cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>
    </div>
  );

  /**
   * The icon row.
   *
   * `compact` is the phone. Six icons plus the wordmark measured 39px wider
   * than a 320px screen, so the whole bar scrolled sideways, and at 360px the
   * wordmark and the first icon were touching with nothing between them. That
   * is what "looks weird on mobile" was.
   *
   * Compact keeps the two that are about THIS moment, where they are buying from
   * and what is in their basket, and moves messages and the wishlist into the
   * profile menu, which is where a phone puts the rest of a navigation. Both
   * are still one tap away and neither count is lost: they are carried as a
   * dot on the profile button, see below.
   */
  const actionIcons = ({ compact = false } = {}) => (
    <>
      <LocationSelector
        city={city}
        setCity={setCity}
        cities={cities}
        loadingCities={loadingCities}
        label={label}
      />

      {user && !compact && (
        <Link
          to="/messages"
          aria-label={
            unreadCount > 0
              ? `Messages, ${unreadCount} unread`
              : "Messages"
          }
          className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors group cursor-pointer"
        >
          <MessageSquare className="w-5 h-5 group-hover:scale-110 transition-transform" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 translate-x-1/2 -translate-y-1/2 bg-rose-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full ring-2 ring-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
      )}

      <Link
        to="/wishlist"
        className={`relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors group cursor-pointer ${compact ? "hidden" : ""}`}
      >
        <Heart className="w-5 h-5 group-hover:scale-110 transition-transform" />
        {wishlistCount > 0 && (
          <span className="absolute top-1.5 right-1.5 translate-x-1/2 -translate-y-1/2 bg-rose-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full ring-2 ring-white">
            {wishlistCount > 9 ? "9+" : wishlistCount}
          </span>
        )}
      </Link>

      <button
        onClick={() => setIsCartOpen(true)}
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors group cursor-pointer"
      >
        <ShoppingCart className="w-5 h-5 group-hover:scale-110 transition-transform" />
        {uniqueItemCount > 0 && (
          <span className="absolute top-1.5 right-1.5 translate-x-1/2 -translate-y-1/2 bg-clay text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full ring-2 ring-white">
            {uniqueItemCount > 9 ? "9+" : uniqueItemCount}
          </span>
        )}
      </button>
    </>
  );

  return (
    <>
      <nav
        ref={navRef}
        className="sticky top-0 z-50 w-full bg-white border-b border-slate-200 shadow-sm"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 max-w-7xl mx-auto gap-3 md:gap-8">
          <div className="flex items-center justify-between w-full md:w-auto shrink-0">
            <Link
              to="/"
              className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 select-none"
            >
              <Wordmark />
            </Link>

            {/* Mobile Icons */}
            <div className="flex items-center gap-0.5 sm:gap-1 md:hidden -mr-2">
              {actionIcons({ compact: true })}
              <NotificationBell {...bellProps("bell-phone")} />
              {isAuthenticated ? (
                <div className="relative">
                  <button
                    onClick={() => setOpenMenu((current) => (current === "profile" ? null : "profile"))}
                    className="relative p-2 text-clay hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                    aria-label={
                      unreadCount + wishlistCount > 0
                        ? "Your account, with unread messages or saved items"
                        : "Your account"
                    }
                  >
                    <User className="w-5 h-5" />
                    {/* A dot, not a number. What is behind it is two different
                        counts, and adding them together would be a figure that
                        means nothing. It says "there is something in here",
                        which is all a person needs to open it. */}
                    {unreadCount + wishlistCount > 0 && (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
                    )}
                  </button>
                  {isProfileOpen && profileMenu()}
                </div>
              ) : (
                <Link
                  to="/login"
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                >
                  <User className="w-5 h-5" />
                </Link>
              )}
            </div>
          </div>

          {/* Search */}
          <form
            onSubmit={handleSearch}
            className="w-full md:flex-1 relative group order-last md:order-0"
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products, categories, or wholesalers..."
              className="w-full bg-slate-100 border border-transparent rounded-lg py-2.5 pl-4 pr-10 text-sm text-slate-900 placeholder-slate-500 focus:ring-2 focus:ring-clay/20 focus:border-clay focus:outline-none focus:bg-white transition-all duration-300"
            />
            <button
              type="submit"
              className="absolute right-3.5 top-3 text-slate-400 hover:text-clay transition-colors cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
          </form>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-2 lg:gap-4 shrink-0">
            <div className="flex items-center gap-1">
              {actionIcons()}
              <NotificationBell {...bellProps("bell-desktop")} />
            </div>

            <div className="hidden lg:block w-px h-6 bg-slate-200 mx-1"></div>

            <div className="flex items-center gap-4 ml-2">
              {isAuthenticated ? (
                <div className="relative">
                  <button
                    onClick={() => setOpenMenu((current) => (current === "profile" ? null : "profile"))}
                    className="flex items-center gap-2 hover:bg-slate-50 p-1.5 pr-2.5 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-slate-200"
                  >
                    <div className="w-8 h-8 rounded-full bg-clay/10 text-clay flex items-center justify-center font-bold text-sm uppercase">
                      {user?.firstName?.charAt(0)}
                      {user?.lastName?.charAt(0)}
                    </div>
                    <div className="text-left hidden lg:block">
                      <p className="text-sm font-bold text-slate-800 leading-tight">
                        {user?.firstName}
                      </p>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform ${isProfileOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isProfileOpen && profileMenu()}
                </div>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/signup"
                    className="text-sm font-bold bg-clay text-white px-4 py-2 rounded-md hover:bg-clay/90 transition-all cursor-pointer shadow-sm"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <CartDrawer />
    </>
  );
};

export default Navbar;
