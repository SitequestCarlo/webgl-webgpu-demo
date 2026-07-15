import { GUI } from "lil-gui";
import { mat3, mat4, vec3, vec4 } from "gl-matrix";

import {
  createProgram,
  createBuffer,
  getUniforms,
  resizeCanvasToDisplaySize,
  type UniformMap,
} from "../../src/shared/gl";
import { createUvSphere } from "../../src/shared/geometry";
import {
  BenchmarkRun,
  createStatsPanel,
  formatResult,
} from "../../src/shared/benchmark";
import { VS_SRC, FS_SRC, UNIFORM_NAMES } from "./shaders";

// --- Setup ---------------------------------------------------------------

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const labelsCanvas = document.getElementById("labels") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

// preserveDrawingBuffer ermöglicht canvas.toBlob() für den Screenshot.
const gl = canvas.getContext("webgl2", {
  antialias: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
}) as WebGL2RenderingContext;
if (!gl) throw new Error("WebGL2 wird von diesem Browser nicht unterstützt.");

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.clearColor(1.0, 1.0, 1.0, 1.0);

const program = createProgram(gl, VS_SRC, FS_SRC);
const uniforms: UniformMap = getUniforms(gl, program, UNIFORM_NAMES);

// --- Sphere-Geometrie ----------------------------------------------------

const sphereGeo = createUvSphere(0.5, 48, 32);

const vao = gl.createVertexArray();
if (!vao) throw new Error("createVertexArray fehlgeschlagen.");
gl.bindVertexArray(vao);
createBuffer(gl, gl.ARRAY_BUFFER, sphereGeo.vertices);
const STRIDE = 6 * 4;
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 3 * 4);
createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, sphereGeo.indices);
gl.bindVertexArray(null);

// --- Grid-Parameter ------------------------------------------------------

const COLS = 6;
const ROWS = 6;
const SPACING = 1.25;
// X-Achse: Roughness (links → rechts)
const ROUGHNESS = [0.05, 0.2, 0.4, 0.6, 0.8, 1.0];
// Y-Achse: Metallic (oben → unten)
const METALLIC  = [1.0, 0.8, 0.6, 0.4, 0.2, 0.0];

// --- Kamera / Matrizen ---------------------------------------------------

const proj       = mat4.create();
const view       = mat4.create();
const model      = mat4.create();
const normalMat  = mat3.create();
const projView   = mat4.create();

const cameraPos = vec3.fromValues(0, 0, 9.0);
mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

const FOV_DEG = 52;

function updateProjection(): void {
  const aspect = canvas.width / Math.max(1, canvas.height);
  mat4.perspective(proj, (FOV_DEG * Math.PI) / 180, aspect, 0.1, 50);
  mat4.multiply(projView, proj, view);
}

// Projiziert einen Weltpunkt auf Canvas-Pixel-Koordinaten.
function worldToScreen(x: number, y: number, z: number, w: number, h: number): [number, number] {
  const p = vec4.fromValues(x, y, z, 1);
  const c = vec4.create();
  vec4.transformMat4(c, p, projView);
  return [(c[0] / c[3] + 1) * 0.5 * w, (1 - c[1] / c[3]) * 0.5 * h];
}

// --- Params & GUI --------------------------------------------------------

const params = {
  albedo: [0x8c / 255, 0x2d / 255, 0x82 / 255] as [number, number, number],
  ambient: 0.06,
  lightX: 5.0,
  lightY: 6.0,
  lightZ: 7.0,
  lightIntensity: 4.0,
};

const lightPos   = vec3.create();
const lightColor = vec3.create();

function updateLight(): void {
  vec3.set(lightPos, params.lightX, params.lightY, params.lightZ);
  const i = params.lightIntensity;
  vec3.set(lightColor, i, i * 0.98, i * 0.94);
}
updateLight();

const stats     = createStatsPanel(document.getElementById("app")!);
const benchmark = new BenchmarkRun(60, 300);
let pendingCapture = false;

function captureWebp(): void {
  // GL-Canvas + Label-Canvas zusammenführen.
  const merged = document.createElement("canvas");
  merged.width  = canvas.width;
  merged.height = canvas.height;
  const ctx = merged.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0);
  ctx.drawImage(labelsCanvas, 0, 0);
  merged.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pbr-grid-${new Date().toISOString().replace(/[:.]/g, "-")}.webp`;
      a.click();
      URL.revokeObjectURL(url);
    },
    "image/webp",
    0.92,
  );
}

async function runBenchmark(): Promise<void> {
  resultsEl.style.display = "block";
  resultsEl.textContent = "Messung läuft ...";
  const result = await benchmark.start();
  resultsEl.textContent = `PBR Grid – ${COLS * ROWS} Kugeln\n${formatResult(result)}`;
}

const gui = new GUI({ title: "PBR" });
gui.addColor(params, "albedo").name("Albedo");
gui.add(params, "ambient", 0, 0.4, 0.01).name("Ambient");
const lightFolder = gui.addFolder("Licht");
lightFolder.close();
lightFolder.add(params, "lightX", -12, 12, 0.1).name("X").onChange(updateLight);
lightFolder.add(params, "lightY", -12, 12, 0.1).name("Y").onChange(updateLight);
lightFolder.add(params, "lightZ",   0, 16, 0.1).name("Z").onChange(updateLight);
lightFolder.add(params, "lightIntensity", 0.5, 10, 0.1).name("Intensität").onChange(updateLight);
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (webp)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// --- Achsenbeschriftung (2D-Canvas-Overlay) ------------------------------

const labelsCtx = labelsCanvas.getContext("2d")!;

function drawLabels(): void {
  const w = labelsCanvas.width;
  const h = labelsCanvas.height;
  labelsCtx.clearRect(0, 0, w, h);

  const fs = Math.max(11, Math.round(w * 0.015));
  const fsSmall = Math.max(10, Math.round(w * 0.012));

  // --- Roughness-Werte (unter der untersten Reihe) ---
  labelsCtx.font = `${fsSmall}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#6b7280";
  labelsCtx.textAlign = "center";
  labelsCtx.textBaseline = "top";
  const bottomRowY = -((ROWS - 1) / 2) * SPACING;
  for (let col = 0; col < COLS; col++) {
    const wx = (col - (COLS - 1) / 2) * SPACING;
    const [sx, sy] = worldToScreen(wx, bottomRowY - SPACING * 0.6, 0, w, h);
    labelsCtx.fillText(ROUGHNESS[col].toFixed(2).replace(/\.?0+$/, "") || "0", sx, sy);
  }

  // Roughness-Titel
  labelsCtx.font = `bold ${fs}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#374151";
  const [, titleY] = worldToScreen(0, bottomRowY - SPACING * 1.1, 0, w, h);
  labelsCtx.fillText("Roughness →", w * 0.5, titleY);

  // --- Metallic-Werte (links der linken Spalte) ---
  labelsCtx.font = `${fsSmall}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#6b7280";
  labelsCtx.textAlign = "right";
  labelsCtx.textBaseline = "middle";
  const leftColX = -((COLS - 1) / 2) * SPACING;
  for (let row = 0; row < ROWS; row++) {
    const wy = ((ROWS - 1) / 2 - row) * SPACING;
    const [sx, sy] = worldToScreen(leftColX - SPACING * 0.55, wy, 0, w, h);
    labelsCtx.fillText(METALLIC[row].toFixed(1), sx, sy);
  }

  // Metallic-Titel (rotiert)
  const [titleX] = worldToScreen(leftColX - SPACING * 1.05, 0, 0, w, h);
  labelsCtx.save();
  labelsCtx.translate(Math.max(titleX, fs * 1.2), h * 0.5);
  labelsCtx.rotate(-Math.PI / 2);
  labelsCtx.textAlign = "center";
  labelsCtx.textBaseline = "middle";
  labelsCtx.font = `bold ${fs}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#374151";
  labelsCtx.fillText("↑ Metallic", 0, 0);
  labelsCtx.restore();
}

// --- Render-Loop ---------------------------------------------------------

function render(now: number): void {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    labelsCanvas.width  = canvas.width;
    labelsCanvas.height = canvas.height;
  }
  updateProjection();

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);

  // Gemeinsame Uniforms
  gl.uniformMatrix4fv(uniforms["uView"]!, false, view);
  gl.uniformMatrix4fv(uniforms["uProj"]!, false, proj);
  gl.uniform3fv(uniforms["uAlbedo"]!, params.albedo);
  gl.uniform3fv(uniforms["uLightPos"]!, lightPos);
  gl.uniform3fv(uniforms["uLightColor"]!, lightColor);
  gl.uniform3fv(uniforms["uViewPos"]!, cameraPos);
  gl.uniform1f(uniforms["uAmbient"]!, params.ambient);

  gl.bindVertexArray(vao);

  // 6×6 Kugeln mit variierendem Roughness (X) und Metallic (Y)
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tx = (col - (COLS - 1) / 2) * SPACING;
      const ty = ((ROWS - 1) / 2 - row) * SPACING;

      mat4.fromTranslation(model, vec3.fromValues(tx, ty, 0));
      mat3.normalFromMat4(normalMat, model);

      gl.uniformMatrix4fv(uniforms["uModel"]!, false, model);
      gl.uniformMatrix3fv(uniforms["uNormalMatrix"]!, false, normalMat);
      gl.uniform1f(uniforms["uRoughness"]!, ROUGHNESS[col]);
      gl.uniform1f(uniforms["uMetallic"]!, METALLIC[row]);

      gl.drawElements(gl.TRIANGLES, sphereGeo.indexCount, gl.UNSIGNED_INT, 0);
    }
  }

  gl.bindVertexArray(null);

  drawLabels();

  if (pendingCapture) {
    pendingCapture = false;
    captureWebp();
  }

  stats.update();
  benchmark.sample(now);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
