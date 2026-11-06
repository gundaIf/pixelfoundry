// Blur, focus, light & lens effects.
import * as C from '../core.js';
import { range, select, bool, color, seed, when } from '../params.js';

const cat = 'blur';

/** Disc (lens) blur with highlight boost, via sampling a set of disc offsets. */
function discBlur(src, radius, boost = 0) {
  const d = C.readData(src), s = d.data, w = d.width, h = d.height;
  const g = 1 + boost * 2;
  const lin = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) lin[i] = (i & 3) === 3 ? s[i] : Math.pow(s[i] / 255, g);
  const offs = [];
  const rings = Math.max(2, Math.min(6, Math.round(radius / 3)));
  for (let r = 1; r <= rings; r++) {
    const n = r * 7, rr = (r / rings) * radius;
    for (let k = 0; k < n; k++) offs.push([Math.round(Math.cos((k / n) * Math.PI * 2) * rr), Math.round(Math.sin((k / n) * Math.PI * 2) * rr)]);
  }
  offs.push([0, 0]);
  const out = new ImageData(w, h), o = out.data, n = offs.length;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, gg = 0, b = 0;
    for (let k = 0; k < n; k++) {
      const xx = C.clamp(x + offs[k][0], 0, w - 1), yy = C.clamp(y + offs[k][1], 0, h - 1), i = (yy * w + xx) * 4;
      r += lin[i]; gg += lin[i + 1]; b += lin[i + 2];
    }
    const i = (y * w + x) * 4;
    o[i] = Math.pow(r / n, 1 / g) * 255; o[i + 1] = Math.pow(gg / n, 1 / g) * 255; o[i + 2] = Math.pow(b / n, 1 / g) * 255; o[i + 3] = s[i + 3];
  }
  return C.writeData(out);
}
/** Run a heavy smooth filter at half resolution for big images, then upscale. fn(src, k) where k = scale factor applied. */
function atHalf(src, fn) {
  if (Math.max(src.width, src.height) <= 900) return fn(src, 1);
  const small = C.resizeCanvas(src, src.width / 2, src.height / 2);
  return C.resizeCanvas(fn(small, 0.5), src.width, src.height);
}
export function vignette(src, amount, size = 50, round = 50, feather = 50, col = '#000000') {
  const w = src.width, h = src.height, c = C.hexToRgb(amount < 0 ? '#ffffff' : col), k = Math.abs(amount) / 100;
  const inner = 0.15 + (size / 100) * 0.6, outer = inner + 0.05 + (feather / 100) * 0.9;
  const asp = round / 100;
  return C.perPixel(src, (a, i) => {
    const j = i / 4, x = j % w, y = (j / w) | 0;
    let dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2;
    if (w > h) dx *= 1 - (1 - h / w) * asp; else dy *= 1 - (1 - w / h) * asp;
    const r = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2 * 1.2;
    const t = C.smoothstep(inner, outer, r) * k;
    a[i] += (c[0] - a[i]) * t; a[i + 1] += (c[1] - a[i + 1]) * t; a[i + 2] += (c[2] - a[i + 2]) * t;
  });
}

export default [
  {
    id: 'gaussian-blur', name: 'Blur', cat, tags: 'gaussian soften smooth',
    desc: 'Smooth Gaussian blur.',
    params: [range('r', 'Radius', 0, 150, 6, 0.5, 'px')],
    run: (src, p, env) => C.keepAlpha(C.blur(src, p.r * env.s), src),
  },
  {
    id: 'motion-blur', name: 'Motion Blur (Linear)', cat, tags: 'speed movement directional',
    desc: 'Directional blur that simulates movement.',
    params: [range('angle', 'Angle', -180, 180, 0, 1, '°'), range('dist', 'Distance', 1, 300, 30, 1, 'px')],
    run: (src, p, env) => {
      return atHalf(src, (im, k) => {
        const L = p.dist * env.s * k, a = (p.angle * Math.PI) / 180, dx = Math.cos(a) * L, dy = Math.sin(a) * L;
        const n = C.clamp(Math.round(L), 3, 48);
        return C.multiSample(im, n, (x, y, t, q) => { q[0] = x + dx * (t - 0.5); q[1] = y + dy * (t - 0.5); });
      });
    },
  },
  {
    id: 'zoom-blur', name: 'Radial Zoom Blur', cat, tags: 'radial zoom burst speed',
    desc: 'Zoom burst blur radiating from a center point.',
    params: [range('amt', 'Strength', 1, 100, 30), range('cx', 'Center X', 0, 100, 50, 1, '%'), range('cy', 'Center Y', 0, 100, 50, 1, '%')],
    run: (src, p) => {
      return atHalf(src, (im) => {
        const cx = (p.cx / 100) * im.width, cy = (p.cy / 100) * im.height, k = p.amt / 200;
        return C.multiSample(im, 24, (x, y, t, q) => { const f = 1 - k * t; q[0] = cx + (x - cx) * f; q[1] = cy + (y - cy) * f; });
      });
    },
  },
  {
    id: 'spin-blur', name: 'Circular (Spin) Blur', cat, tags: 'rotate circular spin',
    desc: 'Rotational blur around a center point.',
    params: [range('angle', 'Angle', 1, 90, 12, 1, '°'), range('cx', 'Center X', 0, 100, 50, 1, '%'), range('cy', 'Center Y', 0, 100, 50, 1, '%')],
    run: (src, p) => {
      return atHalf(src, (im) => {
        const cx = (p.cx / 100) * im.width, cy = (p.cy / 100) * im.height, A = (p.angle * Math.PI) / 180, n = 28;
        const cs = Array.from({ length: n }, (_, k) => Math.cos(A * (k / (n - 1) - 0.5))), sn = Array.from({ length: n }, (_, k) => Math.sin(A * (k / (n - 1) - 0.5)));
        return C.multiSample(im, n, (x, y, t, q) => {
          const k = Math.round(t * (n - 1)), dx = x - cx, dy = y - cy;
          q[0] = cx + dx * cs[k] - dy * sn[k]; q[1] = cy + dx * sn[k] + dy * cs[k];
        });
      });
    },
  },
  {
    id: 'tilt-shift', name: 'Tilt-Shift (Miniature)', cat, tags: 'toy world miniature fake',
    desc: 'Make real scenes look like tiny models: focus band, blur, and toy-like color.',
    params: [
      select('shape', 'Focus shape', [['band', 'Band'], ['ellipse', 'Ellipse']]),
      range('pos', 'Focus position', 0, 100, 55, 1, '%'), range('size', 'Focus size', 2, 80, 18, 1, '%'),
      range('fade', 'Transition', 2, 80, 22, 1, '%'), when((p) => p.shape === 'band', range('angle', 'Angle', -90, 90, 0, 1, '°')),
      range('blur', 'Blur', 1, 40, 12, 0.5, 'px'), range('sat', 'Toy saturation', 0, 100, 40), range('contrast', 'Toy contrast', 0, 100, 25),
    ],
    run: (src, p, env) => {
      const w = src.width, h = src.height;
      let base = C.applyLut(src, C.makeLut((i) => (i - 128) * (1 + p.contrast / 200) + 128));
      base = C.perPixel(base, (a, i) => { const l = C.luma(a[i], a[i + 1], a[i + 2]), k = 1 + p.sat / 100; a[i] = l + (a[i] - l) * k; a[i + 1] = l + (a[i + 1] - l) * k; a[i + 2] = l + (a[i + 2] - l) * k; });
      const blurred = discBlur(C.resizeCanvas(base, w / 2, h / 2), Math.max(1, (p.blur * env.s) / 2), 0.4);
      const big = C.resizeCanvas(blurred, w, h);
      const mask = new Float32Array(w * h), A = ((p.angle || 0) * Math.PI) / 180, ca = Math.cos(A), sa = Math.sin(A);
      const half = p.size / 200, fade = p.fade / 100;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let d;
        if (p.shape === 'band') { d = Math.abs(-(x / w - 0.5) * sa + (y / h - p.pos / 100) * ca); }
        else { const dx = (x / w - 0.5) / 0.8, dy = (y / h - p.pos / 100); d = Math.sqrt(dx * dx + dy * dy); }
        mask[y * w + x] = C.smoothstep(half, half + fade, d);
      }
      return C.mix(base, big, mask);
    },
  },
  {
    id: 'lens-blur', name: 'Lens Blur (Bokeh)', cat, tags: 'bokeh depth of field disc',
    desc: 'Realistic lens blur where bright highlights bloom into bokeh discs.',
    params: [range('r', 'Radius', 1, 40, 10, 0.5, 'px'), range('boost', 'Highlight boost', 0, 100, 60, 1, '%')],
    run: (src, p, env) => discBlur(src, Math.max(1, p.r * env.s), p.boost / 100),
  },
  {
    id: 'bokeh-circles', name: 'Bokeh Light Circles', cat, tags: 'bokeh overlay lights circles blurred',
    desc: 'Overlay dreamy out-of-focus light circles.',
    params: [range('count', 'Count', 5, 200, 50), range('size', 'Size', 1, 20, 6, 0.5, '%'), range('op', 'Opacity', 5, 100, 45, 1, '%'), select('palette', 'Colors', [['image', 'From image'], ['warm', 'Warm gold'], ['rainbow', 'Rainbow'], ['white', 'White']]), seed()],
    run: (src, p) => {
      const w = src.width, h = src.height, rand = C.rng(p.seed), sm = C.resizeCanvas(src, 40, 40), sd = C.readData(sm).data;
      const overlay = C.draw(w, h, (x) => {
        x.globalCompositeOperation = 'lighter';
        for (let i = 0; i < p.count; i++) {
          const cx = rand() * w, cy = rand() * h, r = (0.3 + rand()) * (p.size / 100) * Math.max(w, h);
          let col;
          if (p.palette === 'image') { const k = (Math.floor((cy / h) * 39) * 40 + Math.floor((cx / w) * 39)) * 4; col = `rgb(${sd[k] + 60},${sd[k + 1] + 60},${sd[k + 2] + 60})`; }
          else if (p.palette === 'warm') col = `hsl(${30 + rand() * 25},95%,${60 + rand() * 20}%)`;
          else if (p.palette === 'rainbow') col = `hsl(${rand() * 360},90%,65%)`;
          else col = '#fff';
          const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, col); g.addColorStop(0.75, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          x.globalAlpha = (0.3 + rand() * 0.7) * (p.op / 100);
          x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
        }
      });
      return C.blend(src, C.blur(overlay, Math.max(w, h) / 400), 'screen', 1);
    },
  },
  {
    id: 'vignette', name: 'Vignette', cat, tags: 'dark corners edges frame',
    desc: 'Darken (or lighten) the edges to draw the eye to the center.',
    params: [range('amt', 'Amount', -100, 100, 60), range('size', 'Size', 0, 100, 45), range('feather', 'Feather', 0, 100, 60), range('round', 'Roundness', 0, 100, 60), color('c', 'Color', '#000000')],
    run: (src, p) => vignette(src, p.amt, p.size, p.round, p.feather, p.c),
  },
  {
    id: 'blur-frame', name: 'Blurred Frame', cat, tags: 'focus center edges blur vignette',
    desc: 'Keep the center sharp and blur toward the edges.',
    params: [range('size', 'Sharp area', 5, 95, 50, 1, '%'), range('feather', 'Feather', 1, 80, 30, 1, '%'), range('r', 'Blur', 1, 60, 14, 0.5, 'px'), range('cx', 'Center X', 0, 100, 50, 1, '%'), range('cy', 'Center Y', 0, 100, 50, 1, '%')],
    run: (src, p, env) => {
      const w = src.width, h = src.height, b = C.blur(src, p.r * env.s), m = new Float32Array(w * h);
      const r0 = p.size / 200, r1 = r0 + p.feather / 100;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x / w - p.cx / 100, dy = y / h - p.cy / 100;
        m[y * w + x] = C.smoothstep(r0, r1, Math.sqrt(dx * dx + dy * dy));
      }
      return C.mix(src, b, m);
    },
  },
  {
    id: 'glow', name: 'Soft Glow (Orton)', cat, tags: 'orton dreamy soft focus',
    desc: 'Dreamy soft glow by screening a blurred copy over the photo.',
    params: [range('r', 'Radius', 1, 60, 15, 0.5, 'px'), range('amt', 'Strength', 0, 100, 50, 1, '%'), select('mode', 'Blend', [['screen', 'Screen'], ['soft-light', 'Soft light'], ['overlay', 'Overlay'], ['lighten', 'Lighten']])],
    run: (src, p, env) => C.blend(src, C.blur(src, p.r * env.s), p.mode, p.amt / 100),
  },
  {
    id: 'bloom', name: 'Bloom', cat, tags: 'highlights glow cinematic',
    desc: 'Bright highlights bleed light into their surroundings.',
    params: [range('t', 'Threshold', 0, 255, 180), range('r', 'Radius', 1, 80, 20, 0.5, 'px'), range('amt', 'Intensity', 0, 200, 80, 1, '%')],
    run: (src, p, env) => {
      const hi = C.perPixel(src, (a, i) => { const l = C.luma(a[i], a[i + 1], a[i + 2]), k = C.smoothstep(p.t - 20, p.t + 20, l); a[i] *= k; a[i + 1] *= k; a[i + 2] *= k; });
      return C.blend(src, C.blur(hi, p.r * env.s), 'lighter', Math.min(1, p.amt / 100)) ;
    },
  },
  {
    id: 'light-rays', name: 'Light Rays (God Rays)', cat, tags: 'sun rays volumetric cosmic light',
    desc: 'Volumetric light rays streaming from a bright point.',
    params: [range('cx', 'Source X', 0, 100, 50, 1, '%'), range('cy', 'Source Y', 0, 100, 20, 1, '%'), range('len', 'Length', 5, 100, 50, 1, '%'), range('t', 'Threshold', 0, 255, 170), range('amt', 'Intensity', 0, 200, 90, 1, '%'), color('tint', 'Tint', '#fff2cc')],
    run: (src, p) => {
      const w = src.width, h = src.height, sc = Math.min(1, 700 / Math.max(w, h));
      const sm = C.resizeCanvas(src, w * sc, h * sc);
      const hi = C.perPixel(sm, (a, i) => { const k = C.smoothstep(p.t - 25, p.t + 25, C.luma(a[i], a[i + 1], a[i + 2])); a[i] *= k; a[i + 1] *= k; a[i + 2] *= k; });
      const cx = (p.cx / 100) * sm.width, cy = (p.cy / 100) * sm.height, k = p.len / 100;
      const rays = C.multiSample(hi, 48, (x, y, t, q) => { const f = 1 - k * t; q[0] = cx + (x - cx) * f; q[1] = cy + (y - cy) * f; });
      const tinted = C.fillColor(C.resizeCanvas(rays, w, h), p.tint, 'multiply', 1);
      return C.blend(src, tinted, 'lighter', Math.min(1, p.amt / 100));
    },
  },
  {
    id: 'grain', name: 'Film Grain / Noise', cat, tags: 'noise film texture iso',
    desc: 'Add organic film grain or digital noise.',
    params: [range('amt', 'Amount', 0, 100, 25), range('size', 'Grain size', 1, 5, 1.5, 0.1), bool('mono', 'Monochrome', true), seed()],
    run: (src, p, env) => {
      const w = src.width, h = src.height, sz = Math.max(1, p.size * Math.max(env.s, 0.5));
      const nw = Math.ceil(w / sz), nh = Math.ceil(h / sz), rand = C.rng(p.seed);
      const nd = new ImageData(nw, nh);
      for (let i = 0; i < nd.data.length; i += 4) {
        const r = rand(); nd.data[i] = p.mono ? r * 255 : rand() * 255; nd.data[i + 1] = p.mono ? r * 255 : rand() * 255; nd.data[i + 2] = p.mono ? r * 255 : rand() * 255; nd.data[i + 3] = 255;
      }
      const noise = C.readData(C.resizeCanvas(C.writeData(nd), w, h)).data;
      const d = C.readData(src), a = d.data, k = p.amt / 100;
      for (let i = 0; i < a.length; i += 4) {
        const l = C.luma(a[i], a[i + 1], a[i + 2]) / 255, wt = k * 90 * (1 - Math.abs(l - 0.5));
        for (let c = 0; c < 3; c++) a[i + c] += (noise[i + c] / 255 - 0.5) * wt * 2;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'chromatic', name: 'Chromatic Aberration', cat, tags: 'rgb split fringe lens glitch',
    desc: 'Shift color channels apart like a cheap lens (or a glitchy screen).',
    params: [select('mode', 'Mode', [['radial', 'Radial (lens)'], ['linear', 'Linear shift']]), range('amt', 'Amount', 0, 40, 6, 0.5, 'px'), when((p) => p.mode === 'linear', range('angle', 'Angle', -180, 180, 0, 1, '°'))],
    run: (src, p, env) => {
      const d = C.readData(src), s = d.data, w = d.width, h = d.height, out = new ImageData(w, h), o = out.data;
      const A = ((p.angle || 0) * Math.PI) / 180, L = p.amt * env.s, cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
      const get = (x, y, c) => s[(C.clamp(Math.round(y), 0, h - 1) * w + C.clamp(Math.round(x), 0, w - 1)) * 4 + c];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let ox, oy;
        if (p.mode === 'radial') { const dx = x - cx, dy = y - cy, f = (L / R); ox = dx * f; oy = dy * f; }
        else { ox = Math.cos(A) * L; oy = Math.sin(A) * L; }
        const i = (y * w + x) * 4;
        o[i] = get(x - ox, y - oy, 0); o[i + 1] = s[i + 1]; o[i + 2] = get(x + ox, y + oy, 2); o[i + 3] = s[i + 3];
      }
      return C.writeData(out);
    },
  },
  {
    id: 'double-vision', name: 'Double Vision', cat, tags: 'ghost double exposure drunk',
    desc: 'Overlay a shifted ghost copy of the image.',
    params: [range('dx', 'Offset X', -100, 100, 20, 1, 'px'), range('dy', 'Offset Y', -100, 100, 0, 1, 'px'), range('op', 'Ghost opacity', 0, 100, 50, 1, '%')],
    run: (src, p, env) => C.draw(src.width, src.height, (x) => {
      x.drawImage(src, 0, 0);
      x.globalAlpha = p.op / 100;
      x.drawImage(src, p.dx * env.s, p.dy * env.s);
    }),
  },
  {
    id: 'light-leak', name: 'Light Leak', cat, tags: 'film leak flare analog',
    desc: 'Analog film light leaks bleeding in from the edges.',
    params: [select('pal', 'Colors', [['warm', 'Warm orange'], ['rose', 'Rose'], ['rainbow', 'Prism'], ['blue', 'Cool blue']]), range('amt', 'Intensity', 0, 100, 60, 1, '%'), seed()],
    run: (src, p) => {
      const w = src.width, h = src.height, rand = C.rng(p.seed);
      const pals = { warm: [20, 45], rose: [330, 20], rainbow: [0, 360], blue: [190, 240] }, [h0, h1] = pals[p.pal];
      const ov = C.draw(w, h, (x) => {
        for (let i = 0; i < 4; i++) {
          const edge = Math.floor(rand() * 4), t = rand();
          const cx = edge === 0 ? 0 : edge === 1 ? w : t * w, cy = edge === 2 ? 0 : edge === 3 ? h : t * h;
          const r = (0.3 + rand() * 0.5) * Math.max(w, h);
          const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          const hue = h0 + rand() * (h1 - h0);
          g.addColorStop(0, `hsla(${hue},100%,60%,0.9)`); g.addColorStop(0.5, `hsla(${hue + 15},100%,50%,0.35)`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
          x.globalCompositeOperation = 'lighter'; x.fillStyle = g; x.fillRect(0, 0, w, h);
        }
      });
      return C.blend(src, ov, 'screen', p.amt / 100);
    },
  },
  {
    id: 'pixelate', name: 'Pixelate', cat, tags: 'mosaic censor blocks pixel',
    desc: 'Big chunky pixels — for censoring or retro style.',
    params: [range('size', 'Block size', 2, 100, 12, 1, 'px')],
    run: (src, p, env) => {
      const s = Math.max(1, p.size * env.s);
      return C.resizeCanvas(C.resizeCanvas(src, src.width / s, src.height / s), src.width, src.height, false);
    },
  },
];
