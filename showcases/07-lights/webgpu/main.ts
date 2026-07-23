// Multi-Light Showcase � WebGPU
// Misst Fragment-Shader-Last unter N Punktlichtquellen (Blinn-Phong).
//
// WebGPU-spezifisch: Lichtdaten liegen in einem Storage Buffer (kein Limit, kein Recompile).
// Der Render-Loop schreibt alle N Lichter mit einem einzigen writeBuffer()-Aufruf �
// unabh�ngig von N konstanter JS-Overhead (kein pro-Licht JS?Native-�bergang).

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import {
  getWebGPU, resizeWebGPUCanvas, createDepthTexture,
  createGPUVertexBuffer, createGPUIndexBuffer,
  mat3ToMat4Array, VERTEX_BUFFER_LAYOUT, makeRenderPassDescriptor, GpuTimer,
} from "../../../src/shared/webgpu";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult, CpuTimer, readBenchmarkValue } from "../../../src/shared/benchmark";
import ML_WGSL from "../shaders/gpu/multi-light.wgsl?raw";

// ---------------------------------------------------------------------------
// 1. Canvas & WebGPU-Kontext
// ---------------------------------------------------------------------------

const MAX_LIGHTS = 1024;

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const { device, context, format } = await getWebGPU(canvas);

// ---------------------------------------------------------------------------
// 2. Geometrie
// ---------------------------------------------------------------------------

// Dichte UV-Kugel (200�100 � 40?k Dreiecke) � Fragment-Last ist das Ziel
const geo = createUvSphere(1, 200, 100);
const vb  = createGPUVertexBuffer(device, geo.vertices);
const ib  = createGPUIndexBuffer(device, geo.indices);

// ---------------------------------------------------------------------------
// 3. Uniform- & Storage-Buffer
// ---------------------------------------------------------------------------

// Szene-Uniform-Buffer: Matrizen + Kamera + Material + numLights
// Layout: 4�mat4 (256B) + 4�vec4 (64B) = 320B ? 512B alloziert (256B-Alignment)
const SCENE_SIZE = 512;
const sceneUB   = device.createBuffer({ size: SCENE_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const sceneData = new Float32Array(SCENE_SIZE / 4);

// Light Uniform Buffer: MAX_LIGHTS × 32 Bytes = 32 KB (< 64 KB WebGPU-Mindestlimit).
// Uniform Buffer → dedizierter Constant-Cache der GPU (Broadcast-Read-optimiert),
// identisches Verhalten wie WebGLs uniform-Arrays.
const LIGHT_STRIDE = 8; // 2×vec4 = 8 Floats = 32 Bytes
const lightData = new Float32Array(MAX_LIGHTS * LIGHT_STRIDE);
const lightBuf  = device.createBuffer({
  size:  MAX_LIGHTS * 32,  // 1024 × 32 = 32768 Bytes
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// ---------------------------------------------------------------------------
// 4. Bind-Group-Layout & Render-Pipeline
// ---------------------------------------------------------------------------

const bgl = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { type: "uniform" } },   // Szene-Uniforms
  { binding: 1, visibility: GPUShaderStage.FRAGMENT,
    buffer: { type: "uniform" } },   // Licht-Uniform-Buffer (Constant-Cache)
]});

const shader   = device.createShaderModule({ code: ML_WGSL });
const pipeline = device.createRenderPipeline({
  layout:   device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
  vertex:   { module: shader, entryPoint: "vs", buffers: [VERTEX_BUFFER_LAYOUT] },
  fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
  primitive:    { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

const bg = device.createBindGroup({ layout: bgl, entries: [
  { binding: 0, resource: { buffer: sceneUB  } },
  { binding: 1, resource: { buffer: lightBuf } },
]});

// ---------------------------------------------------------------------------
// 5. Szene: Kamera & Lichtfarben
// ---------------------------------------------------------------------------

const proj = mat4.create();
const view = mat4.create();
const model = mat4.create();
const nm3  = mat3.create();
const nm4  = new Float32Array(16);
const cameraPos = vec3.fromValues(0, 0, 2.5);
mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}



let depth = createDepthTexture(device, 1, 1);

// ---------------------------------------------------------------------------
// 6. GUI & Benchmark
// ---------------------------------------------------------------------------

const params = { numLights: readBenchmarkValue() ?? 16, autoRotate: true };

const stats     = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1);
const benchmark = new BenchmarkRun({ warmupMs: 1000, measureMs: 1, minFrames: 1000 });
const gpuTimer  = new GpuTimer(device);
const cpuTimer  = new CpuTimer();

const gui = new GUI({ title: "Multi-Light (WebGPU)" });
let pendingCapture = false;

gui.add(params, "numLights", 1, MAX_LIGHTS, 1).name("Lichtquellen");
gui.add(params, "autoRotate").name("Rotation");

// Einzelner Benchmark beim aktuellen N-Wert
gui.add({ run: async () => {
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${params.numLights} Lichter ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGPU] ${params.numLights} Lichter\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");

gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

// ---------------------------------------------------------------------------
// 7. Render-Loop
// ---------------------------------------------------------------------------

let angle = 0;
let lastT = performance.now();

async function render(now: number): Promise<void> {
  const dt = (now - lastT) / 1000; lastT = now;

  // Canvas-Resize: Tiefentextur neu erstellen + Projektion anpassen
  if (resizeWebGPUCanvas(canvas)) {
    depth.destroy();
    depth = createDepthTexture(device, canvas.width, canvas.height);
    mat4.perspective(proj, Math.PI / 3.6, canvas.width / Math.max(1, canvas.height), 0.1, 50);
  }

  // Modellrotation
  if (params.autoRotate) angle += dt * 0.4;
  mat4.identity(model); mat4.rotateY(model, model, angle);
  mat3.normalFromMat4(nm3, model); mat3ToMat4Array(nm3, nm4, 0);

  const n = Math.round(params.numLights);

  // Swapchain-Textur vor der CPU-Messung holen (Present-Stall z�hlt nicht als API-Overhead).
  const colorView = context.getCurrentTexture().createView();

  // CPU-Messung: alle N Lichter mit EINEM writeBuffer hochladen + Record+Submit.
  // Gegenstück ist WebGLs N × gl.uniform3f – hier sichtbar als CPU-Overhead-Vergleich.
  cpuTimer.begin();
  // Licht-Uniform-Buffer befüllen: 1 writeBuffer-Aufruf für alle N Lichter.
  // Farben gleichmäßig über die aktiven n Lichter verteilen (i/n, nicht i/MAX_LIGHTS),
  // identisch zur WebGL-Implementierung.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + angle * 0.5;
    const r = 1.5 + 0.5 * Math.sin(i * 2.3);
    lightData[i*LIGHT_STRIDE]   = Math.cos(a) * r;
    lightData[i*LIGHT_STRIDE+1] = Math.sin(a * 0.7) * 1.2;
    lightData[i*LIGHT_STRIDE+2] = Math.sin(a) * r;
    const [cr, cg, cb] = hsl((i / n) * 360, 1, 0.6);
    lightData[i*LIGHT_STRIDE+4] = cr;
    lightData[i*LIGHT_STRIDE+5] = cg;
    lightData[i*LIGHT_STRIDE+6] = cb;
  }
  device.queue.writeBuffer(lightBuf, 0, lightData.subarray(0, n * LIGHT_STRIDE));

  // Szene-Uniform-Buffer befüllen (Matrizen, Kamera, Material, numLights)
  sceneData.set(view,  0); sceneData.set(proj, 16); sceneData.set(model, 32); sceneData.set(nm4, 48);
  sceneData[64] = cameraPos[0]; sceneData[65] = cameraPos[1]; sceneData[66] = cameraPos[2];
  sceneData[68] = 0.05;  // ambient
  sceneData[69] = 64;    // shininess
  new Uint32Array(sceneData.buffer)[70] = n; // numLights (als uint32)
  device.queue.writeBuffer(sceneUB, 0, sceneData);

  // Command-Encoder: Render-Pass aufzeichnen und als Batch einreichen
  const cmd  = device.createCommandEncoder();
  const pass = cmd.beginRenderPass({
    ...makeRenderPassDescriptor(
      colorView, depth.createView(),
      { r: 0.02, g: 0.02, b: 0.04, a: 1 },
    ),
    timestampWrites: gpuTimer.writesBoth,
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.setVertexBuffer(0, vb);
  pass.setIndexBuffer(ib, "uint32");
  pass.drawIndexed(geo.indexCount);
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
      a.href = URL.createObjectURL(b); a.download = 'lights-webgpu.png'; a.click();
    }, 'image/png');
  }

  if (benchmark.isRunning) await device.queue.onSubmittedWorkDone(); // Drain (yield) ? Timestamp-Readback fertig
  const gpuMs = gpuTimer.takeSample() ?? undefined;
  stats.update();
  benchmark.sample(now, gpuMs, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
