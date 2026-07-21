// Benchmark-Werkzeuge für die Thesis: laufende FPS-Anzeige (stats.js) plus
// eine reproduzierbare Messung über eine feste Anzahl Frames mit Warmup.

import Stats from "stats.js";

// Liest den Benchmark-Parameterwert aus der URL (?v=…). Erlaubt es, ein Showcase
// direkt mit dem korrekten Wert zu laden (statt den lil-gui-Slider zu animieren) —
// wichtig für den automatisierten Runner und reproduzierbare Messungen.
export function readBenchmarkValue(): number | null {
  const v = new URLSearchParams(location.search).get("v");
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// true, wenn die URL ?autostart enthält → Benchmark automatisch starten.
export function shouldAutostart(): boolean {
  return new URLSearchParams(location.search).has("autostart");
}

export function createStatsPanel(container: HTMLElement = document.body): Stats {
  const stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb
  const dom = stats.dom;
  dom.style.position = "absolute";
  dom.style.left = "8px";
  dom.style.top = "8px";
  container.appendChild(dom);
  return stats;
}

export interface BenchmarkResult {
  /**
   * Worauf sich avg/med/min/max/p95 beziehen:
   *  - "cpu"   = CPU-Zeit für Record+Submit (API-/Treiber-Overhead) → CPU-bound Showcases
   *  - "gpu"   = echte GPU-Ausführungszeit (Timestamp-Query)        → GPU-bound Showcases
   *  - "frame" = Wall-Clock-Frame-Zeit (Fallback)
   */
  metric: "cpu" | "gpu" | "frame";
  frames: number;
  durationMs: number;
  avgFps: number;
  // Primärmetrik (je nach Showcase CPU- oder GPU-Zeit; Fallback Frame-Zeit):
  avgMs: number;
  medMs: number;
  p5Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  // Alle drei Dimensionen immer mitgeführt (undefined, falls nicht gemessen).
  // Erst dadurch wird sichtbar, OB ein Showcase CPU- oder GPU-bound ist.
  cpu?: SampleStats;
  gpu?: SampleStats;
  frame: SampleStats;
  // Anzahl gesammelter Einzelsamples je Dimension (Diagnose: 0 GPU-Samples ⇒ Timestamp-Pfad defekt).
  cpuCount: number;
  gpuCount: number;
}

export interface BenchmarkOptions {
  /** Aufwärmphase in Millisekunden (Wall-Clock), bevor Messwerte gesammelt werden. */
  warmupMs?: number;
  /** Mindestdauer des Messfensters in Millisekunden (Wall-Clock). */
  measureMs?: number;
  /** Mindestanzahl gesammelter Frames, bevor die Messung enden darf. */
  minFrames?: number;
  /** Mindestanzahl CPU-/GPU-Samples, damit die Dimension als Primärmetrik taugt. */
  minSamples?: number;
  /**
   * Messziel dieses Showcases: "cpu" für API-Overhead-lastige Showcases
   * (viele Draw-Calls / Uniform-Uploads), "gpu" für rechenlastige Showcases
   * (Vertex-/Fragment-/Compute-Durchsatz). Default: "gpu" falls GPU-Samples
   * vorliegen, sonst "frame".
   */
  primary?: "cpu" | "gpu";
}

export interface SampleStats {
  avgMs: number;
  medMs: number;
  trimMean10Ms: number;  // 10 % Trimmed Mean (Mittelwert der mittleren 90 %, p5–p95)
  trimMean20Ms: number;  // 20 % Trimmed Mean (Mittelwert der mittleren 80 %, p10–p90)
  p5Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

function computeStats(samples: number[]): SampleStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mid = Math.floor(n / 2);
  const p5Index  = Math.min(n - 1, Math.floor(n * 0.05));
  const p95Index = Math.min(n - 1, Math.floor(n * 0.95));
  const p10Index = Math.min(n - 1, Math.floor(n * 0.10));
  const p90Index = Math.min(n - 1, Math.floor(n * 0.90));
  const trimMean = (lo: number, hi: number) => {
    const slice = sorted.slice(lo, hi + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  };
  return {
    avgMs: sum / n,
    medMs: n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid],
    trimMean10Ms: trimMean(p5Index, p95Index),
    trimMean20Ms: trimMean(p10Index, p90Index),
    p5Ms:  sorted[p5Index],
    p95Ms: sorted[p95Index],
    minMs: sorted[0],
    maxMs: sorted[n - 1],
  };
}

// Sammelt drei getrennte Zeit-Dimensionen pro Frame über ein ZEITBASIERTES
// Messfenster nach einer zeitbasierten Aufwärmphase:
//   - CPU-Zeit  (Record+Submit): erfasst den API-/Treiber-Overhead. Das ist der
//     eigentliche WebGL-vs-WebGPU-Unterschied bei vielen Draw-Calls/Uniform-Uploads
//     und wird von GPU-Timestamps NICHT erfasst.
//   - GPU-Zeit  (Timestamp-Query): reine Ausführungszeit auf der GPU.
//   - Frame-Zeit (rAF-Delta): End-to-End inkl. VSync/Present — zwischen den APIs
//     NICHT vergleichbar, nur als Kontext.
// Welche Dimension die Primärmetrik ist, legt das jeweilige Showcase über
// options.primary fest (CPU-bound vs. GPU-bound).
export class BenchmarkRun {
  private warmupMs: number;
  private measureMs: number;
  private minFrames: number;
  private minSamples: number;
  private primaryPref?: "cpu" | "gpu";

  private frameSamples: number[] = [];
  private gpuSamples: number[] = [];
  private cpuSamples: number[] = [];
  private lastTime = 0;
  private phaseStart = 0;     // Startzeit der aktuellen Phase (Warmup bzw. Messung)
  private measuring = false;  // false = Warmup, true = Messfenster
  private running = false;
  private resolveFn: ((r: BenchmarkResult) => void) | null = null;

  constructor(opts: BenchmarkOptions = {}) {
    this.warmupMs = opts.warmupMs ?? 800;
    this.measureMs = opts.measureMs ?? 3000;
    this.minFrames = opts.minFrames ?? 60;
    this.minSamples = opts.minSamples ?? 10;
    this.primaryPref = opts.primary;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): Promise<BenchmarkResult> {
    this.frameSamples = [];
    this.gpuSamples = [];
    this.cpuSamples = [];
    this.lastTime = 0;
    this.phaseStart = 0;
    this.measuring = false;
    this.running = true;
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  // Muss einmal pro gerendertem Frame aufgerufen werden.
  //   gpuMs: GPU-Ausführungszeit dieses Frames aus Timestamp-Queries (falls verfügbar).
  //   cpuMs: CPU-Zeit für Record+Submit dieses Frames (falls gemessen).
  sample(now: number, gpuMs?: number, cpuMs?: number): void {
    if (!this.running) return;

    if (this.lastTime === 0) {
      this.lastTime = now;
      this.phaseStart = now;
      return;
    }
    const dt = now - this.lastTime;
    this.lastTime = now;

    if (!this.measuring) {
      // Zeitbasierte Aufwärmphase: gleicht GPU-DVFS/Boost-Clocks für beide APIs
      // gleich lang aus (nicht frame-basiert, da Framezeiten stark differieren).
      if (now - this.phaseStart >= this.warmupMs) {
        this.measuring = true;
        this.phaseStart = now;
      }
      return;
    }

    this.frameSamples.push(dt);
    if (gpuMs !== undefined && Number.isFinite(gpuMs) && gpuMs >= 0) {
      this.gpuSamples.push(gpuMs);
    }
    if (cpuMs !== undefined && Number.isFinite(cpuMs) && cpuMs >= 0) {
      this.cpuSamples.push(cpuMs);
    }

    const elapsed = now - this.phaseStart;
    if (elapsed >= this.measureMs && this.frameSamples.length >= this.minFrames) {
      this.finish(now);
    }
  }

  private finish(now: number): void {
    this.running = false;
    const frame = computeStats(this.frameSamples);
    const gpu = this.gpuSamples.length >= this.minSamples ? computeStats(this.gpuSamples) : undefined;
    const cpu = this.cpuSamples.length >= this.minSamples ? computeStats(this.cpuSamples) : undefined;

    // Primärmetrik nach Showcase-Wunsch, mit Fallback-Kette.
    let metric: "cpu" | "gpu" | "frame";
    let primary: SampleStats;
    if (this.primaryPref === "cpu" && cpu) {
      metric = "cpu"; primary = cpu;
    } else if (this.primaryPref === "gpu" && gpu) {
      metric = "gpu"; primary = gpu;
    } else if (gpu) {
      metric = "gpu"; primary = gpu;
    } else if (cpu) {
      metric = "cpu"; primary = cpu;
    } else {
      metric = "frame"; primary = frame;
    }

    const result: BenchmarkResult = {
      metric,
      frames: this.frameSamples.length,
      durationMs: now - this.phaseStart,
      avgFps: 1000 / frame.avgMs,
      avgMs: primary.avgMs,
      medMs: primary.medMs,
      p5Ms:  primary.p5Ms,
      p95Ms: primary.p95Ms,
      minMs: primary.minMs,
      maxMs: primary.maxMs,
      cpu,
      gpu,
      frame,
      cpuCount: this.cpuSamples.length,
      gpuCount: this.gpuSamples.length,
    };
    this.resolveFn?.(result);
    this.resolveFn = null;
    // Automatisierungs-Hook: Ergebnis für externen Runner bereitstellen
    (window as unknown as Record<string, unknown>)['__benchmarkResult'] = result;
    window.dispatchEvent(new CustomEvent('benchmarkComplete', { detail: result }));
  }
}

const METRIC_LABEL: Record<BenchmarkResult["metric"], string> = {
  cpu: "CPU-Zeit Record+Submit (API-Overhead)",
  gpu: "GPU-Zeit (Timestamp-Query)",
  frame: "Frame-Zeit (Wall-Clock)",
};

export function formatResult(r: BenchmarkResult): string {
  const line = (label: string, s?: SampleStats) =>
    s ? `${label} avg ${s.avgMs.toFixed(3)} · med ${s.medMs.toFixed(3)} · p95 ${s.p95Ms.toFixed(3)} ms` : "";
  return [
    `Metrik:  ${METRIC_LABEL[r.metric]}`,
    `Frames:  ${r.frames}`,
    `Avg FPS: ${r.avgFps.toFixed(1)}`,
    `Avg:     ${r.avgMs.toFixed(3)} ms`,
    `Median:  ${r.medMs.toFixed(3)} ms`,
    `p95:     ${r.p95Ms.toFixed(3)} ms`,
    `Min:     ${r.minMs.toFixed(3)} ms`,
    `Max:     ${r.maxMs.toFixed(3)} ms`,
    "—",
    line("CPU:  ", r.cpu),
    line("GPU:  ", r.gpu),
    line("Frame:", r.frame),
  ].filter(Boolean).join("\n");
}

// Misst die reine CPU-Zeit (Draw-Loop ohne V-Sync-Wartezeit).
// Aufruf: begin() vor dem Draw-Loop, end() danach.
// average gibt den gleitenden Durchschnitt der letzten 60 Messungen zurück,
// lastMs die zuletzt gemessene Einzelzeit (für benchmark.sample).
export class CpuTimer {
  private t0 = 0;
  private lastDt = 0;
  private buf: number[] = [];
  begin(): void { this.t0 = performance.now(); }
  end(): void {
    const dt = performance.now() - this.t0;
    this.lastDt = dt;
    this.buf.push(dt);
    if (this.buf.length > 60) this.buf.shift();
  }
  get lastMs(): number { return this.lastDt; }
  get average(): number {
    if (this.buf.length === 0) return 0;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
  reset(): void { this.buf = []; this.lastDt = 0; }
}
