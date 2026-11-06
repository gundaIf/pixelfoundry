# Vendored libraries

Served from this site so images and tools work without third-party requests.

| File | Library | Version | License |
|---|---|---|---|
| qrcode.js | qrcode-generator | 1.4.4 | MIT |
| jsQR.js | jsQR | 1.4.0 | Apache-2.0 |
| jszip.min.js | JSZip | 3.10.1 | MIT or GPLv3 |
| exifr.esm.js | exifr (full ESM build) | 7.1.3 | MIT |
| gifenc.esm.js | gifenc | 1.0.3 | MIT |
| tesseract.min.js | tesseract.js | 5.1.1 | Apache-2.0 |

Tesseract's worker, WASM core and language data are not vendored (10+ MB). The OCR tool downloads them from cdn.jsdelivr.net the first time you run it, and the tool says so before it starts.
