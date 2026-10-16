const masterService = require("../services/masterService");
const { isPlatformAdmin } = require("../middlewares/platformAdmin");

/**
 * The platform administrations, read.
 *
 * Writing them is the admin console's job and is not built yet; this is the
 * read side, which every screen with a unit or a tax rate dropdown needs.
 *
 * Readable by any signed in user, deliberately. These are the state list, the
 * units, the GST slabs and a short list of HSN codes: public facts, printed on
 * documents that go to customers. Gating them would only mean a buyer's
 * checkout could not name the state they live in.
 */
exports.getMasters = async (req, res) => {
  try {
    const [states, units, taxRates, hsn, uqcCodes, taxTerms] = await Promise.all([
      masterService.states(),
      masterService.units(),
      masterService.taxRates(),
      masterService.hsn(),
      masterService.uqcCodes(),
      masterService.taxTerms(),
    ]);
    // The sales channels. A fixed product concept rather than a table, but
    // served from here so the screens and the server cannot drift on what the
    // four are called.
    //
    // Plus the wholesaler's own extra marketplace accounts, for whoever's book
    // this request is working on, so an employee sees the owner's accounts.
    // A buyer has none and gets the four. Never allowed to cost the lists
    // above: a failure here falls back to the four books.
    const { CHANNELS, channelsFor } = require("../services/salesChannels");
    const { businessId } = require("../middlewares/businessContext");
    const salesChannels = await channelsFor(businessId(req)).catch((err) => {
      console.error("Could not read marketplace accounts:", err.message);
      return CHANNELS;
    });
    /**
     * Rows that have been switched off, when the console asks for them.
     *
     * The plain read returns only active rows, because that is what every
     * dropdown in the product wants. The administration screens need the rest too, or
     * a row the admin has just switched off simply vanishes and looks deleted.
     * Asked for explicitly so no ordinary screen pays for it.
     */
    let off = {};
    if (req.query?.includeInactive && (await masterService.mastersExist())) {
      const pool = require("../config/db");
      const [s, u, t, tt, h] = await Promise.all([
        pool.query("SELECT code, name, is_union_territory, active FROM master_states WHERE NOT active ORDER BY code"),
        pool.query(`SELECT code, name, allows_decimals, ${
          (await masterService.uqcExists()) ? "uqc" : "NULL AS uqc"
        }, active FROM master_units WHERE NOT active ORDER BY sort_order, name`),
        pool.query("SELECT rate, label, active FROM master_tax_rates WHERE NOT active ORDER BY rate"),
        (await masterService.taxTermsExist())
          ? pool.query(`SELECT code, label, igst_percent, cess_percent, active
                          FROM master_tax_terms WHERE NOT active ORDER BY sort_order`)
          : { rows: [] },
        pool.query("SELECT code, description, active FROM master_hsn WHERE NOT active ORDER BY code"),
      ]);
      off = {
        statesInactive: s.rows.map((r) => ({ code: r.code, name: r.name, isUnionTerritory: r.is_union_territory, active: false })),
        unitsInactive: u.rows.map((r) => ({ code: r.code, name: r.name, allowsDecimals: r.allows_decimals, uqc: r.uqc || null, active: false })),
        taxRatesInactive: t.rows.map((r) => ({ rate: Number(r.rate), label: r.label, active: false })),
        taxTermsInactive: tt.rows.map((r) => ({
          code: r.code, label: r.label,
          igstPercent: Number(r.igst_percent), cessPercent: Number(r.cess_percent),
          active: false,
        })),
        hsnInactive: h.rows.map((r) => ({ code: r.code, label: r.description, active: false })),
      };
    }

    res.status(200).json({
      states,
      units,
      taxRates,
      hsn,
      // The statutory UQC list, for the dropdown on the units screen. Empty
      // until wholesale3_uqc_master_units.sql has been run.
      uqcCodes,
      // The named tax combinations, with CGST and SGST derived. Empty until
      // wholesale3_tax_terms_and_cess.sql has been run.
      taxTerms,
      salesChannels,
      // Read by every screen that shows an amount or a date, which is most of
      // them, so it rides along with the lists rather than costing its own
      // request on every page.
      settings: await masterService.settings(),
      ...off,
      // So a screen can tell "the platform has no units" from "this database
      // has not had the migration run and you are seeing the built in list".
      fromMasters: await masterService.mastersExist(),
      isPlatformAdmin: await isPlatformAdmin(req.user?.id),
    });
  } catch (err) {
    console.error("Error reading the masters:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Writing an administration list.
 *
 * Everything here sits behind requirePlatformAdmin at the route. These lists
 * shape documents that go to customers and a tax rate on a bill is a number
 * somebody can be fined over, so the guard is the route's job and the checking
 * is this file's.
 *
 * DEACTIVATE, NEVER DELETE. A unit or an HSN code printed on an invoice
 * already issued must not vanish from that document because somebody tidied a
 * list a year later. Every list carries `active`, and switching it off is what
 * "remove" means here.
 */

const pool = require("../config/db");

// Each list, and what a valid row looks like. Kept as data rather than four
// near identical handlers, because four copies of "validate then upsert" is
// how three of them end up with subtly different rules.
const LISTS = {
  states: {
    table: "master_states",
    key: "code",
    label: "state",
    columns: ["name", "is_union_territory", "active"],
    check: (body) => {
      const code = String(body.code || "").trim();
      if (!/^[0-9]{2}$/.test(code)) {
        return { error: "A state code is exactly two digits, the first two of a GSTIN." };
      }
      if (!String(body.name || "").trim()) return { error: "A state needs a name." };
      return {
        key: code,
        values: {
          name: String(body.name).trim().slice(0, 100),
          is_union_territory: Boolean(body.isUnionTerritory),
          active: body.active === undefined ? true : Boolean(body.active),
        },
      };
    },
  },
  units: {
    table: "master_units",
    key: "code",
    label: "unit",
    columns: ["name", "allows_decimals", "active", "sort_order", "uqc"],
    check: (body) => {
      const code = String(body.code || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(code)) {
        return { error: "A unit code is up to 16 letters, digits, hyphen or underscore." };
      }
      if (!String(body.name || "").trim()) return { error: "A unit needs a name." };

      // Blank is allowed and means nobody has decided yet. That is different
      // from OTH, which is a declaration to the GST system that this unit has
      // no standard code, and it should be chosen rather than defaulted to.
      // The shape is checked here. Whether the code actually exists is the
      // foreign key's job, because master_uqc is the list and this is not.
      const uqc = String(body.uqc || "").trim().toUpperCase();
      if (uqc && !/^[A-Z]{3}$/.test(uqc)) {
        return { error: "A UQC is the three letter code from the GST list, such as MTR or KGS." };
      }

      return {
        key: code,
        values: {
          name: String(body.name).trim().slice(0, 64),
          allows_decimals: body.allowsDecimals === undefined ? true : Boolean(body.allowsDecimals),
          active: body.active === undefined ? true : Boolean(body.active),
          sort_order: Number.isFinite(Number(body.sortOrder)) ? Math.round(Number(body.sortOrder)) : 0,
          uqc: uqc || null,
        },
      };
    },
  },
  "tax-terms": {
    table: "master_tax_terms",
    key: "code",
    label: "tax term",
    columns: ["label", "igst_percent", "cess_percent", "active", "sort_order"],
    check: (body) => {
      const code = String(body.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_]{0,23}$/.test(code)) {
        return { error: "A term code is up to 24 capitals, digits or underscore, such as GST18." };
      }
      const igst = Number(body.igstPercent);
      if (!Number.isFinite(igst) || igst < 0 || igst > 100) {
        return { error: "The GST rate is between 0 and 100. CGST and SGST are half of it each." };
      }
      // Blank means none, which is the right answer for almost everything.
      const cessRaw = body.cessPercent;
      const cess =
        cessRaw === undefined || cessRaw === null || String(cessRaw).trim() === ""
          ? 0
          : Number(cessRaw);
      if (!Number.isFinite(cess) || cess < 0 || cess > 500) {
        return { error: "A cess rate is between 0 and 500. Leave it blank for goods that carry none." };
      }
      return {
        key: code,
        values: {
          label: String(body.label || `GST ${igst}%`).trim().slice(0, 64),
          igst_percent: Number(igst.toFixed(2)),
          cess_percent: Number(cess.toFixed(2)),
          active: body.active === undefined ? true : Boolean(body.active),
          sort_order: Number.isFinite(Number(body.sortOrder)) ? Math.round(Number(body.sortOrder)) : 0,
        },
      };
    },
  },
  "tax-rates": {
    table: "master_tax_rates",
    key: "rate",
    label: "tax rate",
    columns: ["label", "active"],
    check: (body) => {
      const rate = Number(body.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return { error: "A GST rate is between 0 and 100." };
      }
      return {
        key: Number(rate.toFixed(2)),
        values: {
          label: String(body.label || (rate === 0 ? "Nil" : `GST ${rate}%`)).trim().slice(0, 32),
          active: body.active === undefined ? true : Boolean(body.active),
        },
      };
    },
  },
  hsn: {
    table: "master_hsn",
    key: "code",
    label: "HSN code",
    columns: ["description", "source", "active"],
    check: (body) => {
      const code = String(body.code || "").trim();
      if (!/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/.test(code)) {
        return { error: "An HSN code is 4, 6 or 8 digits." };
      }
      if (!String(body.description || "").trim()) {
        return { error: "An HSN code needs a description of what the goods are." };
      }
      return {
        key: code,
        values: {
          description: String(body.description).trim(),
          // Rows an admin adds are marked as their, so the curated list this
          // product shipped with stays tellable from what was added later.
          source: "admin",
          active: body.active === undefined ? true : Boolean(body.active),
        },
      };
    },
  },
};

/**
 * Create or update one row.
 *
 * An upsert rather than separate create and update routes: these lists are
 * keyed on the thing itself, a state code or a GST rate, so saving "24" twice
 * is an edit and not a duplicate. Saving a row that already exists keeps its
 * source, so an admin editing the description of a curated HSN code does not
 * silently reclassify it as their own.
 */
exports.saveMasterRow = async (req, res) => {
  const spec = LISTS[req.params.list];
  if (!spec) return res.status(404).json({ message: "No such administration list" });

  const checked = spec.check(req.body || {});
  if (checked.error) return res.status(400).json({ message: checked.error });

  try {
    let cols = Object.keys(checked.values).filter((c) => spec.columns.includes(c));

    // The uqc column arrives in a later migration than the units table. Until
    // it is run, saving a unit still has to work rather than failing on a
    // column that is not there.
    if (cols.includes("uqc") && !(await masterService.uqcExists())) {
      cols = cols.filter((c) => c !== "uqc");
    }
    const placeholders = cols.map((_, i) => `$${i + 2}`);
    const updates = cols
      // `source` is set on insert and left alone on update, so editing a
      // curated row does not relabel it.
      .filter((c) => c !== "source")
      .map((c) => `${c} = EXCLUDED.${c}`);

    const saved = await pool.query(
      `INSERT INTO ${spec.table} (${spec.key}, ${cols.join(", ")})
       VALUES ($1, ${placeholders.join(", ")})
       ON CONFLICT (${spec.key}) DO UPDATE SET ${updates.join(", ")}
       RETURNING *`,
      [checked.key, ...cols.map((c) => checked.values[c])],
    );

    // So the admin sees their own change at once rather than in five minutes.
    masterService.resetMasters();

    res.status(200).json({ success: true, row: saved.rows[0] });
  } catch (err) {
    // The foreign key onto master_uqc is what guarantees a unit cannot carry a
    // code the GST system does not have. Say so, rather than reporting a fault.
    if (err.code === "23503" && String(err.constraint || "").includes("uqc")) {
      return res.status(400).json({
        message: "That is not a UQC on the GST list. Pick one from the list, or leave it blank.",
      });
    }
    console.error(`Error saving a ${spec.label}:`, err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Switch a row off, or back on.
 *
 * Not a delete. See the note at the top of this block: a unit printed on an
 * invoice already issued must still read properly a year later.
 */
exports.setMasterRowActive = async (req, res) => {
  const spec = LISTS[req.params.list];
  if (!spec) return res.status(404).json({ message: "No such administration list" });

  const active = Boolean(req.body?.active);
  try {
    const changed = await pool.query(
      `UPDATE ${spec.table} SET active = $2 WHERE ${spec.key} = $1 RETURNING *`,
      [req.params.key, active],
    );
    if (changed.rows.length === 0) {
      return res.status(404).json({ message: `That ${spec.label} is not in the list` });
    }

    // Switching off the last one would empty the dropdown everywhere. The read
    // side falls back rather than serving nothing, so this is not a disaster,
    // but it is worth refusing outright rather than leaving them wondering why
    // their change had no effect.
    if (!active) {
      const left = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${spec.table} WHERE active`,
      );
      if (left.rows[0].n === 0) {
        await pool.query(
          `UPDATE ${spec.table} SET active = TRUE WHERE ${spec.key} = $1`,
          [req.params.key],
        );
        return res.status(400).json({
          message: `That is the last ${spec.label} left. Add another before switching this one off.`,
        });
      }
    }

    masterService.resetMasters();
    res.status(200).json({ success: true, row: changed.rows[0] });
  } catch (err) {
    console.error(`Error switching a ${spec.label}:`, err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.MASTER_LISTS = Object.keys(LISTS);

/**
 * The platform's formatting conventions, written.
 *
 * Admin only, guarded on the route. Sends the whole settings object back so
 * the screen renders what was actually stored rather than what it hoped was.
 */
exports.saveSettings = async (req, res) => {
  try {
    const result = await masterService.saveSettings(req.body || {}, req.user?.id);
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    res.status(200).json({ success: true, settings: result.settings });
  } catch (err) {
    console.error("Error saving the administration settings:", err);
    res.status(500).json({ success: false, message: "Could not save those settings." });
  }
};
