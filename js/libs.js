// On-demand loaders for third-party libraries (loaded only when a tool needs them).
const cache = new Map();

export function loadScript(url, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = () => { cache.delete(url); reject(new Error('Could not load ' + url)); };
    document.head.appendChild(s);
  });
  cache.set(url, p);
  return p;
}
export function loadModule(url) {
  if (!cache.has(url)) cache.set(url, import(/* @vite-ignore */ url));
  return cache.get(url);
}

export const LIBS = {
  qrcode: () => loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'qrcode'),
  jsqr: () => loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', 'jsQR'),
  jszip: () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JSZip'),
  tesseract: () => loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', 'Tesseract'),
  exifr: () => loadModule('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs'),
  gifenc: () => loadModule('https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js'),
};
