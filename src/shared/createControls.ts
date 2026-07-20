// =============================================================================
// createControls.ts – Gemeinsame GUI/Benchmark-Logik für alle Showcases.
//
// Kapselt: Screenshot-Button, Benchmark-Button, Stats-Panel.
// Showcase-spezifische GUI-Controls (Slider, Dropdowns) werden von den
// jeweiligen main.ts-Dateien vor dem Aufruf von createControls() hinzugefügt.
//
// Beispiel-Verwendung:
//   const gui = new GUI({ title: "Mein Showcase" });
//   gui.add(params, "count", 1, 100).name("Anzahl");      // showcase-spezifisch
//   const ctrl = createControls(gui, "[WebGL] Mein Showcase", canvas);
//   // Im Render-Loop:
//   ctrl.consumeCapture();   // Screenshot falls ausstehend
//   ctrl.benchmark.sample(now);
// =============================================================================

import { GUI } from 'lil-gui';
import { BenchmarkRun, createStatsPanel, formatResult, type BenchmarkResult } from './benchmark';

export interface ShowcaseControls {
  /** stats.js Panel (FPS/ms/MB) */
  stats: ReturnType<typeof createStatsPanel>;
  /** BenchmarkRun-Instanz für benchmark.sample(now) im Render-Loop */
  benchmark: BenchmarkRun;
  /** Screenshot aufnehmen falls ausstehend (einmal pro Frame aufrufen) */
  consumeCapture(): void;
}

/**
 * Hängt Screenshot + Benchmark-Button an die übergebene GUI und gibt eine
 * gemeinsame Controls-Instanz zurück.
 *
 * @param gui           lil-gui Instanz (showcase-spezifische Controls wurden bereits hinzugefügt)
 * @param label         Prefix für Benchmark-Ergebnisse, z.B. "[WebGL] Raytracer"
 * @param canvas        Canvas-Element für den Screenshot (Default: #gl)
 * @param getExtraInfo  Optionale Funktion für zusätzliche Benchmark-Infos
 */
export function createControls(
  gui: GUI,
  label: string,
  canvas?: HTMLCanvasElement | null,
  getExtraInfo?: () => string,
): ShowcaseControls {
  const resultsEl = document.getElementById('results') as HTMLDivElement;
  const appEl     = document.getElementById('app') ?? document.body;
  const stats     = createStatsPanel(appEl);
  const benchmark = new BenchmarkRun();
  let   pendingCapture = false;

  // Ziel-Canvas: übergebene Instanz oder erster Canvas im DOM
  const targetCanvas =
    canvas ?? document.querySelector<HTMLCanvasElement>('#gl');

  function captureWebp(): void {
    if (!targetCanvas) return;
    targetCanvas.toBlob(
      blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `${label.replace(/[^a-zA-Z0-9-]/g, '-')}.png`;
        a.click();
        URL.revokeObjectURL(url);
      },
      'image/png',
    );
  }

  async function runBenchmark(): Promise<void> {
    resultsEl.style.display = 'block';
    resultsEl.textContent   = 'Messung läuft …';
    const r: BenchmarkResult = await benchmark.start();
    const extra = getExtraInfo?.() ?? '';
    resultsEl.textContent = [
      label,
      ...(extra ? [extra] : []),
      formatResult(r),
    ].join('\n');
  }

  gui.add({ shot: () => { pendingCapture = true; } }, 'shot').name('Screenshot (PNG)');
  gui.add({ run:  () => void runBenchmark() },         'run').name('Benchmark starten');

  return {
    stats,
    benchmark,
    consumeCapture() {
      if (pendingCapture) {
        pendingCapture = false;
        captureWebp();
      }
    },
  };
}
