# PixelFoundry

**Live:** https://gundaif.github.io/pixelfoundry/

A browser-only rebuild of [imgonline.com.ua](https://www.imgonline.com.ua/eng/) with more tools, live previews, and editable steps.

## Run

```bash
cd pixelfoundry && python3 -m http.server 5173
```

Then open http://localhost:5173. The app uses plain ES modules, so there's no build step and nothing to install. It does need to be served over HTTP; opening `index.html` directly from disk won't work.

## How it differs from imgonline

| imgonline | PixelFoundry |
|---|---|
| Uploads each image to a server, which processes it and keeps it for 2 hours | Images are processed in the browser and never uploaded |
| One tool per page: upload, fill a form, press OK, then download | Live preview as you drag sliders |
| You can't chain edits without downloading and re-uploading | Applied tools stack up as editable steps you can hide, reorder, duplicate or re-edit |
| No before/after view | Split view (C), hold `\` to see the original, and a histogram |
| Hard size limits of 12–100 MP | Previews use a smaller copy, while exports stay at full resolution |
| Mostly JPEG output | JPEG, PNG, WebP and AVIF, with compression to a target file size |
| — | Effects Gallery shows every effect as a thumbnail of your own image |
| — | Batch-apply your steps to many files and download a ZIP |
| — | Recipes (presets) you can save, plus shareable recipe links |
| — | ⌘K command palette, favourites, recent tools, keyboard shortcuts, light and dark themes |
| — | Eyedropper on every color control, interactive crop box with aspect lock, curves editor |

## Tool catalogue (147)

- **Layout:** resize (px, %, longest side, MP), crop, rotate/straighten, 90° turns and flips, crop to shape (♥ ★ ▲ …), borders and frames (polaroid, mat, film), fit to aspect with blurred fill, text and watermark, meme caption, demotivator, auto-trim, remove background color, seamless texture, tiling check, snow, overlay/blend image, combine two images, anaglyph 3D in both directions
- **Adjust:** brightness/contrast, exposure/gamma, levels, curves, auto levels, auto contrast, auto color, auto gamma, auto enhance, HSL, vibrance, temperature, color balance, channel mixer, shadows/highlights, lighten dark photo, unsharp mask, clarity, HDR look, median denoise, surface blur, scanned-document cleanup, upscaling
- **Color:** B&W (7 methods), sepia, invert, duotone, gradient map, split toning, color filter, one-tone, color splash, replace color, posterize, limit colors (median cut plus retro palettes), dithering (FS, Atkinson, Jarvis, Sierra, Bayer), threshold (adaptive), channels, thermal, matte, vintage, cross-process, solarize, Warhol, Bayer mosaic, night vision, infrared
- **Blur and light:** Gaussian, motion, zoom, spin, tilt-shift, lens blur, bokeh circles, vignette, blurred frame, Orton glow, bloom, god rays, grain, chromatic aberration, double vision, light leak, pixelate
- **Artistic:** pencil, colored pencil, charcoal, chalk, cartoon, oil paint (Kuwahara), watercolor, emboss, edges, engraving, halftone (CMYK), dot pattern, stencil, mosaic, crystallize, cracked paint, pointillism, brush strokes, glitch, pixel sort, ASCII, 8-bit pixel art, brick mosaic, CRT, canvas texture, fairytale, chessboard, tile overlay
- **Distort:** swirl, pinch/bulge, fisheye, waves, ripple, raindrops, turbulence, polar / tiny planet, kaleidoscope, mirror, shear, perspective
- **Create:** gradient, mesh gradient, two-tone blur, abstract rainbow, random pixels, clouds/marble/wood noise, patterns, plasma, Voronoi, solid canvas, placeholder, QR code (Wi-Fi/email/phone, rounded dots), sample landscape
- **Utilities:** image info, EXIF/IPTC/XMP viewer with GPS map link and lossless metadata stripping, JPEG/PNG inspector (quality estimate, progressive check, subsampling, segments), dominant palette, color picker/converter/mixer/harmonies, QR and barcode scanner, cut into tiles (ZIP), compare/find differences (SSIM), collage, GIF maker, OCR (16 languages)

## Layout

```
js/core.js        pixel primitives: blur, convolution, median, remap, color math, noise, quantization
js/tools/*.js     tool definitions: { id, name, cat, params, run(src, params, { s }) }
js/meta.js        byte-level JPEG/PNG parsing and lossless metadata stripping
js/app.js         state, render pipeline with per-step cache, stage, steps, export, gallery, palette
js/controls.js    controls generated from param descriptors (range, select, color, curve, image, …)
```

Each tool's `run(src, params, { s })` receives `s`, the ratio of preview size to real size. Tools multiply any pixel-based radius by `s`, so the preview matches the full-resolution export.

## Privacy and security

- Images are decoded, edited and encoded in the browser tab. Nothing is uploaded.
- Third-party libraries (qrcode-generator, jsQR, JSZip, exifr, gifenc, tesseract.js) are served from this site's [vendor/](vendor/) folder and load only when a tool needs them. No web fonts or analytics are loaded.
- The one outside request is OCR: on first use it downloads Tesseract's worker, WASM engine and language data (about 2–10 MB) from cdn.jsdelivr.net. The OCR panel says so before you run it.
- A Content-Security-Policy restricts scripts to this site plus jsDelivr (for OCR only), and blocks plugins, forms and base-URL changes.
- Shared recipe links are validated: unknown tools and malformed values are dropped, and numbers are clamped to each control's range.
- Add `?debug=1` to the URL to expose `window.PF` for debugging.
