import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat4 } from "gl-matrix";
import { generateToolpath, type ToolMove } from "./toolpath";
import COMPUTE_SHADER    from "./shaders/gpu/simulate.wgsl?raw";
import HEIGHTFIELD_SHADER from "./shaders/gpu/heightfield.wgsl?raw";
import TOOL_SHADER       from "./shaders/gpu/tool.wgsl?raw";

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------
const ZMAP_SIZE          = 256;
const WG_SIZE            = 8;
const TOOL_UNIFORM_SIZE  = 32;    // ToolUniforms Struct-Größe (Bytes)
const TOOL_UNIFORM_STRIDE = 256;  // Aligned Stride für Dynamic Offsets
const HEIGHT_SCALE       = 0.7;
const TOOL_SEGMENTS      = 40;
const TOOL_RINGS         = 8;
const TOOL_TOP_Y         = 0.98;
void HEIGHT_SCALE; // prevent unused warning (value baked into WGSL)

// ---------------------------------------------------------------------------
// Hilfs-Funktionen
// ---------------------------------------------------------------------------

function generateGridIndices(n: number): Uint32Array {
  const data = new Uint32Array((n - 1) * (n - 1) * 6);
  let i = 0;
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const tl = row * n + col, tr = tl + 1;
      const bl = (row + 1) * n + col, br = bl + 1;
      data[i++] = tl; data[i++] = bl; data[i++] = tr;
      data[i++] = tr; data[i++] = bl; data[i++] = br;
    }
  }
  return data;
}

interface DispatchRange { minX: number; minY: number; countX: number; countY: number; }

function getDispatchRange(move: ToolMove, sz: number): DispatchRange {
  const cx = (move.x + 1.0) * 0.5 * sz;
  const cy = (move.y + 1.0) * 0.5 * sz;
  const rp = move.toolRadius * 0.5 * sz + 1.5;
  const minX = Math.max(0, Math.floor(cx - rp));
  const maxX = Math.min(sz - 1, Math.ceil(cx + rp));
  const minY = Math.max(0, Math.floor(cy - rp));
  const maxY = Math.min(sz - 1, Math.ceil(cy + rp));
  return { minX, minY, countX: maxX - minX + 1, countY: maxY - minY + 1 };
}

function writeToolUniform(
  dst: ArrayBuffer, off: number, move: ToolMove, sz: number, ox: number, oy: number,
): void {
  const f = new Float32Array(dst, off, 4);
  const u = new Uint32Array(dst, off + 16, 4);
  f[0] = move.x; f[1] = move.y; f[2] = move.cutZ; f[3] = move.toolRadius;
  u[0] = move.toolType; u[1] = sz; u[2] = ox; u[3] = oy;
}

function generateToolMesh(move: ToolMove): Float32Array {
  const cx = move.x, cz = move.y, r = move.toolRadius;
  const tipY = move.cutZ * 0.7; // HEIGHT_SCALE = 0.7
  const S = TOOL_SEGMENTS;
  const v: number[] = [];
  const tri = (
    a: [number, number, number], na: [number, number, number],
    b: [number, number, number], nb: [number, number, number],
    c: [number, number, number], nc: [number, number, number],
  ): void => {
    v.push(a[0], a[1], a[2], na[0], na[1], na[2]);
    v.push(b[0], b[1], b[2], nb[0], nb[1], nb[2]);
    v.push(c[0], c[1], c[2], nc[0], nc[1], nc[2]);
  };
  const shaftBaseY = move.toolType === 1 ? tipY + r : tipY;

  for (let i = 0; i < S; i++) {
    const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p0b: [number, number, number] = [cx + r * c0, shaftBaseY, cz + r * s0];
    const p1b: [number, number, number] = [cx + r * c1, shaftBaseY, cz + r * s1];
    const p0t: [number, number, number] = [cx + r * c0, TOOL_TOP_Y, cz + r * s0];
    const p1t: [number, number, number] = [cx + r * c1, TOOL_TOP_Y, cz + r * s1];
    const n0: [number, number, number] = [c0, 0, s0];
    const n1: [number, number, number] = [c1, 0, s1];
    tri(p0b, n0, p1b, n1, p1t, n1); tri(p0b, n0, p1t, n1, p0t, n0);
  }
  const up: [number, number, number] = [0, 1, 0];
  const topC: [number, number, number] = [cx, TOOL_TOP_Y, cz];
  for (let i = 0; i < S; i++) {
    const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
    tri(topC, up, [cx + r * Math.cos(a0), TOOL_TOP_Y, cz + r * Math.sin(a0)], up,
      [cx + r * Math.cos(a1), TOOL_TOP_Y, cz + r * Math.sin(a1)], up);
  }
  if (move.toolType === 0) {
    const down: [number, number, number] = [0, -1, 0];
    const botC: [number, number, number] = [cx, tipY, cz];
    for (let i = 0; i < S; i++) {
      const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
      tri(botC, down, [cx + r * Math.cos(a1), tipY, cz + r * Math.sin(a1)], down,
        [cx + r * Math.cos(a0), tipY, cz + r * Math.sin(a0)], down);
    }
  } else {
    const yc = shaftBaseY;
    for (let j = 0; j < TOOL_RINGS; j++) {
      const e0 = (j / TOOL_RINGS) * (Math.PI / 2), e1 = ((j + 1) / TOOL_RINGS) * (Math.PI / 2);
      const rr0 = r * Math.cos(e0), yy0 = yc - r * Math.sin(e0);
      const rr1 = r * Math.cos(e1), yy1 = yc - r * Math.sin(e1);
      for (let i = 0; i < S; i++) {
        const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const P = (rr: number, yy: number, c: number, s: number): [number, number, number] =>
          [cx + rr * c, yy, cz + rr * s];
        const NM = (e: number, c: number, s: number): [number, number, number] =>
          [Math.cos(e) * c, -Math.sin(e), Math.cos(e) * s];
        const A = P(rr0, yy0, c0, s0), B = P(rr0, yy0, c1, s1);
        const C = P(rr1, yy1, c0, s0), D = P(rr1, yy1, c1, s1);
        tri(A, NM(e0, c0, s0), B, NM(e0, c1, s1), D, NM(e1, c1, s1));
        tri(A, NM(e0, c0, s0), D, NM(e1, c1, s1), C, NM(e1, c0, s0));
      }
    }
  }
  return new Float32Array(v);
}

// ---------------------------------------------------------------------------
// App (top-level await)
// ---------------------------------------------------------------------------

const canvas     = document.getElementById("gl") as HTMLCanvasElement;
const progressEl = document.getElementById("progress") as HTMLDivElement;
const resultsEl  = document.getElementById("results") as HTMLDivElement;
void resultsEl; // Benchmark-Platz für spätere Nutzung

if (!navigator.gpu) throw new Error("WebGPU nicht verfuegbar.");
const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
if (!adapter) throw new Error("Kein WebGPU-Adapter gefunden.");
const device = await adapter.requestDevice();

const context = canvas.getContext("webgpu") as GPUCanvasContext;
const format  = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: "opaque" });

const RESOLUTIONS = [128, 256, 512, 1024, 2048];
const toolpath    = generateToolpath();

let zmapSize   = ZMAP_SIZE;
let renderedIdx = 0;

let zmapBuffer!:        GPUBuffer;
let indexBuffer!:       GPUBuffer;
let indexCount = 0;
let toolUniformBuffer!: GPUBuffer;
let carveBindGroup!:    GPUBindGroup;
let fieldBindGroup!:    GPUBindGroup;

// Gemeinsamer Kamera-Uniform-Buffer (80 Bytes: mat4 + vec3 + grid_size).
const cameraBuffer = device.createBuffer({
  label: "camera", size: 80,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Shader-Module
const carveModule = device.createShaderModule({ label: "carve", code: COMPUTE_SHADER });
const fieldModule = device.createShaderModule({ label: "field", code: HEIGHTFIELD_SHADER });
const toolModule  = device.createShaderModule({ label: "tool",  code: TOOL_SHADER });

// Bind-Group-Layouts
const carveBGL = device.createBindGroupLayout({ label: "carve-bgl", entries: [
  { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
  { binding: 1, visibility: GPUShaderStage.COMPUTE,
    buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: TOOL_UNIFORM_SIZE } },
]});
const fieldBGL = device.createBindGroupLayout({ label: "field-bgl", entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
  { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: 80 } },
]});
const toolBGL = device.createBindGroupLayout({ label: "tool-bgl", entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: 80 } },
]});

const depthStencil: GPUDepthStencilState = {
  format: "depth24plus", depthWriteEnabled: true, depthCompare: "less",
};

// Pipelines
const carvePipeline = device.createComputePipeline({
  label: "carve",
  layout: device.createPipelineLayout({ bindGroupLayouts: [carveBGL] }),
  compute: { module: carveModule, entryPoint: "main" },
});

function fieldPipeline(entry: string): GPURenderPipeline {
  return device.createRenderPipeline({
    label: `field-${entry}`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [fieldBGL] }),
    vertex:   { module: fieldModule, entryPoint: entry },
    fragment: { module: fieldModule, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil, multisample: { count: 4 },
  });
}
const surfacePipeline = fieldPipeline("vs_surface");
const skirtPipeline   = fieldPipeline("vs_skirt");

const toolPipeline = device.createRenderPipeline({
  label: "tool",
  layout: device.createPipelineLayout({ bindGroupLayouts: [toolBGL] }),
  vertex: {
    module: toolModule, entryPoint: "vs_main",
    buffers: [{ arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0,  format: "float32x3" },
      { shaderLocation: 1, offset: 12, format: "float32x3" },
    ]}],
  },
  fragment: { module: toolModule, entryPoint: "fs_main", targets: [{ format }] },
  primitive: { topology: "triangle-list", cullMode: "none" },
  depthStencil, multisample: { count: 4 },
});

const toolBindGroup = device.createBindGroup({
  label: "tool-bg", layout: toolBGL,
  entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
});

const TOOL_MAX_VERTS = (TOOL_SEGMENTS * 6) + (TOOL_SEGMENTS * 3) + (TOOL_SEGMENTS * TOOL_RINGS * 6);
const toolVertexBuffer = device.createBuffer({
  label: "tool-verts", size: TOOL_MAX_VERTS * 24,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

function rebuildForResolution(size: number): void {
  zmapSize = size;
  zmapBuffer?.destroy(); indexBuffer?.destroy(); toolUniformBuffer?.destroy();
  zmapBuffer = device.createBuffer({
    label: "zmap", size: size * size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const gridIndices = generateGridIndices(size);
  indexBuffer = device.createBuffer({
    label: "grid-indices", size: gridIndices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, gridIndices.buffer);
  indexCount = gridIndices.length;
  const uniformData = new ArrayBuffer(toolpath.length * TOOL_UNIFORM_STRIDE);
  toolpath.forEach((move, i) => {
    const r = getDispatchRange(move, size);
    writeToolUniform(uniformData, i * TOOL_UNIFORM_STRIDE, move, size, r.minX, r.minY);
  });
  toolUniformBuffer = device.createBuffer({
    label: "tool-uniforms", size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(toolUniformBuffer, 0, uniformData);
  carveBindGroup = device.createBindGroup({ label: "carve-bg", layout: carveBGL, entries: [
    { binding: 0, resource: { buffer: zmapBuffer } },
    { binding: 1, resource: { buffer: toolUniformBuffer, offset: 0, size: TOOL_UNIFORM_SIZE } },
  ]});
  fieldBindGroup = device.createBindGroup({ label: "field-bg", layout: fieldBGL, entries: [
    { binding: 0, resource: { buffer: zmapBuffer } },
    { binding: 1, resource: { buffer: cameraBuffer } },
  ]});
  clearZmap();
}

function clearZmap(): void {
  device.queue.writeBuffer(zmapBuffer, 0, new Float32Array(zmapSize * zmapSize).fill(1.0));
  renderedIdx = 0;
}

rebuildForResolution(zmapSize);

function applyStepRange(encoder: GPUCommandEncoder, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    const r = getDispatchRange(toolpath[i], zmapSize);
    if (r.countX <= 0 || r.countY <= 0) continue;
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(carvePipeline);
    cpass.setBindGroup(0, carveBindGroup, [i * TOOL_UNIFORM_STRIDE]);
    cpass.dispatchWorkgroups(Math.ceil(r.countX / WG_SIZE), Math.ceil(r.countY / WG_SIZE));
    cpass.end();
  }
}

// MSAA + Tiefe
const SAMPLE_COUNT = 4;
let depthTexture: GPUTexture | null = null;
let msaaTexture:  GPUTexture | null = null;
function getTargets(): { depth: GPUTexture; color: GPUTexture } {
  const w = canvas.width, h = canvas.height;
  if (!depthTexture || depthTexture.width !== w || depthTexture.height !== h) {
    depthTexture?.destroy(); msaaTexture?.destroy();
    depthTexture = device.createTexture({ size:[w,h], format:"depth24plus", sampleCount:SAMPLE_COUNT, usage:GPUTextureUsage.RENDER_ATTACHMENT });
    msaaTexture  = device.createTexture({ size:[w,h], format, sampleCount:SAMPLE_COUNT, usage:GPUTextureUsage.RENDER_ATTACHMENT });
  }
  return { depth: depthTexture, color: msaaTexture! };
}

// Canvas-Resize
const ro = new ResizeObserver(() => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.round(canvas.clientWidth  * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
});
ro.observe(canvas);

// Orbit-Kamera
const cam = { azimuth: -0.4, elevation: 0.62, radius: 3.6 };
let dragging = false, lastMouse = { x: 0, y: 0 };
canvas.addEventListener("mousedown", (e) => { dragging = true; lastMouse = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  cam.azimuth   += (e.clientX - lastMouse.x) * 0.006;
  cam.elevation  = Math.max(0.05, Math.min(Math.PI/2 - 0.05, cam.elevation - (e.clientY - lastMouse.y) * 0.006));
  lastMouse = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("mouseup",    () => { dragging = false; });
canvas.addEventListener("mouseleave", () => { dragging = false; });
canvas.addEventListener("wheel", (e) => {
  cam.radius = Math.max(1.8, Math.min(8.0, cam.radius * (1 + e.deltaY * 0.001)));
  e.preventDefault();
}, { passive: false });

// GUI
const params = {
  playing: true, speed: 24, progress: 0, resolution: zmapSize, showTool: true,
  reset(): void { clearZmap(); params.progress = 0; progressCtrl.updateDisplay(); params.playing = true; playingCtrl.updateDisplay(); },
};
const gui = new GUI({ title: "CNC Simulation (WebGPU)" });
const playingCtrl  = gui.add(params, "playing").name("Abspielen");
gui.add(params, "speed", 1, 200, 1).name("Schritte / Frame");
const progressCtrl = gui.add(params, "progress", 0, toolpath.length, 1).name("Fortschritt")
  .onChange(() => { params.playing = false; playingCtrl.updateDisplay(); });
gui.add(params, "resolution", RESOLUTIONS).name("Auflösung").onChange((v: number) => rebuildForResolution(v));
gui.add(params, "showTool").name("Werkzeug zeigen");
gui.add(params, "reset").name("Zurücksetzen");

// Kamera-Update
function updateCamera(): void {
  const { azimuth, elevation, radius } = cam;
  const ex = radius * Math.cos(elevation) * Math.sin(azimuth);
  const ey = radius * Math.sin(elevation);
  const ez = radius * Math.cos(elevation) * Math.cos(azimuth);
  const view = mat4.create(); mat4.lookAt(view, [ex, ey, ez], [0, 0.30, 0], [0, 1, 0]);
  const proj = mat4.create(); mat4.perspective(proj, Math.PI/4, canvas.width / (canvas.height || 1), 0.1, 20.0);
  const vp = mat4.create(); mat4.multiply(vp, proj, view);
  const data = new Float32Array(20);
  data.set(vp as Float32Array, 0);
  data[16] = ex; data[17] = ey; data[18] = ez; data[19] = zmapSize;
  device.queue.writeBuffer(cameraBuffer, 0, data);
}

// Render-Loop
function scheduleNextFrame(): void {
  if (document.hidden) { setTimeout(frame, 16); } else { requestAnimationFrame(frame); }
}

function frame(): void {
  updateCamera();
  if (params.playing && params.progress < toolpath.length) {
    params.progress = Math.min(toolpath.length, params.progress + params.speed);
    progressCtrl.updateDisplay();
    if (params.progress >= toolpath.length) { params.playing = false; playingCtrl.updateDisplay(); }
  }
  const target = Math.round(params.progress);
  progressEl.textContent = target >= toolpath.length
    ? "Fertig"
    : `${Math.round((target / toolpath.length) * 100)}%  (${target} / ${toolpath.length})`;

  const encoder = device.createCommandEncoder();
  if (target < renderedIdx) { clearZmap(); }
  if (target > renderedIdx) { applyStepRange(encoder, renderedIdx, target); renderedIdx = target; }

  let toolVertexCount = 0;
  if (params.showTool && target > 0 && target < toolpath.length) {
    const mesh = generateToolMesh(toolpath[target - 1]);
    device.queue.writeBuffer(toolVertexBuffer, 0, mesh.buffer, mesh.byteOffset, mesh.byteLength);
    toolVertexCount = mesh.length / 6;
  }

  const targets = getTargets();
  const rpass = encoder.beginRenderPass({
    colorAttachments: [{
      view: targets.color.createView(),
      resolveTarget: context.getCurrentTexture().createView(),
      clearValue: [0.05, 0.06, 0.09, 1.0], loadOp: "clear", storeOp: "store",
    }],
    depthStencilAttachment: {
      view: targets.depth.createView(),
      depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store",
    },
  });

  rpass.setPipeline(surfacePipeline);
  rpass.setBindGroup(0, fieldBindGroup);
  rpass.setIndexBuffer(indexBuffer, "uint32");
  rpass.drawIndexed(indexCount);

  rpass.setPipeline(skirtPipeline);
  rpass.setBindGroup(0, fieldBindGroup);
  rpass.draw(4 * (zmapSize - 1) * 6);

  if (toolVertexCount > 0) {
    rpass.setPipeline(toolPipeline);
    rpass.setBindGroup(0, toolBindGroup);
    rpass.setVertexBuffer(0, toolVertexBuffer);
    rpass.draw(toolVertexCount);
  }
  rpass.end();
  device.queue.submit([encoder.finish()]);
  scheduleNextFrame();
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) requestAnimationFrame(frame); });
scheduleNextFrame();
