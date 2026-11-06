// Size, geometry, framing, text and compositing.
import * as C from '../core.js';
import { range, num, select, bool, color, text, image, seed, when } from '../params.js';

const cat = 'transform';
export const ASPECTS = [['free', 'Free'], ['orig', 'Original'], ['1:1', '1:1 Square'], ['4:5', '4:5 Portrait'], ['5:4', '5:4'], ['4:3', '4:3'], ['3:4', '3:4'], ['3:2', '3:2'], ['2:3', '2:3'], ['16:9', '16:9 Wide'], ['9:16', '9:16 Story'], ['21:9', '21:9 Cinema'], ['2:1', '2:1'], ['1.91:1', '1.91:1 Link preview']];
export const ratioOf = (a, w, h) => (a === 'orig' ? w / h : a === 'free' ? null : a.split(':').reduce((x, y) => +x / +y));

function shapePath(x, shape, w, h, r = 0.12) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  x.beginPath();
  const poly = (n, rot = -Math.PI / 2, inner = 0) => {
    const pts = inner ? n * 2 : n;
    for (let i = 0; i < pts; i++) {
      const rr = inner && i % 2 ? R * inner : R, a = rot + (i / pts) * Math.PI * 2;
      x[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
  };
  switch (shape) {
    case 'circle': x.arc(cx, cy, R, 0, Math.PI * 2); break;
    case 'ellipse': x.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'rounded': x.roundRect(0, 0, w, h, Math.min(w, h) * r); break;
    case 'triangle': poly(3); break;
    case 'diamond': poly(4); break;
    case 'pentagon': poly(5); break;
    case 'hexagon': poly(6, 0); break;
    case 'octagon': poly(8, Math.PI / 8); break;
    case 'star': poly(5, -Math.PI / 2, 0.45); break;
    case 'burst': poly(16, -Math.PI / 2, 0.78); break;
    case 'heart': {
      const s = R * 2, ox = cx - s / 2, oy = cy - s / 2 + s * 0.05;
      x.moveTo(ox + s / 2, oy + s * 0.3);
      x.bezierCurveTo(ox + s / 2, oy + s * 0.27, ox + s * 0.45, oy + s * 0.12, ox + s * 0.25, oy + s * 0.12);
      x.bezierCurveTo(ox - s * 0.05, oy + s * 0.12, ox - s * 0.05, oy + s * 0.48, ox - s * 0.05, oy + s * 0.48);
      x.bezierCurveTo(ox - s * 0.05, oy + s * 0.68, ox + s * 0.2, oy + s * 0.83, ox + s / 2, oy + s * 0.98);
      x.bezierCurveTo(ox + s * 0.8, oy + s * 0.83, ox + s * 1.05, oy + s * 0.68, ox + s * 1.05, oy + s * 0.48);
      x.bezierCurveTo(ox + s * 1.05, oy + s * 0.48, ox + s * 1.05, oy + s * 0.12, ox + s * 0.75, oy + s * 0.12);
      x.bezierCurveTo(ox + s * 0.6, oy + s * 0.12, ox + s / 2, oy + s * 0.27, ox + s / 2, oy + s * 0.3);
      break;
    }
    default: x.rect(0, 0, w, h);
  }
}
function placeXY(pos, W, H, w, h, m) {
  const [v, hz] = pos.length === 2 ? pos.split('') : ['c', 'c'];
  const X = hz === 'l' ? m : hz === 'r' ? W - w - m : (W - w) / 2;
  const Y = v === 't' ? m : v === 'b' ? H - h - m : (H - h) / 2;
  return [X, Y];
}
const POS = [['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right'], ['cl', 'Middle left'], ['cc', 'Center'], ['cr', 'Middle right'], ['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right']];
const FONTS = [['Inter, system-ui, sans-serif', 'Sans'], ['Georgia, "Times New Roman", serif', 'Serif'], ['Impact, "Anton", "Arial Black", sans-serif', 'Impact'], ['ui-monospace, Menlo, monospace', 'Mono'], ['"Brush Script MT", "Segoe Script", cursive', 'Script'], ['"Arial Black", "Helvetica Neue", sans-serif', 'Heavy']];

function drawTextBlock(x, str, font, size, lineH = 1.2) {
  const lines = String(str).split('\n');
  x.font = font;
  const widths = lines.map((l) => x.measureText(l).width);
  return { lines, w: Math.max(...widths, 1), h: lines.length * size * lineH, lineH: size * lineH };
}

/** Keep a crop box inside the image: 0 ≤ x, x + w ≤ 100 (same for y/h), min size 0.5%. Mutates and returns p. */
export function normalizeCrop(p) {
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  p.w = Math.min(100, Math.max(0.5, num(p.w, 100)));
  p.h = Math.min(100, Math.max(0.5, num(p.h, 100)));
  p.x = Math.min(100 - p.w, Math.max(0, num(p.x, 0)));
  p.y = Math.min(100 - p.h, Math.max(0, num(p.y, 0)));
  return p;
}
export const MAX_SIDE = 16000;
export const MAX_PIXELS = 120e6;

export function rotateCanvas(src, deg, expand = true, bg = null, fill = false) {
  const a = (deg * Math.PI) / 180, w = src.width, h = src.height, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  let W = w, H = h, sc = 1;
  if (expand) { W = w * c + h * s; H = w * s + h * c; }
  else if (fill) sc = Math.max((w * c + h * s) / w, (w * s + h * c) / h);
  return C.draw(W, H, (x) => {
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, W, H); }
    x.translate(W / 2, H / 2); x.rotate(a); x.scale(sc, sc);
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, -w / 2, -h / 2);
  });
}

export default [
  {
    id: 'resize', name: 'Resize', cat, tags: 'scale dimensions pixels megapixels percent shrink',
    desc: 'Resize by pixels, percentage, longest side or megapixels with high-quality resampling.',
    init: (p, ctx) => {
      const [W, H] = ctx.realSize;
      Object.assign(p, { w: W, h: H, long: Math.max(W, H), mp: Math.round((W * H) / 1e5) / 10 || 0.1 });
    },
    params: [
      select('mode', 'Resize by', [['px', 'Width × height'], ['w', 'Width (keep ratio)'], ['h', 'Height (keep ratio)'], ['long', 'Longest side'], ['pct', 'Percentage'], ['mp', 'Megapixels']], 'w'),
      when((p) => p.mode === 'px' || p.mode === 'w', num('w', 'Width (px)', 1, MAX_SIDE, 1200)),
      when((p) => p.mode === 'px' || p.mode === 'h', num('h', 'Height (px)', 1, MAX_SIDE, 800)),
      when((p) => p.mode === 'long', num('long', 'Longest side (px)', 1, MAX_SIDE, 1600)),
      when((p) => p.mode === 'pct', range('pct', 'Scale', 1, 400, 50, 1, '%')),
      when((p) => p.mode === 'mp', range('mp', 'Megapixels', 0.1, 100, 2, 0.1, ' MP')),
      when((p) => p.mode === 'px', select('fit', 'Fit', [['stretch', 'Stretch'], ['cover', 'Fill & crop'], ['contain', 'Fit inside (pad)']])),
      when((p) => p.mode === 'px' && p.fit === 'contain', color('pad', 'Padding color', '#ffffff')),
      select('algo', 'Resampling', [['smooth', 'Smooth (high quality)'], ['nearest', 'Nearest (pixel art)']]),
    ],
    run: (src, p, env) => {
      const W0 = src.width / env.s, H0 = src.height / env.s; // real dimensions
      let W, H;
      switch (p.mode) {
        case 'w': W = p.w; H = (p.w * H0) / W0; break;
        case 'h': H = p.h; W = (p.h * W0) / H0; break;
        case 'long': { const k = p.long / Math.max(W0, H0); W = W0 * k; H = H0 * k; break; }
        case 'pct': W = (W0 * p.pct) / 100; H = (H0 * p.pct) / 100; break;
        case 'mp': { const k = Math.sqrt((p.mp * 1e6) / (W0 * H0)); W = W0 * k; H = H0 * k; break; }
        default: W = p.w; H = p.h;
      }
      // keep the output within browser canvas limits
      const lim = Math.min(1, MAX_SIDE / Math.max(W, H), Math.sqrt(MAX_PIXELS / (W * H)));
      if (lim < 1) { W *= lim; H *= lim; env.warn && env.warn(`Output limited to ${Math.round(W)} × ${Math.round(H)} px (browser canvas limit).`); }
      const smooth = p.algo === 'smooth', w = Math.max(1, Math.round(W)) * env.s, h = Math.max(1, Math.round(H)) * env.s;
      if (p.mode !== 'px' || p.fit === 'stretch') return C.resizeCanvas(src, w, h, smooth);
      const k = p.fit === 'cover' ? Math.max(w / src.width, h / src.height) : Math.min(w / src.width, h / src.height);
      const sw = src.width * k, sh = src.height * k;
      return C.draw(w, h, (x) => {
        if (p.fit === 'contain') { x.fillStyle = p.pad; x.fillRect(0, 0, w, h); }
        x.imageSmoothingEnabled = smooth; x.imageSmoothingQuality = 'high';
        x.drawImage(C.resizeCanvas(src, sw, sh, smooth), (w - sw) / 2, (h - sh) / 2);
      });
    },
  },
  {
    id: 'crop', name: 'Crop', cat, tags: 'cut trim aspect ratio',
    desc: 'Drag the box on the image (or type values) to crop. Lock to common aspect ratios.',
    overlay: 'crop',
    params: [select('aspect', 'Aspect ratio', ASPECTS), range('x', 'Left', 0, 100, 0, 0.1, '%'), range('y', 'Top', 0, 100, 0, 0.1, '%'), range('w', 'Width', 0.5, 100, 100, 0.1, '%'), range('h', 'Height', 0.5, 100, 100, 0.1, '%')],
    normalize: normalizeCrop,
    validate: (p, ctx) => {
      const [W, H] = ctx.realSize;
      const w = Math.round((p.w / 100) * W), h = Math.round((p.h / 100) * H);
      return w < 2 || h < 2 ? `The crop area is only ${w} × ${h} px. Make it at least 2 × 2 px.` : null;
    },
    run: (src, p) => {
      const q = normalizeCrop({ ...p });
      const x = Math.round((q.x / 100) * src.width), y = Math.round((q.y / 100) * src.height);
      const w = Math.max(1, Math.min(src.width - x, Math.round((q.w / 100) * src.width)));
      const h = Math.max(1, Math.min(src.height - y, Math.round((q.h / 100) * src.height)));
      return C.draw(w, h, (c) => c.drawImage(src, -x, -y));
    },
  },
  {
    id: 'rotate', name: 'Rotate / Straighten', cat, tags: 'rotate angle straighten tilt horizon',
    desc: 'Rotate by any angle. Expand the canvas, or crop to fill for straightening horizons.',
    params: [range('a', 'Angle', -180, 180, 0, 0.1, '°'), select('fit', 'Canvas', [['expand', 'Expand to fit'], ['fill', 'Crop to fill (straighten)'], ['keep', 'Keep size']]), when((p) => p.fit === 'expand' || p.fit === 'keep', bool('transparent', 'Transparent corners', true)), when((p) => !p.transparent && p.fit !== 'fill', color('bg', 'Corner color', '#ffffff'))],
    run: (src, p) => rotateCanvas(src, p.a, p.fit === 'expand', p.transparent || p.fit === 'fill' ? null : p.bg, p.fit === 'fill'),
  },
  {
    id: 'rotate-flip', name: 'Rotate 90° / Flip', cat, tags: 'rotate 90 180 flip mirror horizontal vertical',
    desc: 'Lossless-style quick rotations and flips.',
    params: [select('op', 'Operation', [['cw', 'Rotate 90° clockwise'], ['ccw', 'Rotate 90° counter-clockwise'], ['180', 'Rotate 180°'], ['fh', 'Flip horizontal'], ['fv', 'Flip vertical']])],
    run: (src, p) => {
      const w = src.width, h = src.height, side = p.op === 'cw' || p.op === 'ccw';
      return C.draw(side ? h : w, side ? w : h, (x) => {
        if (p.op === 'cw') { x.translate(h, 0); x.rotate(Math.PI / 2); }
        if (p.op === 'ccw') { x.translate(0, w); x.rotate(-Math.PI / 2); }
        if (p.op === '180') { x.translate(w, h); x.rotate(Math.PI); }
        if (p.op === 'fh') { x.translate(w, 0); x.scale(-1, 1); }
        if (p.op === 'fv') { x.translate(0, h); x.scale(1, -1); }
        x.drawImage(src, 0, 0);
      });
    },
  },
  {
    id: 'shape-crop', name: 'Crop to Shape', cat, tags: 'circle heart star avatar round shape mask',
    desc: 'Cut the image into a circle, heart, star, hexagon and more — with transparency.',
    params: [select('shape', 'Shape', [['circle', 'Circle'], ['ellipse', 'Ellipse'], ['rounded', 'Rounded square'], ['heart', 'Heart ♥'], ['star', 'Star ★'], ['triangle', 'Triangle ▲'], ['diamond', 'Diamond ◆'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['octagon', 'Octagon'], ['burst', 'Badge burst']]), bool('square', 'Crop to square first', true), range('zoom', 'Zoom', 50, 300, 100, 1, '%'), bool('fillBg', 'Fill background'), when((p) => p.fillBg, color('bg', 'Background', '#ffffff')), range('outline', 'Outline', 0, 40, 0, 0.5, 'px'), when((p) => p.outline > 0, color('oc', 'Outline color', '#ffffff'))],
    run: (src, p, env) => {
      const s = Math.min(src.width, src.height), W = p.square && p.shape !== 'ellipse' ? s : src.width, H = p.square && p.shape !== 'ellipse' ? s : src.height;
      const z = p.zoom / 100, ow = p.outline * env.s;
      return C.draw(W, H, (x) => {
        if (p.fillBg) { x.fillStyle = p.bg; x.fillRect(0, 0, W, H); }
        x.save(); shapePath(x, p.shape, W, H); x.clip();
        const dw = src.width * z * Math.max(W / src.width, H / src.height), dh = src.height * z * Math.max(W / src.width, H / src.height);
        x.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); x.restore();
        if (ow) { shapePath(x, p.shape, W, H); x.lineWidth = ow * 2; x.strokeStyle = p.oc; x.save(); x.clip(); x.stroke(); x.restore(); }
      });
    },
  },
  {
    id: 'frame', name: 'Border & Frame', cat, tags: 'border frame polaroid rounded corners shadow mat',
    desc: 'Add borders, polaroid frames, mats, rounded corners and drop shadows.',
    params: [
      select('style', 'Style', [['solid', 'Solid border'], ['polaroid', 'Polaroid'], ['mat', 'Gallery mat'], ['double', 'Double line'], ['gradient', 'Gradient'], ['shadow', 'Floating shadow'], ['film', 'Film strip']]),
      range('w', 'Border size', 0, 300, 30, 1, 'px'), color('c', 'Color', '#ffffff'), when((p) => p.style === 'gradient' || p.style === 'double', color('c2', 'Second color', '#ff6f61')),
      range('radius', 'Corner radius', 0, 300, 0, 1, 'px'), when((p) => p.style === 'polaroid', text('caption', 'Caption', '')),
      bool('transparentOut', 'Transparent outside corners', true),
    ],
    run: (src, p, env) => {
      const b = p.w * env.s, R = p.radius * env.s, w = src.width, h = src.height;
      let L = b, T = b, Rr = b, B = b;
      if (p.style === 'polaroid') { B = b * 3.5 + h * 0.05; }
      if (p.style === 'mat') { L = Rr = T = B = b * 2; }
      if (p.style === 'shadow') { L = Rr = T = b; B = b * 1.4; }
      if (p.style === 'film') { T = B = Math.max(b, h * 0.09); L = Rr = b * 0.3; }
      const W = w + L + Rr, H = h + T + B;
      return C.draw(W, H, (x) => {
        const outerR = p.transparentOut && R ? R + b * 0.5 : 0;
        x.save();
        if (outerR) { x.beginPath(); x.roundRect(0, 0, W, H, outerR); x.clip(); }
        if (p.style === 'gradient') { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, p.c); g.addColorStop(1, p.c2); x.fillStyle = g; }
        else if (p.style === 'film') x.fillStyle = '#111';
        else x.fillStyle = p.c;
        if (p.style !== 'shadow') x.fillRect(0, 0, W, H);
        x.restore();
        if (p.style === 'shadow') { x.fillStyle = p.c; x.fillRect(0, 0, W, H); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = b * 0.8; x.shadowOffsetY = b * 0.3; x.fillStyle = '#000'; x.beginPath(); x.roundRect(L, T, w, h, R); x.fill(); x.shadowColor = 'transparent'; }
        if (p.style === 'mat') { x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = Math.max(1, b * 0.06); x.strokeRect(L - x.lineWidth, T - x.lineWidth, w + x.lineWidth * 2, h + x.lineWidth * 2); }
        if (p.style === 'double') { x.strokeStyle = p.c2; x.lineWidth = Math.max(1, b * 0.15); x.strokeRect(b * 0.35, b * 0.35, W - b * 0.7, H - b * 0.7); }
        if (p.style === 'film') {
          x.fillStyle = '#f2efe6'; const hs = T * 0.32, gap = hs * 1.7;
          for (let X = gap / 2; X < W; X += gap) { x.beginPath(); x.roundRect(X, (T - hs) / 2, hs * 0.9, hs, hs * 0.15); x.roundRect(X, H - B + (B - hs) / 2, hs * 0.9, hs, hs * 0.15); x.fill(); }
        }
        x.save(); x.beginPath(); x.roundRect(L, T, w, h, R); x.clip(); x.drawImage(src, L, T); x.restore();
        if (p.style === 'polaroid' && p.caption) {
          const size = Math.max(10, B * 0.32);
          x.fillStyle = '#333'; x.font = `${size}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(p.caption, W / 2, H - B / 2);
        }
      });
    },
  },
  {
    id: 'pad', name: 'Fit to Aspect (Pad)', cat, tags: 'instagram square story pad letterbox blur background',
    desc: 'Fit the whole image into a new aspect ratio — fill with a color or a blurred copy (great for Instagram).',
    params: [select('aspect', 'Target ratio', ASPECTS.filter((a) => !['free', 'orig'].includes(a[0])), '1:1'), select('fill', 'Fill with', [['blur', 'Blurred image'], ['color', 'Solid color'], ['transparent', 'Transparent']]), when((p) => p.fill === 'color', color('c', 'Color', '#ffffff')), range('margin', 'Margin', 0, 30, 0, 0.5, '%')],
    run: (src, p) => {
      const r = ratioOf(p.aspect), w = src.width, h = src.height;
      const W = w / h > r ? w : h * r, H = w / h > r ? w / r : h, m = 1 - (p.margin / 100) * 2;
      const k = Math.min(W / w, H / h) * m, dw = w * k, dh = h * k;
      return C.draw(W, H, (x) => {
        if (p.fill === 'color') { x.fillStyle = p.c; x.fillRect(0, 0, W, H); }
        if (p.fill === 'blur') {
          const cov = Math.max(W / w, H / h);
          const bg = C.blur(C.resizeCanvas(src, w * cov * 0.25, h * cov * 0.25), Math.max(W, H) * 0.01);
          x.drawImage(bg, (W - w * cov) / 2, (H - h * cov) / 2, w * cov, h * cov);
          x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, 0, W, H);
        }
        x.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      });
    },
  },
  {
    id: 'text', name: 'Add Text / Watermark', cat, tags: 'text caption watermark copyright label type',
    desc: 'Place text or a tiled watermark — fonts, stroke, shadow and opacity.',
    params: [
      text('t', 'Text', '© Your Name', { multiline: true }), select('font', 'Font', FONTS), range('size', 'Size', 1, 40, 6, 0.1, '% of width'), bool('bold', 'Bold', true),
      color('c', 'Color', '#ffffff'), range('op', 'Opacity', 0, 100, 85, 1, '%'), select('pos', 'Position', [...POS, ['tile', 'Tiled watermark']], 'br'),
      when((p) => p.pos !== 'tile', range('m', 'Margin', 0, 20, 3, 0.5, '%')), when((p) => p.pos === 'tile', range('rot', 'Tile angle', -90, 90, -30, 1, '°')),
      range('stroke', 'Outline', 0, 20, 0, 0.5, 'px'), when((p) => p.stroke > 0, color('sc', 'Outline color', '#000000')), bool('shadow', 'Drop shadow', true),
      bool('box', 'Background box'), when((p) => p.box, color('bc', 'Box color', '#000000')),
    ],
    run: (src, p, env) => {
      const w = src.width, h = src.height, size = (p.size / 100) * w;
      const font = `${p.bold ? 700 : 400} ${size}px ${p.font}`;
      return C.draw(w, h, (x) => {
        x.drawImage(src, 0, 0);
        const blk = drawTextBlock(x, p.t, font, size);
        x.globalAlpha = p.op / 100; x.textBaseline = 'top';
        const paint = (ox, oy) => {
          blk.lines.forEach((ln, i) => {
            const lw = x.measureText(ln).width, lx = ox + (blk.w - lw) / 2, ly = oy + i * blk.lineH;
            if (p.stroke) { x.lineJoin = 'round'; x.lineWidth = p.stroke * env.s * 2; x.strokeStyle = p.sc; x.strokeText(ln, lx, ly); }
            x.fillStyle = p.c; x.fillText(ln, lx, ly);
          });
        };
        if (p.shadow) { x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = size * 0.15; x.shadowOffsetY = size * 0.05; }
        if (p.pos === 'tile') {
          x.save(); x.translate(w / 2, h / 2); x.rotate((p.rot * Math.PI) / 180);
          const D = Math.hypot(w, h), sx = blk.w * 1.6, sy = blk.h * 3;
          for (let yy = -D / 2; yy < D / 2; yy += sy) for (let xx = -D / 2 + ((yy / sy) % 2 ? sx / 2 : 0); xx < D / 2; xx += sx) paint(xx, yy);
          x.restore(); return;
        }
        const pad = size * 0.4, [X, Y] = placeXY(p.pos, w, h, blk.w + (p.box ? pad * 2 : 0), blk.h + (p.box ? pad * 2 : 0), (p.m / 100) * Math.min(w, h));
        if (p.box) { x.save(); x.shadowColor = 'transparent'; x.fillStyle = p.bc; x.beginPath(); x.roundRect(X, Y, blk.w + pad * 2, blk.h + pad * 2, pad * 0.6); x.fill(); x.restore(); }
        paint(X + (p.box ? pad : 0), Y + (p.box ? pad : 0));
      });
    },
  },
  {
    id: 'meme', name: 'Meme Caption', cat, tags: 'meme impact top bottom text funny',
    desc: 'Classic meme with bold outlined top and bottom text.',
    params: [text('top', 'Top text', 'WHEN THE FILTER'), text('bottom', 'Bottom text', 'ACTUALLY WORKS'), range('size', 'Text size', 3, 20, 9, 0.5, '%'), bool('upper', 'UPPERCASE', true)],
    run: (src, p) => {
      const w = src.width, h = src.height, size = (p.size / 100) * w;
      return C.draw(w, h, (x) => {
        x.drawImage(src, 0, 0);
        x.font = `900 ${size}px Impact, "Anton", "Arial Black", sans-serif`; x.textAlign = 'center'; x.lineJoin = 'round';
        x.lineWidth = size * 0.14; x.strokeStyle = '#000'; x.fillStyle = '#fff';
        const put = (t, y, base) => {
          if (!t) return;
          const str = p.upper ? t.toUpperCase() : t;
          // naive word wrap
          const words = str.split(' '), lines = [];
          let cur = '';
          for (const wd of words) { const tt = cur ? cur + ' ' + wd : wd; if (x.measureText(tt).width > w * 0.94 && cur) { lines.push(cur); cur = wd; } else cur = tt; }
          lines.push(cur);
          x.textBaseline = base;
          const ls = base === 'top' ? lines : lines.reverse();
          ls.forEach((ln, i) => { const yy = base === 'top' ? y + i * size : y - i * size; x.strokeText(ln, w / 2, yy); x.fillText(ln, w / 2, yy); });
        };
        put(p.top, h * 0.03, 'top'); put(p.bottom, h * 0.97, 'bottom');
      });
    },
  },
  {
    id: 'motivator', name: 'Motivator / Demotivator Poster', cat, tags: 'demotivator poster motivational',
    desc: 'Black poster frame with a thin white border, a big title and a subtitle.',
    params: [text('title', 'Title', 'PERSEVERANCE'), text('sub', 'Subtitle', 'Because the first 99 filters were not enough.'), select('font', 'Font', [['Georgia, "Times New Roman", serif', 'Serif'], ['Inter, system-ui, sans-serif', 'Sans']]), color('bg', 'Poster color', '#000000'), color('fg', 'Text color', '#ffffff')],
    run: (src, p) => {
      const w = src.width, h = src.height, b = w * 0.1, line = Math.max(1, w * 0.004), ts = w * 0.09, ss = w * 0.032;
      const W = w + b * 2, H = h + b + ts * 1.5 + ss * 2.4 + b * 0.5;
      return C.draw(W, H, (x) => {
        x.fillStyle = p.bg; x.fillRect(0, 0, W, H);
        x.strokeStyle = p.fg; x.lineWidth = line; x.strokeRect(b - line * 3, b - line * 3, w + line * 6, h + line * 6);
        x.drawImage(src, b, b);
        x.fillStyle = p.fg; x.textAlign = 'center'; x.textBaseline = 'top';
        x.font = `${ts}px ${p.font}`; x.fillText(p.title, W / 2, b + h + ts * 0.45, W * 0.92);
        x.font = `${ss}px ${p.font}`; x.fillText(p.sub, W / 2, b + h + ts * 1.65, W * 0.92);
      });
    },
  },
  {
    id: 'trim', name: 'Auto Trim Borders', cat, tags: 'autocrop whitespace trim borders',
    desc: 'Automatically crop away uniform borders (white space, black bars, transparency).',
    params: [range('tol', 'Tolerance', 0, 120, 20), range('pad', 'Keep padding', 0, 100, 0, 1, 'px')],
    run: (src, p, env) => {
      const d = C.readData(src), a = d.data, w = d.width, h = d.height;
      const ref = [a[0], a[1], a[2], a[3]];
      const diff = (i) => (ref[3] < 20 ? a[i + 3] > 20 ? 255 : 0 : Math.max(Math.abs(a[i] - ref[0]), Math.abs(a[i + 1] - ref[1]), Math.abs(a[i + 2] - ref[2]), Math.abs(a[i + 3] - ref[3])));
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (diff((y * w + x) * 4) > p.tol) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return src;
      const pd = p.pad * env.s;
      x0 = Math.max(0, x0 - pd); y0 = Math.max(0, y0 - pd); x1 = Math.min(w - 1, x1 + pd); y1 = Math.min(h - 1, y1 + pd);
      return C.draw(x1 - x0 + 1, y1 - y0 + 1, (x) => x.drawImage(src, -x0, -y0));
    },
  },
  {
    id: 'remove-bg-color', name: 'Remove Background Color', cat, tags: 'transparent background white remove chroma key green screen png',
    desc: 'Make a background color transparent — whole image, or only connected to the edges (keeps interior whites).',
    params: [color('c', 'Background color', '#ffffff', { pick: true }), bool('auto', 'Detect from corners', true), range('tol', 'Tolerance', 0, 200, 40), range('soft', 'Edge softness', 0, 100, 20), select('mode', 'Region', [['flood', 'Connected to edges'], ['global', 'Everywhere']]), bool('despill', 'Remove color fringe', true)],
    run: (src, p) => {
      const d = C.readData(src), a = d.data, w = d.width, h = d.height;
      let ref = C.hexToRgb(p.c);
      if (p.auto) {
        const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
        ref = [0, 1, 2].map((c) => corners.reduce((s, i) => s + a[i + c], 0) / 4);
      }
      const dist = (i) => Math.sqrt((a[i] - ref[0]) ** 2 + (a[i + 1] - ref[1]) ** 2 + (a[i + 2] - ref[2]) ** 2);
      const alpha = new Float32Array(w * h).fill(1);
      const f = (dd) => C.smoothstep(p.tol, p.tol + p.soft + 0.01, dd);
      if (p.mode === 'global') { for (let j = 0; j < w * h; j++) alpha[j] = f(dist(j * 4)); }
      else {
        const seen = new Uint8Array(w * h), stack = [];
        for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
        for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
        while (stack.length) {
          const j = stack.pop();
          if (seen[j]) continue;
          seen[j] = 1;
          const dd = dist(j * 4);
          if (dd > p.tol + p.soft) continue;
          alpha[j] = f(dd);
          const x = j % w, y = (j / w) | 0;
          if (x > 0) stack.push(j - 1); if (x < w - 1) stack.push(j + 1); if (y > 0) stack.push(j - w); if (y < h - 1) stack.push(j + w);
        }
      }
      for (let j = 0; j < w * h; j++) {
        const i = j * 4, al = alpha[j];
        if (al < 1 && p.despill && al > 0) for (let c = 0; c < 3; c++) a[i + c] = C.clamp((a[i + c] - ref[c] * (1 - al)) / al);
        a[i + 3] *= al;
      }
      return C.writeData(d);
    },
  },
  {
    id: 'seamless', name: 'Make Seamless Texture', cat, tags: 'tileable texture pattern tile repeat',
    desc: 'Blend opposite edges so the image tiles seamlessly as a repeating texture.',
    params: [range('blend', 'Blend width', 5, 50, 25, 1, '%'), bool('preview', 'Preview as 2×2 tiles')],
    run: (src, p) => {
      const w = src.width, h = src.height;
      const shifted = C.draw(w, h, (x) => { x.drawImage(src, -w / 2, -h / 2); x.drawImage(src, w / 2, -h / 2); x.drawImage(src, -w / 2, h / 2); x.drawImage(src, w / 2, h / 2); });
      const m = new Float32Array(w * h), bw = p.blend / 100;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ex = Math.min(x, w - 1 - x) / w, ey = Math.min(y, h - 1 - y) / h;
        m[y * w + x] = 1 - Math.min(C.smoothstep(0, bw, ex), C.smoothstep(0, bw, ey));
      }
      const tile = C.mix(src, shifted, m);
      if (!p.preview) return tile;
      return C.draw(w, h, (x) => { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.drawImage(tile, (i * w) / 2, (j * h) / 2, w / 2, h / 2); });
    },
  },
  {
    id: 'tile-preview', name: 'Check Texture Tiling', cat, tags: 'tile repeat pattern check seamless',
    desc: 'Repeat the image in a grid to check whether it tiles seamlessly.',
    params: [range('n', 'Repeats', 2, 6, 3), bool('lines', 'Show seams')],
    run: (src, p) => {
      const w = src.width, h = src.height, tw = w / p.n, th = h / p.n;
      return C.draw(w, h, (x) => {
        for (let i = 0; i < p.n; i++) for (let j = 0; j < p.n; j++) x.drawImage(src, i * tw, j * th, tw, th);
        if (p.lines) { x.strokeStyle = 'rgba(255,0,80,0.7)'; x.setLineDash([4, 4]); for (let i = 1; i < p.n; i++) { x.beginPath(); x.moveTo(i * tw, 0); x.lineTo(i * tw, h); x.moveTo(0, i * th); x.lineTo(w, i * th); x.stroke(); } }
      });
    },
  },
  {
    id: 'snow', name: 'Falling Snow', cat, tags: 'winter snow christmas snowflakes',
    desc: 'Add falling snowflakes with depth.',
    params: [range('n', 'Amount', 10, 3000, 600), range('size', 'Flake size', 0.5, 10, 2.5, 0.1, 'px'), range('blur', 'Depth blur', 0, 100, 40), range('wind', 'Wind streak', 0, 30, 0, 1, '°'), seed()],
    run: (src, p, env) => {
      const w = src.width, h = src.height, rand = C.rng(p.seed), sc = Math.max(w, h) / 1000;
      const layer = (k, sizeMul, alpha) => C.draw(w, h, (x) => {
        x.fillStyle = '#fff';
        for (let i = 0; i < p.n / 3; i++) {
          const r = p.size * sizeMul * sc * (0.5 + rand());
          x.globalAlpha = alpha * (0.5 + rand() * 0.5);
          x.beginPath(); x.ellipse(rand() * w, rand() * h, r, r * (1 + p.wind / 10), (p.wind * Math.PI) / 180, 0, 7); x.fill();
        }
      });
      let out = src;
      [[0.6, 0.6, 1], [1, 0.85, 0.3], [2.2, 0.9, 1.6]].forEach(([s, a, bl]) => {
        const L = layer(0, s, a);
        out = C.blend(out, p.blur ? C.blur(L, bl * (p.blur / 100) * 3 * sc) : L, 'source-over', 1);
      });
      return out;
    },
  },
  {
    id: 'overlay-image', name: 'Overlay / Blend Image', cat, tags: 'impose watermark logo double exposure blend layer',
    desc: 'Place another image (logo, texture, second photo) on top with blend modes — double exposures, logos, textures.',
    params: [image('img', 'Overlay image'), select('mode', 'Blend', [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['hard-light', 'Hard light'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']]), range('op', 'Opacity', 0, 100, 100, 1, '%'), select('fit', 'Size', [['cover', 'Cover whole image'], ['custom', 'Custom size & position']]), when((p) => p.fit === 'custom', range('scale', 'Size', 2, 200, 30, 1, '% of width')), when((p) => p.fit === 'custom', range('x', 'X', 0, 100, 90, 1, '%')), when((p) => p.fit === 'custom', range('y', 'Y', 0, 100, 90, 1, '%'))],
    run: (src, p) => {
      if (!p.img) return src;
      const w = src.width, h = src.height, im = p.img;
      return C.draw(w, h, (x) => {
        x.drawImage(src, 0, 0); x.globalCompositeOperation = p.mode; x.globalAlpha = p.op / 100;
        if (p.fit === 'cover') { const k = Math.max(w / im.width, h / im.height); x.drawImage(im, (w - im.width * k) / 2, (h - im.height * k) / 2, im.width * k, im.height * k); }
        else { const dw = (p.scale / 100) * w, dh = (dw * im.height) / im.width; x.drawImage(im, (p.x / 100) * (w - dw), (p.y / 100) * (h - dh), dw, dh); }
      });
    },
  },
  {
    id: 'combine', name: 'Combine Two Images', cat, tags: 'side by side join merge stitch before after',
    desc: 'Join a second image beside or below this one.',
    params: [image('img', 'Second image'), select('dir', 'Placement', [['right', 'To the right'], ['below', 'Below'], ['left', 'To the left'], ['above', 'Above']]), bool('match', 'Match size', true), range('gap', 'Gap', 0, 200, 0, 1, 'px'), color('bg', 'Gap color', '#ffffff')],
    run: (src, p, env) => {
      if (!p.img) return src;
      const horiz = p.dir === 'right' || p.dir === 'left', g = p.gap * env.s;
      let b = p.img;
      if (p.match) b = horiz ? C.resizeCanvas(b, (b.width * src.height) / b.height, src.height) : C.resizeCanvas(b, src.width, (b.height * src.width) / b.width);
      else b = C.resizeCanvas(b, b.width * env.s, b.height * env.s);
      const W = horiz ? src.width + b.width + g : Math.max(src.width, b.width), H = horiz ? Math.max(src.height, b.height) : src.height + b.height + g;
      const first = p.dir === 'right' || p.dir === 'below' ? src : b, second = first === src ? b : src;
      return C.draw(W, H, (x) => {
        x.fillStyle = p.bg; x.fillRect(0, 0, W, H);
        x.drawImage(first, 0, 0);
        x.drawImage(second, horiz ? first.width + g : 0, horiz ? 0 : first.height + g);
      });
    },
  },
  {
    id: 'anaglyph', name: 'Stereoscopic 3D (Anaglyph)', cat, tags: '3d red cyan glasses stereo anaglyph',
    desc: 'Red/cyan 3D image from a left/right photo pair — or a pop-out fake from a single image.',
    params: [image('img', 'Right-eye image (optional)'), range('shift', 'Depth shift (single image)', 0, 60, 10, 0.5, 'px'), select('type', 'Type', [['color', 'Color anaglyph'], ['gray', 'Gray anaglyph'], ['dubois', 'Optimized (Dubois)']])],
    run: (src, p, env) => {
      const w = src.width, h = src.height;
      const R = p.img ? C.resizeCanvas(p.img, w, h) : C.draw(w, h, (x) => x.drawImage(src, -p.shift * env.s, 0));
      const L = C.readData(src), Rd = C.readData(R).data, a = L.data;
      for (let i = 0; i < a.length; i += 4) {
        const lr = a[i], lg = a[i + 1], lb = a[i + 2], rr = Rd[i], rg = Rd[i + 1], rb = Rd[i + 2];
        if (p.type === 'gray') { a[i] = C.luma(lr, lg, lb); a[i + 1] = a[i + 2] = C.luma(rr, rg, rb); }
        else if (p.type === 'dubois') {
          a[i] = 0.456 * lr + 0.5 * lg + 0.176 * lb - 0.043 * rr - 0.088 * rg - 0.002 * rb;
          a[i + 1] = -0.04 * lr - 0.038 * lg - 0.016 * lb + 0.378 * rr + 0.734 * rg - 0.018 * rb;
          a[i + 2] = -0.015 * lr - 0.021 * lg - 0.005 * lb - 0.072 * rr - 0.113 * rg + 1.226 * rb;
        } else { a[i] = lr; a[i + 1] = rg; a[i + 2] = rb; }
      }
      return C.writeData(L);
    },
  },
  {
    id: 'anaglyph-to-2d', name: '3D Anaglyph → 2D', cat, tags: 'convert anaglyph stereo normal',
    desc: 'Recover a normal-looking 2D picture from a red/cyan anaglyph.',
    params: [select('eye', 'Use', [['left', 'Left eye (red channel)'], ['right', 'Right eye (cyan channels)']]), bool('color', 'Approximate color', true)],
    run: (src, p) => C.perPixel(src, (a, i) => {
      const v = p.eye === 'left' ? a[i] : (a[i + 1] + a[i + 2]) / 2;
      if (!p.color) { a[i] = a[i + 1] = a[i + 2] = v; return; }
      if (p.eye === 'left') { a[i + 1] = (a[i + 1] + v) / 2; a[i + 2] = (a[i + 2] + v) / 2; } else a[i] = v * 0.9 + a[i] * 0.1;
    }),
  },
];
