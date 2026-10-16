const pool = require("../config/db");
const { checkGstin } = require("../utils/gstin");
const { asState } = require("../services/placeOfSupply");
const { businessId } = require("../middlewares/businessContext");

// @desc    Get wholesaler profile
// @route   GET /api/profile
exports.getProfile = async (req, res) => {
  try {
    const profile = await pool.query(
      `SELECT wp.*, u.email, u.first_name, u.last_name 
       FROM wholesaler_profiles wp 
       JOIN users u ON wp.user_id = u.id 
       WHERE wp.user_id = $1`,
      // The business, so an employee sees the shop they actually works in
      // rather than an empty profile of their own. Changing it is owner only,
      // enforced at the router: the GSTIN here goes on every invoice.
      [businessId(req)],
    );

    if (profile.rows.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.status(200).json(profile.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Update wholesaler profile
// @route   PUT /api/profile
exports.updateProfile = async (req, res) => {
  const {
    companyName, contactPhone, gstin, upiId, city, country,
    warehouseAddress, warehouseCity, warehouseState, warehousePincode,
    warehouseLat, warehouseLng,
  } = req.body;

  // A pin placed on the map is authoritative; text typed without one is
  // geocoded afterwards, which is less precise.
  const lat = Number(warehouseLat);
  const lng = Number(warehouseLng);
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng);

  // Their own GST number ends up on every invoice they raises, so a mistyped one
  // is worse here than anywhere else. Checked by the number's own arithmetic,
  // which costs nothing. Leaving the field out is still fine.
  let gstinValue = gstin;
  if (gstin !== undefined && gstin !== null && String(gstin).trim() !== "") {
    const result = checkGstin(gstin);
    if (!result.ok) return res.status(400).json({ message: result.reason });
    gstinValue = result.gstin;
  }

  // The state is not free text, whatever the screen sends. It decides CGST
  // plus SGST against IGST on every bill this wholesaler raises, and a value
  // no customer's state can ever equal would send every local sale out as
  // inter-state. Stored in the one spelling the rest of the system compares
  // against, so "gujarat" and "GUJARAT" cannot become two different states.
  let stateValue = warehouseState;
  if (warehouseState !== undefined && warehouseState !== null && String(warehouseState).trim() !== "") {
    const known = asState(warehouseState);
    if (!known) {
      return res.status(400).json({
        message: `"${String(warehouseState).trim()}" is not a state we recognise. Please pick one from the list.`,
      });
    }
    stateValue = known;
  }

  try {
    const updatedProfile = await pool.query(
      `UPDATE wholesaler_profiles 
       SET company_name = COALESCE($1, company_name),
           contact_phone = COALESCE($2, contact_phone),
           gstin = COALESCE($3, gstin),
           upi_id = COALESCE($4, upi_id),
           city = COALESCE($5, city),
           country = COALESCE($6, country),
           warehouse_address = COALESCE($7, warehouse_address),
           warehouse_city = COALESCE($8, warehouse_city),
           warehouse_state = COALESCE($9, warehouse_state),
           warehouse_pincode = COALESCE($10, warehouse_pincode),
           lat = COALESCE($11, lat),
           lng = COALESCE($12, lng),
           warehouse_pinned = CASE WHEN $11::numeric IS NULL
                                   THEN warehouse_pinned ELSE TRUE END,
           geocoded_at = CASE WHEN $11::numeric IS NULL
                              THEN geocoded_at ELSE CURRENT_TIMESTAMP END,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $13
       RETURNING *`,
      [
        companyName, contactPhone, gstinValue, upiId, city, country,
        warehouseAddress, warehouseCity, stateValue, warehousePincode,
        hasPin ? lat : null, hasPin ? lng : null,
        req.user.id,
      ],
    );

    // No pin, but the address changed: resolve it in the background so the
    // tracking map has an origin. Never awaited - saving must not wait on a
    // rate-limited geocoder.
    if (!hasPin && (warehouseAddress || warehouseCity)) {
      const { geocodeAddress } = require("../services/geocodingService");
      geocodeAddress({
        street: warehouseAddress,
        city: warehouseCity || city,
        state: warehouseState,
        pincode: warehousePincode,
        country: country || "India",
      })
        .then((point) => {
          if (!point) return;
          return pool.query(
            `UPDATE wholesaler_profiles
             SET lat = $1, lng = $2, geocoded_at = CURRENT_TIMESTAMP,
                 warehouse_pinned = FALSE
             WHERE user_id = $3 AND warehouse_pinned IS NOT TRUE`,
            [point.lat, point.lng, req.user.id],
          );
        })
        .catch(() => {});
    }

    res.status(200).json({
      message: "Profile updated successfully",
      profile: updatedProfile.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error updating profile" });
  }
};
