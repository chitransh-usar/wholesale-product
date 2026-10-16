const jwt = require("jsonwebtoken");
const { resolveBusiness } = require("./businessContext");

/**
 * Refused at the door, and told WHY.
 *
 * Every failure here used to come back as one sentence, "Invalid or expired
 * token", which merges three quite different problems into a single dead end:
 *
 *   - no token was sent at all, which is a client or a CORS problem
 *   - the token expired, which is JWT_EXPIRES_IN or simply time passing
 *   - the signature does not check out, which means the token was signed with
 *     a different JWT_SECRET than this process is holding
 *
 * The third is the one worth naming. It is what a freshly issued token does
 * when the server that signed it and the server verifying it disagree about
 * the secret: two instances configured differently, or a secret rotated while
 * somebody was signed in. It looks exactly like an expiry from the outside
 * and is fixed in a completely different place.
 *
 * The code goes to the client, which already knows its own token failed, so
 * nothing is leaked by saying which way. The reason is also logged, because
 * on a hosted server the logs are the only place anybody can see it.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  // The token stays in the Authorization header. Accepting it from the query
  // string would leak it into server access logs, browser history and Referer
  // headers; downloads send it through the axios instance instead.
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      code: "NO_TOKEN",
      message: "No token provided",
    });
  }

  if (!process.env.JWT_SECRET) {
    // Not a 401. Nothing the caller did is wrong, and a server that cannot
    // verify anything should not be quietly telling everybody their session
    // is bad.
    console.error("JWT_SECRET is not set: no token can be verified.");
    return res.status(500).json({
      code: "JWT_SECRET_MISSING",
      message: "This server is not configured to check sign ins.",
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      const expired = err.name === "TokenExpiredError";
      if (!expired) {
        // Loud on purpose. A signature failure on a token this server issued
        // minutes ago is a configuration fault, not a user having been away
        // too long, and it will otherwise be read as an ordinary logout.
        console.error(
          `Token rejected (${err.name}): ${err.message}. If this is happening to freshly issued tokens, JWT_SECRET differs between the process that signed and the one verifying.`,
        );
      }
      return res.status(401).json({
        code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
        message: expired
          ? "Your sign in has expired. Please sign in again."
          : "That sign in could not be verified. Please sign in again.",
      });
    }
    req.user = decoded;
    // Whose book this request is acting on. Chained here rather than mounted
    // route by route so it cannot be forgotten: every authenticated request
    // has a business, and a seller route that reads req.user.id where it means
    // the wholesaler is then a visible mistake rather than a silent one.
    resolveBusiness(req, res, next);
  });
};

module.exports = authenticateToken;
