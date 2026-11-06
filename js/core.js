// Core imaging primitives: canvases, pixel loops, blur, convolution, sampling, color math, noise, quantization.

export const clamp = (v, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/* ---------------- canvases ---------------- */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const g2d = (c) => c.getContext('2d', { willReadFrequently: true });
export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  g2d(c).drawImage(src, 0, 0);
  return c;
}
export const readData = (c) => g2d(c).getImageData(0, 0, c.width, c.height);
export function writeData(d) {
  const c = makeCanvas(d.width, d.height);
  g2d(c).putImageData(d, 0, 0);
  return c;
}
export function draw(w, h, fn) {
  const c = makeCanvas(w, h);
  const x = g2d(c);
  fn(x, c);
  return c;
}
/** Run fn(dataArray, index) on every pixel of a copy of src. */
export function perPixel(src, fn) {
  const d = readData(src);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) fn(a, i);
  return writeData(d);
}
export function makeLut(fn) {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = fn(i);
  return t;
}
export function applyLut(src, r, g = r, b = r) {
  return perPixel(src, (a, i) => {
    a[i] = r[a[i]];
    a[i + 1] = g[a[i + 1]];
    a[i + 2] = b[a[i + 2]];
  });
}
/** Mix two canvases of equal size: out = a*(1-t) + b*t where t may be a per-pixel Float32Array (0..1). */
export function mix(a, b, t) {
  const da = readData(a), db = readData(b);
  const x = da.data, y = db.data;
  const per = typeof t !== 'number';
  for (let i = 0, j = 0; i < x.length; i += 4, j++) {
    const k = per ? t[j] : t;
    if (k === 0) continue;
    x[i] += (y[i] - x[i]) * k;
    x[i + 1] += (y[i + 1] - x[i + 1]) * k;
    x[i + 2] += (y[i + 2] - x[i + 2]) * k;
    x[i + 3] += (y[i + 3] - x[i + 3]) * k;
  }
  return writeData(da);
}
/** Composite `top` on `base` with a canvas blend mode & opacity; preserves base alpha. */
export function blend(base, top, mode = 'source-over', opacity = 1) {
  return draw(base.width, base.height, (x) => {
    x.drawImage(base, 0, 0);
    x.globalAlpha = opacity;
    x.globalCompositeOperation = mode;
    x.drawImage(top, 0, 0, base.width, base.height);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(base, 0, 0);
  });
}
export function fillColor(base, color, mode = 'source-over', opacity = 1) {
  return draw(base.width, base.height, (x) => {
    x.drawImage(base, 0, 0);
    x.globalAlpha = opacity;
    x.globalCompositeOperation = mode;
    x.fillStyle = color;
    x.fillRect(0, 0, base.width, base.height);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(base, 0, 0);
  });
}
export function resizeCanvas(src, w, h, smooth = true) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (!smooth) {
    return draw(w, h, (x) => {
      x.imageSmoothingEnabled = false;
      x.drawImage(src, 0, 0, w, h);
    });
  }
  // progressive halving for quality downscale
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const c = cur;
    cur = draw(Math.round(c.width / 2), Math.round(c.height / 2), (x) => {
      x.imageSmoothingQuality = 'high';
      x.drawImage(c, 0, 0, Math.round(c.width / 2), Math.round(c.height / 2));
    });
  }
  return draw(w, h, (x) => {
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, w, h);
  });
}

/* ---------------- blur ---------------- */
function boxPass(src, dst, w, h, r, horizontal) {
  const iarr = 1 / (2 * r + 1);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 4 : w * 4;
  const last = len - 1;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4;
    for (let c = 0; c < 4; c++) {
      const b = base + c;
      let val = 0;
      for (let k = -r; k <= r; k++) val += src[b + (k < 0 ? 0 : k > last ? last : k) * stride];
      for (let x = 0; x < len; x++) {
        dst[b + x * stride] = val * iarr;
        const add = x + r + 1, rem = x - r;
        val += src[b + (add > last ? last : add) * stride] - src[b + (rem < 0 ? 0 : rem) * stride];
      }
    }
  }
}
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}
/** Gaussian-ish blur on Float32 RGBA buffer, in place-ish; returns Float32Array. */
export function blurFloat(arr, w, h, sigma) {
  if (sigma < 0.4) return arr;
  let a = arr, b = new Float32Array(arr.length);
  for (const s of boxesForGauss(sigma, 3)) {
    const r = Math.max(0, (s - 1) / 2) | 0;
    if (!r) continue;
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }
  return a;
}
export function blurData(d, sigma) {
  const out = new ImageData(d.width, d.height);
  out.data.set(blurFloat(Float32Array.from(d.data), d.width, d.height, sigma));
  return out;
}
export function blur(src, sigma) {
  if (sigma < 0.4) return cloneCanvas(src);
  // large radii: blur a downscaled copy for speed, then upscale
  if (sigma > 24) {
    const f = Math.min(8, sigma / 12);
    const small = resizeCanvas(src, src.width / f, src.height / f);
    const b = writeData(blurData(readData(small), sigma / f));
    return draw(src.width, src.height, (x) => {
      x.imageSmoothingQuality = 'high';
      x.drawImage(b, 0, 0, src.width, src.height);
    });
  }
  return writeData(blurData(readData(src), sigma));
}
/** Blur a single-channel Float32 map. */
export function blurMap(map, w, h, sigma) {
  const rgba = new Float32Array(w * h * 4);
  for (let j = 0; j < map.length; j++) rgba[j * 4] = map[j];
  const b = blurFloat(rgba, w, h, sigma);
  const out = new Float32Array(w * h);
  for (let j = 0; j < out.length; j++) out[j] = b[j * 4];
  return out;
}

/* ---------------- convolution / edges ---------------- */
export function convolve(src, k, { divisor, offset = 0, gray = false } = {}) {
  const d = readData(src), s = d.data, w = d.width, h = d.height;
  const out = new ImageData(w, h), o = out.data;
  const size = Math.round(Math.sqrt(k.length)), half = (size - 1) / 2;
  const div = divisor ?? (k.reduce((a, b) => a + b, 0) || 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, ki = 0;
      for (let ky = -half; ky <= half; ky++) {
        const yy = clamp(y + ky, 0, h - 1);
        for (let kx = -half; kx <= half; kx++, ki++) {
          const xx = clamp(x + kx, 0, w - 1);
          const p = (yy * w + xx) * 4, kv = k[ki];
          r += s[p] * kv; g += s[p + 1] * kv; b += s[p + 2] * kv;
        }
      }
      const i = (y * w + x) * 4;
      if (gray) {
        const v = luma(r, g, b) / div + offset;
        o[i] = o[i + 1] = o[i + 2] = v;
      } else {
        o[i] = r / div + offset; o[i + 1] = g / div + offset; o[i + 2] = b / div + offset;
      }
      o[i + 3] = s[i + 3];
    }
  }
  return writeData(out);
}
export function grayArray(d) {
  const a = d.data, g = new Float32Array(d.width * d.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
  return g;
}
/** Sobel magnitude (0..~1442) and angle arrays from a gray Float32Array. */
export function sobel(g, w, h) {
  const mag = new Float32Array(w * h), ang = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : w - 1;
      const tl = g[y0 * w + x0], t = g[y0 * w + x], tr = g[y0 * w + x1];
      const l = g[y * w + x0], r = g[y * w + x1];
      const bl = g[y1 * w + x0], b = g[y1 * w + x], br = g[y1 * w + x1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      ang[y * w + x] = Math.atan2(gy, gx);
    }
  }
  return { mag, ang };
}

/* ---------------- median (Huang sliding histogram) ---------------- */
export function median(src, r) {
  r = Math.max(1, Math.round(r));
  const d = readData(src), s = d.data, w = d.width, h = d.height;
  const out = new ImageData(w, h), o = out.data;
  const hist = new Int32Array(256);
  const N = (2 * r + 1) * (2 * r + 1), half = N >> 1;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      for (let dy = -r; dy <= r; dy++) {
        const yy = clamp(y + dy, 0, h - 1) * w;
        for (let dx = -r; dx <= r; dx++) hist[s[(yy + clamp(dx, 0, w - 1)) * 4 + c]]++;
      }
      let m = 0, ltm = 0;
      while (ltm + hist[m] <= half) { ltm += hist[m]; m++; }
      for (let x = 0; x < w; x++) {
        o[(y * w + x) * 4 + c] = m;
        if (x === w - 1) break;
        const xr = clamp(x - r, 0, w - 1), xa = clamp(x + r + 1, 0, w - 1);
        for (let dy = -r; dy <= r; dy++) {
          const yy = clamp(y + dy, 0, h - 1) * w;
          const vr = s[(yy + xr) * 4 + c], va = s[(yy + xa) * 4 + c];
          hist[vr]--; if (vr < m) ltm--;
          hist[va]++; if (va < m) ltm++;
        }
        while (ltm > half) { m--; ltm -= hist[m]; }
        while (ltm + hist[m] <= half) { ltm += hist[m]; m++; }
      }
    }
  }
  for (let i = 3; i < o.length; i += 4) o[i] = s[i];
  return writeData(out);
}

/* ---------------- sampling / remap ---------------- */
function sampleBilinear(s, w, h, x, y, o, oi, edge) {
  if (edge === 'wrap') { x = ((x % w) + w) % w; y = ((y % h) + h) % h; }
  else if (edge === 'mirror') {
    const mw = 2 * w, mh = 2 * h;
    x = ((x % mw) + mw) % mw; y = ((y % mh) + mh) % mh;
    if (x >= w) x = mw - x - 1; if (y >= h) y = mh - y - 1;
  } else if (edge === 'transparent' && (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5)) {
    o[oi] = o[oi + 1] = o[oi + 2] = o[oi + 3] = 0; return;
  }
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const x0 = x | 0, y0 = y | 0, x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
  for (let k = 0; k < 4; k++) {
    const top = s[a + k] + (s[b + k] - s[a + k]) * fx;
    const bot = s[c + k] + (s[d + k] - s[c + k]) * fx;
    o[oi + k] = top + (bot - top) * fy;
  }
}
/** fn(x, y, p) must set p[0], p[1] to the source coordinates for output pixel (x,y). */
export function remap(src, fn, edge = 'clamp', outW, outH) {
  const d = readData(src), s = d.data, w = d.width, h = d.height;
  const W = outW || w, H = outH || h;
  const out = new ImageData(W, H), o = out.data, p = [0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      p[0] = x; p[1] = y;
      fn(x, y, p);
      sampleBilinear(s, w, h, p[0], p[1], o, (y * W + x) * 4, edge);
    }
  }
  return writeData(out);
}
/** Average N samples along offsets produced by fn(x,y,t,p) for t in [0,1]. */
export function multiSample(src, n, fn) {
  const d = readData(src), s = d.data, w = d.width, h = d.height;
  const out = new ImageData(w, h), o = out.data, p = [0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < n; k++) {
        fn(x, y, n === 1 ? 0.5 : k / (n - 1), p);
        const sx = clamp(Math.round(p[0]), 0, w - 1), sy = clamp(Math.round(p[1]), 0, h - 1);
        const i = (sy * w + sx) * 4;
        r += s[i]; g += s[i + 1]; b += s[i + 2]; a += s[i + 3];
      }
      const i = (y * w + x) * 4;
      o[i] = r / n; o[i + 1] = g / n; o[i + 2] = b / n; o[i + 3] = a / n;
    }
  }
  return writeData(out);
}

/* ---------------- color ---------------- */
export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('');
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
export function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
/** Build a 256-entry RGB gradient lookup from color stops [[pos0..1, '#hex'], ...]. */
export function gradientLut(stops) {
  const st = stops.map(([p, c]) => [p, hexToRgb(c)]).sort((a, b) => a[0] - b[0]);
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < st.length - 2 && t > st[k + 1][0]) k++;
    const [p0, c0] = st[k], [p1, c1] = st[Math.min(k + 1, st.length - 1)];
    const f = p1 === p0 ? 0 : clamp((t - p0) / (p1 - p0), 0, 1);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  return out;
}
export function gradientMap(src, stops, amount = 1) {
  const L = gradientLut(stops);
  return perPixel(src, (a, i) => {
    const v = Math.round(luma(a[i], a[i + 1], a[i + 2])) * 3;
    a[i] += (L[v] - a[i]) * amount;
    a[i + 1] += (L[v + 1] - a[i + 1]) * amount;
    a[i + 2] += (L[v + 2] - a[i + 2]) * amount;
  });
}
export function histogram(d) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0) continue;
    r[a[i]]++; g[a[i + 1]]++; b[a[i + 2]]++;
    l[Math.round(luma(a[i], a[i + 1], a[i + 2]))]++;
  }
  return { r, g, b, l };
}
export function percentile(hist, p) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
  return 255;
}

/* ---------------- random / noise ---------------- */
export function rng(seed = 1) {
  let t = (seed >>> 0) + 0x6d2b79f5;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, octaves = 4, seed = 0) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += valueNoise(x * f, y * f, seed + o * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return v / norm;
}

/* ---------------- quantization ---------------- */
export function samplePixels(d, max = 20000) {
  const a = d.data, n = a.length / 4, step = Math.max(1, Math.floor(n / max)), out = [];
  for (let j = 0; j < n; j += step) {
    const i = j * 4;
    if (a[i + 3] < 128) continue;
    out.push([a[i], a[i + 1], a[i + 2]]);
  }
  return out;
}
export function medianCut(pixels, n) {
  if (!pixels.length) return [[0, 0, 0]];
  let boxes = [pixels];
  while (boxes.length < n) {
    let bi = -1, best = -1, ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        for (const p of b) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; }
        const score = (mx - mn) * Math.sqrt(b.length);
        if (score > best) { best = score; bi = i; ch = c; }
      }
    });
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map((v) => Math.round(v / b.length));
  });
}
export function kmeans(pixels, k, iters = 12, seed = 7) {
  const rand = rng(seed);
  if (!pixels.length) return [];
  const cents = [pixels[Math.floor(rand() * pixels.length)].slice()];
  while (cents.length < k) {
    // k-means++ init
    const dists = pixels.map((p) => Math.min(...cents.map((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2)));
    const sum = dists.reduce((a, b) => a + b, 0);
    if (!sum) break;
    let r = rand() * sum, i = 0;
    while ((r -= dists[i]) > 0 && i < pixels.length - 1) i++;
    cents.push(pixels[i].slice());
  }
  const assign = new Int32Array(pixels.length);
  for (let it = 0; it < iters; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    pixels.forEach((p, i) => {
      let bd = Infinity, bk = 0;
      cents.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; bk = j; }
      });
      assign[i] = bk;
      const s = sums[bk]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    sums.forEach((s, j) => { if (s[3]) cents[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = new Array(cents.length).fill(0);
  assign.forEach((a) => counts[a]++);
  return cents
    .map((c, j) => ({ rgb: c.map(Math.round), share: counts[j] / pixels.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}
const DIFFUSION = {
  fs: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
  jarvis: [[1, 0, 7 / 48], [2, 0, 5 / 48], [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48], [2, 1, 3 / 48], [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48]],
  sierra: [[1, 0, 5 / 32], [2, 0, 3 / 32], [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 5 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32], [-1, 2, 2 / 32], [0, 2, 3 / 32], [1, 2, 2 / 32]],
};
function bayerMatrix(n) {
  let m = [[0]];
  while (m.length < n) {
    const s = m.length, nm = [];
    for (let y = 0; y < s * 2; y++) {
      nm.push([]);
      for (let x = 0; x < s * 2; x++) {
        const q = [0, 2, 3, 1][(y >= s ? 2 : 0) + (x >= s ? 1 : 0)];
        nm[y].push(4 * m[y % s][x % s] + q);
      }
    }
    m = nm;
  }
  return m.map((r) => r.map((v) => (v + 0.5) / (n * n) - 0.5));
}
/** Map pixels to nearest palette color with optional dithering. */
export function mapToPalette(src, palette, dither = 'none', strength = 1) {
  const d = readData(src), a = d.data, w = d.width, h = d.height;
  const pal = palette.map((c) => (typeof c === 'string' ? hexToRgb(c) : c));
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let k = cache.get(key);
    if (k !== undefined) return k;
    let bd = Infinity; k = 0;
    for (let j = 0; j < pal.length; j++) {
      const p = pal[j];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const dd = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
      if (dd < bd) { bd = dd; k = j; }
    }
    cache.set(key, k);
    return k;
  };
  if (DIFFUSION[dither]) {
    const f = Float32Array.from(a), ker = DIFFUSION[dither];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = clamp(f[i]), g = clamp(f[i + 1]), b = clamp(f[i + 2]);
        const p = pal[nearest(r | 0, g | 0, b | 0)];
        a[i] = p[0]; a[i + 1] = p[1]; a[i + 2] = p[2];
        const er = (r - p[0]) * strength, eg = (g - p[1]) * strength, eb = (b - p[2]) * strength;
        for (const [dx, dy, wt] of ker) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          f[j] += er * wt; f[j + 1] += eg * wt; f[j + 2] += eb * wt;
        }
      }
    }
  } else {
    const bm = dither.startsWith('bayer') ? bayerMatrix(+dither.slice(5) || 4) : null;
    const spread = bm ? (255 / Math.max(1, Math.cbrt(pal.length))) * strength : 0;
    const rand = dither === 'random' ? rng(3) : null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let off = 0;
        if (bm) off = bm[y % bm.length][x % bm.length] * spread;
        else if (rand) off = (rand() - 0.5) * 128 * strength;
        const p = pal[nearest(clamp(a[i] + off) | 0, clamp(a[i + 1] + off) | 0, clamp(a[i + 2] + off) | 0)];
        a[i] = p[0]; a[i + 1] = p[1]; a[i + 2] = p[2];
      }
    }
  }
  return writeData(d);
}

/* ---------------- misc ---------------- */
/** Integral images for fast box sums: returns {sum(ch,x0,y0,x1,y1)} over rgb + luma^2 channel. */
export function integral(d) {
  const w = d.width, h = d.height, a = d.data, W = w + 1;
  const ch = [0, 1, 2].map(() => new Float64Array(W * (h + 1)));
  const lum = new Float64Array(W * (h + 1)), lum2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    const rs = [0, 0, 0]; let ls = 0, ls2 = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) { rs[c] += a[i + c]; ch[c][(y + 1) * W + x + 1] = ch[c][y * W + x + 1] + rs[c]; }
      const l = luma(a[i], a[i + 1], a[i + 2]);
      ls += l; ls2 += l * l;
      lum[(y + 1) * W + x + 1] = lum[y * W + x + 1] + ls;
      lum2[(y + 1) * W + x + 1] = lum2[y * W + x + 1] + ls2;
    }
  }
  const box = (t, x0, y0, x1, y1) => t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
  return { ch, lum, lum2, box, w, h };
}
export function averageColor(src, x = 0, y = 0, w = src.width, h = src.height) {
  const d = g2d(src).getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return [r / n, g / n, b / n];
}
/** Restore alpha of `orig` onto `c` (useful after blurs that ignore alpha). */
export function keepAlpha(c, orig) {
  return draw(c.width, c.height, (x) => {
    x.drawImage(c, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(orig, 0, 0, c.width, c.height);
  });
}
export function hasAlpha(src) {
  const a = readData(src).data;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 255) return true;
  return false;
}
