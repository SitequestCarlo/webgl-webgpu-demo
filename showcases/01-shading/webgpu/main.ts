import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";

import {
  getWebGPU,
  resizeWebGPUCanvas,
  createDepthTexture,
  createUniformBuffer,
  createGPUVertexBuffer,
  createGPUIndexBuffer,
  VERTEX_BUFFER_LAYOUT,
  mat3ToMat4Array,
  makeRenderPassDescriptor,
} from "../../../src/shared/webgpu";
import { createTriangle, createUvSphere } from "../../../src/shared/geometry";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import { WGSL_SHADERS, SHADING_MODES, type ShadingMode } from "./shaders.wgsl";

// --- WebGPU Init ---------------------------------------------------------

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const { device, context, format } = await getWebGPU(canvas);

// --- Geometrie -----------------------------------------------------------

const triGeo = createTriangle();
const sphGeo = createUvSphere(1, 32, 16);

const triVB = createGPUVertexBuffer(device, triGeo.vertices);
const triIB = createGPUIndexBuffer(device, triGeo.indices);
const sphVB = createGPUVertexBuffer(device, sphGeo.vertices);
const sphIB = createGPUIndexBuffer(device, sphGeo.indices);

// --- Uniform-Buffer Layout -----------------------------------------------
// Transform:   4 × mat4x4 = 4 × 64 = 256 Bytes
// Material:    4 × vec4 + 4 × f32 = 80 Bytes → auf 256 aufgerundet

const TRANSFORM_SIZE = 256;
const MATERIAL_SIZE  = 256;

const triTransformBuf = createUniformBuffer(device, TRANSFORM_SIZE);
const sphTransformBuf = createUniformBuffer(device, TRANSFORM_SIZE);
const triMaterialBuf  = createUniformBuffer(device, MATERIAL_SIZE);
const sphMaterialBuf  = createUniformBuffer(device, MATERIAL_SIZE);

const triTransformData = new Float32Array(64); // 256 bytes
const sphTransformData = new Float32Array(64);
const triMaterialData  = new Float32Array(64);
const sphMaterialData  = new Float32Array(64);

// --- Bind-Group-Layout ---------------------------------------------------

const bgl = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
  ],
});
const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });

const triBindGroup = device.createBindGroup({
  layout: bgl,
  entries: [
    { binding: 0, resource: { buffer: triTransformBuf } },
    { binding: 1, resource: { buffer: triMaterialBuf  } },
  ],
});
const sphBindGroup = device.createBindGroup({
  layout: bgl,
  entries: [
    { binding: 0, resource: { buffer: sphTransformBuf } },
    { binding: 1, resource: { buffer: sphMaterialBuf  } },
  ],
});

// --- Render-Pipelines (eine pro Shading-Modus) ---------------------------

const depthFormat: GPUTextureFormat = "depth24plus";

function buildPipeline(wgsl: string): GPURenderPipeline {
  const module = device.createShaderModule({ code: wgsl });
  return device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: "vs_main", buffers: [VERTEX_BUFFER_LAYOUT] },
    fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "less" },
  });
}

const pipelines = Object.fromEntries(
  SHADING_MODES.map((m) => [m, buildPipeline(WGSL_SHADERS[m])])
) as Record<ShadingMode, GPURenderPipeline>;

// --- Kamera / Matrizen ---------------------------------------------------

const proj         = mat4.create();
const view         = mat4.create();
const model        = mat4.create();
const normalMatrix = mat3.create();

const cameraPos       = vec3.fromValues(0, 0, 3.2);
const lightPos        = vec3.fromValues(2.5, 3.0, 3.0);
const triLightPos     = vec3.fromValues(0, 0, 3.0);
const lightColor      = vec3.fromValues(1.0, 0.98, 0.95);
const triLightColor   = vec3.fromValues(0.55, 0.54, 0.52);

mat4.lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);

function updateProjection(aspect: number): void {
  mat4.perspective(proj, (50 * Math.PI) / 180, aspect, 0.1, 100);
}

// --- Params & GUI --------------------------------------------------------

const params = {
  shading:    "blinn-phong" as ShadingMode,
  segments:   32,
  rings:      16,
  autoRotate: false,
  color:      [0x8c / 255, 0x2d / 255, 0x82 / 255] as [number, number, number],
  ambient:    0.12,
  shininess:  48,
  toonSteps:  4,
  roughness:  0.4,
  metallic:   0.0,
  wireframe:  false,
};

let sphereVB2 = sphVB;
let sphereIB2 = sphIB;
let sphereIndexCount = sphGeo.indexCount;

function rebuildSphere(): void {
  const geo = createUvSphere(1, params.segments, params.rings);
  sphereVB2.destroy();
  sphereIB2.destroy();
  sphereVB2 = createGPUVertexBuffer(device, geo.vertices);
  sphereIB2 = createGPUIndexBuffer(device, geo.indices);
  sphereIndexCount = geo.indexCount;
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
      a.download = `shading-webgpu-${params.shading}-${new Date().toISOString().replace(/[:.]/g, "-")}.webp`;
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
  resultsEl.textContent = `[WebGPU] Shading: ${params.shading}\n${formatResult(result)}`;
}

const gui = new GUI({ title: "Shading (WebGPU)" });
gui.add(params, "shading", SHADING_MODES).name("Shading");
const geoFolder = gui.addFolder("Kugel-Tessellierung");
geoFolder.close();
geoFolder.add(params, "segments", 3, 128, 1).name("Segmente").onFinishChange(rebuildSphere);
geoFolder.add(params, "rings", 2, 64, 1).name("Ringe").onFinishChange(rebuildSphere);
const lightFolder = gui.addFolder("Material / Licht");
lightFolder.close();
lightFolder.addColor(params, "color").name("Farbe");
lightFolder.add(params, "ambient", 0, 1, 0.01).name("Ambient");
lightFolder.add(params, "shininess", 1, 256, 1).name("Glanz (Phong)");
const toonFolder = gui.addFolder("Toon");
toonFolder.close();
toonFolder.add(params, "toonSteps", 2, 10, 1).name("Stufen");
const pbrFolder = gui.addFolder("PBR");
pbrFolder.close();
pbrFolder.add(params, "roughness", 0.05, 1.0, 0.01).name("Roughness");
pbrFolder.add(params, "metallic", 0.0, 1.0, 0.01).name("Metallic");
gui.add(params, "autoRotate").name("Auto-Rotieren");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (webp)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// --- Helpers: Uniform-Buffer befüllen ------------------------------------

function writeMaterial(
  data: Float32Array,
  color: [number, number, number],
  ambient: number,
  lPos: vec3,
  shininess: number,
  vPos: vec3,
  toonSteps: number,
  lColor: vec3,
  roughness: number,
  metallic: number,
): void {
  data[0] = color[0]; data[1] = color[1]; data[2] = color[2]; data[3] = ambient;
  data[4] = lPos[0];  data[5] = lPos[1];  data[6] = lPos[2];  data[7] = shininess;
  data[8] = vPos[0];  data[9] = vPos[1];  data[10] = vPos[2]; data[11] = toonSteps;
  data[12] = lColor[0]; data[13] = lColor[1]; data[14] = lColor[2]; data[15] = roughness;
  data[16] = metallic;
}

function writeTransform(data: Float32Array, m: mat4, v: mat4, p: mat4, n: mat3): void {
  data.set(m, 0);
  data.set(v, 16);
  data.set(p, 32);
  mat3ToMat4Array(n, data, 48);
}

// --- Depth-Texture -------------------------------------------------------

let depthTexture = createDepthTexture(device, canvas.width, canvas.height);

// --- Render-Loop ---------------------------------------------------------

let angle    = 0;
let lastTime = performance.now();

function render(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (resizeWebGPUCanvas(canvas)) {
    depthTexture.destroy();
    depthTexture = createDepthTexture(device, canvas.width, canvas.height);
    updateProjection(canvas.width / 2 / Math.max(1, canvas.height));
  }

  if (params.autoRotate) angle += dt * 0.6;
  mat4.identity(model);
  mat4.rotateY(model, model, angle);
  mat4.rotateX(model, model, angle * 0.35);
  mat3.normalFromMat4(normalMatrix, model);

  const halfWidth = Math.floor(canvas.width / 2);
  updateProjection(halfWidth / Math.max(1, canvas.height));

  // Dreieck-Material (frontales Licht, gedimmt)
  writeMaterial(triMaterialData, params.color, params.ambient,
    triLightPos, params.shininess, cameraPos, params.toonSteps,
    triLightColor, params.roughness, params.metallic);

  // Kugel-Material (seitliches Licht)
  writeMaterial(sphMaterialData, params.color, params.ambient,
    lightPos, params.shininess, cameraPos, params.toonSteps,
    lightColor, params.roughness, params.metallic);

  writeTransform(triTransformData, model, view, proj, normalMatrix);
  writeTransform(sphTransformData, model, view, proj, normalMatrix);

  device.queue.writeBuffer(triTransformBuf, 0, triTransformData);
  device.queue.writeBuffer(sphTransformBuf, 0, sphTransformData);
  device.queue.writeBuffer(triMaterialBuf,  0, triMaterialData);
  device.queue.writeBuffer(sphMaterialBuf,  0, sphMaterialData);

  const cmd  = device.createCommandEncoder();
  const pass = cmd.beginRenderPass(makeRenderPassDescriptor(
    context.getCurrentTexture().createView(),
    depthTexture.createView(),
  ));

  const pipeline = pipelines[params.shading];
  const topology = params.wireframe ? "line-strip" : undefined;
  void topology; // wireframe not supported in same pipeline; would need separate pipeline

  pass.setPipeline(pipeline);

  // Links: Dreieck
  pass.setViewport(0, 0, halfWidth, canvas.height, 0, 1);
  pass.setBindGroup(0, triBindGroup);
  pass.setVertexBuffer(0, triVB);
  pass.setIndexBuffer(triIB, "uint32");
  pass.drawIndexed(triGeo.indexCount);

  // Rechts: Kugel
  pass.setViewport(halfWidth, 0, canvas.width - halfWidth, canvas.height, 0, 1);
  pass.setBindGroup(0, sphBindGroup);
  pass.setVertexBuffer(0, sphereVB2);
  pass.setIndexBuffer(sphereIB2, "uint32");
  pass.drawIndexed(sphereIndexCount);

  pass.end();
  device.queue.submit([cmd.finish()]);

  if (pendingCapture) { pendingCapture = false; captureWebp(); }

  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

updateProjection(0.5); // initial (aspect=0.5 because split viewport)
requestAnimationFrame(render);
