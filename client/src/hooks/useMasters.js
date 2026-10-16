import { useEffect, useState } from "react";
import api from "../utils/axios";
import { UNITS, GST_RATES } from "../constants/products";
import { applyMoneySettings, moneySettings } from "../utils/money";

/**
 * The platform administrations: units, tax slabs, states, HSN codes.
 *
 * These were constants in this client until 12 Sept. They now come from tables
 * a platform admin can edit, so correcting a unit or adding a GST slab stops
 * being a deploy.
 *
 * THE CONSTANTS ARE STILL HERE, as the floor. Migrations in this repository are
 * run by hand, so the client is routinely live against a server whose database
 * has not had the SQL applied. A product form that cannot offer a unit is worse
 * than one offering a list that is a week out of date, and these are the lists
 * the product has been running on all along.
 *
 * Fetched once per page load and shared through a module level promise rather
 * than a context, because four screens want it, it never changes while somebody
 * is filling in a form, and a context provider around the whole app for two
 * dropdowns is more machinery than the job needs.
 */

const FALLBACK = {
  units: UNITS.map((u) => ({ code: u.value, name: u.label, allowsDecimals: true })),
  taxRates: GST_RATES.map((rate) => ({
    rate,
    label: rate === 0 ? "Nil" : `GST ${rate}%`,
  })),
  states: [],
  hsn: [],
  taxTerms: [],
  // The floor, so a sale form still offers the four books if the request for
  // them fails. The server is the authority and this matches it.
  salesChannels: [
    { code: "counter", label: "Counter or phone" },
    { code: "shop", label: "This shop" },
    { code: "flipkart", label: "Flipkart" },
    { code: "amazon", label: "Amazon" },
  ],
  // The shipped conventions, so a screen rendering before this resolves
  // formats the way the product always has rather than with nothing.
  settings: moneySettings(),
  fromMasters: false,
  isPlatformAdmin: false,
};

let inFlight = null;
let loaded = null;

/** For tests and for the admin console after it saves a change. */
export const resetMasters = () => {
  inFlight = null;
  loaded = null;
};

const fetchMasters = () => {
  if (loaded) return Promise.resolve(loaded);
  if (inFlight) return inFlight;

  inFlight = api
    .get("/api/masters")
    .then(({ data }) => {
      // A reply missing a list is treated as a reply without one, not as an
      // empty list. Emptying a dropdown because a server answered oddly is the
      // failure this whole fallback exists to prevent.
      loaded = {
        units: data?.units?.length ? data.units : FALLBACK.units,
        taxRates: data?.taxRates?.length ? data.taxRates : FALLBACK.taxRates,
        states: data?.states?.length ? data.states : FALLBACK.states,
        hsn: data?.hsn?.length ? data.hsn : FALLBACK.hsn,
        taxTerms: data?.taxTerms || [],
        salesChannels: data?.salesChannels?.length
          ? data.salesChannels
          : FALLBACK.salesChannels,
        settings: data?.settings || FALLBACK.settings,
        fromMasters: Boolean(data?.fromMasters),
        isPlatformAdmin: Boolean(data?.isPlatformAdmin),
      };
      // Pushed into the formatter so money() and dateLabel() can stay plain
      // functions, callable from a sort comparator or a useMemo where a hook
      // cannot go. See utils/money for the reasoning.
      applyMoneySettings(loaded.settings);
      return loaded;
    })
    .catch(() => {
      // Not surfaced to the user. They are filling in a product form and the
      // dropdowns are full; there is nothing for them to do about it.
      inFlight = null;
      return FALLBACK;
    });

  return inFlight;
};

/**
 * Returns the masters, starting from the built in lists so a form is never
 * rendered with an empty dropdown while the request is in the air.
 */
export const useMasters = () => {
  const [masters, setMasters] = useState(loaded || FALLBACK);

  useEffect(() => {
    let alive = true;
    fetchMasters().then((value) => {
      if (alive) setMasters(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return masters;
};
