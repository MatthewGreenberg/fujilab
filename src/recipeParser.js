/**
 * Parse Fuji X Weekly (and similar) recipe text into app adjustment parameters.
 *
 * Handles the standard format:
 *   Film Simulation: Classic Negative
 *   Grain Effect: Weak, Small
 *   Color Chrome Effect: Strong
 *   Color Chrome FX Blue: Weak
 *   White Balance: Auto, +4 Red & -2 Blue
 *   Dynamic Range: DR400
 *   Highlight: -2
 *   Shadow: -1
 *   Color: +1
 *   Sharpness: -4
 *   Noise Reduction: -4
 *   Clarity: 0
 */

// Film simulation name → LUT name in our bundled set
const SIM_MAP = {
  "provia": "Provia",
  "standard": "Provia",
  "velvia": "Velvia",
  "vivid": "Velvia",
  "astia": "Astia",
  "soft": "Astia",
  "classic chrome": "Classic Chrome",
  "pro neg hi": "Pro Neg Hi",
  "pro neg. hi": "Pro Neg Hi",
  "pro neg std": "Pro Neg Std",
  "pro neg. std": "Pro Neg Std",
  "acros": "Acros",
  "acros+g": "Acros",  // approximate with base Acros
  "acros+r": "Acros",
  "acros+ye": "Acros",
  "mono": "Mono",
  "monochrome": "Mono",
  "mono+g": "Mono+G",
  "mono+r": "Mono+R",
  "mono+ye": "Mono+Ye",
  "sepia": "Sepia",
};

// Sims we don't have — map to closest available + flag a warning
const MISSING_SIM_FALLBACKS = {
  "classic negative": { fallback: "Classic Chrome", warning: "Classic Negative approximated with Classic Chrome" },
  "classic neg": { fallback: "Classic Chrome", warning: "Classic Negative approximated with Classic Chrome" },
  "classic neg.": { fallback: "Classic Chrome", warning: "Classic Negative approximated with Classic Chrome" },
  "eterna": { fallback: "Pro Neg Std", warning: "Eterna approximated with Pro Neg Std" },
  "eterna cinema": { fallback: "Pro Neg Std", warning: "Eterna approximated with Pro Neg Std" },
  "eterna bleach bypass": { fallback: "Classic Chrome", warning: "Eterna Bleach Bypass approximated with Classic Chrome" },
  "nostalgic neg": { fallback: "Classic Chrome", warning: "Nostalgic Neg approximated with Classic Chrome" },
  "nostalgic neg.": { fallback: "Classic Chrome", warning: "Nostalgic Neg approximated with Classic Chrome" },
  "nostalgic negative": { fallback: "Classic Chrome", warning: "Nostalgic Neg approximated with Classic Chrome" },
  "reala ace": { fallback: "Provia", warning: "Reala Ace approximated with Provia" },
};

// Fields we silently ignore — they don't affect the look in our pipeline
const IGNORED_FIELDS = [
  "sharpness", "sharpening",       // X-Trans V uses "Sharpness", III uses "Sharpening"
  "noise reduction", "high iso nr", // X-Trans III uses "Noise Reduction", V uses "High ISO NR"
  "clarity",
  "iso",
  "exposure compensation",
  "smooth skin effect",
];

/**
 * Parse recipe text → { filmSim, adj, warnings[] }
 */
export function parseRecipe(text) {
  const warnings = [];
  const adj = {};

  // Normalize: split lines, trim, skip empties
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Parse key: value pairs (flexible separator: colon, equals, or tab)
  const fields = {};
  for (const line of lines) {
    const match = line.match(/^([^:=\t]+)[:\t=]\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      fields[key] = value;
    }
  }

  // ── Film Simulation ──
  let filmSim = null;
  const simRaw = fields["film simulation"];
  if (simRaw) {
    const simLower = simRaw.toLowerCase().trim();
    // Also try without trailing period (e.g., "Nostalgic Neg." → "nostalgic neg")
    const simNoDot = simLower.replace(/\.$/, "").trim();
    if (SIM_MAP[simLower] || SIM_MAP[simNoDot]) {
      filmSim = SIM_MAP[simLower] || SIM_MAP[simNoDot];
    } else if (MISSING_SIM_FALLBACKS[simLower] || MISSING_SIM_FALLBACKS[simNoDot]) {
      const fb = MISSING_SIM_FALLBACKS[simLower] || MISSING_SIM_FALLBACKS[simNoDot];
      filmSim = fb.fallback;
      warnings.push(fb.warning);
    } else {
      filmSim = "original";
      warnings.push(`Unknown film simulation: "${simRaw}"`);
    }
  }

  // ── Grain Effect ──
  const grainRaw = fields["grain effect"] || fields["grain"];
  if (grainRaw) {
    const grainLower = grainRaw.toLowerCase();
    if (grainLower.includes("off")) {
      adj.grain = 0;
    } else if (grainLower.includes("strong")) {
      adj.grain = 50;
    } else if (grainLower.includes("weak")) {
      adj.grain = 25;
    }
    // Size
    if (grainLower.includes("large")) {
      adj.grainSize = 75;
    } else if (grainLower.includes("small")) {
      adj.grainSize = 20;
    }
  }

  // ── Color Chrome Effect ──
  const ccRaw = fields["color chrome effect"] || fields["color chrome"];
  if (ccRaw) {
    const ccLower = ccRaw.toLowerCase();
    if (ccLower.includes("off")) {
      adj.colorChrome = 0;
    } else if (ccLower.includes("strong")) {
      adj.colorChrome = 70;
    } else if (ccLower.includes("weak")) {
      adj.colorChrome = 35;
    }
  }

  // ── Color Chrome FX Blue ──
  // FXW uses both "Color Chrome FX Blue" and "Color Chrome Effect Blue"
  const fxRaw = fields["color chrome fx blue"] || fields["color chrome effect blue"];
  if (fxRaw) {
    const fxLower = fxRaw.toLowerCase();
    if (fxLower.includes("off")) {
      adj.colorChromeFxBlue = 0;
    } else if (fxLower.includes("strong")) {
      adj.colorChromeFxBlue = 70;
    } else if (fxLower.includes("weak")) {
      adj.colorChromeFxBlue = 35;
    }
  }

  // ── White Balance shift ──
  // Formats: "+4 Red & -2 Blue", "+4R -2B", "Red +4, Blue -2", etc.
  const wbRaw = fields["white balance"] || fields["wb"];
  if (wbRaw) {
    const redMatch = wbRaw.match(/([+-]?\d+)\s*Red/i) || wbRaw.match(/Red\s*([+-]?\d+)/i) || wbRaw.match(/([+-]?\d+)\s*R\b/i);
    const blueMatch = wbRaw.match(/([+-]?\d+)\s*Blue/i) || wbRaw.match(/Blue\s*([+-]?\d+)/i) || wbRaw.match(/([+-]?\d+)\s*B\b/i);

    if (redMatch || blueMatch) {
      const red = redMatch ? parseInt(redMatch[1], 10) : 0;
      const blue = blueMatch ? parseInt(blueMatch[1], 10) : 0;
      // Red/Blue axis → temperature: positive red = warmer, positive blue = cooler
      // Fuji uses ±9 scale, our slider is ±100. Scale: multiply by ~4.4
      adj.temperature = Math.round((red - blue) * 4.4);
      // Tint component from red shift
      adj.tint = Math.round(red * 2.2);
    }
  }

  // ── Dynamic Range ──
  const drRaw = fields["dynamic range"] || fields["d range priority"] || fields["d-range priority"];
  if (drRaw) {
    const drMatch = drRaw.match(/(?:DR|Auto)?\s*(\d+)/i);
    if (drMatch) {
      const drValue = parseInt(drMatch[1], 10);
      if (drValue >= 400) {
        adj.exposure = (adj.exposure || 0) + 0.6;
        adj.highlights = (adj.highlights || 0) - 30;
      } else if (drValue >= 200) {
        adj.exposure = (adj.exposure || 0) + 0.3;
        adj.highlights = (adj.highlights || 0) - 15;
      }
    }
  }

  // ── Highlight / Shadow / Color (Fuji's -2 to +4 scale, 13 steps on newer cameras) ──
  const highlightRaw = fields["highlight"] || fields["highlight tone"];
  if (highlightRaw) {
    const val = parseFloat(highlightRaw);
    if (!isNaN(val)) {
      // Map roughly: -2→-20, 0→0, +4→+40 (scale by ~10)
      adj.highlights = (adj.highlights || 0) + Math.round(val * 10);
    }
  }

  const shadowRaw = fields["shadow"] || fields["shadow tone"];
  if (shadowRaw) {
    const val = parseFloat(shadowRaw);
    if (!isNaN(val)) {
      adj.shadows = Math.round(val * 10);
    }
  }

  const colorRaw = fields["color"];
  if (colorRaw) {
    const val = parseFloat(colorRaw);
    if (!isNaN(val)) {
      // Map -4 to +4 → roughly -30 to +30
      adj.saturation = Math.round(val * 7.5);
    }
  }

  // Silently ignore fields that don't affect the look (sharpness, noise reduction, etc.)

  return { filmSim, adj, warnings };
}
