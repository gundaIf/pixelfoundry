import * as C from './core.js';
import { h, $, $$, toast, download, copyText, pickFiles, fileToCanvas, canvasToBlob } from './dom.js';
import { CATEGORIES, TOOLS, getTool, FEATURED, searchTools } from './registry.js';
import { defaults } from './params.js';
import { buildControls } from './controls.js';
import { ratioOf } from './tools/transform.js';
import { fmtBytes } from './meta.js';
import { LIBS } from './libs.js';

/* ============================== state ============================== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('pf:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pf:' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  original: null, proxy: null, scale: 1, file: null,
  stack: [], cache: [], active: null, current: null, before: null,
  undo: [], redo: [], stageOverride: null, picking: null, panelCleanup: null,
  favorites: new Set(LS.get('favorites', [])), recent: LS.get('recent', []),
  previewMax: LS.get('previewMax', 1600),
  view: { z: 1, tx: 0, ty: 0, fit: true, compare: false, split: 0.5, holding: false },
  fullCache: null, version: 0, renderMs: 0,
};
let uid = 1;
const cloneParams = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? x.slice() : x)) : v]));
const realDims = (c) => [Math.round(c.width / S.scale), Math.round(c.height / S.scale)];
const baseName = () => (S.file?.name || 'image').replace(/\.[^.]+$/, '');

/* ============================== DOM refs ============================== */
const els = {
  app: $('#app'), toolList: $('#tool-list'), search: $('#search'), stage: $('#stage'), viewport: $('#viewport'), wrap: $('#canvas-wrap'),
  view: $('#view'), empty: $('#empty'), overlay: $('#overlay'), split: $('#split'), busy: $('#busy'), status: $('#status'),
  panelTool: $('#panel-tool'), panelSteps: $('#panel-steps'), panelExport: $('#panel-export'), hist: $('#hist'),
};

/* ============================== history ============================== */
function snapshot() {
  return { original: S.original, proxy: S.proxy, scale: S.scale, file: S.file, stack: S.stack.map((s) => ({ ...s, params: cloneParams(s.params) })) };
}
function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 60) S.undo.shift(); S.redo = []; updateHeader(); }
function restore(snap) {
  Object.assign(S, { original: snap.original, proxy: snap.proxy, scale: snap.scale, file: snap.file, stack: snap.stack });
  S.cache = []; S.fullCache = null; S.version++;
  closeTool(false); renderSteps(); requestRender(); updateHeader();
}
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); toast('Undone'); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); toast('Redone'); }

/* ============================== image loading ============================== */
function makeProxy(canvas) {
  const k = S.previewMax >= 99999 ? 1 : Math.min(1, S.previewMax / Math.max(canvas.width, canvas.height));
  return { proxy: k < 1 ? C.resizeCanvas(canvas, canvas.width * k, canvas.height * k) : canvas, scale: k };
}
function setOriginal(canvas, file, { keepStack = false } = {}) {
  if (S.original) pushUndo();
  S.original = canvas; S.file = file;
  const { proxy, scale } = makeProxy(canvas);
  S.proxy = proxy; S.scale = scale;
  if (!keepStack) S.stack = [];
  S.cache = []; S.fullCache = null; S.version++;
  S.view.fit = true;
  els.empty.hidden = true;
  if (!S.active) renderToolPanel();
  renderSteps(); requestRender(); updateHeader();
}
async function openFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(heic|heif|avif|webp|jxl|bmp|ico|tiff?)$/i.test(file.name)) return toast('That doesn’t look like an image', 'err');
  setBusy('Opening ' + file.name + '…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const canvas = await fileToCanvas(file);
    if (canvas.width * canvas.height > 120e6) toast('Very large image — previews use a reduced copy, exports stay full-size.', 'info', 4000);
    setOriginal(canvas, { name: file.name, type: file.type, size: file.size, bytes });
    if (S.active && S.active.tool.kind === 'panel') openTool(S.active.tool.id);
    toast(`Opened ${canvas.width} × ${canvas.height}`, 'ok');
  } catch (e) {
    console.error(e);
    toast('Could not decode this image in your browser (' + (file.type || 'unknown type') + ')', 'err', 4000);
  } finally { setBusy(false); }
}
function openCanvasAsNew(canvas, name = 'image') {
  setOriginal(canvas, { name: name + '.png', type: 'image/png', size: null, bytes: null });
}

/* ============================== render pipeline ============================== */
async function runTool(tool, src, params, s) {
  return await tool.run(src, params, { s });
}
async function stackOutput(n) {
  let cur = S.proxy;
  let i = 0;
  for (; i < n; i++) { if (!S.cache[i]) break; cur = S.cache[i]; }
  for (; i < n; i++) {
    const st = S.stack[i];
    const tool = getTool(st.id);
    if (st.on && tool) {
      try { cur = await runTool(tool, cur, st.params, S.scale); }
      catch (e) { console.error(e); toast(`${tool.name} failed: ${e.message}`, 'err'); }
    }
    S.cache[i] = cur;
  }
  return cur;
}
function invalidate(from = 0) { S.cache.length = Math.min(S.cache.length, from); S.fullCache = null; S.version++; }

let renderToken = 0, renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}
async function render() {
  const token = ++renderToken;
  const A = S.active;
  const t0 = performance.now();
  const busyTimer = setTimeout(() => token === renderToken && setBusy('Rendering…', true), 160);
  try {
    let out, before;
    if (A && A.tool.isGenerator) {
      const [W, H] = A.tool.genDims ? A.tool.genDims(A.params) : [A.params.W, A.params.H];
      const s = Math.min(1, S.previewMax / Math.max(W, H));
      out = await runTool(A.tool, null, A.params, s);
      A.genScale = s;
      before = S.proxy;
    } else if (S.original) {
      const editIdx = A && A.editIndex != null ? A.editIndex : null;
      const base = await stackOutput(editIdx ?? S.stack.length);
      if (token !== renderToken) return;
      before = A && A.tool.kind !== 'panel' ? base : S.proxy;
      out = base;
      if (A && A.tool.kind !== 'panel' && A.tool.overlay !== 'crop') {
        out = await runTool(A.tool, base, A.params, S.scale);
        if (editIdx != null) {
          for (let i = editIdx + 1; i < S.stack.length; i++) {
            const st = S.stack[i], t = getTool(st.id);
            if (st.on && t) out = await runTool(t, out, st.params, S.scale);
          }
        }
      }
    } else { out = null; }
    if (token !== renderToken) return;
    S.current = out; S.before = before;
    S.renderMs = performance.now() - t0;
    drawStage();
    scheduleHistogram();
  } catch (e) {
    console.error(e);
    toast('Render error: ' + e.message, 'err');
  } finally {
    clearTimeout(busyTimer);
    if (token === renderToken) setBusy(false);
  }
}

/** Full-resolution render of original + stack (cached by version). */
async function renderFull(onProgress) {
  if (S.fullCache && S.fullCache.version === S.version) return S.fullCache.canvas;
  let cur = S.original;
  const steps = S.stack.filter((s) => s.on);
  for (let i = 0; i < steps.length; i++) {
    const t = getTool(steps[i].id);
    onProgress && onProgress(i, steps.length, t.name);
    await new Promise((r) => setTimeout(r, 0));
    cur = await runTool(t, cur, steps[i].params, 1);
  }
  S.fullCache = { version: S.version, canvas: cur };
  return cur;
}
async function applySteps(canvas, steps) {
  let cur = canvas;
  for (const st of steps) { const t = getTool(st.id); if (st.on && t) cur = await runTool(t, cur, st.params, 1); }
  return cur;
}

/* ============================== stage ============================== */
function setBusy(msg, soft = false) {
  els.busy.hidden = !msg;
  if (msg) { els.busy.querySelector('span').textContent = msg; els.busy.classList.toggle('soft', soft); }
}
function stageCanvas() { return S.stageOverride || S.current; }
function drawStage() {
  const c = stageCanvas();
  const showEmpty = !c;
  els.empty.hidden = !showEmpty;
  els.wrap.hidden = showEmpty;
  if (showEmpty) { updateStatus(); return; }
  const v = els.view, x = v.getContext('2d');
  if (v.width !== c.width || v.height !== c.height) { v.width = c.width; v.height = c.height; if (S.view.fit) fitView(); }
  x.clearRect(0, 0, v.width, v.height);
  const before = S.before;
  if (!S.stageOverride && before && S.view.holding) {
    x.drawImage(before, 0, 0, v.width, v.height);
  } else {
    x.drawImage(c, 0, 0);
    if (!S.stageOverride && before && S.view.compare) {
      const sx = S.view.split * v.width;
      x.save(); x.beginPath(); x.rect(0, 0, sx, v.height); x.clip(); x.clearRect(0, 0, sx, v.height);
      x.drawImage(before, 0, 0, v.width, v.height); x.restore();
    }
  }
  els.split.hidden = !(S.view.compare && !S.stageOverride && before);
  els.split.style.left = S.view.split * 100 + '%';
  els.wrap.style.width = v.width + 'px'; els.wrap.style.height = v.height + 'px';
  applyTransform();
  renderOverlay();
  updateStatus();
}
function fitView() {
  const c = stageCanvas(); if (!c) return;
  const r = els.viewport.getBoundingClientRect(), pad = 32;
  const z = Math.min((r.width - pad * 2) / c.width, (r.height - pad * 2) / c.height, 1 / S.scale * (S.active?.genScale ? S.scale / S.active.genScale : 1), 8);
  S.view.z = Math.max(0.02, z);
  S.view.tx = (r.width - c.width * S.view.z) / 2;
  S.view.ty = (r.height - c.height * S.view.z) / 2;
  S.view.fit = true;
  applyTransform();
}
function applyTransform() {
  const { z, tx, ty } = S.view;
  els.wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
  els.wrap.style.setProperty('--inv', 1 / z);
  els.view.classList.toggle('pixelated', z * (S.active?.genScale || S.scale) > 2 || z > 3);
  const zl = $('#zoom-label'); if (zl) zl.textContent = Math.round(z * (S.active?.genScale && S.active.tool.isGenerator ? S.active.genScale : S.scale) * 100) + '%';
}
function zoomAt(factor, cx, cy) {
  const r = els.viewport.getBoundingClientRect();
  cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
  const z0 = S.view.z, z1 = Math.min(40, Math.max(0.02, z0 * factor));
  S.view.tx = cx - ((cx - S.view.tx) * z1) / z0;
  S.view.ty = cy - ((cy - S.view.ty) * z1) / z0;
  S.view.z = z1; S.view.fit = false;
  applyTransform();
}
function updateStatus() {
  const c = stageCanvas();
  const parts = [];
  if (c) {
    const gs = S.active?.tool.isGenerator ? S.active.genScale : S.scale;
    parts.push(`${Math.round(c.width / gs)} × ${Math.round(c.height / gs)} px`);
    if (S.original && !S.active?.tool.isGenerator) parts.push(`${(S.original.width * S.original.height / 1e6).toFixed(1)} MP source`);
    if (gs < 1) parts.push(`preview ${Math.round(gs * 100)}%`);
    parts.push(`${Math.round(S.renderMs)} ms`);
  }
  els.status.querySelector('.dims').textContent = parts.join('  ·  ');
}
function canvasPoint(e) {
  const r = els.view.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * els.view.width, ((e.clientY - r.top) / r.height) * els.view.height];
}

// pan / zoom / pick interactions
(function stageInteractions() {
  const vp = els.viewport;
  let pan = null, space = false;
  vp.addEventListener('wheel', (e) => {
    if (!stageCanvas()) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || e.altKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
    else { S.view.tx -= e.shiftKey ? e.deltaY : e.deltaX; S.view.ty -= e.shiftKey ? 0 : e.deltaY; S.view.fit = false; applyTransform(); }
  }, { passive: false });
  vp.addEventListener('pointerdown', (e) => {
    if (!stageCanvas()) return;
    if (S.picking && e.button === 0) {
      const [x, y] = canvasPoint(e).map(Math.floor);
      const c = stageCanvas();
      if (x >= 0 && y >= 0 && x < c.width && y < c.height) {
        const d = C.g2d(c).getImageData(x, y, 1, 1).data;
        const cb = S.picking; stopPicking(); cb([d[0], d[1], d[2]]);
      }
      return;
    }
    if (e.target.closest('.crop-box, #split')) return;
    pan = { x: e.clientX, y: e.clientY, tx: S.view.tx, ty: S.view.ty };
    vp.setPointerCapture(e.pointerId); vp.classList.add('panning');
  });
  vp.addEventListener('pointermove', (e) => {
    if (pan) { S.view.tx = pan.tx + e.clientX - pan.x; S.view.ty = pan.ty + e.clientY - pan.y; S.view.fit = false; applyTransform(); }
    const c = stageCanvas();
    if (!c) return;
    const [x, y] = canvasPoint(e).map(Math.floor), info = els.status.querySelector('.pixel');
    if (x >= 0 && y >= 0 && x < c.width && y < c.height) {
      const d = C.g2d(c).getImageData(x, y, 1, 1).data, hex = C.rgbToHex(d[0], d[1], d[2]);
      const gs = S.active?.tool.isGenerator ? S.active.genScale : S.scale;
      info.innerHTML = '';
      info.append(h('span.swatch', { style: { background: hex } }), ` ${hex}  rgb(${d[0]}, ${d[1]}, ${d[2]})${d[3] < 255 ? ' α' + d[3] : ''}  ·  ${Math.round(x / gs)}, ${Math.round(y / gs)}`);
    } else info.textContent = '';
  });
  const end = () => { pan = null; vp.classList.remove('panning'); };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
  vp.addEventListener('dblclick', (e) => { if (!e.target.closest('.crop-box')) fitView(); });
  // split divider
  let dragSplit = false;
  els.split.addEventListener('pointerdown', (e) => { dragSplit = true; els.split.setPointerCapture(e.pointerId); e.stopPropagation(); });
  els.split.addEventListener('pointermove', (e) => {
    if (!dragSplit) return;
    const r = els.view.getBoundingClientRect();
    S.view.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    drawStage();
  });
  els.split.addEventListener('pointerup', () => (dragSplit = false));
  new ResizeObserver(() => { if (S.view.fit) fitView(); }).observe(vp);
})();

function startPicking(cb) {
  if (!stageCanvas()) return toast('Open an image first', 'err');
  S.picking = cb; els.viewport.classList.add('picking'); toast('Click anywhere on the image to pick a color (Esc to cancel)');
}
function stopPicking() { S.picking = null; els.viewport.classList.remove('picking'); }

/* ---------- crop overlay ---------- */
function renderOverlay() {
  els.overlay.innerHTML = '';
  const A = S.active;
  if (!A || A.tool.overlay !== 'crop' || !S.current) return;
  const p = A.params;
  const box = h('div.crop-box', { style: { left: p.x + '%', top: p.y + '%', width: p.w + '%', height: p.h + '%' } },
    h('div.crop-grid'), ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('div.handle', { class: d, 'data-d': d })),
    h('div.crop-label', {}, `${Math.round((p.w / 100) * S.current.width / S.scale)} × ${Math.round((p.h / 100) * S.current.height / S.scale)}`));
  els.overlay.append(h('div.crop-shade', { style: { clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${p.x}% ${p.y}%,${p.x}% ${p.y + p.h}%,${p.x + p.w}% ${p.y + p.h}%,${p.x + p.w}% ${p.y}%,${p.x}% ${p.y}%)` } }), box);
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    drag = { d: e.target.dataset.d || 'move', x: e.clientX, y: e.clientY, p0: { ...p } };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = els.view.getBoundingClientRect();
    const dx = ((e.clientX - drag.x) / r.width) * 100, dy = ((e.clientY - drag.y) / r.height) * 100, q = drag.p0;
    let { x, y, w, h: hh } = q;
    const d = drag.d;
    if (d === 'move') { x = Math.min(100 - w, Math.max(0, q.x + dx)); y = Math.min(100 - hh, Math.max(0, q.y + dy)); }
    else {
      if (d.includes('w')) { x = Math.min(q.x + q.w - 1, Math.max(0, q.x + dx)); w = q.x + q.w - x; }
      if (d.includes('e')) w = Math.min(100 - q.x, Math.max(1, q.w + dx));
      if (d.includes('n')) { y = Math.min(q.y + q.h - 1, Math.max(0, q.y + dy)); hh = q.y + q.h - y; }
      if (d.includes('s')) hh = Math.min(100 - q.y, Math.max(1, q.h + dy));
      const ratio = ratioOf(p.aspect, S.current.width, S.current.height);
      if (ratio) {
        const k = (ratio * S.current.height) / S.current.width; // w% / h% for the ratio
        if (d === 'n' || d === 's') w = hh * k; else hh = w / k;
        if (x + w > 100) { w = 100 - x; hh = w / k; }
        if (y + hh > 100) { hh = 100 - y; w = hh * k; }
        if (d.includes('n')) y = q.y + q.h - hh;
        if (d.includes('w')) x = q.x + q.w - w;
      }
    }
    Object.assign(p, { x, y, w, h: hh });
    A.controls?.sync();
    box.style.left = x + '%'; box.style.top = y + '%'; box.style.width = w + '%'; box.style.height = hh + '%';
    els.overlay.querySelector('.crop-shade').style.clipPath = `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${x}% ${y}%,${x}% ${y + hh}%,${x + w}% ${y + hh}%,${x + w}% ${y}%,${x}% ${y}%)`;
    box.querySelector('.crop-label').textContent = `${Math.round((w / 100) * S.current.width / S.scale)} × ${Math.round((hh / 100) * S.current.height / S.scale)}`;
  });
  box.addEventListener('pointerup', () => { drag = null; });
}
function fitCropAspect(p) {
  const r = ratioOf(p.aspect, S.current.width, S.current.height);
  if (!r) return;
  const k = (r * S.current.height) / S.current.width;
  let w = 100, hh = 100 / k;
  if (hh > 100) { hh = 100; w = 100 * k; }
  w *= 0.9; hh *= 0.9;
  Object.assign(p, { w, h: hh, x: (100 - w) / 2, y: (100 - hh) / 2 });
}

/* ============================== sidebar ============================== */
function toolIcon(cat) {
  const c = CATEGORIES.find((x) => x.id === cat);
  return h('span.ticon', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${c?.icon || ''}"/></svg>` });
}
function toolItem(t) {
  const fav = S.favorites.has(t.id);
  return h('div.tool-item', { class: S.active?.tool.id === t.id ? 'active' : '', 'data-id': t.id, title: t.desc, onClick: () => openTool(t.id) },
    h('span.tname', {}, t.name),
    h('button.star', { class: fav ? 'on' : '', title: fav ? 'Remove from favorites' : 'Add to favorites', onClick: (e) => { e.stopPropagation(); toggleFav(t.id); } }, fav ? '★' : '☆'));
}
function toggleFav(id) {
  S.favorites.has(id) ? S.favorites.delete(id) : S.favorites.add(id);
  LS.set('favorites', [...S.favorites]); renderToolList();
}
const collapsed = new Set(LS.get('collapsed', []));
function renderToolList() {
  const q = els.search.value;
  const list = els.toolList;
  list.innerHTML = '';
  if (q.trim()) {
    const res = searchTools(q);
    list.append(h('div.cat-head.static', {}, `${res.length} result${res.length === 1 ? '' : 's'}`));
    res.forEach((t) => list.append(toolItem(t)));
    if (!res.length) list.append(h('p.muted.pad', {}, 'Nothing found. Try “blur”, “text”, “gif”…'));
    return;
  }
  if (S.favorites.size) {
    list.append(h('div.cat-head.static', {}, '★ Favorites'));
    [...S.favorites].map(getTool).filter(Boolean).forEach((t) => list.append(toolItem(t)));
  }
  const recent = S.recent.map(getTool).filter((t) => t && !S.favorites.has(t.id)).slice(0, 5);
  if (recent.length) {
    list.append(h('div.cat-head.static', {}, 'Recent'));
    recent.forEach((t) => list.append(toolItem(t)));
  }
  for (const c of CATEGORIES) {
    const tools = TOOLS.filter((t) => t.cat === c.id);
    const isCol = collapsed.has(c.id);
    const head = h('button.cat-head', { class: isCol ? 'collapsed' : '', onClick: () => { isCol ? collapsed.delete(c.id) : collapsed.add(c.id); LS.set('collapsed', [...collapsed]); renderToolList(); } },
      toolIcon(c.id), h('span', {}, c.name), h('span.count', {}, tools.length), h('span.chev', {}, '▾'));
    list.append(head);
    if (!isCol) tools.forEach((t) => list.append(toolItem(t)));
  }
}

/* ============================== tool panel ============================== */
function setTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  ['tool', 'steps', 'export'].forEach((t) => { $('#panel-' + t).hidden = t !== name; });
  if (name === 'export') renderExport();
  document.body.classList.add('right-open');
}
function closeTool(rerender = true) {
  if (S.panelCleanup) { try { S.panelCleanup(); } catch {} S.panelCleanup = null; }
  S.stageOverride = null;
  S.active = null;
  stopPicking();
  renderToolPanel(); renderToolList(); renderSteps();
  if (rerender) requestRender();
}
function openTool(id, { editIndex = null } = {}) {
  const tool = getTool(id);
  if (!tool) return;
  if (S.panelCleanup) { try { S.panelCleanup(); } catch {} S.panelCleanup = null; }
  S.stageOverride = null;
  if (!tool.isGenerator && tool.kind !== 'panel' && !S.original) {
    toast('Open an image first — or create one in “Create New Image”', 'err');
    flashEmpty();
    return;
  }
  const params = editIndex != null ? cloneParams(S.stack[editIndex].params) : defaults(tool);
  if (tool.overlay === 'crop' && editIndex == null) Object.assign(params, { x: 0, y: 0, w: 100, h: 100 });
  S.active = { tool, params, editIndex };
  S.recent = [id, ...S.recent.filter((x) => x !== id)].slice(0, 12); LS.set('recent', S.recent);
  setTab('tool');
  renderToolPanel(); renderToolList(); renderSteps();
  if (tool.isGenerator) S.view.fit = true;
  requestRender();
  document.body.classList.remove('left-open');
}
function panelApi() {
  return {
    hasImage: () => !!S.original,
    file: () => S.file,
    original: () => S.original,
    preview: () => S.cache[S.stack.length - 1] || S.proxy,
    result: () => renderFull(),
    resultSize: () => realDims(S.cache[S.stack.length - 1] || S.proxy),
    setStage: (c) => { S.stageOverride = c; S.view.fit = true; drawStage(); fitView(); },
    openAsNew: (c, name) => { closeTool(false); openCanvasAsNew(c, name); },
    pickColor: startPicking,
    baseName,
  };
}
function renderToolPanel() {
  const P = els.panelTool;
  P.innerHTML = '';
  const A = S.active;
  if (!A) {
    P.append(h('div.panel-empty', {},
      h('h3', {}, S.original ? 'Pick a tool' : 'No image yet'),
      h('p.muted', {}, S.original ? 'Choose any tool on the left, search with ⌘K, or browse the visual Effects Gallery.' : 'Open, drop or paste an image to start — or create a brand-new one.'),
      S.original ? h('button.btn.primary.block', { onClick: openGallery }, '✨ Open Effects Gallery') : null,
      h('div.chips', {}, (S.original ? ['auto-enhance', 'crop', 'resize', 'text', 'frame', 'remove-bg-color'] : ['gen-mesh', 'gen-gradient', 'gen-qr', 'gen-sample']).map((id) => h('button.chip', { onClick: () => openTool(id) }, getTool(id).name)))));
    return;
  }
  const t = A.tool;
  const fav = S.favorites.has(t.id);
  P.append(h('div.tool-head', {},
    h('div', {}, h('div.crumb', {}, CATEGORIES.find((c) => c.id === t.cat)?.name || ''), h('h3', {}, t.name)),
    h('button.star.big', { class: fav ? 'on' : '', onClick: () => { toggleFav(t.id); renderToolPanel(); } }, fav ? '★' : '☆'),
    h('button.icon-btn', { title: 'Close (Esc)', onClick: () => closeTool() }, '✕')));
  P.append(h('p.desc', {}, t.desc));
  if (t.kind === 'panel') {
    const body = h('div.panel-body');
    P.append(body);
    (async () => {
      if (S.original) await stackOutput(S.stack.length);
      if (S.active?.tool !== t) return;
      const cleanup = await t.mount(body, panelApi());
      if (typeof cleanup === 'function') { if (S.active?.tool === t) S.panelCleanup = cleanup; else cleanup(); }
    })().catch((e) => { console.error(e); body.append(h('p.muted', {}, 'Error: ' + e.message)); });
    return;
  }
  const controls = buildControls(t, A.params, (key) => {
    if (t.overlay === 'crop' && key === 'aspect') fitCropAspect(A.params), controls.sync();
    if (t.overlay === 'crop') { renderOverlay(); return; }
    if (t.isGenerator && (key === 'W' || key === 'H')) S.view.fit = true;
    requestRender();
  }, { pickColor: startPicking });
  A.controls = controls;
  P.append(controls);
  const isEdit = A.editIndex != null;
  P.append(h('div.tool-actions', {},
    h('button.btn', { onClick: () => { Object.assign(A.params, defaults(t)); if (t.overlay === 'crop') Object.assign(A.params, { x: 0, y: 0, w: 100, h: 100 }); renderToolPanel(); requestRender(); } }, 'Reset'),
    h('button.btn', { onClick: () => closeTool() }, 'Cancel'),
    h('button.btn.primary', { onClick: applyActive }, t.isGenerator ? 'Create image' : isEdit ? 'Update step' : 'Apply  ↵')));
  if (!t.isGenerator) P.append(h('p.hint.muted', {}, 'Non-destructive: applied tools become editable steps. Hold ', h('kbd', {}, '\\'), ' to see the before.'));
}
async function applyActive() {
  const A = S.active;
  if (!A || A.tool.kind === 'panel') return;
  if (A.tool.isGenerator) {
    setBusy('Creating ' + A.tool.name + '…');
    try {
      const c = await runTool(A.tool, null, A.params, 1);
      closeTool(false);
      openCanvasAsNew(c, A.tool.id.replace('gen-', ''));
      toast('New image created', 'ok');
    } finally { setBusy(false); }
    return;
  }
  pushUndo();
  if (A.editIndex != null) {
    S.stack[A.editIndex].params = cloneParams(A.params);
    invalidate(A.editIndex);
  } else {
    S.stack.push({ uid: uid++, id: A.tool.id, params: cloneParams(A.params), on: true });
  }
  toast(`${A.tool.name} ${A.editIndex != null ? 'updated' : 'applied'}`, 'ok', 1400);
  closeTool();
}
function flashEmpty() { els.empty.classList.remove('flash'); void els.empty.offsetWidth; els.empty.classList.add('flash'); }

/* ============================== steps panel ============================== */
function summarize(st) {
  const t = getTool(st.id);
  if (!t) return '';
  return (t.params || []).filter((p) => p.type === 'range' || p.type === 'select').slice(0, 3).map((p) => {
    const v = st.params[p.key];
    if (p.type === 'select') return (p.options.find((o) => o[0] === v) || [v, v])[1];
    return `${p.label.split('·').pop().trim()} ${Math.round(v * 10) / 10}${p.unit?.trim().startsWith('%') ? '%' : ''}`;
  }).join(' · ');
}
function renderSteps() {
  const P = els.panelSteps;
  P.innerHTML = '';
  const badge = $('#steps-count'); if (badge) { badge.textContent = S.stack.length || ''; badge.hidden = !S.stack.length; }
  if (!S.original) { P.append(h('p.muted.pad', {}, 'Steps you apply appear here. Each one stays editable.')); renderRecipes(P); return; }
  const list = h('ol.steps');
  list.append(h('li.step.base', {}, h('span.dot'), h('div.step-main', {}, h('b', {}, S.file?.name || 'Image'), h('small.muted', {}, `${S.original.width} × ${S.original.height}`))));
  let dragFrom = null;
  S.stack.forEach((st, i) => {
    const t = getTool(st.id);
    const editing = S.active?.editIndex === i;
    const li = h('li.step', { class: (st.on ? '' : 'off ') + (editing ? 'editing' : ''), draggable: true },
      h('span.grip', { title: 'Drag to reorder' }, '⋮⋮'),
      h('div.step-main', { onClick: () => openTool(st.id, { editIndex: i }), title: 'Click to edit' }, h('b', {}, t?.name || st.id), h('small.muted', {}, summarize(st))),
      h('button.icon-btn', { title: st.on ? 'Hide step' : 'Show step', onClick: () => { pushUndo(); st.on = !st.on; invalidate(i); renderSteps(); requestRender(); } }, st.on ? '👁' : '◌'),
      h('button.icon-btn', { title: 'Duplicate', onClick: () => { pushUndo(); S.stack.splice(i + 1, 0, { ...st, uid: uid++, params: cloneParams(st.params) }); invalidate(i + 1); renderSteps(); requestRender(); } }, '⧉'),
      h('button.icon-btn', { title: 'Delete step', onClick: () => { pushUndo(); S.stack.splice(i, 1); invalidate(i); if (S.active?.editIndex != null) closeTool(false); renderSteps(); requestRender(); } }, '🗑'));
    li.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault(); li.classList.remove('over');
      if (dragFrom == null || dragFrom === i) return;
      pushUndo();
      const [m] = S.stack.splice(dragFrom, 1); S.stack.splice(i, 0, m);
      invalidate(Math.min(dragFrom, i)); closeTool(false); renderSteps(); requestRender();
    });
    list.append(li);
  });
  P.append(list);
  if (!S.stack.length) P.append(h('p.muted.pad', {}, 'No steps yet. Apply a tool and it will show up here — click a step any time to tweak it.'));
  else P.append(h('div.row.wrap.pad', {},
    h('button.btn.small', { onClick: () => { pushUndo(); S.stack = []; invalidate(0); closeTool(false); renderSteps(); requestRender(); } }, 'Clear all'),
    h('button.btn.small', { title: 'Bake all steps into the image (faster editing afterwards)', onClick: flatten }, 'Flatten'),
    h('button.btn.small', { onClick: saveRecipe }, '💾 Save as recipe'),
    h('button.btn.small', { onClick: shareRecipe }, '🔗 Copy recipe link')));
  renderRecipes(P);
}
async function flatten() {
  setBusy('Flattening…');
  try { const full = await renderFull(); const steps = S.stack; setOriginal(full, S.file); S.stack = []; renderSteps(); toast(`Flattened ${steps.length} steps`, 'ok'); }
  finally { setBusy(false); }
}
const serializable = (stack) => stack.map((s) => ({ id: s.id, on: s.on, params: Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, v instanceof HTMLCanvasElement ? null : v])) }));
function saveRecipe() {
  const name = prompt('Name this recipe:', `Recipe ${(LS.get('recipes', []).length || 0) + 1}`);
  if (!name) return;
  const recipes = LS.get('recipes', []);
  recipes.unshift({ name, steps: serializable(S.stack), at: Date.now() });
  LS.set('recipes', recipes.slice(0, 50)); renderSteps(); toast('Recipe saved', 'ok');
}
function shareRecipe() {
  const json = JSON.stringify(serializable(S.stack));
  const url = location.origin + location.pathname + '#recipe=' + btoa(unescape(encodeURIComponent(json)));
  copyText(url);
}
function applyRecipe(steps) {
  if (!S.original) return toast('Open an image first', 'err');
  pushUndo();
  const valid = steps.filter((s) => getTool(s.id));
  valid.forEach((s) => S.stack.push({ uid: uid++, id: s.id, on: s.on !== false, params: { ...defaults(getTool(s.id)), ...s.params } }));
  invalidate(S.stack.length - valid.length); renderSteps(); requestRender();
  toast(`Applied ${valid.length} steps`, 'ok');
}
function renderRecipes(P) {
  const recipes = LS.get('recipes', []);
  const builtins = [
    { name: '📸 Quick fix', steps: [{ id: 'auto-levels', params: {} }, { id: 'vibrance', params: { v: 30 } }, { id: 'sharpen', params: { amt: 80 } }] },
    { name: '🎞 Film look', steps: [{ id: 'matte', params: {} }, { id: 'split-tone', params: {} }, { id: 'grain', params: { amt: 18 } }, { id: 'vignette', params: { amt: 35 } }] },
    { name: '🖤 Moody B&W', steps: [{ id: 'grayscale', params: { m: 'film' } }, { id: 'curves', params: { preset: 'strong', pts: [[0, 0], [64, 36], [192, 220], [255, 255]] } }, { id: 'grain', params: { amt: 22 } }, { id: 'vignette', params: { amt: 55 } }] },
    { name: '📱 Instagram square', steps: [{ id: 'pad', params: { aspect: '1:1', fill: 'blur' } }, { id: 'resize', params: { mode: 'w', w: 1080, algo: 'smooth' } }] },
    { name: '🧸 Toy town', steps: [{ id: 'tilt-shift', params: {} }, { id: 'vibrance', params: { v: 40 } }] },
  ];
  P.append(h('h4.pad', {}, 'Recipes'));
  const list = h('div.recipes');
  [...recipes.map((r, i) => ({ ...r, i })), ...builtins].forEach((r) => list.append(h('div.recipe', {},
    h('button.recipe-main', { onClick: () => applyRecipe(r.steps), title: r.steps.map((s) => getTool(s.id)?.name).join(' → ') }, h('b', {}, r.name), h('small.muted', {}, r.steps.map((s) => getTool(s.id)?.name).filter(Boolean).join(' → '))),
    r.i != null ? h('button.icon-btn', { title: 'Delete recipe', onClick: () => { const rs = LS.get('recipes', []); rs.splice(r.i, 1); LS.set('recipes', rs); renderSteps(); } }, '✕') : null)));
  P.append(list);
}

/* ============================== export ============================== */
const FORMATS = [['image/jpeg', 'JPEG', 'jpg'], ['image/png', 'PNG', 'png'], ['image/webp', 'WebP', 'webp'], ['image/avif', 'AVIF', 'avif']];
const supported = FORMATS.filter(([m]) => { try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL(m).startsWith('data:' + m); } catch { return false; } });
const EX = Object.assign({ type: 'image/jpeg', q: 90, target: false, kb: 300, scale: 100, maxSide: 0, bg: '#ffffff', name: '' }, LS.get('export', {}));
async function encode(canvas, opts, onStep) {
  let c = canvas;
  if (opts.scale !== 100) c = C.resizeCanvas(c, (c.width * opts.scale) / 100, (c.height * opts.scale) / 100);
  if (opts.maxSide && Math.max(c.width, c.height) > opts.maxSide) { const k = opts.maxSide / Math.max(c.width, c.height); c = C.resizeCanvas(c, c.width * k, c.height * k); }
  if (opts.type === 'image/jpeg') c = C.draw(c.width, c.height, (x) => { x.fillStyle = opts.bg; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0); });
  const lossy = opts.type !== 'image/png';
  if (!opts.target || !lossy) return { blob: await canvasToBlob(c, opts.type, opts.q / 100), w: c.width, h: c.height, q: lossy ? opts.q : null };
  const goal = opts.kb * 1024;
  let lo = 0.02, hi = 1, best = null;
  for (let k = 0; k < 9; k++) {
    const q = (lo + hi) / 2, b = await canvasToBlob(c, opts.type, q);
    onStep && onStep(k, q, b.size);
    if (b.size <= goal) { best = { blob: b, q }; lo = q; } else hi = q;
  }
  // still too large at lowest quality → downscale progressively
  while (!best) {
    c = C.resizeCanvas(c, c.width * 0.8, c.height * 0.8);
    const b = await canvasToBlob(c, opts.type, 0.5);
    if (b.size <= goal || c.width < 64) best = { blob: b, q: 0.5 };
  }
  return { blob: best.blob, w: c.width, h: c.height, q: Math.round(best.q * 100) };
}
function renderExport() {
  const P = els.panelExport;
  P.innerHTML = '';
  if (!S.original) { P.append(h('p.muted.pad', {}, 'Open or create an image to export it.')); return; }
  if (!supported.find(([m]) => m === EX.type)) EX.type = 'image/png';
  const save = () => LS.set('export', { ...EX, name: '' });
  const real = realDims(S.cache[S.stack.length - 1] || S.proxy);
  const fmtSeg = h('div.seg', {}, supported.map(([m, l]) => h('button', { class: EX.type === m ? 'on' : '', onClick: () => { EX.type = m; save(); renderExport(); } }, l)));
  const q = h('input', { type: 'range', min: 1, max: 100, value: EX.q }), qv = h('span.valbox', {}, EX.q);
  q.addEventListener('input', () => { EX.q = +q.value; qv.textContent = q.value; save(); });
  const tgt = h('input', { type: 'checkbox', checked: EX.target }), kb = h('input.num.wide', { type: 'number', min: 5, max: 50000, value: EX.kb });
  tgt.addEventListener('change', () => { EX.target = tgt.checked; save(); renderExport(); }); kb.addEventListener('change', () => { EX.kb = +kb.value; save(); });
  const sc = h('input', { type: 'range', min: 5, max: 200, value: EX.scale }), scv = h('span.valbox', {}, `${EX.scale}% → ${Math.round(real[0] * EX.scale / 100)} × ${Math.round(real[1] * EX.scale / 100)}`);
  sc.addEventListener('input', () => { EX.scale = +sc.value; scv.textContent = `${EX.scale}% → ${Math.round(real[0] * EX.scale / 100)} × ${Math.round(real[1] * EX.scale / 100)}`; save(); });
  const ms = h('input.num.wide', { type: 'number', min: 0, max: 20000, value: EX.maxSide, placeholder: 'none' });
  ms.addEventListener('change', () => { EX.maxSide = +ms.value || 0; save(); });
  const bg = h('input', { type: 'color', value: EX.bg }); bg.addEventListener('input', () => { EX.bg = bg.value; save(); });
  const ext = (FORMATS.find((f) => f[0] === EX.type) || [])[2];
  const name = h('input.text', { value: EX.name || baseName() + (S.stack.length ? '-edited' : '') });
  name.addEventListener('input', () => { EX.name = name.value; });
  const result = h('div.export-result');
  const doEncode = async () => {
    setBusy('Rendering full resolution…');
    try {
      const full = await renderFull((i, n, t) => setBusy(`Rendering ${i + 1}/${n}: ${t}`));
      setBusy('Encoding…');
      const r = await encode(full, EX, (k, qq, size) => setBusy(`Finding best quality… ${Math.round(qq * 100)} → ${fmtBytes(size)}`));
      result.innerHTML = '';
      const orig = S.file?.size;
      result.append(h('div.kv-inline', {}, h('b', {}, fmtBytes(r.blob.size)), h('span', {}, `${r.w} × ${r.h}`), r.q != null ? h('span', {}, `quality ${r.q}`) : null,
        orig ? h('span', { class: r.blob.size < orig ? 'good' : 'bad' }, `${r.blob.size < orig ? '−' : '+'}${Math.abs(Math.round((1 - r.blob.size / orig) * 100))}% vs original`) : null));
      return r;
    } catch (e) { console.error(e); toast('Export failed: ' + e.message, 'err'); }
    finally { setBusy(false); }
  };
  P.append(...[
    h('div.field', {}, h('span.label', {}, 'Format'), fmtSeg),
    EX.type !== 'image/png' ? h('label.field.range', {}, h('div.field-head', {}, h('span.label', {}, 'Quality'), qv), q) : h('p.muted.small', {}, 'PNG is lossless. Use WebP/JPEG for smaller files.'),
    EX.type !== 'image/png' ? h('label.field.toggle', {}, tgt, h('span.switch'), h('span.label', {}, 'Compress to a target file size')) : null,
    EX.target && EX.type !== 'image/png' ? h('label.field', {}, h('span.label', {}, 'Max file size (KB)'), kb) : null,
    h('label.field.range', {}, h('div.field-head', {}, h('span.label', {}, 'Scale'), scv), sc),
    h('label.field', {}, h('span.label', {}, 'Limit longest side (px, 0 = off)'), ms),
    EX.type === 'image/jpeg' ? h('div.field', {}, h('span.label', {}, 'Background for transparent areas'), h('div.color-row', {}, bg)) : null,
    h('label.field', {}, h('span.label', {}, 'File name'), h('div.row', {}, name, h('span.muted', {}, '.' + ext))),
    h('div.tool-actions', {},
      h('button.btn', { onClick: doEncode }, 'Estimate size'),
      h('button.btn', { title: 'Copy PNG to clipboard', onClick: async () => {
        try { const full = await renderFull(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(full, 'image/png') })]); toast('Image copied to clipboard', 'ok'); }
        catch (e) { toast('Clipboard not available: ' + e.message, 'err'); }
      } }, 'Copy'),
      h('button.btn.primary', { onClick: async () => { const r = await doEncode(); if (r) { download(r.blob, `${name.value || 'image'}.${ext}`); toast('Downloaded ' + fmtBytes(r.blob.size), 'ok'); } } }, 'Download')),
    result,
    h('p.muted.small', {}, '🔒 Everything runs locally in your browser. Exported files contain no EXIF/GPS metadata.'),
    h('hr'),
    h('h4', {}, 'Batch process'),
    h('p.muted.small', {}, S.stack.length ? `Apply these ${S.stack.length} step(s) + export settings to many files at once and get a ZIP.` : 'Apply some steps first, then run them on many files at once.'),
    h('button.btn.block', { disabled: !S.stack.length, onClick: batch }, `Batch apply ${S.stack.length} step(s) to files…`)].filter(Boolean));
}
async function batch() {
  const files = await pickFiles({ multiple: true });
  if (!files.length) return;
  const JSZip = await LIBS.jszip(), zip = new JSZip(), ext = (FORMATS.find((f) => f[0] === EX.type) || [])[2];
  const steps = S.stack.map((s) => ({ ...s }));
  let done = 0;
  for (const f of files) {
    setBusy(`Processing ${++done}/${files.length}: ${f.name}`);
    try {
      const c = await applySteps(await fileToCanvas(f), steps);
      const r = await encode(c, EX);
      zip.file(f.name.replace(/\.[^.]+$/, '') + '.' + ext, r.blob);
    } catch (e) { toast(`Skipped ${f.name}: ${e.message}`, 'err'); }
  }
  setBusy('Zipping…');
  download(await zip.generateAsync({ type: 'blob' }), `batch-${files.length}.zip`);
  setBusy(false); toast(`Processed ${done} files`, 'ok');
}

/* ============================== histogram ============================== */
let histTimer;
function scheduleHistogram() { clearTimeout(histTimer); histTimer = setTimeout(drawHistogram, 120); }
function drawHistogram() {
  const cv = els.hist, x = cv.getContext('2d'), c = stageCanvas();
  x.clearRect(0, 0, cv.width, cv.height);
  if (!c) return;
  const small = C.resizeCanvas(c, Math.min(c.width, 400), Math.min(c.width, 400) * c.height / c.width);
  const hs = C.histogram(C.readData(small));
  const max = Math.max(...[hs.r, hs.g, hs.b].map((a) => Math.max(...Array.from(a).slice(2, 254)))) || 1;
  const W = cv.width, H = cv.height;
  x.globalCompositeOperation = 'lighter';
  [['r', 'rgba(255,70,70,0.75)'], ['g', 'rgba(60,220,90,0.75)'], ['b', 'rgba(70,130,255,0.75)']].forEach(([k, col]) => {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
    for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.min(1, hs[k][i] / max) * H);
    x.lineTo(W, H); x.closePath(); x.fill();
  });
  x.globalCompositeOperation = 'source-over';
}

/* ============================== gallery ============================== */
function openGallery() {
  if (!S.original) return toast('Open an image first', 'err');
  const src = S.cache[S.stack.length - 1] || S.proxy;
  const thumbW = 220, thumb = C.resizeCanvas(src, thumbW, (thumbW * src.height) / src.width), s = (thumbW / src.width) * S.scale;
  const tools = TOOLS.filter((t) => !t.isGenerator && t.kind !== 'panel' && !(t.params || []).some((p) => p.type === 'image') && !['crop', 'trim', 'tile-preview', 'rotate-flip'].includes(t.id));
  let filter = 'all';
  const grid = h('div.gallery-grid');
  let queue = [];
  let pumping = false;
  const pump = async () => {
    if (pumping) return; pumping = true;
    while (queue.length) {
      const card = queue.shift(); if (!card.isConnected) continue;
      const t = getTool(card.dataset.id);
      try { const out = await t.run(thumb, defaults(t), { s }); const c = card.querySelector('canvas'); c.width = out.width; c.height = out.height; c.getContext('2d').drawImage(out, 0, 0); card.classList.add('ready'); } catch (e) { card.classList.add('failed'); }
      await new Promise((r) => setTimeout(r, 0));
    }
    pumping = false;
  };
  const fill = () => {
    grid.innerHTML = ''; queue = [];
    tools.filter((t) => filter === 'all' || t.cat === filter).forEach((t) => {
      const card = h('button.g-card', { 'data-id': t.id, onClick: () => { close(); openTool(t.id); } }, h('div.g-img', {}, h('canvas', { width: thumb.width, height: thumb.height })), h('span', {}, t.name));
      grid.append(card); queue.push(card);
    });
    pump();
  };
  const cats = h('div.seg.wrap', {}, [['all', 'All'], ...CATEGORIES.filter((c) => tools.some((t) => t.cat === c.id)).map((c) => [c.id, c.short])].map(([id, l]) => h('button', { class: id === filter ? 'on' : '', onClick: (e) => { filter = id; $$('button', cats).forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); fill(); } }, l)));
  const modal = h('div.modal-back', { onClick: (e) => { if (e.target === modal) close(); } }, h('div.modal.gallery', {}, h('div.modal-head', {}, h('h3', {}, '✨ Effects Gallery'), h('span.muted', {}, `${tools.length} effects previewed on your image`), h('button.icon-btn', { onClick: () => close() }, '✕')), cats, grid));
  const close = () => { queue = []; modal.remove(); };
  document.body.append(modal);
  fill();
}

/* ============================== command palette ============================== */
function openPalette() {
  if ($('.modal.palette')) return;
  const input = h('input.palette-input', { placeholder: 'Search 120+ tools and actions…', autofocus: true });
  const list = h('div.palette-list');
  const actions = [
    { name: 'Open image…', run: () => pickFiles().then(([f]) => openFile(f)), kb: '⌘O' },
    { name: 'Export / Download', run: () => setTab('export'), kb: '⌘S' },
    { name: 'Effects Gallery', run: openGallery, kb: 'G' },
    { name: 'Undo', run: undo, kb: '⌘Z' }, { name: 'Redo', run: redo, kb: '⇧⌘Z' },
    { name: 'Toggle before/after split', run: toggleCompare, kb: 'C' },
    { name: 'Fit to screen', run: fitView, kb: 'F' },
    { name: 'Toggle light / dark theme', run: toggleTheme },
    { name: 'Keyboard shortcuts', run: showShortcuts, kb: '?' },
  ];
  let sel = 0, items = [];
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    const tools = searchTools(q).slice(0, 40).map((t) => ({ name: t.name, sub: CATEGORIES.find((c) => c.id === t.cat)?.name, run: () => openTool(t.id) }));
    const acts = actions.filter((a) => !q || a.name.toLowerCase().includes(q)).map((a) => ({ ...a, sub: 'Action' }));
    items = q ? [...tools, ...acts] : [...acts.slice(0, 3), ...tools];
    sel = Math.min(sel, items.length - 1);
    list.innerHTML = '';
    items.forEach((it, i) => list.append(h('button.palette-item', { class: i === sel ? 'sel' : '', onClick: () => { close(); it.run(); }, onMouseMove: () => { if (sel !== i) { sel = i; draw(); } } }, h('span', {}, it.name), h('small.muted', {}, it.sub || ''), it.kb ? h('kbd', {}, it.kb) : null)));
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { close(); items[sel].run(); }
    if (e.key === 'Escape') close();
  });
  const modal = h('div.modal-back', { onClick: (e) => { if (e.target === modal) close(); } }, h('div.modal.palette', {}, input, list));
  const close = () => modal.remove();
  document.body.append(modal);
  draw(); input.focus();
}
function showShortcuts() {
  const rows = [['⌘K or /', 'Search tools & actions'], ['⌘O', 'Open image'], ['⌘V', 'Paste image'], ['⌘S', 'Export'], ['Enter', 'Apply current tool'], ['Esc', 'Cancel tool'], ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['\\ (hold)', 'Show before'], ['C', 'Before/after split'], ['G', 'Effects gallery'], ['F / double-click', 'Fit to screen'], ['1', 'Zoom 100%'], ['+ / −', 'Zoom in / out'], ['⌘/Ctrl + scroll, pinch', 'Zoom'], ['Drag', 'Pan']];
  const modal = h('div.modal-back', { onClick: (e) => { if (e.target === modal) modal.remove(); } }, h('div.modal.small', {}, h('div.modal-head', {}, h('h3', {}, 'Keyboard shortcuts'), h('button.icon-btn', { onClick: () => modal.remove() }, '✕')), h('table.kv', {}, rows.map(([k, v]) => h('tr', {}, h('th', {}, h('kbd', {}, k)), h('td', {}, v))))));
  document.body.append(modal);
}

/* ============================== header / misc ============================== */
function toggleCompare() { S.view.compare = !S.view.compare; $('#btn-compare').classList.toggle('on', S.view.compare); drawStage(); }
function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next; LS.set('theme', next);
  requestAnimationFrame(() => S.active?.controls?.sync());
}
function updateHeader() {
  $('#btn-undo').disabled = !S.undo.length;
  $('#btn-redo').disabled = !S.redo.length;
}
function renderFeatured() {
  const g = $('#featured');
  g.innerHTML = '';
  FEATURED.map(getTool).filter(Boolean).forEach((t) => g.append(h('button.feat', { onClick: () => (t.isGenerator || S.original ? openTool(t.id) : pickFiles().then(([f]) => f && openFile(f).then(() => openTool(t.id)))) }, toolIcon(t.cat), h('b', {}, t.name), h('small', {}, t.desc))));
  $('#tool-count').textContent = TOOLS.length;
}

/* ============================== wiring ============================== */
function wire() {
  $('#btn-open').addEventListener('click', () => pickFiles().then(([f]) => openFile(f)));
  $('#empty-open').addEventListener('click', () => pickFiles().then(([f]) => openFile(f)));
  $('#empty-sample').addEventListener('click', async () => { const t = getTool('gen-sample'); openCanvasAsNew(await t.run(null, defaults(t), { s: 1 }), 'sample-landscape'); });
  $('#empty-new').addEventListener('click', () => openTool('gen-mesh'));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-gallery').addEventListener('click', openGallery);
  $('#btn-compare').addEventListener('click', toggleCompare);
  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-export').addEventListener('click', () => setTab('export'));
  $('#btn-search').addEventListener('click', openPalette);
  $('#btn-help').addEventListener('click', showShortcuts);
  $('#zoom-in').addEventListener('click', () => zoomAt(1.25));
  $('#zoom-out').addEventListener('click', () => zoomAt(0.8));
  $('#zoom-fit').addEventListener('click', fitView);
  $('#zoom-100').addEventListener('click', () => zoomAt(1 / S.scale / S.view.z));
  $('#btn-tools').addEventListener('click', () => document.body.classList.toggle('left-open'));
  $('#btn-panel').addEventListener('click', () => document.body.classList.toggle('right-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('left-open', 'right-open'));
  const hold = $('#btn-hold');
  hold.addEventListener('pointerdown', () => { S.view.holding = true; drawStage(); });
  ['pointerup', 'pointerleave'].forEach((ev) => hold.addEventListener(ev, () => { if (S.view.holding) { S.view.holding = false; drawStage(); } }));
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  const pq = $('#preview-quality');
  pq.value = String(S.previewMax);
  pq.addEventListener('change', () => {
    S.previewMax = +pq.value; LS.set('previewMax', S.previewMax);
    if (S.original) { const { proxy, scale } = makeProxy(S.original); S.proxy = proxy; S.scale = scale; invalidate(0); S.view.fit = true; requestRender(); }
  });
  els.search.addEventListener('input', renderToolList);
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const r = searchTools(els.search.value)[0]; if (r) { openTool(r.id); els.search.blur(); } }
    if (e.key === 'Escape') { els.search.value = ''; renderToolList(); els.search.blur(); }
  });
  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dropping'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/') || /\.(heic|avif|webp)$/i.test(x.name));
    if (f) openFile(f);
  });
  window.addEventListener('paste', (e) => {
    if (e.target.closest('input, textarea')) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { const f = item.getAsFile(); openFile(new File([f], 'pasted-image.png', { type: f.type })); }
  });
  window.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, select');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFiles().then(([f]) => openFile(f)); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); setTab('export'); return; }
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { if ($('.modal-back')) { $$('.modal-back').forEach((m) => m.remove()); return; } if (S.picking) { stopPicking(); return; } if (S.active) closeTool(); return; }
    if (typing || $('.modal-back')) return;
    if (e.key === 'Enter' && S.active) { e.preventDefault(); applyActive(); }
    if (e.key === '/') { e.preventDefault(); openPalette(); }
    if (e.key === '\\' && !S.view.holding) { S.view.holding = true; drawStage(); }
    if (e.key === 'c') toggleCompare();
    if (e.key === 'g') openGallery();
    if (e.key === 'f') fitView();
    if (e.key === '1') zoomAt(1 / S.scale / S.view.z);
    if (e.key === '+' || e.key === '=') zoomAt(1.25);
    if (e.key === '-') zoomAt(0.8);
    if (e.key === '?') showShortcuts();
  });
  window.addEventListener('keyup', (e) => { if (e.key === '\\') { S.view.holding = false; drawStage(); } });
}

function boot() {
  const theme = LS.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  wire(); renderToolList(); renderToolPanel(); renderSteps(); renderFeatured(); updateHeader(); drawStage();
  const m = location.hash.match(/recipe=([^&]+)/);
  if (m) {
    try {
      const steps = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      const recipes = LS.get('recipes', []);
      recipes.unshift({ name: 'Shared recipe', steps, at: Date.now() }); LS.set('recipes', recipes);
      history.replaceState(null, '', location.pathname);
      renderSteps(); toast('Shared recipe added — open an image and apply it from Steps', 'ok', 4500);
    } catch { toast('Invalid recipe link', 'err'); }
  }
  window.PF = { S, openTool, openFile, openCanvasAsNew, TOOLS, render, renderFull }; // debugging hook
}
boot();
