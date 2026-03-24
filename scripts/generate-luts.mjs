#!/usr/bin/env node
/**
 * Analytical Fujifilm film simulation LUT generator.
 *
 * Produces 17×17×17 Autodesk .3dl files (12-bit output, 0–4095) that
 * faithfully model each Fujifilm simulation's known characteristics:
 *   – tone curve (shadow/highlight contrast, shadow lift)
 *   – colour cast (warm/cool shift per channel)
 *   – saturation
 *   – hue-specific treatments (Classic Chrome cyan cast, Velvia blue boost, etc.)
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '../public/luts')

const SIZE    = 17           // 17×17×17
const MAX_OUT = 4095         // 12-bit output
// Input shaper grid (matches Autodesk / Lustre standard)
const GRID    = [0,64,128,192,256,320,384,448,512,575,639,703,767,831,895,959,1023]
const NORM    = GRID.map(v => v / 1023)  // → [0 … 1]

// ─── helpers ──────────────────────────────────────────────────────────────────

const clamp = v => Math.max(0, Math.min(1, v))

/**
 * Power-function S-curve.
 * Passes through (0, shadowLift), (0.5, ~0.5) and (1, 1).
 * shadowK > 1  → more shadow contrast / darker shadows
 * highlightK > 1 → more highlight contrast / brighter highlights
 * (values < 1 soften the respective region)
 */
function sCurve(x, shadowLift, shadowK, highlightK) {
  let v
  if (x < 0.5) {
    v = 0.5 * Math.pow(2 * x, shadowK)
  } else {
    v = 1.0 - 0.5 * Math.pow(2 * (1 - x), highlightK)
  }
  return clamp(v * (1 - shadowLift) + shadowLift)
}

/** Saturation adjustment around the BT.601 luma axis. */
function adjustSat(r, g, b, sat) {
  const l = 0.299 * r + 0.587 * g + 0.114 * b
  return [clamp(l + (r - l) * sat), clamp(l + (g - l) * sat), clamp(l + (b - l) * sat)]
}

/** Grayscale luma using custom per-channel weights (used for mono variants). */
function weightedGray(r, g, b, wr, wg, wb) {
  const sum = wr + wg + wb
  return (wr * r + wg * g + wb * b) / sum
}

// ─── film simulation transforms ───────────────────────────────────────────────

/**
 * PROVIA / Standard
 * Reference look: neutral, accurate, slightly warm, +12% saturation.
 * The "baseline" Fujifilm simulation — natural colours with gentle punch.
 */
function provia(r, g, b) {
  let R = sCurve(r, 0,    1.10, 1.08)
  let G = sCurve(g, 0,    1.08, 1.06)
  let B = sCurve(b, 0,    1.06, 1.05)
  // Slight warm cast — lift reds, pull blues back a touch
  R = clamp(R + 0.012)
  B = clamp(B - 0.008)
  return adjustSat(R, G, B, 1.12)
}

/**
 * VELVIA / Vivid
 * Reference look: very high saturation, strong contrast, deep shadows,
 * boosted blues and greens, warm reds. Classic landscape / nature film.
 */
function velvia(r, g, b) {
  // Steep shadows, moderate highlight shoulder
  let R = sCurve(r, 0, 1.35, 1.18)
  let G = sCurve(g, 0, 1.30, 1.15)
  let B = sCurve(b, 0, 1.25, 1.12)

  // Midtone blue + green boost (sin bell gives zero effect at black/white)
  const luma  = 0.299 * R + 0.587 * G + 0.114 * B
  const bell  = Math.sin(Math.PI * clamp(luma))       // peaks at luma = 0.5
  B = clamp(B + 0.07 * bell)
  G = clamp(G + 0.035 * bell)
  // Warm reds: subtle shift in lower midtones
  R = clamp(R + 0.025 * bell * R)

  return adjustSat(R, G, B, 1.90)
}

/**
 * CLASSIC CHROME
 * Reference look: muted / desaturated, distinctive cyan–teal midtones,
 * warm cream highlights, lifted shadows, documentary-film aesthetic.
 * Emulates faded Kodachrome / Agfa slide film.
 */
function classicChrome(r, g, b) {
  // Gentle S-curve with lifted shadows (+4 % floor)
  let R = sCurve(r, 0.04, 1.04, 0.98)
  let G = sCurve(g, 0.04, 1.02, 0.97)
  let B = sCurve(b, 0.04, 1.04, 0.98)

  const luma = 0.299 * R + 0.587 * G + 0.114 * B

  // Cyan cast in shadows / midtones (signature look)
  // Weight is high in the 0.1–0.55 luma range, fades toward highlights
  const shadowMid = clamp(1 - Math.abs(luma - 0.28) / 0.28)
  B = clamp(B + 0.055 * shadowMid)
  G = clamp(G + 0.020 * shadowMid)
  R = clamp(R - 0.025 * shadowMid)

  // Warm cream in highlights (luma > 0.70)
  const hiWeight = clamp((luma - 0.70) / 0.30)
  R = clamp(R + 0.030 * hiWeight)
  G = clamp(G + 0.015 * hiWeight)
  B = clamp(B - 0.020 * hiWeight)

  // Strong desaturation — the hallmark of this sim
  return adjustSat(R, G, B, 0.72)
}

/**
 * ASTIA / Soft
 * Reference look: low contrast, slightly warm, flattering skin tones,
 * lifted shadows. Portrait-friendly.
 */
function astia(r, g, b) {
  let R = sCurve(r, 0.03, 0.88, 0.86)
  let G = sCurve(g, 0.03, 0.86, 0.84)
  let B = sCurve(b, 0.03, 0.87, 0.85)
  // Gentle warmth
  R = clamp(R + 0.018)
  B = clamp(B - 0.012)
  return adjustSat(R, G, B, 0.93)
}

/**
 * PRO NEG Hi
 * Reference look: portrait-optimised with a natural warm cast and a smooth
 * highlight shoulder. Slightly more contrast than Pro Neg Std.
 */
function proNegHi(r, g, b) {
  let R = sCurve(r, 0.01, 1.08, 1.05)
  let G = sCurve(g, 0.01, 1.05, 1.03)
  let B = sCurve(b, 0.01, 1.04, 1.03)
  // Warm cast
  R = clamp(R + 0.022)
  G = clamp(G + 0.005)
  B = clamp(B - 0.015)
  return adjustSat(R, G, B, 1.06)
}

/**
 * PRO NEG Std
 * Reference look: very flat curve, neutral–warm tones, low saturation.
 * Studio / controlled-lighting workhorse.
 */
function proNegStd(r, g, b) {
  let R = sCurve(r, 0.015, 0.86, 0.84)
  let G = sCurve(g, 0.015, 0.84, 0.82)
  let B = sCurve(b, 0.015, 0.84, 0.82)
  R = clamp(R + 0.010)
  B = clamp(B - 0.006)
  return adjustSat(R, G, B, 0.87)
}

/**
 * SEPIA
 * Warm monochrome tone — classic darkroom sepia toning effect.
 */
function sepia(r, g, b) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  const v = sCurve(gray, 0.02, 1.06, 1.02)
  return [
    clamp(v * 1.10 + 0.018),   // warm amber reds
    clamp(v * 0.94 + 0.008),   // slight golden green
    clamp(v * 0.68 - 0.010),   // reduced blue (creates the warm brown)
  ]
}

/**
 * ACROS
 * Fujifilm's premium B&W simulation. Richer tonal gradation than Mono,
 * with slightly more shadow contrast and a subtle lift giving smooth grain.
 * BT.601 luma weighting with marginally deeper shadow curve.
 */
function acros(r, g, b) {
  const v = sCurve(weightedGray(r, g, b, 0.299, 0.587, 0.114), 0.005, 1.15, 1.08)
  return [v, v, v]
}

/**
 * MONO
 * Standard B&W with a film-like S-curve — deeper blacks, brighter whites.
 * BT.601 luma weighting.
 */
function mono(r, g, b) {
  const v = sCurve(weightedGray(r, g, b, 0.299, 0.587, 0.114), 0, 1.12, 1.06)
  return [v, v, v]
}

/**
 * MONO + Green filter
 * Brightens foliage and neutral greens; slight sky darkening.
 * Approx. equivalent to Wratten #11 (yellow-green).
 */
function monoG(r, g, b) {
  const v = sCurve(weightedGray(r, g, b, 0.21, 0.71, 0.08), 0, 1.13, 1.06)
  return [v, v, v]
}

/**
 * MONO + Red filter
 * Dramatic: very dark blue skies, lighter warm/red tones, high drama.
 * Approx. equivalent to Wratten #25.
 */
function monoR(r, g, b) {
  const v = sCurve(weightedGray(r, g, b, 0.50, 0.42, 0.08), 0, 1.16, 1.08)
  return [v, v, v]
}

/**
 * MONO + Yellow filter
 * Moderate: slightly darker skies, natural foliage, gentle drama.
 * Approx. equivalent to Wratten #8.
 */
function monoYe(r, g, b) {
  const v = sCurve(weightedGray(r, g, b, 0.33, 0.60, 0.07), 0, 1.12, 1.05)
  return [v, v, v]
}

// ─── writer ───────────────────────────────────────────────────────────────────

function generate3DL(label, transform) {
  const lines = [`#Fujifilm ${label} — analytically generated`, GRID.join(' ')]

  // Standard Autodesk .3dl ordering: B varies fastest (inner), G middle, R outer
  for (let ri = 0; ri < SIZE; ri++) {
    for (let gi = 0; gi < SIZE; gi++) {
      for (let bi = 0; bi < SIZE; bi++) {
        const [ro, go, bo] = transform(NORM[ri], NORM[gi], NORM[bi])
        lines.push(
          `${Math.round(clamp(ro) * MAX_OUT)} ` +
          `${Math.round(clamp(go) * MAX_OUT)} ` +
          `${Math.round(clamp(bo) * MAX_OUT)}`
        )
      }
    }
  }

  return lines.join('\n') + '\n'
}

// ─── generate all LUTs ────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })

const SIMS = {
  'Fuji XTrans III - Acros':        acros,
  'Fuji XTrans III - Provia':       provia,
  'Fuji XTrans III - Velvia':       velvia,
  'Fuji XTrans III - Classic Chrome': classicChrome,
  'Fuji XTrans III - Astia':        astia,
  'Fuji XTrans III - Pro Neg Hi':   proNegHi,
  'Fuji XTrans III - Pro Neg Std':  proNegStd,
  'Fuji XTrans III - Sepia':        sepia,
  'Fuji XTrans III - Mono':         mono,
  'Fuji XTrans III - Mono+G':       monoG,
  'Fuji XTrans III - Mono+R':       monoR,
  'Fuji XTrans III - Mono+Ye':      monoYe,
}

for (const [name, fn] of Object.entries(SIMS)) {
  const path = join(OUT_DIR, name + '.3dl')
  writeFileSync(path, generate3DL(name, fn))
  console.log(`✓ ${name}.3dl`)
}

console.log(`\nGenerated ${Object.keys(SIMS).length} LUTs → ${OUT_DIR}`)
