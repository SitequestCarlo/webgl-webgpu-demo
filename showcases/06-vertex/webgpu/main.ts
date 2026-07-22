// Vertex Throughput Showcase – WebGPU
// Misst GPU-seitigen Vertex-Shader-Durchsatz bei skalierender Dreieckanzahl.
//
// GPU-Timing via Timestamp-Query: GPUQuerySet mit 2 Zeitstempeln (Begin/End Pass).
// Ergebnis wird asynchron via mapAsync ausgelesen (kein CPU-Stall, ~0.001ms Präzision).
// Falls das Device keine Timestamp-Queries unterstützt, wird performance.now() verwendet.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import { getWebGPU, resizeWebGPUCanvas, createDepthTexture, createGPUVertexBuffer, createGPUIndexBuffer, mat3ToMat4Array, VERTEX_BUFFER_LAYOUT, makeRenderPassDescriptor, GpuTimer } from "../../../src/shared/webgpu";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult, CpuTimer, readBenchmarkValue } from "../../../src/shared/benchmark";
import { DRAW_UNIFORM_SIZE, writeDrawUniform } from "../../../src/shared/drawUtils";
import BENCH_WGSL       from "../shaders/gpu/vertex-simple.wgsl?raw";
import BENCH_HEAVY_WGSL from "../shaders/gpu/vertex-heavy.wgsl?raw";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const { device, context, format } = await getWebGPU(canvas);

const sceneBGL = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }]});
const drawBGL  = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: DRAW_UNIFORM_SIZE } }]});
const shader      = device.createShaderModule({ code: BENCH_WGSL });
const shaderHeavy = device.createShaderModule({ code: BENCH_HEAVY_WGSL });
function makePipeline(mod: GPUShaderModule): GPURenderPipeline {
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [sceneBGL, drawBGL] }),
    vertex: { module: mod, entryPoint: "vs_main", buffers: [VERTEX_BUFFER_LAYOUT] },
    fragment: { module: mod, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });
}
const pipelineSimple = makePipeline(shader);
const pipelineHeavy  = makePipeline(shaderHeavy);
let pipeline = pipelineHeavy; // Heavy-VS ist Default: vertex-ALU-bound + triggert GPU-Boost

const sceneUB = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const sceneData = new Float32Array(64);
const sceneBG = device.createBindGroup({ layout: sceneBGL, entries: [{ binding: 0, resource: { buffer: sceneUB } }] });

const drawUB = device.createBuffer({ size: DRAW_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const drawBG = device.createBindGroup({ layout: drawBGL, entries: [{ binding: 0, resource: { buffer: drawUB, size: DRAW_UNIFORM_SIZE } }] });
const drawData = new Float32Array(DRAW_UNIFORM_SIZE / 4);
const normalM4 = new Float32Array(16);

const proj = mat4.create(), view = mat4.create(), model = mat4.create(), normalM3 = mat3.create();
const cameraPos = vec3.fromValues(0, 0, 3), lightPos = vec3.fromValues(4, 6, 4);
mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

let vb: GPUBuffer | null = null, ib: GPUBuffer | null = null;
let indexCount = 0, triCount = 0;

// GPU-Timestamps via wiederverwendbarem GpuTimer (Pool mappbarer Staging-Buffer).
const gpuTimer = new GpuTimer(device);
const supportsTs = gpuTimer.enabled;

function buildMesh(seg: number, rings: number): void {
  vb?.destroy(); ib?.destroy();
  const geo = createUvSphere(1, seg, rings);
  vb = createGPUVertexBuffer(device, geo.vertices);
  ib = createGPUIndexBuffer(device, geo.indices);
  indexCount = geo.indexCount; triCount = geo.indexCount / 3;
}

const params = { segments: readBenchmarkValue() ?? 200, rings: 16, autoRotate: true, heavyVS: true };
buildMesh(params.segments, params.rings);

const stats = createStatsPanel(document.getElementById("app")!); stats.showPanel(1);
const benchmark = new BenchmarkRun({ warmupMs: 2500, measureMs: 1, minFrames: 1000 });
const cpuTimer = new CpuTimer();
let depth = createDepthTexture(device, 1, 1);

const gui = new GUI({ title: "Vertex Throughput (WebGPU)" });
let pendingCapture = false;
const triCtrl = gui.add({ tri: "–" }, "tri").name("Dreiecke").disable();
const msCtrl  = gui.add({ ms: supportsTs ? "– ms (GPU)" : "– ms" }, "ms").name("GPU-Zeit").disable();
gui.add(params, "segments", 10, 20000, 1).name("Segmente").onFinishChange(() => buildMesh(params.segments, params.rings));
gui.add(params, "rings",    10, 1000, 1).name("Ringe").onFinishChange(()    => buildMesh(params.segments, params.rings));
gui.add(params, "autoRotate").name("Rotation");
gui.add(params, "heavyVS").name("Heavy VS (8×sin/cos)").onChange((v: boolean) => { pipeline = v ? pipelineHeavy : pipelineSimple; });
gui.add({ run: async () => {
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${(triCount/1000).toFixed(0)}k Dreiecke ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGPU] ${(triCount/1000).toFixed(0)}k Dreiecke\n${formatResult(r)}\nGPU: ${gpuTimer.lastMs.toFixed(supportsTs?3:2)} ms`;
}}, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");
setInterval(() => {
  (triCtrl as {setValue:(v:string)=>void}).setValue(`${(triCount/1000).toFixed(0)}k`);
  if (gpuTimer.lastMs > 0) (msCtrl as {setValue:(v:string)=>void}).setValue(`${gpuTimer.lastMs.toFixed(supportsTs?3:2)} ms${supportsTs?" (GPU)":""}`);
}, 300);

let angle = 0, lastT = performance.now();

async function render(now: number): Promise<void> {
  const dt = (now - lastT) / 1000; lastT = now;
  if (resizeWebGPUCanvas(canvas)) {
    depth.destroy(); depth = createDepthTexture(device, canvas.width, canvas.height);
    mat4.perspective(proj, Math.PI / 3.6, canvas.width / Math.max(1, canvas.height), 0.1, 100);
  }
  if (params.autoRotate) angle += dt * 0.5;
  mat4.identity(model); mat4.rotateY(model, model, angle);
  mat3.normalFromMat4(normalM3, model); mat3ToMat4Array(normalM3, normalM4, 0);
  writeDrawUniform(drawData, 0, model as Float32Array, normalM4, [0.55, 0.17, 0.51]);
  device.queue.writeBuffer(drawUB, 0, drawData);

  sceneData.set(view, 0); sceneData.set(proj, 16);
  sceneData[32]=lightPos[0]; sceneData[33]=lightPos[1]; sceneData[34]=lightPos[2];
  sceneData[36]=cameraPos[0]; sceneData[37]=cameraPos[1]; sceneData[38]=cameraPos[2];
  sceneData[40]=1; sceneData[41]=0.97; sceneData[42]=0.93; sceneData[43]=0.08; sceneData[44]=48;
  device.queue.writeBuffer(sceneUB, 0, sceneData);

  // Swapchain-Textur vor der CPU-Messung holen (Present-Stall zählt nicht als API-Overhead).
  const colorView = context.getCurrentTexture().createView();
  cpuTimer.begin();
  // GPU-Timestamp-Query über GpuTimer: Anfangs-/End-Zeitstempel im selben Pass.
  const cmd = device.createCommandEncoder();
  const rpDesc: GPURenderPassDescriptor = {
    ...makeRenderPassDescriptor(colorView, depth.createView(), {r:.06,g:.07,b:.09,a:1}),
    timestampWrites: gpuTimer.writesBoth,
  };
  const pass = cmd.beginRenderPass(rpDesc);
  // Vertex-bound-Messung: Fragment-Last per 1×1-Scissor eliminieren (nur während
  // des Benchmarks). Der Vertex-Shader läuft weiterhin für ALLE Vertices; nur die
  // Fragment-Fläche wird auf ~1 Pixel begrenzt → kein Fragment-/Fill-Rate-Confound.
  if (benchmark.isRunning) pass.setScissorRect(0, 0, 1, 1);
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, vb!);
  pass.setIndexBuffer(ib!, "uint32");
  pass.setBindGroup(0, sceneBG);
  pass.setBindGroup(1, drawBG, [0]);
  pass.drawIndexed(indexCount);
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
      a.href = URL.createObjectURL(b); a.download = 'vertex-webgpu.png'; a.click();
    }, 'image/png');
  }
  if (benchmark.isRunning) await device.queue.onSubmittedWorkDone(); // Drain (yield) → Timestamp-Readback fertig
  const gpuMs = gpuTimer.takeSample() ?? undefined;
  stats.update();
  benchmark.sample(now, gpuMs, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
