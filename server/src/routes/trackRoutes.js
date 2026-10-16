const express = require("express");
const { getLinkInfo, recordPing } = require("../controllers/driverLinkController");

// Public, token-authenticated routes for the driver's page. Deliberately
// outside the auth middleware: a driver has no account, and the token in the
// URL is the credential.
const router = express.Router();

router.get("/:token", getLinkInfo);
router.post("/:token/ping", recordPing);

module.exports = router;
