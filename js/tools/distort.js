// Geometric distortions.
import * as C from '../core.js';
import { range, select, seed, bool, when } from '../params.js';

const cat = 'distort';
const center = (src, p) => [(p.cx / 100) * src.width, (p.cy / 100) * src.height];
const cxcy = () => [range('cx', 'Center X', 0, 100, 50, 1, '%'), range('cy', 'Center Y', 0, 100, 50, 1, '%')];

export default [
  {
    id: 'swirl', name: 'Swirl / Twirl', cat, tags: 'twist vortex spiral',
    desc: 'Twist the image around a center point.',
    params: [range('angle', 'Angle', -720, 720, 180, 1, '°'), range('r', 'Radius', 5, 100, 50, 1, '%'), ...cxcy()],
    run: (src, p) => {
      const [cx, cy] = center(src, p), R = (p.r / 100) * Math.min(src.width, src.height), A = (p.angle * Math.PI) / 180;
      return C.remap(src, (x, y, q) => {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        if (d >= R) return;
        const t = (1 - d / R) ** 2 * A, c = Math.cos(t), s = Math.sin(t);
        q[0] = cx + dx * c - dy * s; q[1] = cy + dx * s + dy * c;
      });
    },
  },
  {
    id: 'pinch', name: 'Pinch / Bulge', cat, tags: 'bulge bloat bubble fat',
    desc: 'Squeeze inward (pinch) or push outward (bulge).',
    params: [range('amt', 'Amount (− pinch, + bulge)', -100, 100, 50), range('r', 'Radius', 5, 100, 45, 1, '%'), ...cxcy()],
    run: (src, p) => {
      const [cx, cy] = center(src, p), R = (p.r / 100) * Math.min(src.width, src.height), k = p.amt / 100;
      return C.remap(src, (x, y, q) => {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        if (d >= R || !d) return;
        const t = d / R, m = Math.pow(t, 1 + k * 0.9) / t;
        q[0] = cx + dx * m; q[1] = cy + dy * m;
      });
    },
  },
  {
    id: 'fisheye', name: 'Fisheye Lens', cat, tags: 'barrel lens wide gopro',
    desc: 'Barrel distortion of an ultra-wide fisheye lens (or pincushion with negative values).',
    params: [range('amt', 'Strength', -100, 100, 60), bool('circle', 'Circular crop')],
    run: (src, p) => {
      const w = src.width, h = src.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy), k = p.amt / 100;
      const out = C.remap(src, (x, y, q) => {
        const nx = (x - cx) / R, ny = (y - cy) / R, r = Math.hypot(nx, ny);
        if (!r) return;
        const nr = k >= 0 ? Math.pow(r, 1 + k) : r * (1 + k * 0.5 * r * r) / (1 + k * 0.5);
        q[0] = cx + (nx / r) * nr * R; q[1] = cy + (ny / r) * nr * R;
      }, p.circle ? 'transparent' : 'clamp');
      if (!p.circle) return out;
      return C.draw(w, h, (x) => { x.beginPath(); x.arc(cx, cy, R, 0, 7); x.clip(); x.drawImage(out, 0, 0); });
    },
  },
  {
    id: 'waves', name: 'Waves', cat, tags: 'wave sine wavy flag',
    desc: 'Sine-wave displacement — horizontal, vertical or both.',
    params: [range('amp', 'Amplitude', 0, 100, 12, 0.5, 'px'), range('len', 'Wavelength', 5, 500, 80, 1, 'px'), select('dir', 'Direction', [['h', 'Horizontal'], ['v', 'Vertical'], ['both', 'Both']]), range('phase', 'Phase', 0, 360, 0, 1, '°')],
    run: (src, p, env) => {
      const A = p.amp * env.s, L = Math.max(2, p.len * env.s), ph = (p.phase * Math.PI) / 180;
      return C.remap(src, (x, y, q) => {
        if (p.dir !== 'v') q[0] = x + A * Math.sin((y / L) * Math.PI * 2 + ph);
        if (p.dir !== 'h') q[1] = y + A * Math.sin((x / L) * Math.PI * 2 + ph);
      }, 'mirror');
    },
  },
  {
    id: 'ripple', name: 'Radial Waves / Ripple', cat, tags: 'water ripple pond rings',
    desc: 'Concentric ripples like a stone dropped in water.',
    params: [range('amp', 'Amplitude', 0, 60, 10, 0.5, 'px'), range('len', 'Wavelength', 4, 200, 40, 1, 'px'), range('decay', 'Fade out', 0, 100, 50), ...cxcy()],
    run: (src, p, env) => {
      const [cx, cy] = center(src, p), A = p.amp * env.s, L = Math.max(2, p.len * env.s), R = Math.hypot(src.width, src.height) / 2;
      return C.remap(src, (x, y, q) => {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        if (!d) return;
        const fall = 1 - (p.decay / 100) * Math.min(1, d / R);
        const o = A * Math.sin((d / L) * Math.PI * 2) * fall;
        q[0] = x + (dx / d) * o; q[1] = y + (dy / d) * o;
      }, 'mirror');
    },
  },
  {
    id: 'raindrops', name: 'Raindrop Ripples', cat, tags: 'rain drops water puddle',
    desc: 'Many small ripples from fallen raindrops.',
    params: [range('count', 'Drops', 1, 60, 14), range('size', 'Ripple size', 2, 40, 10, 0.5, '%'), range('amp', 'Strength', 0, 30, 6, 0.5, 'px'), seed()],
    run: (src, p, env) => {
      const rand = C.rng(p.seed), w = src.width, h = src.height, M = Math.max(w, h);
      const drops = Array.from({ length: p.count }, () => [rand() * w, rand() * h, (0.4 + rand() * 0.8) * (p.size / 100) * M]);
      const A = p.amp * env.s, L = Math.max(3, 14 * env.s);
      return C.remap(src, (x, y, q) => {
        let ox = 0, oy = 0;
        for (const [cx, cy, R] of drops) {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
          if (d >= R || !d) continue;
          const o = A * Math.sin((d / L) * Math.PI * 2 - (R / L)) * (1 - d / R) ** 2;
          ox += (dx / d) * o; oy += (dy / d) * o;
        }
        q[0] = x + ox; q[1] = y + oy;
      }, 'mirror');
    },
  },
  {
    id: 'displace', name: 'Turbulent Distortion', cat, tags: 'noise warp liquid displace heat haze',
    desc: 'Organic, liquid-like warping driven by fractal noise.',
    params: [range('amt', 'Strength', 0, 150, 25, 1, 'px'), range('scale', 'Scale', 5, 500, 90, 1, 'px'), range('oct', 'Detail', 1, 6, 3), seed()],
    run: (src, p, env) => {
      const A = p.amt * env.s, S = Math.max(2, p.scale * env.s);
      return C.remap(src, (x, y, q) => {
        q[0] = x + (C.fbm(x / S, y / S, p.oct, p.seed) - 0.5) * 2 * A;
        q[1] = y + (C.fbm(x / S + 31.7, y / S + 11.3, p.oct, p.seed + 5) - 0.5) * 2 * A;
      }, 'mirror');
    },
  },
  {
    id: 'polar', name: 'Polar Coordinates', cat, tags: 'little planet tiny world polar',
    desc: 'Wrap the image into a circle (tiny planet) or unwrap it.',
    params: [select('mode', 'Mode', [['toPolar', 'Rectangular → Polar (tiny planet)'], ['toRect', 'Polar → Rectangular']]), bool('flip', 'Flip vertically'), range('rot', 'Rotation', 0, 360, 0, 1, '°')],
    run: (src, p) => {
      const w = src.width, h = src.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy) * Math.SQRT2, rot = (p.rot * Math.PI) / 180;
      return C.remap(src, (x, y, q) => {
        if (p.mode === 'toPolar') {
          const dx = (x - cx) / Math.min(cx, cy), dy = (y - cy) / Math.min(cx, cy);
          let a = Math.atan2(dy, dx) + Math.PI / 2 + rot; a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const r = Math.hypot(dx, dy) / Math.SQRT2;
          q[0] = (a / (2 * Math.PI)) * w; q[1] = p.flip ? r * h : (1 - r) * h;
        } else {
          const a = (x / w) * Math.PI * 2 - Math.PI / 2 + rot, r = (p.flip ? y / h : 1 - y / h) * R;
          q[0] = cx + Math.cos(a) * r; q[1] = cy + Math.sin(a) * r;
        }
      }, 'clamp');
    },
  },
  {
    id: 'kaleidoscope', name: 'Kaleidoscope', cat, tags: 'mandala symmetry mirror',
    desc: 'Mirror a wedge of the image into a kaleidoscope pattern.',
    params: [range('n', 'Segments', 2, 24, 8), range('angle', 'Rotation', 0, 360, 0, 1, '°'), range('zoom', 'Zoom', 20, 300, 100, 1, '%'), ...cxcy()],
    run: (src, p) => {
      const [cx, cy] = center(src, p), seg = (Math.PI * 2) / p.n, rot = (p.angle * Math.PI) / 180, z = 100 / p.zoom;
      const ox = src.width / 2, oy = src.height / 2;
      return C.remap(src, (x, y, q) => {
        const dx = x - ox, dy = y - oy, r = Math.hypot(dx, dy) * z;
        let a = Math.atan2(dy, dx) + rot;
        a = ((a % seg) + seg) % seg;
        if (a > seg / 2) a = seg - a;
        q[0] = cx + Math.cos(a) * r; q[1] = cy + Math.sin(a) * r;
      }, 'mirror');
    },
  },
  {
    id: 'mirror', name: 'Mirror Reflection', cat, tags: 'symmetry reflect flip half',
    desc: 'Make the image symmetrical by mirroring one half (or quadrant).',
    params: [select('mode', 'Mirror', [['lr', 'Left → Right'], ['rl', 'Right → Left'], ['tb', 'Top → Bottom'], ['bt', 'Bottom → Top'], ['quad', 'Top-left → all 4'], ['water', 'Water reflection below']])],
    run: (src, p) => {
      const w = src.width, h = src.height;
      if (p.mode === 'water') {
        return C.draw(w, Math.round(h * 1.5), (x) => {
          x.drawImage(src, 0, 0);
          x.save(); x.translate(0, h * 2); x.scale(1, -1); x.drawImage(src, 0, 0); x.restore();
          const g = x.createLinearGradient(0, h, 0, h * 1.5);
          g.addColorStop(0, 'rgba(10,30,50,0.25)'); g.addColorStop(1, 'rgba(10,30,50,0.75)');
          x.fillStyle = g; x.fillRect(0, h, w, h / 2);
        });
      }
      return C.remap(src, (x, y, q) => {
        if (p.mode === 'lr' && x > w / 2) q[0] = w - 1 - x;
        if (p.mode === 'rl' && x < w / 2) q[0] = w - 1 - x;
        if (p.mode === 'tb' && y > h / 2) q[1] = h - 1 - y;
        if (p.mode === 'bt' && y < h / 2) q[1] = h - 1 - y;
        if (p.mode === 'quad') { if (x > w / 2) q[0] = w - 1 - x; if (y > h / 2) q[1] = h - 1 - y; }
      });
    },
  },
  {
    id: 'shear', name: 'Shear / Skew', cat, tags: 'skew slant italic perspective',
    desc: 'Slant the image horizontally or vertically.',
    params: [range('x', 'Horizontal skew', -60, 60, 15, 1, '°'), range('y', 'Vertical skew', -60, 60, 0, 1, '°'), bool('expand', 'Expand canvas', true)],
    run: (src, p) => {
      const tx = Math.tan((p.x * Math.PI) / 180), ty = Math.tan((p.y * Math.PI) / 180), w = src.width, h = src.height;
      const W = p.expand ? w + Math.abs(tx) * h : w, H = p.expand ? h + Math.abs(ty) * w : h;
      return C.draw(W, H, (x) => {
        x.setTransform(1, ty, tx, 1, p.expand ? (tx < 0 ? -tx * h : 0) : -tx * h / 2, p.expand ? (ty < 0 ? -ty * w : 0) : -ty * w / 2);
        x.drawImage(src, 0, 0);
      });
    },
  },
  {
    id: 'perspective', name: 'Perspective Tilt', cat, tags: '3d tilt keystone perspective',
    desc: 'Tilt the image in 3D — vanishing-point perspective.',
    params: [range('h', 'Horizontal tilt', -80, 80, 25, 1, '°'), range('v', 'Vertical tilt', -80, 80, 0, 1, '°'), range('dist', 'Camera distance', 50, 400, 150, 1, '%')],
    run: (src, p) => {
      const w = src.width, h = src.height, ay = (p.h * Math.PI) / 180, ax = (p.v * Math.PI) / 180, D = (p.dist / 100) * Math.max(w, h);
      const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      // inverse: ray from camera through output pixel, intersect rotated plane
      return C.remap(src, (x, y, q) => {
        const dx = x - w / 2, dy = y - h / 2, dz = D;
        // plane normal after rotation
        const nx = sy * cx, ny = -sx, nz = cy * cx;
        const denom = dx * nx + dy * ny + dz * nz;
        if (Math.abs(denom) < 1e-6) { q[0] = -1e6; return; }
        const t = (D * nz) / denom;
        const px = dx * t, py = dy * t, pz = dz * t - D;
        // un-rotate point: inverse of Rx(ax)·Ry(ay)
        const y1 = py * cx - pz * sx, z1 = py * sx + pz * cx;
        const x2 = px * cy - z1 * sy;
        q[0] = x2 + w / 2; q[1] = y1 + h / 2;
      }, 'transparent');
    },
  },
];
