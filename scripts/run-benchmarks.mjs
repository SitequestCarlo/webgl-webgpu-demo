/**
 * Automatisierter Benchmark-Runner für die WebGL/WebGPU-Thesis.
 *
 * Voraussetzungen:
 *   npm install                    (Playwright installieren)
 *   npx playwright install chromium (Chromium-Binary herunterladen)
 *   npm run dev                    (Vite-Dev-Server auf Port 5173 starten)
 *
 * Aufruf:
 *   npm run benchmark
 *   BASE_URL=http://localhost:5173 npm run benchmark
 *
 * Ausgabe:
 *   benchmark-results/<showcase-id>.csv   (je Showcase)
 *   benchmark-results/all-benchmarks.csv  (alle Messungen)
 *
 * Messmethodik:
 *   - Pro (Showcase, API, N-Wert): eigener Browser-Context → frische GPU-State
 *   - BenchmarkRun-interne Warmup-Phase (60 Frames) gleicht GPU-DVFS aus
 *   - Chrome läuft ohne VSync-Limit (--disable-gpu-vsync, --disable-frame-rate-limit)
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'benchmark-results');
const BASE_URL    = process.env.BASE_URL ?? 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Showcase-Konfiguration
// ---------------------------------------------------------------------------

/**
 * @typedef {{ role: 'spinbutton'|'combobox', label: string, values: number[] }} ParamConfig
 * @typedef {{ id: string, label: string, apis: Record<string, string>, param: ParamConfig }} Showcase
 */

/** @type {Showcase[]} */
const SHOWCASES = [
  {
    id: '05-drawcalls',
    label: 'Draw-Call Overhead',
    apis: {
      webgl:  'showcases/05-drawcalls/webgl/index.html',
      webgpu: 'showcases/05-drawcalls/webgpu/index.html',
    },
    param: {
      role: 'spinbutton',
      label: 'N Objekte',
      values: [100, 500, 1000, 2000, 5000, 10000, 20000],
    },
  },
  {
    id: '06-vertex',
    label: 'Vertex Throughput',
    apis: {
      webgl:  'showcases/06-vertex/webgl/index.html',
      webgpu: 'showcases/06-vertex/webgpu/index.html',
    },
    param: {
      // "Segmente" steuert die Dreieckzahl; Ringe bleibt auf Standardwert (100)
      role: 'spinbutton',
      label: 'Segmente',
      values: [50, 100, 200, 500, 1000, 2000],
    },
  },
  {
    id: '07-lights',
    label: 'Multi-Light',
    apis: {
      webgl:  'showcases/07-lights/webgl/index.html',
      webgpu: 'showcases/07-lights/webgpu/index.html',
    },
    param: {
      role: 'spinbutton',
      label: 'Lichtquellen',
      values: [1, 4, 8, 16, 32, 64, 128, 256],
    },
  },
  {
    id: '08-nbody',
    label: 'N-Body Simulation',
    apis: {
      webgl:  'showcases/08-nbody/webgl/index.html',
      webgpu: 'showcases/08-nbody/webgpu/index.html',
    },
    param: {
      // lil-gui rendert Dropdown (<select>) für diskrete Werteliste
      role: 'combobox',
      label: 'N Partikel',
      values: [64, 128, 256, 512, 1024, 2048, 4096],
    },
  },
  {
    id: '09-instancing',
    label: 'Instanced Rendering',
    apis: {
      webgl:  'showcases/09-instancing/webgl/index.html',
      webgpu: 'showcases/09-instancing/webgpu/index.html',
    },
    param: {
      role: 'spinbutton',
      label: 'N Instanzen',
      values: [1000, 5000, 10000, 25000, 50000, 100000],
    },
  },
];

// ---------------------------------------------------------------------------
// CSV-Hilfsfunktionen
// ---------------------------------------------------------------------------

const CSV_HEADER = 'showcase,api,n,frames,durationMs,avgFps,avgMs,medMs,p95Ms,minMs,maxMs';

/** @param {(string|number)[]} cells */
function toCsvRow(cells) {
  return cells
    .map(c => {
      const s = String(c ?? '');
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

/** @param {object} r */
function rowFromResult(showcaseId, api, n, r) {
  return toCsvRow([
    showcaseId,
    api,
    n,
    r.frames,
    r.durationMs.toFixed(1),
    r.avgFps.toFixed(2),
    r.avgMs.toFixed(3),
    r.medMs.toFixed(3),
    r.p95Ms.toFixed(3),
    r.minMs.toFixed(3),
    r.maxMs.toFixed(3),
  ]);
}

// ---------------------------------------------------------------------------
// Playwright-Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Setzt einen GUI-Parameter über die lil-gui-DOM-Schnittstelle und wartet auf
 * die Antwort der Szene (onChange / onFinishChange im Showcase).
 *
 * @param {import('playwright').Page} page
 * @param {ParamConfig} param
 * @param {number} value
 */
async function setParam(page, param, value) {
  await page.evaluate(({ label, value, isSelect }) => {
    // lil-gui-Controller per Label-Text finden
    const nameEls = document.querySelectorAll('.lil-gui .controller .name');
    for (const nameEl of nameEls) {
      if (nameEl.textContent?.trim() !== label) continue;
      const ctrl = nameEl.closest('.controller');
      if (!ctrl) break;
      if (isSelect) {
        const sel = ctrl.querySelector('select');
        if (sel) {
          sel.value = String(value);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        const inp = ctrl.querySelector('input');
        if (inp) {
          inp.value = String(value);
          // Beide Events: 'input' für onChange, 'change' für onFinishChange
          inp.dispatchEvent(new Event('input',  { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      break;
    }
  }, { label: param.label, value, isSelect: param.role === 'combobox' });
  // Kurze Pause: Szene und GPU neu aufbauen lassen
  await page.waitForTimeout(400);
}

/**
 * Führt einen Benchmark-Durchlauf durch und gibt das BenchmarkResult zurück.
 * Lauscht auf das 'benchmarkComplete'-CustomEvent, das benchmark.ts auslöst.
 *
 * @param {import('playwright').Page} page
 * @param {ParamConfig} param
 * @param {number} n
 * @returns {Promise<object>}
 */
async function runOnePage(page, param, n) {
  // Listener VOR dem Start registrieren, damit kein Event verloren geht
  const resultPromise = page.evaluate(() =>
    new Promise((resolve, reject) => {
      const guard = setTimeout(
        () => reject(new Error('Benchmark-Timeout (120 s)')),
        120_000,
      );
      window.addEventListener('benchmarkComplete', e => {
        clearTimeout(guard);
        resolve(/** @type {CustomEvent} */(e).detail);
      }, { once: true });
    }),
  );

  await setParam(page, param, n);
  // Benchmark-Button per Text finden und klicken (via evaluate, unabhängig von ARIA-Rollen)
  await page.evaluate(() => {
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      if (btn.textContent?.trim() === 'Benchmark starten') { btn.click(); return; }
    }
  });

  return await resultPromise;
}

// ---------------------------------------------------------------------------
// Hauptprogramm
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,   // GPU-Rendering erfordert sichtbares Fenster
    args: [
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--enable-unsafe-webgpu',
    ],
  });

  /** @type {string[]} */
  const allCsvRows = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  try {
    for (const showcase of SHOWCASES) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`  ${showcase.label}  (${showcase.id})`);
      console.log('='.repeat(60));

      for (const api of /** @type {('webgl'|'webgpu')[]} */(['webgl', 'webgpu'])) {
        const url = `${BASE_URL}/${showcase.apis[api]}`;
        console.log(`\n  [${api.toUpperCase()}]  ${url}`);

        /** @type {string[]} */
        const apiCsvRows = [];

        for (const n of showcase.param.values) {
          // Eigener Browser-Context pro Messung → keine GPU-State-Überreste
          const ctx  = await browser.newContext({ viewport: { width: 1280, height: 720 } });
          const page = await ctx.newPage();

          try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
            // stats.js erzeugt 3 weitere <canvas>-Elemente — #gl ist eindeutig der Render-Canvas
            await page.locator('#gl').waitFor({ state: 'visible', timeout: 15_000 });
            // Warten bis die Render-Loop tatsächlich läuft (WebGPU-Device-Init ist async).
            // Zwei aufeinanderfolgende rAF-Ticks beweisen, dass der Loop Frames schedult.
            await page.evaluate(() => new Promise(res => {
              requestAnimationFrame(() => requestAnimationFrame(() => res(null)));
            }));
            await page.waitForTimeout(600);

            process.stdout.write(`  N=${String(n).padStart(7)} … `);
            const result = await runOnePage(page, showcase.param, n);

            const row = rowFromResult(showcase.id, api, n, result);
            apiCsvRows.push(row);
            allCsvRows.push(row);

            console.log(
              `avg ${result.avgMs.toFixed(2)} ms  ` +
              `med ${result.medMs.toFixed(2)} ms  ` +
              `p95 ${result.p95Ms.toFixed(2)} ms`,
            );
          } catch (err) {
            console.log(`FEHLER: ${err.message}`);
            const errRow = toCsvRow([showcase.id, api, n, '', '', '', '', '', '', '', err.message]);
            apiCsvRows.push(errRow);
            allCsvRows.push(errRow);
          } finally {
            await ctx.close();
          }
        }

        // CSV pro Showcase + API schreiben (webgl / webgpu getrennt)
        const outPath = join(RESULTS_DIR, `${showcase.id}-${api}-${timestamp}.csv`);
        writeFileSync(outPath, [CSV_HEADER, ...apiCsvRows].join('\n') + '\n', 'utf8');
        console.log(`  -> ${outPath}`);
      }
    }

    // Kombinations-CSV
    const allPath = join(RESULTS_DIR, `all-benchmarks-${timestamp}.csv`);
    writeFileSync(allPath, [CSV_HEADER, ...allCsvRows].join('\n') + '\n', 'utf8');
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Gesamtergebnis: ${allPath}`);
    console.log('='.repeat(60));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
