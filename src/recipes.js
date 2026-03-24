/*
  Film simulation recipes for Fujilab.

  Existing hand-tuned recipes plus Fuji X Weekly recipes mapped to our
  adjustment parameters.  FXW mapping:
    Highlight × 10 → highlights       Shadow × 10 → shadows
    Color × 7.5   → saturation        DR200 → +0.3 exp / -15 HL
    DR400 → +0.6 exp / -30 HL         Grain: Off=0, Weak=25, Strong=50
    Grain size: Small=20, Large=75     CC: Off=0, Weak=35, Strong=70
    WB: temp=(R-B)×4.4  tint=R×2.2

  Source: fujixweekly.com (public/free recipes)
*/

export const RECIPES = [
  // ═══════════════════════════════════════════════════
  //  KODAK
  // ═══════════════════════════════════════════════════

  // ── hand-tuned originals ──
  {
    name: "Reggie's Portra",
    category: "Kodak",
    description: "#1 FujiXWeekly recipe of 2025",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, exposure: 0.3, highlights: -20, shadows: -20, temperature: 12, tint: 3, saturation: 10, vibrance: 8, highlightRolloff: 20, colorChrome: 70, grain: 15, grainSize: 20 },
  },
  {
    name: "Kodachrome 64",
    category: "Kodak",
    description: "Vivid vintage slide film",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, exposure: 0.2, contrast: 8, temperature: 14, tint: 2, saturation: 10, vibrance: 8, highlightRolloff: 25, colorChrome: 70, colorChromeFxBlue: 35, grain: 15, grainSize: 20 },
  },
  {
    name: "Kodak Gold 200",
    category: "Kodak",
    description: "Warm consumer film tones",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, exposure: 0.5, contrast: -3, highlights: -30, shadows: 10, temperature: 18, tint: 4, saturation: 15, vibrance: 12, highlightRolloff: 40, colorChrome: 35, grain: 35, grainSize: 20 },
  },
  {
    name: "Portra 400",
    category: "Kodak",
    description: "The portrait film king",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, exposure: 0.35, highlights: 0, shadows: -40, temperature: 10, saturation: 10, vibrance: 8, highlightRolloff: 40, colorChrome: 70, grain: 35, grainSize: 20 },
  },
  {
    name: "Portra 800",
    category: "Kodak",
    description: "Warm grainy high-speed film",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, exposure: 0.5, contrast: -5, highlights: -40, shadows: -10, temperature: 22, tint: -3, saturation: 15, vibrance: 12, highlightRolloff: 40, colorChrome: 70, grain: 35, grainSize: 75 },
  },
  {
    name: "McCurry Kodachrome",
    category: "Kodak",
    description: "National Geographic colors",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, temperature: 3, tint: 5, saturation: 10, vibrance: 8, highlightRolloff: 10, colorChrome: 70, grain: 15, grainSize: 20 },
  },

  // ── FXW Kodak recipes ──
  {
    name: "Kodak Ultramax 400",
    category: "Kodak",
    description: "Punchy consumer color · heavy grain",
    filmSim: "Classic Chrome",
    adj: { highlights: 10, shadows: 10, saturation: 30, grain: 50, grainSize: 75, colorChrome: 35, colorChromeFxBlue: 35, temperature: 26, tint: 2 },
  },
  {
    name: "Kodak Ektar 100",
    category: "Kodak",
    description: "Ultra-vivid fine grain color neg",
    filmSim: "Classic Chrome",
    adj: { highlights: 10, shadows: -20, saturation: 30, colorChrome: 70, colorChromeFxBlue: 35, temperature: 13, tint: 7 },
  },
  {
    name: "Portra 160",
    category: "Kodak",
    description: "Fine grain low-speed portrait film",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -40, shadows: -20, colorChrome: 70, colorChromeFxBlue: 70, grain: 25, grainSize: 20, temperature: 44, tint: 9 },
  },
  {
    name: "Kodak Max 800",
    category: "Kodak",
    description: "Grainy high-speed drugstore film",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -50, shadows: 10, saturation: -8, grain: 50, grainSize: 20, colorChrome: 70, temperature: -13, tint: -11 },
  },
  {
    name: "Old Kodak",
    category: "Kodak",
    description: "Faded vintage Kodak look",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: 5, shadows: -5, saturation: 23, grain: 50, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 70, temperature: 31, tint: 2 },
  },
  {
    name: "Elite Chrome 200",
    category: "Kodak",
    description: "Cool-toned consumer slide film",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -40, shadows: 10, saturation: -8, grain: 50, grainSize: 75, colorChrome: 70, colorChromeFxBlue: 35, temperature: 9, tint: -2 },
  },
  {
    name: "Kodak Vision3 250D",
    category: "Kodak",
    description: "Daylight cinema negative stock",
    filmSim: "Pro Neg Std",
    adj: { highlights: 30, shadows: 40, saturation: 23, grain: 50, grainSize: 20, colorChrome: 70, temperature: -9, tint: -7 },
  },

  // ═══════════════════════════════════════════════════
  //  FUJI
  // ═══════════════════════════════════════════════════

  // ── hand-tuned originals ──
  {
    name: "Fujifilm Negative",
    category: "Fuji",
    description: "Clean natural film tones",
    filmSim: "Provia",
    adj: { intensity: 90, exposure: 0.35, contrast: -3, highlights: -20, shadows: -10, temperature: 1, saturation: 10, vibrance: 8, highlightRolloff: 40, colorChrome: 70, grain: 15, grainSize: 20 },
  },
  {
    name: "California Summer",
    category: "Fuji",
    description: "Golden warm nostalgia",
    filmSim: "Astia",
    adj: { intensity: 90, exposure: 0.6, contrast: -8, highlights: -40, shadows: -20, temperature: 28, tint: -2, saturation: 20, vibrance: 15, highlightRolloff: 40, colorChrome: 70, colorChromeFxBlue: 35, grain: 15, grainSize: 20 },
  },
  {
    name: "Soft Portrait",
    category: "Fuji",
    description: "Flattering skin, gentle tones",
    filmSim: "Pro Neg Hi",
    adj: { intensity: 90, exposure: 0.15, contrast: -8, highlights: -15, shadows: 10, temperature: 6, tint: 3, vibrance: -8, highlightRolloff: 50, grain: 5, grainSize: 15 },
  },

  // ── FXW Fuji recipes ──
  {
    name: "Fujicolor Reala 100",
    category: "Fuji",
    description: "Natural color, faithful reproduction",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -40, shadows: -10, colorChrome: 70, colorChromeFxBlue: 70, grain: 25, grainSize: 20 },
  },
  {
    name: "Superia 100",
    category: "Fuji",
    description: "Classic consumer daylight film",
    filmSim: "Classic Chrome",
    adj: { highlights: -10, shadows: -20, saturation: 8, colorChrome: 70, colorChromeFxBlue: 35, grain: 25, grainSize: 20, temperature: 4, tint: 0 },
  },
  {
    name: "Superia Xtra 400",
    category: "Fuji",
    description: "Saturated everyday color",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -30, shadows: -10, saturation: 30, colorChromeFxBlue: 70, grain: 50, grainSize: 20, temperature: 35, tint: 7 },
  },
  {
    name: "Natura 1600",
    category: "Fuji",
    description: "Low-light ambient film · soft grain",
    filmSim: "Classic Chrome",
    adj: { highlights: -15, shadows: 15, saturation: -15, grain: 50, grainSize: 75, colorChrome: 70, colorChromeFxBlue: 70, temperature: 4, tint: -2 },
  },
  {
    name: "Pro 400H",
    category: "Fuji",
    description: "Smooth pastel wedding film",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -50, shadows: 40, saturation: 30, grain: 50, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 35, temperature: 18 },
  },
  {
    name: "Standard Provia",
    category: "Fuji",
    description: "Faithful slide film baseline",
    filmSim: "Provia",
    adj: { exposure: 0.6, highlights: -10, shadows: 10, saturation: 15, grain: 25, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 35, temperature: -13, tint: -7 },
  },

  // ═══════════════════════════════════════════════════
  //  CINEMATIC
  // ═══════════════════════════════════════════════════

  // ── hand-tuned originals ──
  {
    name: "CineStill 800T",
    category: "Cinematic",
    description: "Tungsten cinema film · cool blue cast",
    filmSim: "Pro Neg Std",
    adj: { intensity: 90, exposure: 0.1, contrast: -10, highlights: -15, shadows: 30, temperature: -12, tint: -4, saturation: 12, vibrance: 10, highlightRolloff: 55, colorChrome: 50, colorChromeFxBlue: 35, grain: 35, grainSize: 75 },
  },
  {
    name: "Vibrant Arizona",
    category: "Cinematic",
    description: "Wes Anderson palette",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, exposure: 0.5, contrast: -5, temperature: 18, tint: 8, saturation: 20, vibrance: 15, highlightRolloff: 55, colorChromeFxBlue: 35, grain: 15, grainSize: 20 },
  },
  {
    name: "Cinematic Teal",
    category: "Cinematic",
    description: "Teal shadows, warm highlights",
    filmSim: "Pro Neg Std",
    adj: { intensity: 90, contrast: 8, highlights: -20, shadows: 10, temperature: -8, tint: -3, saturation: -15, highlightRolloff: 60, colorChrome: 35, vignette: 20, fade: 4 },
    curves: { rgb: [[0, 0], [64, 50], [192, 210], [255, 255]], r: [[0, 0], [128, 135], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 12], [128, 138], [255, 245]] },
  },

  // ── FXW Cinematic recipes ──
  {
    name: "CineStill 50D",
    category: "Cinematic",
    description: "Daylight cinema stock · cool tones",
    filmSim: "Astia",
    adj: { exposure: 0.3, highlights: -25, saturation: -30, grain: 25, grainSize: 20, colorChrome: 70, temperature: -9, tint: -11 },
  },
  {
    name: "Eterna Cinema",
    category: "Cinematic",
    description: "Fuji's own cinema stock emulation",
    filmSim: "Pro Neg Std",
    adj: { exposure: 0.6, highlights: 0, shadows: 20, saturation: 23, grain: 50, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 70, temperature: 48, tint: 9 },
  },
  {
    name: "Eterna Summer",
    category: "Cinematic",
    description: "Warm cinema look for golden hour",
    filmSim: "Pro Neg Std",
    adj: { exposure: 0.3, highlights: 10, saturation: 30, grain: 50, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 70, temperature: 44, tint: 7 },
  },
  {
    name: "LomoChrome Metropolis",
    category: "Cinematic",
    description: "Desaturated urban cinema look",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.3, highlights: -5, shadows: 25, saturation: -15, grain: 50, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 70, temperature: 35, tint: 2 },
  },
  {
    name: "Bleach Bypass",
    category: "Cinematic",
    description: "High-contrast desaturated look",
    filmSim: "Classic Chrome",
    adj: { highlights: 20, shadows: 40, saturation: -30, grain: 50, grainSize: 75, colorChrome: 35, colorChromeFxBlue: 70, temperature: -9 },
  },

  // ═══════════════════════════════════════════════════
  //  SLIDE FILM
  // ═══════════════════════════════════════════════════
  {
    name: "Rockwell Velvia",
    category: "Slide",
    description: "Hyper-vivid landscape slide film",
    filmSim: "Velvia",
    adj: { exposure: 0.3, highlights: -25, shadows: -10, saturation: 30, grain: 25, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 70, temperature: 9, tint: 2 },
  },
  {
    name: "AgfaChrome RS 100",
    category: "Slide",
    description: "Cool-shifted vivid slide film",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -20, shadows: -10, saturation: 15, grain: 50, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 70, temperature: -35, tint: -7 },
  },
  {
    name: "Chrome Slide",
    category: "Slide",
    description: "Punchy daylight transparency film",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -20, shadows: 10, saturation: 30, grain: 25, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 70, temperature: -18, tint: -7 },
  },

  // ═══════════════════════════════════════════════════
  //  STREET
  // ═══════════════════════════════════════════════════

  // ── hand-tuned originals ──
  {
    name: "Pacific Blues",
    category: "Street",
    description: "Punchy street color",
    filmSim: "Classic Chrome",
    adj: { intensity: 90, exposure: 0.5, contrast: -5, highlights: -40, shadows: 60, temperature: 12, saturation: 20, vibrance: 15, highlightRolloff: 40, colorChrome: 70, colorChromeFxBlue: 35, grain: 40, grainSize: 75 },
  },
  {
    name: "Classic Color",
    category: "Street",
    description: "Versatile everyday film",
    filmSim: "Classic Chrome",
    adj: { intensity: 95, exposure: 0.3, contrast: -3, highlights: -10, shadows: -40, temperature: 6, saturation: 15, vibrance: 12, highlightRolloff: 40, colorChrome: 70, colorChromeFxBlue: 35, grain: 35, grainSize: 20 },
  },

  // ── FXW Street recipes ──
  {
    name: "Classic Negative",
    category: "Street",
    description: "FXW's most popular look",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.3, highlights: -5, saturation: 23, grain: 25, grainSize: 75, colorChrome: 35, colorChromeFxBlue: 35, temperature: 35, tint: 9 },
  },
  {
    name: "Nature Neon",
    category: "Street",
    description: "Vivid greens, cool shadows",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -30, shadows: 20, saturation: 23, grain: 25, grainSize: 20, colorChrome: 35, colorChromeFxBlue: 35, temperature: 31, tint: 4 },
  },
  {
    name: "Nostalgic Negative",
    category: "Street",
    description: "Warm faded vintage tones",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.3, highlights: -25, saturation: 30, grain: 25, grainSize: 75, colorChrome: 70, colorChromeFxBlue: 70, temperature: 35, tint: 7 },
  },

  // ═══════════════════════════════════════════════════
  //  AGFA
  // ═══════════════════════════════════════════════════
  {
    name: "Agfa Vista 100",
    category: "Agfa",
    description: "Warm consumer print film",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.3, highlights: -5, shadows: -20, saturation: 15, grain: 50, grainSize: 20, colorChrome: 35, colorChromeFxBlue: 35, temperature: 4, tint: -9 },
  },
  {
    name: "Agfa Ultra 100",
    category: "Agfa",
    description: "Ultra-saturated vivid color",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -10, shadows: -20, saturation: 15, grain: 25, grainSize: 75, colorChrome: 70, colorChromeFxBlue: 70, temperature: -22, tint: -4 },
  },

  // ═══════════════════════════════════════════════════
  //  VINTAGE / FADED
  // ═══════════════════════════════════════════════════
  {
    name: "Nostalgia Color",
    category: "Vintage",
    description: "Faded warm memory tones",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -40, shadows: 30, saturation: -15, grain: 50, grainSize: 75, colorChrome: 70, colorChromeFxBlue: 35, temperature: -13, tint: -9 },
  },
  {
    name: "Vintage Negative",
    category: "Vintage",
    description: "Deeply faded color negative",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: -20, shadows: 20, saturation: -23, grain: 50, grainSize: 75, colorChrome: 70, colorChromeFxBlue: 70, temperature: -18, tint: -13 },
  },
  {
    name: "Vintage Analog",
    category: "Vintage",
    description: "Desaturated expired film look",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.3, highlights: 5, saturation: -30, grain: 50, grainSize: 20, colorChromeFxBlue: 35, temperature: 0, tint: -9 },
  },
  {
    name: "Faded Negative",
    category: "Vintage",
    description: "Light-leaked expired color neg",
    filmSim: "Classic Chrome",
    adj: { exposure: 0.6, highlights: 0, shadows: 40, saturation: -15, grain: 25, grainSize: 75, colorChrome: 70, colorChromeFxBlue: 70, temperature: 44, tint: 9 },
  },
  {
    name: "Timeless Negative",
    category: "Vintage",
    description: "Muted warm cinematic nostalgia",
    filmSim: "Pro Neg Std",
    adj: { exposure: 0.3, highlights: -5, shadows: -10, saturation: 23, grain: 25, grainSize: 20, colorChrome: 70, colorChromeFxBlue: 35, temperature: 40, tint: 9 },
  },

  // ═══════════════════════════════════════════════════
  //  B&W
  // ═══════════════════════════════════════════════════

  // ── hand-tuned originals ──
  {
    name: "Tri-X 400",
    category: "B&W",
    description: "Classic gritty photojournalism",
    filmSim: "Acros",
    adj: { intensity: 100, exposure: 0.35, contrast: 12, shadows: 60, temperature: 25, tint: 10, highlightRolloff: 25, colorChrome: 70, grain: 40, grainSize: 75 },
  },
  {
    name: "Film Noir",
    category: "B&W",
    description: "Deep shadows, high drama",
    filmSim: "Mono+R",
    adj: { intensity: 100, contrast: 15, highlights: 10, shadows: -20, blacks: -25, highlightRolloff: 30, grain: 30, grainSize: 50, vignette: 25 },
    curves: { rgb: [[0, 0], [48, 20], [200, 220], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
  },
];

export const RECIPE_CATEGORIES = ["Kodak", "Fuji", "Cinematic", "Slide", "Street", "Agfa", "Vintage", "B&W"];
