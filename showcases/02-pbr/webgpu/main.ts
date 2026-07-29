import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";

import {
  getWebGPU,
  resizeWebGPUCanvas,
  createDepthTexture,
  createUniformBuffer,
  createStorageBuffer,
  createGPUVertexBuffer,
  createGPUIndexBuffer,
  VERTEX_BUFFER_LAYOUT,
  mat3ToMat4Array,
  makeRenderPassDescriptor,
} from "../../../src/shared/webgpu";
import { createUvSphere } from "../../../src/shared/geometry";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import { VS_SRC, FS_SRC } from "./shaders.wgsl";

// --- WebGPU Init ---------------------------------------------------------

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const labelsCanvas = document.getElementById("labels") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const { device, context, format } = await getWebGPU(canvas);

// --- Grid-Konfiguration --------------------------------------------------

const COLS = 6;
const ROWS = 6;
const SPACING = 1.25;
const ROUGHNESS = [0.05, 0.2, 0.4, 0.6, 0.8, 1.0];
const METALLIC  = [1.0, 0.8, 0.6, 0.4, 0.2, 0.0];
const NUM_SPHERES = COLS * ROWS;

// --- Sphere-Geometrie ----------------------------------------------------

const sphereGeo = createUvSphere(0.5, 48, 32);
const sphereVB  = createGPUVertexBuffer(device, sphereGeo.vertices);
const sphereIB  = createGPUIndexBuffer(device, sphereGeo.indices);

// --- Storage-Buffer: SphereData[36] --------------------------------------
// Layout pro Eintrag (144 Bytes = 36 floats):
//   model:     mat4x4 (16 floats = 64 Bytes)
//   normalMat: mat4x4 (16 floats = 64 Bytes)
//   roughness: f32    (1 float  =  4 Bytes)
//   metallic:  f32    (1 float  =  4 Bytes)
//   _p0, _p1:  f32×2  (2 floats =  8 Bytes)

const SPHERE_STRIDE = 36; // floats per sphere
const sphereStorageData = new Float32Array(NUM_SPHERES * SPHERE_STRIDE);

function updateSphereStorage(): void {
  const tempModel  = mat4.create();
  const tempNorm3  = mat3.create();
  const tempNorm4  = new Float32Array(16);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i  = row * COLS + col;
      const tx = (col - (COLS - 1) / 2) * SPACING;
      const ty = ((ROWS - 1) / 2 - row) * SPACING;

      mat4.fromTranslation(tempModel, vec3.fromValues(tx, ty, 0));
      mat3.normalFromMat4(tempNorm3, tempModel);
      mat3ToMat4Array(tempNorm3, tempNorm4, 0);

      const off = i * SPHERE_STRIDE;
      sphereStorageData.set(tempModel, off);
      sphereStorageData.set(tempNorm4, off + 16);
      sphereStorageData[off + 32] = ROUGHNESS[col];
      sphereStorageData[off + 33] = METALLIC[row];
    }
  }
}

updateSphereStorage();

const sphereStorageBuf = createStorageBuffer(device, sphereStorageData.byteLength);
device.queue.writeBuffer(sphereStorageBuf, 0, sphereStorageData);

// --- Camera-Uniform-Buffer (256 Bytes) ------------------------------------
// Layout:
//   view:       mat4x4 (64 Bytes, offset  0)
//   proj:       mat4x4 (64 Bytes, offset 64)
//   viewPos:    vec4   (16 Bytes, offset 128)
//   lightPos:   vec4   (16 Bytes, offset 144)
//   lightColor: vec4   (16 Bytes, offset 160)
//   albedo:     vec4   (16 Bytes, offset 176) xyz=albedo, w=ambient

const camBuf  = createUniformBuffer(device, 256);
const camData = new Float32Array(64);

// --- Bind-Group-Layouts & Pipelines --------------------------------------

const camBGL = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
  ],
});
const sphereBGL = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
  ],
});

const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [camBGL, sphereBGL] });

const vsModule = device.createShaderModule({ code: VS_SRC });
const fsModule = device.createShaderModule({ code: FS_SRC });

const pipeline = device.createRenderPipeline({
  layout: pipelineLayout,
  vertex:   { module: vsModule, entryPoint: "vs_main", buffers: [VERTEX_BUFFER_LAYOUT] },
  fragment: { module: fsModule, entryPoint: "fs_main", targets: [{ format }] },
  primitive:    { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

const camBindGroup = device.createBindGroup({
  layout: camBGL,
  entries: [{ binding: 0, resource: { buffer: camBuf } }],
});
const sphereBindGroup = device.createBindGroup({
  layout: sphereBGL,
  entries: [{ binding: 0, resource: { buffer: sphereStorageBuf } }],
});

// --- Kamera + Matrizen ---------------------------------------------------

const proj      = mat4.create();
const view      = mat4.create();
const cameraPos = vec3.fromValues(0, 0, 9.0);
const projView  = mat4.create();
const FOV_DEG   = 52;

mat4.lookAt(view, cameraPos, [0, -0.15, 0], [0, 1, 0]);

function updateProjection(): void {
  const aspect = canvas.width / Math.max(1, canvas.height);
  mat4.perspective(proj, (FOV_DEG * Math.PI) / 180, aspect, 0.1, 50);
  mat4.multiply(projView, proj, view);
}

// --- Params & GUI --------------------------------------------------------

const params = {
  albedo:         [0x8c / 255, 0x2d / 255, 0x82 / 255] as [number, number, number],
  ambient:        0.06,
  lightX:         5.0,
  lightY:         6.0,
  lightZ:         7.0,
  lightIntensity: 4.0,
};

const lightPos   = vec3.create();
const lightColor = vec3.create();

function updateLight(): void {
  vec3.set(lightPos,   params.lightX, params.lightY, params.lightZ);
  vec3.set(lightColor, params.lightIntensity, params.lightIntensity * 0.98, params.lightIntensity * 0.94);
}
updateLight();

const stats     = createStatsPanel(document.getElementById("app")!);
const benchmark = new BenchmarkRun();
let pendingCapture = false;

function captureWebp(): void {
  const merged = document.createElement("canvas");
  merged.width = canvas.width; merged.height = canvas.height;
  const ctx = merged.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0);
  ctx.drawImage(labelsCanvas, 0, 0);
  merged.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pbr-grid-webgpu.png`;
      a.click();
      URL.revokeObjectURL(url);
    },
    "image/png",
  );
}

async function runBenchmark(): Promise<void> {
  resultsEl.style.display = "block";
  resultsEl.textContent = "Messung läuft ...";
  const result = await benchmark.start();
  resultsEl.textContent = `[WebGPU] PBR Grid – ${NUM_SPHERES} Kugeln\n${formatResult(result)}`;
}

const gui = new GUI({ title: "PBR (WebGPU)" });
gui.addColor(params, "albedo").name("Albedo");
gui.add(params, "ambient", 0, 0.4, 0.01).name("Ambient");
const lightFolder = gui.addFolder("Licht");
lightFolder.close();
lightFolder.add(params, "lightX", -12, 12, 0.1).name("X").onChange(updateLight);
lightFolder.add(params, "lightY", -12, 12, 0.1).name("Y").onChange(updateLight);
lightFolder.add(params, "lightZ",   0, 16, 0.1).name("Z").onChange(updateLight);
lightFolder.add(params, "lightIntensity", 0.5, 10, 0.1).name("Intensität").onChange(updateLight);
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// --- Achsenbeschriftung (2D-Canvas-Overlay) ------------------------------

const labelsCtx = labelsCanvas.getContext("2d")!;

function worldToScreen(x: number, y: number, z: number, w: number, h: number): [number, number] {
  const pv = projView;
  const cx = pv[0]*x + pv[4]*y + pv[8]*z  + pv[12];
  const cy = pv[1]*x + pv[5]*y + pv[9]*z  + pv[13];
  const cw = pv[3]*x + pv[7]*y + pv[11]*z + pv[15];
  return [(cx/cw + 1) * 0.5 * w, (1 - cy/cw) * 0.5 * h];
}

function drawLabels(): void {
  const w = labelsCanvas.width;
  const h = labelsCanvas.height;
  labelsCtx.clearRect(0, 0, w, h);
  const fs = Math.max(11, Math.round(w * 0.016));
  const fsS = Math.max(10, Math.round(w * 0.012));
  const botY = -((ROWS - 1) / 2) * SPACING;
  const lefX = -((COLS - 1) / 2) * SPACING;

  labelsCtx.font = `${fsS}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#6b7280";
  labelsCtx.textAlign = "center";
  labelsCtx.textBaseline = "top";
  for (let col = 0; col < COLS; col++) {
    const wx = (col - (COLS - 1) / 2) * SPACING;
    const [sx, sy] = worldToScreen(wx, botY - SPACING * 0.6, 0, w, h);
    labelsCtx.fillText(String(ROUGHNESS[col]), sx, sy);
  }
  labelsCtx.font = `bold ${fs}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#6b7280";
  labelsCtx.textBaseline = "bottom";
  const [, ty] = worldToScreen(0, botY - SPACING * 1.1, 0, w, h);
  labelsCtx.fillText("Roughness", w * 0.5, Math.min(ty + fs, h - 2));

  labelsCtx.font = `${fsS}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#6b7280";
  labelsCtx.textAlign = "right";
  labelsCtx.textBaseline = "middle";
  for (let row = 0; row < ROWS; row++) {
    const wy = ((ROWS - 1) / 2 - row) * SPACING;
    const [sx, sy] = worldToScreen(lefX - SPACING * 0.55, wy, 0, w, h);
    labelsCtx.fillText(String(METALLIC[row].toFixed(1)), sx, sy);
  }
  const [tx] = worldToScreen(lefX - SPACING * 1.05, 0, 0, w, h);
  labelsCtx.save();
  labelsCtx.translate(Math.max(tx, fs * 1.2), h * 0.5);
  labelsCtx.rotate(-Math.PI / 2);
  labelsCtx.textAlign = "center"; labelsCtx.textBaseline = "middle";
  labelsCtx.font = `bold ${fs}px system-ui, sans-serif`;
  labelsCtx.fillStyle = "#6b7280";
  labelsCtx.fillText("Metallic", 0, 0);
  labelsCtx.restore();
}

// --- Depth-Texture -------------------------------------------------------

let depthTexture = createDepthTexture(device, canvas.width, canvas.height);

// --- Render-Loop ---------------------------------------------------------

function render(now: number): void {
  if (resizeWebGPUCanvas(canvas)) {
    depthTexture.destroy();
    depthTexture = createDepthTexture(device, canvas.width, canvas.height);
    labelsCanvas.width  = canvas.width;
    labelsCanvas.height = canvas.height;
  }
  updateProjection();

  // Camera-Buffer befüllen
  camData.set(view,  0);
  camData.set(proj, 16);
  camData[32] = cameraPos[0]; camData[33] = cameraPos[1]; camData[34] = cameraPos[2]; camData[35] = 0;
  camData[36] = lightPos[0];  camData[37] = lightPos[1];  camData[38] = lightPos[2];  camData[39] = 0;
  camData[40] = lightColor[0]; camData[41] = lightColor[1]; camData[42] = lightColor[2]; camData[43] = 0;
  camData[44] = params.albedo[0]; camData[45] = params.albedo[1]; camData[46] = params.albedo[2];
  camData[47] = params.ambient;

  device.queue.writeBuffer(camBuf, 0, camData);

  const cmd  = device.createCommandEncoder();
  const pass = cmd.beginRenderPass(makeRenderPassDescriptor(
    context.getCurrentTexture().createView(),
    depthTexture.createView(),
  ));

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, camBindGroup);
  pass.setBindGroup(1, sphereBindGroup);
  pass.setVertexBuffer(0, sphereVB);
  pass.setIndexBuffer(sphereIB, "uint32");
  pass.drawIndexed(sphereGeo.indexCount, NUM_SPHERES);

  pass.end();
  device.queue.submit([cmd.finish()]);

  drawLabels();

  if (pendingCapture) { pendingCapture = false; captureWebp(); }

  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
