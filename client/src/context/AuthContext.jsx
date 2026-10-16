import { createContext, useContext, useState, useEffect, useRef } from "react";
import api from "../utils/axios";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  /**
   * Whether this person owns the shop or works in it, and what they may do.
   *
   * Defaults to owner. Every account was an owner before staff existed, and a
   * default of "employee with no permissions" would blank the dashboard for
   * everybody the moment the server was older than the client.
   */
  const [staff, setStaff] = useState({
    isOwner: true,
    permissions: [],
    worksFor: null,
  });
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [isLoading, setIsLoading] = useState(true);
  /**
   * Set when the token is good but the server could not be reached. Different
   * from being logged out, and the difference matters: one is "try again",
   * the other is "sign in again".
   */
  const [unreachable, setUnreachable] = useState(false);

  // Which token has already been looked up, so the effect below and login()
  // do not both fetch. See the note in login().
  const fetchedFor = useRef(null);

  /**
   * Who is this?
   *
   * ONLY A 401 LOGS SOMEBODY OUT. This used to call logout() on any failure
   * at all, which meant a timeout on a phone's mobile data deleted a
   * perfectly good token. That is the bug behind "it said signed in
   * successfully and then nothing happened": login() awaited this, this
   * swallowed the error and wiped the token, login() resolved as though it
   * had worked, the success toast fired, and the reload afterwards found no
   * token. A network that drops one request must not end a session.
   */
  const fetchUser = async () => {
    try {
      const response = await api.get("/api/auth/me");
      setUser(response.data.user);
      if (response.data.staff) setStaff(response.data.staff);
      setUnreachable(false);
      return true;
    } catch (error) {
      if (error.response?.status === 401) {
        // The token really is no good: expired, or signed with a secret this
        // server no longer uses. Signing in again is the only way out.
        logout();
      } else {
        // Anything else is the server or the connection, not the session.
        // The token is kept, so a reload picks straight up again.
        console.error("Could not reach the server to load your account", error);
        setUnreachable(true);
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      fetchedFor.current = null;
      setIsLoading(false);
      return;
    }
    // Claimed by login() when it is the one that set the token, so the two do
    // not race. Two concurrent lookups was the other half of the bug: either
    // one failing used to wipe the token the other had just validated.
    if (fetchedFor.current === token) return;
    fetchedFor.current = token;
    void fetchUser();
  }, [token]);

  const login = async (newToken) => {
    localStorage.setItem("token", newToken);
    // Claimed before the state change so the effect above stands down and
    // this is the single lookup.
    fetchedFor.current = newToken;
    setToken(newToken);

    // Thrown rather than swallowed, so the sign in screen cannot announce
    // success for a session that did not start. It used to say "Signed in
    // successfully" and then send the person to a page that bounced them
    // straight back, with no hint that anything had gone wrong.
    const ok = await fetchUser();
    if (!ok) {
      const failed = new Error(
        "Signed in, but your account could not be loaded. Check your connection and try again.",
      );
      failed.code = "ACCOUNT_LOAD_FAILED";
      throw failed;
    }
  };

  const register = async (userData) => {
    const response = await api.post("/api/auth/register", userData);
    return response.data;
  };

  const logout = () => {
    localStorage.removeItem("token");
    fetchedFor.current = null;
    setToken(null);
    setUser(null);
    setUnreachable(false);
    setStaff({ isOwner: true, permissions: [], worksFor: null });
  };

  const upgradeAccount = async (sellerData) => {
    await api.post("/api/auth/upgrade", sellerData);
    await fetchUser();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        logout,
        upgradeAccount,
        staff,
        isOwner: staff.isOwner,
        /**
         * Whether this person may do one thing.
         *
         * An owner always may, so the server does not have to send them the
         * whole catalogue and a new permission does not have to be added in
         * two places to reach them.
         *
         * This hides buttons, it does not guard anything. Every route that
         * matters checks again on the server, which is the boundary.
         */
        can: (permission) =>
          staff.isOwner || staff.permissions.includes(permission),
        isAuthenticated: !!user,
        isLoading,
        // The token is held but the server did not answer. Lets a screen say
        // "could not reach the server" instead of pretending to be signed out.
        unreachable,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export { AuthContext };
