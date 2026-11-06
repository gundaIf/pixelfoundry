// Utility tools that render their own interactive panel instead of a single filter.
import * as C from '../core.js';
import { h, toast, download, copyText, pickFiles, fileToCanvas, canvasToBlob } from '../dom.js';
import { LIBS } from '../libs.js';
import { isJpeg, isPng, inspectJpeg, inspectPng, stripJpeg, stripPng, fmtBytes } from '../meta.js';

const cat = 'utility';
const NAMED = 'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'
  .split(' ').map((s) => { const [n, x] = s.split(':'); return [n, C.hexToRgb(x)]; });
export function nearestNamed(rgb) {
  let best = null, bd = Infinity;
  for (const [n, c] of NAMED) { const d = (c[0] - rgb[0]) ** 2 * 0.3 + (c[1] - rgb[1]) ** 2 * 0.59 + (c[2] - rgb[2]) ** 2 * 0.11; if (d < bd) { bd = d; best = n; } }
  return best;
}
function parseColor(str) {
  const c = h('canvas', { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000'; c.fillStyle = str; c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
function colorFormats(rgb) {
  const [r, g, b] = rgb, [hh, s, l] = C.rgbToHsl(r, g, b), [H, S, V] = C.rgbToHsv(r, g, b);
  const k = 1 - Math.max(r, g, b) / 255, cm = (x) => (k === 1 ? 0 : Math.round(((1 - x / 255 - k) / (1 - k)) * 100));
  return [
    ['HEX', C.rgbToHex(r, g, b)], ['RGB', `rgb(${r}, ${g}, ${b})`], ['HSL', `hsl(${Math.round(hh * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`],
    ['HSV', `hsv(${Math.round(H)}, ${Math.round(S * 100)}%, ${Math.round(V * 100)}%)`], ['CMYK', `cmyk(${cm(r)}%, ${cm(g)}%, ${cm(b)}%, ${Math.round(k * 100)}%)`], ['Name ≈', nearestNamed(rgb)],
  ];
}
const swatch = (rgb, extra = '') => h('span.swatch', { style: { background: C.rgbToHex(...rgb) }, title: C.rgbToHex(...rgb) + extra });
const kv = (rows) => h('table.kv', {}, rows.filter(Boolean).map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))));
const needImage = (api, el) => { if (api.hasImage()) return false; el.append(h('p.muted', {}, 'Open an image first.')); return true; };
const btn = (label, onClick, cls = '') => h('button.btn', { class: cls, onClick }, label);

async function canvasFromFiles(multiple = true) {
  const files = await pickFiles({ multiple });
  return Promise.all(files.map(async (f) => ({ name: f.name, canvas: await fileToCanvas(f) })));
}

export default [
  {
    id: 'info', name: 'Image Info & Size', cat, kind: 'panel', tags: 'megapixels dimensions resolution size print dpi unique colors',
    desc: 'Dimensions, megapixels, file size, print sizes, unique colors and transparency.',
    mount(el, api) {
      if (needImage(api, el)) return;
      const f = api.file(), o = api.original(), d = C.readData(o.width * o.height > 16e6 ? C.resizeCanvas(o, 4000, (4000 * o.height) / o.width) : o);
      const set = new Set(), a = d.data;
      let alpha = false;
      for (let i = 0; i < a.length; i += 4) { set.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]); if (a[i + 3] < 255) alpha = true; }
      const [r, g, b] = C.averageColor(o);
      const gcd = (x, y) => (y ? gcd(y, x % y) : x), gg = gcd(o.width, o.height);
      el.append(kv([
        ['File', f ? f.name : '—'], ['Type', f ? f.type || '—' : '—'], ['File size', f ? fmtBytes(f.size) : '—'],
        ['Dimensions', `${o.width} × ${o.height} px`], ['Megapixels', (o.width * o.height / 1e6).toFixed(2) + ' MP'],
        ['Aspect ratio', `${o.width / gg}:${o.height / gg}  (${(o.width / o.height).toFixed(3)})`],
        ['Print @ 300 dpi', `${(o.width / 300 * 2.54).toFixed(1)} × ${(o.height / 300 * 2.54).toFixed(1)} cm  ·  ${(o.width / 300).toFixed(2)} × ${(o.height / 300).toFixed(2)} in`],
        ['Print @ 150 dpi', `${(o.width / 150 * 2.54).toFixed(1)} × ${(o.height / 150 * 2.54).toFixed(1)} cm`],
        ['Unique colors', set.size.toLocaleString() + (d.width !== o.width ? ' (sampled)' : '')],
        ['Average color', h('span', {}, swatch([r, g, b].map(Math.round)), ' ', C.rgbToHex(r, g, b))],
        ['Transparency', alpha ? 'Yes' : 'No'],
        ['Current result', `${api.resultSize().join(' × ')} px`],
      ]));
    },
  },
  {
    id: 'exif', name: 'EXIF / Metadata Viewer & Remover', cat, kind: 'panel', tags: 'exif metadata gps location camera iptc xmp privacy remove strip',
    desc: 'See camera, lens, GPS and all EXIF/IPTC/XMP data. Strip it losslessly (no recompression) for privacy.',
    async mount(el, api) {
      if (needImage(api, el)) return;
      const f = api.file();
      if (!f || !f.bytes) { el.append(h('p.muted', {}, 'Metadata is only available for images opened from a file.')); return; }
      const bytes = f.bytes, jpg = isJpeg(bytes), png = isPng(bytes);
      const actions = h('div.row.wrap');
      if (jpg || png) {
        actions.append(btn('Download without metadata (lossless)', () => {
          const out = jpg ? stripJpeg(bytes, { icc: true }) : stripPng(bytes);
          download(new Blob([out], { type: f.type }), f.name.replace(/(\.\w+)?$/, '-clean$1'));
          toast(`Removed ${fmtBytes(bytes.length - out.length)} of metadata — pixels untouched`, 'ok');
        }, 'primary'));
      }
      el.append(actions);
      const box = h('div', {}, h('p.muted', {}, 'Reading metadata…'));
      el.append(box);
      try {
        const exifr = await LIBS.exifr();
        const data = await (exifr.default || exifr).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: true, jfif: true, ihdr: true, mergeOutput: false, translateValues: true, reviveValues: true });
        box.innerHTML = '';
        if (!data || !Object.keys(data).length) { box.append(h('p.muted', {}, 'No metadata found in this file. 🎉')); return; }
        const gps = data.gps;
        if (gps && gps.latitude != null) {
          box.append(h('div.callout.warn', {}, '📍 This photo contains GPS location: ', h('b', {}, `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`), ' — ', h('a', { href: `https://www.openstreetmap.org/?mlat=${gps.latitude}&mlon=${gps.longitude}#map=15/${gps.latitude}/${gps.longitude}`, target: '_blank', rel: 'noopener' }, 'view on map')));
        }
        const fmt = (v) => (v instanceof Date ? v.toLocaleString() : v instanceof Uint8Array ? `[${v.length} bytes]` : Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v));
        for (const [group, vals] of Object.entries(data)) {
          if (!vals || typeof vals !== 'object') continue;
          const rows = Object.entries(vals).filter(([k]) => !/thumbnail|makernote|userComment$/i.test(k)).map(([k, v]) => [k, fmt(v).slice(0, 300)]);
          if (!rows.length) continue;
          box.append(h('details.group', { open: ['ifd0', 'exif', 'gps'].includes(group) }, h('summary', {}, `${group.toUpperCase()} (${rows.length})`), kv(rows)));
        }
        box.append(btn('Copy all as JSON', () => copyText(JSON.stringify(data, (k, v) => (v instanceof Uint8Array ? undefined : v), 2))));
      } catch (e) {
        box.innerHTML = '';
        box.append(h('p.muted', {}, 'Could not read metadata: ' + e.message));
      }
    },
  },
  {
    id: 'file-inspector', name: 'JPEG / PNG Inspector', cat, kind: 'panel', tags: 'jpeg quality progressive baseline subsampling chroma png chunks determine quality',
    desc: 'Estimate JPEG quality, check progressive vs baseline, chroma subsampling, and list file segments/chunks.',
    mount(el, api) {
      if (needImage(api, el)) return;
      const f = api.file();
      if (!f || !f.bytes) { el.append(h('p.muted', {}, 'Open a JPEG or PNG file to inspect it.')); return; }
      if (isJpeg(f.bytes)) {
        const i = inspectJpeg(f.bytes);
        el.append(kv([
          ['Format', 'JPEG'], ['Encoding', i.progressive ? 'Progressive' : i.baseline ? 'Baseline' : 'Extended'],
          ['Estimated quality', i.quality != null ? `${i.quality}${i.qualityExact ? ' (exact IJG match)' : ' (approx.)'}` : '—'],
          ['Chroma subsampling', i.subsampling], ['Components', i.components],
          ['EXIF', i.hasExif ? 'Yes' : 'No'], ['XMP', i.hasXmp ? 'Yes' : 'No'], ['IPTC', i.hasIptc ? 'Yes' : 'No'], ['ICC profile', i.hasIcc ? 'Yes' : 'No'],
          i.comments.length && ['Comments', i.comments.join(' | ')],
        ]));
        el.append(h('h4', {}, 'Segments'), kv(i.markers.map((m) => [m.name, fmtBytes(m.size)])));
      } else if (isPng(f.bytes)) {
        const i = inspectPng(f.bytes);
        el.append(kv([['Format', i.animated ? 'APNG (animated PNG)' : 'PNG'], ['Color type', i.colorType], ['Bit depth', i.bitDepth], ['Interlaced (Adam7)', i.interlaced ? 'Yes' : 'No'], ...i.texts.map(([k, v]) => ['tEXt · ' + k, v.slice(0, 200)])]));
        el.append(h('h4', {}, 'Chunks'), kv(i.chunks.map((c) => [c.name, fmtBytes(c.size)])));
      } else el.append(h('p.muted', {}, `${f.type || 'This format'} isn't inspected yet — JPEG and PNG are supported.`));
    },
  },
  {
    id: 'palette', name: 'Dominant Colors / Palette', cat, kind: 'panel', tags: 'palette dominant colors extract scheme brand',
    desc: 'Extract the dominant color palette with percentages. Copy as HEX, CSS variables or JSON; download a swatch image.',
    mount(el, api) {
      if (needImage(api, el)) return;
      const out = h('div');
      const n = h('input', { type: 'range', min: 2, max: 16, value: 6 });
      const lab = h('span.muted', {}, '6 colors');
      const run = () => {
        lab.textContent = n.value + ' colors';
        const src = C.resizeCanvas(api.preview(), 240, (240 * api.preview().height) / api.preview().width);
        const res = C.kmeans(C.samplePixels(C.readData(src), 12000), +n.value);
        out.innerHTML = '';
        out.append(h('div.palette-bar', {}, res.map((c) => h('span', { style: { background: C.rgbToHex(...c.rgb), flex: c.share }, title: C.rgbToHex(...c.rgb) }))));
        out.append(h('div.palette-list', {}, res.map((c) => {
          const hex = C.rgbToHex(...c.rgb);
          return h('button.palette-item', { onClick: () => copyText(hex) }, swatch(c.rgb), h('code', {}, hex), h('span.muted', {}, nearestNamed(c.rgb)), h('span.pct', {}, (c.share * 100).toFixed(1) + '%'));
        })));
        const hexes = res.map((c) => C.rgbToHex(...c.rgb));
        out.append(h('div.row.wrap', {},
          btn('Copy HEX list', () => copyText(hexes.join(', '))),
          btn('Copy CSS vars', () => copyText(':root {\n' + hexes.map((x, i) => `  --color-${i + 1}: ${x};`).join('\n') + '\n}')),
          btn('Copy JSON', () => copyText(JSON.stringify(hexes))),
          btn('Download swatch PNG', async () => {
            const c = C.draw(hexes.length * 160, 220, (x) => { hexes.forEach((hx, i) => { x.fillStyle = hx; x.fillRect(i * 160, 0, 160, 160); x.fillStyle = '#fff'; x.fillRect(i * 160, 160, 160, 60); x.fillStyle = '#222'; x.font = '600 20px ui-monospace, monospace'; x.textAlign = 'center'; x.fillText(hx.toUpperCase(), i * 160 + 80, 198); }); });
            download(await canvasToBlob(c), 'palette.png');
          }),
        ));
      };
      n.addEventListener('input', run);
      el.append(h('label.field', {}, h('span', {}, 'Number of colors'), h('div.row', {}, n, lab)), out);
      run();
    },
  },
  {
    id: 'color-tools', name: 'Color Picker & Converter', cat, kind: 'panel', tags: 'eyedropper picker hex rgb hsl hsv cmyk convert mix harmony named colors',
    desc: 'Pick colors from the image, convert between HEX/RGB/HSL/HSV/CMYK, find named colors, mix colors and build harmonies.',
    mount(el, api) {
      let cur = [79, 70, 229];
      const preview = h('div.color-preview');
      const input = h('input.text', { value: '#4f46e5', placeholder: 'Any CSS color: #hex, rgb(), hsl(), name…' });
      const formats = h('div');
      const harm = h('div.harmonies');
      const mixA = h('input', { type: 'color', value: '#4f46e5' }), mixB = h('input', { type: 'color', value: '#f59e0b' }), mixT = h('input', { type: 'range', min: 0, max: 100, value: 50 });
      const mixOut = h('div.mix-out');
      const render = () => {
        preview.style.background = C.rgbToHex(...cur);
        formats.innerHTML = '';
        formats.append(h('div.formats', {}, colorFormats(cur).map(([k, v]) => h('button.fmt', { onClick: () => copyText(v), title: 'Copy' }, h('span.muted', {}, k), h('code', {}, v)))));
        const [hh, s, l] = C.rgbToHsl(...cur);
        const mk = (dh, label) => { const c = C.hslToRgb((hh + dh / 360 + 1) % 1, s, l).map(Math.round); return h('button.harm', { onClick: () => { cur = c; input.value = C.rgbToHex(...c); render(); }, title: label }, swatch(c), h('small', {}, label)); };
        harm.innerHTML = '';
        harm.append(mk(180, 'Complement'), mk(-30, 'Analog −'), mk(30, 'Analog +'), mk(120, 'Triad 1'), mk(240, 'Triad 2'), mk(150, 'Split 1'), mk(210, 'Split 2'));
        const shades = h('div.shades', {}, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((L) => { const c = C.hslToRgb(hh, s, L).map(Math.round); return h('button', { style: { background: C.rgbToHex(...c) }, title: C.rgbToHex(...c), onClick: () => copyText(C.rgbToHex(...c)) }); }));
        harm.append(shades);
      };
      const renderMix = () => {
        const a = C.hexToRgb(mixA.value), b = C.hexToRgb(mixB.value), t = mixT.value / 100;
        const lin = (v) => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4), unlin = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
        const rgbMix = a.map((v, i) => v + (b[i] - v) * t), linMix = a.map((v, i) => unlin(lin(v) + (lin(b[i]) - lin(v)) * t));
        const paint = a.map((v, i) => 255 - Math.sqrt(((255 - v) ** 2) * (1 - t) + ((255 - b[i]) ** 2) * t));
        mixOut.innerHTML = '';
        [['RGB average', rgbMix], ['Light (linear)', linMix], ['Paint-like', paint]].forEach(([n, c]) => mixOut.append(h('button.harm', { onClick: () => copyText(C.rgbToHex(...c)) }, swatch(c.map(Math.round)), h('small', {}, n), h('code', {}, C.rgbToHex(...c)))));
      };
      input.addEventListener('input', () => { cur = parseColor(input.value); render(); });
      [mixA, mixB, mixT].forEach((i) => i.addEventListener('input', renderMix));
      el.append(
        h('div.row', {}, preview, h('div', { style: { flex: 1 } }, input, h('div.row', { style: { marginTop: '8px' } }, api.hasImage() ? btn('🎯 Pick from image', () => api.pickColor((rgb) => { cur = rgb; input.value = C.rgbToHex(...rgb); render(); }), 'primary') : null))),
        formats, h('h4', {}, 'Harmonies & shades'), harm,
        h('h4', {}, 'Mix two colors'), h('div.row', {}, mixA, mixT, mixB), mixOut,
      );
      render(); renderMix();
    },
  },
  {
    id: 'qr-scan', name: 'Scan QR / Barcode', cat, kind: 'panel', tags: 'qr scan read decode barcode datamatrix ean',
    desc: 'Decode QR codes, barcodes (EAN, UPC, Code-128…) and DataMatrix found in the image.',
    async mount(el, api) {
      if (needImage(api, el)) return;
      const box = h('div', {}, h('p.muted', {}, 'Scanning…'));
      el.append(box);
      const src = api.preview(), results = [];
      try {
        if ('BarcodeDetector' in window) {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          const det = new window.BarcodeDetector({ formats });
          for (const r of await det.detect(src)) results.push({ format: r.format, value: r.rawValue });
        }
        if (!results.length) {
          const jsQR = await LIBS.jsqr();
          for (const scale of [1, 0.5, 2]) {
            const c = scale === 1 ? src : C.resizeCanvas(src, src.width * scale, src.height * scale);
            const d = C.readData(c), r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
            if (r) { results.push({ format: 'qr_code', value: r.data }); break; }
          }
        }
      } catch (e) { box.innerHTML = ''; box.append(h('p.muted', {}, 'Scan failed: ' + e.message)); return; }
      box.innerHTML = '';
      if (!results.length) { box.append(h('p.muted', {}, 'No code found. Try cropping closer to the code or increasing contrast first.')); return; }
      results.forEach((r) => {
        const isUrl = /^https?:\/\//i.test(r.value);
        box.append(h('div.result-card', {}, h('div.muted', {}, r.format.replace(/_/g, ' ').toUpperCase()), h('pre', {}, r.value), h('div.row', {}, btn('Copy', () => copyText(r.value)), isUrl ? h('a.btn', { href: r.value, target: '_blank', rel: 'noopener noreferrer' }, 'Open link ↗') : null)));
      });
    },
  },
  {
    id: 'slice', name: 'Cut Image into Pieces', cat, kind: 'panel', tags: 'split grid slice tiles instagram carousel puzzle',
    desc: 'Split the image into a grid of tiles (e.g. Instagram grid or carousel) and download them as a ZIP.',
    mount(el, api) {
      if (needImage(api, el)) return;
      const rows = h('input.num', { type: 'number', min: 1, max: 20, value: 3 }), cols = h('input.num', { type: 'number', min: 1, max: 20, value: 3 });
      const fmt = h('select', {}, h('option', { value: 'png' }, 'PNG'), h('option', { value: 'jpeg' }, 'JPEG'), h('option', { value: 'webp' }, 'WebP'));
      const show = () => {
        const p = api.preview(), r = +rows.value, c = +cols.value;
        api.setStage(C.draw(p.width, p.height, (x) => {
          x.drawImage(p, 0, 0); x.strokeStyle = '#ff2e63'; x.lineWidth = Math.max(2, p.width / 400); x.setLineDash([10, 6]);
          for (let i = 1; i < c; i++) { x.beginPath(); x.moveTo((i * p.width) / c, 0); x.lineTo((i * p.width) / c, p.height); x.stroke(); }
          for (let i = 1; i < r; i++) { x.beginPath(); x.moveTo(0, (i * p.height) / r); x.lineTo(p.width, (i * p.height) / r); x.stroke(); }
          x.setLineDash([]); x.fillStyle = 'rgba(0,0,0,0.6)'; x.font = `600 ${Math.max(12, p.width / 40)}px Inter, sans-serif`;
          let k = 1; for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) x.fillText(String(k++), (j * p.width) / c + 10, (i * p.height) / r + Math.max(16, p.width / 30));
        }));
      };
      [rows, cols].forEach((i) => i.addEventListener('input', show));
      const presets = h('div.row.wrap', {}, [[1, 3, 'Carousel ×3'], [3, 3, 'Grid 3×3'], [2, 2, '2×2'], [1, 2, 'Halves'], [4, 4, 'Puzzle 4×4']].map(([r, c, l]) => btn(l, () => { rows.value = r; cols.value = c; show(); })));
      el.append(h('div.row', {}, h('label.field', {}, h('span', {}, 'Rows'), rows), h('label.field', {}, h('span', {}, 'Columns'), cols), h('label.field', {}, h('span', {}, 'Format'), fmt)), presets,
        btn('Download all tiles (.zip)', async () => {
          const JSZip = await LIBS.jszip(), full = await api.result(), r = +rows.value, c = +cols.value, zip = new JSZip(), ext = fmt.value === 'jpeg' ? 'jpg' : fmt.value;
          let k = 1;
          for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
            const x0 = Math.round((j * full.width) / c), y0 = Math.round((i * full.height) / r), x1 = Math.round(((j + 1) * full.width) / c), y1 = Math.round(((i + 1) * full.height) / r);
            const t = C.draw(x1 - x0, y1 - y0, (x) => x.drawImage(full, -x0, -y0));
            zip.file(`tile-${String(k++).padStart(2, '0')}-r${i + 1}c${j + 1}.${ext}`, await canvasToBlob(t, 'image/' + fmt.value, 0.92));
          }
          download(await zip.generateAsync({ type: 'blob' }), api.baseName() + '-tiles.zip');
        }, 'primary'));
      show();
      return () => api.setStage(null);
    },
  },
  {
    id: 'compare', name: 'Compare / Find Differences', cat, kind: 'panel', tags: 'difference diff compare similarity spot the difference',
    desc: 'Load a second image to highlight differences, get a similarity score, or view them side by side.',
    mount(el, api) {
      if (needImage(api, el)) return;
      let other = null;
      const mode = h('select', {}, [['heat', 'Difference heatmap'], ['boxes', 'Outline differences'], ['blink', 'Overlay 50%'], ['side', 'Side by side']].map(([v, l]) => h('option', { value: v }, l)));
      const thr = h('input', { type: 'range', min: 1, max: 120, value: 25 });
      const score = h('div.score');
      const run = () => {
        if (!other) return;
        const a = api.preview(), b = C.resizeCanvas(other, a.width, a.height);
        const da = C.readData(a).data, db = C.readData(b).data, w = a.width, hh = a.height, diff = new Float32Array(w * hh);
        let sum = 0;
        for (let j = 0; j < diff.length; j++) { const i = j * 4; diff[j] = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3; sum += diff[j]; }
        // SSIM-ish on 64px grayscale
        const ga = C.grayArray(C.readData(C.resizeCanvas(a, 64, 64))), gb = C.grayArray(C.readData(C.resizeCanvas(b, 64, 64)));
        const mean = (g) => g.reduce((s, v) => s + v, 0) / g.length, ma = mean(ga), mb = mean(gb);
        let va = 0, vb = 0, cov = 0; for (let i = 0; i < ga.length; i++) { va += (ga[i] - ma) ** 2; vb += (gb[i] - mb) ** 2; cov += (ga[i] - ma) * (gb[i] - mb); }
        va /= ga.length; vb /= ga.length; cov /= ga.length;
        const c1 = 6.5, c2 = 58.5, ssim = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
        const t = +thr.value, changed = diff.filter((v) => v > t).length;
        score.innerHTML = '';
        score.append(kv([['Similarity (structural)', (Math.max(0, ssim) * 100).toFixed(1) + '%'], ['Pixel match', (100 - (sum / diff.length / 255) * 100).toFixed(2) + '%'], ['Changed pixels', ((changed / diff.length) * 100).toFixed(2) + '%']]));
        const m = mode.value;
        if (m === 'side') api.setStage(C.draw(w * 2 + 10, hh, (x) => { x.fillStyle = '#888'; x.fillRect(0, 0, w * 2 + 10, hh); x.drawImage(a, 0, 0); x.drawImage(b, w + 10, 0); }));
        else if (m === 'blink') api.setStage(C.draw(w, hh, (x) => { x.drawImage(a, 0, 0); x.globalAlpha = 0.5; x.drawImage(b, 0, 0); }));
        else if (m === 'heat') {
          const d = new ImageData(w, hh), L = C.gradientLut([[0, '#000000'], [0.3, '#5b0ea6'], [0.6, '#ff3d00'], [1, '#ffff66']]);
          for (let j = 0; j < diff.length; j++) { const k = Math.min(255, Math.round((diff[j] / Math.max(1, t)) * 128)) * 3; d.data.set([L[k], L[k + 1], L[k + 2], 255], j * 4); }
          api.setStage(C.blend(C.perPixel(a, (q, i) => { const l = C.luma(q[i], q[i + 1], q[i + 2]) * 0.35; q[i] = q[i + 1] = q[i + 2] = l; }), C.writeData(d), 'lighter', 1));
        } else {
          const cell = Math.max(8, Math.round(w / 60)), gw = Math.ceil(w / cell), gh = Math.ceil(hh / cell), hit = new Uint8Array(gw * gh);
          for (let j = 0; j < diff.length; j++) if (diff[j] > t) hit[Math.floor(((j / w) | 0) / cell) * gw + Math.floor((j % w) / cell)] = 1;
          api.setStage(C.draw(w, hh, (x) => {
            x.drawImage(a, 0, 0); x.strokeStyle = '#ff1744'; x.lineWidth = Math.max(2, w / 300); x.fillStyle = 'rgba(255,23,68,0.15)';
            const seen = new Uint8Array(gw * gh);
            for (let k = 0; k < hit.length; k++) {
              if (!hit[k] || seen[k]) continue;
              const st = [k]; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
              while (st.length) { const q = st.pop(); if (seen[q] || !hit[q]) continue; seen[q] = 1; const qx = q % gw, qy = (q / gw) | 0; x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const nx = qx + dx, ny = qy + dy; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) st.push(ny * gw + nx); } }
              x.beginPath(); x.roundRect(x0 * cell - 4, y0 * cell - 4, (x1 - x0 + 1) * cell + 8, (y1 - y0 + 1) * cell + 8, 8); x.fill(); x.stroke();
            }
          }));
        }
      };
      [mode, thr].forEach((i) => i.addEventListener('input', run));
      el.append(btn('Choose second image…', async () => { const [f] = await canvasFromFiles(false); if (f) { other = f.canvas; run(); } }, 'primary'),
        h('label.field', {}, h('span', {}, 'View'), mode), h('label.field', {}, h('span', {}, 'Sensitivity threshold'), thr), score);
      return () => api.setStage(null);
    },
  },
  {
    id: 'collage', name: 'Photo Collage', cat, kind: 'panel', tags: 'collage grid layout combine multiple photos',
    desc: 'Arrange several photos into a grid collage with gaps, rounded corners and background color.',
    mount(el, api) {
      const items = [];
      if (api.hasImage()) items.push({ name: 'current', canvas: api.preview() });
      const list = h('div.thumbs');
      const cols = h('input.num', { type: 'number', min: 1, max: 10, value: 3 }), gap = h('input', { type: 'range', min: 0, max: 60, value: 12 }), rad = h('input', { type: 'range', min: 0, max: 60, value: 8 });
      const bg = h('input', { type: 'color', value: '#ffffff' }), W = h('input.num', { type: 'number', min: 200, max: 8000, value: 2400 });
      const aspect = h('select', {}, [['1', 'Square cells'], ['0.75', '4:3 cells'], ['1.333', '3:4 cells'], ['0.5625', '16:9 cells']].map(([v, l]) => h('option', { value: v }, l)));
      const build = (scale = 1) => {
        const n = items.length; if (!n) return null;
        const c = Math.min(+cols.value, n), r = Math.ceil(n / c), g = +gap.value * scale * (+W.value / 2400), Wd = +W.value * scale;
        const cw = (Wd - g * (c + 1)) / c, ch = cw * +aspect.value, Hd = r * ch + g * (r + 1);
        return C.draw(Wd, Hd, (x) => {
          x.fillStyle = bg.value; x.fillRect(0, 0, Wd, Hd);
          items.forEach((it, i) => {
            const X = g + (i % c) * (cw + g), Y = g + Math.floor(i / c) * (ch + g), im = it.canvas, k = Math.max(cw / im.width, ch / im.height);
            x.save(); x.beginPath(); x.roundRect(X, Y, cw, ch, +rad.value * scale); x.clip();
            x.drawImage(im, X + (cw - im.width * k) / 2, Y + (ch - im.height * k) / 2, im.width * k, im.height * k); x.restore();
          });
        });
      };
      const refresh = () => {
        list.innerHTML = '';
        items.forEach((it, i) => list.append(h('div.thumb', {}, h('img', { src: C.resizeCanvas(it.canvas, 80, 80 * it.canvas.height / it.canvas.width).toDataURL() }), h('button.x', { onClick: () => { items.splice(i, 1); refresh(); }, title: 'Remove' }, '×'))));
        const c = build(Math.min(1, 1400 / +W.value));
        api.setStage(c);
      };
      [cols, gap, rad, bg, W, aspect].forEach((i) => i.addEventListener('input', refresh));
      el.append(btn('+ Add photos…', async () => { items.push(...(await canvasFromFiles(true))); refresh(); }, 'primary'), list,
        h('div.grid2', {}, h('label.field', {}, h('span', {}, 'Columns'), cols), h('label.field', {}, h('span', {}, 'Cell shape'), aspect), h('label.field', {}, h('span', {}, 'Gap'), gap), h('label.field', {}, h('span', {}, 'Corner radius'), rad), h('label.field', {}, h('span', {}, 'Background'), bg), h('label.field', {}, h('span', {}, 'Output width (px)'), W)),
        h('div.row', {}, btn('Open collage as image', () => { const c = build(1); if (c) api.openAsNew(c, 'collage'); }, 'primary')));
      refresh();
      return () => api.setStage(null);
    },
  },
  {
    id: 'gif', name: 'GIF Animation Maker', cat, kind: 'panel', tags: 'gif animation animated frames slideshow',
    desc: 'Turn several images into an animated GIF with custom frame delay, size and looping.',
    mount(el, api) {
      const frames = [];
      if (api.hasImage()) frames.push({ name: 'current', canvas: api.preview() });
      const list = h('div.thumbs'), delay = h('input.num', { type: 'number', min: 20, max: 5000, value: 500 }), width = h('input.num', { type: 'number', min: 16, max: 1600, value: 480 });
      const loop = h('input', { type: 'checkbox', checked: true }), bounce = h('input', { type: 'checkbox' }), colors = h('select', {}, [256, 128, 64, 32, 16].map((n) => h('option', { value: n }, n + ' colors')));
      const out = h('div.gif-out');
      const refresh = () => { list.innerHTML = ''; frames.forEach((f, i) => list.append(h('div.thumb', {}, h('img', { src: C.resizeCanvas(f.canvas, 80, 80 * f.canvas.height / f.canvas.width).toDataURL() }), h('span.idx', {}, i + 1), h('button.x', { onClick: () => { frames.splice(i, 1); refresh(); } }, '×')))); };
      el.append(btn('+ Add frames…', async () => { frames.push(...(await canvasFromFiles(true))); refresh(); }, 'primary'), list,
        h('div.grid2', {}, h('label.field', {}, h('span', {}, 'Frame delay (ms)'), delay), h('label.field', {}, h('span', {}, 'Width (px)'), width), h('label.field', {}, h('span', {}, 'Colors'), colors), h('label.check', {}, loop, ' Loop forever'), h('label.check', {}, bounce, ' Ping-pong (bounce)')),
        btn('Create GIF', async () => {
          if (frames.length < 1) return toast('Add at least one frame', 'err');
          out.innerHTML = 'Encoding…';
          const { GIFEncoder, quantize, applyPalette } = await LIBS.gifenc();
          const W = +width.value, H = Math.round((W * frames[0].canvas.height) / frames[0].canvas.width), enc = GIFEncoder();
          const seq = bounce.checked ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
          for (const f of seq) {
            const k = Math.max(W / f.canvas.width, H / f.canvas.height), c = C.draw(W, H, (x) => { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(f.canvas, (W - f.canvas.width * k) / 2, (H - f.canvas.height * k) / 2, f.canvas.width * k, f.canvas.height * k); });
            const d = C.readData(c).data, pal = quantize(d, +colors.value), idx = applyPalette(d, pal);
            enc.writeFrame(idx, W, H, { palette: pal, delay: +delay.value, repeat: loop.checked ? 0 : -1 });
          }
          enc.finish();
          const blob = new Blob([enc.bytes()], { type: 'image/gif' });
          out.innerHTML = '';
          out.append(h('img', { src: URL.createObjectURL(blob), style: { maxWidth: '100%', borderRadius: '8px' } }), h('div.row', {}, h('span.muted', {}, fmtBytes(blob.size)), btn('Download GIF', () => download(blob, 'animation.gif'), 'primary')));
        }, 'primary'), out);
      refresh();
    },
  },
  {
    id: 'ocr', name: 'Recognize Text (OCR)', cat, kind: 'panel', tags: 'ocr text recognition extract scan read',
    desc: 'Extract text from photos, screenshots and scans — runs locally in your browser.',
    mount(el, api) {
      if (needImage(api, el)) return;
      const lang = h('select', {}, [['eng', 'English'], ['deu', 'German'], ['fra', 'French'], ['spa', 'Spanish'], ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'], ['rus', 'Russian'], ['ukr', 'Ukrainian'], ['pol', 'Polish'], ['tur', 'Turkish'], ['chi_sim', 'Chinese (Simplified)'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['ara', 'Arabic'], ['hin', 'Hindi']].map(([v, l]) => h('option', { value: v }, l)));
      const status = h('div.muted'), outText = h('textarea.ocr-out', { rows: 12, placeholder: 'Recognized text appears here…' });
      el.append(h('label.field', {}, h('span', {}, 'Language'), lang), h('p.muted.small', {}, 'Tip: run “Clean Up Scanned Document” first for better accuracy. Language data (~2–10 MB) downloads once.'),
        btn('Recognize text', async () => {
          status.textContent = 'Loading OCR engine…';
          try {
            const T = await LIBS.tesseract();
            const res = await T.recognize(await api.result(), lang.value, { logger: (m) => { status.textContent = `${m.status} ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`; } });
            outText.value = res.data.text;
            status.textContent = `Done · confidence ${Math.round(res.data.confidence)}%`;
          } catch (e) { status.textContent = 'OCR failed: ' + e.message; }
        }, 'primary'), status, outText, btn('Copy text', () => copyText(outText.value)));
    },
  },
];
