// Byte-level JPEG / PNG inspection and lossless metadata stripping.

const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
// zigzag order mapping (DQT tables are stored in zigzag order)
const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

export const isJpeg = (b) => b && b[0] === 0xff && b[1] === 0xd8;
export const isPng = (b) => b && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

export function jpegSegments(b) {
  const segs = [];
  let i = 2;
  while (i < b.length - 1) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    segs.push({ marker: m, start: i, len: len + 2, data: b.subarray(i + 4, i + 2 + len) });
    if (m === 0xda) { segs.push({ marker: 'scan', start: i + 2 + len, len: b.length - (i + 2 + len) }); break; }
    i += 2 + len;
  }
  return segs;
}

export function inspectJpeg(b) {
  const segs = jpegSegments(b);
  const info = { progressive: false, baseline: false, components: 0, subsampling: '', quality: null, tables: [], markers: [], hasExif: false, hasXmp: false, hasIcc: false, hasIptc: false, comments: [], width: 0, height: 0 };
  const name = (m) => (m === 'scan' ? 'Image data' : m === 0xe0 ? 'APP0 (JFIF)' : m >= 0xe1 && m <= 0xef ? `APP${m - 0xe0}` : m === 0xdb ? 'DQT' : m === 0xc4 ? 'DHT' : m === 0xc0 ? 'SOF0 (baseline)' : m === 0xc1 ? 'SOF1' : m === 0xc2 ? 'SOF2 (progressive)' : m === 0xda ? 'SOS' : m === 0xfe ? 'COM' : m === 0xdd ? 'DRI' : '0x' + m.toString(16));
  for (const s of segs) {
    info.markers.push({ name: name(s.marker), size: s.len });
    const d = s.data;
    if (s.marker === 0xe1 && d) {
      const hdr = String.fromCharCode(...d.subarray(0, 28));
      if (hdr.startsWith('Exif')) info.hasExif = true;
      if (hdr.startsWith('http://ns.adobe.com/xap')) info.hasXmp = true;
    }
    if (s.marker === 0xe2 && d && String.fromCharCode(...d.subarray(0, 11)) === 'ICC_PROFILE') info.hasIcc = true;
    if (s.marker === 0xed) info.hasIptc = true;
    if (s.marker === 0xfe && d) info.comments.push(new TextDecoder().decode(d));
    if (s.marker === 0xc0 || s.marker === 0xc1 || s.marker === 0xc2) {
      info.progressive = s.marker === 0xc2;
      info.baseline = s.marker === 0xc0;
      info.height = (d[1] << 8) | d[2];
      info.width = (d[3] << 8) | d[4];
      info.components = d[5];
      const f = [];
      for (let k = 0; k < d[5]; k++) f.push([d[6 + k * 3 + 1] >> 4, d[6 + k * 3 + 1] & 15]);
      if (f.length >= 3) {
        const [h, v] = f[0];
        info.subsampling = h === 2 && v === 2 ? '4:2:0' : h === 2 && v === 1 ? '4:2:2' : h === 1 && v === 1 ? '4:4:4' : `${h}x${v}`;
      } else info.subsampling = 'grayscale';
    }
    if (s.marker === 0xdb && d) {
      let k = 0;
      while (k < d.length) {
        const pq = d[k] >> 4, tq = d[k] & 15;
        k++;
        const t = new Array(64);
        for (let j = 0; j < 64; j++) { t[ZZ[j]] = pq ? (d[k] << 8) | d[k + 1] : d[k]; k += pq ? 2 : 1; }
        info.tables[tq] = t;
      }
    }
  }
  if (info.tables[0]) {
    // estimate IJG quality by best fit against scaled standard luminance table
    let best = 0, bestErr = Infinity;
    for (let q = 1; q <= 100; q++) {
      const sc = q < 50 ? 5000 / q : 200 - q * 2;
      let err = 0;
      for (let j = 0; j < 64; j++) {
        const v = Math.min(255, Math.max(1, Math.floor((STD_LUMA[j] * sc + 50) / 100)));
        err += Math.abs(v - info.tables[0][j]);
      }
      if (err < bestErr) { bestErr = err; best = q; }
    }
    info.quality = best;
    info.qualityExact = bestErr === 0;
  }
  return info;
}

/** Remove metadata segments from a JPEG without re-encoding. keep: {icc, jfif} */
export function stripJpeg(b, { icc = true } = {}) {
  const segs = jpegSegments(b);
  const parts = [b.subarray(0, 2)];
  for (const s of segs) {
    if (s.marker === 'scan') { parts.push(b.subarray(s.start)); break; }
    const m = s.marker;
    const isIcc = m === 0xe2 && String.fromCharCode(...s.data.subarray(0, 11)) === 'ICC_PROFILE';
    const drop = (m >= 0xe1 && m <= 0xef && !(icc && isIcc)) || m === 0xfe;
    if (!drop) parts.push(b.subarray(s.start, s.start + s.len));
  }
  return concat(parts);
}

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
}
export function pngChunks(b) {
  const out = [];
  let i = 8;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i < b.length) {
    const len = dv.getUint32(i), type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    out.push({ type, start: i, len: len + 12, data: b.subarray(i + 8, i + 8 + len) });
    i += len + 12;
    if (type === 'IEND') break;
  }
  return out;
}
export function inspectPng(b) {
  const ch = pngChunks(b), ih = ch.find((c) => c.type === 'IHDR');
  const dv = new DataView(ih.data.buffer, ih.data.byteOffset, ih.data.byteLength);
  const ct = { 0: 'Grayscale', 2: 'RGB', 3: 'Indexed (palette)', 4: 'Grayscale + alpha', 6: 'RGBA' };
  const texts = ch.filter((c) => c.type === 'tEXt').map((c) => { const s = new TextDecoder('latin1').decode(c.data); const k = s.indexOf('\0'); return [s.slice(0, k), s.slice(k + 1)]; });
  return {
    width: dv.getUint32(0), height: dv.getUint32(4), bitDepth: ih.data[8], colorType: ct[ih.data[9]] || ih.data[9], interlaced: ih.data[12] === 1,
    chunks: ch.map((c) => ({ name: c.type, size: c.len })), texts, animated: ch.some((c) => c.type === 'acTL'),
  };
}
const META_PNG = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
export function stripPng(b) {
  return concat([b.subarray(0, 8), ...pngChunks(b).filter((c) => !META_PNG.has(c.type)).map((c) => b.subarray(c.start, c.start + c.len))]);
}
function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const _crc = crcTable;

export function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

export const isGif = (b) => b && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
/** Count frames in a GIF by walking its block structure. Returns 0 if not a valid GIF. */
export function gifFrameCount(b) {
  if (!isGif(b) || b.length < 13) return 0;
  let i = 13, frames = 0;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
  const skipSub = () => { while (i < b.length && b[i] !== 0) i += b[i] + 1; i++; };
  while (i < b.length) {
    const t = b[i];
    if (t === 0x3b) break;
    if (t === 0x21) { i += 2; skipSub(); }
    else if (t === 0x2c) {
      frames++;
      const packed = b[i + 9];
      i += 10;
      if (packed & 0x80) i += 3 * (1 << ((packed & 7) + 1));
      i++; // LZW min code size
      skipSub();
    } else break;
  }
  return frames;
}
