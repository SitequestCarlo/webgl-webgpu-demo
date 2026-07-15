// Minimale WebGPU-Helfer: Adapter, Device, Swap-Chain, Buffer, Resize.
// Bewusst schlank, damit der API-Overhead im Vergleich zu WebGL sichtbar bleibt.

export interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function getWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU wird von diesem Browser nicht unterstützt.");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("Kein WebGPU-Adapter gefunden.");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  return { device, context, format };
}

// Passt Canvas-Größe an Device-Pixel-Ratio an. Gibt true zurück wenn sich die Größe geändert hat.
export function resizeWebGPUCanvas(canvas: HTMLCanvasElement, maxDpr = 2): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

export function createDepthTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  return device.createTexture({
    size: [Math.max(1, width), Math.max(1, height)],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

export function createUniformBuffer(device: GPUDevice, sizeBytes: number): GPUBuffer {
  return device.createBuffer({
    size: Math.ceil(sizeBytes / 256) * 256, // 256-byte alignment
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function createGPUVertexBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
  const buf = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(buf.getMappedRange()).set(data);
  buf.unmap();
  return buf;
}

export function createGPUIndexBuffer(device: GPUDevice, data: Uint32Array): GPUBuffer {
  const buf = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(buf.getMappedRange()).set(data);
  buf.unmap();
  return buf;
}

export function createStorageBuffer(device: GPUDevice, sizeBytes: number): GPUBuffer {
  return device.createBuffer({
    size: sizeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

// Standard-Vertex-Buffer-Layout: interleaved Position (loc 0) + Normale (loc 1), stride 24.
export const VERTEX_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 24,
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x3" },
    { shaderLocation: 1, offset: 12, format: "float32x3" },
  ],
};

// Erweitert eine mat3 (9 Floats, column-major) auf eine mat4 (16 Floats) für WGSL-Uniform-Buffer.
// WGSL mat3x3<f32> in uniform buffers hat Padding (3×vec4), daher mat4x4 verwenden.
export function mat3ToMat4Array(m3: ArrayLike<number>, out: Float32Array, offset: number): void {
  out[offset + 0]  = m3[0]; out[offset + 1]  = m3[1]; out[offset + 2]  = m3[2]; out[offset + 3]  = 0;
  out[offset + 4]  = m3[3]; out[offset + 5]  = m3[4]; out[offset + 6]  = m3[5]; out[offset + 7]  = 0;
  out[offset + 8]  = m3[6]; out[offset + 9]  = m3[7]; out[offset + 10] = m3[8]; out[offset + 11] = 0;
  out[offset + 12] = 0;     out[offset + 13] = 0;     out[offset + 14] = 0;     out[offset + 15] = 1;
}

// Render-Pass-Descriptor-Vorlage (weiß cleared, mit Depth).
export function makeRenderPassDescriptor(
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  clearColor: GPUColorDict = { r: 1, g: 1, b: 1, a: 1 },
): GPURenderPassDescriptor {
  return {
    colorAttachments: [{
      view: colorView,
      clearValue: clearColor,
      loadOp: "clear",
      storeOp: "store",
    }],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  };
}
