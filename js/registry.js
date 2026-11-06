import adjust from './tools/adjust.js';
import color from './tools/color.js';
import blur from './tools/blur.js';
import artistic from './tools/artistic.js';
import distort from './tools/distort.js';
import transform from './tools/transform.js';
import generate from './tools/generate.js';
import panels from './tools/panels.js';

export const CATEGORIES = [
  { id: 'transform', short: 'Layout', name: 'Resize, Crop & Layout', icon: 'M4 4h6M4 4v6M20 20h-6M20 20v-6M8 8h8v8H8z' },
  { id: 'adjust', short: 'Adjust', name: 'Adjust & Improve', icon: 'M12 3v18M3 12h18M12 3a9 9 0 1 0 0 18' },
  { id: 'color', short: 'Color', name: 'Color & Tone', icon: 'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11h.01M12 7.5h.01M16.5 11h.01' },
  { id: 'blur', short: 'Blur & Light', name: 'Blur, Light & Lens', icon: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { id: 'artistic', short: 'Artistic', name: 'Artistic & Stylize', icon: 'M18 2l4 4-12 12H6v-4zM2 22c1.5-1.5 3-2 4-2' },
  { id: 'distort', short: 'Distort', name: 'Distort & Warp', icon: 'M2 12c3-6 6 6 10 0s7 6 10 0M2 6c3-6 6 6 10 0s7 6 10 0M2 18c3-6 6 6 10 0s7 6 10 0' },
  { id: 'generate', short: 'Create', name: 'Create New Image', icon: 'M12 5v14M5 12h14' },
  { id: 'utility', short: 'Utilities', name: 'Inspect & Utilities', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5' },
];

export const TOOLS = [...transform, ...adjust, ...color, ...blur, ...artistic, ...distort, ...generate, ...panels];
export const TOOL_MAP = new Map(TOOLS.map((t) => [t.id, t]));
export const getTool = (id) => TOOL_MAP.get(id);

// Popular picks shown on the start screen
export const FEATURED = ['auto-enhance', 'resize', 'crop', 'remove-bg-color', 'tilt-shift', 'pencil-sketch', 'cartoon', 'exif', 'palette', 'gen-mesh', 'gen-qr', 'pixel-art'];

export function searchTools(q) {
  q = q.trim().toLowerCase();
  if (!q) return TOOLS;
  const words = q.split(/\s+/);
  return TOOLS.map((t) => {
    const hay = `${t.name} ${t.tags || ''} ${t.desc}`.toLowerCase(), name = t.name.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (name.startsWith(w)) score += 5;
      else if (name.includes(w)) score += 3;
      else if ((t.tags || '').includes(w)) score += 2;
      else if (hay.includes(w)) score += 1;
      else return null;
    }
    return { t, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).map((x) => x.t);
}
