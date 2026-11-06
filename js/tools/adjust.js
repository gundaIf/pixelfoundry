// Tonal & color correction: manual and automatic.
import * as C from '../core.js';
import { range, select, bool, color, curve, when } from '../params.js';

const cat = 'adjust';

export function brightnessContrast(src, b, c) {
  const B = b * 1.5, K = c * 2.55, f = (259 * (K + 255)) / (255 * (259 - K));
  return C.applyLut(src, C.makeLut((i) => f * (i + B - 128) + 128));
}
export function autoLevels(src, clip = 0.005, linked = false) {
  const h = C.histogram(C.readData(src));
  const lo = {}, hi = {};
  for (const k of ['r', 'g', 'b', 'l']) { lo[k] = C.percentile(h[k], clip); hi[k] = C.percentile(h[k], 1 - clip); }
  const mk = (k) => {
    const a = linked ? lo.l : lo[k], b = linked ? hi.l : hi[k];
    return C.makeLut((i) => ((i - a) * 255) / Math.max(1, b - a));
  };
  return C.applyLut(src, mk('r'), mk('g'), mk('b'));
}
export function vibrance(src, amount, sat = 0) {
  const am = amount / 100, s = sat / 100;
  return C.perPixel(src, (a, i) => {
    let r = a[i], g = a[i + 1], b = a[i + 2];
    const mx = Math.max(r, g, b), avg = (r + g + b) / 3;
    const amt = ((mx - avg) / 255) * (-am * 3);
    r += (mx - r) * amt; g += (mx - g) * amt; b += (mx - b) * amt;
    if (s) {
      const l = C.luma(r, g, b);
      r = l + (r - l) * (1 + s); g = l + (g - l) * (1 + s); b = l + (b - l) * (1 + s);
    }
    a[i] = r; a[i + 1] = g; a[i + 2] = b;
  });
}
export function unsharp(src, amount, radius, threshold = 0) {
  const b = C.readData(C.blur(src, radius)).data;
  const d = C.readData(src), a = d.data, k = amount / 100;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = a[i + c] - b[i + c];
      if (Math.abs(diff) >= threshold) a[i + c] = a[i + c] + diff * k;
    }
  }
  return C.writeData(d);
}
export function hsl(src, hue, sat, light, colorize = false) {
  const hs = hue / 360, ss = sat / 100, ls = light / 100;
  return C.perPixel(src, (a, i) => {
    let [h, s, l] = C.rgbToHsl(a[i], a[i + 1], a[i + 2]);
    if (colorize) { h = ((hue + 360) % 360) / 360; s = C.clamp(0.5 + ss / 2, 0, 1); }
    else { h = (h + hs + 1) % 1; s = C.clamp(ss > 0 ? s + (1 - s) * ss * s : s * (1 + ss), 0, 1); }
    l = C.clamp(ls > 0 ? l + (1 - l) * ls : l * (1 + ls), 0, 1);
    const [r, g, b] = C.hslToRgb(h, s, l);
    a[i] = r; a[i + 1] = g; a[i + 2] = b;
  });
}
/** Monotone cubic interpolation of curve points -> LUT */
export function curveLut(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]);
  if (p[0][0] > 0) p.unshift([0, p[0][1]]);
  if (p[p.length - 1][0] < 255) p.push([255, p[p.length - 1][1]]);
  const n = p.length, xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1e-6; m[i] = (ys[i + 1] - ys[i]) / dx[i]; }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return C.makeLut((x) => {
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = dx[k], u = (x - xs[k]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h * t[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h * t[k + 1];
  });
}

const CURVE_PRESETS = {
  custom: null,
  linear: [[0, 0], [255, 255]],
  scontrast: [[0, 0], [64, 48], [192, 208], [255, 255]],
  strong: [[0, 0], [64, 36], [192, 220], [255, 255]],
  fade: [[0, 40], [128, 128], [255, 230]],
  brighten: [[0, 0], [110, 150], [255, 255]],
  darken: [[0, 0], [150, 110], [255, 255]],
  negative: [[0, 255], [255, 0]],
};

export default [
  {
    id: 'brightness-contrast', name: 'Brightness & Contrast', cat, tags: 'light dark exposure',
    desc: 'Classic brightness and contrast sliders.',
    params: [range('b', 'Brightness', -100, 100, 0), range('c', 'Contrast', -100, 100, 0)],
    run: (src, p) => brightnessContrast(src, p.b, p.c),
  },
  {
    id: 'exposure', name: 'Exposure & Gamma', cat, tags: 'ev stops gamma offset',
    desc: 'Photographic exposure in stops, gamma and black offset.',
    params: [range('ev', 'Exposure', -3, 3, 0, 0.05, ' EV'), range('gamma', 'Gamma', 0.2, 3, 1, 0.01), range('offset', 'Offset', -60, 60, 0)],
    run: (src, p) => C.applyLut(src, C.makeLut((i) => Math.pow(Math.min(1, (i / 255) * 2 ** p.ev), 1 / p.gamma) * 255 + p.offset)),
  },
  {
    id: 'levels', name: 'Levels', cat, tags: 'input output black point white point',
    desc: 'Set black point, white point and midtone gamma — per channel or combined.',
    params: [
      select('ch', 'Channel', [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]),
      range('inB', 'Input black', 0, 254, 0), range('inW', 'Input white', 1, 255, 255),
      range('gamma', 'Midtones (gamma)', 0.1, 5, 1, 0.01),
      range('outB', 'Output black', 0, 255, 0), range('outW', 'Output white', 0, 255, 255),
    ],
    run: (src, p) => {
      const L = C.makeLut((i) => {
        const t = C.clamp((i - p.inB) / Math.max(1, p.inW - p.inB), 0, 1);
        return p.outB + Math.pow(t, 1 / p.gamma) * (p.outW - p.outB);
      });
      const id = C.makeLut((i) => i);
      return C.applyLut(src, p.ch === 'rgb' || p.ch === 'r' ? L : id, p.ch === 'rgb' || p.ch === 'g' ? L : id, p.ch === 'rgb' || p.ch === 'b' ? L : id);
    },
  },
  {
    id: 'curves', name: 'Curves', cat, tags: 'tone curve s-curve',
    desc: 'Drag points on a tone curve for precise control. Double-click a point to remove it.',
    params: [
      select('preset', 'Preset', [['custom', 'Custom'], ['linear', 'Linear'], ['scontrast', 'Soft S-curve'], ['strong', 'Strong contrast'], ['fade', 'Faded film'], ['brighten', 'Brighten'], ['darken', 'Darken'], ['negative', 'Negative']], 'custom', { onChange: (v, p) => { if (CURVE_PRESETS[v]) p.pts = CURVE_PRESETS[v].map((q) => q.slice()); } }),
      select('ch', 'Channel', [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]),
      curve('pts'),
    ],
    run: (src, p) => {
      const L = curveLut(p.pts), id = C.makeLut((i) => i);
      return C.applyLut(src, p.ch === 'rgb' || p.ch === 'r' ? L : id, p.ch === 'rgb' || p.ch === 'g' ? L : id, p.ch === 'rgb' || p.ch === 'b' ? L : id);
    },
  },
  {
    id: 'auto-levels', name: 'Auto Levels', cat, tags: 'automatic fix stretch',
    desc: 'Stretch each channel to the full range — fixes dull images and color casts.',
    params: [range('clip', 'Clip', 0, 5, 0.5, 0.1, '%'), select('mode', 'Mode', [['ch', 'Per channel (fix casts)'], ['linked', 'Linked (keep colors)']])],
    run: (src, p) => autoLevels(src, p.clip / 100, p.mode === 'linked'),
  },
  {
    id: 'auto-contrast', name: 'Auto Contrast', cat, tags: 'automatic',
    desc: 'Maximize contrast based on luminance, keeping hues intact.',
    params: [range('clip', 'Clip', 0, 5, 0.3, 0.1, '%')],
    run: (src, p) => autoLevels(src, p.clip / 100, true),
  },
  {
    id: 'auto-color', name: 'Auto Color Balance', cat, tags: 'white balance gray world cast',
    desc: 'Neutralize color casts using the gray-world assumption.',
    params: [range('amt', 'Strength', 0, 100, 100, 1, '%')],
    run: (src, p) => {
      const [r, g, b] = C.averageColor(src), m = (r + g + b) / 3, k = p.amt / 100;
      const f = [m / r, m / g, m / b].map((v) => 1 + (v - 1) * k);
      return C.applyLut(src, C.makeLut((i) => i * f[0]), C.makeLut((i) => i * f[1]), C.makeLut((i) => i * f[2]));
    },
  },
  {
    id: 'auto-gamma', name: 'Auto Gamma', cat, tags: 'automatic brightness midtones',
    desc: 'Automatically correct midtone brightness to a target level.',
    params: [range('target', 'Target brightness', 20, 80, 50, 1, '%')],
    run: (src, p) => {
      const [r, g, b] = C.averageColor(src), m = C.clamp(C.luma(r, g, b) / 255, 0.01, 0.99);
      const gm = Math.log(p.target / 100) / Math.log(m);
      return C.applyLut(src, C.makeLut((i) => Math.pow(i / 255, gm) * 255));
    },
  },
  {
    id: 'auto-enhance', name: 'Auto Enhance', cat, tags: 'one click magic improve enrich',
    desc: 'One-click improvement: levels, vibrance and a touch of sharpening.',
    params: [range('amt', 'Strength', 0, 100, 70, 1, '%')],
    run: (src, p, env) => {
      const k = p.amt / 100;
      let out = autoLevels(src, 0.004, false);
      out = vibrance(out, 35 * k);
      out = unsharp(out, 60 * k, Math.max(0.6, 1.2 * env.s), 2);
      return C.mix(src, out, Math.min(1, k * 1.4));
    },
  },
  {
    id: 'hsl', name: 'Hue / Saturation / Lightness', cat, tags: 'hue shift colorize saturate desaturate',
    desc: 'Shift hues, boost or mute saturation, or colorize the whole image.',
    params: [range('h', 'Hue', -180, 180, 0, 1, '°'), range('s', 'Saturation', -100, 100, 0), range('l', 'Lightness', -100, 100, 0), bool('colorize', 'Colorize')],
    run: (src, p) => hsl(src, p.h, p.s, p.l, p.colorize),
  },
  {
    id: 'vibrance', name: 'Vibrance', cat, tags: 'saturation smart color pop',
    desc: 'Smart saturation that protects already-saturated colors and skin tones.',
    params: [range('v', 'Vibrance', -100, 100, 40), range('s', 'Saturation', -100, 100, 0)],
    run: (src, p) => vibrance(src, p.v, p.s),
  },
  {
    id: 'temperature', name: 'Temperature & Tint', cat, tags: 'white balance warm cool kelvin',
    desc: 'Warm up or cool down the image and fix green/magenta tints.',
    params: [range('t', 'Temperature', -100, 100, 0), range('tint', 'Tint', -100, 100, 0)],
    run: (src, p) => {
      const t = p.t / 100, n = p.tint / 100;
      const r = 1 + t * 0.25, b = 1 - t * 0.25, g = 1 - n * 0.18 + t * 0.03;
      return C.applyLut(src, C.makeLut((i) => i * r), C.makeLut((i) => i * g), C.makeLut((i) => i * b));
    },
  },
  {
    id: 'color-balance', name: 'Color Balance', cat, tags: 'shadows midtones highlights grading',
    desc: 'Shift colors separately in shadows, midtones and highlights.',
    params: [
      range('sr', 'Shadows · Cyan ↔ Red', -100, 100, 0), range('sg', 'Shadows · Magenta ↔ Green', -100, 100, 0), range('sb', 'Shadows · Yellow ↔ Blue', -100, 100, 0),
      range('mr', 'Midtones · Cyan ↔ Red', -100, 100, 0), range('mg', 'Midtones · Magenta ↔ Green', -100, 100, 0), range('mb', 'Midtones · Yellow ↔ Blue', -100, 100, 0),
      range('hr', 'Highlights · Cyan ↔ Red', -100, 100, 0), range('hg', 'Highlights · Magenta ↔ Green', -100, 100, 0), range('hb', 'Highlights · Yellow ↔ Blue', -100, 100, 0),
      bool('keepL', 'Preserve luminosity', true),
    ],
    run: (src, p) => {
      const S = [p.sr, p.sg, p.sb], M = [p.mr, p.mg, p.mb], H = [p.hr, p.hg, p.hb];
      return C.perPixel(src, (a, i) => {
        const l = C.luma(a[i], a[i + 1], a[i + 2]) / 255;
        const ws = 1 - C.smoothstep(0, 0.5, l), wh = C.smoothstep(0.5, 1, l), wm = 1 - ws - wh;
        const o = [0, 1, 2].map((c) => a[i + c] + (S[c] * ws + M[c] * wm + H[c] * wh) * 0.8);
        if (p.keepL) {
          const nl = C.luma(o[0], o[1], o[2]), d = l * 255 - nl;
          o[0] += d; o[1] += d; o[2] += d;
        }
        a[i] = o[0]; a[i + 1] = o[1]; a[i + 2] = o[2];
      });
    },
  },
  {
    id: 'channel-mixer', name: 'Channel Mixer', cat, tags: 'rgb matrix advanced',
    desc: 'Rebuild each output channel from a mix of the input channels.',
    params: [
      range('rr', 'Red ← Red', -200, 200, 100, 1, '%'), range('rg', 'Red ← Green', -200, 200, 0, 1, '%'), range('rb', 'Red ← Blue', -200, 200, 0, 1, '%'),
      range('gr', 'Green ← Red', -200, 200, 0, 1, '%'), range('gg', 'Green ← Green', -200, 200, 100, 1, '%'), range('gb', 'Green ← Blue', -200, 200, 0, 1, '%'),
      range('br', 'Blue ← Red', -200, 200, 0, 1, '%'), range('bg', 'Blue ← Green', -200, 200, 0, 1, '%'), range('bb', 'Blue ← Blue', -200, 200, 100, 1, '%'),
      bool('mono', 'Monochrome (use red row)'),
    ],
    run: (src, p) => C.perPixel(src, (a, i) => {
      const r = a[i], g = a[i + 1], b = a[i + 2];
      const R = (r * p.rr + g * p.rg + b * p.rb) / 100;
      if (p.mono) { a[i] = a[i + 1] = a[i + 2] = R; return; }
      a[i] = R; a[i + 1] = (r * p.gr + g * p.gg + b * p.gb) / 100; a[i + 2] = (r * p.br + g * p.bg + b * p.bb) / 100;
    }),
  },
  {
    id: 'shadows-highlights', name: 'Shadows / Highlights', cat, tags: 'recover backlit dynamic range',
    desc: 'Recover detail in dark shadows and blown-out highlights using a local mask.',
    params: [range('sh', 'Shadows', 0, 100, 40), range('hi', 'Highlights', 0, 100, 20), range('r', 'Radius', 2, 100, 30, 1, 'px')],
    run: (src, p, env) => {
      const d = C.readData(src), w = d.width, h = d.height, a = d.data;
      const mask = C.blurMap(C.grayArray(d), w, h, Math.max(1, p.r * env.s));
      const sh = p.sh / 100, hi = p.hi / 100;
      for (let i = 0, j = 0; i < a.length; i += 4, j++) {
        const m = mask[j] / 255;
        const lift = sh * (1 - m) ** 2, cut = hi * m * m;
        for (let c = 0; c < 3; c++) {
          let v = a[i + c] / 255;
          v = v + lift * (1 - v) * 0.9 * (1 - v);
          v = v - cut * v * 0.6 * v;
          a[i + c] = v * 255;
        }
      }
      return C.writeData(d);
    },
  },
  {
    id: 'lighten-shadows', name: 'Lighten Dark Photo', cat, tags: 'underexposed brighten night',
    desc: 'Brighten underexposed photos with a gentle logarithmic curve.',
    params: [range('k', 'Strength', 0, 100, 40)],
    run: (src, p) => {
      const k = 0.0001 + (p.k / 100) * 25;
      return C.applyLut(src, C.makeLut((i) => (Math.log(1 + (k * i) / 255) / Math.log(1 + k)) * 255));
    },
  },
  {
    id: 'sharpen', name: 'Sharpen (Unsharp Mask)', cat, tags: 'detail crisp focus',
    desc: 'Increase perceived sharpness with amount, radius and threshold control.',
    params: [range('amt', 'Amount', 0, 400, 120, 1, '%'), range('r', 'Radius', 0.3, 10, 1.2, 0.1, 'px'), range('t', 'Threshold', 0, 60, 2)],
    run: (src, p, env) => unsharp(src, p.amt, Math.max(0.4, p.r * env.s), p.t),
  },
  {
    id: 'clarity', name: 'Clarity', cat, tags: 'local contrast punch structure',
    desc: 'Midtone local contrast — adds punch without harsh halos.',
    params: [range('amt', 'Clarity', -100, 100, 40)],
    run: (src, p, env) => {
      const out = unsharp(src, p.amt * 0.9, Math.max(2, 25 * env.s));
      const d = C.readData(src), w = C.grayArray(d).map((l) => 1 - Math.abs(l / 255 - 0.5) * 1.6);
      return C.mix(src, out, w.map((v) => C.clamp(v, 0, 1)));
    },
  },
  {
    id: 'hdr', name: 'HDR Look', cat, tags: 'tone mapping dramatic detail',
    desc: 'Simulated HDR: compresses tones and boosts local detail and color.',
    params: [range('str', 'Strength', 0, 100, 60), range('detail', 'Detail', 0, 100, 50), range('sat', 'Saturation', -50, 100, 25)],
    run: (src, p, env) => {
      const k = p.str / 100;
      let out = C.readData(src);
      const w = out.width, h = out.height, a = out.data;
      const base = C.blurMap(C.grayArray(out), w, h, Math.max(2, 40 * env.s));
      for (let i = 0, j = 0; i < a.length; i += 4, j++) {
        const m = base[j] / 255, gain = 1 + k * (0.5 - m) * 1.2;
        for (let c = 0; c < 3; c++) a[i + c] = a[i + c] * gain + k * (0.5 - m) * 40;
      }
      let c = C.writeData(out);
      c = unsharp(c, p.detail * 2.2, Math.max(1, 6 * env.s));
      return vibrance(c, p.sat, p.sat / 3);
    },
  },
  {
    id: 'denoise', name: 'Reduce Noise (Median)', cat, tags: 'median filter grain noise speckle',
    desc: 'Edge-preserving median filter — removes speckles and salt-and-pepper noise.',
    params: [range('r', 'Radius', 1, 8, 1, 1, 'px')],
    run: (src, p, env) => C.median(src, Math.max(1, p.r * Math.max(env.s, 0.5))),
  },
  {
    id: 'smooth-skin', name: 'Smooth (Surface Blur)', cat, tags: 'retouch skin bilateral jpeg artifacts',
    desc: 'Smooths flat areas while keeping edges — great for skin and JPEG artifacts.',
    params: [range('r', 'Radius', 1, 30, 6, 1, 'px'), range('t', 'Edge threshold', 2, 80, 18), range('amt', 'Amount', 0, 100, 80, 1, '%')],
    run: (src, p, env) => {
      const bl = C.readData(C.blur(src, Math.max(0.8, p.r * env.s))).data;
      const d = C.readData(src), a = d.data, k = p.amt / 100;
      for (let i = 0; i < a.length; i += 4) {
        const diff = (Math.abs(a[i] - bl[i]) + Math.abs(a[i + 1] - bl[i + 1]) + Math.abs(a[i + 2] - bl[i + 2])) / 3;
        const wgt = (1 - C.smoothstep(p.t * 0.5, p.t * 1.5, diff)) * k;
        for (let c = 0; c < 3; c++) a[i + c] += (bl[i + c] - a[i + c]) * wgt;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'scan-cleanup', name: 'Clean Up Scanned Document', cat, tags: 'text document paper whiteboard ocr',
    desc: 'Flattens uneven lighting, whitens paper and darkens text in scans or phone photos of documents.',
    params: [range('bg', 'Background flatten', 5, 120, 40, 1, 'px'), range('c', 'Contrast', 0, 100, 50), bool('gray', 'Grayscale', true), bool('bw', 'Pure black & white')],
    run: (src, p, env) => {
      const bg = C.readData(C.blur(src, Math.max(2, p.bg * env.s))).data;
      const d = C.readData(src), a = d.data, k = 1 + p.c / 25;
      for (let i = 0; i < a.length; i += 4) {
        const o = [0, 1, 2].map((c) => C.clamp((a[i + c] / Math.max(1, bg[i + c])) * 255));
        const v = o.map((x) => 255 - (255 - x) * k);
        if (p.gray || p.bw) {
          let l = C.luma(v[0], v[1], v[2]);
          if (p.bw) l = l > 160 ? 255 : 0;
          a[i] = a[i + 1] = a[i + 2] = l;
        } else { a[i] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; }
      }
      return C.writeData(d);
    },
  },
  {
    id: 'upscale', name: 'Enlarge Small Image', cat, tags: 'upscale enlarge super resolution 2x',
    desc: 'Upscale with high-quality interpolation followed by adaptive sharpening.',
    params: [select('f', 'Scale', [['1.5', '150%'], ['2', '200%'], ['3', '300%'], ['4', '400%']], '2'), range('sh', 'Sharpening', 0, 200, 80, 1, '%'), bool('pixel', 'Pixel-perfect (nearest neighbor)')],
    run: (src, p, env) => {
      const f = +p.f;
      const out = C.resizeCanvas(src, src.width * f, src.height * f, !p.pixel);
      return p.pixel ? out : unsharp(out, p.sh, Math.max(0.6, f * 0.7 * env.s), 1);
    },
  },
];
