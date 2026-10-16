/**
 * Reading a CSV somebody else made.
 *
 * Writing one is easy. Reading one is not, because the file arriving here was
 * made by Excel on a Windows machine, or by Google Sheets, or by a Tally
 * export, or by our own exporter, and they disagree about nearly everything
 * except the comma.
 *
 * What this handles, and why each one is here rather than being clever:
 *
 *   quoted cells        a cell holding a comma, a quote or a LINE BREAK. Our
 *                       own export produces these: a terms and conditions
 *                       field has newlines in it, and splitting the file on
 *                       "\n" reads roughly double the rows. That is not a
 *                       hypothetical, it caught us in the export suite.
 *   "" inside a quote   the format's way of writing one quote.
 *   CRLF                Windows. Stripped, and never inside a quoted cell,
 *                       where a \r may be part of the value.
 *   a byte order mark   Excel puts one at the front of a UTF-8 CSV, and it
 *                       arrives glued to the first header, so `name` becomes
 *                       `﻿name` and never matches anything.
 *   a leading '         what a spreadsheet writes to mark a cell as text, and
 *                       what OUR export writes to defuse a formula. Stripped
 *                       on the way back in, so a round trip is clean.
 *
 * What it deliberately does NOT do: guess the delimiter, guess the encoding,
 * or repair a row with the wrong number of cells. Those are guesses, and this
 * file is a step on the way to writing somebody's books.
 */

/** Splits the text into rows of cells. Nothing is interpreted. */
const parse = (text) => {
  let input = String(text ?? "");
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let started = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // A trailing newline at the end of a file is not an empty final row, and a
    // blank line in the middle is not a row of one empty cell.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (ch === ",") {
      endCell();
      started = false;
      continue;
    }
    if (ch === "\r") {
      // Only ever a line ending out here. Inside a quoted cell it is data and
      // is handled above.
      if (input[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    cell += ch;
    started = true;
  }

  if (cell !== "" || row.length > 0) endRow();
  return rows;
};

/**
 * A header name, reduced to something two spreadsheets can agree on.
 *
 * `Business Name`, `business_name` and `BUSINESS NAME` are the same column to
 * a person and three different strings to a computer, so everything is folded
 * to lower case with the spaces, underscores, hyphens and dots taken out.
 */
const normaliseHeader = (name) =>
  String(name ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "");

/**
 * A value, as typed.
 *
 * The apostrophe our own exporter adds to defuse a formula comes off here, so
 * a book exported and imported again reads the same. Only when what follows it
 * is one of the characters we would have defused: an apostrophe somebody
 * genuinely typed at the front of a name stays.
 */
const clean = (value) => {
  let text = String(value ?? "").trim();
  if (/^'[=+\-@]/.test(text)) text = text.slice(1);
  return text;
};

/**
 * Rows to objects, keyed by normalised header.
 *
 * Returns the raw header row too, so an error can quote the column back to the
 * person in the spelling their own file used rather than in ours.
 *
 * A row with more cells than headers is an error, not something to truncate: it
 * usually means a delimiter inside an unquoted cell, and the values after it
 * have all shifted one column left.
 */
const toObjects = (text) => {
  const rows = parse(text);
  if (rows.length === 0) return { headers: [], rows: [], problems: [] };

  const rawHeaders = rows[0].map((h) => String(h ?? "").trim());
  const headers = rawHeaders.map(normaliseHeader);
  const problems = [];
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // A short row is ordinary: a spreadsheet stops writing commas once the
    // rest of the line is empty.
    if (cells.length > headers.length) {
      problems.push({
        line: i + 1,
        message: `This row has ${cells.length} values but the heading has ${headers.length} columns. A comma inside a value needs the value wrapped in quotes.`,
      });
      continue;
    }
    const record = { __line: i + 1 };
    headers.forEach((key, c) => {
      if (!key) return;
      record[key] = clean(cells[c]);
    });
    // A row where every cell is empty is the blank line at the bottom of
    // somebody's sheet, not a record of nothing.
    const anything = headers.some((key) => key && record[key] !== "");
    if (anything) out.push(record);
  }

  return { headers, rawHeaders, rows: out, problems };
};

/**
 * The first header present out of several spellings.
 *
 * Callers name the export's own column first and the friendly ones after, so a
 * file this product wrote is read by its real name and a file a person typed
 * is read by the name they would have used.
 */
const pick = (record, ...names) => {
  for (const name of names) {
    const key = normaliseHeader(name);
    if (record[key] !== undefined && record[key] !== "") return record[key];
  }
  return "";
};

module.exports = { parse, toObjects, normaliseHeader, clean, pick };
