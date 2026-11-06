// Builds parameter controls for a tool.
import { h, pickFiles, fileToCanvas } from './dom.js';
import { curveLut } from './tools/adjust.js';

const fmtNum = (v, step) => (step < 1 ? (+v).toFixed(String(step).split('.')[1]?.length || 1) : String(Math.round(v)));

function curveWidget(p, params, emit) {
  const S = 256;
  const cv = h('canvas.curve', { width: S * 2, height: S * 2 });
  const x = cv.getContext('2d');
  let drag = -1;
  const pts = () => params[p.key];
  const draw = () => {
    x.setTransform(2, 0, 0, 2, 0, 0);
    const css = getComputedStyle(cv);
    x.clearRect(0, 0, S, S);
    x.strokeStyle = css.getPropertyValue('--line') || '#444'; x.lineWidth = 1;
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo((i * S) / 4, 0); x.lineTo((i * S) / 4, S); x.moveTo(0, (i * S) / 4); x.lineTo(S, (i * S) / 4); x.stroke(); }
    x.setLineDash([3, 3]); x.beginPath(); x.moveTo(0, S); x.lineTo(S, 0); x.stroke(); x.setLineDash([]);
    const L = curveLut(pts());
    x.strokeStyle = css.getPropertyValue('--accent') || '#7c5cff'; x.lineWidth = 2; x.beginPath();
    for (let i = 0; i < 256; i++) i ? x.lineTo(i, 255 - L[i]) : x.moveTo(i, 255 - L[i]);
    x.stroke();
    x.fillStyle = '#fff';
    pts().forEach(([px, py], i) => { x.beginPath(); x.arc(px, 255 - py, i === drag ? 6 : 4.5, 0, 7); x.fill(); x.stroke(); });
  };
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 255, 255 - ((e.clientY - r.top) / r.height) * 255]; };
  cv.addEventListener('pointerdown', (e) => {
    const [px, py] = pos(e), P = pts();
    drag = P.findIndex(([a, b]) => Math.hypot(a - px, b - py) < 12);
    if (drag < 0) { P.push([px, py]); P.sort((a, b) => a[0] - b[0]); drag = P.findIndex((q) => q[0] === px); }
    cv.setPointerCapture(e.pointerId); draw(); emit(true);
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const P = pts(); let [px, py] = pos(e);
    px = Math.max(0, Math.min(255, px)); py = Math.max(0, Math.min(255, py));
    const lo = drag > 0 ? P[drag - 1][0] + 1 : 0, hi = drag < P.length - 1 ? P[drag + 1][0] - 1 : 255;
    P[drag] = [Math.max(lo, Math.min(hi, px)), py];
    draw(); emit(true);
  });
  cv.addEventListener('pointerup', () => { drag = -1; draw(); });
  cv.addEventListener('dblclick', (e) => {
    const [px, py] = pos(e), P = pts(), i = P.findIndex(([a, b]) => Math.hypot(a - px, b - py) < 12);
    if (i >= 0 && P.length > 2) { P.splice(i, 1); draw(); emit(true); }
  });
  cv._redraw = draw;
  requestAnimationFrame(draw);
  return cv;
}

/**
 * @param tool tool definition
 * @param params live params object (mutated)
 * @param onChange (key) => void
 * @param ctx { pickColor(cb) }
 */
export function buildControls(tool, params, onChange, ctx = {}) {
  const wrap = h('div.controls');
  const rows = [];
  const refreshVis = () => rows.forEach(({ p, el }) => { el.hidden = p.when ? !p.when(params) : false; });
  const emit = (p, fromCurve) => {
    if (p.onChange) { p.onChange(params[p.key], params); syncAll(); }
    if (fromCurve && 'preset' in params) { params.preset = 'custom'; syncAll(); }
    refreshVis();
    onChange(p.key);
  };
  const syncers = [];
  const syncAll = () => syncers.forEach((f) => f());

  for (const p of tool.params || []) {
    let el;
    const label = h('span.label', {}, p.label);
    switch (p.type) {
      case 'range': {
        const r = h('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: params[p.key] });
        const n = h('input.num', { type: 'number', min: p.min, max: p.max, step: p.step, value: fmtNum(params[p.key], p.step) });
        const unit = p.unit ? h('span.unit', {}, p.unit.trim()) : null;
        const set = (v, from) => { params[p.key] = +v; if (from !== r) r.value = v; if (from !== n) n.value = fmtNum(v, p.step); r.style.setProperty('--pct', ((v - p.min) / (p.max - p.min)) * 100 + '%'); };
        r.addEventListener('input', () => { set(r.value, r); emit(p); });
        n.addEventListener('change', () => { const v = Math.min(p.max, Math.max(p.min, +n.value || 0)); set(v, null); emit(p); });
        r.addEventListener('dblclick', () => { set(p.def, null); emit(p); });
        set(params[p.key]);
        syncers.push(() => set(params[p.key]));
        el = h('label.field.range', { title: 'Double-click slider to reset' }, h('div.field-head', {}, label, h('span.valbox', {}, n, unit)), r);
        break;
      }
      case 'number': {
        const n = h('input.num.wide', { type: 'number', min: p.min, max: p.max, value: params[p.key] });
        n.addEventListener('change', () => { params[p.key] = Math.min(p.max, Math.max(p.min, Math.round(+n.value) || p.def)); n.value = params[p.key]; emit(p); });
        syncers.push(() => { n.value = params[p.key]; });
        el = h('label.field', {}, label, n);
        break;
      }
      case 'select': {
        if (p.options.length <= 3 && p.options.every(([, l]) => l.length < 14)) {
          const seg = h('div.seg');
          const btns = p.options.map(([v, l]) => h('button', { type: 'button', class: params[p.key] === v ? 'on' : '', onClick: () => { params[p.key] = v; btns.forEach((b, i) => b.classList.toggle('on', p.options[i][0] === v)); emit(p); } }, l));
          seg.append(...btns);
          syncers.push(() => btns.forEach((b, i) => b.classList.toggle('on', p.options[i][0] === params[p.key])));
          el = h('div.field', {}, label, seg);
        } else {
          const s = h('select', {}, p.options.map(([v, l]) => h('option', { value: v, selected: params[p.key] === v }, l)));
          s.addEventListener('change', () => { params[p.key] = s.value; emit(p); });
          syncers.push(() => { s.value = params[p.key]; });
          el = h('label.field', {}, label, s);
        }
        break;
      }
      case 'color': {
        const c = h('input', { type: 'color', value: params[p.key] });
        const t = h('input.hex', { value: params[p.key], maxlength: 7, spellcheck: false });
        const set = (v) => { params[p.key] = v; c.value = v; t.value = v; };
        c.addEventListener('input', () => { set(c.value); emit(p); });
        t.addEventListener('change', () => { if (/^#?[0-9a-f]{6}$/i.test(t.value)) { set(t.value.startsWith('#') ? t.value : '#' + t.value); emit(p); } else t.value = params[p.key]; });
        const pick = ctx.pickColor ? h('button.icon-btn', { type: 'button', title: 'Pick from image', onClick: () => ctx.pickColor((rgb) => { set('#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')); emit(p); }) }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>' })) : null;
        syncers.push(() => set(params[p.key]));
        el = h('div.field', {}, label, h('div.color-row', {}, c, t, pick));
        break;
      }
      case 'bool': {
        const cb = h('input', { type: 'checkbox', checked: !!params[p.key] });
        cb.addEventListener('change', () => { params[p.key] = cb.checked; emit(p); });
        syncers.push(() => { cb.checked = !!params[p.key]; });
        el = h('label.field.toggle', {}, cb, h('span.switch'), label);
        break;
      }
      case 'text': {
        const t = p.multiline ? h('textarea', { rows: 2 }, params[p.key]) : h('input.text', { value: params[p.key] });
        let timer;
        t.addEventListener('input', () => { params[p.key] = t.value; clearTimeout(timer); timer = setTimeout(() => emit(p), 150); });
        syncers.push(() => { t.value = params[p.key]; });
        el = h('label.field', {}, label, t);
        break;
      }
      case 'seed': {
        const n = h('input.num.wide', { type: 'number', value: params[p.key] });
        n.addEventListener('change', () => { params[p.key] = +n.value || 0; emit(p); });
        const dice = h('button.btn.small', { type: 'button', onClick: () => { params[p.key] = Math.floor(Math.random() * 99999); n.value = params[p.key]; emit(p); } }, '🎲 Randomize');
        syncers.push(() => { n.value = params[p.key]; });
        el = h('div.field', {}, label, h('div.row', {}, n, dice));
        break;
      }
      case 'image': {
        const thumb = h('div.img-thumb', {}, params[p.key] ? h('img', { src: params[p.key].toDataURL('image/jpeg', 0.6) }) : h('span.muted', {}, 'No image'));
        const pickBtn = h('button.btn.small', { type: 'button', onClick: async () => {
          const [f] = await pickFiles();
          if (!f) return;
          params[p.key] = await fileToCanvas(f);
          thumb.innerHTML = ''; thumb.append(h('img', { src: params[p.key].toDataURL('image/jpeg', 0.6) }));
          emit(p);
        } }, 'Choose image…');
        el = h('div.field', {}, label, h('div.row', {}, thumb, pickBtn));
        break;
      }
      case 'curve': {
        const cv = curveWidget(p, params, (fromUser) => emit(p, fromUser));
        syncers.push(() => cv._redraw && cv._redraw());
        el = h('div.field', {}, cv, h('small.muted', {}, 'Click to add a point · drag to move · double-click to remove'));
        break;
      }
      default:
        el = h('div');
    }
    rows.push({ p, el });
    wrap.append(el);
  }
  refreshVis();
  wrap.sync = syncAll;
  return wrap;
}
