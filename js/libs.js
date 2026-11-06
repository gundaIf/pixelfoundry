// On-demand loaders for third-party libraries. All are served from this site (vendor/),
// except Tesseract's worker/WASM/language data, which the OCR tool fetches from jsDelivr.
const cache = new Map();
const base = new URL('../vendor/', import.meta.url).href;

export function loadScript(url, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = () => { cache.delete(url); reject(new Error('Could not load ' + url.split('/').pop())); };
    document.head.appendChild(s);
  });
  cache.set(url, p);
  return p;
}
export function loadModule(url) {
  if (!cache.has(url)) cache.set(url, import(url).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

export const LIBS = {
  qrcode: () => loadScript(base + 'qrcode.js', 'qrcode'),
  jsqr: () => loadScript(base + 'jsQR.js', 'jsQR'),
  jszip: () => loadScript(base + 'jszip.min.js', 'JSZip'),
  tesseract: () => loadScript(base + 'tesseract.min.js', 'Tesseract'),
  exifr: () => loadModule(base + 'exifr.esm.js'),
  gifenc: () => loadModule(base + 'gifenc.esm.js'),
};
