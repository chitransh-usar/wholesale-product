/**
 * A ZIP file, written by hand.
 *
 * WHY NOT A LIBRARY. `archiver` would do this, and it is the obvious choice.
 * But the only thing needed here is putting a handful of files into one
 * download, and the format for that is about eighty lines: a header before each
 * file, a directory at the end, and a CRC of each one. Against that, a
 * dependency is a thing to keep updated, audit and carry on every deploy, on a
 * server whose package list is currently fourteen entries long and readable in
 * one glance.
 *
 * STORED, NOT DEFLATED. Compression method 0 means the bytes go in as they are.
 * A deflate implementation is a real piece of work and getting it subtly wrong
 * produces an archive that opens on the machine that wrote it and nowhere else.
 * The cost is size: the CSVs compress well and are going out uncompressed. That
 * is a fair trade for an export a wholesaler downloads occasionally, and if it
 * ever stops being fair, adding deflate here is a contained change.
 *
 * Every offset is little endian, which is what the format says.
 */

/**
 * CRC32, the checksum the ZIP directory carries for each file.
 *
 * The table is built once. Written out rather than pulled from `zlib` because
 * zlib.crc32 only arrived in Node 20.15 and this has to run wherever the
 * server is deployed.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * The date and time, in the shape DOS used in 1980 and ZIP still carries.
 *
 * Two packed 16 bit fields, and the seconds have one bit less than they need,
 * so the format can only record even seconds. Nothing depends on the value
 * being exact; it is what a file manager shows beside the name.
 */
const dosDateTime = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
};

/**
 * Builds one archive in memory.
 *
 * In memory on purpose, and that is the limit worth knowing: an export of a
 * few hundred bills is a few megabytes and fine, and an export of a hundred
 * thousand is not. The caller caps what it puts in. Streaming would lift the
 * cap and is the right change when somebody actually hits it.
 */
class ZipWriter {
  constructor() {
    this.entries = [];
    this.parts = [];
    this.offset = 0;
  }

  /**
   * @param {string} name     the path inside the archive, forward slashes
   * @param {Buffer|string} content
   */
  add(name, content) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    // Names are stored as UTF-8 and the flag at bit 11 says so, which is what
    // stops a name with a rupee sign or a Devanagari character arriving as
    // mojibake on a Windows machine.
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date } = dosDateTime();
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // no extra field

    this.entries.push({ nameBuf, crc, size: data.length, offset: this.offset, time, date });
    this.parts.push(local, nameBuf, data);
    this.offset += local.length + nameBuf.length + data.length;
    return this;
  }

  /** The finished archive. */
  end() {
    const central = [];
    let centralSize = 0;

    for (const e of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); // central directory header
      header.writeUInt16LE(20, 4); // version made by
      header.writeUInt16LE(20, 6); // version needed
      header.writeUInt16LE(0x0800, 8); // UTF-8 names
      header.writeUInt16LE(0, 10); // stored
      header.writeUInt16LE(e.time, 12);
      header.writeUInt16LE(e.date, 14);
      header.writeUInt32LE(e.crc, 16);
      header.writeUInt32LE(e.size, 20);
      header.writeUInt32LE(e.size, 24);
      header.writeUInt16LE(e.nameBuf.length, 28);
      header.writeUInt16LE(0, 30); // extra
      header.writeUInt16LE(0, 32); // comment
      header.writeUInt16LE(0, 34); // disk number
      header.writeUInt16LE(0, 36); // internal attributes
      header.writeUInt32LE(0, 38); // external attributes
      header.writeUInt32LE(e.offset, 42);
      central.push(header, e.nameBuf);
      centralSize += header.length + e.nameBuf.length;
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // end of central directory
    end.writeUInt16LE(0, 4); // this disk
    end.writeUInt16LE(0, 6); // disk with the directory
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(this.offset, 16);
    end.writeUInt16LE(0, 20); // no comment

    return Buffer.concat([...this.parts, ...central, end]);
  }
}

module.exports = { ZipWriter, crc32 };
