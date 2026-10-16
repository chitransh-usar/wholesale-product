const pool = require("../config/db");

/**
 * Is this person a platform admin?
 *
 * Read from the database on every admin request, not from the token.
 *
 * Putting the flag in the JWT would be cheaper and is the obvious thing to do,
 * and it is wrong here for two reasons. Tokens already issued would not carry
 * it, so nobody could be made an admin without signing out and in again. Worse,
 * taking the flag AWAY would not take effect until the token expired, which
 * means a revoked admin keeps every power they had for as long as their session
 * lasts. For a permission that edits the tax slabs and the state list, that is
 * not a trade worth making for one small query.
 *
 * The column arrives with wholesale3_platform_masters.sql. Until that has been
 * run the answer is no for everybody, which is the safe direction: the admin
 * screens are simply unreachable rather than open.
 */

let columnReady = null;

const hasAdminColumn = async (db = pool) => {
  if (columnReady !== null) return columnReady;
  try {
    const probe = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
            AND column_name = 'is_platform_admin'
       ) AS yes`,
    );
    columnReady = Boolean(probe.rows[0]?.yes);
  } catch {
    columnReady = false;
  }
  return columnReady;
};

const resetAdminColumn = () => { columnReady = null; };

/** True only if this user really carries the flag. */
const isPlatformAdmin = async (userId) => {
  if (!userId) return false;
  if (!(await hasAdminColumn())) return false;
  try {
    const found = await pool.query(
      "SELECT is_platform_admin FROM users WHERE id = $1",
      [userId],
    );
    return Boolean(found.rows[0]?.is_platform_admin);
  } catch (err) {
    console.error("Could not check platform admin:", err.message);
    return false;
  }
};

/**
 * Route guard. Deliberately says the same thing whether the person is not an
 * admin or the migration has not been run: an unauthorised caller learns
 * nothing about how the platform is configured from the refusal.
 */
const requirePlatformAdmin = async (req, res, next) => {
  if (await isPlatformAdmin(req.user?.id)) return next();
  return res.status(403).json({
    success: false,
    message: "This is a platform admin area.",
  });
};

module.exports = { requirePlatformAdmin, isPlatformAdmin, resetAdminColumn };
