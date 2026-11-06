// Tiny DOM helpers.
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  if (name === 'button' && attrs && attrs.title && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', attrs.title);
  if (name === 'button' && !el.hasAttribute('type')) el.type = 'button';
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, type = 'info', ms = 2600, action = null) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(wrap); }
  const t = h('div.toast', { class: type }, h('span', {}, msg));
  const close = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  if (action) { t.classList.add('has-action'); t.append(h('button.toast-action', { onClick: () => { close(); action.run(); } }, action.label)); ms = Math.max(ms, 7000); }
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(close, ms);
}
/**
 * In-app dialog (replaces confirm/prompt). Resolves with the chosen button value, or null on dismiss.
 * buttons: [{ label, value, primary }]; input: optional { value, placeholder } → resolves { value, text }
 */
export function ask({ title, body = '', buttons = [{ label: 'OK', value: true, primary: true }], input = null }) {
  return new Promise((resolve) => {
    const field = input ? h('input.text', { value: input.value || '', placeholder: input.placeholder || '', 'aria-label': title }) : null;
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v === null ? null : input ? { value: v, text: field.value.trim() } : v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && (input || document.activeElement === document.body)) { e.preventDefault(); e.stopPropagation(); const p = buttons.find((b) => b.primary) || buttons[0]; done(p.value); }
    };
    const back = h('div.modal-back', { onClick: (e) => { if (e.target === back) done(null); } },
      h('div.modal.small', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div.modal-head', {}, h('h3', {}, title)),
        body ? h('p.muted', { style: { marginTop: 0 } }, body) : null,
        field,
        h('div.row.dialog-actions', {}, buttons.map((b) => h('button.btn', { class: b.primary ? 'primary' : '', onClick: () => done(b.value) }, b.label)))));
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    (field || back.querySelector('.btn.primary') || back.querySelector('.btn')).focus();
    if (field) field.select();
  });
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function copyText(t) {
  return navigator.clipboard.writeText(t).then(() => toast('Copied to clipboard', 'ok'), () => toast('Copy failed', 'err'));
}
export function pickFiles({ multiple = false, accept = 'image/*,.svg,.heic,.heif,.avif,.webp,.bmp,.ico,.tif,.tiff' } = {}) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      i.remove();
      resolve(files);
    };
    // 'cancel' fires in modern browsers; the focus fallback covers older ones.
    const onFocus = () => setTimeout(() => { if (!i.files || !i.files.length) finish([]); }, 800);
    i.addEventListener('change', () => finish([...i.files]));
    i.addEventListener('cancel', () => finish([]));
    window.addEventListener('focus', onFocus);
    document.body.appendChild(i);
    i.click();
  });
}
export async function fileToCanvas(file) {
  // Files dropped from some sources have no MIME type; SVG only decodes with the right one.
  if (/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') file = new File([file], file.name, { type: 'image/svg+xml' });
  const isSvg = file.type === 'image/svg+xml';
  let src;
  if (!isSvg) src = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!src) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img;
    } finally { URL.revokeObjectURL(url); }
  }
  let w = src.naturalWidth ?? src.width, h = src.naturalHeight ?? src.height;
  if (isSvg && (!w || !h)) { w = 1024; h = 1024; } // SVG without intrinsic size
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  return c;
}
export const canvasToBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));
/** Split an animated image into frames with WebCodecs' ImageDecoder. Returns [{ canvas, delay }] or null if unsupported. */
export async function gifFrames(file, max = 300) {
  if (!('ImageDecoder' in window)) return null;
  try {
    const dec = new window.ImageDecoder({ data: await file.arrayBuffer(), type: file.type || 'image/gif' });
    await dec.tracks.ready;
    const n = Math.min(max, dec.tracks.selectedTrack.frameCount);
    const out = [];
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const c = document.createElement('canvas');
      c.width = image.displayWidth; c.height = image.displayHeight;
      c.getContext('2d').drawImage(image, 0, 0);
      out.push({ canvas: c, delay: Math.max(20, Math.round((image.duration || 100000) / 1000)), name: `frame ${i + 1}` });
      image.close();
    }
    dec.close();
    return out;
  } catch (e) {
    console.warn(e);
    return null;
  }
}
