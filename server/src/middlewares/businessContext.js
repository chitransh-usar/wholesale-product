const pool = require("../config/db");
const { can } = require("../services/staffAccess");

/**
 * Works out whose book this request is acting on, and what the person may do.
 *
 * Sets `req.business`:
 *
 *   { id, isOwner, staffId, name, permissions }
 *
 * `id` is the wholesaler. For an owner it is their own id, which is why the
 * distinction was invisible before and why `req.user.id` was doing both jobs.
 * For an employee it is their employer's, and that one substitution is what
 * turns every seller screen into their employer's book rather than an empty one
 * of their own.
 *
 * Runs after authenticateToken and needs nothing from the route. Controllers
 * read `businessId(req)` rather than `req.user.id` wherever they mean the
 * business; where they genuinely mean the person, notifications, messages, the
 * name against a history row, they keep reading `req.user.id`.
 */

// The table arrives with wholesale3_staff_accounts.sql. Until it has been run
// every request resolves as its own owner, which is exactly how the product
// behaved before staff existed. Cached, because this runs on every request.
let hasStaffTable = null;
const staffTableExists = async (client = pool) => {
  if (hasStaffTable !== null) return hasStaffTable;
  try {
    const { rows } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'staff_members'
       ) AS yes`,
    );
    hasStaffTable = rows[0].yes === true;
  } catch {
    hasStaffTable = false;
  }
  return hasStaffTable;
};

// Tests build a fresh database per run, so they need to forget.
const resetStaffTable = () => {
  hasStaffTable = null;
};

const ownBusiness = (userId) => ({
  id: userId,
  isOwner: true,
  staffId: null,
  name: null,
  permissions: [],
});

const resolveBusiness = async (req, res, next) => {
  const userId = req.user?.id;
  if (!userId) return next();

  try {
    if (!(await staffTableExists())) {
      req.business = ownBusiness(userId);
      return next();
    }

    // Any employment, not only a live one. The difference matters: somebody
    // who has been turned off is not the same as somebody who was never staff.
    // Resolving them as their own owner would hand a sacked employee a working
    // seller dashboard, empty but their, which is a confusing way to be
    // dismissed and an odd thing for the product to do.
    const { rows } = await pool.query(
      `SELECT id, wholesaler_id, name, permissions, status
         FROM staff_members
        WHERE user_id = $1
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END
        LIMIT 1`,
      [userId],
    );

    if (rows.length === 0) {
      req.business = ownBusiness(userId);
      return next();
    }

    const staff = rows[0];

    if (staff.status !== "active") {
      req.business = {
        id: null,
        isOwner: false,
        blocked: true,
        staffId: staff.id,
        name: staff.name,
        permissions: [],
      };
      return next();
    }

    req.business = {
      id: staff.wholesaler_id,
      isOwner: false,
      blocked: false,
      staffId: staff.id,
      name: staff.name,
      permissions: Array.isArray(staff.permissions) ? staff.permissions : [],
    };

    // Useful to the owner, and the only way they can tell a login has gone
    // stale. Never awaited: a write to a bookkeeping column must not hold up
    // the request, and losing one is worth nothing.
    pool
      .query(
        `UPDATE staff_members SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [staff.id],
      )
      .catch(() => {});

    return next();
  } catch (err) {
    // Falling back to "their own business" is the safe failure. It shows an
    // owner their own book, and shows an employee an empty one, which is
    // confusing but harmless. The alternative, guessing an employer, is not.
    console.warn("Could not resolve the business for this request:", err.message);
    req.business = ownBusiness(userId);
    return next();
  }
};

/**
 * The wholesaler this request is acting for.
 *
 * Falls back to the person when the middleware has not run, so a route that
 * forgets to mount it behaves exactly as it did before staff existed rather
 * than reading undefined and quietly matching nothing.
 */
const businessId = (req) => {
  // A turned off employee has no business, and must not fall back to themselves:
  // that is what would give them their own empty seller dashboard. Null here
  // matches no rows anywhere, and the two gates below refuse them outright.
  if (req.business?.blocked) return null;
  return req.business?.id || req.user?.id || null;
};

/**
 * Route guard for one permission.
 *
 *   router.post("/", authenticateToken, requirePermission("sales"), createSale)
 *
 * Deliberately a 403 with a message a person can read, not a redirect. The
 * client hides what an employee cannot do, so reaching this means either a
 * stale screen or somebody trying the endpoint directly.
 *
 * A 403 does not clear the token; utils/axios only does that on a 401. An
 * employee who touches something they may not touch stays signed in.
 */
const BLOCKED_MESSAGE =
  "Your access to this shop has been turned off. Ask the owner to turn it back on.";

const requirePermission = (permission) => (req, res, next) => {
  if (req.business?.blocked) {
    return res.status(403).json({ success: false, code: "ACCESS_OFF", message: BLOCKED_MESSAGE });
  }
  if (can(req.business, permission)) return next();
  return res.status(403).json({
    success: false,
    code: "NOT_ALLOWED",
    message: `Your account is not allowed to do this. Ask ${
      req.business?.isOwner ? "an administrator" : "the owner"
    } to turn it on for you.`,
  });
};

/**
 * Route guard for the things only an owner may ever do: business settings, the
 * GST number, the UPI id, and managing staff. Not expressible as a permission,
 * because it must not be grantable.
 */
const requireOwner = (req, res, next) => {
  if (req.business?.blocked) {
    return res.status(403).json({ success: false, code: "ACCESS_OFF", message: BLOCKED_MESSAGE });
  }
  if (req.business?.isOwner) return next();
  return res.status(403).json({
    success: false,
    code: "OWNER_ONLY",
    message: "Only the owner can change this.",
  });
};

module.exports = {
  resolveBusiness,
  resetStaffTable,
  businessId,
  requirePermission,
  requireOwner,
};
