import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import { getWebGPU, resizeWebGPUCanvas, createDepthTexture, createGPUVertexBuffer, createGPUIndexBuffer, mat3ToMat4Array, VERTEX_BUFFER_LAYOUT, makeRenderPassDescriptor } from "../../../src/shared/webgpu";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult } from "../../../src/shared/benchmark";
import ML_WGSL from "../shaders/gpu/multi-light.wgsl?raw";

const MAX_LIGHTS = 256;

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const { device, context, format } = await getWebGPU(canvas);

const geo = createUvSphere(1, 200, 100);
const vb  = createGPUVertexBuffer(device, geo.vertices);
const ib  = createGPUIndexBuffer(device, geo.indices);

// Scene Uniform Buffer: view, proj, model, normalMat, viewPos, ambient, shininess, numLights
// 4×mat4(256) + 4×vec4(64) = 320 → 512 alloc
const SCENE_SIZE = 512;
const sceneUB   = device.createBuffer({ size: SCENE_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const sceneData = new Float32Array(SCENE_SIZE / 4);

// Light Storage Buffer: MAX_LIGHTS × Light struct (32 bytes each)
const LIGHT_STRIDE = 8; // 2×vec4 = 8 floats = 32 bytes
const lightData = new Float32Array(MAX_LIGHTS * LIGHT_STRIDE);
const lightBuf  = device.createBuffer({
  size: MAX_LIGHTS * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const bgl = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
  { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
]});
const shader   = device.createShaderModule({ code: ML_WGSL });
const pipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
  vertex: { module: shader, entryPoint: "vs", buffers: [VERTEX_BUFFER_LAYOUT] },
  fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
  primitive: { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});
const bg = device.createBindGroup({ layout: bgl, entries: [
  { binding: 0, resource: { buffer: sceneUB } },
  { binding: 1, resource: { buffer: lightBuf } },
]});

const proj = mat4.create(), view = mat4.create(), model = mat4.create(), nm3 = mat3.create(), nm4 = new Float32Array(16);
const cameraPos = vec3.fromValues(0, 0, 2.5);
mat4.lookAt(view, cameraPos, [0,0,0], [0,1,0]);

function hsl(h: number, s: number, l: number): [number,number,number] {
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return [r+m,g+m,b+m];
}

const lightColors = Array.from({ length: MAX_LIGHTS }, (_, i) => hsl((i/MAX_LIGHTS)*360, 1, 0.6));

const params = { numLights: 16, autoRotate: true };
const stats = createStatsPanel(document.getElementById("app")!); stats.showPanel(1);
const benchmark = new BenchmarkRun(30, 200);
let depth = createDepthTexture(device, 1, 1);

const gui = new GUI({ title: "Multi-Light (WebGPU)" });
gui.add(params, "numLights", 1, MAX_LIGHTS, 1).name("Lichtquellen");
gui.add(params, "autoRotate").name("Rotation");
gui.add({ run: async () => {
  resultsEl.style.display = "block"; resultsEl.textContent = `Messe ${params.numLights} Lichter ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGPU] ${params.numLights} Lichter\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");

let angle = 0, lastT = performance.now();
function render(now: number): void {
  const dt = (now - lastT) / 1000; lastT = now;
  if (resizeWebGPUCanvas(canvas)) {
    depth.destroy(); depth = createDepthTexture(device, canvas.width, canvas.height);
    mat4.perspective(proj, Math.PI/3.6, canvas.width/Math.max(1,canvas.height), 0.1, 50);
  }
  if (params.autoRotate) angle += dt * 0.4;
  mat4.identity(model); mat4.rotateY(model, model, angle); mat3.normalFromMat4(nm3, model); mat3ToMat4Array(nm3, nm4, 0);
  const n = Math.round(params.numLights);

  // Light data
  for (let i = 0; i < n; i++) {
    const a = (i/n)*Math.PI*2 + angle*0.5, r = 1.5 + 0.5*Math.sin(i*2.3);
    lightData[i*LIGHT_STRIDE]   = Math.cos(a)*r;
    lightData[i*LIGHT_STRIDE+1] = Math.sin(a*0.7)*1.2;
    lightData[i*LIGHT_STRIDE+2] = Math.sin(a)*r;
    lightData[i*LIGHT_STRIDE+4] = lightColors[i][0];
    lightData[i*LIGHT_STRIDE+5] = lightColors[i][1];
    lightData[i*LIGHT_STRIDE+6] = lightColors[i][2];
  }
  device.queue.writeBuffer(lightBuf, 0, lightData.subarray(0, n * LIGHT_STRIDE));

  sceneData.set(view,0); sceneData.set(proj,16); sceneData.set(model,32); sceneData.set(nm4,48);
  sceneData[64]=cameraPos[0]; sceneData[65]=cameraPos[1]; sceneData[66]=cameraPos[2];
  const u = new Uint32Array(sceneData.buffer);
  sceneData[68]=0.05; sceneData[69]=64;
  u[70] = n;
  device.queue.writeBuffer(sceneUB, 0, sceneData);

  const cmd = device.createCommandEncoder();
  const pass = cmd.beginRenderPass(makeRenderPassDescriptor(context.getCurrentTexture().createView(), depth.createView(), {r:.02,g:.02,b:.04,a:1}));
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg);
  pass.setVertexBuffer(0, vb); pass.setIndexBuffer(ib, "uint32");
  pass.drawIndexed(geo.indexCount); pass.end();
  device.queue.submit([cmd.finish()]);
  stats.update(); benchmark.sample(now);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
