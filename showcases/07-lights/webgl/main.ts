// Multi-Light Showcase – WebGL2
// Misst Fragment-Shader-Last unter N Punktlichtquellen (Blinn-Phong).
//
// WebGL-spezifisch: MAX_LIGHTS ist eine compile-time Konstante im GLSL-Shader.
// Die aktive Anzahl wird per uNumLights-Uniform gesetzt — kein Shader-Rebuild nötig.
// Pro Frame entstehen N × 2 gl.uniform3f()-Aufrufe: API-Overhead wächst linear mit N.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import {
  getWebGL2, createProgram, createBuffer, getUniforms, resizeCanvasToDisplaySize, GlTimer, glFenceAsync,
} from "../../../src/shared/gl";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult, CpuTimer, readBenchmarkValue } from "../../../src/shared/benchmark";
import { splitGLSL } from "../../../src/shared/splitGLSL";
import multiLightGlsl from "../shaders/gl/multi-light.glsl?raw";

// ---------------------------------------------------------------------------
// Konstante & Shader-Vorbereitung
// ---------------------------------------------------------------------------

/** Maximale Lichtanzahl — compile-time Grenze des GLSL-Arrays.
 * WebGL2-Limit: 2×MAX_LIGHTS vec3-Uniforms müssen in MAX_FRAGMENT_UNIFORM_VECTORS passen.
 * Bei 1024 vec4-Slots (Minimum-Garantie) und 2 Arrays à N vec4 bleiben ~500 nutzbar.
 * → In der Praxis sicherer Wert: 256. */
const MAX_LIGHTS = 256;

// Shader aus einer kombinierten GLSL-Datei aufteilen (VS || FS, getrennt durch #version)
const [ML_VS_GLSL, ML_FS_GLSL] = splitGLSL(multiLightGlsl);

// ---------------------------------------------------------------------------
// 1. Canvas & WebGL2-Kontext
// ---------------------------------------------------------------------------

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const gl = getWebGL2(canvas);
gl.enable(gl.DEPTH_TEST);          // Tiefentest: verdeckte Fragmente verwerfen
gl.enable(gl.CULL_FACE);           // Backface Culling: Rückseiten nicht zeichnen
gl.clearColor(0.02, 0.02, 0.04, 1);

// ---------------------------------------------------------------------------
// 2. Shader-Programm
// ---------------------------------------------------------------------------

// Shader einmalig mit MAX_LIGHTS=256 kompilieren.
// uNumLights steuert zur Laufzeit, wie viele der 256 Slots aktiv sind.
const program = createProgram(gl, ML_VS_GLSL, ML_FS_GLSL);
const U = getUniforms(gl, program, [
  "uModel", "uView", "uProj", "uNormalMatrix", "uViewPos",
  "uAmbient", "uShininess", "uNumLights",
] as const);

// Licht-Uniform-Locations einmalig cachen — gl.getUniformLocation im Render-Loop
// wäre zu teuer (N zusätzliche String-Lookups pro Frame).
const lightPosLocs:   (WebGLUniformLocation | null)[] = [];
const lightColorLocs: (WebGLUniformLocation | null)[] = [];
for (let i = 0; i < MAX_LIGHTS; i++) {
  lightPosLocs.push(gl.getUniformLocation(program,   `uLightPos[${i}]`));
  lightColorLocs.push(gl.getUniformLocation(program, `uLightColor[${i}]`));
}

// ---------------------------------------------------------------------------
// 3. Geometrie
// ---------------------------------------------------------------------------

// Dichte UV-Kugel (200×100 ≈ 40 k Dreiecke) — Fragment-Shader ist der Engpass,
// nicht der Vertex-Shader. So wird der Overhead durch viele Lichter sichtbar.
const geo = createUvSphere(1, 200, 100);

const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);
createBuffer(gl, gl.ARRAY_BUFFER, geo.vertices);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);  // Position (loc 0)
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12); // Normale  (loc 1)
createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geo.indices);
gl.bindVertexArray(null);

// ---------------------------------------------------------------------------
// 4. Szene: Kamera & Lichtdaten
// ---------------------------------------------------------------------------

const proj      = mat4.create();
const view      = mat4.create();
const model     = mat4.create();
const normalMat = mat3.create();
const cameraPos = vec3.fromValues(0, 0, 2.5);
mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

/** Erzeugt Startfarben und Positionen für n Lichtquellen auf einer Kreisbahn. */
function buildLights(n: number): { pos: Float32Array; col: Float32Array } {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1.5 + 0.8 * Math.sin(i * 2.3);
    pos[i*3]   = Math.cos(a) * r;
    pos[i*3+1] = Math.sin(a * 0.7) * 1.2;
    pos[i*3+2] = Math.sin(a) * r;
    const [R, G, B] = hsl((i / n) * 360, 1, 0.6);
    col[i*3] = R; col[i*3+1] = G; col[i*3+2] = B;
  }
  return { pos, col };
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

// ---------------------------------------------------------------------------
// 5. GUI & Benchmark
// ---------------------------------------------------------------------------

const params = { numLights: readBenchmarkValue() ?? 16, autoRotate: true };
let lights   = buildLights(params.numLights);

const stats     = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1); // ms/Frame statt FPS anzeigen
const benchmark = new BenchmarkRun({ warmupMs: 1500, measureMs: 1, minFrames: 500 });
const gpuTimer  = new GlTimer(gl);
const cpuTimer  = new CpuTimer();

const gui = new GUI({ title: "Multi-Light (WebGL)" });
let pendingCapture = false;

gui.add(params, "numLights", 1, MAX_LIGHTS, 1)
  .name("Lichtquellen")
  .onChange((v: number) => { lights = buildLights(Math.round(v)); });
gui.add(params, "autoRotate").name("Rotation");

// Einzelner Benchmark beim aktuellen N-Wert
gui.add({ run: async () => {
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${params.numLights} Lichter ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGL] ${params.numLights} Lichter\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");

gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

// ---------------------------------------------------------------------------
// 6. Render-Loop
// ---------------------------------------------------------------------------

let angle = 0;
let lastT = performance.now();

async function render(now: number): Promise<void> {
  const dt = (now - lastT) / 1000; lastT = now;

  // Canvas-Resize: Viewport und Projektionsmatrix anpassen
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    mat4.perspective(proj, Math.PI / 3.6, canvas.width / Math.max(1, canvas.height), 0.1, 50);
  }

  // Modellrotation aktualisieren
  if (params.autoRotate) angle += dt * 0.4;
  mat4.identity(model); mat4.rotateY(model, model, angle);
  mat3.normalFromMat4(normalMat, model);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // CPU-Messung: Szene- + N×2 Licht-Uniforms hochladen und Draw absetzen.
  // Jeder gl.uniform*-Aufruf ist ein JS→Native-Übergang — der API-Overhead wächst
  // linear mit N (Gegenstück zu WebGPUs einzelnem writeBuffer).
  cpuTimer.begin();
  gl.useProgram(program);

  // Szene-Uniforms (Matrizen, Kamera, Material)
  gl.uniformMatrix4fv(U.uModel!,        false, model);
  gl.uniformMatrix4fv(U.uView!,         false, view);
  gl.uniformMatrix4fv(U.uProj!,         false, proj);
  gl.uniformMatrix3fv(U.uNormalMatrix!, false, normalMat);
  gl.uniform3fv(U.uViewPos!,  cameraPos);
  gl.uniform1f(U.uAmbient!,   0.05);
  gl.uniform1f(U.uShininess!, 64);

  // Licht-Uniforms schreiben: N × 2 gl.uniform3f-Aufrufe = messbarer API-Overhead.
  // Jeder Aufruf ist ein JS→Native-Übergang — das ist der Kernunterschied zu WebGPU.
  const n = Math.round(params.numLights);
  gl.uniform1i(U.uNumLights!, n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + angle * 0.5;  // animierte Position
    const r = 1.5 + 0.5 * Math.sin(i * 2.3);
    gl.uniform3f(lightPosLocs[i]!,  Math.cos(a) * r, Math.sin(a * 0.7) * 1.2, Math.sin(a) * r);
    gl.uniform3fv(lightColorLocs[i]!, [lights.col[i*3], lights.col[i*3+1], lights.col[i*3+2]]);
  }

  // Kugel zeichnen
  gl.bindVertexArray(vao);
  gpuTimer.begin();
  gl.drawElements(gl.TRIANGLES, geo.indexCount, gl.UNSIGNED_INT, 0);
  gpuTimer.end();
  gl.bindVertexArray(null);
  cpuTimer.end();

  // Screenshot-Trigger (einmalig nach Button-Klick)
  if (pendingCapture) {
    pendingCapture = false;
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'lights-webgl.png'; a.click();
    }, 'image/png');
  }

  stats.update();
  if (benchmark.isRunning) await glFenceAsync(gl); // GPU-Sync (async) → Timer-Query verfügbar
  benchmark.sample(now, gpuTimer.takeSample() ?? undefined, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
