// Parameter descriptor helpers used by tool definitions.
export const range = (key, label, min, max, def, step = 1, unit = '', extra = {}) => ({ type: 'range', key, label, min, max, def, step, unit, ...extra });
export const num = (key, label, min, max, def, extra = {}) => ({ type: 'number', key, label, min, max, def, ...extra });
export const select = (key, label, options, def, extra = {}) => {
  const opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  return { type: 'select', key, label, options: opts, def: def ?? opts[0][0], ...extra };
};
export const color = (key, label, def = '#000000', extra = {}) => ({ type: 'color', key, label, def, ...extra });
export const bool = (key, label, def = false, extra = {}) => ({ type: 'bool', key, label, def, ...extra });
export const text = (key, label, def = '', extra = {}) => ({ type: 'text', key, label, def, ...extra });
export const image = (key, label, extra = {}) => ({ type: 'image', key, label, def: null, ...extra });
export const curve = (key, label = 'Curve') => ({ type: 'curve', key, label, def: [[0, 0], [255, 255]] });
export const seed = (key = 'seed', label = 'Seed') => ({ type: 'seed', key, label, def: 7 });
export const when = (fn, p) => ({ ...p, when: fn });

export function defaults(tool) {
  const o = {};
  for (const p of tool.params || []) o[p.key] = Array.isArray(p.def) ? p.def.map((x) => (Array.isArray(x) ? x.slice() : x)) : p.def;
  return o;
}

export const PALETTES = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  nes: ['#000000', '#fcfcfc', '#f8f8f8', '#bcbcbc', '#7c7c7c', '#a4e4fc', '#3cbcfc', '#0078f8', '#0000fc', '#b8b8f8', '#6888fc', '#0058f8', '#0000bc', '#d8b8f8', '#9878f8', '#6844fc', '#4428bc', '#f8b8f8', '#f878f8', '#d800cc', '#940084', '#f8a4c0', '#f85898', '#e40058', '#a80020', '#f0d0b0', '#f87858', '#f83800', '#a81000', '#fce0a8', '#fca044', '#e45c10', '#881400', '#f8d878', '#f8b800', '#ac7c00', '#503000', '#d8f878', '#b8f818', '#00b800', '#007800', '#b8f8b8', '#58d854', '#00a800', '#006800', '#b8f8d8', '#58f898', '#00a844', '#005800', '#00fcfc', '#00e8d8', '#008888', '#004058'],
  c64: ['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77', '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb'],
  grayscale4: ['#000000', '#555555', '#aaaaaa', '#ffffff'],
  sepia4: ['#2b1d0e', '#6b4f2a', '#b89a6a', '#efe0c0'],
  websafe: (() => {
    const v = ['00', '33', '66', '99', 'cc', 'ff'], o = [];
    for (const r of v) for (const g of v) for (const b of v) o.push('#' + r + g + b);
    return o;
  })(),
};
export const PALETTE_OPTIONS = [['auto', 'Auto (from image)'], ['gameboy', 'Game Boy'], ['pico8', 'PICO-8'], ['nes', 'NES'], ['c64', 'C64'], ['cga', 'CGA'], ['grayscale4', 'Grayscale 4'], ['sepia4', 'Sepia 4'], ['websafe', 'Web-safe 216']];
export const DITHER_OPTIONS = [['none', 'None'], ['fs', 'Floyd–Steinberg'], ['atkinson', 'Atkinson'], ['jarvis', 'Jarvis–Judice–Ninke'], ['sierra', 'Sierra'], ['bayer2', 'Ordered (Bayer 2×2)'], ['bayer4', 'Ordered (Bayer 4×4)'], ['bayer8', 'Ordered (Bayer 8×8)'], ['random', 'Random noise']];
