import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import api from "../utils/axios";

/**
 * Which city the buyer is shopping in.
 *
 * The navbar picker used to be a piece of local state next to a list of ten
 * big Indian cities, and nothing read it. Picking Surat changed the label and
 * nothing else, so a buyer was shown the whole country while believing they were
 * being shown one city.
 *
 * Two things are deliberate here.
 *
 * The cities come from the server, built from listings that actually exist. A
 * fixed list offers Bangalore whether or not one wholesaler there has listed
 * anything, and an empty result gives the buyer no way to tell whether they
 * filtered wrongly or the shop is broken.
 *
 * The default is the whole country, not a city. Guessing a buyer's city from
 * their IP address or from the top of the list hides stock from them without their
 * ever having asked for that, and the hiding is invisible.
 */

const LocationContext = createContext(null);
const STORAGE_KEY = "wholesale_city_v1";

// Kept in step with cityKey() on the server. A difference between the two
// means a chosen city quietly matches nothing.
export const cityKey = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
};

export const ALL_INDIA = "All India";

export const LocationProvider = ({ children }) => {
  const [city, setCityState] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [cities, setCities] = useState([]);
  const [loadingCities, setLoadingCities] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get("/api/products/cities");
        if (!cancelled) setCities(Array.isArray(res.data) ? res.data : []);
      } catch {
        // An empty menu is the honest failure: the picker then offers only
        // "All India", which is exactly what the buyer gets.
        if (!cancelled) setCities([]);
      } finally {
        if (!cancelled) setLoadingCities(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCity = useCallback((next) => {
    // null, or anything that folds to nothing, means the whole country.
    const value = next && cityKey(next.key || next.city) ? next : null;
    setCityState(value);
    if (typeof window === "undefined") return;
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private browsing. The choice still holds for this visit.
    }
  }, []);

  /**
   * A saved city that no longer has any stock behind it is ignored rather than
   * obeyed. A buyer who chose Surat months ago would otherwise see an empty
   * shop with "Surat" in the navbar and no hint that their own old filter is the
   * reason.
   *
   * Ignored, not deleted: the choice stays in storage, so when a Surat seller
   * lists something again the buyer's city comes back on its own. And while
   * the menu is still loading the saved city is honoured, or every visit would
   * flash the whole country before narrowing.
   */
  const known = useMemo(() => {
    if (!city) return null;
    if (loadingCities) return city;
    const key = cityKey(city.key || city.city);
    return cities.find((c) => c.key === key) || null;
  }, [city, cities, loadingCities]);

  const value = useMemo(
    () => ({
      city: known,
      setCity,
      cities,
      loadingCities,
      // What to send to the API. Undefined rather than an empty string so it
      // does not turn up in the query string at all.
      cityParam: known ? cityKey(known.key || known.city) : undefined,
      label: known?.city || ALL_INDIA,
    }),
    [known, setCity, cities, loadingCities],
  );

  return (
    <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
  );
};

export const useLocationFilter = () => {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error("useLocationFilter must be used inside a LocationProvider");
  }
  return ctx;
};

export default LocationContext;
