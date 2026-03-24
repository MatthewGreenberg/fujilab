# Fujilab

A browser-based photo editor that applies Fujifilm film simulations to your images using WebGL.

[**Try it live →**](https://fujilab.vercel.app)

## Features

- **Film simulations** — 12 authentic Fujifilm looks (Provia, Velvia, Classic Chrome, Acros, and more) applied via 3D LUTs
- **Fuji-specific controls** — Highlight Rolloff, Color Chrome, Color Chrome FX Blue, Fade
- **Full adjustment panel** — Exposure, contrast, highlights/shadows, whites/blacks, tone curves, color, grain, vignette
- **RAW support** — Drag in a Fujifilm `.RAF` file; embedded JPEG preview appears instantly while the full RAW decodes via WebAssembly (libraw-mini)
- **Recipes** — Built-in community recipes, or paste any recipe from Fuji X Weekly
- **Shareable links** — Copy a URL that encodes your current settings
- **Before/After split view** — Drag a divider to compare original and edited
- **Export** — Download as JPEG or PNG, optionally at full native resolution
- **Mobile-friendly** — Drag-up bottom sheet on small screens

## Stack

- React 19 + Vite
- WebGL 2 (custom GLSL renderer)
- [libraw-mini](https://github.com/nicktindall/libraw-mini) — LibRaw compiled to WASM for RAW decoding

## Getting started

```bash
npm install
npm run dev
```

## LUTs

The bundled `.3dl` LUT files in `public/luts/` are derived from the open-source [Fuji XTrans III LUT pack](https://blog.sowerby.me/fuji-film-simulation-profiles/). You can also drag your own `.3dl` or `.cube` LUT files onto the app to load them.
