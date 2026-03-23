import { useState, useRef, useCallback, useEffect } from "react";
import { parse3DL, parseCube, applyLUT } from "./lut";
import CurveEditor, { buildCurveLUT } from "./CurveEditor";

const BUNDLED_LUTS = [
  "Fuji XTrans III - Acros.3dl",
  "Fuji XTrans III - Acros+G.3dl",
  "Fuji XTrans III - Acros+R.3dl",
  "Fuji XTrans III - Acros+Ye.3dl",
  "Fuji XTrans III - Astia.3dl",
  "Fuji XTrans III - Classic Chrome.3dl",
  "Fuji XTrans III - Mono.3dl",
  "Fuji XTrans III - Mono+G.3dl",
  "Fuji XTrans III - Mono+R.3dl",
  "Fuji XTrans III - Mono+Ye.3dl",
  "Fuji XTrans III - Pro Neg Hi.3dl",
  "Fuji XTrans III - Pro Neg Std.3dl",
  "Fuji XTrans III - Provia.3dl",
  "Fuji XTrans III - Sepia.3dl",
  "Fuji XTrans III - Velvia.3dl",
];

const DEFAULT_ADJ = {
  intensity: 100,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  grain: 0,
  grainSize: 30,
  vignette: 0,
  highlightRolloff: 0,
  colorChrome: 0,
  colorChromeFxBlue: 0,
  fade: 0,
};

const DEFAULT_CURVES = {
  rgb: [[0, 0], [255, 255]],
  r: [[0, 0], [255, 255]],
  g: [[0, 0], [255, 255]],
  b: [[0, 0], [255, 255]],
};

/*
  Recipes based on FujiXWeekly's most popular film simulation recipes (2025).
  Camera settings mapped to our app's adjustment parameters.
  Recipes using film sims we lack LUTs for (Classic Neg, Eterna, Nostalgic Neg,
  Reala Ace) are approximated with the closest available XTrans III simulation.
  Source: fujixweekly.com
*/
const RECIPES = [
  // ── Kodak Film Emulations ──
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
  // ── Cinematic ──
  {
    name: "CineStill 800T",
    category: "Cinematic",
    description: "Tungsten cinema film &middot; cool blue cast",
    filmSim: "Pro Neg Std",
    adj: { intensity: 90, exposure: 0.1, contrast: -10, shadows: 40, temperature: -30, tint: -10, saturation: 20, vibrance: 15, highlightRolloff: 40, colorChrome: 70, colorChromeFxBlue: 35, grain: 40, grainSize: 75 },
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
  // ── Street ──
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
  // ── Fuji ──
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
  // ── B&W ──
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
    filmSim: "Acros+R",
    adj: { intensity: 100, contrast: 15, highlights: 10, shadows: -20, blacks: -25, highlightRolloff: 30, grain: 30, grainSize: 50, vignette: 25 },
    curves: { rgb: [[0, 0], [48, 20], [200, 220], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
  },
];

const RECIPE_CATEGORIES = ["Kodak", "Cinematic", "Street", "Fuji", "B&W"];

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/*
  Deterministic position-based grain hash.
  Produces stable noise that doesn't shimmer when other adjustments change.
  Integer hash gives spatial correlation between neighboring pixels.
*/
function grainHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h = Math.imul(h ^ (h >>> 16), 2654435769);
  return (h & 0xffff) / 65536; // 0 to 1
}

/* Compute hue in degrees from RGB (0-255 inputs). Returns -1 for achromatic. */
function rgbHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const range = mx - mn;
  if (range < 8) return -1;
  let h;
  if (mx === r) h = ((g - b) / range) % 6;
  else if (mx === g) h = (b - r) / range + 2;
  else h = (r - g) / range + 4;
  return ((h * 60) + 360) % 360;
}

/* ── Collapsible panel ── */
function Panel({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #1e1e1e" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: "11px 16px",
          fontSize: 10,
          fontWeight: 600,
          color: "#888",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          userSelect: "none",
        }}
      >
        {title}
        <span style={{ fontSize: 8, color: "#555", transition: "transform 0.15s", transform: open ? "rotate(0)" : "rotate(-90deg)" }}>&#9660;</span>
      </div>
      {open && <div style={{ padding: "0 16px 14px" }}>{children}</div>}
    </div>
  );
}

/* ── Slider control ── */
function Slider({ label, value, min, max, step = 1, defaultValue = 0, onChange, format }) {
  const display = format ? format(value) : value;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: "#999" }}>{label}</span>
        <span style={{ fontSize: 11, color: "#666", fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        style={{ width: "100%", accentColor: "#666", height: 2 }}
      />
    </div>
  );
}

/* ── Main app ── */
export default function App() {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [luts, setLuts] = useState({});
  const [activePreset, setActivePreset] = useState("original");
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [adj, setAdj] = useState(DEFAULT_ADJ);
  const [curves, setCurves] = useState(DEFAULT_CURVES);
  const [splitView, setSplitView] = useState(false);
  const [splitPos, setSplitPos] = useState(50);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loadingLuts, setLoadingLuts] = useState(true);

  const canvasRef = useRef(null);
  const originalDataRef = useRef(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  const fileRef = useRef(null);
  const lutFileRef = useRef(null);
  const wrapperRef = useRef(null);

  const setField = useCallback((field, value) => {
    setAdj((prev) => ({ ...prev, [field]: value }));
    setActiveRecipe(null); // manual edit clears active recipe indicator
  }, []);

  const applyRecipe = useCallback((recipe) => {
    setActivePreset(recipe.filmSim || "original");
    setAdj({ ...DEFAULT_ADJ, ...recipe.adj });
    setCurves(recipe.curves ? { ...DEFAULT_CURVES, ...recipe.curves } : DEFAULT_CURVES);
    setActiveRecipe(recipe.name);
  }, []);

  /* ── Load bundled LUTs ── */
  useEffect(() => {
    let cancelled = false;
    async function loadBundled() {
      const loaded = {};
      await Promise.all(
        BUNDLED_LUTS.map(async (filename) => {
          try {
            const resp = await fetch(`/luts/${filename}`);
            if (!resp.ok) return;
            const text = await resp.text();
            const name = filename.replace(/\.(3dl|cube)$/i, "").replace(/^Fuji XTrans III\s*-\s*/i, "").trim();
            loaded[name] = filename.toLowerCase().endsWith(".cube") ? parseCube(text) : parse3DL(text);
          } catch (err) {
            console.error(`Failed to load ${filename}:`, err);
          }
        })
      );
      if (!cancelled) {
        setLuts((prev) => ({ ...loaded, ...prev }));
        setLoadingLuts(false);
      }
    }
    loadBundled();
    return () => { cancelled = true; };
  }, []);

  /* ── Image processing pipeline ── */
  const processImage = useCallback(() => {
    const od = originalDataRef.current;
    const canvas = canvasRef.current;
    if (!od || !canvas) return;

    const { w, h } = dimsRef.current;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const src = od.data;
    const out = ctx.createImageData(w, h);
    const dst = out.data;

    const {
      intensity, exposure, contrast, highlights, shadows, whites, blacks,
      temperature, tint, vibrance, saturation, grain, grainSize, vignette,
      highlightRolloff, colorChrome, colorChromeFxBlue, fade,
    } = adj;
    const lut = luts[activePreset];
    const t = intensity / 100;

    // Pre-compute per-channel curve LUTs
    const rgbCurve = buildCurveLUT(curves.rgb);
    const rCurve = buildCurveLUT(curves.r);
    const gCurve = buildCurveLUT(curves.g);
    const bCurve = buildCurveLUT(curves.b);

    // Pre-compute combined per-channel tables:
    // exposure → contrast → highlight rolloff → whites/blacks → fade → curves
    const expMul = Math.pow(2, exposure);
    const contrastF = 1 + contrast / 100;
    const wt = whites / 100;
    const bt = blacks / 100;
    const rolloff = highlightRolloff / 100;
    const fadeAmt = fade / 100 * 0.18;

    const buildTable = (chanCurve) => {
      const table = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        let v = i / 255;
        // Exposure
        v *= expMul;
        // Contrast (centered at 0.5)
        v = 0.5 + (v - 0.5) * contrastF;
        // Highlight rolloff: soft shoulder (film-like)
        if (rolloff > 0 && v > 0.5) {
          const threshold = 1 - rolloff * 0.5; // 0.5 to 1.0
          if (v > threshold) {
            const excess = v - threshold;
            const softness = rolloff * 0.4;
            v = threshold + softness * (1 - Math.exp(-excess / softness));
          }
        }
        // Whites (boost bright values quadratically)
        v += wt * 0.4 * v * v;
        // Blacks (lift dark values quadratically)
        v += bt * 0.4 * (1 - v) * (1 - v);
        // Fade (lift the floor — mimics faded/matte film)
        if (fadeAmt > 0) {
          v = fadeAmt + v * (1 - fadeAmt);
        }
        v = Math.max(0, Math.min(1, v));
        const idx = Math.max(0, Math.min(255, Math.round(v * 255)));
        table[i] = chanCurve[rgbCurve[idx]];
      }
      return table;
    };

    const rTable = buildTable(rCurve);
    const gTable = buildTable(gCurve);
    const bTable = buildTable(bCurve);

    // Feature flags for per-pixel branches
    const hasCC = colorChrome > 0;
    const hasCCB = colorChromeFxBlue > 0;
    const hasHL = highlights !== 0 || shadows !== 0;
    const hasTT = temperature !== 0 || tint !== 0;
    const hasVS = vibrance !== 0 || saturation !== 0;
    const hasGrain = grain > 0;
    const hasVig = vignette > 0;
    const grainAmt = grain / 100;
    const grainAmp = 55 + (grainSize / 100) * 35; // 55-90 noise amplitude
    const grainCellSize = 1.0 + (grainSize / 100) * 2.5; // 1-3.5 px cell size for clumping
    const vigAmt = vignette / 100;
    const cx = w / 2, cy = h / 2;
    const ccAmt = colorChrome / 100;
    const ccbAmt = colorChromeFxBlue / 100;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        let r = src[i], g = src[i + 1], b = src[i + 2];

        // 1. Film simulation LUT
        if (lut) {
          const [nr, ng, nb] = applyLUT(lut, r, g, b);
          r = Math.round(r + (clamp(nr) - r) * t);
          g = Math.round(g + (clamp(ng) - g) * t);
          b = Math.round(b + (clamp(nb) - b) * t);
        }

        // 2. Per-channel table (exposure + contrast + rolloff + whites/blacks + fade + curves)
        r = rTable[r];
        g = gTable[g];
        b = bTable[b];

        // 3. Color Chrome Effect: reduce luminance in saturated warm hues (R/O/Y/G)
        //    to prevent channel clipping and retain tonal gradation.
        //    Blues are excluded — that's Color Chrome FX Blue's job.
        if (hasCC || hasCCB) {
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const range = mx - mn;
          const sat = mx > 0 ? range / mx : 0;
          const hue = range > 8 ? rgbHue(r, g, b) : -1;
          const lum = r * 0.299 + g * 0.587 + b * 0.114;

          // Color Chrome: warm hues (0-170°), fading out toward blues
          if (hasCC && sat > 0.4 && hue >= 0) {
            let hueMask = 1;
            if (hue > 140 && hue < 200) hueMask = Math.max(0, 1 - (hue - 140) / 60);
            else if (hue >= 200) hueMask = 0;
            if (hueMask > 0) {
              const strength = ((sat - 0.4) / 0.6) * ccAmt * hueMask;
              const factor = lum < 128
                ? 1 - strength * 0.3 * (1 - lum / 128)
                : 1 - strength * 0.04;
              r = clamp(r * factor); g = clamp(g * factor); b = clamp(b * factor);
            }
          }

          // Color Chrome FX Blue: blues/purples (190-280°)
          if (hasCCB && sat > 0.3 && hue >= 0) {
            const dist = Math.min(Math.abs(hue - 235), 360 - Math.abs(hue - 235));
            if (dist < 55) {
              const mask = Math.cos((dist / 55) * Math.PI * 0.5);
              const strength = mask * sat * ccbAmt;
              const factor = lum < 128
                ? 1 - strength * 0.35 * (1 - lum / 128)
                : 1 - strength * 0.05;
              r = clamp(r * factor); g = clamp(g * factor); b = clamp(b * factor);
            }
          }
        }

        // 5. Highlights / Shadows (luminance-dependent)
        if (hasHL) {
          const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          if (highlights !== 0) {
            const hw = lum > 0.5 ? (lum - 0.5) * 2 : 0;
            const hadj = highlights * 0.5 * hw * hw;
            r = clamp(r + hadj); g = clamp(g + hadj); b = clamp(b + hadj);
          }
          if (shadows !== 0) {
            const sw = lum < 0.5 ? (0.5 - lum) * 2 : 0;
            const sadj = shadows * 0.5 * sw * sw;
            r = clamp(r + sadj); g = clamp(g + sadj); b = clamp(b + sadj);
          }
        }

        // 6. Temperature / Tint
        if (hasTT) {
          r = clamp(r + temperature * 0.3);
          g = clamp(g + tint * 0.25 - temperature * 0.1);
          b = clamp(b - temperature * 0.3);
        }

        // 7. Saturation then Vibrance
        if (hasVS) {
          let avg = (r + g + b) / 3;
          if (saturation !== 0) {
            const sf = 1 + saturation / 100;
            r = clamp(avg + (r - avg) * sf);
            g = clamp(avg + (g - avg) * sf);
            b = clamp(avg + (b - avg) * sf);
          }
          if (vibrance !== 0) {
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx > 0 ? (mx - mn) / mx : 0;
            const vf = 1 + (vibrance / 100) * (1 - sat);
            avg = (r + g + b) / 3;
            r = clamp(avg + (r - avg) * vf);
            g = clamp(avg + (g - avg) * vf);
            b = clamp(avg + (b - avg) * vf);
          }
        }

        // 8. Vignette
        if (hasVig) {
          const dx = (px - cx) / cx, dy = (py - cy) / cy;
          const vig = 1 - vigAmt * (dx * dx + dy * dy) * 0.5;
          r = clamp(r * vig); g = clamp(g * vig); b = clamp(b * vig);
        }

        // 9. Film grain: deterministic, spatially-correlated, midtone-weighted
        //    Uses position-based hash (stable across re-renders) with bilinear
        //    interpolation between grid points for organic clumping texture.
        if (hasGrain) {
          const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          // Bell curve: peak at lower-midtones (0.4), fall off at extremes
          const grainWeight = Math.exp(-((lum - 0.4) * (lum - 0.4)) / 0.1225);
          // Bilinear interpolation between hash grid points for clumping
          const fx = px / grainCellSize, fy = py / grainCellSize;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const dx = fx - x0, dy = fy - y0;
          const n00 = grainHash(x0, y0);
          const n10 = grainHash(x0 + 1, y0);
          const n01 = grainHash(x0, y0 + 1);
          const n11 = grainHash(x0 + 1, y0 + 1);
          const noise = ((n00 + (n10 - n00) * dx) + ((n01 + (n11 - n01) * dx) - (n00 + (n10 - n00) * dx)) * dy - 0.5) * 2;
          const grainVal = noise * grainAmp * grainAmt * grainWeight;
          r = clamp(r + grainVal); g = clamp(g + grainVal); b = clamp(b + grainVal);
        }

        dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
      }
    }

    // Split view: left side shows original
    if (splitView) {
      const splitX = Math.round((splitPos / 100) * w);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < splitX; x++) {
          const idx = (y * w + x) * 4;
          dst[idx] = src[idx]; dst[idx + 1] = src[idx + 1]; dst[idx + 2] = src[idx + 2];
        }
      }
    }

    ctx.putImageData(out, 0, 0);
  }, [adj, activePreset, luts, curves, splitView, splitPos]);

  useEffect(() => {
    if (imageLoaded) processImage();
  }, [imageLoaded, processImage]);

  /* ── File loading ── */
  const loadImageFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = Math.min(1400, img.naturalWidth);
        const scale = maxW / img.naturalWidth;
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        dimsRef.current = { w, h };
        const offscreen = document.createElement("canvas");
        offscreen.width = w; offscreen.height = h;
        const octx = offscreen.getContext("2d");
        octx.drawImage(img, 0, 0, w, h);
        originalDataRef.current = octx.getImageData(0, 0, w, h);
        setActivePreset("original");
        setAdj(DEFAULT_ADJ);
        setCurves(DEFAULT_CURVES);
        setActiveRecipe(null);
        setSplitView(false);
        setImageLoaded(true);
        setProcessing(false);
      };
      img.onerror = () => setProcessing(false);
      img.src = e.target.result;
    };
    reader.onerror = () => setProcessing(false);
    reader.readAsDataURL(file);
  }, []);

  const loadLUTFiles = useCallback((files) => {
    setLoadingLuts(true);
    const newLuts = { ...luts };
    let remaining = files.length;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const name = file.name.replace(/\.(3dl|cube)$/i, "").replace(/^Fuji XTrans III\s*/i, "").trim();
          newLuts[name] = file.name.toLowerCase().endsWith(".cube") ? parseCube(text) : parse3DL(text);
        } catch (err) { console.error(`Failed to parse ${file.name}:`, err); }
        remaining--;
        if (remaining === 0) { setLuts(newLuts); setLoadingLuts(false); }
      };
      reader.onerror = () => { remaining--; if (remaining === 0) { setLuts(newLuts); setLoadingLuts(false); } };
      reader.readAsText(file);
    });
  }, [luts]);

  const handleExport = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `graded_${activeRecipe || activePreset}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files || []);
    const lutFiles = files.filter((f) => f.name.match(/\.(3dl|cube)$/i));
    const imgFiles = files.filter((f) => f.type.startsWith("image/"));
    if (lutFiles.length > 0) loadLUTFiles(lutFiles);
    if (imgFiles.length > 0) loadImageFile(imgFiles[0]);
  };

  /* ── Split view drag ── */
  const handleSplitMove = useCallback((clientX) => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setSplitPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    if (!draggingSplit) return;
    const onMove = (e) => { e.preventDefault(); handleSplitMove(e.touches ? e.touches[0].clientX : e.clientX); };
    const onUp = () => setDraggingSplit(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [draggingSplit, handleSplitMove]);

  const lutNames = Object.keys(luts);

  /* ── Styles ── */
  const presetBtn = (active) => ({
    padding: "5px 10px",
    fontSize: 10,
    fontWeight: active ? 600 : 400,
    fontFamily: "inherit",
    background: active ? "#fff" : "#1e1e1e",
    color: active ? "#111" : "#777",
    border: `1px solid ${active ? "#fff" : "#2a2a2a"}`,
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all 0.1s",
    letterSpacing: "0.01em",
  });

  const headerBtn = {
    padding: "7px 14px",
    fontSize: 11,
    fontWeight: 500,
    fontFamily: "inherit",
    background: "#1e1e1e",
    color: "#aaa",
    border: "1px solid #333",
    borderRadius: 5,
    cursor: "pointer",
    whiteSpace: "nowrap",
    letterSpacing: "0.01em",
  };

  const recipeBtnStyle = (active) => ({
    width: "100%",
    padding: "8px 10px",
    textAlign: "left",
    background: active ? "#222" : "transparent",
    border: active ? "1px solid #3a3a3a" : "1px solid transparent",
    borderRadius: 5,
    cursor: "pointer",
    transition: "all 0.1s",
  });

  const signFmt = (v) => (v > 0 ? "+" : "") + v;
  const pctFmt = (v) => v + "%";

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#111", color: "#ddd", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {/* ── Header ── */}
      <div style={{ borderBottom: "1px solid #1e1e1e", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", color: "#eee" }}>Film Simulations</h1>
          <p style={{ margin: "1px 0 0", fontSize: 10, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase" }}>Fujifilm Colour Grading</p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => fileRef.current?.click()} style={headerBtn}>
            {processing ? "Loading..." : "Load Image"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && loadImageFile(e.target.files[0])} />
          <button onClick={() => lutFileRef.current?.click()} style={headerBtn}>
            {loadingLuts ? "Loading..." : `Load LUTs${lutNames.length ? ` (${lutNames.length})` : ""}`}
          </button>
          <input ref={lutFileRef} type="file" accept=".3dl,.cube" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) loadLUTFiles(e.target.files); }} />
          {imageLoaded && (
            <>
              <button onClick={() => setSplitView(!splitView)} style={{ ...headerBtn, ...(splitView ? { background: "#fff", color: "#111", borderColor: "#fff" } : {}) }}>
                Before / After
              </button>
              <button onClick={handleExport} style={{ ...headerBtn, background: "#fff", color: "#111", borderColor: "#fff", fontWeight: 600 }}>
                Export
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Image area ── */}
        <div
          ref={wrapperRef}
          style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden", position: "relative", background: "#0d0d0d", userSelect: "none" }}
        >
          {!imageLoaded ? (
            <div
              onClick={() => fileRef.current?.click()}
              style={{ maxWidth: 480, width: "80%", border: "2px dashed #2a2a2a", borderRadius: 12, padding: "50px 36px", textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#555")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
            >
              <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.15 }}>&#9723;</div>
              <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 6px", color: "#aaa" }}>Drop an image here</p>
              <p style={{ fontSize: 12, color: "#555", margin: 0 }}>or click to browse &middot; supports JPG, PNG, WebP</p>
            </div>
          ) : (
            <>
              <canvas ref={canvasRef} style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }} />
              {splitView && (
                <div
                  onMouseDown={(e) => { e.preventDefault(); setDraggingSplit(true); }}
                  onTouchStart={(e) => { e.preventDefault(); setDraggingSplit(true); }}
                  style={{ position: "absolute", left: `${splitPos}%`, top: 0, bottom: 0, width: 2, background: "#fff", cursor: "ew-resize", zIndex: 10 }}
                >
                  <div style={{
                    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    width: 24, height: 24, borderRadius: "50%", background: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#111", fontSize: 9, fontWeight: 700,
                  }}>&#9666;&#9656;</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div style={{ width: 300, borderLeft: "1px solid #1e1e1e", overflowY: "auto", flexShrink: 0, background: "#161616" }}>

          {/* Recipes */}
          <Panel title="Recipes">
            {RECIPE_CATEGORIES.map((cat) => {
              const catRecipes = RECIPES.filter((r) => r.category === cat);
              if (catRecipes.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{cat}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {catRecipes.map((recipe) => (
                      <div
                        key={recipe.name}
                        onClick={() => applyRecipe(recipe)}
                        style={recipeBtnStyle(activeRecipe === recipe.name)}
                      >
                        <div style={{ fontSize: 11, fontWeight: activeRecipe === recipe.name ? 600 : 400, color: activeRecipe === recipe.name ? "#eee" : "#bbb" }}>
                          {recipe.name}
                        </div>
                        <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>
                          {recipe.description} &middot; {recipe.filmSim}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </Panel>

          {/* Film Simulation */}
          <Panel title="Film Simulation" defaultOpen={false}>
            {lutNames.length === 0 ? (
              <p style={{ fontSize: 11, color: "#555", margin: 0 }}>Loading LUTs...</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                <button onClick={() => { setActivePreset("original"); setActiveRecipe(null); }} style={presetBtn(activePreset === "original")}>
                  Original
                </button>
                {lutNames.map((name) => (
                  <button key={name} onClick={() => { setActivePreset(name); setActiveRecipe(null); }} style={presetBtn(activePreset === name)}>
                    {name}
                  </button>
                ))}
              </div>
            )}
            <Slider label="Intensity" value={adj.intensity} min={0} max={100} defaultValue={100} onChange={(v) => setField("intensity", v)} format={pctFmt} />
          </Panel>

          {/* Basic */}
          <Panel title="Basic" defaultOpen={false}>
            <Slider label="Exposure" value={adj.exposure} min={-5} max={5} step={0.05} onChange={(v) => setField("exposure", v)} format={(v) => (v > 0 ? "+" : "") + v.toFixed(2)} />
            <Slider label="Contrast" value={adj.contrast} min={-100} max={100} onChange={(v) => setField("contrast", v)} format={signFmt} />
            <Slider label="Highlights" value={adj.highlights} min={-100} max={100} onChange={(v) => setField("highlights", v)} format={signFmt} />
            <Slider label="Shadows" value={adj.shadows} min={-100} max={100} onChange={(v) => setField("shadows", v)} format={signFmt} />
            <Slider label="Whites" value={adj.whites} min={-100} max={100} onChange={(v) => setField("whites", v)} format={signFmt} />
            <Slider label="Blacks" value={adj.blacks} min={-100} max={100} onChange={(v) => setField("blacks", v)} format={signFmt} />
          </Panel>

          {/* Tone Curves */}
          <Panel title="Tone Curves" defaultOpen={false}>
            <CurveEditor curves={curves} onChange={(c) => { setCurves(c); setActiveRecipe(null); }} />
          </Panel>

          {/* Color */}
          <Panel title="Color" defaultOpen={false}>
            <Slider label="Temperature" value={adj.temperature} min={-100} max={100} onChange={(v) => setField("temperature", v)} format={signFmt} />
            <Slider label="Tint" value={adj.tint} min={-100} max={100} onChange={(v) => setField("tint", v)} format={signFmt} />
            <Slider label="Vibrance" value={adj.vibrance} min={-100} max={100} onChange={(v) => setField("vibrance", v)} format={signFmt} />
            <Slider label="Saturation" value={adj.saturation} min={-100} max={100} onChange={(v) => setField("saturation", v)} format={signFmt} />
          </Panel>

          {/* Fuji Look */}
          <Panel title="Fuji Look" defaultOpen={false}>
            <Slider label="Highlight Rolloff" value={adj.highlightRolloff} min={0} max={100} onChange={(v) => setField("highlightRolloff", v)} format={pctFmt} />
            <Slider label="Color Chrome" value={adj.colorChrome} min={0} max={100} onChange={(v) => setField("colorChrome", v)} format={pctFmt} />
            <Slider label="Color Chrome FX Blue" value={adj.colorChromeFxBlue} min={0} max={100} onChange={(v) => setField("colorChromeFxBlue", v)} format={pctFmt} />
            <Slider label="Fade" value={adj.fade} min={0} max={100} onChange={(v) => setField("fade", v)} format={pctFmt} />
          </Panel>

          {/* Effects */}
          <Panel title="Effects" defaultOpen={false}>
            <Slider label="Grain Amount" value={adj.grain} min={0} max={100} onChange={(v) => setField("grain", v)} format={pctFmt} />
            <Slider label="Grain Size" value={adj.grainSize} min={0} max={100} defaultValue={30} onChange={(v) => setField("grainSize", v)} format={(v) => v < 33 ? "Fine" : v < 66 ? "Medium" : "Coarse"} />
            <Slider label="Vignette" value={adj.vignette} min={0} max={100} onChange={(v) => setField("vignette", v)} format={pctFmt} />
          </Panel>

          {/* Reset / New Image */}
          <div style={{ padding: "12px 16px", display: "flex", gap: 6 }}>
            <button
              onClick={() => { setAdj(DEFAULT_ADJ); setCurves(DEFAULT_CURVES); setActivePreset("original"); setActiveRecipe(null); }}
              style={{ flex: 1, padding: "7px 0", fontSize: 10, fontFamily: "inherit", background: "#1a1a1a", color: "#777", border: "1px solid #2a2a2a", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}
            >
              Reset All
            </button>
            {imageLoaded && (
              <button
                onClick={() => { setImageLoaded(false); originalDataRef.current = null; setAdj(DEFAULT_ADJ); setCurves(DEFAULT_CURVES); setActivePreset("original"); setActiveRecipe(null); }}
                style={{ flex: 1, padding: "7px 0", fontSize: 10, fontFamily: "inherit", background: "#1a1a1a", color: "#777", border: "1px solid #2a2a2a", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                New Image
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
