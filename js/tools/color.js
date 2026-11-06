// Color effects: B&W, toning, palettes, dithering, channel tricks.
import * as C from '../core.js';
import { range, select, bool, color, when, PALETTES, PALETTE_OPTIONS, DITHER_OPTIONS } from '../params.js';

const cat = 'color';

function grayscale(src, method = 'luma') {
  return C.perPixel(src, (a, i) => {
    const r = a[i], g = a[i + 1], b = a[i + 2];
    let v;
    switch (method) {
      case 'avg': v = (r + g + b) / 3; break;
      case 'light': v = (Math.max(r, g, b) + Math.min(r, g, b)) / 2; break;
      case 'r': v = r; break;
      case 'g': v = g; break;
      case 'b': v = b; break;
      case 'film': v = 0.45 * r + 0.45 * g + 0.1 * b; break;
      default: v = C.luma(r, g, b);
    }
    a[i] = a[i + 1] = a[i + 2] = v;
  });
}
export function sepia(src, amt = 1) {
  return C.perPixel(src, (a, i) => {
    const r = a[i], g = a[i + 1], b = a[i + 2];
    a[i] = r + (Math.min(255, r * 0.393 + g * 0.769 + b * 0.189) - r) * amt;
    a[i + 1] = g + (Math.min(255, r * 0.349 + g * 0.686 + b * 0.168) - g) * amt;
    a[i + 2] = b + (Math.min(255, r * 0.272 + g * 0.534 + b * 0.131) - b) * amt;
  });
}
function quantPalette(src, p) {
  if (p.palette && p.palette !== 'auto') return PALETTES[p.palette];
  return C.medianCut(C.samplePixels(C.readData(src)), p.n || 16);
}
const THERMAL = {
  iron: [[0, '#000000'], [0.2, '#1f0c48'], [0.4, '#a3216b'], [0.6, '#e8502a'], [0.8, '#f9c31b'], [1, '#ffffff']],
  rainbow: [[0, '#000080'], [0.2, '#0000ff'], [0.4, '#00ffff'], [0.6, '#00ff00'], [0.8, '#ffff00'], [1, '#ff0000']],
  hot: [[0, '#000000'], [0.35, '#e00000'], [0.7, '#ffd000'], [1, '#ffffff']],
  arctic: [[0, '#04081e'], [0.3, '#0b3a7a'], [0.6, '#2fb5d9'], [0.85, '#c8f3ff'], [1, '#ffffff']],
};
const WARHOL = [
  ['#1a0b2e', '#ff3d7f', '#ffe066'], ['#002b36', '#29adff', '#b8f818'],
  ['#3d0000', '#ff7a00', '#7ef0ff'], ['#14213d', '#fca311', '#e5e5e5'],
  ['#0b0033', '#9b5de5', '#f15bb5'], ['#003300', '#00f5d4', '#fee440'],
  ['#2b2d42', '#ef233c', '#edf2f4'], ['#240046', '#ff9e00', '#3cf'],
  ['#001219', '#ee9b00', '#94d2bd'],
];

export default [
  {
    id: 'grayscale', name: 'Black & White', cat, tags: 'grayscale monochrome desaturate bw',
    desc: 'Convert to black & white with several channel-weighting methods.',
    params: [select('m', 'Method', [['luma', 'Luminance (natural)'], ['avg', 'Average'], ['light', 'Lightness'], ['film', 'Film (red-sensitive)'], ['r', 'Red channel'], ['g', 'Green channel'], ['b', 'Blue channel']]), range('amt', 'Amount', 0, 100, 100, 1, '%')],
    run: (src, p) => C.mix(src, grayscale(src, p.m), p.amt / 100),
  },
  {
    id: 'sepia', name: 'Sepia', cat, tags: 'old brown antique',
    desc: 'Warm brown antique toning.',
    params: [range('amt', 'Amount', 0, 100, 100, 1, '%')],
    run: (src, p) => sepia(src, p.amt / 100),
  },
  {
    id: 'invert', name: 'Negative / Invert', cat, tags: 'negative positive invert',
    desc: 'Invert colors (negative ↔ positive), optionally lightness only.',
    params: [select('m', 'Mode', [['rgb', 'Full color negative'], ['lum', 'Invert lightness only'], ['r', 'Red only'], ['g', 'Green only'], ['b', 'Blue only']])],
    run: (src, p) => C.perPixel(src, (a, i) => {
      if (p.m === 'lum') {
        const [h, s, l] = C.rgbToHsl(a[i], a[i + 1], a[i + 2]);
        const [r, g, b] = C.hslToRgb(h, s, 1 - l);
        a[i] = r; a[i + 1] = g; a[i + 2] = b; return;
      }
      if (p.m === 'rgb' || p.m === 'r') a[i] = 255 - a[i];
      if (p.m === 'rgb' || p.m === 'g') a[i + 1] = 255 - a[i + 1];
      if (p.m === 'rgb' || p.m === 'b') a[i + 2] = 255 - a[i + 2];
    }),
  },
  {
    id: 'duotone', name: 'Duotone', cat, tags: 'two color spotify gradient',
    desc: 'Map shadows and highlights to two colors.',
    params: [color('c1', 'Shadows', '#1b1340'), color('c2', 'Highlights', '#ff6f61'), range('contrast', 'Contrast', -50, 100, 15), range('amt', 'Amount', 0, 100, 100, 1, '%')],
    run: (src, p) => {
      const k = 1 + p.contrast / 100;
      const pre = C.applyLut(src, C.makeLut((i) => (i - 128) * k + 128));
      return C.mix(src, C.gradientMap(pre, [[0, p.c1], [1, p.c2]]), p.amt / 100);
    },
  },
  {
    id: 'gradient-map', name: 'Gradient Map', cat, tags: 'tritone color grade',
    desc: 'Map brightness to a three-color gradient.',
    params: [color('c1', 'Shadows', '#0d0221'), color('c2', 'Midtones', '#b0306a'), color('c3', 'Highlights', '#ffd27f'), range('mid', 'Midpoint', 10, 90, 50, 1, '%'), range('amt', 'Amount', 0, 100, 100, 1, '%')],
    run: (src, p) => C.gradientMap(src, [[0, p.c1], [p.mid / 100, p.c2], [1, p.c3]], p.amt / 100),
  },
  {
    id: 'split-tone', name: 'Split Toning', cat, tags: 'teal orange cinematic grade',
    desc: 'Tint highlights and shadows separately — e.g. cinematic teal & orange.',
    params: [color('hc', 'Highlight color', '#ffa64d'), color('sc', 'Shadow color', '#1f8a9e'), range('bal', 'Balance', -100, 100, 0), range('amt', 'Strength', 0, 100, 40, 1, '%')],
    run: (src, p) => {
      const hc = C.hexToRgb(p.hc), sc = C.hexToRgb(p.sc), k = p.amt / 100, mid = 0.5 + p.bal / 250;
      return C.perPixel(src, (a, i) => {
        const l = C.luma(a[i], a[i + 1], a[i + 2]) / 255;
        const wh = C.smoothstep(mid - 0.25, 1, l) * k, ws = (1 - C.smoothstep(0, mid + 0.25, l)) * k;
        for (let c = 0; c < 3; c++) {
          const v = a[i + c];
          // soft-light style tint
          const th = (hc[c] / 255 - 0.5) * 2, ts = (sc[c] / 255 - 0.5) * 2;
          a[i + c] = v + th * wh * 80 + ts * ws * 80;
        }
      });
    },
  },
  {
    id: 'color-filter', name: 'Color Filter', cat, tags: 'tint photo filter overlay',
    desc: 'Lay a colored filter over the photo with any blend mode.',
    params: [color('c', 'Color', '#ff8a00'), range('d', 'Density', 0, 100, 35, 1, '%'), select('mode', 'Blend', [['color', 'Color'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['hue', 'Hue'], ['source-over', 'Normal']])],
    run: (src, p) => C.fillColor(src, p.c, p.mode, p.d / 100),
  },
  {
    id: 'monotone', name: 'One-Tone (Monochrome Color)', cat, tags: 'single color tint monochrome',
    desc: 'Render the image in shades of a single color.',
    params: [color('c', 'Color', '#2a7de1'), range('amt', 'Amount', 0, 100, 100, 1, '%')],
    run: (src, p) => C.mix(src, C.fillColor(grayscale(src), p.c, 'color', 1), p.amt / 100),
  },
  {
    id: 'color-splash', name: 'Color Splash (Isolate Color)', cat, tags: 'selective color keep red pop',
    desc: 'Keep one color and turn everything else black & white (or the reverse).',
    params: [color('c', 'Color to keep', '#d32f2f', { pick: true }), range('tol', 'Hue tolerance', 2, 90, 25, 1, '°'), range('soft', 'Softness', 0, 60, 15, 1, '°'), range('minS', 'Min saturation', 0, 100, 15, 1, '%'), bool('inv', 'Invert (remove this color)')],
    run: (src, p) => {
      const [th, ts] = C.rgbToHsl(...C.hexToRgb(p.c));
      return C.perPixel(src, (a, i) => {
        const [h, s] = C.rgbToHsl(a[i], a[i + 1], a[i + 2]);
        let dh = Math.abs(h - th) * 360; if (dh > 180) dh = 360 - dh;
        let keep = 1 - C.smoothstep(p.tol, p.tol + p.soft + 0.01, dh);
        keep *= C.smoothstep(p.minS / 100 - 0.05, p.minS / 100 + 0.05, s);
        if (p.inv) keep = 1 - keep;
        const l = C.luma(a[i], a[i + 1], a[i + 2]);
        a[i] = l + (a[i] - l) * keep; a[i + 1] = l + (a[i + 1] - l) * keep; a[i + 2] = l + (a[i + 2] - l) * keep;
      });
    },
  },
  {
    id: 'replace-color', name: 'Replace Color', cat, tags: 'swap recolor change color',
    desc: 'Swap one color for another, preserving shading.',
    params: [color('from', 'Find color', '#3366cc', { pick: true }), color('to', 'Replace with', '#e53935'), range('tol', 'Tolerance', 1, 200, 60), range('soft', 'Softness', 0, 150, 40), bool('shade', 'Preserve shading', true)],
    run: (src, p) => {
      const f = C.hexToRgb(p.from), t = C.hexToRgb(p.to);
      return C.perPixel(src, (a, i) => {
        const dr = a[i] - f[0], dg = a[i + 1] - f[1], db = a[i + 2] - f[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        const w = 1 - C.smoothstep(p.tol, p.tol + p.soft + 0.01, dist);
        if (!w) return;
        const tgt = p.shade ? [t[0] + dr, t[1] + dg, t[2] + db] : t;
        for (let c = 0; c < 3; c++) a[i + c] += (tgt[c] - a[i + c]) * w;
      });
    },
  },
  {
    id: 'posterize', name: 'Posterize', cat, tags: 'levels banding poster',
    desc: 'Reduce each channel to a few tonal levels.',
    params: [range('n', 'Levels', 2, 16, 4)],
    run: (src, p) => {
      const step = 255 / (p.n - 1);
      return C.applyLut(src, C.makeLut((i) => Math.round(i / step) * step));
    },
  },
  {
    id: 'limit-colors', name: 'Limit Number of Colors', cat, tags: 'quantize palette reduce colors gif',
    desc: 'Reduce to N colors (smart median-cut palette or retro presets) with optional dithering.',
    params: [select('palette', 'Palette', PALETTE_OPTIONS), when((p) => p.palette === 'auto', range('n', 'Colors', 2, 256, 16)), select('dither', 'Dithering', DITHER_OPTIONS, 'none'), range('str', 'Dither strength', 0, 100, 80, 1, '%')],
    run: (src, p) => C.mapToPalette(src, quantPalette(src, p), p.dither, p.str / 100),
  },
  {
    id: 'dither', name: 'Dithering', cat, tags: '1-bit black white newspaper retro',
    desc: 'Classic 1-bit (or two-color) dithering: Floyd–Steinberg, Atkinson, Bayer…',
    params: [select('dither', 'Algorithm', DITHER_OPTIONS.slice(1), 'atkinson'), color('c1', 'Dark', '#000000'), color('c2', 'Light', '#ffffff'), range('bright', 'Brightness', -100, 100, 0), range('contrast', 'Contrast', -100, 100, 10), range('scale', 'Pixel size', 1, 8, 1)],
    run: (src, p, env) => {
      const sc = Math.max(1, Math.round(p.scale * Math.max(env.s, 0.4)));
      let s = sc > 1 ? C.resizeCanvas(src, src.width / sc, src.height / sc) : src;
      const K = p.contrast * 2.55, f = (259 * (K + 255)) / (255 * (259 - K));
      s = grayscale(C.applyLut(s, C.makeLut((i) => f * (i + p.bright - 128) + 128)));
      const out = C.mapToPalette(s, [[0, 0, 0], [255, 255, 255]], p.dither, 1);
      const col = C.gradientMap(out, [[0, p.c1], [1, p.c2]]);
      return sc > 1 ? C.resizeCanvas(col, src.width, src.height, false) : col;
    },
  },
  {
    id: 'threshold', name: 'Threshold', cat, tags: 'black white binary adaptive',
    desc: 'Pure black & white at a cutoff — global or adaptive (great for text).',
    params: [range('t', 'Threshold', 0, 255, 128), bool('adaptive', 'Adaptive (local)'), when((p) => p.adaptive, range('r', 'Adaptive radius', 2, 80, 15, 1, 'px')), color('c1', 'Dark', '#000000'), color('c2', 'Light', '#ffffff')],
    run: (src, p, env) => {
      const d = C.readData(src), g = C.grayArray(d), a = d.data;
      const local = p.adaptive ? C.blurMap(g, d.width, d.height, Math.max(1, p.r * env.s)) : null;
      const c1 = C.hexToRgb(p.c1), c2 = C.hexToRgb(p.c2);
      for (let j = 0, i = 0; j < g.length; j++, i += 4) {
        const t = local ? local[j] + (p.t - 128) * 0.3 - 6 : p.t;
        const c = g[j] > t ? c2 : c1;
        a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2];
      }
      return C.writeData(d);
    },
  },
  {
    id: 'channels', name: 'Extract / Swap Channels', cat, tags: 'rgb channel red green blue swap',
    desc: 'Isolate a single RGB channel or reorder channels.',
    params: [select('m', 'Operation', [['r', 'Show red channel'], ['g', 'Show green channel'], ['b', 'Show blue channel'], ['rg', 'Red as grayscale'], ['gg', 'Green as grayscale'], ['bg', 'Blue as grayscale'], ['brg', 'Swap → BRG'], ['gbr', 'Swap → GBR'], ['bgr', 'Swap → BGR'], ['rbg', 'Swap → RBG'], ['grb', 'Swap → GRB']])],
    run: (src, p) => C.perPixel(src, (a, i) => {
      const v = { r: a[i], g: a[i + 1], b: a[i + 2] };
      const m = p.m;
      if (m.length === 1) { a[i] = m === 'r' ? v.r : 0; a[i + 1] = m === 'g' ? v.g : 0; a[i + 2] = m === 'b' ? v.b : 0; }
      else if (m.length === 2) { a[i] = a[i + 1] = a[i + 2] = v[m[0]]; }
      else { a[i] = v[m[0]]; a[i + 1] = v[m[1]]; a[i + 2] = v[m[2]]; }
    }),
  },
  {
    id: 'thermal', name: 'Thermal Imager', cat, tags: 'heat infrared predator flir',
    desc: 'False-color heat-camera look.',
    params: [select('pal', 'Palette', [['iron', 'Ironbow'], ['rainbow', 'Rainbow'], ['hot', 'Hot metal'], ['arctic', 'Arctic']]), range('blur', 'Softness', 0, 10, 2, 0.5, 'px')],
    run: (src, p, env) => C.gradientMap(p.blur ? C.blur(src, p.blur * env.s) : src, THERMAL[p.pal]),
  },
  {
    id: 'matte', name: 'Matte / Faded Film', cat, tags: 'fade lifted blacks instagram',
    desc: 'Lifted blacks, softened whites and muted colors for a matte print look.',
    params: [range('lift', 'Lift blacks', 0, 100, 35), range('lower', 'Lower whites', 0, 100, 10), range('desat', 'Desaturate', 0, 100, 20, 1, '%'), color('tint', 'Shadow tint', '#2c3e50')],
    run: (src, p) => {
      const lo = p.lift * 0.9, hi = 255 - p.lower * 0.8, tint = C.hexToRgb(p.tint), k = p.desat / 100;
      return C.perPixel(src, (a, i) => {
        const l = C.luma(a[i], a[i + 1], a[i + 2]);
        for (let c = 0; c < 3; c++) {
          let v = a[i + c];
          v = l + (v - l) * (1 - k);
          v = lo + (v / 255) * (hi - lo);
          v += ((tint[c] - 128) / 255) * (1 - l / 255) * p.lift * 0.4;
          a[i + c] = v;
        }
      });
    },
  },
  {
    id: 'vintage', name: 'Vintage Photo', cat, tags: 'retro old 70s film aged',
    desc: 'Warm faded tones, soft contrast, vignette and film grain.',
    params: [range('amt', 'Amount', 0, 100, 80, 1, '%'), range('grain', 'Grain', 0, 100, 30), range('vig', 'Vignette', 0, 100, 50)],
    run: (src, p, env) => {
      const k = p.amt / 100, rand = C.rng(11);
      const sep = sepia(src, 0.55);
      const d = C.readData(C.mix(src, sep, k)), a = d.data, w = d.width, h = d.height;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dx = x / w - 0.5, dy = y / h - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 1.4;
        const v = 1 - C.smoothstep(0.4, 1.1, r) * (p.vig / 100);
        const n = (rand() - 0.5) * p.grain * 0.9;
        a[i] = (28 + a[i] * 0.86 + 10 * k) * v + n;
        a[i + 1] = (22 + a[i + 1] * 0.84) * v + n;
        a[i + 2] = (30 + a[i + 2] * 0.72) * v + n;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'cross-process', name: 'Cross Processing', cat, tags: 'lomo film xpro',
    desc: 'Simulated cross-processed film: punchy, yellow-green highlights, blue shadows.',
    params: [range('amt', 'Amount', 0, 100, 80, 1, '%')],
    run: (src, p) => {
      const s = (i, k) => 255 / (1 + Math.exp(-k * (i / 255 - 0.5)));
      const r = C.makeLut((i) => s(i, 7)), g = C.makeLut((i) => s(i, 5.5) * 0.96 + 6), b = C.makeLut((i) => 40 + i * 0.68);
      return C.mix(src, C.applyLut(src, r, g, b), p.amt / 100);
    },
  },
  {
    id: 'solarize', name: 'Solarize', cat, tags: 'sabattier darkroom',
    desc: 'Invert tones above a threshold — a classic darkroom effect.',
    params: [range('t', 'Threshold', 0, 255, 128)],
    run: (src, p) => C.applyLut(src, C.makeLut((i) => (i > p.t ? 255 - i : i))),
  },
  {
    id: 'warhol', name: 'Pop Art (Warhol)', cat, tags: 'andy warhol pop art grid',
    desc: 'Grid of posterized copies in bold pop-art color schemes.',
    params: [select('grid', 'Grid', [['2', '2 × 2'], ['3', '3 × 3']]), range('levels', 'Tones', 2, 3, 3), range('seed', 'Color shuffle', 0, 20, 0)],
    run: (src, p) => {
      const n = +p.grid, w = src.width, h = src.height, tw = w / n, th = h / n;
      const small = C.resizeCanvas(src, tw, th);
      const g = C.readData(small), lumi = C.grayArray(g);
      const sorted = Array.from(lumi).sort((a, b) => a - b);
      const t1 = sorted[Math.floor(sorted.length * (p.levels === 2 ? 0.5 : 0.33))], t2 = sorted[Math.floor(sorted.length * 0.66)];
      return C.draw(w, h, (x) => {
        for (let k = 0; k < n * n; k++) {
          const pal = WARHOL[(k + p.seed) % WARHOL.length].map(C.hexToRgb);
          const d = new ImageData(g.width, g.height);
          for (let j = 0; j < lumi.length; j++) {
            const L = lumi[j], c = p.levels === 2 ? (L < t1 ? pal[0] : pal[2]) : L < t1 ? pal[0] : L < t2 ? pal[1] : pal[2];
            d.data.set([c[0], c[1], c[2], g.data[j * 4 + 3]], j * 4);
          }
          x.drawImage(C.writeData(d), (k % n) * tw, Math.floor(k / n) * th, tw, th);
        }
      });
    },
  },
  {
    id: 'bayer-filter', name: 'Bayer Sensor Mosaic', cat, tags: 'raw sensor rggb camera',
    desc: 'Show the image as a camera sensor sees it through its RGGB color filter array.',
    params: [range('cell', 'Cell size', 1, 12, 3, 1, 'px')],
    run: (src, p, env) => {
      const cs = Math.max(1, Math.round(p.cell * Math.max(env.s, 0.5)));
      return C.perPixel(src, (a, i) => {
        const j = i / 4, x = Math.floor((j % src.width) / cs), y = Math.floor(Math.floor(j / src.width) / cs);
        const ch = (y % 2) * 2 + (x % 2); // 0 R, 1 G, 2 G, 3 B
        if (ch !== 0) a[i] = 0;
        if (ch !== 1 && ch !== 2) a[i + 1] = 0;
        if (ch !== 3) a[i + 2] = 0;
      });
    },
  },
  {
    id: 'night-vision', name: 'Night Vision', cat, tags: 'green military goggles',
    desc: 'Green phosphor night-vision goggles with noise and scanlines.',
    params: [range('noise', 'Noise', 0, 100, 35), range('glow', 'Brightness', 0, 100, 50)],
    run: (src, p) => {
      const rand = C.rng(5), w = src.width, h = src.height, b = 1 + p.glow / 60;
      return C.perPixel(src, (a, i) => {
        const j = i / 4, x = j % w, y = (j / w) | 0;
        const dx = x / w - 0.5, dy = y / h - 0.5, vig = 1 - C.smoothstep(0.3, 0.72, Math.sqrt(dx * dx + dy * dy));
        let l = C.luma(a[i], a[i + 1], a[i + 2]) * b + (rand() - 0.5) * p.noise;
        l *= vig * (y % 3 === 0 ? 0.82 : 1);
        a[i] = l * 0.25; a[i + 1] = l; a[i + 2] = l * 0.3;
      });
    },
  },
  {
    id: 'infrared', name: 'Infrared Film', cat, tags: 'ir aerochrome false color foliage',
    desc: 'Infrared film simulation — foliage turns bright (B&W) or pink (Aerochrome).',
    params: [select('m', 'Style', [['bw', 'B&W infrared'], ['aero', 'Aerochrome (false color)']]), range('glow', 'Glow', 0, 100, 30)],
    run: (src, p, env) => {
      let out = C.perPixel(src, (a, i) => {
        const r = a[i], g = a[i + 1], b = a[i + 2];
        if (p.m === 'bw') { a[i] = a[i + 1] = a[i + 2] = -0.3 * r + 1.6 * g - 0.2 * b; }
        else { a[i] = g * 1.2 + r * 0.2; a[i + 1] = r * 0.9; a[i + 2] = b * 0.9 + 20; }
      });
      if (p.glow) out = C.blend(out, C.blur(out, 12 * env.s), 'screen', p.glow / 200);
      return out;
    },
  },
];
