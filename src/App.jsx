import { useState, useRef, useCallback, useEffect } from "react";
import { parse3DL, parseCube } from "./lut";
import CurveEditor, { buildCurveLUT } from "./CurveEditor";
import { createRenderer, isWebGL2Supported } from "./gpu/renderer";
import { parseRecipe } from "./recipeParser";
import { RECIPES, RECIPE_CATEGORIES } from "./recipes";


const BUNDLED_LUTS = [
  "Fuji XTrans III - Acros.3dl",
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

/* ── Collapsible recipe category ── */
function RecipeCategory({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 9, fontWeight: 600, color: "#555", textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: open ? 4 : 0, cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "4px 0", userSelect: "none",
        }}
      >
        {label}
        <span style={{ fontSize: 7, color: "#444", transition: "transform 0.15s", transform: open ? "rotate(0)" : "rotate(-90deg)" }}>&#9660;</span>
      </div>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>}
    </div>
  );
}

// ── Bottom sheet snap points ──
const SHEET_SNAPS = [
  80,
  () => Math.round(window.innerHeight * 0.50),
  () => Math.round(window.innerHeight * 0.82),
];
const sheetSnapPx = (i) => typeof SHEET_SNAPS[i] === 'function' ? SHEET_SNAPS[i]() : SHEET_SNAPS[i];
const nearestSheetSnap = (px) => {
  let closest = 1, minDist = Infinity;
  for (let i = 0; i < SHEET_SNAPS.length; i++) {
    const d = Math.abs(sheetSnapPx(i) - px);
    if (d < minDist) { minDist = d; closest = i; }
  }
  return closest;
};

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
  const [sheetDragging, setSheetDragging] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("jpeg");
  const [exportQuality, setExportQuality] = useState(92);
  const [exportFullRes, setExportFullRes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // ── SAM subject selection (multi-layer) ──
  const [samActive, setSamActive] = useState(false);
  // 'idle' | 'loading' | 'encoding' | 'ready' | 'segmenting'
  const [samStatus, setSamStatus] = useState("idle");
  // Each layer: { id, mask: {data,width,height}, preset: 'original', adj: {...} }
  const [samLayers, setSamLayers] = useState([]);
  const [activeLayerIdx, setActiveLayerIdx] = useState(0);
  const [samAddingLayer, setSamAddingLayer] = useState(false);

  const canvasRef = useRef(null);
  const gpuRef = useRef(null);
  const originalDataRef = useRef(null);
  const sourceBlobRef = useRef(null);  // original file blob for full-res re-decode
  const dimsRef = useRef({ w: 0, h: 0 });
  const fileRef = useRef(null);
  const lutFileRef = useRef(null);
  const wrapperRef = useRef(null);
  const lastLutKeyRef = useRef(null);
  const sidebarRef = useRef(null);
  const headerRef = useRef(null);
  const sheetDragRef = useRef({ startY: 0, startH: 0 });
  const splitRef = useRef(null);
  const overlayCanvasRef = useRef(null);

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

  const handlePasteRecipe = useCallback(() => {
    if (!pasteText.trim()) return;
    const result = parseRecipe(pasteText);
    setPasteWarnings(result.warnings);
    const recipe = {
      name: "Pasted Recipe",
      filmSim: result.filmSim || "original",
      adj: result.adj,
    };
    applyRecipe(recipe);
    setPasteText("");
    if (result.warnings.length === 0) {
      setPasteModalOpen(false);
    }
    // warnings stay visible so user can see approximations
  }, [pasteText, applyRecipe]);

  /* ── Shareable recipe links ── */
  const encodeRecipeToURL = useCallback(() => {
    // Encode only non-default adj values + preset to keep URLs short
    const params = new URLSearchParams();
    if (activePreset !== "original") params.set("sim", activePreset);
    for (const [key, val] of Object.entries(adj)) {
      if (val !== DEFAULT_ADJ[key]) params.set(key, val);
    }
    // Encode curves if non-default
    const curvesChanged = JSON.stringify(curves) !== JSON.stringify(DEFAULT_CURVES);
    if (curvesChanged) params.set("curves", btoa(JSON.stringify(curves)));
    if (activeRecipe) params.set("name", activeRecipe);
    return `${window.location.origin}${window.location.pathname}#${params.toString()}`;
  }, [activePreset, adj, curves, activeRecipe]);

  const shareRecipeLink = useCallback(async () => {
    const url = encodeRecipeToURL();
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Fallback: select in a temporary input
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }, [encodeRecipeToURL]);

  // Read recipe from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    try {
      const params = new URLSearchParams(hash);
      const newAdj = { ...DEFAULT_ADJ };
      let preset = "original";
      let recipeName = null;
      let newCurves = DEFAULT_CURVES;

      if (params.has("sim")) preset = params.get("sim");
      if (params.has("name")) recipeName = params.get("name");
      if (params.has("curves")) {
        try { newCurves = JSON.parse(atob(params.get("curves"))); } catch { /* ignore malformed curves */ }
      }

      for (const [key, val] of params.entries()) {
        if (key === "sim" || key === "name" || key === "curves") continue;
        if (key in DEFAULT_ADJ) {
          newAdj[key] = Number(val);
        }
      }

      setActivePreset(preset);
      setAdj(newAdj);
      setCurves(newCurves);
      setActiveRecipe(recipeName || "Shared Recipe");
      // Clean up URL without reload
      window.history.replaceState(null, "", window.location.pathname);
    } catch { /* ignore malformed URL hash */ }
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

  /* ── Initialize GPU renderer when canvas mounts ── */
  const canvasCallbackRef = useCallback((canvas) => {
    canvasRef.current = canvas;
    if (!canvas) {
      // Canvas unmounted (e.g. "New Image") — destroy renderer
      if (gpuRef.current) { gpuRef.current.destroy(); gpuRef.current = null; }
      lastLutKeyRef.current = null;
      return;
    }
    if (!gpuRef.current && isWebGL2Supported()) {
      try {
        gpuRef.current = createRenderer(canvas);
        // If image was loaded before canvas mounted, upload it now
        const od = originalDataRef.current;
        if (od) {
          const { w, h } = dimsRef.current;
          gpuRef.current.uploadImage(od, w, h);
        }
      } catch (err) {
        console.warn("WebGL 2 init failed, will not render:", err);
      }
    }
  }, []);

  /* ── Build per-channel curve LUTs (cheap, stays on CPU) ── */
  const buildCurveTables = useCallback(() => {
    const { exposure, contrast, whites, blacks, highlightRolloff, fade } = adj;
    const rgbCurve = buildCurveLUT(curves.rgb);
    const rCurve = buildCurveLUT(curves.r);
    const gCurve = buildCurveLUT(curves.g);
    const bCurve = buildCurveLUT(curves.b);

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
        v *= expMul;
        v = 0.5 + (v - 0.5) * contrastF;
        if (rolloff > 0 && v > 0.5) {
          const threshold = 1 - rolloff * 0.5;
          if (v > threshold) {
            const excess = v - threshold;
            const softness = rolloff * 0.4;
            v = threshold + softness * (1 - Math.exp(-excess / softness));
          }
        }
        v += wt * 0.4 * v * v;
        v += bt * 0.4 * (1 - v) * (1 - v);
        if (fadeAmt > 0) v = fadeAmt + v * (1 - fadeAmt);
        v = Math.max(0, Math.min(1, v));
        const idx = Math.max(0, Math.min(255, Math.round(v * 255)));
        table[i] = chanCurve[rgbCurve[idx]];
      }
      return table;
    };

    return { r: buildTable(rCurve), g: buildTable(gCurve), b: buildTable(bCurve) };
  }, [adj, curves]);

  const LAYER_COLORS = [[0,210,255],[255,100,200],[255,210,0],[100,255,150]];

  /* ── SAM: convert image to JPEG data URI for API ── */
  const getImageDataUri = useCallback(() => {
    if (!originalDataRef.current) return null;
    const { w, h } = dimsRef.current;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").putImageData(originalDataRef.current, 0, 0);
    return c.toDataURL("image/jpeg", 0.85);
  }, []);

  /* ── SAM: decode mask PNG from Replicate into binary mask array ── */
  const decodeMaskFromUrl = useCallback((url) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, img.width, img.height).data;
        const mask = new Uint8Array(img.width * img.height);
        for (let i = 0; i < mask.length; i++) {
          mask[i] = px[i * 4] > 128 ? 1 : 0;
        }
        resolve({ data: Array.from(mask), width: img.width, height: img.height });
      };
      img.onerror = () => reject(new Error("Failed to load mask image"));
      img.src = url;
    });
  }, []);

  /* ── SAM: call Replicate API — returns all individual masks ── */
  const callSamAPI = useCallback(async () => {
    const image = getImageDataUri();
    if (!image) throw new Error("No image loaded");

    const resp = await fetch("/api/sam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    let result = await resp.json();

    // Poll if not yet complete
    while (result.status && result.status !== "succeeded" && result.status !== "failed") {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await fetch(`/api/sam?pollUrl=${encodeURIComponent(result.pollUrl)}`);
      result = await poll.json();
    }

    if (result.status === "failed" || result.error) {
      throw new Error(result.error || "SAM prediction failed");
    }

    const { individual_masks } = result.output || {};
    if (!individual_masks?.length) throw new Error("No masks in API response");

    // Decode all masks, filter by coverage (keep subject-sized ones)
    const decoded = await Promise.all(individual_masks.map((url) => decodeMaskFromUrl(url)));
    return decoded.filter((m) => {
      const coverage = m.data.reduce((s, v) => s + v, 0) / m.data.length;
      return coverage > 0.01 && coverage < 0.6;
    }).sort((a, b) => {
      // Sort by size descending — biggest subject first
      const ca = a.data.reduce((s, v) => s + v, 0);
      const cb = b.data.reduce((s, v) => s + v, 0);
      return cb - ca;
    });
  }, [getImageDataUri, decodeMaskFromUrl]);

  /* ── SAM: activate / deactivate ── */
  const samMasksRef = useRef([]); // all decoded masks from API
  const activateSAM = useCallback(async () => {
    setSamActive(true);
    setSamStatus("segmenting");
    try {
      const masks = await callSamAPI();
      samMasksRef.current = masks;

      // Auto-create first layer from the largest subject mask
      if (masks.length > 0) {
        const layer = { id: Date.now(), mask: masks[0], preset: "original", adj: { ...DEFAULT_ADJ } };
        setSamLayers([layer]);
        setActiveLayerIdx(0);
      }
      setSamStatus("ready");
    } catch (err) {
      console.error("SAM API error:", err.message);
      setSamStatus("ready");
    }
  }, [callSamAPI]);

  const deactivateSAM = useCallback(() => {
    setSamActive(false);
    setSamLayers([]);
    setActiveLayerIdx(0);
    setSamStatus("idle");
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }
  }, []);

  /* ── SAM: render all subject layers onto overlay canvas ── */
  const renderSubjectOverlay = useCallback(() => {
    if (!samLayers.length || !originalDataRef.current || !overlayCanvasRef.current) return;
    const { w, h } = dimsRef.current;

    // Create one offscreen renderer, reuse for all layers
    const offCanvas = document.createElement("canvas");
    offCanvas.width = w;
    offCanvas.height = h;
    let gpu;
    try { gpu = createRenderer(offCanvas); } catch { return; }
    gpu.uploadImage(originalDataRef.current, w, h);
    const identity = Array.from({ length: 256 }, (_, i) => i);

    // Render each layer and collect pixels
    const layerPixels = samLayers.map((layer) => {
      const lut = luts[layer.preset];
      if (lut) gpu.uploadLUT(lut.data, lut.size);
      gpu.uploadCurveLUTs(identity, identity, identity);

      const { intensity, highlights, shadows, temperature, tint, vibrance,
              saturation, colorChrome, colorChromeFxBlue, grain, grainSize } = layer.adj;
      gpu.render({
        lutSize: lut ? lut.size : 0, hasLut: !!lut,
        intensity: intensity / 100, highlights, shadows, temperature, tint, saturation, vibrance,
        colorChrome: colorChrome / 100, colorChromeFxBlue: colorChromeFxBlue / 100,
        vignette: 0,
        grain: grain / 100, grainAmp: 35 + (grainSize / 100) * 35,
        grainCellSize: 0.4 + (grainSize / 100) * 0.6,
        splitView: false, splitPos: 50,
      });
      return gpu.readPixels();
    });
    gpu.destroy();

    // Build combined mask (union of all layers) for dimming
    const combined = new Uint8Array(w * h);
    for (const layer of samLayers) {
      const md = layer.mask.data;
      for (let i = 0; i < w * h; i++) if (md[i]) combined[i] = 1;
    }

    // Composite onto overlay canvas
    const overlayCanvas = overlayCanvasRef.current;
    overlayCanvas.width = w;
    overlayCanvas.height = h;
    const ctx = overlayCanvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    // 1. Dim non-selected background
    const dimData = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      if (!combined[i]) dimData.data[i * 4 + 3] = 100;
    }
    ctx.putImageData(dimData, 0, 0);

    // 2. Composite each layer's pixels (last layer wins on overlap)
    const comp = ctx.createImageData(w, h);
    for (let li = 0; li < samLayers.length; li++) {
      const md = samLayers[li].mask.data;
      const px = layerPixels[li].data;
      for (let i = 0; i < w * h; i++) {
        if (md[i]) {
          const pi = i * 4;
          comp.data[pi] = px[pi];
          comp.data[pi + 1] = px[pi + 1];
          comp.data[pi + 2] = px[pi + 2];
          comp.data[pi + 3] = 255;
        }
      }
    }
    ctx.putImageData(comp, 0, 0);

    // 3. Edge outlines per layer (different color per layer)
    const edgeData = ctx.createImageData(w, h);
    samLayers.forEach((layer, li) => {
      const md = layer.mask.data;
      const [cr, cg, cb] = LAYER_COLORS[li % LAYER_COLORS.length];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (!md[idx]) continue;
          let onEdge = false;
          for (let dy = -2; dy <= 2 && !onEdge; dy++) {
            for (let dx = -2; dx <= 2 && !onEdge; dx++) {
              if (dx === 0 && dy === 0) continue;
              const ny = y + dy, nx = x + dx;
              if (ny < 0 || ny >= h || nx < 0 || nx >= w || !md[ny * w + nx]) onEdge = true;
            }
          }
          if (onEdge) {
            const pi = idx * 4;
            edgeData.data[pi] = cr;
            edgeData.data[pi + 1] = cg;
            edgeData.data[pi + 2] = cb;
            edgeData.data[pi + 3] = 220;
          }
        }
      }
    });

    const edgeCanvas = document.createElement("canvas");
    edgeCanvas.width = w;
    edgeCanvas.height = h;
    const edgeCtx = edgeCanvas.getContext("2d");
    edgeCtx.putImageData(edgeData, 0, 0);
    ctx.save();
    ctx.filter = "blur(4px)";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(edgeCanvas, 0, 0);
    ctx.restore();
    ctx.drawImage(edgeCanvas, 0, 0);
  }, [samLayers, luts, LAYER_COLORS]);

  useEffect(() => {
    if (samLayers.length) renderSubjectOverlay();
  }, [samLayers, renderSubjectOverlay]);

  /* ── SAM: handle click — find best pre-computed mask at click point ── */
  const handleSamClick = useCallback((e) => {
    if (!samActive || samStatus !== "ready") return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.round((e.clientX - rect.left) / rect.width * dimsRef.current.w);
    const clickY = Math.round((e.clientY - rect.top) / rect.height * dimsRef.current.h);

    const masks = samMasksRef.current;
    if (!masks.length) return;

    // Precompute mask sizes (cached on first click)
    if (!masks[0]._size) {
      for (const m of masks) m._size = m.data.reduce((s, v) => s + v, 0);
    }

    // Find the smallest mask that contains the clicked point
    let best = null;
    let bestSize = Infinity;
    for (const m of masks) {
      const mx = Math.min(m.width - 1, Math.max(0, Math.round(clickX / dimsRef.current.w * m.width)));
      const my = Math.min(m.height - 1, Math.max(0, Math.round(clickY / dimsRef.current.h * m.height)));
      const idx = my * m.width + mx;
      if (m.data[idx] && m._size < bestSize) {
        best = m;
        bestSize = m._size;
      }
    }

    // Fallback: if no mask at exact pixel, search a radius around the click
    if (!best) {
      const searchRadius = 20;
      for (const m of masks) {
        const sx = clickX / dimsRef.current.w * m.width;
        const sy = clickY / dimsRef.current.h * m.height;
        for (let dy = -searchRadius; dy <= searchRadius && !best; dy += 4) {
          for (let dx = -searchRadius; dx <= searchRadius && !best; dx += 4) {
            const px = Math.min(m.width - 1, Math.max(0, Math.round(sx + dx)));
            const py = Math.min(m.height - 1, Math.max(0, Math.round(sy + dy)));
            if (m.data[py * m.width + px] && m._size < bestSize) {
              best = m;
              bestSize = m._size;
            }
          }
        }
      }
    }

    if (!best) return;

    // Deep copy the mask to ensure React detects the change
    const maskCopy = { data: [...best.data], width: best.width, height: best.height };

    setSamLayers((prev) => {
      if (prev.length === 0 || samAddingLayer) {
        const layer = { id: Date.now(), mask: maskCopy, preset: "original", adj: { ...DEFAULT_ADJ } };
        const next = [...prev, layer];
        setActiveLayerIdx(next.length - 1);
        setSamAddingLayer(false);
        return next;
      }
      return prev.map((l, i) => i === activeLayerIdx ? { ...l, mask: maskCopy } : l);
    });
  }, [samActive, samStatus, samAddingLayer, activeLayerIdx]);

  /* ── GPU render pass ── */
  const processImage = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu || !originalDataRef.current) return;

    const { intensity, highlights, shadows, temperature, tint, vibrance, saturation, colorChrome, colorChromeFxBlue, vignette, grain, grainSize } = adj;
    const lut = luts[activePreset];

    // Upload 3D LUT if preset changed
    if (activePreset !== lastLutKeyRef.current) {
      if (lut) {
        gpu.uploadLUT(lut.data, lut.size);
      }
      lastLutKeyRef.current = activePreset;
    }

    // Build and upload per-channel curve LUTs
    const tables = buildCurveTables();
    gpu.uploadCurveLUTs(tables.r, tables.g, tables.b);

    // Render
    gpu.render({
      lutSize: lut ? lut.size : 0,
      hasLut: !!lut,
      intensity: intensity / 100,
      highlights,
      shadows,
      temperature,
      tint,
      saturation,
      vibrance,
      colorChrome: colorChrome / 100,
      colorChromeFxBlue: colorChromeFxBlue / 100,
      vignette: vignette / 100,
      grain: grain / 100,
      grainAmp: 35 + (grainSize / 100) * 35,
      grainCellSize: 0.4 + (grainSize / 100) * 0.6,
      splitView,
      splitPos,
    });
  }, [adj, activePreset, luts, curves, splitView, splitPos, buildCurveTables]);

  useEffect(() => {
    if (imageLoaded) processImage();
  }, [imageLoaded, processImage]);

  /* ── Load an image onto the canvas and GPU ── */
  const loadImageFromBlob = useCallback((blob) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxW = Math.min(1400, img.naturalWidth);
      const scale = maxW / img.naturalWidth;
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      dimsRef.current = { w, h };
      const offscreen = document.createElement("canvas");
      offscreen.width = w; offscreen.height = h;
      const octx = offscreen.getContext("2d");
      octx.drawImage(img, 0, 0, w, h);
      const imageData = octx.getImageData(0, 0, w, h);
      originalDataRef.current = imageData;
      lastLutKeyRef.current = null;
      if (gpuRef.current) gpuRef.current.uploadImage(imageData, w, h);
      setSplitView(false);
      setAdj(prev => ({ ...prev })); // invalidate processImage so effect re-fires with new image
      setImageLoaded(true);
      setProcessing(false);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setProcessing(false); };
    img.src = url;
  }, []);

  /* ── Load sample image on demand ── */
  const loadSampleImage = useCallback(() => {
    fetch("/boat.jpeg")
      .then((r) => r.ok ? r.blob() : null)
      .then((blob) => { if (blob) loadImageFromBlob(blob); })
      .catch(() => {}); // sample image missing — fine
  }, [loadImageFromBlob]);

  /* ── File loading ── */
  const loadImageFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setProcessing(true);
    sourceBlobRef.current = file;
    loadImageFromBlob(file);
  }, [loadImageFromBlob]);

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

  const doExport = async () => {
    if (!canvasRef.current) return;
    setExporting(true);
    try {
      let exportCanvas = canvasRef.current;

      // Full-res export: re-decode source at native resolution, render in offscreen GPU
      if (exportFullRes && sourceBlobRef.current) {
        const blob = sourceBlobRef.current;
        let fullImageData, fw, fh;

        const url = URL.createObjectURL(blob);
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
          i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load")); };
          i.src = url;
        });
        fw = img.naturalWidth; fh = img.naturalHeight;
        const oc = document.createElement("canvas");
        oc.width = fw; oc.height = fh;
        oc.getContext("2d").drawImage(img, 0, 0);
        fullImageData = oc.getContext("2d").getImageData(0, 0, fw, fh);

        // Render at full res in an offscreen canvas
        const offCanvas = document.createElement("canvas");
        offCanvas.width = fw; offCanvas.height = fh;
        const offGpu = createRenderer(offCanvas);
        offGpu.uploadImage(fullImageData, fw, fh);
        const lut = luts[activePreset];
        if (lut) offGpu.uploadLUT(lut.data, lut.size);
        const tables = buildCurveTables();
        offGpu.uploadCurveLUTs(tables.r, tables.g, tables.b);
        offGpu.render({
          lutSize: lut ? lut.size : 0, hasLut: !!lut,
          intensity: adj.intensity / 100,
          highlights: adj.highlights, shadows: adj.shadows,
          temperature: adj.temperature, tint: adj.tint,
          saturation: adj.saturation, vibrance: adj.vibrance,
          colorChrome: adj.colorChrome / 100, colorChromeFxBlue: adj.colorChromeFxBlue / 100,
          vignette: adj.vignette / 100,
          grain: adj.grain / 100, grainAmp: 35 + (adj.grainSize / 100) * 35,
          grainCellSize: 0.4 + (adj.grainSize / 100) * 0.6,
          splitView: false, splitPos: 50,
        });
        exportCanvas = offCanvas;
        // Clean up offscreen GPU after we get the blob
        setTimeout(() => offGpu.destroy(), 100);
      }

      const ext = exportFormat === "png" ? "png" : "jpg";
      const mime = exportFormat === "png" ? "image/png" : "image/jpeg";
      const filename = `fujilab_${activeRecipe || activePreset}.${ext}`;
      const blob = await new Promise((resolve) =>
        exportCanvas.toBlob(resolve, mime, exportFormat === "png" ? undefined : exportQuality / 100)
      );

      if (window.innerWidth <= 640 && navigator.share && navigator.canShare) {
        try {
          const file = new File([blob], filename, { type: mime });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            setExportModalOpen(false);
            return;
          }
        } catch (err) {
          if (err.name === "AbortError") return;
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = filename;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportModalOpen(false);
    } finally {
      setExporting(false);
    }
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
    if (!splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
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

  /* ── Mobile bottom sheet ── */
  const applySheetH = useCallback((px, animated) => {
    if (!sidebarRef.current || !wrapperRef.current) return;
    const headerH = headerRef.current?.getBoundingClientRect().height || 56;
    const vh = window.innerHeight;
    const clamped = Math.max(SHEET_SNAPS[0], Math.min(Math.round(vh * 0.88), px));
    const canvasH = Math.max(80, vh - headerH - clamped);
    const trans = animated ? 'height 0.35s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    sidebarRef.current.style.transition = trans;
    sidebarRef.current.style.height = `${clamped}px`;
    sidebarRef.current.style.flex = 'none';
    wrapperRef.current.style.transition = trans;
    wrapperRef.current.style.height = `${canvasH}px`;
    wrapperRef.current.style.flex = 'none';
  }, []);

  const handleSheetTouchStart = useCallback((e) => {
    if (window.innerWidth > 640) return;
    const sh = sidebarRef.current?.getBoundingClientRect().height ?? sheetSnapPx(1);
    sheetDragRef.current = { startY: e.touches[0].clientY, startH: sh };
    setSheetDragging(true);
  }, []);

  useEffect(() => {
    if (!sheetDragging) return;
    const onMove = (e) => {
      e.preventDefault();
      const dy = e.touches[0].clientY - sheetDragRef.current.startY;
      applySheetH(sheetDragRef.current.startH - dy, false);
    };
    const onEnd = () => {
      setSheetDragging(false);
      const curH = sidebarRef.current?.getBoundingClientRect().height ?? sheetSnapPx(1);
      applySheetH(sheetSnapPx(nearestSheetSnap(curH)), true);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [sheetDragging, applySheetH]);

  useEffect(() => {
    const init = () => {
      if (window.innerWidth <= 640) {
        applySheetH(sheetSnapPx(1), false);
      } else {
        if (sidebarRef.current) {
          sidebarRef.current.style.height = '';
          sidebarRef.current.style.flex = '';
          sidebarRef.current.style.transition = '';
        }
        if (wrapperRef.current) {
          wrapperRef.current.style.height = '';
          wrapperRef.current.style.flex = '';
          wrapperRef.current.style.transition = '';
        }
      }
    };
    init();
    window.addEventListener('resize', init);
    return () => window.removeEventListener('resize', init);
  }, [applySheetH]);

  /* ── Lightbox ── */
  const openLightbox = useCallback(() => {
    if (!canvasRef.current || !imageLoaded) return;
    setLightboxUrl(canvasRef.current.toDataURL("image/jpeg", 0.95));
  }, [imageLoaded]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e) => { if (e.key === "Escape") setLightboxUrl(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  const HIDDEN_SIMS = ["Mono+R", "Mono+Ye", "Mono+G"];
  const lutNames = Object.keys(luts);
  const visibleLutNames = lutNames.filter((n) => !HIDDEN_SIMS.includes(n));

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
      className="app-root"
      style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#111", color: "#ddd", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {/* ── Header ── */}
      <div ref={headerRef} className="app-header" style={{ borderBottom: "1px solid #1e1e1e", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", color: "#eee" }}>Fujilab</h1>
          <p style={{ margin: "1px 0 0", fontSize: 10, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase" }}>Fujifilm Film Simulations · v0.1</p>
        </div>
        <div className="header-actions" style={{ gap: 6, alignItems: "center" }}>
          <a
            href="https://github.com/MatthewGreenberg/fujilab"
            target="_blank"
            rel="noopener noreferrer"
            className="header-btn"
            style={{ display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub
          </a>
          <button onClick={() => fileRef.current?.click()} className="header-btn">
            {processing ? "Loading..." : "Load Image"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && loadImageFile(e.target.files[0])} />
          {imageLoaded && (
            <>
              <button onClick={() => setSplitView(!splitView)} className={`header-btn${splitView ? " active" : ""}`}>
                Before/After
              </button>
              <button
                onClick={samActive ? deactivateSAM : activateSAM}
                className={`header-btn sam-btn${samActive ? " active" : ""}`}
                title="Click on any subject to apply a separate film simulation"
              >
                {samStatus === "loading" || samStatus === "encoding" ? "Loading AI…" : "Select Subject"}
              </button>
              <button onClick={shareRecipeLink} className={`header-btn${shareCopied ? " success" : ""}`}>
                {shareCopied ? "Copied" : "Share"}
              </button>
              <button onClick={() => setExportModalOpen(true)} className="header-btn primary">
                Export
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="app-content" style={{ overflow: "hidden" }}>

        {/* ── Image area ── */}
        <div
          ref={wrapperRef}
          className="app-canvas-area"
          style={{ display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden", position: "relative", background: "#0d0d0d", userSelect: "none" }}
        >
          {!imageLoaded ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "40px 24px", maxWidth: 480, width: "90%" }}>
              {/* Sample image preview */}
              <div style={{ position: "relative", width: "100%", borderRadius: 10, overflow: "hidden", cursor: "pointer" }} onClick={loadSampleImage}>
                <img
                  src="/boat.jpeg"
                  alt="Sample photo"
                  style={{ width: "100%", display: "block", borderRadius: 10, opacity: 0.75, transition: "opacity 0.2s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}
                  onError={(e) => (e.currentTarget.parentElement.style.display = "none")}
                />
                <div style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 6,
                  background: "rgba(0,0,0,0.35)", borderRadius: 10,
                  pointerEvents: "none",
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", letterSpacing: "0.02em" }}>Try sample photo</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Click to load</span>
                </div>
              </div>

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                <div style={{ flex: 1, height: 1, background: "#1e1e1e" }} />
                <span style={{ fontSize: 11, color: "#333", flexShrink: 0 }}>or</span>
                <div style={{ flex: 1, height: 1, background: "#1e1e1e" }} />
              </div>

              {/* Upload button */}
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  width: "100%", border: "1px dashed #2a2a2a", borderRadius: 8,
                  padding: "18px 24px", textAlign: "center", cursor: "pointer",
                  transition: "border-color 0.2s, background 0.2s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "#111"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.background = "transparent"; }}
              >
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 4px", color: "#888" }}>Upload your photo</p>
                <p style={{ fontSize: 11, color: "#333", margin: 0 }}>JPG, PNG, WebP, HEIC</p>
              </div>
            </div>
          ) : (
            <div
              ref={splitRef}
              onClick={samActive && samStatus === "ready" ? handleSamClick : (!splitView ? openLightbox : undefined)}
              style={{
                position: "relative",
                aspectRatio: `${dimsRef.current.w} / ${dimsRef.current.h}`,
                maxWidth: "100%",
                maxHeight: "100%",
                cursor: samActive && samStatus === "ready" ? "crosshair" : splitView ? "default" : "zoom-in",
                flexShrink: 0,
              }}
            >
              <canvas ref={canvasCallbackRef} style={{ display: "block", width: "100%", height: "100%" }} />
              {/* SAM subject overlay */}
              <canvas
                ref={overlayCanvasRef}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
              />
              {/* SAM status instructions */}
              {samActive && (samStatus === "loading" || samStatus === "encoding" || samStatus === "ready" || samStatus === "segmenting") && (
                <div style={{
                  position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
                  color: "#fff", fontSize: 12, fontWeight: 500,
                  padding: "7px 14px", borderRadius: 20, pointerEvents: "none",
                  whiteSpace: "nowrap", letterSpacing: "0.01em",
                }}>
                  {samStatus === "loading" && "Downloading AI model (one time)…"}
                  {samStatus === "encoding" && "Analyzing image…"}
                  {samStatus === "ready" && !samLayers.length && "Click on your subject"}
                  {samStatus === "ready" && samLayers.length > 0 && !samAddingLayer && "Click to reselect · or Add Layer"}
                  {samStatus === "ready" && samAddingLayer && "Click on another subject"}
                  {samStatus === "segmenting" && "Selecting…"}
                </div>
              )}
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
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div ref={sidebarRef} className="app-sidebar" style={{ borderLeft: "1px solid #1e1e1e", background: "#161616", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Drag handle — shown/hidden via CSS class only (no inline display) */}
          <div
            className="sheet-handle"
            onTouchStart={handleSheetTouchStart}
            style={{ justifyContent: "center", alignItems: "center", padding: "14px 0 10px", flexShrink: 0, touchAction: "none", userSelect: "none", cursor: "ns-resize" }}
          >
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#444" }} />
          </div>

          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
          {/* Recipes */}
          <Panel title="Recipes" defaultOpen={true}>
            <button
              onClick={() => { setPasteModalOpen(true); setPasteWarnings([]); }}
              className="paste-recipe-btn"
            >
              Paste a Recipe
            </button>
            {RECIPE_CATEGORIES.map((cat, catIdx) => {
              const catRecipes = RECIPES.filter((r) => r.category === cat);
              if (catRecipes.length === 0) return null;
              const hasActive = catRecipes.some((r) => r.name === activeRecipe);
              return (
                <RecipeCategory key={cat} label={`${cat} (${catRecipes.length})`} defaultOpen={catIdx === 0 || hasActive}>
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
                        {recipe.description}
                      </div>
                    </div>
                  ))}
                </RecipeCategory>
              );
            })}
          </Panel>

          {/* ── Subject Layers (SAM) ── */}
          {samActive && samLayers.length > 0 && (
            <div className="sam-subject-panel" style={{
              margin: "8px 10px 4px",
              background: "linear-gradient(135deg, rgba(0,210,255,0.06) 0%, rgba(0,140,200,0.03) 100%)",
              border: "1px solid rgba(0,210,255,0.18)",
              borderRadius: 8,
              overflow: "hidden",
              animation: "samPanelIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            }}>
              {/* Header bar */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 12px 8px",
                borderBottom: "1px solid rgba(0,210,255,0.1)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4,
                    background: "linear-gradient(135deg, #00d2ff 0%, #0090cc 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, fontWeight: 700, color: "#000", letterSpacing: "-0.02em",
                  }}>AI</div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#ccc", letterSpacing: "0.01em" }}>Subject Layers</span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => setSamAddingLayer(true)}
                    style={{
                      padding: "3px 8px", fontSize: 9, fontWeight: 600, fontFamily: "inherit",
                      background: samAddingLayer ? "rgba(0,210,255,0.15)" : "rgba(255,255,255,0.06)",
                      color: samAddingLayer ? "#00d2ff" : "#888",
                      border: `1px solid ${samAddingLayer ? "rgba(0,210,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 4, cursor: "pointer", letterSpacing: "0.02em",
                    }}
                  >+ Add</button>
                  <button
                    onClick={() => { setSamLayers([]); setActiveLayerIdx(0); if (overlayCanvasRef.current) overlayCanvasRef.current.getContext("2d").clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height); }}
                    style={{
                      padding: "3px 8px", fontSize: 9, fontWeight: 500, fontFamily: "inherit",
                      background: "rgba(255,255,255,0.06)", color: "#888",
                      border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
                      cursor: "pointer", letterSpacing: "0.02em",
                    }}
                  >Clear All</button>
                </div>
              </div>

              {/* Layer tabs */}
              {samLayers.length > 1 && (
                <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(0,210,255,0.1)" }}>
                  {samLayers.map((layer, li) => {
                    const [cr, cg, cb] = LAYER_COLORS[li % LAYER_COLORS.length];
                    const isActive = li === activeLayerIdx;
                    return (
                      <button
                        key={layer.id}
                        onClick={() => setActiveLayerIdx(li)}
                        style={{
                          flex: 1, padding: "6px 8px", fontSize: 10, fontWeight: isActive ? 600 : 400,
                          fontFamily: "inherit", cursor: "pointer",
                          background: isActive ? `rgba(${cr},${cg},${cb},0.1)` : "transparent",
                          color: isActive ? `rgb(${cr},${cg},${cb})` : "#666",
                          border: "none", borderBottom: isActive ? `2px solid rgb(${cr},${cg},${cb})` : "2px solid transparent",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                        }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: `rgb(${cr},${cg},${cb})`, opacity: isActive ? 1 : 0.4 }} />
                        Layer {li + 1}
                        {samLayers.length > 1 && (
                          <span
                            onClick={(e) => { e.stopPropagation(); setSamLayers((prev) => { const next = prev.filter((_, i) => i !== li); if (activeLayerIdx >= next.length) setActiveLayerIdx(Math.max(0, next.length - 1)); return next; }); }}
                            style={{ fontSize: 9, color: "#555", cursor: "pointer", marginLeft: 2 }}
                          >&times;</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Active layer controls */}
              {samLayers[activeLayerIdx] && (() => {
                const layer = samLayers[activeLayerIdx];
                const setLayerField = (field, value) => {
                  setSamLayers((prev) => prev.map((l, i) => i === activeLayerIdx ? { ...l, adj: { ...l.adj, [field]: value } } : l));
                };
                const setLayerPreset = (preset) => {
                  setSamLayers((prev) => prev.map((l, i) => i === activeLayerIdx ? { ...l, preset } : l));
                };
                return (
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ fontSize: 10, color: "rgba(0,210,255,0.5)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontWeight: 500 }}>Film Simulation</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                      <button onClick={() => setLayerPreset("original")} style={presetBtn(layer.preset === "original")}>None</button>
                      {visibleLutNames.map((name) => (
                        <button key={name} onClick={() => setLayerPreset(name)} style={presetBtn(layer.preset === name)}>{name}</button>
                      ))}
                    </div>
                    <Slider label="Intensity" value={layer.adj.intensity} min={0} max={100} defaultValue={100} onChange={(v) => setLayerField("intensity", v)} format={pctFmt} />
                    <Slider label="Highlights" value={layer.adj.highlights} min={-100} max={100} onChange={(v) => setLayerField("highlights", v)} format={signFmt} />
                    <Slider label="Shadows" value={layer.adj.shadows} min={-100} max={100} onChange={(v) => setLayerField("shadows", v)} format={signFmt} />
                    <Slider label="Temperature" value={layer.adj.temperature} min={-100} max={100} onChange={(v) => setLayerField("temperature", v)} format={signFmt} />
                    <Slider label="Saturation" value={layer.adj.saturation} min={-100} max={100} onChange={(v) => setLayerField("saturation", v)} format={signFmt} />
                  </div>
                );
              })()}
            </div>
          )}

          {/* Film Simulation */}
          <Panel title={samLayers.length > 0 && samActive ? "Background Film Simulation" : "Film Simulation"}>
            {lutNames.length === 0 ? (
              <p style={{ fontSize: 11, color: "#555", margin: 0 }}>Loading LUTs...</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                <button onClick={() => { setActivePreset("original"); setAdj(DEFAULT_ADJ); setCurves(DEFAULT_CURVES); setActiveRecipe(null); }} style={presetBtn(activePreset === "original")}>
                  Original
                </button>
                {visibleLutNames.map((name) => (
                  <button key={name} onClick={() => { setActivePreset(name); setAdj(DEFAULT_ADJ); setCurves(DEFAULT_CURVES); setActiveRecipe(null); }} style={presetBtn(activePreset === name)}>
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
              className="action-btn"
            >
              Reset All
            </button>
            {imageLoaded && (
              <button
                onClick={() => { setImageLoaded(false); originalDataRef.current = null; setAdj(DEFAULT_ADJ); setCurves(DEFAULT_CURVES); setActivePreset("original"); setActiveRecipe(null); }}
                className="action-btn"
              >
                New Image
              </button>
            )}
          </div>
          </div>{/* end scrollable content */}
        </div>
      </div>

      {/* ── Paste Recipe modal ── */}
      {pasteModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setPasteModalOpen(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setPasteModalOpen(false); }}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 90vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#eee" }}>Paste Recipe</h2>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#555" }}>
                From Fuji X Weekly or any standard format
              </p>
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Film Simulation: Classic Chrome\nGrain Effect: Weak, Small\nColor Chrome Effect: Strong\nHighlight: -2\nShadow: 0\nWhite Balance: Auto, +4 Red & -2 Blue"}
              autoFocus
              style={{
                width: "100%", minHeight: 160, padding: 10,
                fontSize: 12, fontFamily: "'SF Mono', 'Menlo', monospace", lineHeight: 1.5,
                background: "#111", color: "#ccc", border: "1px solid #2a2a2a",
                borderRadius: 6, resize: "vertical",
                boxSizing: "border-box",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePasteRecipe();
                if (e.key === "Escape") setPasteModalOpen(false);
              }}
            />
            {pasteWarnings.length > 0 && (
              <div style={{ padding: "8px 10px", background: "#1c1a10", border: "1px solid #3a3520", borderRadius: 6 }}>
                {pasteWarnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#c8a84e", lineHeight: 1.5 }}>{w}</div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setPasteModalOpen(false)} className="modal-cancel">Cancel</button>
              <button onClick={handlePasteRecipe} disabled={!pasteText.trim()} className="modal-confirm">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export modal ── */}
      {exportModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setExportModalOpen(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setExportModalOpen(false); }}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(380px, 90vw)", display: "flex", flexDirection: "column", gap: 16 }}
          >
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#eee" }}>Export</h2>

            {/* Format */}
            <div>
              <div style={{ fontSize: 11, color: "#777", marginBottom: 6 }}>Format</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["jpeg", "png"].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt)}
                    className={`header-btn${exportFormat === fmt ? " active" : ""}`}
                    style={{ flex: 1, textAlign: "center", textTransform: "uppercase" }}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality (JPEG only) */}
            {exportFormat === "jpeg" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: "#777" }}>Quality</span>
                  <span style={{ fontSize: 11, color: "#555", fontVariantNumeric: "tabular-nums" }}>{exportQuality}%</span>
                </div>
                <input
                  type="range" min={50} max={100} value={exportQuality}
                  onChange={(e) => setExportQuality(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            {/* Full resolution toggle */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox" checked={exportFullRes}
                onChange={(e) => setExportFullRes(e.target.checked)}
                style={{ accentColor: "#888" }}
              />
              <div>
                <div style={{ fontSize: 11, color: "#ccc" }}>Full resolution</div>
                <div style={{ fontSize: 10, color: "#555" }}>
                  {exportFullRes ? "Native size — may take a moment" : `${dimsRef.current.w} x ${dimsRef.current.h} px`}
                </div>
              </div>
            </label>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setExportModalOpen(false)} className="modal-cancel">Cancel</button>
              <button onClick={doExport} disabled={exporting} className="modal-confirm">
                {exporting ? "Exporting..." : "Download"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox overlay ── */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.97)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img
            src={lightboxUrl}
            draggable={false}
            style={{ maxWidth: "100%", maxHeight: "100dvh", objectFit: "contain", userSelect: "none", display: "block" }}
          />
        </div>
      )}
    </div>
  );
}
