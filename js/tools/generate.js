// Generators: create brand-new images (backgrounds, patterns, QR codes, placeholders).
import * as C from '../core.js';
import { range, num, select, bool, color, text, seed, when } from '../params.js';
import { LIBS } from '../libs.js';

const cat = 'generate';
const size = (w = 1920, h = 1080) => [num('W', 'Width (px)', 16, 8000, w), num('H', 'Height (px)', 16, 8000, h)];
const dims = (p, env) => [Math.max(1, Math.round(p.W * env.s)), Math.max(1, Math.round(p.H * env.s))];
const PAL = {
  vivid: ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec', '#3a86ff', '#06d6a0'],
  pastel: ['#ffd6e0', '#c1fba4', '#a0c4ff', '#ffc6ff', '#fdffb6', '#caffbf'],
  sunset: ['#ff7b54', '#ffb26b', '#ffd56b', '#939b62', '#5b2a86', '#e94560'],
  ocean: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8', '#48cae4'],
  forest: ['#081c15', '#1b4332', '#2d6a4f', '#52b788', '#95d5b2', '#d8f3dc'],
  neon: ['#f72585', '#7209b7', '#3a0ca3', '#4361ee', '#4cc9f0', '#80ffdb'],
  mono: ['#0b0b0b', '#3a3a3a', '#7a7a7a', '#bdbdbd', '#ededed', '#ffffff'],
};
const PAL_OPTS = [['random', 'Random'], ...Object.keys(PAL).map((k) => [k, k[0].toUpperCase() + k.slice(1)])];
const pickPal = (name, rand) => (name === 'random' ? Array.from({ length: 6 }, () => `hsl(${Math.floor(rand() * 360)},${60 + rand() * 35}%,${45 + rand() * 25}%)`) : PAL[name]);

/** Paint soft blobs at low resolution, blur, upscale (fast smooth gradients). */
function blobField(W, H, colors, n, rand, blurK = 0.18, base = null) {
  const sw = Math.max(8, Math.round(W / 8)), sh = Math.max(8, Math.round(H / 8));
  const small = C.draw(sw, sh, (x) => {
    x.fillStyle = base || colors[0]; x.fillRect(0, 0, sw, sh);
    for (let i = 0; i < n; i++) {
      const cx = rand() * sw, cy = rand() * sh, r = (0.25 + rand() * 0.6) * Math.max(sw, sh);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r), c = colors[i % colors.length];
      g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.globalAlpha = 0.6 + rand() * 0.4; x.fillStyle = c; x.fillStyle = g; x.fillRect(0, 0, sw, sh);
    }
  });
  const b = C.blur(small, Math.max(sw, sh) * blurK);
  return C.resizeCanvas(b, W, H);
}

export default [
  {
    id: 'gen-gradient', name: 'Gradient', cat, isGenerator: true, tags: 'background linear radial conic',
    desc: 'Linear, radial or conic gradient background with 2–3 colors.',
    params: [...size(), select('type', 'Type', [['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']]), color('c1', 'Color 1', '#4f46e5'), color('c2', 'Color 2', '#ec4899'), bool('use3', 'Third color', true), when((p) => p.use3, color('c3', 'Color 3', '#f59e0b')), range('angle', 'Angle', 0, 360, 135, 1, '°'), bool('noise', 'Add dither noise (prevents banding)', true)],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), a = (p.angle * Math.PI) / 180;
      let out = C.draw(W, H, (x) => {
        let g;
        if (p.type === 'radial') g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
        else if (p.type === 'conic') g = x.createConicGradient(a, W / 2, H / 2);
        else { const L = (Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))) / 2; g = x.createLinearGradient(W / 2 - Math.cos(a) * L, H / 2 - Math.sin(a) * L, W / 2 + Math.cos(a) * L, H / 2 + Math.sin(a) * L); }
        const cs = p.use3 ? [p.c1, p.c2, p.c3] : [p.c1, p.c2];
        if (p.type === 'conic') cs.push(p.c1);
        cs.forEach((c, i) => g.addColorStop(i / (cs.length - 1), c));
        x.fillStyle = g; x.fillRect(0, 0, W, H);
      });
      if (p.noise) { const r = C.rng(1); out = C.perPixel(out, (d, i) => { const n = (r() - 0.5) * 3; d[i] += n; d[i + 1] += n; d[i + 2] += n; }); }
      return out;
    },
  },
  {
    id: 'gen-mesh', name: 'Mesh Gradient', cat, isGenerator: true, tags: 'aurora blobs modern background wallpaper',
    desc: 'Modern, soft multi-color mesh gradient (aurora style) — randomize until you love it.',
    params: [...size(), select('pal', 'Palette', PAL_OPTS, 'neon'), range('n', 'Color blobs', 2, 20, 7), range('soft', 'Softness', 5, 50, 18, 1, '%'), range('grain', 'Grain', 0, 30, 6), seed()],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), rand = C.rng(p.seed), cols = pickPal(p.pal, rand);
      let out = blobField(W, H, cols, p.n, rand, p.soft / 100);
      if (p.grain) { const r = C.rng(2); out = C.perPixel(out, (d, i) => { const n = (r() - 0.5) * p.grain; d[i] += n; d[i + 1] += n; d[i + 2] += n; }); }
      return out;
    },
  },
  {
    id: 'gen-twotone', name: 'Two-Color Blurred Background', cat, isGenerator: true, tags: 'blurred background two tone random',
    desc: 'Random blurred background from two colors.',
    params: [...size(), color('c1', 'Color 1', '#0f172a'), color('c2', 'Color 2', '#22d3ee'), range('n', 'Shapes', 2, 30, 8), range('soft', 'Blur', 5, 50, 22, 1, '%'), seed()],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), rand = C.rng(p.seed);
      return blobField(W, H, [p.c2, p.c1, p.c2], p.n, rand, p.soft / 100, p.c1);
    },
  },
  {
    id: 'gen-rainbow', name: 'Abstract Colorful Background', cat, isGenerator: true, tags: 'rainbow abstract bright colorful swirl',
    desc: 'Bright abstract rainbow swirls.',
    params: [...size(), range('n', 'Ribbons', 3, 40, 14), range('w', 'Ribbon width', 1, 20, 6, 0.5, '%'), range('soft', 'Softness', 0, 20, 4, 0.5, '%'), color('bg', 'Background', '#0b0b1a'), seed()],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), rand = C.rng(p.seed), M = Math.max(W, H);
      const out = C.draw(W, H, (x) => {
        x.fillStyle = p.bg; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'lighter'; x.lineCap = 'round';
        for (let i = 0; i < p.n; i++) {
          x.strokeStyle = `hsla(${rand() * 360},95%,55%,${0.35 + rand() * 0.5})`; x.lineWidth = (p.w / 100) * M * (0.4 + rand());
          x.beginPath(); x.moveTo(rand() * W, rand() * H);
          x.bezierCurveTo(rand() * W, rand() * H, rand() * W, rand() * H, rand() * W, rand() * H); x.stroke();
        }
      });
      return C.blur(out, (p.soft / 100) * M);
    },
  },
  {
    id: 'gen-pixels', name: 'Random Pixels', cat, isGenerator: true, tags: 'noise pixels mosaic random squares',
    desc: 'Background of random colored pixels/squares.',
    params: [...size(), range('cell', 'Pixel size', 1, 200, 24, 1, 'px'), select('mode', 'Colors', [['rgb', 'Any color'], ['hue', 'Hue range'], ['gray', 'Grayscale'], ['two', 'Between two colors'], ['pal', 'Palette']]), when((p) => p.mode === 'hue', range('h0', 'Hue from', 0, 360, 180, 1, '°')), when((p) => p.mode === 'hue', range('h1', 'Hue to', 0, 360, 260, 1, '°')), when((p) => p.mode === 'two', color('c1', 'Color 1', '#111827')), when((p) => p.mode === 'two', color('c2', 'Color 2', '#10b981')), when((p) => p.mode === 'pal', select('pal', 'Palette', PAL_OPTS.slice(1), 'sunset')), seed()],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), rand = C.rng(p.seed), cs = Math.max(1, p.cell);
      const gw = Math.ceil(p.W / cs), gh = Math.ceil(p.H / cs), d = new ImageData(gw, gh), c1 = C.hexToRgb(p.c1 || '#000'), c2 = C.hexToRgb(p.c2 || '#fff');
      const pal = PAL[p.pal || 'sunset'].map(C.hexToRgb);
      for (let i = 0; i < d.data.length; i += 4) {
        let c;
        if (p.mode === 'rgb') c = [rand() * 255, rand() * 255, rand() * 255];
        else if (p.mode === 'gray') { const v = rand() * 255; c = [v, v, v]; }
        else if (p.mode === 'hue') c = C.hslToRgb((p.h0 + rand() * (p.h1 - p.h0)) / 360, 0.7 + rand() * 0.3, 0.35 + rand() * 0.35);
        else if (p.mode === 'two') { const t = rand(); c = c1.map((v, k) => v + (c2[k] - v) * t); }
        else c = pal[Math.floor(rand() * pal.length)];
        d.data.set([c[0], c[1], c[2], 255], i);
      }
      return C.draw(W, H, (x) => { x.imageSmoothingEnabled = false; x.drawImage(C.writeData(d), 0, 0, (gw * cs * W) / p.W, (gh * cs * H) / p.H); });
    },
  },
  {
    id: 'gen-noise', name: 'Clouds / Fractal Noise', cat, isGenerator: true, tags: 'perlin clouds smoke marble texture noise',
    desc: 'Procedural cloud, smoke or marble texture.',
    params: [...size(1600, 1600), select('kind', 'Style', [['clouds', 'Clouds'], ['marble', 'Marble'], ['wood', 'Wood rings'], ['ridged', 'Ridged (lightning)']]), range('scale', 'Scale', 10, 800, 220, 1, 'px'), range('oct', 'Detail', 1, 8, 5), color('c1', 'Color 1', '#0b1d3a'), color('c2', 'Color 2', '#e0f2fe'), seed()],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), S = p.scale * env.s, L = C.gradientLut([[0, p.c1], [1, p.c2]]), d = new ImageData(W, H), a = d.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let v = C.fbm(x / S, y / S, p.oct, p.seed);
        if (p.kind === 'marble') v = 0.5 + 0.5 * Math.sin((x / S) * 4 + v * 12);
        else if (p.kind === 'wood') { const r = Math.hypot(x - W / 2, y - H / 2) / S; v = ((r * 6 + v * 4) % 1); }
        else if (p.kind === 'ridged') v = Math.pow(1 - Math.abs(v * 2 - 1), 4);
        const k = Math.round(C.clamp(v, 0, 1) * 255) * 3, i = (y * W + x) * 4;
        a[i] = L[k]; a[i + 1] = L[k + 1]; a[i + 2] = L[k + 2]; a[i + 3] = 255;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'gen-pattern', name: 'Pattern', cat, isGenerator: true, tags: 'stripes checker polka dots grid zigzag',
    desc: 'Stripes, checkerboard, polka dots, grid, zig-zag or triangles.',
    params: [...size(1600, 1600), select('kind', 'Pattern', [['stripes', 'Stripes'], ['checker', 'Checkerboard'], ['dots', 'Polka dots'], ['grid', 'Grid lines'], ['zigzag', 'Zig-zag'], ['triangles', 'Triangles'], ['waves', 'Waves']]), range('size', 'Size', 4, 400, 60, 1, 'px'), color('c1', 'Background', '#fef3c7'), color('c2', 'Foreground', '#ef4444'), range('angle', 'Angle', 0, 180, 45, 1, '°')],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), s = Math.max(2, p.size * env.s), D = Math.hypot(W, H);
      return C.draw(W, H, (x) => {
        x.fillStyle = p.c1; x.fillRect(0, 0, W, H); x.fillStyle = p.c2; x.strokeStyle = p.c2;
        x.translate(W / 2, H / 2); x.rotate((p.angle * Math.PI) / 180); x.translate(-D / 2, -D / 2);
        const n = Math.ceil(D / s) + 1;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const X = i * s, Y = j * s;
          if (p.kind === 'stripes' && i === 0) x.fillRect(0, Y, D, s / 2);
          if (p.kind === 'checker' && (i + j) % 2) x.fillRect(X, Y, s, s);
          if (p.kind === 'dots') { x.beginPath(); x.arc(X + (j % 2 ? s / 2 : 0), Y, s * 0.28, 0, 7); x.fill(); }
          if (p.kind === 'triangles') { x.beginPath(); x.moveTo(X, Y + s); x.lineTo(X + s / 2, Y); x.lineTo(X + s, Y + s); x.closePath(); if ((i + j) % 2) x.fill(); }
        }
        if (p.kind === 'grid') { x.lineWidth = Math.max(1, s * 0.06); x.beginPath(); for (let k = 0; k < n; k++) { x.moveTo(k * s, 0); x.lineTo(k * s, D); x.moveTo(0, k * s); x.lineTo(D, k * s); } x.stroke(); }
        if (p.kind === 'zigzag' || p.kind === 'waves') {
          x.lineWidth = s * 0.25; x.lineJoin = 'round';
          for (let j = 0; j < n; j++) { x.beginPath(); for (let i = 0; i <= n * 2; i++) { const X = (i * s) / 2, Y = j * s + (p.kind === 'zigzag' ? (i % 2 ? s / 3 : 0) : Math.sin(i) * s * 0.15); i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke(); }
        }
      });
    },
  },
  {
    id: 'gen-plasma', name: 'Plasma', cat, isGenerator: true, tags: 'psychedelic retro demoscene sine',
    desc: 'Psychedelic demoscene-style sine plasma.',
    params: [...size(), range('scale', 'Scale', 20, 600, 160, 1, 'px'), select('pal', 'Palette', [['rainbow', 'Rainbow'], ['fire', 'Fire'], ['ice', 'Ice'], ['acid', 'Acid']]), range('t', 'Phase', 0, 100, 0)],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), S = p.scale * env.s, t = p.t / 10, d = new ImageData(W, H), a = d.data;
      const pals = { fire: [[0, '#000'], [0.4, '#c1121f'], [0.7, '#fca311'], [1, '#fff']], ice: [[0, '#03045e'], [0.5, '#00b4d8'], [1, '#fff']], acid: [[0, '#240046'], [0.33, '#ff006e'], [0.66, '#ccff33'], [1, '#240046']] };
      const L = p.pal === 'rainbow' ? null : C.gradientLut(pals[p.pal]);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = x / S, v = y / S;
        const val = (Math.sin(u + t) + Math.sin(v + t * 0.7) + Math.sin((u + v + t) / 2) + Math.sin(Math.hypot(u - W / S / 2, v - H / S / 2) + t)) / 8 + 0.5;
        const i = (y * W + x) * 4;
        if (L) { const k = Math.round(val * 255) * 3; a[i] = L[k]; a[i + 1] = L[k + 1]; a[i + 2] = L[k + 2]; }
        else { const [r, g, b] = C.hslToRgb(val, 0.9, 0.55); a[i] = r; a[i + 1] = g; a[i + 2] = b; }
        a[i + 3] = 255;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'gen-voronoi', name: 'Voronoi Cells', cat, isGenerator: true, tags: 'cells geometric low poly stained glass',
    desc: 'Geometric cell pattern in a chosen palette.',
    params: [...size(), range('cell', 'Cell size', 10, 400, 90, 1, 'px'), select('pal', 'Palette', PAL_OPTS, 'ocean'), range('line', 'Lines', 0, 20, 2, 0.5, 'px'), color('lc', 'Line color', '#ffffff'), seed()],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), rand = C.rng(p.seed), pal = pickPal(p.pal, rand).map((c) => (c.startsWith('#') ? C.hexToRgb(c) : (() => { const m = c.match(/[\d.]+/g).map(Number); return C.hslToRgb(m[0] / 360, m[1] / 100, m[2] / 100); })()));
      const cell = Math.max(4, p.cell * env.s), gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1;
      const sites = []; for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) sites.push([(x + rand()) * cell, (y + rand()) * cell, pal[Math.floor(rand() * pal.length)]]);
      const d = new ImageData(W, H), a = d.data, lc = C.hexToRgb(p.lc), lw = p.line * env.s;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell); let d1 = 1e9, d2 = 1e9, best = null;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const sx = gx + ox, sy = gy + oy; if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue; const s = sites[sy * gw + sx], dd = Math.hypot(s[0] - x, s[1] - y); if (dd < d1) { d2 = d1; d1 = dd; best = s; } else if (dd < d2) d2 = dd; }
        const t = lw ? 1 - C.smoothstep(lw / 2, lw / 2 + 1, d2 - d1) : 0, i = (y * W + x) * 4, c = best[2];
        a[i] = c[0] + (lc[0] - c[0]) * t; a[i + 1] = c[1] + (lc[1] - c[1]) * t; a[i + 2] = c[2] + (lc[2] - c[2]) * t; a[i + 3] = 255;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'gen-solid', name: 'Solid Color / Blank Canvas', cat, isGenerator: true, tags: 'blank empty canvas color',
    desc: 'A blank canvas in any color (or transparent).',
    params: [...size(), color('c', 'Color', '#ffffff'), bool('transparent', 'Transparent')],
    run: (src, p, env) => { const [W, H] = dims(p, env); return C.draw(W, H, (x) => { if (!p.transparent) { x.fillStyle = p.c; x.fillRect(0, 0, W, H); } }); },
  },
  {
    id: 'gen-placeholder', name: 'Placeholder Image', cat, isGenerator: true, tags: 'placeholder mockup dummy wireframe',
    desc: 'Labeled placeholder image for mockups and wireframes.',
    params: [...size(1200, 630), text('label', 'Label (blank = size)', ''), color('bg', 'Background', '#e5e7eb'), color('fg', 'Text', '#6b7280'), bool('cross', 'Diagonal cross', true)],
    run: (src, p, env) => {
      const [W, H] = dims(p, env);
      return C.draw(W, H, (x) => {
        x.fillStyle = p.bg; x.fillRect(0, 0, W, H);
        if (p.cross) { x.strokeStyle = p.fg; x.globalAlpha = 0.25; x.lineWidth = Math.max(1, W / 400); x.beginPath(); x.moveTo(0, 0); x.lineTo(W, H); x.moveTo(W, 0); x.lineTo(0, H); x.stroke(); x.globalAlpha = 1; }
        const t = p.label || `${p.W} × ${p.H}`;
        x.font = `600 ${Math.min(W / (t.length * 0.6), H / 4)}px Inter, system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillStyle = p.bg; const tw = x.measureText(t).width; x.fillRect(W / 2 - tw / 2 - 10, H / 2 - H / 8, tw + 20, H / 4);
        x.fillStyle = p.fg; x.fillText(t, W / 2, H / 2);
      });
    },
  },
  {
    id: 'gen-qr', name: 'QR Code', cat, isGenerator: true, tags: 'qr code barcode link url wifi',
    desc: 'Generate a QR code for a URL, text, Wi-Fi network or contact — custom colors and rounded dots.',
    params: [
      select('kind', 'Content', [['text', 'Text / URL'], ['wifi', 'Wi-Fi network'], ['email', 'Email'], ['tel', 'Phone']]),
      when((p) => p.kind === 'text', text('t', 'Text or URL', 'https://example.com', { multiline: true })),
      when((p) => p.kind === 'wifi', text('ssid', 'Network name', 'MyWiFi')), when((p) => p.kind === 'wifi', text('pass', 'Password', '')), when((p) => p.kind === 'wifi', select('sec', 'Security', [['WPA', 'WPA/WPA2'], ['WEP', 'WEP'], ['nopass', 'None']])),
      when((p) => p.kind === 'email', text('email', 'Email address', 'hello@example.com')), when((p) => p.kind === 'tel', text('tel', 'Phone number', '+1 555 0100')),
      num('W', 'Size (px)', 64, 4000, 1024), select('ecc', 'Error correction', [['L', 'Low (7%)'], ['M', 'Medium (15%)'], ['Q', 'Quartile (25%)'], ['H', 'High (30%)']], 'M'),
      color('fg', 'Foreground', '#111111'), color('bg', 'Background', '#ffffff'), bool('transparent', 'Transparent background'), select('style', 'Module style', [['square', 'Square'], ['round', 'Rounded dots'], ['soft', 'Soft squares']]), range('margin', 'Quiet zone', 0, 8, 4, 1, ' modules'),
    ],
    async run(src, p, env) {
      const qrcode = await LIBS.qrcode();
      const esc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
      const data = p.kind === 'wifi' ? `WIFI:T:${p.sec};S:${esc(p.ssid)};P:${esc(p.pass)};;` : p.kind === 'email' ? `mailto:${p.email}` : p.kind === 'tel' ? `tel:${p.tel.replace(/\s/g, '')}` : p.t || ' ';
      const q = qrcode(0, p.ecc); q.addData(unescape(encodeURIComponent(data))); q.make();
      const n = q.getModuleCount(), S = Math.max(16, Math.round(p.W * env.s)), cell = S / (n + p.margin * 2);
      return C.draw(S, S, (x) => {
        if (!p.transparent) { x.fillStyle = p.bg; x.fillRect(0, 0, S, S); }
        x.fillStyle = p.fg;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          if (!q.isDark(r, c)) continue;
          const X = (c + p.margin) * cell, Y = (r + p.margin) * cell;
          if (p.style === 'round') { x.beginPath(); x.arc(X + cell / 2, Y + cell / 2, cell * 0.46, 0, 7); x.fill(); }
          else if (p.style === 'soft') { x.beginPath(); x.roundRect(X + cell * 0.05, Y + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.3); x.fill(); }
          else x.fillRect(Math.floor(X), Math.floor(Y), Math.ceil(cell), Math.ceil(cell));
        }
      });
    },
    genDims: (p) => [p.W, p.W],
  },
  {
    id: 'gen-sample', name: 'Sample Landscape', cat, isGenerator: true, tags: 'sample demo test image scenery',
    desc: 'A procedurally painted landscape — handy for trying effects without a photo.',
    params: [...size(1600, 1067), select('time', 'Time of day', [['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night']], 'sunset'), seed()],
    run: (src, p, env) => {
      const [W, H] = dims(p, env), rand = C.rng(p.seed);
      const skies = { day: ['#4a90d9', '#bfe3ff', '#fff6d5'], sunset: ['#1d2b64', '#f8576b', '#ffcf7d'], night: ['#020617', '#0f1e45', '#3b3f7a'] };
      const sk = skies[p.time];
      const out = C.draw(W, H, (x) => {
        const g = x.createLinearGradient(0, 0, 0, H * 0.7); g.addColorStop(0, sk[0]); g.addColorStop(0.7, sk[1]); g.addColorStop(1, sk[2]);
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        if (p.time === 'night') { x.fillStyle = '#fff'; for (let i = 0; i < 300; i++) { x.globalAlpha = rand(); x.fillRect(rand() * W, rand() * H * 0.6, 1.5 * env.s + 0.5, 1.5 * env.s + 0.5); } x.globalAlpha = 1; }
        const sx = W * (0.3 + rand() * 0.4), sy = H * (p.time === 'day' ? 0.2 : 0.55), sr = H * 0.08;
        const sg = x.createRadialGradient(sx, sy, 0, sx, sy, sr * 4); sg.addColorStop(0, p.time === 'night' ? 'rgba(230,235,255,0.95)' : 'rgba(255,250,220,1)'); sg.addColorStop(0.25, p.time === 'night' ? 'rgba(200,210,255,0.25)' : 'rgba(255,200,120,0.45)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = sg; x.fillRect(0, 0, W, H);
        x.fillStyle = p.time === 'night' ? '#eef' : '#fff8e1'; x.beginPath(); x.arc(sx, sy, sr, 0, 7); x.fill();
        const layers = p.time === 'night' ? ['#1e2550', '#151a3a', '#0b0f24'] : p.time === 'day' ? ['#7fa6c9', '#4f7a5a', '#2f4f36'] : ['#6b3a6b', '#3f2450', '#1b1030'];
        layers.forEach((col, li) => {
          x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
          const base = H * (0.55 + li * 0.1), amp = H * (0.18 - li * 0.04), f = 2 + li * 2, ph = rand() * 10;
          for (let X = 0; X <= W; X += W / 200) x.lineTo(X, base - amp * (0.5 + 0.5 * Math.sin((X / W) * f + ph)) * (0.7 + 0.3 * C.fbm(X / W * 6, li, 4, p.seed)));
          x.lineTo(W, H); x.closePath(); x.fill();
        });
        const lake = x.createLinearGradient(0, H * 0.78, 0, H); lake.addColorStop(0, sk[2]); lake.addColorStop(1, sk[0]);
        x.globalAlpha = 0.85; x.fillStyle = lake; x.fillRect(0, H * 0.8, W, H * 0.2); x.globalAlpha = 1;
        x.fillStyle = p.time === 'night' ? '#05070f' : '#14210f';
        for (let i = 0; i < 40; i++) { const tx = rand() * W, th = H * (0.06 + rand() * 0.12), tw = th * 0.35, ty = H * 0.8; x.beginPath(); x.moveTo(tx, ty - th); x.lineTo(tx - tw / 2, ty); x.lineTo(tx + tw / 2, ty); x.closePath(); x.fill(); }
      });
      const r = C.rng(5);
      return C.perPixel(out, (d, i) => { const n = (r() - 0.5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; });
    },
  },
];
