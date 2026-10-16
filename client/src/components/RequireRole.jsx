import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

/**
 * Route guard. Renders `children` only when the signed-in user holds one of
 * `roles`; "both" satisfies either "buyer" or "seller".
 *
 * This is a convenience layer, not the security boundary - every protected API
 * route carries its own authorizeRoles check. It exists so a retailer sees a
 * clear redirect instead of an empty dashboard full of 403s.
 */
const RequireRole = ({ roles = [], children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const warned = useRef(false);

  const role = user?.role;
  const allowed =
    !!role &&
    (roles.includes(role) ||
      (role === "both" && roles.some((r) => r === "seller" || r === "buyer")));

  useEffect(() => {
    if (!isLoading && user && !allowed && !warned.current) {
      warned.current = true;
      toast.error("That area is for wholesalers only");
    }
  }, [isLoading, user, allowed]);

  // Auth state is restored asynchronously; redirecting early would bounce a
  // signed-in seller out to the login page on every refresh.
  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (!allowed) return <Navigate to="/" replace />;

  return children;
};

export default RequireRole;
