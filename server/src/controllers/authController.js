const bcrypt = require("bcryptjs");
const { checkGstin } = require("../utils/gstin");
const { asState } = require("../services/placeOfSupply");
const { BRAND } = require("../config/brand");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const {
  enqueueNotification,
  createNotificationPreference,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} = require("../services/notificationManager");

exports.register = async (req, res) => {
  const { firstName, lastName, email, phone, password, role, state } = req.body;
  try {
    const userExists = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      "INSERT INTO users (first_name, last_name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, role",
      [firstName, lastName, email, phone, passwordHash, role],
    );

    if (role === "seller" || role === "both") {
      /**
       * The state, asked once at signup and stored here.
       *
       * It is the field every bill this account raises depends on: the same
       * state as the customer means CGST plus SGST, a different one means
       * IGST. Nothing used to ask for it, and wholesaler_profiles.city
       * defaults to 'Delhi', so a Surat wholesaler's first invoice was worked
       * out as though they were in Delhi.
       *
       * Checked against the list rather than stored as typed, because this is
       * a value a bill is computed from, and "Gujrat" is not a state.
       *
       * The city is written as an explicit NULL to override that default. A
       * blank city is true; "Delhi" is a claim nobody made.
       */
      await pool.query(
        `INSERT INTO wholesaler_profiles (user_id, warehouse_state, city)
         VALUES ($1, $2, NULL)`,
        [newUser.rows[0].id, asState(state)],
      );
    }

    // The account already exists at this point, so nothing below may fail the
    // request. A missing notifications table or an unreachable mail provider
    // is not a reason to tell someone their signup did not work.
    try {
      await createNotificationPreference(newUser.rows[0].id);
      await enqueueNotification({
        userId: newUser.rows[0].id,
        title: `Welcome to ${BRAND.name}`,
        message: "Your account was created successfully. Start buying or selling with confidence.",
        notificationType: NOTIFICATION_TYPES.auth,
        channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
        emailPayload: {
          to: email,
          subject: `Welcome to ${BRAND.name}`,
          templateName: "registration_success",
          variables: { firstName },
        },
      });
    } catch (notifyErr) {
      console.warn("Welcome notification skipped:", notifyErr.message);
    }

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query(
      "SELECT id, password_hash, role, first_name, last_name, email FROM users WHERE email = $1",
      [email],
    );
    if (user.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.rows[0].id, role: user.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "30d" },
    );

    res.status(200).json({
      token,
      user: {
        id: user.rows[0].id,
        role: user.rows[0].role,
        firstName: user.rows[0].first_name,
        lastName: user.rows[0].last_name,
        email: user.rows[0].email,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, first_name as "firstName", last_name as "lastName", email, role, phone FROM users WHERE id = $1',
      [req.user.id],
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Who they are working for, and what they may do. An owner gets isOwner true
    // and an empty permission list, which the client reads as "everything":
    // sending an owner the whole catalogue would mean a new permission had to
    // be added in two places to reach them.
    const business = req.business || { id: req.user.id, isOwner: true, permissions: [] };
    const employer = business.isOwner
      ? null
      : (await pool.query(
          `SELECT COALESCE(NULLIF(btrim(wp.company_name), ''),
                           btrim(u.first_name || ' ' || COALESCE(u.last_name, ''))) AS name
             FROM users u
             LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
            WHERE u.id = $1`,
          [business.id],
        )).rows[0]?.name || "your employer";

    res.status(200).json({
      user: user.rows[0],
      staff: {
        isOwner: business.isOwner,
        permissions: business.permissions,
        // Shown in the dashboard header, so an employee can see at a glance
        // whose book they have open. Two brothers with two firms and one phone
        // is not an unusual arrangement.
        worksFor: employer,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Upgrade a buyer to a seller
// @route   POST /api/auth/upgrade
exports.upgradeToSeller = async (req, res) => {
  const userId = req.user.id;
  const { companyName, gstin, phone, city, state } = req.body;

  // Checked here rather than left for the profile screen, because this number
  // goes onto their invoices from the first one they raises.
  let gstinValue = gstin;
  if (gstin !== undefined && gstin !== null && String(gstin).trim() !== "") {
    const result = checkGstin(gstin);
    if (!result.ok) return res.status(400).json({ message: result.reason });
    gstinValue = result.gstin;
  }

  try {
    const userResult = await pool.query(
      "SELECT role FROM users WHERE id = $1",
      [userId],
    );
    const currentRole = userResult.rows[0].role;

    if (currentRole === "seller" || currentRole === "both") {
      return res
        .status(400)
        .json({ message: "You are already registered as a seller." });
    }

    await pool.query("UPDATE users SET role = 'both' WHERE id = $1", [userId]);

    // The state comes from what they picked if they picked one, and otherwise
    // from their GST number, whose first two digits are the state. Only if they
    // gave neither is it left blank, which is honest: better an empty field
    // the invoice screen can ask them about than a wrong one it bills from.
    const declaredState =
      asState(state) || (gstinValue ? checkGstin(gstinValue).stateName : null);

    await pool.query(
      `INSERT INTO wholesaler_profiles
         (user_id, company_name, gstin, contact_phone, city, warehouse_state, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
      [userId, companyName, gstinValue, phone, city || null, declaredState],
    );

    res
      .status(200)
      .json({ message: "Successfully upgraded to a seller account!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error upgrading account" });
  }
};
