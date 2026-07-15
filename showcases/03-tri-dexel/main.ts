import { GUI } from "lil-gui";
import { mat4 } from "gl-matrix";

import { MESH_SHADER, POINT_SHADER } from "./shaders";
import { extractDualContour, type Mesh } from "./dualcontour";
import { SCENES, sceneById, type SceneId } from "./field";

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const infoEl = document.getElementById("info") as HTMLDivElement;

  if (!navigator.gpu) {
    document.body.innerHTML = `
      <p style="color:#f87;padding:2rem;font-family:sans-serif;font-size:1rem;">
        WebGPU wird von diesem Browser nicht unterstützt.<br>
        Bitte Chrome/Edge 113+ oder Firefox Nightly verwenden.
      </p>`;
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Kein WebGPU-Adapter gefunden.");
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const SAMPLE_COUNT = 4;

  // Gemeinsamer Kamera-Uniform (80 Byte).
  const cameraBuffer = device.createBuffer({
    label: "camera", size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const camBGL = device.createBindGroupLayout({
    label: "cam-bgl",
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: 80 } }],
  });
  const camBindGroup = device.createBindGroup({
    label: "cam-bg", layout: camBGL,
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });

  const depthStencil: GPUDepthStencilState = {
    format: "depth24plus", depthWriteEnabled: true, depthCompare: "less",
  };

  const meshModule = device.createShaderModule({ label: "mesh", code: MESH_SHADER });
  const pointModule = device.createShaderModule({ label: "point", code: POINT_SHADER });

  const meshPipeline = device.createRenderPipeline({
    label: "mesh",
    layout: device.createPipelineLayout({ bindGroupLayouts: [camBGL] }),
    vertex: {
      module: meshModule, entryPoint: "vs_main",
      buffers: [{
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
        ],
      }],
    },
    fragment: { module: meshModule, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil,
    multisample: { count: SAMPLE_COUNT },
  });

  const pointPipeline = device.createRenderPipeline({
    label: "point",
    layout: device.createPipelineLayout({ bindGroupLayouts: [camBGL] }),
    vertex: {
      module: pointModule, entryPoint: "vs_main",
      buffers: [{
        arrayStride: 16,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
      }],
    },
    fragment: { module: pointModule, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "point-list" },
    depthStencil,
    multisample: { count: SAMPLE_COUNT },
  });

  // ----- Mesh-Puffer (bei Bedarf neu aufgebaut) -----
  let meshVBuf: GPUBuffer | null = null;
  let meshIBuf: GPUBuffer | null = null;
  let pointBuf: GPUBuffer | null = null;
  let indexCount = 0;
  let pointCount = 0;

  function uploadMesh(mesh: Mesh): void {
    meshVBuf?.destroy();
    meshIBuf?.destroy();
    pointBuf?.destroy();

    meshVBuf = device.createBuffer({
      label: "mesh-verts", size: Math.max(4, mesh.vertices.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    if (mesh.vertices.byteLength > 0) device.queue.writeBuffer(meshVBuf, 0, mesh.vertices.buffer as ArrayBuffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);

    meshIBuf = device.createBuffer({
      label: "mesh-indices", size: Math.max(4, mesh.indices.byteLength),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    if (mesh.indices.byteLength > 0) device.queue.writeBuffer(meshIBuf, 0, mesh.indices.buffer as ArrayBuffer, mesh.indices.byteOffset, mesh.indices.byteLength);
    indexCount = mesh.indexCount;

    pointBuf = device.createBuffer({
      label: "points", size: Math.max(16, mesh.points.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    if (mesh.points.byteLength > 0) device.queue.writeBuffer(pointBuf, 0, mesh.points.buffer as ArrayBuffer, mesh.points.byteOffset, mesh.points.byteLength);
    pointCount = mesh.pointCount;
  }

  function rebuild(): void {
    const scene = sceneById(params.scene as SceneId);
    const t0 = performance.now();
    const mesh = extractDualContour(scene, params.resolution);
    const dt = performance.now() - t0;
    uploadMesh(mesh);
    infoEl.textContent =
      `${scene.label}\n`
      + `Gitter: ${params.resolution}³   Dreiecke: ${mesh.triangleCount.toLocaleString("de-DE")}\n`
      + `Tri-Dexel-Punkte: ${mesh.pointCount.toLocaleString("de-DE")}   Extraktion: ${dt.toFixed(1)} ms`;
  }

  // ----- Render-Targets: MSAA + Tiefe -----
  let depthTexture: GPUTexture | null = null;
  let msaaTexture: GPUTexture | null = null;
  function getTargets(): { depth: GPUTexture; color: GPUTexture } {
    const w = canvas.width, h = canvas.height;
    if (!depthTexture || depthTexture.width !== w || depthTexture.height !== h) {
      depthTexture?.destroy();
      msaaTexture?.destroy();
      depthTexture = device.createTexture({
        size: [w, h], format: "depth24plus", sampleCount: SAMPLE_COUNT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      msaaTexture = device.createTexture({
        size: [w, h], format, sampleCount: SAMPLE_COUNT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return { depth: depthTexture, color: msaaTexture! };
  }

  const ro = new ResizeObserver(() => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  });
  ro.observe(canvas);

  // ----- Orbit-Kamera -----
  const cam = { azimuth: -0.6, elevation: 0.5, radius: 3.6 };
  let dragging = false;
  let lastMouse = { x: 0, y: 0 };
  canvas.addEventListener("mousedown", (e) => { dragging = true; lastMouse = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    cam.azimuth += (e.clientX - lastMouse.x) * 0.006;
    cam.elevation = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, cam.elevation - (e.clientY - lastMouse.y) * 0.006));
    lastMouse = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("mouseup", () => { dragging = false; });
  canvas.addEventListener("mouseleave", () => { dragging = false; });
  canvas.addEventListener("wheel", (e) => {
    cam.radius = Math.max(1.6, Math.min(9.0, cam.radius * (1 + e.deltaY * 0.001)));
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault(); dragging = true;
    lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!dragging || e.touches.length !== 1) return;
    cam.azimuth += (e.touches[0].clientX - lastMouse.x) * 0.006;
    cam.elevation = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, cam.elevation - (e.touches[0].clientY - lastMouse.y) * 0.006));
    lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });
  canvas.addEventListener("touchend", () => { dragging = false; });

  // ----- GUI -----
  const params = {
    scene: SCENES[0].id as string,
    resolution: 64,
    showMesh: true,
    showPoints: false,
    autoRotate: true,
  };
  const gui = new GUI({ title: "Tri-Dexel + Dual Contouring" });
  const sceneOptions: Record<string, string> = {};
  SCENES.forEach((s) => { sceneOptions[s.label] = s.id; });
  gui.add(params, "scene", sceneOptions).name("Szene").onChange(() => rebuild());
  gui.add(params, "resolution", [24, 32, 48, 64, 96, 128]).name("Gitterauflösung").onChange(() => rebuild());
  gui.add(params, "showMesh").name("Netz zeigen");
  gui.add(params, "showPoints").name("Tri-Dexel-Punkte");
  gui.add(params, "autoRotate").name("Auto-Rotation");

  rebuild();

  // ----- Kamera-Update -----
  function updateCamera(): void {
    const { azimuth, elevation, radius } = cam;
    const ex = radius * Math.cos(elevation) * Math.sin(azimuth);
    const ey = radius * Math.sin(elevation);
    const ez = radius * Math.cos(elevation) * Math.cos(azimuth);
    const view = mat4.create();
    mat4.lookAt(view, [ex, ey, ez], [0, 0.05, 0], [0, 1, 0]);
    const proj = mat4.create();
    mat4.perspective(proj, Math.PI / 4, canvas.width / (canvas.height || 1), 0.1, 20.0);
    const vp = mat4.create();
    mat4.multiply(vp, proj, view);
    const data = new Float32Array(20);
    data.set(vp as Float32Array, 0);
    data[16] = ex; data[17] = ey; data[18] = ez;
    device.queue.writeBuffer(cameraBuffer, 0, data);
  }

  function scheduleNextFrame(): void {
    if (document.hidden) { setTimeout(frame, 16); } else { requestAnimationFrame(frame); }
  }

  function frame(): void {
    if (params.autoRotate && !dragging) cam.azimuth += 0.004;
    updateCamera();

    const encoder = device.createCommandEncoder();
    const targets = getTargets();
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targets.color.createView(),
        resolveTarget: context.getCurrentTexture().createView(),
        clearValue: [0.05, 0.06, 0.09, 1.0],
        loadOp: "clear", storeOp: "store",
      }],
      depthStencilAttachment: {
        view: targets.depth.createView(),
        depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store",
      },
    });

    if (params.showMesh && meshVBuf && meshIBuf && indexCount > 0) {
      rpass.setPipeline(meshPipeline);
      rpass.setBindGroup(0, camBindGroup);
      rpass.setVertexBuffer(0, meshVBuf);
      rpass.setIndexBuffer(meshIBuf, "uint32");
      rpass.drawIndexed(indexCount);
    }
    if (params.showPoints && pointBuf && pointCount > 0) {
      rpass.setPipeline(pointPipeline);
      rpass.setBindGroup(0, camBindGroup);
      rpass.setVertexBuffer(0, pointBuf);
      rpass.draw(pointCount);
    }
    rpass.end();

    device.queue.submit([encoder.finish()]);
    scheduleNextFrame();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestAnimationFrame(frame);
  });
  scheduleNextFrame();
}

main().catch(console.error);
