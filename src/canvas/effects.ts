import { hasActiveEffects } from "../document/effects";
import type { Effect } from "../document/effects";
import type { El } from "../document/types";
import { logError } from "../errorLog";

/**
 * Live effects on pictures and video clips.
 *
 * Runs WebGL2 shaders after colour grading. A still picture is cached so it is
 * drawn once and not on every repaint; video clip frames run live per frame.
 * Blur, sharpen, glow and pixelate sizes are in design pixels.
 */

const PREVIEW_SIDE = 2048;

function fit(w: number, h: number): [number, number] {
  const k = Math.min(1, PREVIEW_SIDE / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

const VERTEX = `#version 300 es
in vec2 at;
out vec2 uv;
void main() {
  uv = at * 0.5 + 0.5;
  gl_Position = vec4(at, 0.0, 1.0);
}`;

const FRAG_COPY = `#version 300 es
precision highp float;
uniform sampler2D src;
in vec2 uv;
out vec4 color;
void main() {
  color = texture(src, uv);
}`;

const FRAG_BLUR = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 direction;
uniform float radius;
in vec2 uv;
out vec4 color;
void main() {
  if (radius <= 0.001) {
    color = texture(src, uv);
    return;
  }
  float sigma = max(0.5, radius * 0.4);
  vec4 sum = vec4(0.0);
  float totalWeight = 0.0;
  for (int i = -12; i <= 12; i++) {
    float fi = float(i);
    float offset = fi * (radius / 12.0);
    float weight = exp(-(offset * offset) / (2.0 * sigma * sigma));
    vec2 sampleUv = uv + direction * offset;
    sum += texture(src, clamp(sampleUv, 0.0, 1.0)) * weight;
    totalWeight += weight;
  }
  color = sum / totalWeight;
}`;

const FRAG_SHARPEN = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 texelSize;
uniform float amount;
uniform float radius;
in vec2 uv;
out vec4 color;
void main() {
  vec4 c = texture(src, uv);
  if (amount <= 0.0 || radius <= 0.001) {
    color = c;
    return;
  }
  vec2 off = texelSize * radius;
  vec4 blur = (
    texture(src, clamp(uv + vec2(-off.x, 0.0), 0.0, 1.0)) +
    texture(src, clamp(uv + vec2(off.x, 0.0), 0.0, 1.0)) +
    texture(src, clamp(uv + vec2(0.0, -off.y), 0.0, 1.0)) +
    texture(src, clamp(uv + vec2(0.0, off.y), 0.0, 1.0)) +
    0.707 * (
      texture(src, clamp(uv + vec2(-off.x, -off.y) * 0.707, 0.0, 1.0)) +
      texture(src, clamp(uv + vec2(off.x, -off.y) * 0.707, 0.0, 1.0)) +
      texture(src, clamp(uv + vec2(-off.x, off.y) * 0.707, 0.0, 1.0)) +
      texture(src, clamp(uv + vec2(off.x, off.y) * 0.707, 0.0, 1.0))
    )
  ) / 6.828;
  vec3 detail = c.rgb - blur.rgb;
  float strength = (amount / 100.0) * 2.5;
  vec3 sharp = clamp(c.rgb + detail * strength, 0.0, 1.0);
  color = vec4(sharp, c.a);
}`;

const FRAG_GRAIN = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 resolution;
uniform float amount;
uniform float size;
in vec2 uv;
out vec4 color;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 px = texture(src, uv);
  if (amount <= 0.0) {
    color = px;
    return;
  }
  float s = max(1.0, floor(size));
  vec2 coord = floor(gl_FragCoord.xy / s);
  float noise = hash(coord) - 0.5;
  float lum = dot(px.rgb, vec3(0.2126, 0.7152, 0.0722));
  float midtone = 1.0 - 2.0 * abs(lum - 0.5);
  float response = mix(0.4, 1.0, clamp(midtone, 0.0, 1.0));
  float str = (amount / 100.0) * 0.35 * response;
  vec3 o = clamp(px.rgb + vec3(noise * str), 0.0, 1.0);
  color = vec4(o, px.a);
}`;

const FRAG_GLOW_EXTRACT = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 direction;
uniform float radius;
in vec2 uv;
out vec4 color;
void main() {
  if (radius <= 0.001) {
    vec4 px = texture(src, uv);
    float lum = dot(px.rgb, vec3(0.2126, 0.7152, 0.0722));
    float bloomWeight = smoothstep(0.45, 0.85, lum);
    color = vec4(px.rgb * bloomWeight, px.a);
    return;
  }
  float sigma = max(0.5, radius * 0.4);
  vec4 sum = vec4(0.0);
  float totalWeight = 0.0;
  for (int i = -12; i <= 12; i++) {
    float fi = float(i);
    float offset = fi * (radius / 12.0);
    float weight = exp(-(offset * offset) / (2.0 * sigma * sigma));
    vec2 sampleUv = uv + direction * offset;
    vec4 s = texture(src, clamp(sampleUv, 0.0, 1.0));
    float lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
    float bloomWeight = smoothstep(0.45, 0.85, lum);
    sum += vec4(s.rgb * bloomWeight, s.a) * weight;
    totalWeight += weight;
  }
  color = sum / totalWeight;
}`;

const FRAG_GLOW_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D orig;
uniform sampler2D bloom;
uniform vec2 direction;
uniform float radius;
uniform float amount;
in vec2 uv;
out vec4 color;
void main() {
  vec4 basePx = texture(orig, uv);
  if (amount <= 0.0) {
    color = basePx;
    return;
  }
  vec4 bloomSum = vec4(0.0);
  float totalWeight = 0.0;
  if (radius <= 0.001) {
    bloomSum = texture(bloom, uv);
    totalWeight = 1.0;
  } else {
    float sigma = max(0.5, radius * 0.4);
    for (int i = -12; i <= 12; i++) {
      float fi = float(i);
      float offset = fi * (radius / 12.0);
      float weight = exp(-(offset * offset) / (2.0 * sigma * sigma));
      vec2 sampleUv = uv + direction * offset;
      bloomSum += texture(bloom, clamp(sampleUv, 0.0, 1.0)) * weight;
      totalWeight += weight;
    }
  }
  vec4 bloomFinal = bloomSum / totalWeight;
  float strength = (amount / 100.0) * 1.5;
  vec3 res = clamp(basePx.rgb + bloomFinal.rgb * strength, 0.0, 1.0);
  color = vec4(res, basePx.a);
}`;

const FRAG_PIXELATE = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 resolution;
uniform float pixelSize;
in vec2 uv;
out vec4 color;
void main() {
  if (pixelSize <= 1.001) {
    color = texture(src, uv);
    return;
  }
  vec2 coord = gl_FragCoord.xy;
  vec2 blockCenter = (floor(coord / pixelSize) + 0.5) * pixelSize;
  vec2 blockUv = blockCenter / resolution;
  color = texture(src, clamp(blockUv, 0.0, 1.0));
}`;

let gl: WebGL2RenderingContext | null | undefined;
let sheet: HTMLCanvasElement;
let quadBuffer: WebGLBuffer;

let progCopy: WebGLProgram;
let progBlur: WebGLProgram;
let progSharpen: WebGLProgram;
let progGrain: WebGLProgram;
let progGlowExtract: WebGLProgram;
let progGlowComposite: WebGLProgram;
let progPixelate: WebGLProgram;

let texA: WebGLTexture;
let texB: WebGLTexture;
let fboA: WebGLFramebuffer;
let fboB: WebGLFramebuffer;
let allocatedW = 0;
let allocatedH = 0;

function compileShader(g: WebGL2RenderingContext, kind: number, text: string) {
  const s = g.createShader(kind)!;
  g.shaderSource(s, text);
  g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? "shader");
  return s;
}

function createProgram(g: WebGL2RenderingContext, fragText: string): WebGLProgram {
  const p = g.createProgram()!;
  g.attachShader(p, compileShader(g, g.VERTEX_SHADER, VERTEX));
  g.attachShader(p, compileShader(g, g.FRAGMENT_SHADER, fragText));
  g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? "link");
  return p;
}

function initContext(): WebGL2RenderingContext | null {
  if (gl !== undefined) return gl;
  try {
    sheet = document.createElement("canvas");
    const g = sheet.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!g) return (gl = null);

    quadBuffer = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, quadBuffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);

    progCopy = createProgram(g, FRAG_COPY);
    progBlur = createProgram(g, FRAG_BLUR);
    progSharpen = createProgram(g, FRAG_SHARPEN);
    progGrain = createProgram(g, FRAG_GRAIN);
    progGlowExtract = createProgram(g, FRAG_GLOW_EXTRACT);
    progGlowComposite = createProgram(g, FRAG_GLOW_COMPOSITE);
    progPixelate = createProgram(g, FRAG_PIXELATE);

    texA = g.createTexture()!;
    texB = g.createTexture()!;
    fboA = g.createFramebuffer()!;
    fboB = g.createFramebuffer()!;

    for (const t of [texA, texB]) {
      g.bindTexture(g.TEXTURE_2D, t);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    }

    return (gl = g);
  } catch (e) {
    logError("effects webgl context", e);
    return (gl = null);
  }
}

function ensureBuffers(g: WebGL2RenderingContext, w: number, h: number) {
  if (sheet.width !== w || sheet.height !== h) {
    sheet.width = w;
    sheet.height = h;
  }
  if (allocatedW !== w || allocatedH !== h) {
    allocatedW = w;
    allocatedH = h;
    for (const [t, fbo] of [
      [texA, fboA],
      [texB, fboB],
    ] as const) {
      g.bindTexture(g.TEXTURE_2D, t);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindFramebuffer(g.FRAMEBUFFER, fbo);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0);
    }
  }
}

function setupQuad(g: WebGL2RenderingContext, prog: WebGLProgram) {
  g.useProgram(prog);
  g.bindBuffer(g.ARRAY_BUFFER, quadBuffer);
  const at = g.getAttribLocation(prog, "at");
  if (at >= 0) {
    g.enableVertexAttribArray(at);
    g.vertexAttribPointer(at, 2, g.FLOAT, false, 0, 0);
  }
}

const stills = new Map<string, HTMLCanvasElement>();

export function clearEffectsCache() {
  stills.clear();
}

function picDimensions(pic: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): [number, number] {
  if (typeof HTMLVideoElement !== "undefined" && pic instanceof HTMLVideoElement) return [pic.videoWidth, pic.videoHeight];
  if (typeof HTMLCanvasElement !== "undefined" && pic instanceof HTMLCanvasElement) return [pic.width, pic.height];
  if ("videoWidth" in pic) return [(pic as HTMLVideoElement).videoWidth || 0, (pic as HTMLVideoElement).videoHeight || 0];
  if ("naturalWidth" in pic) return [(pic as HTMLImageElement).naturalWidth || 0, (pic as HTMLImageElement).naturalHeight || 0];
  if ("width" in pic) return [(pic as HTMLCanvasElement).width || 0, (pic as HTMLCanvasElement).height || 0];
  return [0, 0];
}

/**
 * Runs active effects on the input picture with WebGL2 and returns the modified CanvasImageSource.
 */
export function applyEffects(
  pic: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  effects: Effect[] | undefined | null,
  el: El,
  still: string | null
): CanvasImageSource {
  if (!hasActiveEffects(effects)) return pic;

  const [nw, nh] = picDimensions(pic);
  if (!nw || !nh) return pic;

  const key = still ? `${still}|${Math.round(el.width)}x${Math.round(el.height)}|${JSON.stringify(effects)}|${JSON.stringify(el.grade)}` : "";
  if (key && stills.has(key)) return stills.get(key)!;

  const g = initContext();
  if (!g) return pic;

  const [w, h] = fit(nw, nh);

  try {
    ensureBuffers(g, w, h);
    g.viewport(0, 0, w, h);

    // Upload initial picture into texA
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, texA);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, pic);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);

    // Track ping-pong textures and framebuffers
    let readTex = texA;
    let writeTex = texB;
    let writeFbo = fboB;

    const swap = () => {
      const prevRead = readTex;
      readTex = writeTex;
      writeTex = prevRead;
      writeFbo = readTex === texA ? fboB : fboA;
    };

    // scale: design pixel size to texture pixel size
    const scale = Math.max(el.width / w, el.height / h) || 1;
    const toTexPx = (designPx: number) => Math.max(0, designPx / scale);

    const active = (effects ?? []).filter((e) => e.on);

    for (const eff of active) {
      if (eff.kind === "blur") {
        const amount = eff.values.amount ?? 20;
        if (amount > 0) {
          const rTex = toTexPx(amount);
          // Pass 1: horizontal blur
          g.bindFramebuffer(g.FRAMEBUFFER, writeFbo);
          setupQuad(g, progBlur);
          g.activeTexture(g.TEXTURE0);
          g.bindTexture(g.TEXTURE_2D, readTex);
          g.uniform1i(g.getUniformLocation(progBlur, "src"), 0);
          g.uniform2f(g.getUniformLocation(progBlur, "direction"), 1 / w, 0);
          g.uniform1f(g.getUniformLocation(progBlur, "radius"), rTex);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
          swap();

          // Pass 2: vertical blur
          g.bindFramebuffer(g.FRAMEBUFFER, writeFbo);
          setupQuad(g, progBlur);
          g.activeTexture(g.TEXTURE0);
          g.bindTexture(g.TEXTURE_2D, readTex);
          g.uniform1i(g.getUniformLocation(progBlur, "src"), 0);
          g.uniform2f(g.getUniformLocation(progBlur, "direction"), 0, 1 / h);
          g.uniform1f(g.getUniformLocation(progBlur, "radius"), rTex);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
          swap();
        }
      } else if (eff.kind === "sharpen") {
        const amount = eff.values.amount ?? 50;
        const radius = eff.values.radius ?? 1;
        if (amount > 0) {
          const rTex = toTexPx(radius);
          g.bindFramebuffer(g.FRAMEBUFFER, writeFbo);
          setupQuad(g, progSharpen);
          g.activeTexture(g.TEXTURE0);
          g.bindTexture(g.TEXTURE_2D, readTex);
          g.uniform1i(g.getUniformLocation(progSharpen, "src"), 0);
          g.uniform2f(g.getUniformLocation(progSharpen, "texelSize"), 1 / w, 1 / h);
          g.uniform1f(g.getUniformLocation(progSharpen, "amount"), amount);
          g.uniform1f(g.getUniformLocation(progSharpen, "radius"), rTex);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
          swap();
        }
      } else if (eff.kind === "grain") {
        const amount = eff.values.amount ?? 25;
        const size = eff.values.size ?? 1;
        if (amount > 0) {
          g.bindFramebuffer(g.FRAMEBUFFER, writeFbo);
          setupQuad(g, progGrain);
          g.activeTexture(g.TEXTURE0);
          g.bindTexture(g.TEXTURE_2D, readTex);
          g.uniform1i(g.getUniformLocation(progGrain, "src"), 0);
          g.uniform2f(g.getUniformLocation(progGrain, "resolution"), w, h);
          g.uniform1f(g.getUniformLocation(progGrain, "amount"), amount);
          g.uniform1f(g.getUniformLocation(progGrain, "size"), size);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
          swap();
        }
      } else if (eff.kind === "glow") {
        const amount = eff.values.amount ?? 50;
        const radius = eff.values.radius ?? 20;
        if (amount > 0) {
          const rTex = toTexPx(radius);
          const origTex = readTex;

          // Pass 1: Extract bright highlights and horizontal blur into writeFbo
          g.bindFramebuffer(g.FRAMEBUFFER, writeFbo);
          setupQuad(g, progGlowExtract);
          g.activeTexture(g.TEXTURE0);
          g.bindTexture(g.TEXTURE_2D, origTex);
          g.uniform1i(g.getUniformLocation(progGlowExtract, "src"), 0);
          g.uniform2f(g.getUniformLocation(progGlowExtract, "direction"), 1 / w, 0);
          g.uniform1f(g.getUniformLocation(progGlowExtract, "radius"), rTex);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

          const bloomHTex = writeTex;

          // Pass 2: Vertical blur of bloom and composite onto origTex
          // Target is origTex's FBO (which is now available since origTex is only read)
          const targetFbo = origTex === texA ? fboA : fboB;
          g.bindFramebuffer(g.FRAMEBUFFER, targetFbo);
          setupQuad(g, progGlowComposite);
          g.activeTexture(g.TEXTURE0);
          g.bindTexture(g.TEXTURE_2D, origTex);
          g.uniform1i(g.getUniformLocation(progGlowComposite, "orig"), 0);
          g.activeTexture(g.TEXTURE1);
          g.bindTexture(g.TEXTURE_2D, bloomHTex);
          g.uniform1i(g.getUniformLocation(progGlowComposite, "bloom"), 1);
          g.uniform2f(g.getUniformLocation(progGlowComposite, "direction"), 0, 1 / h);
          g.uniform1f(g.getUniformLocation(progGlowComposite, "radius"), rTex);
          g.uniform1f(g.getUniformLocation(progGlowComposite, "amount"), amount);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

          // Result is in origTex
          readTex = origTex;
          writeTex = bloomHTex;
          writeFbo = targetFbo === fboA ? fboB : fboA;
        }
      } else if (eff.kind === "pixelate") {
        const size = eff.values.size ?? 10;
        if (size > 1) {
          const pTex = toTexPx(size);
          g.bindFramebuffer(g.FRAMEBUFFER, writeFbo);
          setupQuad(g, progPixelate);
          g.activeTexture(g.TEXTURE0);
          g.bindTexture(g.TEXTURE_2D, readTex);
          g.uniform1i(g.getUniformLocation(progPixelate, "src"), 0);
          g.uniform2f(g.getUniformLocation(progPixelate, "resolution"), w, h);
          g.uniform1f(g.getUniformLocation(progPixelate, "pixelSize"), pTex);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
          swap();
        }
      }
    }

    // Final blit to sheet canvas (framebuffer null)
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    setupQuad(g, progCopy);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, readTex);
    g.uniform1i(g.getUniformLocation(progCopy, "src"), 0);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

    if (!key) return sheet;

    const copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    copy.getContext("2d")?.drawImage(sheet, 0, 0);
    if (stills.size > 30) stills.clear();
    stills.set(key, copy);
    return copy;
  } catch (e) {
    logError("effects render", e);
    return pic;
  }
}
