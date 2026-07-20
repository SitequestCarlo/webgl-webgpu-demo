// N-Body Simulation Showcase – WebGL2
// Gravitationssimulation O(N²): jedes Partikel wird von allen anderen angezogen.
//
// WebGL-Ansatz: Simulation via Textur-Ping-Pong.
// Jede Partikelposition ist ein Texel einer RGBA32F-Textur (sz×sz).
// Der Simulations-Pass rendert auf ein Offscreen-FBO: der Fragment-Shader
// liest für jeden Texel alle N Positionen aus der Quelltextur (N Textur-Fetches).
// Kein Compute-Shader verfügbar — deshalb diese Umgehungslösung.

import { GUI } from "lil-gui";
import { mat4 } from "gl-matrix";
import '/src/shared/showcase.css';
import { createProgram } from "../../../src/shared/gl";
import { createStatsPanel, BenchmarkRun, formatResult } from "../../../src/shared/benchmark";
import { splitGLSL } from "../../../src/shared/splitGLSL";
import simulateGlsl from "../shaders/gl/simulate.glsl?raw";
import renderGlsl   from "../shaders/gl/render.glsl?raw";

const [SIM_VS, _SIM_FS_BASE] = splitGLSL(simulateGlsl);
const [PASS_VS, PASS_FS]     = splitGLSL(renderGlsl);
// buildSimFS ersetzt #define N 256 durch den aktuellen Wert.
// WebGL GLSL benötigt eine compile-time Konstante für Loop-Grenzen (GLSL ES 3.0).
// Bei jedem N-Wechsel muss der Shader daher neu kompiliert werden.
function buildSimFS(n: number): string {
  return _SIM_FS_BASE.replace('#define N 256', `#define N ${n}`);
}

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const gl = canvas.getContext("webgl2", { antialias: false })!;
if (!gl) throw new Error("WebGL2 nicht verfügbar.");
gl.getExtension("EXT_color_buffer_float");

// --- Szene ------------------------------------------------------------------

let N = 256;
let texSize = Math.ceil(Math.sqrt(N)); // Textur-Seitenlänge

// Zwei Ping-Pong FBOs (Position + Velocity)
interface NBodyFBO { fbo: WebGLFramebuffer; posTex: WebGLTexture; velTex: WebGLTexture; }

function createFBOPair(sz: number): NBodyFBO {
  const create = () => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sz, sz, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  };
  const posTex = create(), velTex = create();
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, posTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, posTex, velTex };
}

function initParticles(sz: number, n: number): { posData: Float32Array; velData: Float32Array } {
  const posData = new Float32Array(sz * sz * 4);
  const velData = new Float32Array(sz * sz * 4);
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2, phi = Math.random() * Math.PI;
    const r = 2 + Math.random() * 3;
    posData[i*4]   = r * Math.sin(phi) * Math.cos(theta);
    posData[i*4+1] = r * Math.sin(phi) * Math.sin(theta);
    posData[i*4+2] = r * Math.cos(phi);
    posData[i*4+3] = 0.5 + Math.random() * 1.5; // mass
    // Orbital velocity
    const speed = 0.02 + Math.random() * 0.03;
    velData[i*4]   = -posData[i*4+1] * speed;
    velData[i*4+1] =  posData[i*4]   * speed;
    velData[i*4+2] =  0;
  }
  return { posData, velData };
}

function uploadInitial(fbo: NBodyFBO, sz: number, posData: Float32Array, velData: Float32Array): void {
  gl.bindTexture(gl.TEXTURE_2D, fbo.posTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sz, sz, 0, gl.RGBA, gl.FLOAT, posData);
  gl.bindTexture(gl.TEXTURE_2D, fbo.velTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sz, sz, 0, gl.RGBA, gl.FLOAT, velData);
}

let fboA: NBodyFBO, fboB: NBodyFBO;
let readFBO: NBodyFBO, writeFBO: NBodyFBO;
let simProgram: WebGLProgram, passProgram: WebGLProgram;
let quadVAO: WebGLVertexArrayObject, pointVAO: WebGLVertexArrayObject;

function rebuild(): void {
  texSize = Math.ceil(Math.sqrt(N));
  fboA = createFBOPair(texSize);
  fboB = createFBOPair(texSize);
  const { posData, velData } = initParticles(texSize, N);
  uploadInitial(fboA, texSize, posData, velData);
  uploadInitial(fboB, texSize, posData, velData);
  readFBO = fboA; writeFBO = fboB;

  simProgram  = createProgram(gl, SIM_VS, buildSimFS(N));
  passProgram = createProgram(gl, PASS_VS, PASS_FS);

  // Fullscreen quad UV
  const uvs = new Float32Array([0,0, 1,0, 0,1, 1,0, 1,1, 0,1]);
  quadVAO = gl.createVertexArray()!;
  gl.bindVertexArray(quadVAO);
  const qb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);

  // Point indices
  const idx = new Float32Array(N); for (let i = 0; i < N; i++) idx[i] = i;
  pointVAO = gl.createVertexArray()!;
  gl.bindVertexArray(pointVAO);
  const pb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 4, 0);
  gl.bindVertexArray(null);
}

// --- GUI --------------------------------------------------------------------

const params = { N: 256, dt: 0.002, softening: 0.1 };
rebuild();

const stats = createStatsPanel(document.getElementById("app")!); stats.showPanel(1);
const benchmark = new BenchmarkRun(10, 100);

const gui = new GUI({ title: "N-Body (WebGL)" });
let pendingCapture = false;
gui.add(params, "N", [64, 128, 256, 512, 1024, 2048, 4096]).name("N Partikel").onChange((v: number) => { N = v; rebuild(); });
gui.add(params, "dt", 0.0005, 0.01, 0.0001).name("Zeitschritt");
gui.add(params, "softening", 0.01, 1.0, 0.01).name("Softening");
gui.add({ run: async () => {
  resultsEl.style.display = "block"; resultsEl.textContent = `Messe N=${N} ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGL] N-Body N=${N}\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

// --- Render Loop ------------------------------------------------------------

const viewProj = mat4.create();
const view4 = mat4.create(), proj4 = mat4.create();
mat4.lookAt(view4, [0, 4, 12], [0, 0, 0], [0, 1, 0]);

function resizeCanvas(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function render(now: number): void {
  resizeCanvas();
  mat4.perspective(proj4, Math.PI / 3.6, canvas.width / Math.max(1, canvas.height), 0.01, 200);
  mat4.multiply(viewProj, proj4, view4);

  // --- Simulations-Pass (Offscreen-FBO) ---
  // Fragment-Shader liest für jeden Partikel-Texel alle N Positionen:
  // N Textur-Fetches pro Fragment × N Fragmente = O(N²) Operationen.
  gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fbo);
  gl.viewport(0, 0, texSize, texSize);
  gl.useProgram(simProgram);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, readFBO.posTex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, readFBO.velTex);
  gl.uniform1i(gl.getUniformLocation(simProgram, "uPos"), 0);
  gl.uniform1i(gl.getUniformLocation(simProgram, "uVel"), 1);
  gl.uniform1f(gl.getUniformLocation(simProgram, "uDt"), params.dt);
  gl.uniform1f(gl.getUniformLocation(simProgram, "uSoftening"), params.softening);
  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // --- Render-Pass (Canvas) ---
  // Partikel als GL_POINTS rendern; Vertex-Shader liest Position aus der FBO-Textur.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(passProgram);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, writeFBO.posTex);
  gl.uniform1i(gl.getUniformLocation(passProgram, "uPos"), 0);
  gl.uniformMatrix4fv(gl.getUniformLocation(passProgram, "uViewProj"), false, viewProj);
  gl.uniform1f(gl.getUniformLocation(passProgram, "uTexSize"), texSize);
  gl.bindVertexArray(pointVAO);
  gl.drawArrays(gl.POINTS, 0, N);
  gl.disable(gl.BLEND);

  [readFBO, writeFBO] = [writeFBO, readFBO]; // Ping-Pong: nächster Frame liest den gerade beschriebenen Buffer

  // Screenshot-Trigger (einmalig nach Button-Klick)
  if (pendingCapture) {
    pendingCapture = false;
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'nbody-webgl.png'; a.click();
    }, 'image/png');
  }
  stats.update(); benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
