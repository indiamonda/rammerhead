/**
 * Minimal streaming ZIP writer with ZIP64 support.
 *
 * Used by the web-build-files feature to package crawled sites or local
 * source trees and stream them to the client without buffering the whole
 * archive in memory. Each entry's data must be passed as a Buffer (or
 * string), but entries are flushed to the wire one-at-a-time, so peak
 * memory stays at O(largest single file) rather than O(archive).
 *
 * Why hand-rolled instead of `archiver`/`yazl`: avoids adding a new
 * dependency to a project that prefers zero-dep utilities, and the format
 * we need (deflate, optional ZIP64) is small enough to stay readable.
 *
 * Supports archives and per-file sizes >4GB via ZIP64. UTF-8 filenames are
 * always written with the General Purpose Bit 11 flag set so non-ASCII
 * paths decode correctly in modern unzippers.
 */

const zlib = require('zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CDIR = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

const CRC32_TABLE = (() => {
    const tab = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        tab[n] = c >>> 0;
    }
    return tab;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function writeUInt64LE(buf, value, off) {
    // Node 14+ has BigInt64; we accept regular numbers up to 2^53 which
    // covers any practical archive size we'd actually produce.
    const big = typeof value === 'bigint' ? value : BigInt(value);
    buf.writeBigUInt64LE(big, off);
}

class ZipWriter {
    /**
     * @param {NodeJS.WritableStream} stream Destination — typically an
     *   http.ServerResponse. End-of-stream is the caller's responsibility
     *   only if `finish()` isn't called.
     * @param {object} [opts]
     * @param {number} [opts.compressLevel=6] zlib level 0-9; 0 forces STORED.
     */
    constructor(stream, opts = {}) {
        this.stream = stream;
        this.entries = [];
        this.offset = 0;
        this.compressLevel = typeof opts.compressLevel === 'number' ? opts.compressLevel : 6;
        this._finished = false;
    }

    _write(buf) {
        // Honour stream backpressure so a slow client doesn't blow up RAM.
        const ok = this.stream.write(buf);
        this.offset += buf.length;
        if (!ok) {
            return new Promise((resolve) => this.stream.once('drain', resolve));
        }
        return null;
    }

    /**
     * Add an entry to the archive. `name` should use forward slashes and
     * not start with a slash. Returns a Promise that resolves once the
     * entry has been flushed past any backpressure.
     *
     * @param {string} name Path inside the zip (e.g. "public/index.html").
     * @param {Buffer|string} data
     * @param {object} [opts]
     * @param {boolean} [opts.compress=true] Force STORED when false.
     */
    async add(name, data, opts = {}) {
        if (this._finished) throw new Error('ZipWriter: cannot add() after finish()');
        if (typeof data === 'string') data = Buffer.from(data, 'utf8');
        if (!Buffer.isBuffer(data)) throw new TypeError('ZipWriter.add: data must be Buffer or string');

        const utf8Name = Buffer.from(name.replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
        const crc = crc32(data);

        let method = 0;
        let payload = data;
        const wantCompress = opts.compress !== false && this.compressLevel > 0 && data.length > 64;
        if (wantCompress) {
            // deflateRaw — zip stores raw deflate, not zlib-wrapped.
            const compressed = zlib.deflateRawSync(data, { level: this.compressLevel });
            // Don't compress if it actually got bigger (already-compressed
            // formats like .png/.jpg/.zip).
            if (compressed.length < data.length) {
                payload = compressed;
                method = 8;
            }
        }

        const useZip64 = data.length > MAX32 || payload.length > MAX32 || this.offset > MAX32;

        const extra = useZip64 ? this._zip64ExtraLocal(data.length, payload.length) : Buffer.alloc(0);

        const local = Buffer.alloc(30);
        let p = 0;
        local.writeUInt32LE(SIG_LOCAL, p); p += 4;
        local.writeUInt16LE(useZip64 ? 45 : 20, p); p += 2;
        local.writeUInt16LE(1 << 11, p); p += 2;
        local.writeUInt16LE(method, p); p += 2;
        local.writeUInt16LE(0, p); p += 2;
        local.writeUInt16LE(0x21, p); p += 2;
        local.writeUInt32LE(crc, p); p += 4;
        local.writeUInt32LE(useZip64 ? MAX32 : payload.length, p); p += 4;
        local.writeUInt32LE(useZip64 ? MAX32 : data.length, p); p += 4;
        local.writeUInt16LE(utf8Name.length, p); p += 2;
        local.writeUInt16LE(extra.length, p); p += 2;

        const entry = {
            name: utf8Name,
            crc,
            method,
            compressedSize: payload.length,
            uncompressedSize: data.length,
            offset: this.offset
        };
        this.entries.push(entry);

        const back1 = this._write(local);
        if (back1) await back1;
        const back2 = this._write(utf8Name);
        if (back2) await back2;
        if (extra.length) {
            const back3 = this._write(extra);
            if (back3) await back3;
        }
        const back4 = this._write(payload);
        if (back4) await back4;
    }

    _zip64ExtraLocal(uncompressed, compressed) {
        // Local-header ZIP64 extra: tag (2) + size (2) + uncompressed (8) + compressed (8) = 20 bytes
        const buf = Buffer.alloc(20);
        let p = 0;
        buf.writeUInt16LE(0x0001, p); p += 2;
        buf.writeUInt16LE(16, p); p += 2;
        writeUInt64LE(buf, uncompressed, p); p += 8;
        writeUInt64LE(buf, compressed, p); p += 8;
        return buf;
    }

    _zip64ExtraCentral(e) {
        // Central-dir ZIP64 extra packs only the fields that overflowed.
        const fields = [];
        if (e.uncompressedSize > MAX32) fields.push(['uncompressed', e.uncompressedSize]);
        if (e.compressedSize > MAX32) fields.push(['compressed', e.compressedSize]);
        if (e.offset > MAX32) fields.push(['offset', e.offset]);
        if (!fields.length) return Buffer.alloc(0);
        const buf = Buffer.alloc(4 + fields.length * 8);
        let p = 0;
        buf.writeUInt16LE(0x0001, p); p += 2;
        buf.writeUInt16LE(fields.length * 8, p); p += 2;
        for (const [, v] of fields) { writeUInt64LE(buf, v, p); p += 8; }
        return buf;
    }

    /**
     * Flush central directory and end-of-central-directory records. After
     * calling this, no more entries can be added; the underlying stream is
     * closed via `.end()`.
     */
    async finish() {
        if (this._finished) return;
        this._finished = true;
        const cdStart = this.offset;
        let cdSize = 0;
        let needZip64 = false;

        for (const e of this.entries) {
            const extra = this._zip64ExtraCentral(e);
            if (extra.length) needZip64 = true;
            const hdr = Buffer.alloc(46);
            let p = 0;
            hdr.writeUInt32LE(SIG_CDIR, p); p += 4;
            hdr.writeUInt16LE(45, p); p += 2;
            hdr.writeUInt16LE(extra.length ? 45 : 20, p); p += 2;
            hdr.writeUInt16LE(1 << 11, p); p += 2;
            hdr.writeUInt16LE(e.method, p); p += 2;
            hdr.writeUInt16LE(0, p); p += 2;
            hdr.writeUInt16LE(0x21, p); p += 2;
            hdr.writeUInt32LE(e.crc, p); p += 4;
            hdr.writeUInt32LE(e.compressedSize > MAX32 ? MAX32 : e.compressedSize, p); p += 4;
            hdr.writeUInt32LE(e.uncompressedSize > MAX32 ? MAX32 : e.uncompressedSize, p); p += 4;
            hdr.writeUInt16LE(e.name.length, p); p += 2;
            hdr.writeUInt16LE(extra.length, p); p += 2;
            hdr.writeUInt16LE(0, p); p += 2;
            hdr.writeUInt16LE(0, p); p += 2;
            hdr.writeUInt16LE(0, p); p += 2;
            hdr.writeUInt32LE(0, p); p += 4;
            hdr.writeUInt32LE(e.offset > MAX32 ? MAX32 : e.offset, p); p += 4;

            const w1 = this._write(hdr); if (w1) await w1;
            const w2 = this._write(e.name); if (w2) await w2;
            if (extra.length) { const w3 = this._write(extra); if (w3) await w3; }
            cdSize += hdr.length + e.name.length + extra.length;
        }

        if (needZip64 || this.entries.length > MAX16 || cdSize > MAX32 || cdStart > MAX32) {
            // ZIP64 EOCD record (56 bytes for fixed part).
            const eocd64 = Buffer.alloc(56);
            let p = 0;
            eocd64.writeUInt32LE(SIG_EOCD64, p); p += 4;
            writeUInt64LE(eocd64, 44, p); p += 8;
            eocd64.writeUInt16LE(45, p); p += 2;
            eocd64.writeUInt16LE(45, p); p += 2;
            eocd64.writeUInt32LE(0, p); p += 4;
            eocd64.writeUInt32LE(0, p); p += 4;
            writeUInt64LE(eocd64, this.entries.length, p); p += 8;
            writeUInt64LE(eocd64, this.entries.length, p); p += 8;
            writeUInt64LE(eocd64, cdSize, p); p += 8;
            writeUInt64LE(eocd64, cdStart, p); p += 8;
            const eocd64Off = this.offset;
            const w = this._write(eocd64); if (w) await w;

            const loc = Buffer.alloc(20);
            p = 0;
            loc.writeUInt32LE(SIG_EOCD64_LOC, p); p += 4;
            loc.writeUInt32LE(0, p); p += 4;
            writeUInt64LE(loc, eocd64Off, p); p += 8;
            loc.writeUInt32LE(1, p); p += 4;
            const w2 = this._write(loc); if (w2) await w2;
        }

        const eocd = Buffer.alloc(22);
        let p = 0;
        eocd.writeUInt32LE(SIG_EOCD, p); p += 4;
        eocd.writeUInt16LE(0, p); p += 2;
        eocd.writeUInt16LE(0, p); p += 2;
        eocd.writeUInt16LE(this.entries.length > MAX16 ? MAX16 : this.entries.length, p); p += 2;
        eocd.writeUInt16LE(this.entries.length > MAX16 ? MAX16 : this.entries.length, p); p += 2;
        eocd.writeUInt32LE(cdSize > MAX32 ? MAX32 : cdSize, p); p += 4;
        eocd.writeUInt32LE(cdStart > MAX32 ? MAX32 : cdStart, p); p += 4;
        eocd.writeUInt16LE(0, p); p += 2;
        const w3 = this._write(eocd); if (w3) await w3;

        this.stream.end();
    }
}

module.exports = ZipWriter;
