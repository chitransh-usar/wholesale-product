const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const normalizedRoles = new Set(allowedRoles.map((entry) => entry.toLowerCase()));
    const effectiveRoles = new Set([role.toLowerCase()]);

    if (role === "both") {
      effectiveRoles.add("seller");
      effectiveRoles.add("buyer");
    }

    const isAllowed = [...effectiveRoles].some((entry) => normalizedRoles.has(entry));
    if (!isAllowed) {
      return res.status(403).json({ success: false, message: "Forbidden: insufficient role permissions" });
    }

    next();
  };
};

module.exports = authorizeRoles;
