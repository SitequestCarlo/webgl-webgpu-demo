import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";

import {
  getWebGL2,
  createProgram,
  createBuffer,
  getUniforms,
  resizeCanvasToDisplaySize,
  type UniformMap,
} from "../../src/shared/gl";
import { createTriangle, createUvSphere, type Geometry } from "../../src/shared/geometry";
import {
  BenchmarkRun,
  createStatsPanel,
  formatResult,
} from "../../src/shared/benchmark";
import {
  SHADER_SOURCES,
  SHADING_MODES,
  UNIFORM_NAMES,
  type ShadingMode,
} from "./shaders";

// --- Setup ---------------------------------------------------------------

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const gl = getWebGL2(canvas);

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.clearColor(1.0, 1.0, 1.0, 1.0);

// Ein Programm pro Shading-Modus vorkompilieren.
interface CompiledProgram {
  program: WebGLProgram;
  uniforms: UniformMap;
}
const programs = {} as Record<ShadingMode, CompiledProgram>;
for (const mode of SHADING_MODES) {
  const src = SHADER_SOURCES[mode];
  const program = createProgram(gl, src.vertex, src.fragment);
  programs[mode] = {
    program,
    uniforms: getUniforms(gl, program, UNIFORM_NAMES),
  };
}

// --- Geometrie / VAOs ----------------------------------------------------

interface GpuGeometry {
  vao: WebGLVertexArrayObject;
  indexCount: number;
}

function uploadGeometry(geo: Geometry): GpuGeometry {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray fehlgeschlagen.");
  gl.bindVertexArray(vao);

  createBuffer(gl, gl.ARRAY_BUFFER, geo.vertices);
  const stride = 6 * 4; // 6 floats * 4 byte
  // Location 0: Position
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  // Location 1: Normale
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);

  createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geo.indices);

  gl.bindVertexArray(null);
  return { vao, indexCount: geo.indexCount };
}

const params = {
  shading: "blinn-phong" as ShadingMode,
  segments: 32,
  rings: 16,
  autoRotate: false,
  color: [0x8c / 255, 0x2d / 255, 0x82 / 255] as [number, number, number],
  ambient: 0.12,
  shininess: 48,
  wireframe: false,
};

let triangle = uploadGeometry(createTriangle());
let sphere = uploadGeometry(createUvSphere(1, params.segments, params.rings));

function rebuildSphere(): void {
  gl.deleteVertexArray(sphere.vao);
  sphere = uploadGeometry(createUvSphere(1, params.segments, params.rings));
}

// --- Kamera / Matrizen ---------------------------------------------------

const proj = mat4.create();
const view = mat4.create();
const model = mat4.create();
const normalMatrix = mat3.create();

const cameraPos = vec3.fromValues(0, 0, 3.2);
const lightPos = vec3.fromValues(2.5, 3.0, 3.0);
// Dreieck: Licht direkt davor auf der +z-Achse (entlang seiner Normale).
const triangleLightPos = vec3.fromValues(0, 0, 3.0);
const lightColor = vec3.fromValues(1.0, 0.98, 0.95);
// Dreieck: gedimmt, da frontales Licht sonst überstrahlt.
const triangleLightColor = vec3.fromValues(0.55, 0.54, 0.52);

mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

function updateProjection(): void {
  // Beide Objekte teilen sich die Breite -> Aspekt einer Hälfte.
  const halfWidth = canvas.width / 2;
  const aspect = halfWidth / Math.max(1, canvas.height);
  mat4.perspective(proj, (50 * Math.PI) / 180, aspect, 0.1, 100);
}

// --- Benchmark -----------------------------------------------------------

const stats = createStatsPanel(document.getElementById("app")!);
const benchmark = new BenchmarkRun(60, 300);

async function runBenchmark(): Promise<void> {
  resultsEl.style.display = "block";
  resultsEl.textContent = "Messung läuft ...";
  const result = await benchmark.start();
  resultsEl.textContent =
    `Shading: ${params.shading}\n` +
    `Kugel-Tris: ${sphere.indexCount / 3}\n` +
    formatResult(result);
}

// Screenshot des reinen Canvas (ohne DOM-UI) als webp herunterladen.
// Wird im Render-Frame direkt nach dem Zeichnen ausgeführt.
let pendingCapture = false;

function captureWebp(): void {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `shading-${params.shading}-${ts}.webp`;
      a.click();
      URL.revokeObjectURL(url);
    },
    "image/webp",
    0.92,
  );
}

// --- GUI -----------------------------------------------------------------

const gui = new GUI({ title: "Shading" });
gui.add(params, "shading", SHADING_MODES).name("Shading");
const geoFolder = gui.addFolder("Kugel-Tessellierung");
geoFolder.close();
geoFolder.add(params, "segments", 3, 128, 1).name("Segmente").onFinishChange(rebuildSphere);
geoFolder.add(params, "rings", 2, 64, 1).name("Ringe").onFinishChange(rebuildSphere);
const lightFolder = gui.addFolder("Material / Licht");
lightFolder.close();
lightFolder.addColor(params, "color").name("Farbe");
lightFolder.add(params, "ambient", 0, 1, 0.01).name("Ambient");
lightFolder.add(params, "shininess", 1, 256, 1).name("Glanz");
gui.add(params, "wireframe").name("Wireframe");
gui.add(params, "autoRotate").name("Auto-Rotieren");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (webp)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// --- Render-Loop ---------------------------------------------------------

let angle = 0;
let lastFrame = performance.now();

function render(now: number): void {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  updateProjection();

  if (params.autoRotate) angle += dt * 0.6;

  mat4.identity(model);
  mat4.rotateY(model, model, angle);
  mat4.rotateX(model, model, angle * 0.35);
  mat3.normalFromMat4(normalMatrix, model);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const { program, uniforms } = programs[params.shading];
  gl.useProgram(program);

  gl.uniformMatrix4fv(uniforms.uModel!, false, model);
  gl.uniformMatrix4fv(uniforms.uView!, false, view);
  gl.uniformMatrix4fv(uniforms.uProj!, false, proj);
  if (uniforms.uNormalMatrix) gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, normalMatrix);
  if (uniforms.uColor) gl.uniform3fv(uniforms.uColor, params.color);
  if (uniforms.uViewPos) gl.uniform3fv(uniforms.uViewPos, cameraPos);
  if (uniforms.uAmbient) gl.uniform1f(uniforms.uAmbient, params.ambient);
  if (uniforms.uShininess) gl.uniform1f(uniforms.uShininess, params.shininess);

  const drawMode = params.wireframe ? gl.LINE_STRIP : gl.TRIANGLES;
  const halfWidth = Math.floor(canvas.width / 2);

  // Links: Dreieck (einseitig -> Culling aus), Licht direkt davor (gedimmt).
  if (uniforms.uLightPos) gl.uniform3fv(uniforms.uLightPos, triangleLightPos);
  if (uniforms.uLightColor) gl.uniform3fv(uniforms.uLightColor, triangleLightColor);
  gl.viewport(0, 0, halfWidth, canvas.height);
  gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(triangle.vao);
  gl.drawElements(drawMode, triangle.indexCount, gl.UNSIGNED_INT, 0);

  // Rechts: Kugel (geschlossen -> Backface-Culling an), seitliches Licht.
  if (uniforms.uLightPos) gl.uniform3fv(uniforms.uLightPos, lightPos);
  if (uniforms.uLightColor) gl.uniform3fv(uniforms.uLightColor, lightColor);
  gl.viewport(halfWidth, 0, canvas.width - halfWidth, canvas.height);
  gl.enable(gl.CULL_FACE);
  gl.bindVertexArray(sphere.vao);
  gl.drawElements(drawMode, sphere.indexCount, gl.UNSIGNED_INT, 0);

  gl.bindVertexArray(null);

  if (pendingCapture) {
    pendingCapture = false;
    captureWebp();
  }

  stats.update();
  benchmark.sample(now);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
