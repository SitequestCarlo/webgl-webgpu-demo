import { GUI } from "lil-gui";
import '/src/shared/showcase.css';
import { vec3, mat4, mat3 } from "gl-matrix";
import { getWebGPU, resizeWebGPUCanvas, createGPUVertexBuffer, createGPUIndexBuffer, VERTEX_BUFFER_LAYOUT } from "../../../src/shared/webgpu";
import { createUvSphere } from "../../../src/shared/geometry";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import COMPUTE_SRC from "../shaders/gpu/compute.wgsl?raw";
import BLIT_SRC from "../shaders/gpu/blit.wgsl?raw";

// Both vertex and fragment entry points live in the same WGSL file.
const BLIT_VS = BLIT_SRC;
const BLIT_FS = BLIT_SRC;

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

// ---------------------------------------------------------------------------
// Rasterisierungs-Pipeline (Blinn-Phong, zum Vergleich)
// ---------------------------------------------------------------------------

const RAST_WGSL = /* wgsl */`
struct Uniforms {
  model:     mat4x4<f32>,
  view:      mat4x4<f32>,
  proj:      mat4x4<f32>,
  normalMat: mat4x4<f32>,
  camPos:    vec4<f32>,
  color:     vec4<f32>,    // w = isFloor (1.0 = Schachbrett)
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) wp: vec3<f32>,
  @location(1) n:  vec3<f32>,
}

@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
  let world = u.model * vec4<f32>(pos, 1.0);
  var o: VsOut;
  o.clip = u.proj * u.view * world;
  o.wp   = world.xyz;
  o.n    = (u.normalMat * vec4<f32>(norm, 0.0)).xyz;
  return o;
}

fn checkerboard(p: vec3<f32>) -> vec3<f32> {
  let cb = ((i32(floor(p.x)) ^ i32(floor(p.z))) & 1) == 0;
  return select(vec3<f32>(0.3), vec3<f32>(0.9), cb);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  var N = normalize(in.n);
  let L = normalize(vec3<f32>(2.0, 3.5, 2.0) - in.wp);
  let V = normalize(u.camPos.xyz - in.wp);
  let H = normalize(L + V);
  if (dot(N, V) < 0.0) { N = -N; }
  let diff = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, H), 0.0), 64.0);
  var base = u.color.xyz;
  if (u.color.w > 0.5) { base = checkerboard(in.wp); }   // Schachbrett für Boden
  var col = 0.08 * base + diff * base + spec * vec3<f32>(1.0);
  col = col / (col + vec3<f32>(1.0));
  col = pow(col, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(col, 1.0);
}`;

const rastBGL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { type: "uniform", minBindingSize: 288 } },
]});
const rastModule   = device.createShaderModule({ code: RAST_WGSL });
const rastPipeline = device.createRenderPipeline({
  layout:   device.createPipelineLayout({ bindGroupLayouts: [rastBGL] }),
  vertex:   { module: rastModule, entryPoint: "vs", buffers: [VERTEX_BUFFER_LAYOUT] },
  fragment: { module: rastModule, entryPoint: "fs", targets: [{ format }] },
  primitive:    { topology: "triangle-list", cullMode: "none" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

const RAST_UB_SIZE = 320;  // 4×mat4 (256) + 2×vec4 (32) = 288, auf 320 aufgerundet

// Kugel-Geometrie für Rasterisierung
const sphereGeo = createUvSphere(0.5, 32, 16);
const sphVB = createGPUVertexBuffer(device, sphereGeo.vertices);
const sphIB = createGPUIndexBuffer(device, sphereGeo.indices);

// Boden-Quad (y = -1)
const FLOOR_VERTS = new Float32Array([
  -40,-1,-40, 0,1,0,   40,-1,-40, 0,1,0,   40,-1, 40, 0,1,0,
  -40,-1,-40, 0,1,0,   40,-1, 40, 0,1,0,  -40,-1, 40, 0,1,0,
]);
const floorVB = createGPUVertexBuffer(device, FLOOR_VERTS);

const SCENE_OBJECTS = [
  { pos: [-1.1, -0.5, -0.5] as [number,number,number], color: [0.9, 0.9, 0.85, 0] as [number,number,number,number] },
  { pos: [ 0.0, -0.5,  0.0] as [number,number,number], color: [0.7, 0.85, 1.0, 0] as [number,number,number,number] },
  { pos: [ 1.1, -0.5, -0.5] as [number,number,number], color: [0.85, 0.2, 0.15, 0] as [number,number,number,number] },
];

// Separate Uniform-Buffer + Bind-Groups pro Objekt (3 Kugeln + 1 Boden).
// WICHTIG: writeBuffer auf denselben Buffer vor demselben Render-Pass betrifft
// alle Draw-Calls gleich (letzter Wert gewinnt). Separate Buffer lösen das.
const RAST_DRAW_COUNT = SCENE_OBJECTS.length + 1;  // 3 Kugeln + 1 Boden
const rastDrawUBs = Array.from({ length: RAST_DRAW_COUNT }, () =>
  device.createBuffer({ size: RAST_UB_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
);
const rastDrawBGs = rastDrawUBs.map(buf =>
  device.createBindGroup({ layout: rastBGL, entries: [{ binding: 0, resource: { buffer: buf } }] }),
);

let rastDepthTex: GPUTexture | null = null;
function getRastDepth(w: number, h: number): GPUTexture {
  if (!rastDepthTex || rastDepthTex.width !== w || rastDepthTex.height !== h) {
    rastDepthTex?.destroy();
    rastDepthTex = device.createTexture({ size: [w, h], format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }
  return rastDepthTex;
}

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
      a.download = `raytracer-webgpu.png`;
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
  resultsEl.textContent = `[WebGPU] Compute Raytracer\nAkkum-Frames: ${frameIndex}\n${formatResult(result)}`;
}

const gui = new GUI({ title: "Raytracer (WebGPU)" });
const params = { raytracing: true };
gui.add(params, "raytracing").name("Raytracing An/Aus").onChange(() => resetAccum());
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");
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
  const cam = buildCameraVectors();
  const cmd = device.createCommandEncoder();

  if (params.raytracing) {
    // ---- Raytracing-Modus: Compute + Blit --------------------------------
    const pdata = new Float32Array(PARAMS_SIZE / 4);
    const udata = new Uint32Array(pdata.buffer);
    udata[0] = W; udata[1] = H; udata[2] = frameIndex;
    pdata[4] = cam.pos[0]; pdata[5] = cam.pos[1]; pdata[6] = cam.pos[2]; pdata[7] = 0;
    pdata[8] = cam.forward[0]; pdata[9]  = cam.forward[1]; pdata[10] = cam.forward[2]; pdata[11] = 0;
    pdata[12] = cam.right[0];  pdata[13] = cam.right[1];  pdata[14] = cam.right[2];  pdata[15] = 0;
    pdata[16] = cam.up[0];     pdata[17] = cam.up[1];     pdata[18] = cam.up[2];     pdata[19] = 0;
    device.queue.writeBuffer(paramsBuf, 0, pdata);

    const bdata = new Uint32Array(4);
    bdata[0] = W; bdata[1] = H;
    device.queue.writeBuffer(blitParamsBuf, 0, bdata);

    if (needsClear) { needsClear = false; cmd.clearBuffer(accumBuf); }

    // Compute-Pass
    const cp = cmd.beginComputePass();
    cp.setPipeline(computePipeline);
    cp.setBindGroup(0, computeBindGroup!);
    cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    cp.end();

    // Blit-Pass
    const rp = cmd.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    rp.setPipeline(blitPipeline);
    rp.setBindGroup(0, blitBindGroup!);
    rp.draw(3);
    rp.end();
    frameIndex++;

  } else {
    // ---- Rasterisierungs-Modus: Blinn-Phong, Schachbrett, keine Schatten --
    const view = mat4.lookAt(mat4.create(), cam.pos, TARGET, [0, 1, 0]);
    const proj = mat4.perspective(mat4.create(), Math.PI / 3.5, W / H, 0.1, 100);
    const depth = getRastDepth(W, H);

    // Hilfsfunktion: füllt einen Uniform-Buffer für ein Objekt
    const fillUB = (ubIdx: number, model: Float32Array, color: [number,number,number,number]) => {
      const data = new Float32Array(RAST_UB_SIZE / 4);
      const nm   = mat3.normalFromMat4(mat3.create(), model)!;
      const nm4  = new Float32Array(16);
      nm4[0]=nm[0]; nm4[1]=nm[1]; nm4[2]=nm[2];
      nm4[4]=nm[3]; nm4[5]=nm[4]; nm4[6]=nm[5];
      nm4[8]=nm[6]; nm4[9]=nm[7]; nm4[10]=nm[8];
      data.set(model as Float32Array, 0);
      data.set(view  as Float32Array, 16);
      data.set(proj  as Float32Array, 32);
      data.set(nm4,                   48);
      data[64] = cam.pos[0]; data[65] = cam.pos[1]; data[66] = cam.pos[2]; data[67] = 0;
      data[68] = color[0];   data[69] = color[1];   data[70] = color[2];   data[71] = color[3];
      // writeBuffer VOR dem Render-Pass, damit jedes Objekt seine eigenen Daten hat
      device.queue.writeBuffer(rastDrawUBs[ubIdx], 0, data);
    };

    // Alle Uniform-Buffer vor dem Render-Pass befüllen
    SCENE_OBJECTS.forEach((obj, i) => {
      fillUB(i, mat4.fromTranslation(mat4.create(), obj.pos) as Float32Array, obj.color);
    });
    fillUB(SCENE_OBJECTS.length, mat4.create() as Float32Array, [0, 0, 0, 1]);  // Boden

    const rp = cmd.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.08, g: 0.09, b: 0.11, a: 1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depth.createView(),
        depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    rp.setPipeline(rastPipeline);

    // Kugeln: jede mit ihrem eigenen Bind-Group
    rp.setVertexBuffer(0, sphVB);
    rp.setIndexBuffer(sphIB, "uint32");
    SCENE_OBJECTS.forEach((_, i) => {
      rp.setBindGroup(0, rastDrawBGs[i]);
      rp.drawIndexed(sphereGeo.indexCount);
    });

    // Boden
    rp.setVertexBuffer(0, floorVB);
    rp.setBindGroup(0, rastDrawBGs[SCENE_OBJECTS.length]);
    rp.draw(6);

    rp.end();
  }

  device.queue.submit([cmd.finish()]);

  if (pendingCapture) { pendingCapture = false; captureWebp(); }
  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
