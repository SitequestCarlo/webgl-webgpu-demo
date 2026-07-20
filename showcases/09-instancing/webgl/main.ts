// Instanced Rendering Showcase – WebGL2
// N Instanzen in einem einzigen Draw-Call (gl.drawElementsInstanced).
//
// WebGL-Ansatz: Per-Instanz-Daten (Position + Farbe) liegen in einem Vertex-Buffer
// mit vertexAttribDivisor=1. Der Treiber liest pro Instanz automatisch die nächsten
// 6 Floats aus dem Buffer — kein Shader-Loop, keine Uniform-Calls pro Instanz.
// Skalierbarkeit: bis ~500k Instanzen (GPU-bound, nicht CPU-bound).

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat4, vec3 } from "gl-matrix";
import { getWebGL2, createProgram, createBuffer, resizeCanvasToDisplaySize, GlTimer, glFenceAsync } from "../../../src/shared/gl";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult, CpuTimer, readBenchmarkValue } from "../../../src/shared/benchmark";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const gl = getWebGL2(canvas);
gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(0.06, 0.07, 0.09, 1);

// Instanced shader: per-Instanz Translation + Farbe via Vertex-Buffer (divisor=1)
const VS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aInstPos;   // per instance
layout(location=3) in vec3 aInstColor; // per instance
uniform mat4 uView, uProj;
out vec3 vNormal, vColor, vWorldPos;
void main(){
  vec3 pos = aPosition * 0.4 + aInstPos;
  vWorldPos = pos; vNormal = aNormal; vColor = aInstColor;
  gl_Position = uProj * uView * vec4(pos, 1.0);
}`;
const FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vNormal, vColor, vWorldPos;
uniform vec3 uLightPos, uViewPos;
out vec4 fragColor;
void main(){
  vec3 N=normalize(vNormal), L=normalize(uLightPos-vWorldPos), V=normalize(uViewPos-vWorldPos), H=normalize(L+V);
  float diff=max(dot(N,L),0.0), spec=pow(max(dot(N,H),0.0),32.0);
  fragColor=vec4(0.1*vColor + diff*vColor + spec*vec3(1.0), 1.0);
}`;

const program = createProgram(gl, VS, FS);
const geo = createUvSphere(0.5, 12, 6); // einfache Kugel für Instancing-Benchmark
const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);
createBuffer(gl, gl.ARRAY_BUFFER, geo.vertices);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geo.indices);

const MAX_N = 500000;
const instData = new Float32Array(MAX_N * 6); // xyz pos + rgb color
const instBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(2, 1);
gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 24, 12); gl.vertexAttribDivisor(3, 1);
gl.bindVertexArray(null);

const proj = mat4.create(), view = mat4.create();
const cameraPos = vec3.fromValues(0, 15, 35), lightPos = vec3.fromValues(10, 20, 20);
mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

function buildInstances(n: number): void {
  const side = Math.ceil(Math.cbrt(n));
  const half = (side - 1) / 2, sp = 1.2;
  for (let i = 0; i < n; i++) {
    const ix = i % side, iy = Math.floor(i/side)%side, iz = Math.floor(i/side/side);
    instData[i*6]   = (ix-half)*sp; instData[i*6+1] = (iy-half)*sp; instData[i*6+2] = (iz-half)*sp;
    const h = (i/n)*360, [r,g,b] = hsl(h, 0.7, 0.5);
    instData[i*6+3] = r; instData[i*6+4] = g; instData[i*6+5] = b;
  }
  // Instanz-Buffer mit nächstem N befüllen.
  // bufferSubData überschreibt nur den benötigten Teil (kein Realloc).
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData.subarray(0, n*6));
}
function hsl(h: number, s: number, l: number): [number,number,number] {
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return [r+m,g+m,b+m];
}

const params = { n: readBenchmarkValue() ?? 10000 };
buildInstances(params.n);

const stats = createStatsPanel(document.getElementById("app")!); stats.showPanel(1);
const benchmark = new BenchmarkRun({ warmupMs: 800, measureMs: 4000, minFrames: 120 });
const gpuTimer = new GlTimer(gl);
const cpuTimer = new CpuTimer();

const gui = new GUI({ title: "Instancing (WebGL)" });
let pendingCapture = false;
gui.add(params, "n", 1000, MAX_N, 1000).name("N Instanzen").onFinishChange((v: number) => buildInstances(Math.round(v)));
gui.add({ run: async () => {
  resultsEl.style.display = "block"; resultsEl.textContent = `Messe N=${params.n} Instanzen ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGL] ${params.n} Instanzen\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

async function render(now: number): Promise<void> {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0,0,canvas.width,canvas.height);
    mat4.perspective(proj, Math.PI/3.6, canvas.width/Math.max(1,canvas.height), 0.1, 300);
  }
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  cpuTimer.begin();
  gl.useProgram(program);
  gl.uniformMatrix4fv(gl.getUniformLocation(program,"uView")!,false,view);
  gl.uniformMatrix4fv(gl.getUniformLocation(program,"uProj")!,false,proj);
  gl.uniform3fv(gl.getUniformLocation(program,"uLightPos")!,lightPos);
  gl.uniform3fv(gl.getUniformLocation(program,"uViewPos")!,cameraPos);
  gl.bindVertexArray(vao);
  // Ein einziger Draw-Call für alle n Instanzen — der Treiber liest per
  // vertexAttribDivisor(1) pro Instanz automatisch aus dem Instanz-Buffer.
  gpuTimer.begin();
  gl.drawElementsInstanced(gl.TRIANGLES, geo.indexCount, gl.UNSIGNED_INT, 0, Math.round(params.n));
  gpuTimer.end();
  gl.bindVertexArray(null);
  cpuTimer.end();

  // Screenshot-Trigger (einmalig nach Button-Klick)
  if (pendingCapture) {
    pendingCapture = false;
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'instancing-webgl.png'; a.click();
    }, 'image/png');
  }
  if (benchmark.isRunning) await glFenceAsync(gl); // GPU-Sync (async) → Timer-Query verfügbar
  stats.update(); benchmark.sample(now, gpuTimer.takeSample() ?? undefined, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
