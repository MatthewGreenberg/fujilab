/*
  WebGL 2 image processing renderer.
  Replaces the CPU per-pixel loop with a single-pass fragment shader.

  Usage:
    const gpu = createRenderer(canvas)
    gpu.uploadImage(imageData, width, height)
    gpu.uploadLUT(lutData, size)
    gpu.uploadCurveLUTs(rTable, gTable, bTable)
    gpu.render(uniforms)
    gpu.readPixels()  → ImageData for export
    gpu.destroy()
*/

export function isWebGL2Supported() {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch { return false; }
}

export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // needed for readPixels / export
  });
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

  // Unit 1: 3D LUT (sampler3D) — hardware trilinear interpolation
  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, lutTex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, "u_lut"), 1);

  // Unit 2: per-channel curve LUTs (256x3 texture)
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
    gl,

    uploadImage(imageData, w, h) {
      currentWidth = w;
      currentHeight = h;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(imageData.data.buffer));
    },

    uploadLUT(data, size) {
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

    uploadCurveLUTs(rTable, gTable, bTable) {
      const data = new Uint8Array(256 * 3 * 4);
      for (let i = 0; i < 256; i++) {
        // Row 0: R curve — store value in R channel
        data[(0 * 256 + i) * 4]     = rTable[i];
        data[(0 * 256 + i) * 4 + 1] = rTable[i];
        data[(0 * 256 + i) * 4 + 2] = rTable[i];
        data[(0 * 256 + i) * 4 + 3] = 255;
        // Row 1: G curve
        data[(1 * 256 + i) * 4]     = gTable[i];
        data[(1 * 256 + i) * 4 + 1] = gTable[i];
        data[(1 * 256 + i) * 4 + 2] = gTable[i];
        data[(1 * 256 + i) * 4 + 3] = 255;
        // Row 2: B curve
        data[(2 * 256 + i) * 4]     = bTable[i];
        data[(2 * 256 + i) * 4 + 1] = bTable[i];
        data[(2 * 256 + i) * 4 + 2] = bTable[i];
        data[(2 * 256 + i) * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, curveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    },

    render(uniforms) {
      canvas.width = currentWidth;
      canvas.height = currentHeight;
      gl.viewport(0, 0, currentWidth, currentHeight);

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

// ── Vertex shader ──
const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
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

uniform sampler2D u_image;
uniform sampler3D u_lut;
uniform sampler2D u_curves;

uniform vec2  u_resolution;
uniform float u_lutSize;
uniform float u_hasLut;
uniform float u_intensity;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_temperature;
uniform float u_tint;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_colorChrome;
uniform float u_colorChromeFxBlue;
uniform float u_vignette;
uniform float u_grain;
uniform float u_grainAmp;
uniform float u_grainCellSize;
uniform float u_splitView;
uniform float u_splitPos;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Deterministic grain noise with bilinear interpolation for clumping
float grainHash(vec2 p) {
  float h = p.x * 374761.393 + p.y * 668265.263;
  return fract(sin(h) * 43758.5453);
}
float grainNoise(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float n00 = grainHash(ip);
  float n10 = grainHash(ip + vec2(1.0, 0.0));
  float n01 = grainHash(ip + vec2(0.0, 1.0));
  float n11 = grainHash(ip + vec2(1.0, 1.0));
  return mix(mix(n00, n10, fp.x), mix(n01, n11, fp.x), fp.y);
}

float rgbHue(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  if (d < 0.03) return -1.0;
  float h;
  if (mx == c.r)      h = mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g)  h = (c.b - c.r) / d + 2.0;
  else                 h = (c.r - c.g) / d + 4.0;
  return h * 60.0;
}

void main() {
  vec3 src = texture(u_image, v_uv).rgb;
  vec3 color = src;

  // 1. 3D LUT with hardware trilinear interpolation
  if (u_hasLut > 0.5) {
    float scale = (u_lutSize - 1.0) / u_lutSize;
    float offset = 0.5 / u_lutSize;
    vec3 graded = texture(u_lut, color * scale + offset).rgb;
    color = mix(color, graded, u_intensity);
  }

  // 2. Per-channel curve LUTs (256x3 texture: R=row0, G=row1, B=row2)
  color.r = texture(u_curves, vec2((color.r * 255.0 + 0.5) / 256.0, 0.5 / 3.0)).r;
  color.g = texture(u_curves, vec2((color.g * 255.0 + 0.5) / 256.0, 1.5 / 3.0)).r;
  color.b = texture(u_curves, vec2((color.b * 255.0 + 0.5) / 256.0, 2.5 / 3.0)).r;

  // 3. Color Chrome / FX Blue
  if (u_colorChrome > 0.0 || u_colorChromeFxBlue > 0.0) {
    float mx = max(color.r, max(color.g, color.b));
    float mn = min(color.r, min(color.g, color.b));
    float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
    float hue = rgbHue(color);
    float l = luma(color);

    if (u_colorChrome > 0.0 && sat > 0.4 && hue >= 0.0) {
      float hueMask = 1.0;
      if (hue > 140.0 && hue < 200.0) hueMask = max(0.0, 1.0 - (hue - 140.0) / 60.0);
      else if (hue >= 200.0) hueMask = 0.0;
      if (hueMask > 0.0) {
        float str = ((sat - 0.4) / 0.6) * u_colorChrome * hueMask;
        float f = l < 0.5 ? 1.0 - str * 0.3 * (1.0 - l * 2.0) : 1.0 - str * 0.04;
        color *= f;
      }
    }
    if (u_colorChromeFxBlue > 0.0 && sat > 0.3 && hue >= 0.0) {
      float dist = min(abs(hue - 235.0), 360.0 - abs(hue - 235.0));
      if (dist < 55.0) {
        float mask = cos((dist / 55.0) * 1.5707963);
        float str = mask * sat * u_colorChromeFxBlue;
        float f = l < 0.5 ? 1.0 - str * 0.35 * (1.0 - l * 2.0) : 1.0 - str * 0.05;
        color *= f;
      }
    }
  }

  // 4. Highlights / Shadows
  if (u_highlights != 0.0 || u_shadows != 0.0) {
    float l = luma(color);
    if (u_highlights != 0.0) {
      float hw = l > 0.5 ? (l - 0.5) * 2.0 : 0.0;
      color += (u_highlights / 100.0) * 0.5 * hw * hw;
    }
    if (u_shadows != 0.0) {
      float sw = l < 0.5 ? (0.5 - l) * 2.0 : 0.0;
      color += (u_shadows / 100.0) * 0.5 * sw * sw;
    }
  }

  // 5. Temperature / Tint
  if (u_temperature != 0.0 || u_tint != 0.0) {
    float t = u_temperature / 100.0;
    color.r += t * 0.3;
    color.g += (u_tint / 100.0) * 0.25 - t * 0.1;
    color.b -= t * 0.3;
  }

  // 6. Saturation / Vibrance
  if (u_saturation != 0.0) {
    float avg = dot(color, vec3(1.0 / 3.0));
    color = vec3(avg) + (color - vec3(avg)) * (1.0 + u_saturation / 100.0);
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
    vec2 d = v_uv - 0.5;
    float dist2 = dot(d, d);
    color *= 1.0 - u_vignette * dist2 * 2.0;
  }

  // 8. Grain
  if (u_grain > 0.0) {
    float l = luma(color);
    float w = exp(-((l - 0.4) * (l - 0.4)) / 0.1225);
    float n = (grainNoise(gl_FragCoord.xy / u_grainCellSize) - 0.5) * 2.0;
    color += n * (u_grainAmp / 255.0) * u_grain * w;
  }

  color = clamp(color, 0.0, 1.0);

  // 9. Split view
  if (u_splitView > 0.5 && v_uv.x < u_splitPos) {
    color = src;
  }

  fragColor = vec4(color, 1.0);
}
`;
