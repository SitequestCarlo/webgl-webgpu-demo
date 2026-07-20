// Instanced Rendering Showcase – WebGPU
// N Instanzen in einem einzigen Draw-Call (drawIndexed).
//
// WebGPU-Ansatz: Per-Instanz-Daten in einem Storage Buffer.
// Der Vertex-Shader liest über @builtin(instance_index) direkt auf seine Instanzdaten.
// Vorteil: Storage Buffer kann von Compute-Shadern geschrieben werden —
// ermöglicht GPU-seitige Partikel-Simulation ohne CPU-Roundtrip.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat4, vec3 } from "gl-matrix";
import { getWebGPU, resizeWebGPUCanvas, createDepthTexture, createGPUVertexBuffer, createGPUIndexBuffer, VERTEX_BUFFER_LAYOUT, makeRenderPassDescriptor, GpuTimer } from "../../../src/shared/webgpu";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult, CpuTimer, readBenchmarkValue } from "../../../src/shared/benchmark";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const { device, context, format } = await getWebGPU(canvas);

// Instancing-Shader: per-Instanz-Daten aus Storage Buffer via instance_index
const WGSL = /* wgsl */`
struct InstanceData { pos: vec4<f32>, color: vec4<f32> }
struct Uniforms { view: mat4x4<f32>, proj: mat4x4<f32>, lightPos: vec4<f32>, viewPos: vec4<f32> }

@group(0) @binding(0) var<uniform>       u:         Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<InstanceData>;

struct VsOut { @builtin(position) clip: vec4<f32>, @location(0) wp: vec3<f32>, @location(1) n: vec3<f32>, @location(2) col: vec3<f32> }

@vertex fn vs(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>, @builtin(instance_index) inst: u32) -> VsOut {
  let d = instances[inst];
  let wp = pos * 0.4 + d.pos.xyz;
  var o: VsOut;
  o.clip = u.proj * u.view * vec4<f32>(wp, 1.0);
  o.wp = wp; o.n = norm; o.col = d.color.xyz;
  return o;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let N=normalize(in.n); let L=normalize(u.lightPos.xyz-in.wp); let V=normalize(u.viewPos.xyz-in.wp); let H=normalize(L+V);
  let diff=max(dot(N,L),0.0); let spec=pow(max(dot(N,H),0.0),32.0);
  return vec4<f32>(0.1*in.col + diff*in.col + spec, 1.0);
}`;

const bgl = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
  { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
]});
const shaderMod = device.createShaderModule({ code: WGSL });
const pipeline  = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
  vertex:   { module: shaderMod, entryPoint: "vs", buffers: [VERTEX_BUFFER_LAYOUT] },
  fragment: { module: shaderMod, entryPoint: "fs", targets: [{ format }] },
  primitive: { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

const geo = createUvSphere(0.5, 12, 6);
const vb  = createGPUVertexBuffer(device, geo.vertices);
const ib  = createGPUIndexBuffer(device, geo.indices);

const uniformBuf = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const uniformData = new Float32Array(48);

const MAX_N = 500000;
const INST_STRIDE = 8; // 2 × vec4<f32>
let instBuf: GPUBuffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE });
let bg: GPUBindGroup;

function hsl(h: number, s: number, l: number): [number,number,number] {
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return [r+m,g+m,b+m];
}

function buildInstances(n: number): void {
  // Instanz-Buffer bei N-Änderung neu allozieren (gewünschte Größe).
  // Destroy old + create new ist bei WebGPU die Standard-Methode für Resize.
  instBuf?.destroy();
  const data = new Float32Array(n * INST_STRIDE);
  const side = Math.ceil(Math.cbrt(n)), half=(side-1)/2, sp=1.2;
  for (let i = 0; i < n; i++) {
    const ix=i%side, iy=Math.floor(i/side)%side, iz=Math.floor(i/side/side);
    data[i*8]=(ix-half)*sp; data[i*8+1]=(iy-half)*sp; data[i*8+2]=(iz-half)*sp; data[i*8+3]=1;
    const [r,g,b]=hsl((i/n)*360,0.7,0.5);
    data[i*8+4]=r; data[i*8+5]=g; data[i*8+6]=b; data[i*8+7]=1;
  }
  instBuf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(instBuf, 0, data);
  bg = device.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: { buffer: uniformBuf } },
    { binding: 1, resource: { buffer: instBuf } },
  ]});
}

const proj = mat4.create(), view = mat4.create();
const cameraPos = vec3.fromValues(0, 15, 35), lightPos = vec3.fromValues(10, 20, 20);
mat4.lookAt(view, cameraPos, [0,0,0], [0,1,0]);

const params = { n: readBenchmarkValue() ?? 10000 };
buildInstances(params.n);

const stats = createStatsPanel(document.getElementById("app")!); stats.showPanel(1);
const benchmark = new BenchmarkRun({ warmupMs: 1500, measureMs: 1, minFrames: 500 });
const gpuTimer = new GpuTimer(device);
const cpuTimer = new CpuTimer();
let depth = createDepthTexture(device, 1, 1);

const gui = new GUI({ title: "Instancing (WebGPU)" });
let pendingCapture = false;
gui.add(params, "n", 1000, MAX_N, 1000).name("N Instanzen").onFinishChange((v: number) => buildInstances(Math.round(v)));
gui.add({ run: async () => {
  resultsEl.style.display = "block"; resultsEl.textContent = `Messe N=${params.n} ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGPU] ${params.n} Instanzen\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

async function render(now: number): Promise<void> {
  if (resizeWebGPUCanvas(canvas)) {
    depth.destroy(); depth = createDepthTexture(device, canvas.width, canvas.height);
    mat4.perspective(proj, Math.PI/3.6, canvas.width/Math.max(1,canvas.height), 0.1, 300);
  }
  uniformData.set(view,0); uniformData.set(proj,16);
  uniformData[32]=lightPos[0]; uniformData[33]=lightPos[1]; uniformData[34]=lightPos[2]; uniformData[35]=0;
  uniformData[36]=cameraPos[0]; uniformData[37]=cameraPos[1]; uniformData[38]=cameraPos[2]; uniformData[39]=0;

  // Swapchain-Textur vor der CPU-Messung holen (Present-Stall zählt nicht als API-Overhead).
  const colorView = context.getCurrentTexture().createView();
  cpuTimer.begin();
  device.queue.writeBuffer(uniformBuf, 0, uniformData);

  const cmd  = device.createCommandEncoder();
  const pass = cmd.beginRenderPass({
    ...makeRenderPassDescriptor(colorView, depth.createView(), {r:.06,g:.07,b:.09,a:1}),
    timestampWrites: gpuTimer.writesBoth,
  });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg);
  pass.setVertexBuffer(0, vb); pass.setIndexBuffer(ib, "uint32");
  // Ein einziger Draw-Call: N Instanzen — @builtin(instance_index) gibt den Index.
  pass.drawIndexed(geo.indexCount, Math.round(params.n));
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
      a.href = URL.createObjectURL(b); a.download = 'instancing-webgpu.png'; a.click();
    }, 'image/png');
  }
  if (benchmark.isRunning) await device.queue.onSubmittedWorkDone(); // Drain (yield) → Timestamp-Readback fertig
  const gpuMs = gpuTimer.takeSample() ?? undefined;
  stats.update(); benchmark.sample(now, gpuMs, cpuTimer.lastMs);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
