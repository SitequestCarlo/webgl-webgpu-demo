// Draw-Call Overhead Showcase – WebGPU
// Misst den API-Overhead pro Zeichenbefehl bei N Objekten.
//
// WebGPU-spezifisch: N Draw-Calls als Command-Buffer aufgezeichnet, dann 1 submit().
// Das Command-Recording ist leichtgewichtiger als WebGLs sofortige Befehle:
// N × {setBindGroup(dynOffset) + drawIndexed} + 1 submit()
// → weniger API-Overhead, GPU und CPU können parallel arbeiten.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import {
  getWebGPU, resizeWebGPUCanvas, createDepthTexture,
  createGPUVertexBuffer, createGPUIndexBuffer, mat3ToMat4Array,
  VERTEX_BUFFER_LAYOUT, makeRenderPassDescriptor, GpuTimer,
} from "../../../src/shared/webgpu";
import { createCube } from "../../../src/shared/geometry";
import { CpuTimer, createStatsPanel, BenchmarkRun, formatResult, readBenchmarkValue } from "../../../src/shared/benchmark";
import { DRAW_UNIFORM_SIZE } from "../../../src/shared/drawUtils";
import BENCH_WGSL from "../shaders/gpu/blinn-phong.wgsl?raw";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const { device, context, format } = await getWebGPU(canvas);

// --- Geometrie ---------------------------------------------------------------

const cube  = createCube(0.5);
const cubeVB = createGPUVertexBuffer(device, cube.vertices);
const cubeIB = createGPUIndexBuffer(device, cube.indices);

// --- Pipelines & Bind-Group-Layouts ------------------------------------------

const sceneBGL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
]});
const drawBGL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: DRAW_UNIFORM_SIZE } },
]});
const layout = device.createPipelineLayout({ bindGroupLayouts: [sceneBGL, drawBGL] });
const shader = device.createShaderModule({ code: BENCH_WGSL });
const pipeline = device.createRenderPipeline({
  layout,
  vertex:   { module: shader, entryPoint: "vs_main", buffers: [VERTEX_BUFFER_LAYOUT] },
  fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
  primitive:    { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

// Szene-Uniform-Buffer: view, proj, lightPos, viewPos, lightColor+ambient, shininess
// 4×mat4 = 128, 4×vec4 = 64, 2×f32 = 8 → 200 → 256 alloc
const SCENE_UB_SIZE = 256;
const sceneUB = device.createBuffer({ size: SCENE_UB_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const sceneData = new Float32Array(SCENE_UB_SIZE / 4);
const sceneBG   = device.createBindGroup({ layout: sceneBGL, entries: [{ binding: 0, resource: { buffer: sceneUB } }] });

// Draw-Uniform-Buffer: N × 256 Bytes, Dynamic Offsets
const MAX_N = 50000;
let drawUBSize = MAX_N * DRAW_UNIFORM_SIZE;
let drawUB = device.createBuffer({ size: drawUBSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
let drawBG = device.createBindGroup({ layout: drawBGL, entries: [{ binding: 0, resource: { buffer: drawUB, size: DRAW_UNIFORM_SIZE } }] });
const drawData = new Float32Array(MAX_N * DRAW_UNIFORM_SIZE / 4);
// Vorab-alloziertes Uint32Array mit Dynamic-Offsets: dynOffsets[i] = i * 256.
// Verhindert Array-Allokation ([i*256]) im Hot-Loop → kein GC-Druck.
const dynOffsets = new Uint32Array(MAX_N);
for (let i = 0; i < MAX_N; i++) dynOffsets[i] = i * DRAW_UNIFORM_SIZE;

// --- Szene -------------------------------------------------------------------

const proj      = mat4.create();
const view      = mat4.create();
const model     = mat4.create();
const normalM3  = mat3.create();
const normalM4  = new Float32Array(16);
const cameraPos = vec3.fromValues(0, 8, 20);
const lightPos  = vec3.fromValues(10, 15, 10);
mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

const MAX_N_REAL = 50000;
const posArr   = new Float32Array(MAX_N_REAL * 3);
const colorArr = new Float32Array(MAX_N_REAL * 3);

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

function rebuildObjects(n: number): void {
  const side = Math.ceil(Math.cbrt(n)), half = (side - 1) / 2, sp = 1.2;
  for (let i = 0; i < n; i++) {
    const ix = i % side, iy = Math.floor(i / side) % side, iz = Math.floor(i / side / side);
    posArr[i*3] = (ix-half)*sp; posArr[i*3+1] = (iy-half)*sp; posArr[i*3+2] = (iz-half)*sp;
    const [r, g, b] = hsl((i / n) * 360, 0.7, 0.5);
    colorArr[i*3] = r; colorArr[i*3+1] = g; colorArr[i*3+2] = b;
  }
}

// --- Params & GUI ------------------------------------------------------------

const params = { n: readBenchmarkValue() ?? 1000, autoRotate: true };
let angle = 0;
rebuildObjects(params.n);

const cpuTimer  = new CpuTimer();
const gpuTimer  = new GpuTimer(device);
const stats     = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1);
const benchmark = new BenchmarkRun({ warmupMs: 1000, measureMs: 1, minFrames: 1000, primary: "cpu" });
let depth = createDepthTexture(device, 1, 1);

const gui = new GUI({ title: "Draw-Calls (WebGPU)" });
let pendingCapture = false;
gui.add(params, "n", 100, MAX_N, 100).name("N Objekte").onChange((v: number) => rebuildObjects(Math.round(v)));
const cpuCtrl = gui.add({ cpu: "– ms" }, "cpu").name("CPU Draw-Zeit").disable();
gui.add(params, "autoRotate").name("Rotation");
gui.add({ run: async () => {
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${params.n} Draw-Calls ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGPU] N=${params.n} Draw-Calls\n${formatResult(r)}\nCPU avg: ${cpuTimer.average.toFixed(2)} ms`;
} }, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

setInterval(() => { (cpuCtrl as { setValue:(v:string)=>void }).setValue(`${cpuTimer.average.toFixed(2)} ms`); }, 300);

// --- Render ------------------------------------------------------------------

let lastT = performance.now();

async function render(now: number): Promise<void> {
  const dt = (now - lastT) / 1000; lastT = now;
  if (resizeWebGPUCanvas(canvas)) {
    depth.destroy();
    depth = createDepthTexture(device, canvas.width, canvas.height);
    const a = canvas.width / Math.max(1, canvas.height);
    mat4.perspective(proj, (50 * Math.PI) / 180, a, 0.1, 200);
  }
  if (params.autoRotate) angle += dt * 0.3;

  const n = Math.round(params.n);

  // Szene-Uniform
  sceneData.set(view, 0); sceneData.set(proj, 16);
  sceneData[32] = lightPos[0]; sceneData[33] = lightPos[1]; sceneData[34] = lightPos[2];
  sceneData[36] = cameraPos[0]; sceneData[37] = cameraPos[1]; sceneData[38] = cameraPos[2];
  sceneData[40] = 1; sceneData[41] = 0.97; sceneData[42] = 0.93; sceneData[43] = 0.1; // rgb + ambient
  sceneData[44] = 32; // shininess
  device.queue.writeBuffer(sceneUB, 0, sceneData);

  // Transformationen VOR cpuTimer durchführen (nicht API-Overhead).
  // Inline-Schreiben in drawData vermeidet temporäre [r,g,b]-Tuple-Allokation.
  const floatsPerDraw = DRAW_UNIFORM_SIZE / 4;
  for (let i = 0; i < n; i++) {
    mat4.fromTranslation(model, [posArr[i*3], posArr[i*3+1], posArr[i*3+2]]);
    mat4.rotateY(model, model, angle + i * 0.05);
    mat3.normalFromMat4(normalM3, model);
    mat3ToMat4Array(normalM3, normalM4, 0);
    const fo = i * floatsPerDraw;
    drawData.set(model,    fo);
    drawData.set(normalM4, fo + 16);
    drawData[fo + 32] = colorArr[i*3];
    drawData[fo + 33] = colorArr[i*3+1];
    drawData[fo + 34] = colorArr[i*3+2];
    drawData[fo + 35] = 1.0;
  }

  // Swapchain-Textur VOR der CPU-Messung holen: getCurrentTexture() kann durch
  // Present-Back-Pressure blockieren; das ist kein API-Overhead und würde die
  // CPU-Zeit verfälschen.
  const colorView = context.getCurrentTexture().createView();

  // MESSUNG: writeBuffer (Daten-Upload, äquivalent zu WebGLs N×uniformMatrix4fv)
  // + Command-Buffer aufzeichnen + submit.
  // dynOffsets ist persistent vorab-alloziert → kein GC-Druck im Hot-Loop.
  cpuTimer.begin();
  device.queue.writeBuffer(drawUB, 0, drawData.subarray(0, n * floatsPerDraw));

  // Command-Buffer zusammensetzen: N setBindGroup + drawIndexed, dann 1 submit()
  const cmd  = device.createCommandEncoder();
  const pass = cmd.beginRenderPass({
    ...makeRenderPassDescriptor(
      colorView, depth.createView(),
      { r: 0.06, g: 0.07, b: 0.09, a: 1 }
    ),
    timestampWrites: gpuTimer.writesBoth,
  });
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, cubeVB);
  pass.setIndexBuffer(cubeIB, "uint32");
  pass.setBindGroup(0, sceneBG);
  for (let i = 0; i < n; i++) {
    pass.setBindGroup(1, drawBG, dynOffsets, i, 1);
    pass.drawIndexed(cube.indexCount);
  }
  pass.end();
  gpuTimer.resolve(cmd);
  device.queue.submit([cmd.finish()]);
  gpuTimer.afterSubmit();
  cpuTimer.end();

  // Screenshot-Trigger (einmalig nach Button-Klick)
  if (pendingCapture) {
    pendingCapture = false;
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'drawcalls-webgpu.png'; a.click();
    }, 'image/png');
  }

  if (benchmark.isRunning) await device.queue.onSubmittedWorkDone(); // Drain (yield) → Timestamp-Readback fertig
  const gpuMs = gpuTimer.takeSample() ?? undefined;
  stats.update();
  benchmark.sample(now, gpuMs, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
