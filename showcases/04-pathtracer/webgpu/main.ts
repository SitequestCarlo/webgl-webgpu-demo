import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { vec3 } from "gl-matrix";
import { getWebGPU, resizeWebGPUCanvas, createUniformBuffer, createStorageBuffer } from "../../../src/shared/webgpu";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import COMPUTE_SRC from "../shaders/gpu/compute.wgsl?raw";
import BLIT_SRC from "../shaders/gpu/blit.wgsl?raw";

const BLIT_VS = BLIT_SRC;
const BLIT_FS = BLIT_SRC;

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const { device, context, format } = await getWebGPU(canvas);

// GPU-Timestamp-Queries (falls vom Gerät unterstützt)
const supportsTimestamp = device.features.has("timestamp-query");
let querySet:    GPUQuerySet | null = null;
let queryResolveBuf: GPUBuffer | null = null;
let queryReadBuf:    GPUBuffer | null = null;
if (supportsTimestamp) {
  querySet = device.createQuerySet({ type: "timestamp", count: 2 });
  queryResolveBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  queryReadBuf    = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
}
let gpuMsLast = 0;
let gpuReadPending = false;
let measureGpu = false;

// --- Uniform-Buffer Layout -----------------------------------------------
// Params (80 Bytes → 256 alloc):
//   resolution: vec2<u32> (8)  frameIndex: u32 (4)  _pad: u32 (4)  = 16
//   camPos: vec4 (16), camFwd: vec4 (16), camRight: vec4 (16), camUp: vec4 (16)
const PARAMS_SIZE = 256;
const paramsBuf   = createUniformBuffer(device, PARAMS_SIZE);
const blitParamsBuf = createUniformBuffer(device, 16);

let accumBuf: GPUBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
let rngBuf:   GPUBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
let accumSize = 0;

// --- Bind-Group-Layouts --------------------------------------------------

const computeBGL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
  { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
  { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
]});
const blitBGL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
  { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
]});

// --- Pipelines -----------------------------------------------------------

const computePipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
  compute: { module: device.createShaderModule({ code: COMPUTE_SRC }), entryPoint: "main" },
});
const blitPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [blitBGL] }),
  vertex:   { module: device.createShaderModule({ code: BLIT_VS }), entryPoint: "vs_main" },
  fragment: { module: device.createShaderModule({ code: BLIT_FS }), entryPoint: "fs_main", targets: [{ format }] },
  primitive: { topology: "triangle-list" },
});

let computeBindGroup: GPUBindGroup | null = null;
let blitBindGroup:    GPUBindGroup | null = null;
let frameIndex = 0;
let needsClear = false;

function rebuildBuffers(w: number, h: number): void {
  const size = w * h * 16;
  if (size === accumSize) return;
  accumSize = size;
  accumBuf.destroy(); rngBuf.destroy();
  accumBuf = createStorageBuffer(device, size);
  rngBuf   = createStorageBuffer(device, w * h * 4);
  computeBindGroup = device.createBindGroup({ layout: computeBGL, entries: [
    { binding: 0, resource: { buffer: paramsBuf } },
    { binding: 1, resource: { buffer: accumBuf  } },
    { binding: 2, resource: { buffer: rngBuf    } },
  ]});
  blitBindGroup = device.createBindGroup({ layout: blitBGL, entries: [
    { binding: 0, resource: { buffer: accumBuf      } },
    { binding: 1, resource: { buffer: blitParamsBuf } },
  ]});
  frameIndex = 0; needsClear = false;
}

function resetAccum(): void { frameIndex = 0; needsClear = true; }

// --- Orbit-Kamera --------------------------------------------------------

const orbit = { theta: 0, phi: Math.PI / 2, dist: 1.5 };
const TARGET: [number, number, number] = [0, 0, 0];

function orbitVectors(): { pos: vec3; fwd: vec3; right: vec3; up: vec3 } {
  const p = vec3.fromValues(
    TARGET[0] + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    TARGET[1] + orbit.dist * Math.cos(orbit.phi),
    TARGET[2] + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta),
  );
  const fwd   = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), TARGET, p));
  const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), fwd, [0, 1, 0]));
  const up    = vec3.cross(vec3.create(), right, fwd);
  return { pos: p, fwd, right, up };
}

{
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lx) * 0.008;
    orbit.phi    = Math.max(0.1, Math.min(Math.PI - 0.1, orbit.phi - (e.clientY - ly) * 0.008));
    lx = e.clientX; ly = e.clientY;
    resetAccum();
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("wheel", (e) => {
    orbit.dist = Math.max(0.8, Math.min(3.0, orbit.dist + e.deltaY * 0.003));
    resetAccum();
    e.preventDefault();
  }, { passive: false });
}

// --- GUI -----------------------------------------------------------------

const stats = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1); // ms/Frame ist für Path Tracer aussagekräftiger

const benchmark = new BenchmarkRun(60, 300);
let pendingCapture = false;

function captureWebp(): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pathtracer-webgpu.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

async function runBenchmark(): Promise<void> {
  resultsEl.style.display = "block";
  resetAccum(); // Akkumulations-Buffer leeren: sauberer Nullzustand
  resultsEl.textContent = "Szene zurückgesetzt \u2013 Messung läuft ...";
  measureGpu = true;
  const result = await benchmark.start();
  measureGpu = false;
  const sps = (1000 / result.avgMs).toFixed(1);
  const src = supportsTimestamp ? "GPU-Timestamps" : "CPU (gl.finishäquivalent)";
  resultsEl.textContent = [
    `[WebGPU] Path Tracer`,
    `Auflösung: ${canvas.width}×${canvas.height} px`,
    `Akkum-Frames: ${frameIndex}`,
    `Samples/s:  ${sps}`,
    `Timing-Quelle: ${src}`,
    formatResult(result),
  ].join("\n");
}

const gui = new GUI({ title: "Path Tracer (WebGPU)" });
const frameCtrl = gui.add({ frames: 0 }, "frames").name("Akkum-Frames").disable();
const msCtrl    = gui.add({ ms: supportsTimestamp ? "– ms (GPU)" : "– ms (CPU)" }, "ms").name("Frame-Zeit").disable();
const tsLabel   = supportsTimestamp ? " (GPU-Timestamps)" : " (CPU-Fallback)";
void tsLabel;
setInterval(() => {
  (frameCtrl as { setValue:(v:number)=>void }).setValue(frameIndex);
  if (gpuMsLast > 0) {
    (msCtrl as { setValue:(v:string)=>void }).setValue(
      supportsTimestamp
        ? `${gpuMsLast.toFixed(3)} ms (GPU)`
        : `${gpuMsLast.toFixed(2)} ms (CPU)`
    );
  }
}, 200);

const ptParams = { maxBounces: 8 };
gui.add(ptParams, "maxBounces", 1, 16, 1).name("Max. Bounces").onChange(resetAccum);

gui.add({ reset: resetAccum }, "reset").name("Szene zurücksetzen");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// --- Render-Loop ---------------------------------------------------------

function render(now: number): void {
  if (resizeWebGPUCanvas(canvas)) rebuildBuffers(canvas.width, canvas.height);
  if (!computeBindGroup) rebuildBuffers(canvas.width, canvas.height);

  const W = canvas.width, H = canvas.height;
  const cam = orbitVectors();

  // Params-Buffer
  const pdata = new Float32Array(PARAMS_SIZE / 4);
  const udata = new Uint32Array(pdata.buffer);
  udata[0] = W; udata[1] = H; udata[2] = frameIndex; udata[3] = ptParams.maxBounces;
  pdata[4] = cam.pos[0]; pdata[5] = cam.pos[1]; pdata[6] = cam.pos[2]; pdata[7] = 0;
  pdata[8] = cam.fwd[0]; pdata[9] = cam.fwd[1]; pdata[10] = cam.fwd[2]; pdata[11] = 0;
  pdata[12] = cam.right[0]; pdata[13] = cam.right[1]; pdata[14] = cam.right[2]; pdata[15] = 0;
  pdata[16] = cam.up[0]; pdata[17] = cam.up[1]; pdata[18] = cam.up[2]; pdata[19] = 0;
  device.queue.writeBuffer(paramsBuf, 0, pdata);

  const bdata = new Uint32Array(4); bdata[0] = W; bdata[1] = H;
  device.queue.writeBuffer(blitParamsBuf, 0, bdata);

  const cmd = device.createCommandEncoder();
  if (needsClear) { needsClear = false; cmd.clearBuffer(accumBuf); }

  // Compute-Pass (optional mit Timestamp)
  const cpDesc: GPUComputePassDescriptor = supportsTimestamp && measureGpu
    ? { timestampWrites: { querySet: querySet!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
    : {};
  const cp = cmd.beginComputePass(cpDesc);
  cp.setPipeline(computePipeline);
  cp.setBindGroup(0, computeBindGroup!);
  cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
  cp.end();

  // Timestamp-Resolve nach Compute-Pass
  if (supportsTimestamp && measureGpu) {
    cmd.resolveQuerySet(querySet!, 0, 2, queryResolveBuf!, 0);
    cmd.copyBufferToBuffer(queryResolveBuf!, 0, queryReadBuf!, 0, 16);
  }

  // Blit-Pass
  const rp = cmd.beginRenderPass({
    colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: {r:0,g:0,b:0,a:1}, loadOp: "clear", storeOp: "store" }],
  });
  rp.setPipeline(blitPipeline);
  rp.setBindGroup(0, blitBindGroup!);
  rp.draw(3);
  rp.end();

  device.queue.submit([cmd.finish()]);

  // GPU-Timestamp asynchron auslesen (kein Frame-Block)
  if (supportsTimestamp && measureGpu && !gpuReadPending) {
    gpuReadPending = true;
    queryReadBuf!.mapAsync(GPUMapMode.READ).then(() => {
      const buf = new BigInt64Array(queryReadBuf!.getMappedRange());
      const ns  = Number(buf[1] - buf[0]);
      gpuMsLast = ns / 1_000_000;
      queryReadBuf!.unmap();
      gpuReadPending = false;
    }).catch(() => { gpuReadPending = false; });
  } else if (!supportsTimestamp && measureGpu) {
    // Fallback: CPU-Zeit der queue.submit
    gpuMsLast = performance.now() - now;
  }

  frameIndex++;

  if (pendingCapture) { pendingCapture = false; captureWebp(); }
  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
