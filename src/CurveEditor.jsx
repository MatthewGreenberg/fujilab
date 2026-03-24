import { useState, useRef, useCallback, useEffect, useMemo } from "react";

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function buildCurveLUT(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const n = sorted.length;
  const lut = new Uint8Array(256);

  if (n < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }

  if (n === 2) {
    const [x0, y0] = sorted[0], [x1, y1] = sorted[1];
    for (let x = 0; x < 256; x++) {
      if (x <= x0) lut[x] = clampByte(y0);
      else if (x >= x1) lut[x] = clampByte(y1);
      else lut[x] = clampByte(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    }
    return lut;
  }

  const xs = sorted.map((p) => p[0]), ys = sorted.map((p) => p[1]);
  const dxs = [], dys = [], ms = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    dxs.push(dx); dys.push(ys[i + 1] - ys[i]);
    ms.push(dx !== 0 ? dys[i] / dx : 0);
  }
  const c1s = [ms[0]];
  for (let i = 0; i < ms.length - 1; i++) {
    if (ms[i] * ms[i + 1] <= 0) c1s.push(0);
    else { const common = dxs[i] + dxs[i + 1]; c1s.push((3 * common) / ((common + dxs[i + 1]) / ms[i] + (common + dxs[i]) / ms[i + 1])); }
  }
  c1s.push(ms[ms.length - 1]);

  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) lut[x] = clampByte(ys[0]);
    else if (x >= xs[n - 1]) lut[x] = clampByte(ys[n - 1]);
    else {
      let seg = 0;
      for (let j = 0; j < n - 1; j++) { if (x < xs[j + 1]) { seg = j; break; } }
      const h = dxs[seg], t = (x - xs[seg]) / h, t2 = t * t, t3 = t2 * t;
      lut[x] = clampByte(
        (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * c1s[seg] +
        (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * c1s[seg + 1]
      );
    }
  }
  return lut;
}

const CHANNELS = [
  { key: "rgb", label: "RGB", color: "#aaaaaa" },
  { key: "r", label: "R", color: "#ff6b6b" },
  { key: "g", label: "G", color: "#51cf66" },
  { key: "b", label: "B", color: "#5c7cfa" },
];

function sCurvePoints(intensity) {
  const t = intensity / 100;
  return [[0, 0], [64, Math.round(64 - 20 * t)], [192, Math.round(192 + 20 * t)], [255, 255]];
}

const SIZE = 256;
const PAD = 1; // 1px canvas padding so edge points aren't clipped
const HIT = 24; // hit radius in canvas pixels for grabbing points

export default function CurveEditor({ curves, onChange }) {
  const [channel, setChannel] = useState("rgb");
  const [dragIdx, setDragIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  const points = curves[channel];
  const channelInfo = CHANNELS.find((c) => c.key === channel);
  const sorted = useMemo(() => [...points].sort((a, b) => a[0] - b[0]), [points]);
  const lut = useMemo(() => buildCurveLUT(points), [points]);

  // ── Canvas drawing ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const toX = (v) => PAD + (v / 255) * (w - PAD * 2);
    const toY = (v) => (h - PAD) - (v / 255) * (h - PAD * 2);

    const cc = channelInfo.color;
    // Parse channel color for alpha variants
    const ccRGB = cc.startsWith("#") ? [
      parseInt(cc.slice(1, 3), 16), parseInt(cc.slice(3, 5), 16), parseInt(cc.slice(5, 7), 16)
    ] : [170, 170, 170];

    // Background with subtle vignette
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.75);
    bgGrad.addColorStop(0, "#181818");
    bgGrad.addColorStop(1, "#101010");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Zone labels (shadows / midtones / highlights) — very subtle
    ctx.fillStyle = "#1a1a1a";
    ctx.font = `${8 * (w / 256)}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("SHADOWS", toX(48), h - 4);
    ctx.fillText("MIDS", toX(128), h - 4);
    ctx.fillText("HIGHS", toX(208), h - 4);

    // Grid — dotted, very subtle
    ctx.strokeStyle = "#1f1f1f";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([1, 3]);
    for (const frac of [0.25, 0.5, 0.75]) {
      const gx = toX(frac * 255), gy = toY(frac * 255);
      ctx.beginPath(); ctx.moveTo(gx, PAD); ctx.lineTo(gx, h - PAD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(w - PAD, gy); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Diagonal reference — very faint
    ctx.strokeStyle = "#252525";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(toX(0), toY(0)); ctx.lineTo(toX(255), toY(255)); ctx.stroke();

    // Fill under curve with gradient
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0)); // bottom-left corner (0,0 in curve space = bottom-left)
    ctx.moveTo(toX(0), toY(lut[0]));
    for (let x = 1; x < 256; x++) ctx.lineTo(toX(x), toY(lut[x]));
    ctx.lineTo(toX(255), toY(0)); // bottom-right corner
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, `rgba(${ccRGB[0]},${ccRGB[1]},${ccRGB[2]},0.06)`);
    fillGrad.addColorStop(1, `rgba(${ccRGB[0]},${ccRGB[1]},${ccRGB[2]},0.01)`);
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Curve line — with glow
    ctx.shadowColor = `rgba(${ccRGB[0]},${ccRGB[1]},${ccRGB[2]},0.4)`;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = cc;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(lut[0]));
    for (let x = 1; x < 256; x++) ctx.lineTo(toX(x), toY(lut[x]));
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    // Control points
    for (let i = 0; i < sorted.length; i++) {
      const px = toX(sorted[i][0]), py = toY(sorted[i][1]);
      const isActive = i === dragIdx;
      const isHover = i === hoverIdx;

      // Outer glow ring
      if (isActive || isHover) {
        const glowR = isActive ? 20 : 16;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        grad.addColorStop(0, `rgba(${ccRGB[0]},${ccRGB[1]},${ccRGB[2]},${isActive ? 0.3 : 0.18})`);
        grad.addColorStop(1, "transparent");
        ctx.beginPath(); ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
      }

      // Point — filled circle with border
      const r = isActive ? 9 : isHover ? 8 : 6;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = cc;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner highlight dot for depth
      ctx.beginPath(); ctx.arc(px - r * 0.2, py - r * 0.2, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,0.3)`;
      ctx.fill();
    }
  }, [sorted, lut, channelInfo, dragIdx, hoverIdx]);

  // Redraw on any change using rAF
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw]);

  // ── Coordinate conversion ──
  const toCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const w = rect.width, h = rect.height;
    const x = Math.round(((clientX - rect.left - PAD) / (w - PAD * 2)) * 255);
    const y = Math.round((1 - (clientY - rect.top - PAD) / (h - PAD * 2)) * 255);
    return [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))];
  }, []);

  const hitTest = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const w = rect.width, h = rect.height;
    const mx = clientX - rect.left, my = clientY - rect.top;

    let closest = -1, closestDist = HIT;
    const s = [...points].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < s.length; i++) {
      const px = PAD + (s[i][0] / 255) * (w - PAD * 2);
      const py = (h - PAD) - (s[i][1] / 255) * (h - PAD * 2);
      const d = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
      if (d < closestDist) { closest = i; closestDist = d; }
    }
    return closest;
  }, [points]);

  // ── Pointer events ──
  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    const idx = hitTest(e);
    if (idx >= 0) {
      setDragIdx(idx);
    } else {
      // Add new point
      const [x, y] = toCoords(e);
      const s = [...points].sort((a, b) => a[0] - b[0]);
      for (const p of s) { if (Math.abs(p[0] - x) < 10) return; }
      const newPts = [...s, [x, y]].sort((a, b) => a[0] - b[0]);
      onChange({ ...curves, [channel]: newPts });
      // Start dragging the new point
      const newIdx = newPts.findIndex((p) => p[0] === x && p[1] === y);
      if (newIdx >= 0) setDragIdx(newIdx);
    }
  }, [hitTest, toCoords, points, curves, channel, onChange]);

  const handlePointerMove = useCallback((e) => {
    if (dragIdx < 0) {
      setHoverIdx(hitTest(e));
      return;
    }
  }, [dragIdx, hitTest]);

  // Global drag
  useEffect(() => {
    if (dragIdx < 0) return;
    const s = [...points].sort((a, b) => a[0] - b[0]);
    const isFirst = dragIdx === 0, isLast = dragIdx === s.length - 1;

    const onMove = (e) => {
      e.preventDefault();
      const [mx, my] = toCoords(e);
      const newPts = [...s];
      if (isFirst) newPts[0] = [0, my];
      else if (isLast) newPts[dragIdx] = [255, my];
      else {
        const minX = s[dragIdx - 1][0] + 1, maxX = s[dragIdx + 1][0] - 1;
        newPts[dragIdx] = [Math.max(minX, Math.min(maxX, mx)), my];
      }
      onChange({ ...curves, [channel]: newPts });
    };
    const onUp = () => setDragIdx(-1);

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
  }, [dragIdx, points, curves, channel, onChange, toCoords]);

  const handleDoubleClick = useCallback((e) => {
    const idx = hitTest(e);
    if (idx < 0) return;
    const s = [...points].sort((a, b) => a[0] - b[0]);
    if (idx === 0 || idx === s.length - 1) return;
    onChange({ ...curves, [channel]: s.filter((_, i) => i !== idx) });
  }, [hitTest, points, curves, channel, onChange]);

  const handleReset = () => onChange({ ...curves, [channel]: [[0, 0], [255, 255]] });

  // S-Curve intensity detection
  const sCurveIntensity = useMemo(() => {
    if (sorted.length !== 4) return null;
    if (sorted[0][0] !== 0 || sorted[3][0] !== 255) return null;
    if (Math.abs(sorted[1][0] - 64) > 10 || Math.abs(sorted[2][0] - 192) > 10) return null;
    const dip = 64 - sorted[1][1];
    if (dip < 0) return null;
    return Math.min(100, Math.round((dip / 20) * 100));
  }, [sorted]);

  const handleSCurveSlider = (e) => {
    onChange({ ...curves, [channel]: sCurvePoints(Number(e.target.value)) });
  };

  return (
    <div>
      {/* Channel tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 10 }}>
        {CHANNELS.map((ch) => (
          <button
            key={ch.key}
            onClick={() => setChannel(ch.key)}
            style={{
              flex: 1, padding: "4px 0", fontSize: 10,
              fontWeight: channel === ch.key ? 600 : 400, fontFamily: "inherit",
              background: channel === ch.key ? "#2a2a2a" : "transparent",
              color: channel === ch.key ? ch.color : "#555",
              border: `1px solid ${channel === ch.key ? "#3a3a3a" : "#252525"}`,
              borderRadius: 4, cursor: "pointer", letterSpacing: "0.03em",
            }}
          >
            {ch.label}
          </button>
        ))}
      </div>

      {/* Canvas curve editor */}
      <canvas
        ref={canvasRef}
        style={{
          width: "100%", aspectRatio: "1", borderRadius: 6, display: "block",
          border: "1px solid #252525", touchAction: "none",
          cursor: hoverIdx >= 0 || dragIdx >= 0 ? "grab" : "crosshair",
        }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setHoverIdx(-1)}
        onTouchStart={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      />

      {/* S-Curve slider */}
      <div style={{ marginTop: 10, marginBottom: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 11, color: "#999" }}>S-Curve</span>
          <span style={{ fontSize: 11, color: "#666", fontVariantNumeric: "tabular-nums" }}>
            {sCurveIntensity != null ? `${sCurveIntensity}%` : "custom"}
          </span>
        </div>
        <input
          type="range" min={0} max={100}
          value={sCurveIntensity != null ? sCurveIntensity : 0}
          onChange={handleSCurveSlider}
          style={{ width: "100%", accentColor: "#666", height: 2 }}
        />
      </div>

      <button onClick={handleReset} style={{
        width: "100%", padding: "5px 0", fontSize: 10, fontFamily: "inherit",
        background: "#1a1a1a", color: "#777", border: "1px solid #2a2a2a",
        borderRadius: 4, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em",
      }}>Reset</button>
    </div>
  );
}
