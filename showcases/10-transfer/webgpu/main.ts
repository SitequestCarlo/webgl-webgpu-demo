// Buffer Transfer Throughput Showcase – WebGPU
// Misst den Durchsatz beim Bewegen eines Puffers der Größe S zwischen CPU und GPU.
//
//   Upload   : device.queue.writeBuffer(...) + await onSubmittedWorkDone()
//   Readback : copyBufferToBuffer(src→staging) + await staging.mapAsync(READ)
//   Roundtrip: Upload + Readback
//
// Kernaussage: WebGPU trennt Staging explizit — Readback läuft asynchron über einen
// mappbaren Staging-Buffer (kein harter Main-Thread-Stall wie WebGLs getBufferSubData).
// Metrik ist die CPU-Wall-Clock-Latenz je Transfer; daraus wird GB/s abgeleitet.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { getWebGPU, resizeWebGPUCanvas } from "../../../src/shared/webgpu";
import {
  createStatsPanel, resultFromSamples, reportBenchmarkResult, formatResult,
  readBenchmarkValue, shouldAutostart,
} from "../../../src/shared/benchmark";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const { device, context } = await getWebGPU(canvas);

const SIZES_MB = [1, 4, 16, 64, 256];
type Direction = "upload" | "readback" | "roundtrip";
// ?opt=1 in der URL (oder GUI-Toggle) wählt den optimierten Upload-Pfad (mapped Staging).
const OPT_DEFAULT = new URLSearchParams(location.search).has("opt");
const params = { sizeMB: readBenchmarkValue() ?? 64, direction: "roundtrip" as Direction, optimized: OPT_DEFAULT };

const MEASURE_MS = 2000;   // Mindest-Messdauer
const MIN_SAMPLES = 8;     // mindestens so viele Transfers
const MAX_SAMPLES = 300;   // Deckel gegen Endlosschleife bei kleinen Größen

function gbPerSec(bytes: number, ms: number): number {
  return ms > 0 ? (bytes / 1e9) / (ms / 1000) : 0;
}

// Misst PRO-TRANSFER-Zeiten (ms). Um die feste CPU↔GPU-Sync-Latenz zu amortisieren,
// werden K Transfers pro Zeitmessung gebündelt (K so, dass K·S ≈ BATCH_BYTES) und die
// Batch-Zeit durch K geteilt → echte Bandbreite statt Latenz-Sockel bei kleinen Größen.
async function measure(bytes: number, dir: Direction, optimized: boolean): Promise<number[]> {
  const BATCH_BYTES = 256 * 1024 * 1024;   // Ziel-Datenvolumen pro Batch
  const POOL_CAP_BYTES = 64 * 1024 * 1024; // max. Staging-Speicher für parallele Readback-Maps

  const data = new Float32Array(bytes / 4);
  for (let i = 0; i < data.length; i += 4096) data[i] = i; // etwas Nicht-Null-Inhalt

  const K = Math.max(1, Math.round(BATCH_BYTES / bytes));
  const src = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });

  // Staging-Pool: mehrere Buffer erlauben PARALLELE mapAsync (amortisiert die Map-Latenz).
  const P = dir === "upload" ? 0 : Math.max(1, Math.min(K, Math.floor(POOL_CAP_BYTES / bytes)));
  const pool: GPUBuffer[] = [];
  for (let i = 0; i < P; i++) {
    pool.push(device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
  }

  // Optimierter Upload: persistenter, mappbarer Staging-Buffer. Daten werden EINMAL in
  // host-visible Memory geschrieben (statt K× über queue.writeBuffer in Dawns internes
  // Staging) und dann K× per copyBufferToBuffer auf die GPU kopiert → spart CPU-Kopien.
  const stagingUp = (optimized && dir !== "readback")
    ? device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC })
    : null;
  const uploadBatch = optimized
    ? async (): Promise<void> => {
        await stagingUp!.mapAsync(GPUMapMode.WRITE);
        new Float32Array(stagingUp!.getMappedRange()).set(data);
        stagingUp!.unmap();
        const enc = device.createCommandEncoder();
        for (let k = 0; k < K; k++) enc.copyBufferToBuffer(stagingUp!, 0, src, 0, bytes);
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
      }
    : async (): Promise<void> => {
        for (let k = 0; k < K; k++) device.queue.writeBuffer(src, 0, data);
        await device.queue.onSubmittedWorkDone(); // EIN Sync für K Uploads
      };
  const readbackBatch = async (): Promise<void> => {
    let done = 0;
    while (done < K) {
      const round = Math.min(P, K - done);
      const enc = device.createCommandEncoder();
      for (let j = 0; j < round; j++) enc.copyBufferToBuffer(src, 0, pool[j], 0, bytes);
      device.queue.submit([enc.finish()]);
      await Promise.all(pool.slice(0, round).map(b => b.mapAsync(GPUMapMode.READ)));
      for (let j = 0; j < round; j++) { pool[j].getMappedRange(); pool[j].unmap(); }
      done += round;
    }
  };

  // Quelle einmal befüllen (für Readback/Roundtrip).
  device.queue.writeBuffer(src, 0, data);
  await device.queue.onSubmittedWorkDone();

  const times: number[] = [];
  const start = performance.now();
  while (times.length < MAX_SAMPLES && (times.length < MIN_SAMPLES || performance.now() - start < MEASURE_MS)) {
    const t0 = performance.now();
    if (dir === "upload") await uploadBatch();
    else if (dir === "readback") await readbackBatch();
    else { await uploadBatch(); await readbackBatch(); }
    times.push((performance.now() - t0) / K); // Zeit PRO Transfer
  }

  src.destroy();
  stagingUp?.destroy();
  for (const b of pool) b.destroy();
  return times;
}

const stats = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1);

// Während der Messung wird der Render-Loop pausiert — sonst flutet er die GPU-Queue
// und onSubmittedWorkDone/mapAsync warten auf den Backlog statt nur auf den Transfer.
let benchmarking = false;

const gui = new GUI({ title: "Buffer Transfer (WebGPU)" });
gui.add(params, "sizeMB", SIZES_MB).name("Puffergröße (MB)");
gui.add(params, "direction", ["upload", "readback", "roundtrip"]).name("Richtung");
gui.add(params, "optimized").name("Optimiert (mapped Staging)");
const bwCtrl = gui.add({ v: "– GB/s" }, "v").name("Durchsatz").disable();
gui.add({ run: async () => {
  const bytes = Number(params.sizeMB) * 1024 * 1024;
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${params.sizeMB} MB (${params.direction}) ...`;
  benchmarking = true;
  await device.queue.onSubmittedWorkDone(); // Render-Backlog leeren
  try {
    const times = await measure(bytes, params.direction, params.optimized);
    const r = resultFromSamples(times, "cpu");
    reportBenchmarkResult(r);
    const gbs = gbPerSec(bytes, r.medMs);
    (bwCtrl as { setValue: (v: string) => void }).setValue(`${gbs.toFixed(2)} GB/s`);
    resultsEl.textContent =
      `[WebGPU${params.optimized ? " opt" : ""}] ${params.sizeMB} MB · ${params.direction}\n` +
      `${formatResult(r)}\nDurchsatz (Median): ${gbs.toFixed(2)} GB/s`;
  } finally {
    benchmarking = false;
  }
} }, "run").name("Benchmark starten");

function render(): void {
  if (!benchmarking) {
    resizeWebGPUCanvas(canvas);
    const cmd = device.createCommandEncoder();
    const pass = cmd.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.06, g: 0.07, b: 0.09, a: 1 },
        loadOp: "clear", storeOp: "store",
      }],
    });
    pass.end();
    device.queue.submit([cmd.finish()]);
  }
  stats.update();
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

if (shouldAutostart()) {
  const btns = document.querySelectorAll("button");
  for (const b of btns) if (b.textContent?.trim() === "Benchmark starten") { b.click(); break; }
}
