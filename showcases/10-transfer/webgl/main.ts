// Buffer Transfer Throughput Showcase – WebGL2
// Misst den Durchsatz beim Bewegen eines Puffers der Größe S zwischen CPU und GPU.
//
//   Upload   : gl.bufferSubData(...) + glFenceAsync()   (warte, bis die GPU es verarbeitet)
//   Readback : gl.getBufferSubData(...)                 (SYNCHRON, blockiert den Main-Thread)
//   Roundtrip: Upload + Readback
//
// Kernaussage: WebGLs Readback (getBufferSubData) ist SYNCHRON und stallt den
// Main-Thread hart, während WebGPU denselben Weg über einen mappbaren Staging-Buffer
// asynchron abwickelt. Metrik ist die CPU-Wall-Clock-Latenz je Transfer → GB/s.

import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { getWebGL2, glFenceAsync } from "../../../src/shared/gl";
import {
  createStatsPanel, resultFromSamples, reportBenchmarkResult, formatResult,
  readBenchmarkValue, shouldAutostart,
} from "../../../src/shared/benchmark";

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const gl = getWebGL2(canvas);

const SIZES_MB = [1, 4, 16, 64, 256];
type Direction = "upload" | "readback" | "roundtrip";
const params = { sizeMB: readBenchmarkValue() ?? 64, direction: "roundtrip" as Direction };

const MEASURE_MS = 2000;
const MIN_SAMPLES = 8;
const MAX_SAMPLES = 300;

function gbPerSec(bytes: number, ms: number): number {
  return ms > 0 ? (bytes / 1e9) / (ms / 1000) : 0;
}

async function measure(bytes: number, dir: Direction): Promise<number[]> {
  const BATCH_BYTES = 256 * 1024 * 1024; // Ziel-Datenvolumen pro Batch (amortisiert die Sync-Latenz)

  const data = new Float32Array(bytes / 4);
  for (let i = 0; i < data.length; i += 4096) data[i] = i;
  const out = new Float32Array(bytes / 4); // Ziel für Readback (einmal allokiert)

  const K = Math.max(1, Math.round(BATCH_BYTES / bytes));
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.COPY_READ_BUFFER, buf);
  gl.bufferData(gl.COPY_READ_BUFFER, bytes, gl.DYNAMIC_DRAW); // allokieren (leer)

  // Upload: K Schreibvorgänge, dann EIN Fence → feste Sync-Latenz über K amortisiert.
  const uploadBatch = async (): Promise<void> => {
    gl.bindBuffer(gl.COPY_READ_BUFFER, buf);
    for (let k = 0; k < K; k++) gl.bufferSubData(gl.COPY_READ_BUFFER, 0, data);
    await glFenceAsync(gl);
  };
  // Readback: getBufferSubData ist SYNCHRON und blockiert je Aufruf — nicht amortisierbar.
  // Genau das ist die WebGL-Eigenheit (vs. WebGPUs asynchrone mapAsync-Batches).
  const readbackBatch = (): void => {
    gl.bindBuffer(gl.COPY_READ_BUFFER, buf);
    for (let k = 0; k < K; k++) gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, out);
  };

  // Quelle einmal befüllen.
  gl.bindBuffer(gl.COPY_READ_BUFFER, buf);
  gl.bufferSubData(gl.COPY_READ_BUFFER, 0, data);
  await glFenceAsync(gl);

  const times: number[] = [];
  const start = performance.now();
  while (times.length < MAX_SAMPLES && (times.length < MIN_SAMPLES || performance.now() - start < MEASURE_MS)) {
    const t0 = performance.now();
    if (dir === "upload") await uploadBatch();
    else if (dir === "readback") readbackBatch();
    else { await uploadBatch(); readbackBatch(); }
    times.push((performance.now() - t0) / K); // Zeit PRO Transfer
  }

  gl.deleteBuffer(buf);
  return times;
}

const stats = createStatsPanel(document.getElementById("app")!);
stats.showPanel(1);

let benchmarking = false; // pausiert den Render-Loop während der Messung

const gui = new GUI({ title: "Buffer Transfer (WebGL2)" });
gui.add(params, "sizeMB", SIZES_MB).name("Puffergröße (MB)");
gui.add(params, "direction", ["upload", "readback", "roundtrip"]).name("Richtung");
const bwCtrl = gui.add({ v: "– GB/s" }, "v").name("Durchsatz").disable();
gui.add({ run: async () => {
  const bytes = Number(params.sizeMB) * 1024 * 1024;
  resultsEl.style.display = "block";
  resultsEl.textContent = `Messe ${params.sizeMB} MB (${params.direction}) ...`;
  benchmarking = true;
  await new Promise(requestAnimationFrame); // laufenden Frame abschließen lassen
  try {
    const times = await measure(bytes, params.direction);
    const r = resultFromSamples(times, "cpu");
    reportBenchmarkResult(r);
    const gbs = gbPerSec(bytes, r.medMs);
    (bwCtrl as { setValue: (v: string) => void }).setValue(`${gbs.toFixed(2)} GB/s`);
    resultsEl.textContent =
      `[WebGL2] ${params.sizeMB} MB · ${params.direction}\n` +
      `${formatResult(r)}\nDurchsatz (Median): ${gbs.toFixed(2)} GB/s`;
  } finally {
    benchmarking = false;
  }
} }, "run").name("Benchmark starten");

function render(): void {
  if (!benchmarking) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.06, 0.07, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  stats.update();
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

if (shouldAutostart()) {
  const btns = document.querySelectorAll("button");
  for (const b of btns) if (b.textContent?.trim() === "Benchmark starten") { b.click(); break; }
}
