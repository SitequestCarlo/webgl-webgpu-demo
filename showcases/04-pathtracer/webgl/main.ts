// Path-Tracer Showcase – WebGL2
// Akkumulierender Path-Tracer: jeder Frame addiert einen neuen Sample
// zum selben Canvas (preserveDrawingBuffer + Alpha-Blending).
// Vergleich mit Whitted-Raytracing und naivem Path-Tracing (ohne NEE).
import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { vec3 } from "gl-matrix";
import { createProgram } from "../../../src/shared/gl";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import { splitGLSL } from "../../../src/shared/splitGLSL";
import pathtracerGlsl from "../shaders/gl/pathtracer.glsl?raw";

// Zeilenenden normalisieren: \r\n → \n (wichtig für ANGLE/D3D11 HLSL-Compiler)
const [VS_SRC, PT_FS] = splitGLSL(pathtracerGlsl.replace(/\r\n/g, '\n'));

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

// preserveDrawingBuffer: Canvas-Inhalt bleibt zwischen Frames erhalten.
// Alpha-Blending akkumuliert Samples intern: blend(src_alpha, 1-src_alpha).
// alpha: false verhindert Browser-Compositing mit Alpha-Kanal (bleibt opak).
const gl = canvas.getContext("webgl2", {
  antialias: false,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
}) as WebGL2RenderingContext;
if (!gl) throw new Error("WebGL2 nicht verfügbar.");

gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
gl.clearColor(0, 0, 0, 1);

// --- Fullscreen-Quad VAO -------------------------------------------------

const ptProgram = createProgram(gl, VS_SRC, PT_FS);

const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);
const vb = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, vb);
gl.bufferData(gl.ARRAY_BUFFER,
  new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]),
  gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
gl.bindVertexArray(null);

// --- Uniforms -------------------------------------------------------------

const ptU = {
  res:      gl.getUniformLocation(ptProgram, "uResolution"),
  frame:    gl.getUniformLocation(ptProgram, "uFrameIndex"),
  mode:     gl.getUniformLocation(ptProgram, "uMode"),
  bounces:  gl.getUniformLocation(ptProgram, "uMaxBounces"),
  camPos:   gl.getUniformLocation(ptProgram, "uCamPos"),
  camRight: gl.getUniformLocation(ptProgram, "uCamRight"),
  camUp:    gl.getUniformLocation(ptProgram, "uCamUp"),
  camFwd:   gl.getUniformLocation(ptProgram, "uCamFwd"),
};

// --- Orbit-Kamera --------------------------------------------------------

const orbit = { theta: 0, phi: Math.PI / 2, dist: 1.5 };
const TARGET: [number, number, number] = [0, 0, 0];

function orbitVectors(): { pos: vec3; fwd: vec3; right: vec3; up: vec3 } {
  const p = vec3.fromValues(
    TARGET[0] + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    TARGET[1] + orbit.dist * Math.cos(orbit.phi),
    TARGET[2] + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta),
  );
  const fwd      = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), TARGET, p));
  const rightDir = vec3.cross(vec3.create(), fwd, [0, 1, 0]);
  const right    = vec3.length(rightDir) > 0.001
    ? vec3.normalize(vec3.create(), rightDir)
    : vec3.normalize(vec3.create(), vec3.cross(vec3.create(), fwd, [0, 0, 1]));
  const up       = vec3.cross(vec3.create(), right, fwd);
  return { pos: p, fwd, right, up };
}

let frameIndex = 0;

function resetAccum(): void {
  frameIndex = 0;
  gl.clear(gl.COLOR_BUFFER_BIT);
}

// Maus-Orbit: Drag dreht die Kamera, Scroll-Rad zoomt
{
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lx) * 0.008;
    orbit.phi    = Math.max(0.1, Math.min(Math.PI - 0.1, orbit.phi - (e.clientY - ly) * 0.008));
    lx = e.clientX;
    ly = e.clientY;
    resetAccum();
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("wheel", (e) => {
    orbit.dist = Math.max(0.8, Math.min(3.0, orbit.dist + e.deltaY * 0.003));
    resetAccum();
    e.preventDefault();
  }, { passive: false });
}

// --- Benchmark & GUI -----------------------------------------------------

const stats = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1); // Panel 1 = ms/Frame ist für Path Tracer aussagekräftiger als FPS

const benchmark = new BenchmarkRun();
let pendingCapture = false;

// Echtzeit-Frame-Zeitmessung mit gl.finish() für GPU-seitige Genauigkeit.
// gl.finish() blockiert bis die GPU fertig ist (stalls Pipeline, daher nur für Messung).
let gpuMsLast = 0;
let measureGpu = false; // nur aktiv während Benchmark

function captureWebp(): void {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pathtracer-webgl.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
}

async function runBenchmark(): Promise<void> {
  resultsEl.style.display = "block";
  resetAccum(); // Szene zurücksetzen: sauberer Nullzustand für die Messung
  resultsEl.textContent = "Szene zurückgesetzt \u2013 Messung läuft (gl.finish aktiv) ...";
  measureGpu = true;
  const result = await benchmark.start();
  measureGpu = false;
  const spf = result.avgMs;
  const sps = (1000 / spf).toFixed(1);
  resultsEl.textContent = [
    `[WebGL] Rendering-Vergleich`,
    `Auflösung: ${canvas.width}×${canvas.height} px`,
    `Akkum-Frames: ${frameIndex}`,
    `Samples/s:  ${sps}`,
    `GPU ms/Sample (gl.finish):`,
    formatResult(result),
  ].join("\n");
}

const gui = new GUI({ title: "Rendering-Vergleich (WebGL)" });
const frameCtrl = gui.add({ frames: 0 }, "frames").name("Akkum-Frames").disable();
const msCtrl    = gui.add({ ms: "– ms" }, "ms").name("Frame-Zeit (GPU)").disable();
setInterval(() => {
  (frameCtrl as { setValue:(v:number)=>void }).setValue(frameIndex);
  (msCtrl as { setValue:(v:string)=>void }).setValue(
    gpuMsLast > 0 ? `${gpuMsLast.toFixed(2)} ms` : "Benchmark starten"
  );
}, 200);
const MODES = { "Whitted-Raytracing": 0, "Path Tracing (naiv)": 1, "Path Tracing (NEE)": 2 } as const;
const ptParams = { mode: 2, maxBounces: 8 };
gui.add(ptParams, "mode", MODES).name("Modus").onChange(resetAccum);
gui.add(ptParams, "maxBounces", 1, 16, 1).name("Max. Bounces").onChange(resetAccum);
gui.add({ reset: resetAccum }, "reset").name("Szene zurücksetzen");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// --- Render-Loop ---------------------------------------------------------

let lastW = 0, lastH = 0;

function render(now: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w   = Math.round(canvas.clientWidth * dpr);
  const h   = Math.round(canvas.clientHeight * dpr);
  if (w !== lastW || h !== lastH || canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    resetAccum();
    lastW = w; lastH = h;
  }

  const cam = orbitVectors();

  // Direkt auf den Canvas rendern (kein FBO): preserveDrawingBuffer + Blending
  gl.useProgram(ptProgram);
  gl.uniform2f(ptU.res, w, h);
  gl.uniform1i(ptU.frame, frameIndex);
  gl.uniform1i(ptU.mode, ptParams.mode);
  gl.uniform1i(ptU.bounces, ptParams.maxBounces);
  gl.uniform3fv(ptU.camPos,   cam.pos);
  gl.uniform3fv(ptU.camRight, cam.right);
  gl.uniform3fv(ptU.camUp,    cam.up);
  gl.uniform3fv(ptU.camFwd,   cam.fwd);

  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);

  // gl.finish() synchronisiert CPU↔GPU und liefert echte GPU-Zeit.
  // Nur während Benchmark aktiv (Performance-Overhead).
  if (measureGpu) {
    const t0 = performance.now();
    gl.finish();
    gpuMsLast = performance.now() - t0;
  }

  frameIndex++;

  // Screenshot-Trigger (einmalig nach Button-Klick)
  if (pendingCapture) {
    pendingCapture = false;
    captureWebp();
  }
  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
