import { GUI } from "lil-gui";
import { vec3 } from "gl-matrix";
import { getWebGPU, resizeWebGPUCanvas } from "../../../src/shared/webgpu";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import { COMPUTE_SRC, BLIT_VS, BLIT_FS } from "./shaders.wgsl";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const { device, context, format } = await getWebGPU(canvas);

// --- Buffer-Layout -------------------------------------------------------
// Compute-Params-Buffer (64 Bytes):
//   resolution: vec2<u32> (8 Bytes) + frameIndex: u32 + _pad: u32 → 16 Bytes
//   camPos:     vec4 (16 Bytes, offset 16)
//   camForward: vec4 (16 Bytes, offset 32)
//   camRight:   vec4 (16 Bytes, offset 48)
//   camUp:      vec4 (16 Bytes, offset 64) → 80 Bytes → 256 alloc

const PARAMS_SIZE = 256;
let   accumSize   = 0;

let paramsBuf: GPUBuffer = device.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
let accumBuf:  GPUBuffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE });

// Blit-Params-Buffer (16 Bytes)
const blitParamsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

// --- Pipelines -----------------------------------------------------------

// Compute
const computeBGL = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
  ],
});
const computePipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
  compute: { module: device.createShaderModule({ code: COMPUTE_SRC }), entryPoint: "main" },
});

// Blit
const blitBGL = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
  ],
});
const blitVsModule = device.createShaderModule({ code: BLIT_VS });
const blitFsModule = device.createShaderModule({ code: BLIT_FS });
const blitPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [blitBGL] }),
  vertex:   { module: blitVsModule, entryPoint: "vs_main" },
  fragment: { module: blitFsModule, entryPoint: "fs_main", targets: [{ format }] },
  primitive: { topology: "triangle-list" },
});

let computeBindGroup: GPUBindGroup | null = null;
let blitBindGroup:    GPUBindGroup | null = null;

function rebuildAccumBuffer(w: number, h: number): void {
  const pixels = w * h;
  const size   = pixels * 16; // 4 × f32 per pixel
  if (size === accumSize) return;
  accumSize = size;

  accumBuf.destroy();
  accumBuf = device.createBuffer({
    size: Math.max(size, 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  computeBindGroup = device.createBindGroup({
    layout: computeBGL,
    entries: [
      { binding: 0, resource: { buffer: paramsBuf  } },
      { binding: 1, resource: { buffer: accumBuf   } },
    ],
  });
  blitBindGroup = device.createBindGroup({
    layout: blitBGL,
    entries: [
      { binding: 0, resource: { buffer: accumBuf      } },
      { binding: 1, resource: { buffer: blitParamsBuf } },
    ],
  });
  frameIndex = 0;
}

// --- Params & GUI --------------------------------------------------------
let frameIndex = 0;
let needsClear = false;

// Orbit-Kamera (Polar-Koordinaten um den Szenen-Mittelpunkt)
const orbit = { theta: 0, phi: 1.32, dist: 3.4 };
const TARGET: [number, number, number] = [0, -0.2, 0];

function orbitCamPos(): [number, number, number] {
  return [
    TARGET[0] + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    TARGET[1] + orbit.dist * Math.cos(orbit.phi),
    TARGET[2] + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta),
  ];
}

function resetAccum(): void {
  frameIndex = 0;
  needsClear = true;
}

// Maus-Orbit
{
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lastX) * 0.008;
    orbit.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, orbit.phi - (e.clientY - lastY) * 0.008));
    lastX = e.clientX; lastY = e.clientY;
    resetAccum();
  });
  canvas.addEventListener("pointerup",    () => { dragging = false; });
  canvas.addEventListener("wheel", (e) => {
    orbit.dist = Math.max(1.0, Math.min(8.0, orbit.dist + e.deltaY * 0.01));
    resetAccum();
    e.preventDefault();
  }, { passive: false });
}

const stats     = createStatsPanel(document.getElementById("app")!);
const benchmark = new BenchmarkRun(60, 300);
let pendingCapture = false;

function captureWebp(): void {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raytracer-webgpu-${new Date().toISOString().replace(/[:.]/g, "-")}.webp`;
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
  resultsEl.textContent = `[WebGPU] Compute Raytracer\nAkkum-Frames: ${frameIndex}\n${formatResult(result)}`;
}

const gui = new GUI({ title: "Raytracer (WebGPU)" });
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (webp)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// Aktuellen Frame-Count anzeigen
const frameCountCtrl = gui.add({ frames: 0 }, "frames").name("Akkum-Frames").disable();
setInterval(() => { (frameCountCtrl as { setValue: (v: number) => void }).setValue(frameIndex); }, 500);

// --- Kamera-Helfer -------------------------------------------------------

function buildCameraVectors(): { pos: [number,number,number]; forward: vec3; right: vec3; up: vec3 } {
  const p = orbitCamPos();
  const camPos  = vec3.fromValues(p[0], p[1], p[2]);
  const forward = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), TARGET, camPos));
  const right   = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), forward, [0, 1, 0]));
  const up      = vec3.cross(vec3.create(), right, forward);
  return { pos: p, forward, right, up };
}

// --- Render-Loop ---------------------------------------------------------

function render(now: number): void {
  const changed = resizeWebGPUCanvas(canvas);
  if (changed) { rebuildAccumBuffer(canvas.width, canvas.height); }
  if (!computeBindGroup || !blitBindGroup) {
    rebuildAccumBuffer(canvas.width, canvas.height);
  }

  const W = canvas.width;
  const H = canvas.height;

  // Params-Buffer befüllen
  const pdata = new Float32Array(PARAMS_SIZE / 4);
  const udata = new Uint32Array(pdata.buffer);
  udata[0] = W; udata[1] = H; udata[2] = frameIndex;
  const cam = buildCameraVectors();
  pdata[4] = cam.pos[0]; pdata[5] = cam.pos[1]; pdata[6] = cam.pos[2]; pdata[7] = 0;
  pdata[8] = cam.forward[0]; pdata[9]  = cam.forward[1]; pdata[10] = cam.forward[2]; pdata[11] = 0;
  pdata[12] = cam.right[0];  pdata[13] = cam.right[1];  pdata[14] = cam.right[2];  pdata[15] = 0;
  pdata[16] = cam.up[0];     pdata[17] = cam.up[1];     pdata[18] = cam.up[2];     pdata[19] = 0;
  device.queue.writeBuffer(paramsBuf, 0, pdata);

  // Blit-Params
  const bdata = new Uint32Array(4);
  bdata[0] = W; bdata[1] = H;
  device.queue.writeBuffer(blitParamsBuf, 0, bdata);

  const cmd = device.createCommandEncoder();

  // Akkumulations-Buffer löschen (wenn Kamera sich bewegt hat)
  if (needsClear) { needsClear = false; cmd.clearBuffer(accumBuf); }

  // Compute-Pass: ein Invocation pro Pixel
  {
    const pass = cmd.beginComputePass();
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, computeBindGroup!);
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
  }

  // Blit-Pass: Akkumulations-Buffer → Screen
  {
    const pass = cmd.beginRenderPass({
      colorAttachments: [{
        view:       context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp:     "clear",
        storeOp:    "store",
      }],
    });
    pass.setPipeline(blitPipeline);
    pass.setBindGroup(0, blitBindGroup!);
    pass.draw(3); // Fullscreen-Dreieck
    pass.end();
  }

  device.queue.submit([cmd.finish()]);
  frameIndex++;

  if (pendingCapture) { pendingCapture = false; captureWebp(); }

  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
