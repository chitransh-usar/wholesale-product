const express = require("express");
const multer = require("multer");
const importService = require("../services/importService");
const { KINDS } = require("../services/importFormat");
const { ZipWriter } = require("../services/zipWriter");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { businessId, requireOwner } = require("../middlewares/businessContext");

const router = express.Router();

/**
 * Bringing a book in from a file.
 *
 * THERE IS NO ID IN THESE ROUTES, and there must never be one. The book being
 * written to comes from `businessId(req)`, which reads the token. The export
 * side says the same thing for the same reason, and here it matters more:
 * that one hands a file out, this one writes rows in. An id from the request
 * would be one call that writes a year of invented sales into somebody else's
 * khata.
 *
 * OWNER ONLY, and not expressible as a permission, for the same reason the
 * export is: one upload writes customers, suppliers, purchases, sales and
 * bills at once, so any single permission gating it would quietly become all
 * of them. It sits on the settings screen beside the export.
 *
 * In memory, never to disk. A spreadsheet of somebody's customers has no
 * business sitting in an uploads folder after the request that carried it, and
 * the service reads a buffer anyway.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024, files: 1 },
});

router.use(authenticateToken, authorizeRoles("seller", "both"));

const fileFrom = (req) => {
  if (!req.file) {
    const err = new Error("No file arrived. Choose a .zip or a .csv and try again.");
    err.status = 400;
    throw err;
  }
  return { fileName: req.file.originalname, buffer: req.file.buffer };
};

const fail = (res, err) => {
  // A message a person can act on. Everything the service throws is already
  // written for somebody looking at a spreadsheet, so it is passed through;
  // anything else is a fault of ours and is not.
  const known = err.status || (err.message && !/[A-Z][a-z]+Error/.test(err.name) ? 400 : 500);
  if (known >= 500) console.error("Import failed:", err);
  res.status(known).json({
    success: false,
    message: known >= 500 ? "Something went wrong reading that file." : err.message,
  });
};

/** What this file would do. Writes nothing. */
router.post("/preview", requireOwner, upload.single("file"), async (req, res) => {
  try {
    const plan = await importService.preview(businessId(req), fileFrom(req));
    res.json({ success: true, plan });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Do it.
 *
 * The file is sent a second time rather than a preview being held on the
 * server between the two calls. Holding it would mean a store of other
 * people's customer lists sitting around waiting to be cleaned up, and the
 * plan is rebuilt inside the transaction anyway, because the book may have
 * moved since the preview and a plan made against a stale book is how an
 * import writes a duplicate.
 */
router.post("/commit", requireOwner, upload.single("file"), async (req, res) => {
  try {
    const result = await importService.apply(businessId(req), req.user?.id, fileFrom(req));
    res.json({ success: true, result });
  } catch (err) {
    fail(res, err);
  }
});

/** What has been brought in before, newest first. */
router.get("/", requireOwner, async (req, res) => {
  try {
    const pool = require("../config/db");
    const { rows } = await pool.query(
      `SELECT i.id, i.file_name, i.file_bytes, i.summary, i.status, i.created_at,
              u.first_name, u.last_name
         FROM imports i LEFT JOIN users u ON u.id = i.done_by
        WHERE i.wholesaler_id = $1
        ORDER BY i.created_at DESC
        LIMIT 50`,
      [businessId(req)],
    );
    res.json({ success: true, imports: rows });
  } catch (err) {
    // The table arrives with wholesale3_imports.sql. An empty list is the
    // right answer on a database that has not had it run yet.
    if (/relation "imports" does not exist/.test(err.message)) {
      return res.json({ success: true, imports: [] });
    }
    fail(res, err);
  }
});

/**
 * A blank workbook with the right headings.
 *
 * The single most useful thing this endpoint does. Somebody with a year of
 * sales in a spreadsheet does not need to be told the column names, they need
 * a file with the column names already in it that they can paste into.
 */
router.get("/template", requireOwner, (req, res) => {
  const zip = new ZipWriter();

  for (const [key, kind] of Object.entries(KINDS)) {
    const headers = Object.values(kind.fields).map((f) => f.column);
    zip.add(`data/${kind.files[0]}.csv`, `${headers.join(",")}\n`);
    void key;
  }

  zip.add(
    "how-to-fill-this-in.txt",
    [
      "FILLING THESE IN",
      "",
      "One spreadsheet per list. Leave out any list you have nothing for, and",
      "leave any column blank if you do not have it. Keep the first row as it is:",
      "it is how each column is recognised.",
      "",
      "Put them back in a zip and upload it, or upload one spreadsheet on its own.",
      "Save as CSV, not .xlsx.",
      "",
      "DATES ARE READ DAY FIRST.",
      "",
      "  03/04/2026 is the THIRD OF APRIL, not the fourth of March.",
      "",
      "2026-04-03 and 3 Apr 2026 also work and cannot be misread, so use one of",
      "those if you would rather be sure.",
      "",
      "AMOUNTS",
      "",
      "1,23,456.78 and Rs. 1,234 and 1234.50 all read the same. A cell holding",
      "N/A or a note is refused rather than read as zero, because a zero in a",
      "book of accounts is a figure and not an absence.",
      "",
      "WHAT IS NOT OVERWRITTEN",
      "",
      "A row that is already in your book is left exactly as it is and counted as",
      "skipped. Nothing you upload changes a record you already have. Customers",
      "are matched on phone number, then on name. Purchases are matched on the",
      "supplier and his bill number. Sales are matched on the sale number, bills",
      "on the bill number.",
      "",
      "OLD BILLS",
      "",
      "A bill brought in this way keeps the number it was issued under and is",
      "marked as a record of a bill raised elsewhere. It is never renumbered and",
      "never re-issued.",
      "",
      "Your own run of numbers carries on AFTER them, so the next bill you raise",
      "here cannot collide with one of these. The preview tells you what that",
      "next number will be before anything is written.",
      "",
      "A bill that already carries an IRN is refused. An IRN is issued by the",
      "Invoice Registration Portal and cannot be checked from a spreadsheet, so",
      "such a bill already exists on the portal and that is where it stands.",
      "Leave the IRN column empty to bring the bill in as a record.",
      "",
    ].join("\n"),
  );

  const buffer = zip.end();
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", "attachment; filename=import-template.zip");
  res.setHeader("Content-Length", buffer.length);
  res.status(200).send(buffer);
});

module.exports = router;
