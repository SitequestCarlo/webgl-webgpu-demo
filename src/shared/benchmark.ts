// Benchmark-Werkzeuge für die Thesis: laufende FPS-Anzeige (stats.js) plus
// eine reproduzierbare Messung über eine feste Anzahl Frames mit Warmup.

import Stats from "stats.js";

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
  frames: number;
  durationMs: number;
  avgFps: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
}

// Sammelt Frame-Zeiten über eine feste Anzahl Frames, nachdem eine
// Warmup-Phase verstrichen ist. Aufruf von sample() pro Frame.
export class BenchmarkRun {
  private warmupFrames: number;
  private measureFrames: number;
  private warmupDone = 0;
  private samples: number[] = [];
  private lastTime = 0;
  private startTime = 0;
  private running = false;
  private resolveFn: ((r: BenchmarkResult) => void) | null = null;

  constructor(warmupFrames = 60, measureFrames = 300) {
    this.warmupFrames = warmupFrames;
    this.measureFrames = measureFrames;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): Promise<BenchmarkResult> {
    this.warmupDone = 0;
    this.samples = [];
    this.lastTime = 0;
    this.startTime = 0;
    this.running = true;
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  // Muss einmal pro gerendertem Frame aufgerufen werden.
  sample(now: number): void {
    if (!this.running) return;

    if (this.lastTime === 0) {
      this.lastTime = now;
      return;
    }
    const dt = now - this.lastTime;
    this.lastTime = now;

    if (this.warmupDone < this.warmupFrames) {
      this.warmupDone++;
      if (this.warmupDone === this.warmupFrames) this.startTime = now;
      return;
    }

    this.samples.push(dt);
    if (this.samples.length >= this.measureFrames) {
      this.finish(now);
    }
  }

  private finish(now: number): void {
    this.running = false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const avgMs = sum / sorted.length;
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    const result: BenchmarkResult = {
      frames: sorted.length,
      durationMs: now - this.startTime,
      avgFps: 1000 / avgMs,
      avgMs,
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      p95Ms: sorted[p95Index],
    };
    this.resolveFn?.(result);
    this.resolveFn = null;
  }
}

export function formatResult(r: BenchmarkResult): string {
  return [
    `Frames:  ${r.frames}`,
    `Avg FPS: ${r.avgFps.toFixed(1)}`,
    `Avg:     ${r.avgMs.toFixed(3)} ms`,
    `p95:     ${r.p95Ms.toFixed(3)} ms`,
    `Min:     ${r.minMs.toFixed(3)} ms`,
    `Max:     ${r.maxMs.toFixed(3)} ms`,
  ].join("\n");
}

// Misst die reine CPU-Zeit (Draw-Loop ohne V-Sync-Wartezeit).
// Aufruf: begin() vor dem Draw-Loop, end() danach.
// average gibt den gleitenden Durchschnitt der letzten 60 Messungen zurück.
export class CpuTimer {
  private t0 = 0;
  private buf: number[] = [];
  begin(): void { this.t0 = performance.now(); }
  end(): void {
    const dt = performance.now() - this.t0;
    this.buf.push(dt);
    if (this.buf.length > 60) this.buf.shift();
  }
  get average(): number {
    if (this.buf.length === 0) return 0;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
  reset(): void { this.buf = []; }
}
