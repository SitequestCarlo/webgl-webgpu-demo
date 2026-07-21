// Vertex Throughput Showcase – WebGL2
// Misst GPU-seitigen Vertex-Shader-Durchsatz bei skalierender Dreieckanzahl.
//
// GPU-Timing: EXT_disjoint_timer_query_webgl2 misst die echte GPU-Renderzeit
// asynchron (ns-genau), ohne den CPU-Thread mit gl.finish() zu blockieren.
// Heavy VS: 8 zusätzliche sin/cos-Operationen pro Vertex simulieren teure Skinning-Berechnungen.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import { getWebGL2, createProgram, createBuffer, getUniforms, resizeCanvasToDisplaySize, GlTimer, glFenceAsync } from "../../../src/shared/gl";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult, CpuTimer, readBenchmarkValue } from "../../../src/shared/benchmark";
import { splitGLSL } from "../../../src/shared/splitGLSL";
import vertexSimpleGlsl from "../shaders/gl/vertex-simple.glsl?raw";

const BENCH_FS_GLSL = splitGLSL(vertexSimpleGlsl)[1];

// Einfacher und schwerer Vertex-Shader für Vergleich
const VS_SIMPLE = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel,uView,uProj;
uniform mat3 uNormalMatrix;
out vec3 vWorldPos, vNormal;
void main(){
  vec4 w=uModel*vec4(aPosition,1.0);
  vWorldPos=w.xyz; vNormal=uNormalMatrix*aNormal;
  gl_Position=uProj*uView*w;
}`;

// Heavy VS: zusätzliche teure Berechnungen pro Vertex (Skinning-ähnlich)
const VS_HEAVY = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel,uView,uProj;
uniform mat3 uNormalMatrix;
uniform float uTime;
out vec3 vWorldPos, vNormal;
void main(){
  // Teure Displacement-Berechnung pro Vertex
  float d=0.0;
  for(int i=0;i<8;i++){
    d+=sin(aPosition.x*float(i+1)+uTime)*cos(aPosition.y*float(i+1)+uTime)
      *sin(aPosition.z*float(i+1)+uTime)*0.02;
  }
  vec3 pos=aPosition+aNormal*d;
  vec4 w=uModel*vec4(pos,1.0);
  vWorldPos=w.xyz; vNormal=uNormalMatrix*aNormal;
  gl_Position=uProj*uView*w;
}`;

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const gl = getWebGL2(canvas);
gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(0.06, 0.07, 0.09, 1);

const programSimple = createProgram(gl, VS_SIMPLE, BENCH_FS_GLSL);
const programHeavy  = createProgram(gl, VS_HEAVY,  BENCH_FS_GLSL);
const uSimple = getUniforms(gl, programSimple, ["uModel","uView","uProj","uNormalMatrix","uColor","uLightPos","uViewPos","uLightColor","uAmbient","uShininess"] as const);
const uHeavy  = getUniforms(gl, programHeavy,  ["uModel","uView","uProj","uNormalMatrix","uColor","uLightPos","uViewPos","uLightColor","uAmbient","uShininess","uTime"] as const);
let program = programSimple;
let U       = uSimple;

const proj = mat4.create(), view = mat4.create(), model = mat4.create(), normalMat = mat3.create();
const cameraPos = vec3.fromValues(0, 0, 3), lightPos = vec3.fromValues(4, 6, 4);
mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

let currentVao: WebGLVertexArrayObject | null = null;
let currentIndexCount = 0;
let currentTriCount = 0;

function buildMesh(segments: number, rings: number): void {
  if (currentVao) gl.deleteVertexArray(currentVao);
  const geo = createUvSphere(1, segments, rings);
  currentIndexCount = geo.indexCount;
  currentTriCount   = geo.indexCount / 3;
  currentVao = gl.createVertexArray()!;
  gl.bindVertexArray(currentVao);
  createBuffer(gl, gl.ARRAY_BUFFER, geo.vertices);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geo.indices);
  gl.bindVertexArray(null);
}

const params = { segments: readBenchmarkValue() ?? 200, rings: 100, autoRotate: true, heavyVS: false };
buildMesh(params.segments, params.rings);

const stats = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1);
const benchmark = new BenchmarkRun({ warmupMs: 2500, measureMs: 1, minFrames: 1000 });
const gpuTimer  = new GlTimer(gl);
const cpuTimer  = new CpuTimer();

const gui = new GUI({ title: "Vertex Throughput (WebGL)" });
let pendingCapture = false;
const triCtrl = gui.add({ tri: "–" }, "tri").name("Dreiecke").disable();
  const msCtrl  = gui.add({ ms: "– ms" }, "ms").name(gpuTimer.enabled ? "GPU-Zeit (Query)" : "GPU-Zeit").disable();
gui.add(params, "segments", 10, 20000, 1).name("Segmente").onFinishChange(() => buildMesh(params.segments, params.rings));
gui.add(params, "rings",    10, 1000, 1).name("Ringe").onFinishChange(()    => buildMesh(params.segments, params.rings));
gui.add(params, "heavyVS").name("Heavy VS").onChange((v: boolean) => {
  program = v ? programHeavy : programSimple;
  U       = v ? uHeavy       : uSimple;
});
gui.add(params, "autoRotate").name("Rotation");
gui.add({ run: async () => {
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${(currentTriCount/1000).toFixed(0)}k Dreiecke ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGL] ${(currentTriCount/1000).toFixed(0)}k Dreiecke${params.heavyVS ? " (Heavy VS)" : ""}\n${formatResult(r)}\nGPU avg: ${gpuTimer.lastMs.toFixed(3)} ms`;
} }, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");
setInterval(() => {
  (triCtrl as {setValue:(v:string)=>void}).setValue(`${(currentTriCount/1000).toFixed(0)}k`);
  (msCtrl  as {setValue:(v:string)=>void}).setValue(`${gpuTimer.lastMs.toFixed(3)} ms`);
}, 300);

let angle = 0, lastT = performance.now();

async function render(now: number): Promise<void> {
  const dt = (now - lastT) / 1000; lastT = now;
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    mat4.perspective(proj, (50 * Math.PI) / 180, canvas.width / Math.max(1, canvas.height), 0.1, 100);
  }
  if (params.autoRotate) angle += dt * 0.5;
  mat4.identity(model); mat4.rotateY(model, model, angle);
  mat3.normalFromMat4(normalMat, model);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  cpuTimer.begin();
  gl.useProgram(program);
  gl.uniformMatrix4fv(U.uModel!, false, model);
  gl.uniformMatrix4fv(U.uView!, false, view);
  gl.uniformMatrix4fv(U.uProj!, false, proj);
  gl.uniformMatrix3fv(U.uNormalMatrix!, false, normalMat);
  gl.uniform3fv(U.uColor!, [0.55, 0.17, 0.51]);
  gl.uniform3fv(U.uLightPos!, lightPos);
  gl.uniform3fv(U.uViewPos!, cameraPos);
  gl.uniform3fv(U.uLightColor!, [1, 0.97, 0.93]);
  gl.uniform1f(U.uAmbient!, 0.08);
  gl.uniform1f(U.uShininess!, 48);
  if (params.heavyVS && U.uTime) gl.uniform1f(U.uTime, now * 0.001);
  // GPU-TIMING: asynchrone Timestamp-Query misst die echte GPU-Zeit dieses
  // Draw-Calls, ohne den CPU-Thread zu blockieren.
  gl.bindVertexArray(currentVao);
  gpuTimer.begin();
  gl.drawElements(gl.TRIANGLES, currentIndexCount, gl.UNSIGNED_INT, 0);
  gpuTimer.end();
  gl.bindVertexArray(null);
  cpuTimer.end();
  // Screenshot-Trigger (einmalig nach Button-Klick)
  if (pendingCapture) {
    pendingCapture = false;
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'vertex-webgl.png'; a.click();
    }, 'image/png');
  }
  stats.update();
  if (benchmark.isRunning) await glFenceAsync(gl); // GPU-Sync (async) → Timer-Query verfügbar
  benchmark.sample(now, gpuTimer.takeSample() ?? undefined, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
