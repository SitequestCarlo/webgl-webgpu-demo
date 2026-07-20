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
  // timestamp-query anfordern, falls der Adapter es unterstützt → echte GPU-Zeit-Messung.
  const requiredFeatures: GPUFeatureName[] = adapter.features.has("timestamp-query")
    ? ["timestamp-query"]
    : [];
  const device = await adapter.requestDevice({ requiredFeatures });
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

// ---------------------------------------------------------------------------
// GPU-Timing via timestamp-query
// ---------------------------------------------------------------------------

// Misst die ECHTE GPU-Ausführungszeit eines (oder mehrerer) Passes über
// GPUQuerySet-Zeitstempel — unabhängig von VSync, Compositor und Swapchain-
// Back-Pressure. Ein Pool mappbarer Staging-Buffer erlaubt mehrere gleichzeitig
// laufende Readbacks, sodass pro Frame ein eigenständiger Messwert entsteht
// (statt denselben Wert mehrfach zu zählen).
//
// Verwendung (Single-Pass):
//   const timer = new GpuTimer(device);
//   const pass = cmd.beginRenderPass({ ...desc, timestampWrites: timer.writesBoth });
//   ... pass.end();
//   timer.resolve(cmd);
//   device.queue.submit([cmd.finish()]);
//   timer.afterSubmit();
//   benchmark.sample(now, timer.takeSample() ?? undefined);
//
// Verwendung (Compute + Render als ein Frame):
//   compute-Pass: timestampWrites: timer.writesBegin
//   render-Pass:  timestampWrites: timer.writesEnd
export class GpuTimer {
  readonly enabled: boolean;
  private querySet?: GPUQuerySet;
  private resolveBuf?: GPUBuffer;
  private freeBufs: GPUBuffer[] = [];
  private pending?: GPUBuffer;
  private results: number[] = [];
  private lastMsValue = 0;

  constructor(device: GPUDevice, poolSize = 4) {
    this.enabled = device.features.has("timestamp-query");
    if (!this.enabled) return;
    this.querySet = device.createQuerySet({ type: "timestamp", count: 2 });
    this.resolveBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    for (let i = 0; i < poolSize; i++) {
      this.freeBufs.push(device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }));
    }
  }

  /** Für Single-Pass: schreibt Anfangs- und End-Zeitstempel im selben Pass. */
  get writesBoth(): GPURenderPassTimestampWrites | undefined {
    return this.enabled
      ? { querySet: this.querySet!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
      : undefined;
  }

  /** Für Multi-Pass: Anfangs-Zeitstempel im ERSTEN Pass. */
  get writesBegin(): GPURenderPassTimestampWrites | undefined {
    return this.enabled
      ? { querySet: this.querySet!, beginningOfPassWriteIndex: 0 }
      : undefined;
  }

  /** Für Multi-Pass: End-Zeitstempel im LETZTEN Pass. */
  get writesEnd(): GPURenderPassTimestampWrites | undefined {
    return this.enabled
      ? { querySet: this.querySet!, endOfPassWriteIndex: 1 }
      : undefined;
  }

  /** Nach dem Aufzeichnen aller Passes, VOR encoder.finish(): Query auflösen. */
  resolve(encoder: GPUCommandEncoder): void {
    this.pending = undefined;
    if (!this.enabled || this.freeBufs.length === 0) return;
    const buf = this.freeBufs.pop()!;
    encoder.resolveQuerySet(this.querySet!, 0, 2, this.resolveBuf!, 0);
    encoder.copyBufferToBuffer(this.resolveBuf!, 0, buf, 0, 16);
    this.pending = buf;
  }

  /** Direkt nach device.queue.submit(): asynchrones Readback anstoßen. */
  afterSubmit(): void {
    if (!this.enabled || !this.pending) return;
    const buf = this.pending;
    this.pending = undefined;
    buf.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigInt64Array(buf.getMappedRange());
      const ms = Number(t[1] - t[0]) / 1_000_000; // ns → ms
      buf.unmap();
      if (Number.isFinite(ms) && ms >= 0) {
        this.results.push(ms);
        this.lastMsValue = ms;
      }
      this.freeBufs.push(buf);
    }).catch(() => { this.freeBufs.push(buf); });
  }

  /** Neuesten fertigen GPU-Messwert (ms) liefern und Puffer leeren; null falls keiner. */
  takeSample(): number | null {
    if (this.results.length === 0) return null;
    const v = this.results[this.results.length - 1];
    this.results.length = 0;
    return v;
  }

  /** Zuletzt gemessene GPU-Zeit (ms) für die Live-Anzeige. */
  get lastMs(): number {
    return this.lastMsValue;
  }
}
