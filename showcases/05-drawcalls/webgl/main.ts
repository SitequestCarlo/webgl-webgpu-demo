import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import {
  getWebGL2, createProgram, createBuffer,
  getUniforms, resizeCanvasToDisplaySize,
} from "../../../src/shared/gl";
import { createCube } from "../../../src/shared/geometry";
import { CpuTimer, createStatsPanel, BenchmarkRun, formatResult } from "../../../src/shared/benchmark";
import { BENCH_VS_GLSL, BENCH_FS_GLSL } from "../../../src/shared/benchShaders";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const gl = getWebGL2(canvas);
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.clearColor(0.06, 0.07, 0.09, 1);

// --- Geometrie ---------------------------------------------------------------

const cube = createCube(0.5);
const vao  = gl.createVertexArray()!;
gl.bindVertexArray(vao);
createBuffer(gl, gl.ARRAY_BUFFER, cube.vertices);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, cube.indices);
gl.bindVertexArray(null);

// --- Shader ------------------------------------------------------------------

const program = createProgram(gl, BENCH_VS_GLSL, BENCH_FS_GLSL);
const U = getUniforms(gl, program, [
  "uModel","uView","uProj","uNormalMatrix",
  "uColor","uLightPos","uViewPos","uLightColor","uAmbient","uShininess",
] as const);

// --- Szene -------------------------------------------------------------------

const proj        = mat4.create();
const view        = mat4.create();
const model       = mat4.create();
const normalMat   = mat3.create();
const cameraPos   = vec3.fromValues(0, 8, 20);
const lightPos    = vec3.fromValues(10, 15, 10);
const lightColor  = vec3.fromValues(1, 0.97, 0.93);

mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

// N Objekte: Positionen in einem 3D-Raster, Farben aus HSL-Spektrum
const MAX_N = 50000;
const posArr   = new Float32Array(MAX_N * 3);
const colorArr = new Float32Array(MAX_N * 3);

function rebuildObjects(n: number): void {
  const side = Math.ceil(Math.cbrt(n));
  const half = (side - 1) / 2;
  const sp = 1.2;
  for (let i = 0; i < n; i++) {
    const ix = i % side, iy = Math.floor(i / side) % side, iz = Math.floor(i / side / side);
    posArr[i * 3]     = (ix - half) * sp;
    posArr[i * 3 + 1] = (iy - half) * sp;
    posArr[i * 3 + 2] = (iz - half) * sp;
    const h = (i / n) * 360;
    const [r, g, b] = hsl(h, 0.7, 0.5);
    colorArr[i * 3] = r; colorArr[i * 3 + 1] = g; colorArr[i * 3 + 2] = b;
  }
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

// --- Params & GUI ------------------------------------------------------------

const params = { n: 1000, autoRotate: true };
let angle = 0;
rebuildObjects(params.n);

const cpuTimer  = new CpuTimer();
const stats     = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1);
const benchmark = new BenchmarkRun(30, 200);

const gui = new GUI({ title: "Draw-Calls (WebGL)" });
gui.add(params, "n", 100, MAX_N, 100).name("N Objekte").onChange((v: number) => rebuildObjects(Math.round(v)));
const cpuCtrl = gui.add({ cpu: "– ms" }, "cpu").name("CPU Draw-Zeit").disable();
gui.add(params, "autoRotate").name("Rotation");
gui.add({ run: async () => {
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${params.n} Draw-Calls ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGL] N=${params.n} Draw-Calls\n${formatResult(r)}\nCPU avg: ${cpuTimer.average.toFixed(2)} ms`;
} }, "run").name("Benchmark starten");

setInterval(() => {
  (cpuCtrl as { setValue:(v:string)=>void }).setValue(`${cpuTimer.average.toFixed(2)} ms`);
}, 300);

// --- Render ------------------------------------------------------------------

let lastT = performance.now();

function render(now: number): void {
  const dt = (now - lastT) / 1000; lastT = now;
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    const a = canvas.width / Math.max(1, canvas.height);
    mat4.perspective(proj, (50 * Math.PI) / 180, a, 0.1, 200);
  }
  if (params.autoRotate) angle += dt * 0.3;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);
  gl.uniformMatrix4fv(U.uView!, false, view);
  gl.uniformMatrix4fv(U.uProj!, false, proj);
  gl.uniform3fv(U.uLightPos!, lightPos);
  gl.uniform3fv(U.uViewPos!, cameraPos);
  gl.uniform3fv(U.uLightColor!, lightColor);
  gl.uniform1f(U.uAmbient!, 0.1);
  gl.uniform1f(U.uShininess!, 32);
  gl.bindVertexArray(vao);

  const n = Math.round(params.n);
  cpuTimer.begin();
  for (let i = 0; i < n; i++) {
    mat4.fromTranslation(model, [posArr[i*3], posArr[i*3+1], posArr[i*3+2]]);
    mat4.rotateY(model, model, angle + i * 0.05);
    mat3.normalFromMat4(normalMat, model);
    gl.uniformMatrix4fv(U.uModel!, false, model);
    gl.uniformMatrix3fv(U.uNormalMatrix!, false, normalMat);
    gl.uniform3fv(U.uColor!, [colorArr[i*3], colorArr[i*3+1], colorArr[i*3+2]]);
    gl.drawElements(gl.TRIANGLES, cube.indexCount, gl.UNSIGNED_INT, 0);
  }
  cpuTimer.end();

  gl.bindVertexArray(null);
  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
