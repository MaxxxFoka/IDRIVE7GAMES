'use strict';
/**
 * textures.js - pictures for games: a game's `.tex` file loaded once and handed to the renderer.
 *
 *   const tx = new Textures(record)          // record = the kit's record.js (setImage)
 *   const t = tx.load('/path/to/car.tex')    // -> { id, w, h } (cached), or null when it is missing
 *   cv.image(t.id, x, y, w, h)               // drawn filtered, with alpha (the GPU renderer)
 *
 * A .tex file is gzip of: 'TEX1', u32 LE width, u32 LE height, then width x height straight RGBA,
 * rows top-down. Up to 1024 px a side (the car's renderer); the renderer holds at most 64 pictures
 * and 32 MB per app, so keep a game's set small (a few MB).
 */
const fs = require('fs');
const zlib = require('zlib');

const MAX_SIDE = 1024, MAX_COUNT = 48;

class Textures {
    constructor(record, log) { this.rec = record; this.log = log; this.byPath = new Map(); this.next = 0x5000; }
    load(file) {
        if (this.byPath.has(file)) return this.byPath.get(file);
        let t = null;
        try {
            if (this.byPath.size >= MAX_COUNT) throw new Error('too many textures');
            const b = zlib.gunzipSync(fs.readFileSync(file));
            if (b.toString('latin1', 0, 4) !== 'TEX1') throw new Error('not a TEX1 file');
            const w = b.readUInt32LE(4), h = b.readUInt32LE(8);
            if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE) || b.length < 12 + w * h * 4) throw new Error('bad size ' + w + 'x' + h);
            const id = this.next++;
            this.rec.setImage(id, w, h, new Uint8Array(b.buffer, b.byteOffset + 12, w * h * 4));
            t = { id, w, h };
        } catch (e) { if (this.log) this.log.warn('texture ' + file + ': ' + (e.message || e)); }
        this.byPath.set(file, t);
        return t;
    }
}

/** Encode straight RGBA (Buffer or Uint8Array) as a .tex file's bytes (for the generators). */
function encode(w, h, rgba) {
    const head = Buffer.alloc(12);
    head.write('TEX1', 0, 'latin1'); head.writeUInt32LE(w, 4); head.writeUInt32LE(h, 8);
    return zlib.gzipSync(Buffer.concat([head, Buffer.from(rgba.buffer || rgba, rgba.byteOffset || 0, w * h * 4)]), { level: 9 });
}

module.exports = { Textures, encode, MAX_SIDE };
