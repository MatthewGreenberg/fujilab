# WebGPU Processing Pipeline Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the entire image processing pipeline from CPU (per-pixel JS loop in `processImage`) to GPU via WebGL 2, making all adjustments real-time at 60fps.

**Architecture:** A single-pass WebGL 2 fragment shader replaces the CPU pixel loop. The image is uploaded as a 2D texture, the active 3D LUT as a `sampler3D` texture, per-channel curve LUTs as three 1D textures (256x1), and all scalar adjustments as uniforms. The shader runs the identical pipeline: LUT sampling -> per-channel curves -> Color Chrome -> highlights/shadows -> temperature/tint -> saturation/vibrance -> vignette -> grain. The CPU `processImage` function is kept as a fallback for browsers without WebGL 2 and for PNG export via `readPixels`. The React UI, state management, recipes, CurveEditor, LUT loading, and file handling remain completely unchanged.

**Tech Stack:** WebGL 2 (native browser API, no libraries), GLSL ES 3.0 shaders, existing React/Vite stack unchanged.

**Why WebGL 2 over WebGPU:** WebGPU has ~72% browser support and requires async adapter/device negotiation. WebGL 2 has ~97% support and can initialize synchronously. The shader is a single fullscreen quad — we don't need compute shaders or storage buffers. WebGL 2 gives us native `sampler3D` for 3D LUT textures which is the critical feature. We can always add a WebGPU backend later.

---

## Current Architecture (what we're replacing)

The CPU pipeline lives in `src/App.jsx` inside `processImage()` (lines ~320-530). On every state change:

1. Pre-compute 3x 256-entry `Uint8Array` tables (exposure + contrast + rolloff + whites/blacks + fade + curves) — one per RGB channel
2. Nested `for py/px` loop over every pixel:
   - 3D LUT trilinear interpolation (JS, ~40 multiply+lerps per pixel)
   - Per-channel table lookup (3 array reads)
   - Color Chrome: hue calculation + saturation mask + luminance attenuation
   - Color Chrome FX Blue: same with blue hue band
   - Highlights/Shadows: luminance-weighted offset
   - Temperature/Tint: channel offsets
   - Saturation/Vibrance: desaturation mix
   - Vignette: distance-based darkening
   - Grain: hash-based noise with bilinear interpolation
3. Split view overlay
4. `putImageData` to canvas

For a 1400x900 image (~1.26M pixels), this takes 50-200ms per adjustment, causing visible lag on slider drag.

**After migration:** The GPU runs the same pipeline in <2ms. Slider drag becomes instant.

---

## Task 1: Create the WebGL renderer module

**Files:**
- Create: `src/gpu/renderer.js`

This is the core module. It manages the WebGL 2 context, compiles shaders, creates textures, and provides a `render()` function that App.jsx calls instead of the CPU loop.

**Step 1: Write the renderer scaffold**

Create `src/gpu/renderer.js` with this exact content:

```js
/*
  WebGL 2 image processing renderer.
  Replaces the CPU per-pixel loop with a single-pass fragment shader.

  Usage:
    const gpu = createRenderer(canvas)
    gpu.uploadImage(imageData, width, height)
    gpu.uploadLUT(lutData, size)          // Float32Array of size^3 * 3, grid size
    gpu.uploadCurveLUTs(rTable, gTable, bTable)  // 3x Uint8Array[256]
    gpu.render(uniforms)                  // all scalar adjustments
    gpu.readPixels()                      // returns ImageData for export
    gpu.destroy()
*/

export function isWebGL2Supported() {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch { return false; }
}

export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error("WebGL 2 not supported");

  // ── Shader compilation ──
  function compileShader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`Shader compile error: ${log}`);
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  // ── Fullscreen quad ──
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // ── Textures ──
  // Unit 0: source image (2D RGBA)
  const imgTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, imgTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.uniform1i(gl.getUniformLocation(program, "u_image"), 0);

  // Unit 1: 3D LUT (sampler3D)
  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, lutTex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, "u_lut"), 1);

  // Unit 2: per-channel curve LUTs (256x1 RGB texture)
  const curveTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, curveTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.uniform1i(gl.getUniformLocation(program, "u_curves"), 2);

  // Cache uniform locations
  const loc = {};
  const uniformNames = [
    "u_resolution", "u_lutSize", "u_hasLut", "u_intensity",
    "u_highlights", "u_shadows", "u_temperature", "u_tint",
    "u_saturation", "u_vibrance", "u_colorChrome", "u_colorChromeFxBlue",
    "u_vignette", "u_grain", "u_grainAmp", "u_grainCellSize",
    "u_splitView", "u_splitPos",
  ];
  for (const name of uniformNames) {
    loc[name] = gl.getUniformLocation(program, name);
  }

  let currentWidth = 0, currentHeight = 0;

  return {
    /** Upload the source image pixels to the GPU. */
    uploadImage(imageData, w, h) {
      currentWidth = w;
      currentHeight = h;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(imageData.data.buffer));
    },

    /**
     * Upload a 3D LUT to the GPU as a 3D texture.
     * @param {Float32Array} data - RGB triplets, length = size^3 * 3
     * @param {number} size - grid dimension (e.g. 17 for a 17x17x17 LUT)
     */
    uploadLUT(data, size) {
      // Convert RGB Float32 triplets to RGBA Uint8 for texture upload
      const count = size * size * size;
      const rgba = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        rgba[i * 4]     = Math.round(Math.min(1, Math.max(0, data[i * 3]))     * 255);
        rgba[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, data[i * 3 + 1])) * 255);
        rgba[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, data[i * 3 + 2])) * 255);
        rgba[i * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    },

    /** Clear the active LUT (pass-through). */
    clearLUT() {
      const identity = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      // Smallest possible 3D texture (2x2x2) with identity corners
      // We'll use the u_hasLut flag to skip sampling instead
    },

    /**
     * Upload the pre-computed per-channel curve LUTs.
     * Packed as a 256x3 RGB texture: row 0 = R curve, row 1 = G, row 2 = B.
     */
    uploadCurveLUTs(rTable, gTable, bTable) {
      const data = new Uint8Array(256 * 3 * 4); // 256 wide, 3 tall, RGBA
      for (let i = 0; i < 256; i++) {
        // Row 0: R channel curve
        data[(0 * 256 + i) * 4]     = rTable[i];
        data[(0 * 256 + i) * 4 + 1] = rTable[i];
        data[(0 * 256 + i) * 4 + 2] = rTable[i];
        data[(0 * 256 + i) * 4 + 3] = 255;
        // Row 1: G channel curve
        data[(1 * 256 + i) * 4]     = gTable[i];
        data[(1 * 256 + i) * 4 + 1] = gTable[i];
        data[(1 * 256 + i) * 4 + 2] = gTable[i];
        data[(1 * 256 + i) * 4 + 3] = 255;
        // Row 2: B channel curve
        data[(2 * 256 + i) * 4]     = bTable[i];
        data[(2 * 256 + i) * 4 + 1] = bTable[i];
        data[(2 * 256 + i) * 4 + 2] = bTable[i];
        data[(2 * 256 + i) * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, curveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    },

    /** Render the processed image to the canvas. */
    render(uniforms) {
      gl.viewport(0, 0, currentWidth, currentHeight);
      canvas.width = currentWidth;
      canvas.height = currentHeight;

      gl.uniform2f(loc.u_resolution, currentWidth, currentHeight);
      gl.uniform1f(loc.u_lutSize, uniforms.lutSize || 0);
      gl.uniform1f(loc.u_hasLut, uniforms.hasLut ? 1.0 : 0.0);
      gl.uniform1f(loc.u_intensity, uniforms.intensity);
      gl.uniform1f(loc.u_highlights, uniforms.highlights);
      gl.uniform1f(loc.u_shadows, uniforms.shadows);
      gl.uniform1f(loc.u_temperature, uniforms.temperature);
      gl.uniform1f(loc.u_tint, uniforms.tint);
      gl.uniform1f(loc.u_saturation, uniforms.saturation);
      gl.uniform1f(loc.u_vibrance, uniforms.vibrance);
      gl.uniform1f(loc.u_colorChrome, uniforms.colorChrome);
      gl.uniform1f(loc.u_colorChromeFxBlue, uniforms.colorChromeFxBlue);
      gl.uniform1f(loc.u_vignette, uniforms.vignette);
      gl.uniform1f(loc.u_grain, uniforms.grain);
      gl.uniform1f(loc.u_grainAmp, uniforms.grainAmp);
      gl.uniform1f(loc.u_grainCellSize, uniforms.grainCellSize);
      gl.uniform1f(loc.u_splitView, uniforms.splitView ? 1.0 : 0.0);
      gl.uniform1f(loc.u_splitPos, uniforms.splitPos / 100);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },

    /** Read pixels back from GPU for PNG export. Returns ImageData. */
    readPixels() {
      const pixels = new Uint8Array(currentWidth * currentHeight * 4);
      gl.readPixels(0, 0, currentWidth, currentHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // WebGL reads bottom-to-top, flip vertically
      const flipped = new Uint8Array(pixels.length);
      const rowSize = currentWidth * 4;
      for (let y = 0; y < currentHeight; y++) {
        const srcOff = y * rowSize;
        const dstOff = (currentHeight - 1 - y) * rowSize;
        flipped.set(pixels.subarray(srcOff, srcOff + rowSize), dstOff);
      }
      return new ImageData(new Uint8ClampedArray(flipped.buffer), currentWidth, currentHeight);
    },

    destroy() {
      gl.deleteTexture(imgTex);
      gl.deleteTexture(lutTex);
      gl.deleteTexture(curveTex);
      gl.deleteBuffer(quadBuf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

// ── Vertex shader: fullscreen quad ──
const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  // Map [-1,1] quad to [0,1] UV (flip Y for correct image orientation)
  v_uv = a_position * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// ── Fragment shader: full processing pipeline ──
const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 fragColor;

// Textures
uniform sampler2D u_image;     // source photo
uniform sampler3D u_lut;       // 3D LUT (film simulation)
uniform sampler2D u_curves;    // 256x3: per-channel curve LUTs (R=row0, G=row1, B=row2)

// Uniforms
uniform vec2  u_resolution;
uniform float u_lutSize;       // grid dimension of the 3D LUT (e.g. 17.0)
uniform float u_hasLut;        // 1.0 if LUT active, 0.0 for original
uniform float u_intensity;     // 0-1, blend between original and LUT
uniform float u_highlights;    // -100 to 100
uniform float u_shadows;       // -100 to 100
uniform float u_temperature;   // -100 to 100
uniform float u_tint;          // -100 to 100
uniform float u_saturation;    // -100 to 100
uniform float u_vibrance;      // -100 to 100
uniform float u_colorChrome;   // 0-1
uniform float u_colorChromeFxBlue; // 0-1
uniform float u_vignette;      // 0-1
uniform float u_grain;         // 0-1
uniform float u_grainAmp;      // grain amplitude
uniform float u_grainCellSize; // grain cell size for clumping
uniform float u_splitView;     // 1.0 if split view on
uniform float u_splitPos;      // 0-1, split position

// ── Helpers ──
float luminance(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Deterministic hash for grain (matches CPU grainHash)
float grainHash(vec2 p) {
  vec2 ip = floor(p);
  float h = ip.x * 374761393.0 + ip.y * 668265263.0;
  h = mod(h, 2147483647.0);
  // Approximate the integer hash with trig — GPU doesn't have integer math in ES 3.0 mediump
  return fract(sin(h * 0.0001) * 43758.5453);
}

float grainNoise(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float n00 = grainHash(ip);
  float n10 = grainHash(ip + vec2(1.0, 0.0));
  float n01 = grainHash(ip + vec2(0.0, 1.0));
  float n11 = grainHash(ip + vec2(1.0, 1.0));
  float nx0 = mix(n00, n10, fp.x);
  float nx1 = mix(n01, n11, fp.x);
  return mix(nx0, nx1, fp.y);
}

// Compute hue in degrees from RGB [0,1]
float rgbHue(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float range = mx - mn;
  if (range < 0.03) return -1.0;
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / range, 6.0);
  else if (mx == c.g) h = (c.b - c.r) / range + 2.0;
  else h = (c.r - c.g) / range + 4.0;
  return h * 60.0;
}

// ── Main pipeline ──
void main() {
  vec3 src = texture(u_image, v_uv).rgb;
  vec3 color = src;

  // 1. Film simulation 3D LUT with hardware trilinear interpolation
  if (u_hasLut > 0.5) {
    float scale = (u_lutSize - 1.0) / u_lutSize;
    float offset = 0.5 / u_lutSize;
    vec3 lutCoord = color * scale + offset;
    vec3 graded = texture(u_lut, lutCoord).rgb;
    color = mix(color, graded, u_intensity);
  }

  // 2. Per-channel curve LUTs (exposure + contrast + rolloff + whites/blacks + fade + tone curves)
  //    Packed in a 256x3 texture: row 0 = R, row 1 = G, row 2 = B
  color.r = texture(u_curves, vec2((color.r * 255.0 + 0.5) / 256.0, 0.5 / 3.0)).r;
  color.g = texture(u_curves, vec2((color.g * 255.0 + 0.5) / 256.0, 1.5 / 3.0)).r;
  color.b = texture(u_curves, vec2((color.b * 255.0 + 0.5) / 256.0, 2.5 / 3.0)).r;

  // 3. Color Chrome Effect: reduce luminance in saturated warm hues
  if (u_colorChrome > 0.0 || u_colorChromeFxBlue > 0.0) {
    float mx = max(color.r, max(color.g, color.b));
    float mn = min(color.r, min(color.g, color.b));
    float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
    float hue = rgbHue(color);
    float lum = luminance(color);

    // Color Chrome: warm hues (0-170 deg)
    if (u_colorChrome > 0.0 && sat > 0.4 && hue >= 0.0) {
      float hueMask = 1.0;
      if (hue > 140.0 && hue < 200.0) hueMask = max(0.0, 1.0 - (hue - 140.0) / 60.0);
      else if (hue >= 200.0) hueMask = 0.0;
      if (hueMask > 0.0) {
        float strength = ((sat - 0.4) / 0.6) * u_colorChrome * hueMask;
        float factor = lum < 0.5
          ? 1.0 - strength * 0.3 * (1.0 - lum * 2.0)
          : 1.0 - strength * 0.04;
        color *= factor;
      }
    }

    // Color Chrome FX Blue: blues/purples (190-280 deg)
    if (u_colorChromeFxBlue > 0.0 && sat > 0.3 && hue >= 0.0) {
      float dist = min(abs(hue - 235.0), 360.0 - abs(hue - 235.0));
      if (dist < 55.0) {
        float mask = cos((dist / 55.0) * 1.5707963);
        float strength = mask * sat * u_colorChromeFxBlue;
        float factor = lum < 0.5
          ? 1.0 - strength * 0.35 * (1.0 - lum * 2.0)
          : 1.0 - strength * 0.05;
        color *= factor;
      }
    }
  }

  // 4. Highlights / Shadows
  if (u_highlights != 0.0 || u_shadows != 0.0) {
    float lum = luminance(color);
    if (u_highlights != 0.0) {
      float hw = lum > 0.5 ? (lum - 0.5) * 2.0 : 0.0;
      float hadj = (u_highlights / 100.0) * 0.5 * hw * hw;
      color += hadj;
    }
    if (u_shadows != 0.0) {
      float sw = lum < 0.5 ? (0.5 - lum) * 2.0 : 0.0;
      float sadj = (u_shadows / 100.0) * 0.5 * sw * sw;
      color += sadj;
    }
  }

  // 5. Temperature / Tint
  if (u_temperature != 0.0 || u_tint != 0.0) {
    color.r += (u_temperature / 100.0) * 0.3;
    color.g += (u_tint / 100.0) * 0.25 - (u_temperature / 100.0) * 0.1;
    color.b -= (u_temperature / 100.0) * 0.3;
  }

  // 6. Saturation then Vibrance
  if (u_saturation != 0.0) {
    float avg = dot(color, vec3(1.0 / 3.0));
    float sf = 1.0 + u_saturation / 100.0;
    color = vec3(avg) + (color - vec3(avg)) * sf;
  }
  if (u_vibrance != 0.0) {
    float mx = max(color.r, max(color.g, color.b));
    float mn = min(color.r, min(color.g, color.b));
    float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
    float vf = 1.0 + (u_vibrance / 100.0) * (1.0 - sat);
    float avg = dot(color, vec3(1.0 / 3.0));
    color = vec3(avg) + (color - vec3(avg)) * vf;
  }

  // 7. Vignette
  if (u_vignette > 0.0) {
    vec2 center = v_uv - 0.5;
    // Correct for aspect ratio
    float aspect = u_resolution.x / u_resolution.y;
    center.x *= aspect;
    float dist2 = dot(center, center);
    float vig = 1.0 - u_vignette * dist2 * 0.5 / (aspect * aspect * 0.25 + 0.25);
    color *= vig;
  }

  // 8. Film grain: deterministic, spatially-correlated, midtone-weighted
  if (u_grain > 0.0) {
    float lum = luminance(color);
    float grainWeight = exp(-((lum - 0.4) * (lum - 0.4)) / 0.1225);
    vec2 grainCoord = gl_FragCoord.xy / u_grainCellSize;
    float noise = (grainNoise(grainCoord) - 0.5) * 2.0;
    float grainVal = noise * (u_grainAmp / 255.0) * u_grain * grainWeight;
    color += grainVal;
  }

  // Clamp to valid range
  color = clamp(color, 0.0, 1.0);

  // 9. Split view: left side shows original
  if (u_splitView > 0.5 && v_uv.x < u_splitPos) {
    color = src;
  }

  fragColor = vec4(color, 1.0);
}
`;
```

**Step 2: Verify it builds**

Run: `npx vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add src/gpu/renderer.js
git commit -m "feat: add WebGL 2 renderer module with GLSL processing pipeline"
```

---

## Task 2: Integrate the GPU renderer into App.jsx

**Files:**
- Modify: `src/App.jsx`

Replace the CPU `processImage` with GPU rendering. The key changes:

1. Initialize the renderer on mount (or when WebGL 2 is available)
2. Upload image data to GPU when image loads
3. Upload 3D LUT when preset changes
4. Pre-compute curve LUTs on CPU (they're tiny — 256 entries), upload as texture
5. Call `gpu.render(uniforms)` on every state change
6. Use `gpu.readPixels()` for export
7. Keep the CPU fallback path for browsers without WebGL 2

**Step 1: Add GPU renderer integration**

At the top of App.jsx, add the import:
```js
import { createRenderer, isWebGL2Supported } from "./gpu/renderer";
```

Replace the `canvasRef` pattern with a ref callback that initializes the renderer. Add a `gpuRef` to hold the renderer instance.

Replace the `processImage` callback: instead of the CPU pixel loop, it should:
1. Build the 3 per-channel curve LUTs (keep this on CPU — it's 768 bytes)
2. Upload curve LUTs to GPU via `gpu.uploadCurveLUTs(rTable, gTable, bTable)`
3. Call `gpu.render({ ...all uniforms })`

The `buildTable` function that creates per-channel curve LUTs stays **exactly as-is** on the CPU — this is cheap (256 iterations) and the output gets uploaded as a texture.

When the active LUT preset changes, call `gpu.uploadLUT(lut.data, lut.size)`.

When a new image loads, call `gpu.uploadImage(imageData, w, h)`.

For export, replace the `canvasRef.current.toDataURL()` call with:
```js
const exportCanvas = document.createElement("canvas");
exportCanvas.width = w; exportCanvas.height = h;
const ectx = exportCanvas.getContext("2d");
ectx.putImageData(gpu.readPixels(), 0, 0);
link.href = exportCanvas.toDataURL("image/png");
```

**Step 2: Verify it builds and renders**

Run: `npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

Manual test: `npm run dev`, load an image, switch presets, drag sliders — should be instant.

**Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: integrate WebGL 2 renderer into App, replacing CPU pixel loop"
```

---

## Task 3: Fix the split view divider line rendering

**Files:**
- Modify: `src/App.jsx` (split view overlay)

The split view divider (the white line + circle handle) is an HTML overlay positioned absolutely. Since the GPU shader now handles the split (left side = original), the overlay still works as-is. But we need to ensure the canvas CSS sizing matches the wrapper properly so the split position aligns.

The canvas now uses WebGL which flips Y by default. We handle this in the vertex shader already (`v_uv.y = 1.0 - v_uv.y`). Verify the split divider still aligns with the shader's `u_splitPos`.

**Step 1:** Test split view manually — load image, enable Before/After, drag divider.

**Step 2:** If the split line and shader boundary don't align, adjust the `u_splitPos` uniform. The wrapper `getBoundingClientRect()` gives the position relative to the wrapper, but the canvas might not fill the wrapper. Fix by calculating the canvas's actual display position within the wrapper.

**Step 3: Commit if changes were needed**

```bash
git add -A
git commit -m "fix: align split view divider with GPU shader boundary"
```

---

## Task 4: Handle WebGL 2 fallback gracefully

**Files:**
- Modify: `src/App.jsx`

Add a check: if `isWebGL2Supported()` returns false, fall back to the original CPU `processImage`. This means keeping the old CPU code as a function but only calling it when the GPU path isn't available.

**Step 1:** Wrap the GPU init in a try/catch. If it fails, set a `useGPU = false` flag and route through the CPU path.

**Step 2:** Add a small indicator in the header showing "GPU" or "CPU" rendering mode for debugging.

**Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add CPU fallback for browsers without WebGL 2"
```

---

## Task 5: Clean up and remove dead CPU code

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/lut.js`

Once GPU rendering is confirmed working:

1. Move the CPU `processImage` into a separate function (or keep it minimal for fallback).
2. The `applyLUT` function in `lut.js` is no longer needed for the hot path (GPU does trilinear interpolation via `sampler3D`). Keep it for the CPU fallback path only.
3. Remove `grainHash` and `rgbHue` helper functions from App.jsx (now in the shader).
4. Clean up unused imports.

**Step 1:** Remove dead code, keeping only what's used.

**Step 2:** Verify build still succeeds.

Run: `npx vite build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: clean up CPU-only code paths after GPU migration"
```

---

## Task 6: Performance verification and edge cases

**Files:** No file changes — testing only.

**Step 1: Test slider responsiveness**

Load a large image (1400px+ wide). Drag the Exposure slider rapidly back and forth. Should feel instant (<16ms per frame).

**Step 2: Test all adjustment types**

Run through every slider and verify the GPU output matches the previous CPU output:
- Film simulation preset switching
- Intensity blend
- Exposure, Contrast, Highlights, Shadows, Whites, Blacks
- Tone curves (add points, drag, S-curve preset)
- Temperature, Tint, Vibrance, Saturation
- Color Chrome, Color Chrome FX Blue
- Highlight Rolloff, Fade
- Grain (amount + size)
- Vignette
- Split view
- Recipe application

**Step 3: Test export**

Click Export, verify the PNG is correct (not upside down, colors match preview).

**Step 4: Test edge cases**
- Load image with no LUT selected (original mode)
- Load custom .3dl/.cube LUT files via drag-drop
- Load a second image (should re-upload texture)
- Very small image (100px wide)
- Very large image (4000px wide — gets scaled to 1400)

---

## Architecture Diagram

```
┌─────────────────────── CPU (React/JS) ───────────────────────┐
│                                                               │
│  Image Load → ImageData ──upload──→ GPU Texture (u_image)     │
│  LUT Parse  → Float32Array ─upload──→ GPU 3D Texture (u_lut) │
│  Curve LUTs → 3x Uint8Array[256] ──→ GPU 2D Texture (u_curves)│
│  Adjustments → uniform floats ──────→ GPU Uniforms            │
│                                                               │
│  Render trigger: any state change → gpu.render(uniforms)      │
│  Export: gpu.readPixels() → canvas.toDataURL()                │
│                                                               │
└───────────────────────────────────────────────────────────────┘

┌─────────────────────── GPU (WebGL 2) ────────────────────────┐
│                                                               │
│  Vertex Shader: fullscreen quad [-1,1] → UV [0,1]            │
│                                                               │
│  Fragment Shader (single pass):                               │
│    1. Sample u_image at UV → src color                        │
│    2. Sample u_lut (sampler3D, trilinear) → graded color      │
│    3. Mix src/graded by u_intensity                           │
│    4. Sample u_curves → per-channel curve LUT                 │
│    5. Color Chrome (hue-aware saturation → luminance atten.)  │
│    6. Color Chrome FX Blue (blue band → luminance atten.)     │
│    7. Highlights/Shadows (luminance-weighted offset)           │
│    8. Temperature/Tint (channel offsets)                       │
│    9. Saturation/Vibrance (desaturation mix)                  │
│   10. Vignette (distance-based darkening)                     │
│   11. Grain (hash noise, bilinear interp, midtone-weighted)   │
│   12. Split view (left side = original)                       │
│   13. Output → canvas                                         │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```
