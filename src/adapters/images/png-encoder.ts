/**
 * Tiny dependency-free PNG encoder (ADR-007 — no image codec in the serverless
 * runtime). It emits a valid 8-bit truecolour (RGB) PNG using a zlib "stored"
 * (uncompressed) deflate stream, so no native library (`sharp`/libvips) and no
 * WASM codec is ever loaded — both fail to trace/load in the Vercel serverless
 * bundle. The output is a genuine, decodable PNG (signature + IHDR + IDAT + IEND
 * with correct CRC32 and Adler-32), which is all the FAKE image model needs: real
 * magic bytes and real dimensions for technical validation and delivery.
 *
 * This encodes only — it never decodes or resizes. It stays inside
 * `src/adapters/images/**` (rule 12), though it depends on nothing but the runtime.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface EncodePngOptions {
  width: number;
  height: number;
  /** Returns the RGB colour of pixel (x, y). Called once per pixel. */
  pixel: (x: number, y: number) => Rgb;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Precomputed CRC-32 table (IEEE 802.3, the PNG polynomial).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32 checksum of the raw (uncompressed) zlib payload. */
function adler32(bytes: Uint8Array): number {
  const MOD = 65521;
  // Process in blocks so the sums never overflow before the modulo.
  const NMAX = 5552;
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < bytes.length) {
    const end = Math.min(i + NMAX, bytes.length);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wrap raw bytes in a zlib stream using only "stored" (uncompressed) blocks. */
function zlibStore(raw: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blockCount = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  // 2 zlib header bytes + per-block 5-byte header + payload + 4 Adler bytes.
  const out = new Uint8Array(2 + blockCount * 5 + raw.length + 4);
  let p = 0;
  // zlib header: CMF=0x78 (deflate, 32K window), FLG=0x01 → (0x78<<8|0x01) % 31 === 0.
  out[p++] = 0x78;
  out[p++] = 0x01;

  let offset = 0;
  do {
    const len = Math.min(MAX_BLOCK, raw.length - offset);
    const isFinal = offset + len >= raw.length ? 1 : 0;
    out[p++] = isFinal; // BFINAL bit + BTYPE=00 (stored)
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    const nlen = ~len & 0xffff;
    out[p++] = nlen & 0xff;
    out[p++] = (nlen >>> 8) & 0xff;
    out.set(raw.subarray(offset, offset + len), p);
    p += len;
    offset += len;
  } while (offset < raw.length);

  const adler = adler32(raw);
  out[p++] = (adler >>> 24) & 0xff;
  out[p++] = (adler >>> 16) & 0xff;
  out[p++] = (adler >>> 8) & 0xff;
  out[p++] = adler & 0xff;
  return out;
}

/** Assemble one PNG chunk: length + type + data + CRC(type+data). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typeAndData[i] = type.charCodeAt(i);
  typeAndData.set(data, 4);

  const out = new Uint8Array(4 + typeAndData.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeAndData, 4);
  view.setUint32(4 + typeAndData.length, crc32(typeAndData));
  return out;
}

/** Encode an RGB image to PNG bytes (8-bit, colour type 2, no interlace). */
export function encodePng(options: EncodePngOptions): Uint8Array {
  const { width, height, pixel } = options;

  // IHDR: width, height, bit depth 8, colour type 2 (truecolour RGB), the three
  // zero method/filter/interlace bytes.
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  // Raw scanlines: each row starts with a filter-type byte (0 = None), then RGB.
  const rowStride = 1 + width * 3;
  const raw = new Uint8Array(rowStride * height);
  for (let y = 0; y < height; y++) {
    let p = y * rowStride;
    raw[p++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const c = pixel(x, y);
      raw[p++] = c.r & 0xff;
      raw[p++] = c.g & 0xff;
      raw[p++] = c.b & 0xff;
    }
  }

  const idat = zlibStore(raw);

  const signature = new Uint8Array(PNG_SIGNATURE);
  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", idat);
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let p = 0;
  png.set(signature, p);
  p += signature.length;
  png.set(ihdrChunk, p);
  p += ihdrChunk.length;
  png.set(idatChunk, p);
  p += idatChunk.length;
  png.set(iendChunk, p);
  return png;
}
