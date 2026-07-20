// N-Body Simulation Showcase – WebGPU
// Gravitationssimulation O(N²): jedes Partikel wird von allen anderen angezogen.
//
// WebGPU-Ansatz: Compute-Shader mit Storage Buffers (Ping-Pong, SoA-Layout).
// Jeder GPU-Thread berechnet die Kräfte für 1 Partikel (alle N Nachbarn).
// dispatch(ceil(N/64)): 64 Threads pro Workgroup laufen parallel.
//
// Fairer WebGL-Vergleich (zwei Optimierungen):
//   1. Pipeline-Override-Konstante N (constants:{N:n}) → Loop-Unrolling wie #define N
//   2. Struct-of-Arrays (SoA): getrennte Puffer für Position und Geschwindigkeit.
//      Der innere O(N²)-Loop liest nur Positionen (16 Bytes/Partikel statt 32),
//      äquivalent zu WebGLs separater uPos-Textur.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat4 } from "gl-matrix";
import { getWebGPU, resizeWebGPUCanvas, GpuTimer } from "../../../src/shared/webgpu";
import { createStatsPanel, BenchmarkRun, formatResult, CpuTimer, readBenchmarkValue } from "../../../src/shared/benchmark";
import NBODY_COMPUTE from "../shaders/gpu/simulate.wgsl?raw";
import NBODY_RENDER  from "../shaders/gpu/render.wgsl?raw";

// Both VS and FS entry points live in the same WGSL file.
const NBODY_RENDER_VS = NBODY_RENDER;
const NBODY_RENDER_FS = NBODY_RENDER;

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const { device, context, format } = await getWebGPU(canvas);

// --- Pipelines ---------------------------------------------------------------

const computeBGL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // inBuf
  { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },           // outBuf
  { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },           // simU
]});
const renderBGL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
  { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
]});

// Shader-Modul einmalig erzeugen; Pipeline wird pro N-Wert spezialisiert (s. rebuild).
const computeShaderModule = device.createShaderModule({ code: NBODY_COMPUTE });

const renderPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
  vertex:   { module: device.createShaderModule({ code: NBODY_RENDER_VS }), entryPoint: "vs" },
  fragment: { module: device.createShaderModule({ code: NBODY_RENDER_FS }), entryPoint: "fs",
    targets: [{ format, blend: { color:{srcFactor:"src-alpha",dstFactor:"one"}, alpha:{srcFactor:"one",dstFactor:"one"} } }] },
  primitive: { topology: "point-list" },
});

// Uniforms
const simUBuf  = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const renderUB = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); // mat4 + n + pad

// Particle-Puffer (Ping-Pong, AoS) — computePipeline wird per N in rebuild() erstellt.
let computePipeline: GPUComputePipeline;
let bufA: GPUBuffer, bufB: GPUBuffer;
let computeBGA: GPUBindGroup, computeBGB: GPUBindGroup;
let renderBGA: GPUBindGroup, renderBGB: GPUBindGroup;
let currentN = 0;

function rebuild(n: number): void {
  bufA?.destroy(); bufB?.destroy();
  currentN = n;
  const PARTICLE_SIZE = 32; // 2 × vec4<f32>
  const size = n * PARTICLE_SIZE;
  bufA = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  bufB = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  // Pipeline pro N spezialisieren (Override-Konstante N → Compiler kennt Loop-Grenze).
  computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
    compute: { module: computeShaderModule, entryPoint: "main", constants: { N: n } },
  });

  // Init: AoS — interleaved pos (xyz+mass) und vel (xyz+pad) pro Partikel.
  const data = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const theta = Math.random()*Math.PI*2, phi = Math.random()*Math.PI;
    const r = 2 + Math.random()*3;
    data[i*8]   = r*Math.sin(phi)*Math.cos(theta);
    data[i*8+1] = r*Math.sin(phi)*Math.sin(theta);
    data[i*8+2] = r*Math.cos(phi);
    data[i*8+3] = 0.5 + Math.random()*1.5; // mass
    const sp = 0.02 + Math.random()*0.03;
    data[i*8+4] = -data[i*8+1]*sp; data[i*8+5] = data[i*8]*sp;
  }
  device.queue.writeBuffer(bufA, 0, data);
  device.queue.writeBuffer(bufB, 0, data);

  // Bind groups (Ping-Pong)
  // flip=0: liest bufA, schreibt bufB. Render liest bufB.
  // flip=1: liest bufB, schreibt bufA. Render liest bufA.
  computeBGA = device.createBindGroup({ layout: computeBGL, entries: [
    { binding: 0, resource: { buffer: bufA } },
    { binding: 1, resource: { buffer: bufB } },
    { binding: 2, resource: { buffer: simUBuf } },
  ]});
  computeBGB = device.createBindGroup({ layout: computeBGL, entries: [
    { binding: 0, resource: { buffer: bufB } },
    { binding: 1, resource: { buffer: bufA } },
    { binding: 2, resource: { buffer: simUBuf } },
  ]});
  renderBGA = device.createBindGroup({ layout: renderBGL, entries: [
    { binding: 0, resource: { buffer: renderUB } }, { binding: 1, resource: { buffer: bufB } },
  ]});
  renderBGB = device.createBindGroup({ layout: renderBGL, entries: [
    { binding: 0, resource: { buffer: renderUB } }, { binding: 1, resource: { buffer: bufA } },
  ]});
}

// --- GUI ---------------------------------------------------------------------

const params = { N: readBenchmarkValue() ?? 512, dt: 0.002, softening: 0.1 };
rebuild(params.N);

const stats = createStatsPanel(document.getElementById("app")!); stats.showPanel(1);
const benchmark = new BenchmarkRun({ warmupMs: 1500, measureMs: 1, minFrames: 500 });
const gpuTimer = new GpuTimer(device);
const cpuTimer = new CpuTimer();

const gui = new GUI({ title: "N-Body (WebGPU)" });
let pendingCapture = false;
gui.add(params, "N", [256, 512, 1024, 2048, 4096, 8192, 16384]).name("N Partikel").onChange((v: number) => rebuild(v));
gui.add(params, "dt", 0.0005, 0.01, 0.0001).name("Zeitschritt");
gui.add(params, "softening", 0.01, 1.0, 0.01).name("Softening");
gui.add({ run: async () => {
  resultsEl.style.display = "block"; resultsEl.textContent = `Messe N=${currentN} ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGPU] N-Body N=${currentN}\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

// --- Render Loop -------------------------------------------------------------

const viewProj = mat4.create(), view4 = mat4.create(), proj4 = mat4.create();
mat4.lookAt(view4, [0, 4, 12], [0, 0, 0], [0, 1, 0]);
const renderUData = new Float32Array(20); // mat4(16) + n(1) + pad(3)

let flip = 0;
async function render(now: number): Promise<void> {
  if (resizeWebGPUCanvas(canvas)) {
    mat4.perspective(proj4, Math.PI/3.6, canvas.width/Math.max(1,canvas.height), 0.01, 200);
    mat4.multiply(viewProj, proj4, view4);
  }
  const simData = new Float32Array([params.dt, params.softening, 0, 0]);
  device.queue.writeBuffer(simUBuf, 0, simData);
  renderUData.set(viewProj, 0);
  new Uint32Array(renderUData.buffer)[16] = currentN;
  device.queue.writeBuffer(renderUB, 0, renderUData);

  // Swapchain-Textur vor der CPU-Messung holen (Present-Stall zählt nicht als API-Overhead).
  const colorView = context.getCurrentTexture().createView();
  cpuTimer.begin();

  // --- Compute-Pass: Simulation ---
  // Jede Workgroup berechnet 64 Partikel parallel.
  // Ping-Pong: bufA → lesen, bufB → schreiben (flip nach jedem Frame).
  const cmd = device.createCommandEncoder();
  const cp  = cmd.beginComputePass({ timestampWrites: gpuTimer.writesBegin });
  cp.setPipeline(computePipeline);
  cp.setBindGroup(0, flip === 0 ? computeBGA : computeBGB);
  cp.dispatchWorkgroups(Math.ceil(currentN / 64));
  cp.end();

  // --- Render-Pass: Partikel als Punkte visualisieren ---
  // Vertex-Shader liest direkt aus dem Storage Buffer des gerade beschriebenen Pings.
  const rp = cmd.beginRenderPass({ colorAttachments: [{
    view: colorView, clearValue: {r:0,g:0,b:0,a:1}, loadOp: "clear", storeOp: "store",
  }], timestampWrites: gpuTimer.writesEnd });
  rp.setPipeline(renderPipeline);
  rp.setBindGroup(0, flip === 0 ? renderBGA : renderBGB);
  rp.draw(currentN);
  rp.end();
  gpuTimer.resolve(cmd);
  device.queue.submit([cmd.finish()]);
  gpuTimer.afterSubmit();
  cpuTimer.end();
  flip = 1 - flip; // Ping-Pong umschalten

  // Screenshot-Trigger (einmalig nach Button-Klick)
  if (pendingCapture) {
    pendingCapture = false;
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'nbody-webgpu.png'; a.click();
    }, 'image/png');
  }
  if (benchmark.isRunning) await device.queue.onSubmittedWorkDone(); // Drain (yield) → Timestamp-Readback fertig
  const gpuMs = gpuTimer.takeSample() ?? undefined;
  stats.update(); benchmark.sample(now, gpuMs, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
