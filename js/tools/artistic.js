// Artistic & stylize effects: drawing, painting, print, retro, mosaic.
import * as C from '../core.js';
import { range, select, bool, color, seed, text, when, PALETTES, PALETTE_OPTIONS } from '../params.js';
import { vignette } from './blur.js';
import { unsharp } from './adjust.js';

const cat = 'artistic';

function dodgeSketch(src, r, colorize = false, strength = 1) {
  const d = C.readData(src), a = d.data, w = d.width, h = d.height;
  const inv = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 4) {
    if (colorize) { inv[i] = 255 - a[i]; inv[i + 1] = 255 - a[i + 1]; inv[i + 2] = 255 - a[i + 2]; }
    else { const l = C.luma(a[i], a[i + 1], a[i + 2]); inv[i] = inv[i + 1] = inv[i + 2] = 255 - l; }
    inv[i + 3] = 255;
  }
  const b = C.blurFloat(inv, w, h, r);
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const base = colorize ? a[i + c] : C.luma(a[i], a[i + 1], a[i + 2]);
      let v = Math.min(255, (base * 255) / Math.max(1, 255 - b[i + c]));
      v = 255 - (255 - v) * strength;
      a[i + c] = v;
    }
  }
  return C.writeData(d);
}
function kuwahara(src, r) {
  const d = C.readData(src), w = d.width, h = d.height, I = C.integral(d);
  const out = new ImageData(w, h), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = Infinity, br = 0, bg = 0, bb = 0;
    for (let q = 0; q < 4; q++) {
      const x0 = q & 1 ? x : Math.max(0, x - r), x1 = q & 1 ? Math.min(w, x + r + 1) : x + 1;
      const y0 = q & 2 ? y : Math.max(0, y - r), y1 = q & 2 ? Math.min(h, y + r + 1) : y + 1;
      const n = (x1 - x0) * (y1 - y0);
      const m = I.box(I.lum, x0, y0, x1, y1) / n, v = I.box(I.lum2, x0, y0, x1, y1) / n - m * m;
      if (v < best) { best = v; br = I.box(I.ch[0], x0, y0, x1, y1) / n; bg = I.box(I.ch[1], x0, y0, x1, y1) / n; bb = I.box(I.ch[2], x0, y0, x1, y1) / n; }
    }
    const i = (y * w + x) * 4;
    o[i] = br; o[i + 1] = bg; o[i + 2] = bb; o[i + 3] = d.data[i + 3];
  }
  return C.writeData(out);
}
function edgeMap(src, blurR = 0) {
  const s = blurR ? C.blur(src, blurR) : src;
  const d = C.readData(s);
  return { ...C.sobel(C.grayArray(d), d.width, d.height), w: d.width, h: d.height };
}
/** Voronoi on a jittered grid. Returns per-pixel {id index, f1, f2} and site list. */
function voronoi(w, h, cell, rand, jitter = 0.9) {
  const gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1, sites = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) sites.push([(gx + 0.5 + (rand() - 0.5) * jitter) * cell, (gy + 0.5 + (rand() - 0.5) * jitter) * cell]);
  const id = new Int32Array(w * h), f1 = new Float32Array(w * h), f2 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    let d1 = Infinity, d2 = Infinity, bi = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const sx = gx + ox, sy = gy + oy;
      if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue;
      const k = sy * gw + sx, s = sites[k], dd = (s[0] - x) ** 2 + (s[1] - y) ** 2;
      if (dd < d1) { d2 = d1; d1 = dd; bi = k; } else if (dd < d2) d2 = dd;
    }
    const j = y * w + x; id[j] = bi; f1[j] = Math.sqrt(d1); f2[j] = Math.sqrt(d2);
  }
  return { id, f1, f2, sites };
}
function avgPerSite(d, vor) {
  const n = vor.sites.length, sum = new Float64Array(n * 4), a = d.data;
  for (let j = 0; j < vor.id.length; j++) { const k = vor.id[j] * 4, i = j * 4; sum[k] += a[i]; sum[k + 1] += a[i + 1]; sum[k + 2] += a[i + 2]; sum[k + 3]++; }
  return sum;
}
const CHARSETS = { standard: ' .:-=+*#%@', blocks: ' ░▒▓█', detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$", binary: ' 01', dots: ' ⠁⠃⠇⠏⠟⠿⡿⣿' };

export default [
  {
    id: 'pencil-sketch', name: 'Pencil Drawing', cat, tags: 'sketch drawing graphite pencil',
    desc: 'Turn a photo into a graphite pencil sketch.',
    params: [range('r', 'Stroke width', 1, 30, 6, 0.5, 'px'), range('dark', 'Darkness', 0, 100, 40), range('tex', 'Paper texture', 0, 100, 20)],
    run: (src, p, env) => {
      let out = dodgeSketch(src, Math.max(0.8, p.r * env.s), false, 1);
      out = C.applyLut(out, C.makeLut((i) => 255 * Math.pow(i / 255, 1 + p.dark / 25)));
      if (p.tex) {
        const rand = C.rng(3);
        out = C.perPixel(out, (a, i) => { const n = (rand() - 0.5) * p.tex * 0.6; a[i] += n; a[i + 1] += n; a[i + 2] += n; });
      }
      return out;
    },
  },
  {
    id: 'color-pencil', name: 'Colored Pencils', cat, tags: 'crayon drawing color sketch',
    desc: 'A colored-pencil drawing with visible strokes.',
    params: [range('r', 'Stroke width', 1, 30, 5, 0.5, 'px'), range('sat', 'Color intensity', 0, 200, 110, 1, '%'), range('dark', 'Line darkness', 0, 100, 35)],
    run: (src, p, env) => {
      let sk = dodgeSketch(src, Math.max(0.8, p.r * env.s), false, 1);
      sk = C.applyLut(sk, C.makeLut((i) => 255 * Math.pow(i / 255, 1 + p.dark / 25)));
      const col = C.perPixel(src, (a, i) => { const l = C.luma(a[i], a[i + 1], a[i + 2]), k = p.sat / 100; a[i] = l + (a[i] - l) * k; a[i + 1] = l + (a[i + 1] - l) * k; a[i + 2] = l + (a[i + 2] - l) * k; });
      const tinted = C.blend(sk, col, 'color', 1);
      return C.blend(tinted, sk, 'multiply', 0.6);
    },
  },
  {
    id: 'charcoal', name: 'Charcoal Drawing', cat, tags: 'charcoal sketch drawing smudge',
    desc: 'Bold, smudgy charcoal strokes on paper.',
    params: [range('r', 'Smudge', 0, 10, 1.5, 0.1, 'px'), range('str', 'Line strength', 10, 300, 120, 1, '%'), range('tone', 'Shading', 0, 100, 40)],
    run: (src, p, env) => {
      const { mag, w, h } = edgeMap(src, Math.max(0.5, p.r * env.s));
      const g = C.grayArray(C.readData(C.blur(src, 4 * env.s)));
      const d = new ImageData(w, h), a = d.data, k = p.str / 100, rand = C.rng(9);
      for (let j = 0; j < mag.length; j++) {
        let v = 255 - Math.min(255, mag[j] * k);
        v -= (255 - g[j]) * (p.tone / 100) * 0.6;
        v += (rand() - 0.5) * 18;
        a[j * 4] = a[j * 4 + 1] = a[j * 4 + 2] = v; a[j * 4 + 3] = 255;
      }
      return C.blur(C.writeData(d), 0.6 * env.s);
    },
  },
  {
    id: 'chalk', name: 'Chalk Drawing', cat, tags: 'chalkboard blackboard chalk',
    desc: 'Chalk lines on a blackboard.',
    params: [color('board', 'Board color', '#1f3a2c'), color('chalk', 'Chalk color', '#f4f1e8'), range('str', 'Line strength', 10, 300, 140, 1, '%'), range('fill', 'Shading', 0, 100, 25)],
    run: (src, p, env) => {
      const { mag, w, h } = edgeMap(src, 1.2 * env.s), g = C.grayArray(C.readData(src));
      const bd = C.hexToRgb(p.board), ck = C.hexToRgb(p.chalk), rand = C.rng(4);
      const d = new ImageData(w, h), a = d.data, k = p.str / 100;
      for (let j = 0; j < mag.length; j++) {
        let t = Math.min(1, (mag[j] * k) / 255) + (g[j] / 255) * (p.fill / 100) * 0.5;
        t *= 0.65 + rand() * 0.5;
        t = C.clamp(t, 0, 1);
        for (let c = 0; c < 3; c++) a[j * 4 + c] = bd[c] + (ck[c] - bd[c]) * t;
        a[j * 4 + 3] = 255;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'cartoon', name: 'Cartoon', cat, tags: 'comic toon cel shading',
    desc: 'Flat cel-shaded colors with bold ink outlines.',
    params: [range('smooth', 'Smoothing', 1, 8, 3, 1), range('levels', 'Color levels', 2, 12, 6), range('edge', 'Outline strength', 0, 100, 60), range('thick', 'Outline thickness', 0, 4, 1, 0.5, 'px')],
    run: (src, p, env) => {
      let base = kuwahara(src, Math.max(1, Math.round(p.smooth * Math.max(env.s, 0.5))));
      const step = 255 / (p.levels - 1);
      base = C.applyLut(base, C.makeLut((i) => Math.round(i / step) * step));
      const { mag } = edgeMap(src, Math.max(0.7, (1 + p.thick) * env.s));
      const t = 255 - p.edge * 2.2;
      const d = C.readData(base), a = d.data;
      for (let j = 0; j < mag.length; j++) {
        const k = C.smoothstep(t - 30, t + 30, mag[j]);
        a[j * 4] *= 1 - k; a[j * 4 + 1] *= 1 - k; a[j * 4 + 2] *= 1 - k;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'oil-paint', name: 'Oil Painting', cat, tags: 'painting kuwahara brush art',
    desc: 'Painterly Kuwahara filter: flat brush-like patches that keep edges crisp.',
    params: [range('r', 'Brush size', 1, 12, 4, 1, 'px'), range('detail', 'Texture', 0, 100, 30)],
    run: (src, p, env) => {
      let out = kuwahara(src, Math.max(1, Math.round(p.r * Math.max(env.s, 0.4))));
      if (p.detail) out = C.blend(out, C.convolve(out, [-1, -1, 0, -1, 1, 1, 0, 1, 1], { divisor: 1, offset: 0, gray: true }), 'soft-light', p.detail / 100 * 0.5);
      return out;
    },
  },
  {
    id: 'watercolor', name: 'Watercolor', cat, tags: 'painting paper wash',
    desc: 'Soft watercolor washes with darkened edges and paper grain.',
    params: [range('r', 'Wash size', 1, 10, 4, 1, 'px'), range('edge', 'Edge darkening', 0, 100, 50), range('paper', 'Paper texture', 0, 100, 40)],
    run: (src, p, env) => {
      let out = kuwahara(C.blur(src, 1.2 * env.s), Math.max(1, Math.round(p.r * Math.max(env.s, 0.4))));
      out = C.perPixel(out, (a, i) => { for (let c = 0; c < 3; c++) a[i + c] = 255 - (255 - a[i + c]) * 0.85; });
      const { mag } = edgeMap(out, 1);
      const w = out.width, rand = C.rng(2), d = C.readData(out), a = d.data;
      for (let j = 0; j < mag.length; j++) {
        const x = j % w, y = (j / w) | 0;
        const paper = (C.fbm(x / (3 + 3 * env.s), y / (3 + 3 * env.s), 3, 5) - 0.5) * p.paper * 0.9 + (rand() - 0.5) * p.paper * 0.2;
        const e = Math.min(1, mag[j] / 200) * (p.edge / 100) * 60;
        for (let c = 0; c < 3; c++) a[j * 4 + c] = a[j * 4 + c] - e + paper;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'emboss', name: 'Emboss', cat, tags: 'relief 3d metal',
    desc: 'Raised relief effect.',
    params: [range('angle', 'Light angle', 0, 360, 135, 1, '°'), range('str', 'Strength', 1, 10, 2, 0.1), bool('color', 'Keep color')],
    run: (src, p) => {
      const a = (p.angle * Math.PI) / 180, dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a)), s = p.str;
      const k = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      k[(1 - dy) * 3 + (1 - dx)] = -s; k[(1 + dy) * 3 + (1 + dx)] = s;
      const out = C.convolve(src, k, { divisor: 1, offset: 128, gray: true });
      return p.color ? C.blend(src, out, 'overlay', 1) : out;
    },
  },
  {
    id: 'edges', name: 'Edge Detection', cat, tags: 'sobel outline lines contour',
    desc: 'Find edges with a Sobel operator.',
    params: [select('style', 'Style', [['dark', 'White on black'], ['light', 'Black on white'], ['color', 'Neon color edges']]), range('str', 'Strength', 10, 400, 150, 1, '%'), range('pre', 'Pre-blur', 0, 6, 0.8, 0.1, 'px')],
    run: (src, p, env) => {
      const { mag, ang, w, h } = edgeMap(src, p.pre * env.s), k = p.str / 100;
      const d = new ImageData(w, h), a = d.data, s = C.readData(src).data;
      for (let j = 0; j < mag.length; j++) {
        const v = Math.min(255, mag[j] * k * 0.5), i = j * 4;
        if (p.style === 'color') { const [r, g, b] = C.hslToRgb((ang[j] / Math.PI + 1) / 2, 1, 0.5); a[i] = (r * v) / 255; a[i + 1] = (g * v) / 255; a[i + 2] = (b * v) / 255; }
        else { const o = p.style === 'dark' ? v : 255 - v; a[i] = a[i + 1] = a[i + 2] = o; }
        a[i + 3] = s[i + 3];
      }
      return C.writeData(d);
    },
  },
  {
    id: 'engraving', name: 'Engraving', cat, tags: 'etching banknote lines woodcut',
    desc: 'Banknote-style engraving made of lines whose thickness follows the tones.',
    params: [range('sp', 'Line spacing', 2, 30, 6, 0.5, 'px'), range('angle', 'Angle', -90, 90, 30, 1, '°'), range('wave', 'Waviness', 0, 100, 25), color('ink', 'Ink', '#1b1b2f'), color('paper', 'Paper', '#f5efe0')],
    run: (src, p, env) => {
      const sp = Math.max(1.5, p.sp * env.s), A = (p.angle * Math.PI) / 180, ca = Math.cos(A), sa = Math.sin(A);
      const g = C.grayArray(C.readData(C.blur(src, sp * 0.3))), w = src.width, h = src.height;
      const ink = C.hexToRgb(p.ink), pap = C.hexToRgb(p.paper), d = new ImageData(w, h), a = d.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = y * w + x, u = x * ca + y * sa, v = -x * sa + y * ca;
        const off = Math.sin(u / (sp * 6)) * sp * (p.wave / 100) * 1.2;
        const ph = ((v + off) / sp) % 1, dist = Math.abs((ph < 0 ? ph + 1 : ph) - 0.5) * 2;
        const thick = 1 - g[j] / 255, edge = 1 / sp;
        const t = 1 - C.smoothstep(thick - edge, thick + edge, dist);
        for (let c = 0; c < 3; c++) a[j * 4 + c] = pap[c] + (ink[c] - pap[c]) * t;
        a[j * 4 + 3] = 255;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'halftone', name: 'Halftone', cat, tags: 'comic print dots newspaper cmyk',
    desc: 'Print-style halftone dots — mono or full CMYK screen.',
    params: [select('mode', 'Mode', [['mono', 'Black dots'], ['cmyk', 'CMYK color'], ['color', 'Colored dots']]), range('cell', 'Dot spacing', 3, 40, 8, 0.5, 'px'), range('angle', 'Angle', 0, 90, 45, 1, '°'), color('bg', 'Paper', '#ffffff')],
    run: (src, p, env) => {
      const w = src.width, h = src.height, cell = Math.max(2, p.cell * env.s), sd = C.readData(src).data;
      const sample = (x, y) => { const i = (C.clamp(Math.round(y), 0, h - 1) * w + C.clamp(Math.round(x), 0, w - 1)) * 4; return [sd[i], sd[i + 1], sd[i + 2]]; };
      const screen = (x, angleDeg, valueFn, fill) => {
        const A = (angleDeg * Math.PI) / 180, ca = Math.cos(A), sa = Math.sin(A), R = Math.hypot(w, h);
        x.fillStyle = fill;
        for (let v = -R; v < R; v += cell) for (let u = -R; u < R; u += cell) {
          const cx = w / 2 + u * ca - v * sa, cy = h / 2 + u * sa + v * ca;
          if (cx < -cell || cy < -cell || cx > w + cell || cy > h + cell) continue;
          const [val, col] = valueFn(sample(cx, cy));
          if (val <= 0.01) continue;
          if (col) x.fillStyle = col;
          x.beginPath(); x.arc(cx, cy, Math.sqrt(val) * cell * 0.71, 0, Math.PI * 2); x.fill();
        }
      };
      return C.draw(w, h, (x) => {
        x.fillStyle = p.bg; x.fillRect(0, 0, w, h);
        if (p.mode === 'mono') screen(x, p.angle, (c) => [1 - C.luma(...c) / 255], '#000');
        else if (p.mode === 'color') screen(x, p.angle, (c) => [1 - C.luma(...c) / 255 * 0.85, `rgb(${c})`], '#000');
        else {
          x.globalCompositeOperation = 'multiply';
          const cmyk = (c) => { const k = 1 - Math.max(...c) / 255; return [(1 - c[0] / 255 - k) / (1 - k || 1), (1 - c[1] / 255 - k) / (1 - k || 1), (1 - c[2] / 255 - k) / (1 - k || 1), k]; };
          screen(x, p.angle + 15, (c) => [cmyk(c)[0]], '#00aeef');
          screen(x, p.angle + 75, (c) => [cmyk(c)[1]], '#ec008c');
          screen(x, p.angle, (c) => [cmyk(c)[2]], '#fff200');
          screen(x, p.angle + 45, (c) => [cmyk(c)[3]], '#231f20');
        }
      });
    },
  },
  {
    id: 'dot-pattern', name: 'Dot Pattern', cat, tags: 'dots circles grid led',
    desc: 'Rebuild the image as a grid of colored dots.',
    params: [range('cell', 'Cell size', 3, 60, 12, 1, 'px'), range('fill', 'Dot size', 20, 100, 85, 1, '%'), bool('var', 'Size follows brightness'), color('bg', 'Background', '#111111')],
    run: (src, p, env) => {
      const w = src.width, h = src.height, cell = Math.max(2, p.cell * env.s);
      const sm = C.readData(C.resizeCanvas(src, Math.ceil(w / cell), Math.ceil(h / cell))), gw = sm.width;
      return C.draw(w, h, (x) => {
        x.fillStyle = p.bg; x.fillRect(0, 0, w, h);
        for (let gy = 0; gy < sm.height; gy++) for (let gx = 0; gx < gw; gx++) {
          const i = (gy * gw + gx) * 4, r = sm.data[i], g = sm.data[i + 1], b = sm.data[i + 2];
          let rad = (cell / 2) * (p.fill / 100);
          if (p.var) rad *= Math.sqrt(C.luma(r, g, b) / 255);
          x.fillStyle = `rgb(${r},${g},${b})`;
          x.beginPath(); x.arc(gx * cell + cell / 2, gy * cell + cell / 2, rad, 0, Math.PI * 2); x.fill();
        }
      });
    },
  },
  {
    id: 'stencil', name: 'Stencil', cat, tags: 'graffiti stencil banksy poster',
    desc: 'Hard-edged stencil art — black & white or in posterized colors.',
    params: [select('mode', 'Mode', [['bw', 'Black & white'], ['tones', '3 tones'], ['color', 'Colored']]), range('t', 'Threshold', 0, 255, 120), range('smooth', 'Smoothness', 0, 10, 2.5, 0.5, 'px'), color('c1', 'Ink', '#111111'), color('c2', 'Paper', '#f2f2f2')],
    run: (src, p, env) => {
      const b = C.blur(src, p.smooth * env.s);
      if (p.mode === 'color') {
        const pal = C.medianCut(C.samplePixels(C.readData(b)), 6);
        return C.mapToPalette(b, pal, 'none');
      }
      const ink = C.hexToRgb(p.c1), pap = C.hexToRgb(p.c2), mid = ink.map((v, i) => (v + pap[i]) / 2);
      return C.perPixel(b, (a, i) => {
        const l = C.luma(a[i], a[i + 1], a[i + 2]);
        const c = p.mode === 'bw' ? (l < p.t ? ink : pap) : l < p.t * 0.7 ? ink : l < p.t * 1.3 ? mid : pap;
        a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2];
      });
    },
  },
  {
    id: 'mosaic', name: 'Mosaic Tiles', cat, tags: 'tiles ceramic grout mosaic',
    desc: 'Square ceramic tiles with grout lines.',
    params: [range('size', 'Tile size', 4, 80, 18, 1, 'px'), range('grout', 'Grout width', 0, 10, 2, 0.5, 'px'), color('gc', 'Grout color', '#e8e4dc'), range('bevel', 'Bevel', 0, 100, 40)],
    run: (src, p, env) => {
      const w = src.width, h = src.height, s = Math.max(3, p.size * env.s), g = p.grout * env.s;
      const sm = C.readData(C.resizeCanvas(src, Math.ceil(w / s), Math.ceil(h / s)));
      return C.draw(w, h, (x) => {
        x.fillStyle = p.gc; x.fillRect(0, 0, w, h);
        for (let ty = 0; ty < sm.height; ty++) for (let tx = 0; tx < sm.width; tx++) {
          const i = (ty * sm.width + tx) * 4, X = tx * s + g / 2, Y = ty * s + g / 2, S = s - g;
          const grd = x.createLinearGradient(X, Y, X + S, Y + S), k = p.bevel / 100 * 40;
          const [r, gg, b] = [sm.data[i], sm.data[i + 1], sm.data[i + 2]];
          grd.addColorStop(0, `rgb(${r + k},${gg + k},${b + k})`); grd.addColorStop(1, `rgb(${r - k},${gg - k},${b - k})`);
          x.fillStyle = grd; x.fillRect(X, Y, S, S);
        }
      });
    },
  },
  {
    id: 'crystallize', name: 'Crystallize', cat, tags: 'voronoi stained glass polygon cells',
    desc: 'Break the image into irregular crystal cells (stained-glass look with outlines).',
    params: [range('cell', 'Cell size', 4, 100, 20, 1, 'px'), range('line', 'Lead lines', 0, 8, 0, 0.5, 'px'), color('lc', 'Line color', '#1a1a1a'), seed()],
    run: (src, p, env) => {
      const w = src.width, h = src.height, d = C.readData(src), vor = voronoi(w, h, Math.max(3, p.cell * env.s), C.rng(p.seed));
      const sum = avgPerSite(d, vor), a = d.data, lc = C.hexToRgb(p.lc), lw = p.line * env.s;
      for (let j = 0; j < vor.id.length; j++) {
        const k = vor.id[j] * 4, n = sum[k + 3] || 1, i = j * 4;
        const t = lw ? 1 - C.smoothstep(lw * 0.5, lw * 0.5 + 1, vor.f2[j] - vor.f1[j]) : 0;
        for (let c = 0; c < 3; c++) a[i + c] = sum[k + c] / n + (lc[c] - sum[k + c] / n) * t;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'cracked', name: 'Cracked Paint', cat, tags: 'craquelure cracks old painting',
    desc: 'Aged craquelure cracks over the image.',
    params: [range('cell', 'Crack spacing', 5, 120, 28, 1, 'px'), range('width', 'Crack width', 0.5, 6, 1.2, 0.1, 'px'), range('depth', 'Depth', 0, 100, 65), seed()],
    run: (src, p, env) => {
      const w = src.width, h = src.height, vor = voronoi(w, h, Math.max(3, p.cell * env.s), C.rng(p.seed), 1);
      const lw = Math.max(0.5, p.width * env.s), k = p.depth / 100;
      return C.perPixel(src, (a, i) => {
        const j = i / 4, e = vor.f2[j] - vor.f1[j];
        const wob = C.valueNoise((j % w) / 6, ((j / w) | 0) / 6, p.seed) * lw;
        const t = (1 - C.smoothstep(0, lw + wob, e)) * k, hl = (1 - C.smoothstep(lw + wob, lw * 2 + wob, e)) * k * 0.25;
        for (let c = 0; c < 3; c++) a[i + c] = a[i + c] * (1 - t * 0.85) + hl * 40;
      });
    },
  },
  {
    id: 'pointillism', name: 'Pointillism', cat, tags: 'seurat dots painting',
    desc: 'Painted with thousands of colored dots, like Seurat.',
    params: [range('size', 'Dot size', 1, 20, 4, 0.5, 'px'), range('density', 'Density', 20, 300, 120, 1, '%'), range('jitter', 'Color variation', 0, 60, 20), color('bg', 'Canvas', '#f6f1e7'), seed()],
    run: (src, p, env) => {
      const w = src.width, h = src.height, r = Math.max(1, p.size * env.s), rand = C.rng(p.seed), sd = C.readData(src).data;
      const n = Math.min(400000, Math.round(((w * h) / (r * r * 3)) * (p.density / 100)));
      return C.draw(w, h, (x) => {
        x.fillStyle = p.bg; x.fillRect(0, 0, w, h);
        for (let k = 0; k < n; k++) {
          const cx = rand() * w, cy = rand() * h, i = ((cy | 0) * w + (cx | 0)) * 4, j = (rand() - 0.5) * p.jitter * 2;
          x.fillStyle = `rgb(${sd[i] + j},${sd[i + 1] + j},${sd[i + 2] + j})`;
          x.beginPath(); x.arc(cx, cy, r * (0.6 + rand() * 0.6), 0, Math.PI * 2); x.fill();
        }
      });
    },
  },
  {
    id: 'brush-strokes', name: 'Brush Strokes', cat, tags: 'impressionist painting abstraction strokes',
    desc: 'Impressionist abstraction made of short strokes that follow the image contours.',
    params: [range('len', 'Stroke length', 3, 60, 14, 1, 'px'), range('width', 'Stroke width', 1, 20, 4, 0.5, 'px'), range('density', 'Density', 20, 300, 100, 1, '%'), seed()],
    run: (src, p, env) => {
      const w = src.width, h = src.height, L = Math.max(2, p.len * env.s), W = Math.max(1, p.width * env.s), rand = C.rng(p.seed);
      const { ang } = edgeMap(src, 2 * env.s), sd = C.readData(src).data;
      const n = Math.min(300000, Math.round(((w * h) / (L * W)) * 1.4 * (p.density / 100)));
      return C.draw(w, h, (x) => {
        x.drawImage(C.blur(src, L * 0.5), 0, 0);
        x.lineCap = 'round'; x.lineWidth = W;
        for (let k = 0; k < n; k++) {
          const cx = rand() * w, cy = rand() * h, j = (cy | 0) * w + (cx | 0), i = j * 4;
          const a = ang[j] + Math.PI / 2 + (rand() - 0.5) * 0.4, dx = (Math.cos(a) * L) / 2, dy = (Math.sin(a) * L) / 2;
          x.strokeStyle = `rgb(${sd[i]},${sd[i + 1]},${sd[i + 2]})`;
          x.beginPath(); x.moveTo(cx - dx, cy - dy); x.lineTo(cx + dx, cy + dy); x.stroke();
        }
      });
    },
  },
  {
    id: 'glitch', name: 'Glitch', cat, tags: 'datamosh vhs corrupt digital error',
    desc: 'Digital corruption: sliced rows, channel shifts and blocky artifacts.',
    params: [range('amt', 'Intensity', 0, 100, 45), range('slices', 'Slices', 0, 60, 18), range('rgb', 'RGB split', 0, 50, 10, 1, 'px'), seed()],
    run: (src, p, env) => {
      const w = src.width, h = src.height, rand = C.rng(p.seed), k = p.amt / 100;
      let out = C.draw(w, h, (x) => {
        x.drawImage(src, 0, 0);
        for (let i = 0; i < p.slices; i++) {
          const y = rand() * h, sh = (rand() * 0.08 + 0.005) * h, dx = (rand() - 0.5) * w * 0.3 * k;
          x.drawImage(src, 0, y, w, sh, dx, y, w, sh);
        }
      });
      const L = p.rgb * env.s;
      if (L) {
        const d = C.readData(out), s = Uint8ClampedArray.from(d.data), a = d.data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, xr = C.clamp(Math.round(x + L), 0, w - 1), xb = C.clamp(Math.round(x - L), 0, w - 1);
          a[i] = s[(y * w + xr) * 4]; a[i + 2] = s[(y * w + xb) * 4 + 2];
        }
        out = C.writeData(d);
      }
      return C.draw(w, h, (x) => {
        x.drawImage(out, 0, 0);
        const n = Math.round(12 * k);
        for (let i = 0; i < n; i++) {
          const bw = rand() * w * 0.2, bh = rand() * h * 0.05, sx = rand() * w, sy = rand() * h;
          x.globalCompositeOperation = rand() > 0.5 ? 'difference' : 'source-over';
          x.drawImage(out, sx, sy, bw, bh, sx + (rand() - 0.5) * 40 * env.s, sy, bw, bh);
        }
      });
    },
  },
  {
    id: 'pixel-sort', name: 'Pixel Sort', cat, tags: 'glitch art sorting streaks',
    desc: 'Glitch-art pixel sorting: runs of pixels within a brightness band get sorted.',
    params: [select('dir', 'Direction', [['h', 'Horizontal'], ['v', 'Vertical']]), range('lo', 'Lower threshold', 0, 255, 60), range('hi', 'Upper threshold', 0, 255, 210), bool('rev', 'Reverse order')],
    run: (src, p) => {
      const d = C.readData(src), a = d.data, w = d.width, h = d.height, H = p.dir === 'h';
      const lines = H ? h : w, len = H ? w : h;
      const idx = (l, t) => (H ? l * w + t : t * w + l) * 4;
      for (let l = 0; l < lines; l++) {
        let t = 0;
        while (t < len) {
          while (t < len) { const i = idx(l, t), L = C.luma(a[i], a[i + 1], a[i + 2]); if (L >= p.lo && L <= p.hi) break; t++; }
          const start = t, run = [];
          while (t < len) { const i = idx(l, t), L = C.luma(a[i], a[i + 1], a[i + 2]); if (L < p.lo || L > p.hi) break; run.push([L, a[i], a[i + 1], a[i + 2], a[i + 3]]); t++; }
          run.sort((x, y) => (p.rev ? y[0] - x[0] : x[0] - y[0]));
          run.forEach((px, k) => { const i = idx(l, start + k); a[i] = px[1]; a[i + 1] = px[2]; a[i + 2] = px[3]; a[i + 3] = px[4]; });
        }
      }
      return C.writeData(d);
    },
  },
  {
    id: 'ascii', name: 'ASCII Art', cat, tags: 'text characters terminal matrix',
    desc: 'Rebuild the image out of text characters.',
    params: [range('cell', 'Character size', 4, 40, 10, 1, 'px'), select('set', 'Characters', [['standard', 'Standard'], ['detailed', 'Detailed (70)'], ['blocks', 'Blocks'], ['binary', 'Binary 0/1'], ['dots', 'Braille dots']]), select('mode', 'Color', [['color', 'Colored'], ['mono', 'Green terminal'], ['ink', 'Black on white'], ['white', 'White on black']]), bool('invert', 'Invert brightness')],
    run: (src, p, env) => {
      const w = src.width, h = src.height, cs = Math.max(3, p.cell * env.s), chars = CHARSETS[p.set];
      const cols = Math.ceil(w / (cs * 0.6)), rows = Math.ceil(h / cs);
      const sm = C.readData(C.resizeCanvas(src, cols, rows)).data;
      const light = p.mode === 'ink';
      return C.draw(w, h, (x) => {
        x.fillStyle = light ? '#fff' : '#000'; x.fillRect(0, 0, w, h);
        x.font = `${cs}px ui-monospace, Menlo, Consolas, monospace`; x.textBaseline = 'top';
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const i = (r * cols + c) * 4;
          let L = C.luma(sm[i], sm[i + 1], sm[i + 2]) / 255;
          if (light) L = 1 - L;
          if (p.invert) L = 1 - L;
          const ch = chars[Math.min(chars.length - 1, Math.floor(L * chars.length))];
          if (ch === ' ') continue;
          x.fillStyle = p.mode === 'color' ? `rgb(${sm[i]},${sm[i + 1]},${sm[i + 2]})` : p.mode === 'mono' ? '#33ff66' : light ? '#111' : '#eee';
          x.fillText(ch, c * cs * 0.6, r * cs);
        }
      });
    },
  },
  {
    id: 'pixel-art', name: '8-bit Pixel Art', cat, tags: 'retro game sprite nes gameboy 8bit',
    desc: 'Retro 8-bit look: chunky pixels snapped to a console palette.',
    params: [range('size', 'Pixel size', 2, 40, 8, 1, 'px'), select('palette', 'Palette', PALETTE_OPTIONS, 'pico8'), when((p) => p.palette === 'auto', range('n', 'Colors', 2, 64, 12)), select('dither', 'Dithering', [['none', 'None'], ['bayer4', 'Ordered'], ['fs', 'Floyd–Steinberg']]), bool('grid', 'Show pixel grid')],
    run: (src, p, env) => {
      const s = Math.max(1, p.size * env.s), w = src.width, h = src.height;
      let sm = C.resizeCanvas(src, w / s, h / s);
      sm = C.applyLut(sm, C.makeLut((i) => (i - 128) * 1.1 + 128));
      const pal = p.palette === 'auto' ? C.medianCut(C.samplePixels(C.readData(sm)), p.n || 12) : PALETTES[p.palette];
      const q = C.mapToPalette(sm, pal, p.dither, 0.6);
      const out = C.resizeCanvas(q, w, h, false);
      if (!p.grid || s < 4) return out;
      return C.draw(w, h, (x) => {
        x.drawImage(out, 0, 0); x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1;
        const sx = w / sm.width, sy = h / sm.height;
        x.beginPath();
        for (let i = 0; i <= sm.width; i++) { x.moveTo(Math.round(i * sx) + 0.5, 0); x.lineTo(Math.round(i * sx) + 0.5, h); }
        for (let i = 0; i <= sm.height; i++) { x.moveTo(0, Math.round(i * sy) + 0.5); x.lineTo(w, Math.round(i * sy) + 0.5); }
        x.stroke();
      });
    },
  },
  {
    id: 'lego', name: 'Brick Mosaic', cat, tags: 'lego bricks toy studs',
    desc: 'Rebuild the image from toy building bricks with studs.',
    params: [range('size', 'Brick size', 6, 60, 16, 1, 'px'), select('palette', 'Colors', [['auto', 'Full color'], ['pico8', 'Limited (16)']])],
    run: (src, p, env) => {
      const w = src.width, h = src.height, s = Math.max(4, p.size * env.s);
      let sm = C.resizeCanvas(src, Math.ceil(w / s), Math.ceil(h / s));
      if (p.palette !== 'auto') sm = C.mapToPalette(sm, PALETTES[p.palette]);
      const d = C.readData(sm).data;
      return C.draw(w, h, (x) => {
        for (let ty = 0; ty < sm.height; ty++) for (let tx = 0; tx < sm.width; tx++) {
          const i = (ty * sm.width + tx) * 4, r = d[i], g = d[i + 1], b = d[i + 2], X = tx * s, Y = ty * s;
          x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(X, Y, s, s);
          x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(X, Y + s - 1, s, 1); x.fillRect(X + s - 1, Y, 1, s);
          x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(X, Y, s, 1); x.fillRect(X, Y, 1, s);
          const cx = X + s / 2, cy = Y + s / 2, rr = s * 0.3;
          x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.arc(cx + s * 0.04, cy + s * 0.06, rr, 0, 7); x.fill();
          const gr = x.createLinearGradient(cx - rr, cy - rr, cx + rr, cy + rr);
          gr.addColorStop(0, `rgb(${r + 50},${g + 50},${b + 50})`); gr.addColorStop(1, `rgb(${r - 20},${g - 20},${b - 20})`);
          x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.fill();
        }
      });
    },
  },
  {
    id: 'crt', name: 'CRT Screen', cat, tags: 'retro tv scanlines monitor vhs',
    desc: 'Old CRT monitor: scanlines, RGB phosphor mask, glow and vignette.',
    params: [range('lines', 'Scanlines', 0, 100, 55), range('mask', 'RGB mask', 0, 100, 40), range('glow', 'Glow', 0, 100, 35), range('vig', 'Vignette', 0, 100, 45), range('size', 'Line size', 1, 8, 2, 0.5, 'px')],
    run: (src, p, env) => {
      const sz = Math.max(1, p.size * Math.max(env.s, 0.5)), w = src.width;
      let out = C.perPixel(src, (a, i) => {
        const j = i / 4, x = j % w, y = (j / w) | 0;
        const sl = 1 - (p.lines / 100) * 0.6 * (Math.floor(y / sz) % 2);
        const m = Math.floor(x / sz) % 3, mk = p.mask / 100 * 0.5;
        a[i] *= sl * (m === 0 ? 1 : 1 - mk); a[i + 1] *= sl * (m === 1 ? 1 : 1 - mk); a[i + 2] *= sl * (m === 2 ? 1 : 1 - mk);
      });
      if (p.glow) out = C.blend(out, C.blur(src, 6 * env.s), 'screen', p.glow / 150);
      return vignette(out, p.vig, 55, 30, 50);
    },
  },
  {
    id: 'canvas-texture', name: 'Canvas Texture', cat, tags: 'linen fabric painting texture',
    desc: 'Print the image onto woven artist canvas.',
    params: [range('str', 'Strength', 0, 100, 45), range('scale', 'Weave size', 1, 10, 3, 0.5, 'px')],
    run: (src, p, env) => {
      const w = src.width, h = src.height, s = Math.max(1, p.scale * env.s), k = p.str / 100;
      return C.perPixel(src, (a, i) => {
        const j = i / 4, x = j % w, y = (j / w) | 0;
        const weave = Math.sin((x / s) * Math.PI) * 0.5 + Math.sin((y / s) * Math.PI) * 0.5;
        const n = C.valueNoise(x / (s * 4), y / (s * 0.8), 3) - 0.5;
        const v = (weave * 14 + n * 30) * k;
        a[i] += v; a[i + 1] += v; a[i + 2] += v;
      });
    },
  },
  {
    id: 'fairytale', name: 'Fairytale', cat, tags: 'dreamy fantasy magic glow',
    desc: 'Dreamy, glowing, saturated fairytale atmosphere.',
    params: [range('amt', 'Amount', 0, 100, 70, 1, '%'), select('mood', 'Mood', [['light', 'Light & magical'], ['dark', 'Dark fairytale']])],
    run: (src, p, env) => {
      const k = p.amt / 100;
      if (p.mood === 'dark') {
        let out = C.perPixel(src, (a, i) => { const l = C.luma(a[i], a[i + 1], a[i + 2]); a[i] = (l + (a[i] - l) * 0.6) * 0.85; a[i + 1] = (l + (a[i + 1] - l) * 0.6) * 0.9; a[i + 2] = (l + (a[i + 2] - l) * 0.6) * 1.05 + 10; });
        out = C.applyLut(out, C.makeLut((i) => 255 / (1 + Math.exp(-6 * (i / 255 - 0.45)))));
        out = C.blend(out, C.blur(out, 18 * env.s), 'soft-light', 0.7);
        return C.mix(src, vignette(out, 70, 35, 60, 60), k);
      }
      let out = C.blend(src, C.blur(src, 14 * env.s), 'screen', 0.55);
      out = C.perPixel(out, (a, i) => { const l = C.luma(a[i], a[i + 1], a[i + 2]); a[i] = l + (a[i] - l) * 1.35 + 8; a[i + 1] = l + (a[i + 1] - l) * 1.35; a[i + 2] = l + (a[i + 2] - l) * 1.35 + 12; });
      return C.mix(src, vignette(out, -35, 55, 60, 70), k);
    },
  },
  {
    id: 'chessboard', name: 'Chessboard Overlay', cat, tags: 'checker grid overlay',
    desc: 'Overlay a semi-transparent checkerboard.',
    params: [range('size', 'Square size', 5, 300, 60, 1, 'px'), color('c1', 'Color A', '#000000'), color('c2', 'Color B', '#ffffff'), range('op', 'Opacity', 0, 100, 30, 1, '%'), select('mode', 'Blend', [['source-over', 'Normal'], ['overlay', 'Overlay'], ['multiply', 'Multiply'], ['difference', 'Difference']])],
    run: (src, p, env) => {
      const s = Math.max(2, p.size * env.s);
      const ov = C.draw(src.width, src.height, (x) => {
        for (let y = 0; y * s < src.height; y++) for (let k = 0; k * s < src.width; k++) { x.fillStyle = (y + k) % 2 ? p.c1 : p.c2; x.fillRect(k * s, y * s, s, s); }
      });
      return C.blend(src, ov, p.mode, p.op / 100);
    },
  },
  {
    id: 'tile-overlay', name: 'Colored Tiles / Squares', cat, tags: 'squares tiles random overlay',
    desc: 'Overlay a grid of randomly colored tiles or scattered squares.',
    params: [select('mode', 'Pattern', [['grid', 'Colored tile grid'], ['scatter', 'Scattered squares']]), range('size', 'Size', 5, 300, 50, 1, 'px'), range('op', 'Opacity', 0, 100, 35, 1, '%'), select('blend', 'Blend', [['overlay', 'Overlay'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['color', 'Color'], ['source-over', 'Normal']]), seed()],
    run: (src, p, env) => {
      const s = Math.max(2, p.size * env.s), rand = C.rng(p.seed), w = src.width, h = src.height;
      const ov = C.draw(w, h, (x) => {
        if (p.mode === 'grid') {
          for (let y = 0; y * s < h; y++) for (let k = 0; k * s < w; k++) { x.fillStyle = `hsl(${rand() * 360},80%,55%)`; x.fillRect(k * s, y * s, s - 1, s - 1); }
        } else {
          const n = Math.round((w * h) / (s * s) * 0.6);
          for (let i = 0; i < n; i++) { const z = s * (0.3 + rand()); x.fillStyle = `hsla(${rand() * 360},80%,60%,${0.3 + rand() * 0.7})`; x.fillRect(rand() * w - z / 2, rand() * h - z / 2, z, z); }
        }
      });
      return C.blend(src, ov, p.blend, p.op / 100);
    },
  },
];
