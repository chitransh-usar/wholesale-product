const zlib = require("zlib");

/**
 * Reading a ZIP somebody else made.
 *
 * `zipWriter.js` writes one, stored. This reads one, and it has a harder job,
 * because the file arriving here was not made by us. Windows Explorer, macOS
 * Finder, 7-Zip and every spreadsheet that offers "download as zip" all
 * DEFLATE, so a reader that only understood stored entries would reject nearly
 * every real file while working perfectly on our own.
 *
 * Deflate is handled by `zlib`, which is built in. The rest is the directory
 * format, read the way a real unarchiver reads it: find the end record, walk
 * the central directory, and take each file's bytes from the offset it names.
 * The local headers are not trusted for sizes, because a file written by a
 * streaming writer carries zeroes there and puts the real numbers in a data
 * descriptor after the content.
 *
 * DELIBERATELY NOT SHARED with zipWriter. A reader built out of the writer's
 * own assumptions agrees with it about a malformed archive, and the whole
 * point of this one is to be handed files we did not write.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * Guard rails, because this is an upload.
 *
 * A zip bomb is a small file that decompresses to something that fills the
 * server's memory. Both limits are generous for a book of accounts and small
 * enough that a malicious file dies rather than the process.
 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 512;

const findEnd = (buf) => {
  // The end record is 22 bytes plus a comment of up to 64k, so it is near the
  // back but not always at it.
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let at = buf.length - 22; at >= earliest; at--) {
    if (buf.readUInt32LE(at) === EOCD) return at;
  }
  return -1;
};

/**
 * Every file in the archive, as { name -> Buffer }.
 *
 * Directory entries are skipped. So is anything whose name climbs out of the
 * archive: a member called `../../etc/passwd` is a real attack on any code
 * that writes what it reads to disk, and although this reader hands back
 * buffers rather than writing files, refusing it here means no future caller
 * can reintroduce the hole by accident.
 */
const read = (buffer) => {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 22) throw new Error("That file is too small to be a zip.");

  const end = findEnd(buf);
  if (end < 0) {
    throw new Error(
      "That does not look like a zip file. If you meant to send one spreadsheet, send the .csv itself.",
    );
  }

  const count = buf.readUInt16LE(end + 10);
  if (count > MAX_ENTRIES) {
    throw new Error(`That zip holds ${count} files. The most this will read is ${MAX_ENTRIES}.`);
  }

  let at = buf.readUInt32LE(end + 16);
  const files = new Map();
  let totalOut = 0;

  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL) {
      throw new Error("That zip file is damaged. Its index does not line up with its contents.");
    }

    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const uncompressedSize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.slice(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (name.startsWith("/") || name.split("/").includes("..")) {
      throw new Error(`That zip holds a file with an unsafe name: ${name}`);
    }
    // What macOS puts in a zip it makes. Not data, and confusing in a preview.
    if (name.startsWith("__MACOSX/") || name.split("/").pop().startsWith("._")) continue;

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error(`${name} is too big to read. The limit is ${MAX_ENTRY_BYTES / 1024 / 1024}MB.`);
    }
    totalOut += uncompressedSize;
    if (totalOut > MAX_TOTAL_BYTES) {
      throw new Error("That zip unpacks to more than this will read at once.");
    }

    if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== LOCAL) {
      throw new Error(`That zip file is damaged. ${name} is not where its index says.`);
    }
    // From the LOCAL header, because a zip written in a stream has different
    // name and extra lengths here than in the directory.
    const localNameLen = buf.readUInt16LE(offset + 26);
    const localExtraLen = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLen + localExtraLen;
    const raw = buf.slice(start, start + compressedSize);

    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch (err) {
        throw new Error(`${name} could not be unpacked: ${err.message}`);
      }
    } else {
      throw new Error(
        `${name} is packed in a way this cannot read (method ${method}). Make the zip again with ordinary compression.`,
      );
    }

    files.set(name, data);
  }

  if (files.size === 0) throw new Error("That zip is empty.");
  return files;
};

module.exports = { read, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES, MAX_ENTRIES };
