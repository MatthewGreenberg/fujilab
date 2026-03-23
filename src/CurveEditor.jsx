import { useState, useRef, useCallback, useEffect, useMemo } from "react";

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/*
  Monotone cubic spline interpolation (Fritsch-Carlson).
  Takes an array of [x, y] control points and returns a 256-entry Uint8Array LUT.
*/
export function buildCurveLUT(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const n = sorted.length;
  const lut = new Uint8Array(256);

  if (n < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  if (n === 2) {
    const [x0, y0] = sorted[0];
    const [x1, y1] = sorted[1];
    for (let x = 0; x < 256; x++) {
      if (x <= x0) lut[x] = clampByte(y0);
      else if (x >= x1) lut[x] = clampByte(y1);
      else lut[x] = clampByte(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    }
    return lut;
  }

  const xs = sorted.map((p) => p[0]);
  const ys = sorted.map((p) => p[1]);

  const dxs = [], dys = [], ms = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    dxs.push(dx);
    dys.push(ys[i + 1] - ys[i]);
    ms.push(dx !== 0 ? dys[i] / dx : 0);
  }

  const c1s = [ms[0]];
  for (let i = 0; i < ms.length - 1; i++) {
    if (ms[i] * ms[i + 1] <= 0) {
      c1s.push(0);
    } else {
      const common = dxs[i] + dxs[i + 1];
      c1s.push((3 * common) / ((common + dxs[i + 1]) / ms[i] + (common + dxs[i]) / ms[i + 1]));
    }
  }
  c1s.push(ms[ms.length - 1]);

  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) {
      lut[x] = clampByte(ys[0]);
    } else if (x >= xs[n - 1]) {
      lut[x] = clampByte(ys[n - 1]);
    } else {
      let seg = 0;
      for (let j = 0; j < n - 1; j++) {
        if (x < xs[j + 1]) { seg = j; break; }
      }
      const h = dxs[seg];
      const t = (x - xs[seg]) / h;
      const t2 = t * t, t3 = t2 * t;
      const val =
        (2 * t3 - 3 * t2 + 1) * ys[seg] +
        (t3 - 2 * t2 + t) * h * c1s[seg] +
        (-2 * t3 + 3 * t2) * ys[seg + 1] +
        (t3 - t2) * h * c1s[seg + 1];
      lut[x] = clampByte(val);
    }
  }

  return lut;
}

const CHANNELS = [
  { key: "rgb", label: "RGB", color: "#aaa" },
  { key: "r", label: "R", color: "#ff6b6b" },
  { key: "g", label: "G", color: "#51cf66" },
  { key: "b", label: "B", color: "#5c7cfa" },
];

export default function CurveEditor({ curves, onChange }) {
  const [channel, setChannel] = useState("rgb");
  const [dragIdx, setDragIdx] = useState(-1);
  const svgRef = useRef(null);

  const points = curves[channel];
  const channelInfo = CHANNELS.find((c) => c.key === channel);

  const curvePath = useMemo(() => {
    const lut = buildCurveLUT(points);
    const parts = [`M 0 ${255 - lut[0]}`];
    for (let x = 1; x < 256; x++) parts.push(`L ${x} ${255 - lut[x]}`);
    return parts.join(" ");
  }, [points]);

  const toCoords = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.round(((clientX - rect.left) / rect.width) * 255);
    const y = Math.round(255 - ((clientY - rect.top) / rect.height) * 255);
    return [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))];
  }, []);

  // Global drag handling
  useEffect(() => {
    if (dragIdx < 0) return;
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    const isFirst = dragIdx === 0;
    const isLast = dragIdx === sorted.length - 1;

    const onMove = (e) => {
      e.preventDefault();
      const [mx, my] = toCoords(e);
      const newPoints = [...sorted];
      if (isFirst) {
        newPoints[0] = [0, my];
      } else if (isLast) {
        newPoints[dragIdx] = [255, my];
      } else {
        const minX = sorted[dragIdx - 1][0] + 1;
        const maxX = sorted[dragIdx + 1][0] - 1;
        newPoints[dragIdx] = [Math.max(minX, Math.min(maxX, mx)), my];
      }
      onChange({ ...curves, [channel]: newPoints });
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

  const handleSVGClick = (e) => {
    if (e.target.closest("circle")) return;
    const [x, y] = toCoords(e);
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    for (const p of sorted) {
      if (Math.abs(p[0] - x) < 12) return;
    }
    onChange({ ...curves, [channel]: [...sorted, [x, y]].sort((a, b) => a[0] - b[0]) });
  };

  const handlePointDoubleClick = (e, idx) => {
    e.stopPropagation();
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    if (idx === 0 || idx === sorted.length - 1) return;
    onChange({ ...curves, [channel]: sorted.filter((_, i) => i !== idx) });
  };

  const handleSCurve = () => {
    onChange({ ...curves, [channel]: [[0, 0], [64, 44], [192, 212], [255, 255]] });
  };

  const handleReset = () => {
    onChange({ ...curves, [channel]: [[0, 0], [255, 255]] });
  };

  const sorted = useMemo(() => [...points].sort((a, b) => a[0] - b[0]), [points]);

  return (
    <div>
      {/* Channel tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 10 }}>
        {CHANNELS.map((ch) => (
          <button
            key={ch.key}
            onClick={() => setChannel(ch.key)}
            style={{
              flex: 1,
              padding: "4px 0",
              fontSize: 10,
              fontWeight: channel === ch.key ? 600 : 400,
              fontFamily: "inherit",
              background: channel === ch.key ? "#2a2a2a" : "transparent",
              color: channel === ch.key ? ch.color : "#555",
              border: `1px solid ${channel === ch.key ? "#3a3a3a" : "#252525"}`,
              borderRadius: 4,
              cursor: "pointer",
              letterSpacing: "0.03em",
            }}
          >
            {ch.label}
          </button>
        ))}
      </div>

      {/* SVG curve editor */}
      <svg
        ref={svgRef}
        viewBox="0 0 255 255"
        style={{
          width: "100%",
          aspectRatio: "1",
          background: "#141414",
          borderRadius: 6,
          cursor: "crosshair",
          display: "block",
          border: "1px solid #252525",
        }}
        onMouseDown={handleSVGClick}
      >
        {/* Grid */}
        {[64, 128, 192].map((v) => (
          <g key={v}>
            <line x1={v} y1={0} x2={v} y2={255} stroke="#1e1e1e" strokeWidth={0.5} />
            <line x1={0} y1={v} x2={255} y2={v} stroke="#1e1e1e" strokeWidth={0.5} />
          </g>
        ))}

        {/* Diagonal reference */}
        <line x1={0} y1={255} x2={255} y2={0} stroke="#2a2a2a" strokeWidth={0.5} strokeDasharray="3 3" />

        {/* Curve */}
        <path d={curvePath} fill="none" stroke={channelInfo.color} strokeWidth={1.5} strokeLinecap="round" />

        {/* Control points */}
        {sorted.map((pt, i) => (
          <circle
            key={i}
            cx={pt[0]}
            cy={255 - pt[1]}
            r={5}
            fill={channelInfo.color}
            stroke="#000"
            strokeWidth={1.5}
            style={{ cursor: "grab" }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragIdx(i); }}
            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); setDragIdx(i); }}
            onDoubleClick={(e) => handlePointDoubleClick(e, i)}
          />
        ))}
      </svg>

      {/* Preset buttons */}
      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
        <button onClick={handleSCurve} style={actionBtnStyle}>S-Curve</button>
        <button onClick={handleReset} style={actionBtnStyle}>Reset</button>
      </div>
    </div>
  );
}

const actionBtnStyle = {
  flex: 1,
  padding: "5px 0",
  fontSize: 10,
  fontFamily: "inherit",
  background: "#1a1a1a",
  color: "#777",
  border: "1px solid #2a2a2a",
  borderRadius: 4,
  cursor: "pointer",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
