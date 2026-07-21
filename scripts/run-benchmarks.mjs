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
 *   npm run benchmark --bench_filter=08              (nur 08-nbody)
 *   npm run benchmark --bench_filter=07,08           (07 und 08)
 *   npm run benchmark --bench_filter=08 --bench_api=webgpu
 *   BASE_URL=http://localhost:5173 npm run benchmark
 *   BROWSER_CHANNEL=chrome npm run benchmark   (System-Chrome; Default)
 *   BROWSER_CHANNEL= npm run benchmark          (gebündeltes Playwright-Chromium)
 *
 * Alternativ (direkt via node, z. B. aus run-full.mjs):
 *   node scripts/run-benchmarks.mjs --filter 08 --api webgpu
 *
 * WICHTIG (GPU): Das gebündelte Playwright-Chromium fällt für WebGPU auf einen
 *   Software-Adapter (SwiftShader) zurück → WebGPU wirkt dramatisch langsamer.
 *   Daher wird standardmäßig das SYSTEM-Chrome verwendet (channel: 'chrome') und
 *   Vulkan aktiviert. Die Adapter-Zeilen im Log ([WebGPU] adapter / [WebGL] renderer)
 *   zeigen, ob beide APIs dieselbe echte GPU nutzen.
 *
 * Ausgabe:
 *   benchmark-results/<showcase-id>.csv   (je Showcase)
 *   benchmark-results/all-benchmarks.csv  (alle Messungen)
 *
 * Messmethodik:
 *   - Pro (Showcase, API, N-Wert): eigener Browser-Context → frische GPU-State
 *   - Primärmetrik ist die ECHTE GPU-Zeit via Timestamp-Query (WebGPU timestamp-query
 *     bzw. WebGL2 EXT_disjoint_timer_query_webgl2); Spalte `metric` zeigt gpu|frame.
 *   - Zeitbasiertes Warmup (800 ms) + Messfenster (≥3 s, ≥60 Frames) gleicht
 *     GPU-DVFS/Boost-Clocks für beide APIs symmetrisch aus.
 *   - Chrome läuft ohne VSync-Limit (--disable-gpu-vsync, --disable-frame-rate-limit)
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, createWriteStream, readFileSync } from 'fs';
import os from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'benchmark-results');
const BASE_URL    = process.env.BASE_URL ?? 'http://localhost:5173';

// ---------------------------------------------------------------------------
// CLI-Filter: --filter <id>[,<id>...]  --api webgl|webgpu
// Alternativ via npm_config: npm run benchmark --bench_filter=08 --bench_api=webgpu
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf('--filter');
const onlyArg = (onlyIdx !== -1 ? argv[onlyIdx + 1] : null)
             ?? process.env.npm_config_bench_filter
             ?? null;
const onlyIds = onlyArg ? onlyArg.split(',').map(s => s.trim()) : null;

const apiIdx = argv.indexOf('--api');
const apiFilter = (apiIdx !== -1 ? argv[apiIdx + 1]?.toLowerCase() : null)
               ?? process.env.npm_config_bench_api?.toLowerCase()
               ?? null; // 'webgl'|'webgpu'|null

// ---------------------------------------------------------------------------
// System-Info (einmalig zu Beginn geloggt: OS, CPU, RAM, GPU, Browser-Version)
// ---------------------------------------------------------------------------

/** @param {import('playwright').Browser} browser */
async function logSystemInfo(browser) {
  const line = '\u2500'.repeat(60);
  console.log(`\n${line}\n  SYSTEM\n${line}`);

  // OS (auf Linux zusätzlich die Distro aus /etc/os-release)
  let osName = `${os.type()} ${os.release()} (${os.arch()})`;
  try {
    const m = readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (m) osName = `${m[1]}  —  ${os.type()} ${os.release()} (${os.arch()})`;
  } catch { /* nicht-Linux */ }
  console.log(`  OS:        ${osName}`);

  const cpus = os.cpus();
  console.log(`  CPU:       ${(cpus[0]?.model ?? '?').trim()}  (${cpus.length} threads)`);
  console.log(`  RAM:       ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`);
  console.log(`  Node:      ${process.version}`);
  try {
    console.log(`  Browser:   ${browser.browserType().name()} ${browser.version()}  (channel: ${process.env.BROWSER_CHANNEL ?? 'chrome'})`);
  } catch { /* ignore */ }

  // GPU-Identität über die Browser-Adapter abfragen (die relevante GPU für die Messung)
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const gpu = await page.evaluate(async () => {
      /** @type {{webgpu: any, webgl: any}} */
      const out = { webgpu: null, webgl: null };
      try {
        const a = await navigator.gpu?.requestAdapter?.({ powerPreference: 'high-performance' });
        if (a) {
          const i = a.info ?? {};
          out.webgpu = {
            vendor: i.vendor, architecture: i.architecture, description: i.description,
            fallback: !!(a.isFallbackAdapter || i.isFallbackAdapter),
          };
        }
      } catch { /* ignore */ }
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) out.webgl = {
          vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
          renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
        };
      } catch { /* ignore */ }
      return out;
    });
    if (gpu.webgpu) {
      console.log(`  GPU WebGPU: ${gpu.webgpu.vendor} / ${gpu.webgpu.architecture} — ${gpu.webgpu.description}${gpu.webgpu.fallback ? '  ⚠ FALLBACK/SOFTWARE' : ''}`);
    } else {
      console.log('  GPU WebGPU: (nicht verfügbar)');
    }
    console.log(`  GPU WebGL:  ${gpu.webgl ? `${gpu.webgl.vendor} — ${gpu.webgl.renderer}` : '(nicht verfügbar)'}`);
    await ctx.close();
  } catch (e) {
    console.log(`  GPU:       (Abfrage fehlgeschlagen: ${e.message})`);
  }
  console.log(line);
}

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
      values: [500, 1000, 2000, 5000, 10000, 20000, 40000],
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
      // Heavy-VS aktiv (rings=16). Bei N=256000 crasht Chrome durch zu große
      // GPU-Buffer-Allokation (~194 MB); max. N=128000 (~97 MB) ist stabil.
      role: 'spinbutton',
      label: 'Segmente',
      values: [8000, 16000, 32000, 64000, 128000],
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
      values: [8, 16, 32, 64, 128, 256],
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
      values: [256, 512, 1024, 2048, 4096, 8192, 16384],
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

const CSV_HEADER = 'showcase;api;n;metric;frames;durationMs;avgFps;avgMs;medMs;p5Ms;p95Ms;minMs;maxMs;cpuAvgMs;cpuMedMs;cpuTrimMean10Ms;cpuTrimMean20Ms;cpuP5Ms;cpuP95Ms;cpuMinMs;cpuMaxMs;gpuAvgMs;gpuMedMs;gpuTrimMean10Ms;gpuTrimMean20Ms;gpuP5Ms;gpuP95Ms;gpuMinMs;gpuMaxMs';

/** @param {(string|number)[]} cells */
function toCsvRow(cells) {
  return cells
    .map(c => {
      const s = String(c ?? '');
      return s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(';');
}

/** Deutsches Zahlenformat: Punkt → Komma @param {number} v @param {number} [dec] */
const dn = (v, dec = 3) => v.toFixed(dec).replace('.', ',');

/** @param {number|undefined} v */
const fx = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3).replace('.', ',') : '');

/** @param {object} r */
function rowFromResult(showcaseId, api, n, r) {
  return toCsvRow([
    showcaseId,
    api,
    n,
    r.metric ?? 'frame',
    r.frames,
    dn(r.durationMs, 1),
    dn(r.avgFps, 2),
    dn(r.avgMs),
    dn(r.medMs),
    dn(r.p5Ms),
    dn(r.p95Ms),
    dn(r.minMs),
    dn(r.maxMs),
    fx(r.cpu?.avgMs),
    fx(r.cpu?.medMs),
    fx(r.cpu?.trimMean10Ms),
    fx(r.cpu?.trimMean20Ms),
    fx(r.cpu?.p5Ms),
    fx(r.cpu?.p95Ms),
    fx(r.cpu?.minMs),
    fx(r.cpu?.maxMs),
    fx(r.gpu?.avgMs),
    fx(r.gpu?.medMs),
    fx(r.gpu?.trimMean10Ms),
    fx(r.gpu?.trimMean20Ms),
    fx(r.gpu?.p5Ms),
    fx(r.gpu?.p95Ms),
    fx(r.gpu?.minMs),
    fx(r.gpu?.maxMs),
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

  // System-Chrome bevorzugen (echte GPU/Vulkan). Mit BROWSER_CHANNEL="" auf das
  // gebündelte Playwright-Chromium zurückfallen.
  const CHANNEL = process.env.BROWSER_CHANNEL ?? 'chrome';

  // GPU-Backend plattformabhängig: Chrome nutzt standardmäßig Direct3D (Windows)
  // bzw. Metal (macOS) und wählt dort die echte GPU. Nur unter Linux ist der
  // Dawn-/ANGLE-Default problematisch (Software-Fallback), deshalb dort explizit
  // Vulkan erzwingen. Mit GPU_BACKEND=vulkan|none lässt sich das überschreiben.
  const platform = os.platform(); // 'linux' | 'win32' | 'darwin'
  const backend = process.env.GPU_BACKEND ?? (platform === 'linux' ? 'vulkan' : 'default');
  const backendArgs =
    backend === 'vulkan'
      ? ['--enable-features=Vulkan', '--ignore-gpu-blocklist']
      : backend === 'none'
        ? []
        : ['--ignore-gpu-blocklist']; // 'default': Chrome-Backend behalten (D3D/Metal), nur Blocklist ignorieren
  console.log(`  GPU-Backend: ${backend} (${platform}) → ${backendArgs.join(' ') || '(Chrome-Default)'}`);

  const browser = await chromium.launch({
    headless: false,   // GPU-Rendering erfordert sichtbares Fenster
    ...(CHANNEL ? { channel: CHANNEL } : {}),
    args: [
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      // Reduziert Mess-Rauschen: deaktiviert diverse Hintergrund-/Varianzquellen.
      '--enable-benchmarking',
      '--enable-unsafe-webgpu',
      // Hebt die 100-µs-Quantisierung der WebGPU-Timestamps auf (greggman/webgpufundamentals).
      '--enable-webgpu-developer-features',
      // Echte GPU statt Software-Fallback erzwingen — Backend je nach OS (s. oben):
      ...backendArgs,
    ],
  });

  /** @type {string[]} */
  const allCsvRows = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Gesamte Konsolenausgabe zusätzlich in eine Logdatei schreiben (Diagnose dauerhaft festhalten).
  const logPath = join(RESULTS_DIR, `benchmark-log-${timestamp}.log`);
  const logStream = createWriteStream(logPath, { flags: 'a' });
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const tee = (orig) => (chunk, ...rest) => {
    try { logStream.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')); } catch { /* ignore */ }
    return orig(chunk, ...rest);
  };
  process.stdout.write = tee(origStdout);
  process.stderr.write = tee(origStderr);
  console.log(`  Log: ${logPath}`);

  await logSystemInfo(browser);

  try {
    const activeShowcases = onlyIds
      ? SHOWCASES.filter(s => onlyIds.some(id => s.id.includes(id)))
      : SHOWCASES;
    if (onlyIds && activeShowcases.length === 0) {
      console.log(`  ⚠  Kein Showcase gefunden für --filter ${onlyArg}`);
      console.log(`  Verfügbar: ${SHOWCASES.map(s => s.id).join(', ')}`);
    }
    const activeApis = /** @type {('webgl'|'webgpu')[]} */ (
      apiFilter ? [apiFilter] : ['webgl', 'webgpu']
    );

    for (const showcase of activeShowcases) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`  ${showcase.label}  (${showcase.id})`);
      console.log('─'.repeat(60));

      for (const api of activeApis) {
        if (!showcase.apis[api]) continue; // API nicht vorhanden für diesen Showcase
        const url = `${BASE_URL}/${showcase.apis[api]}`;
        console.log(`\n  [${api.toUpperCase()}]`);

        /** @type {string[]} */
        const apiCsvRows = [];

        for (const n of showcase.param.values) {
          // Eigener Browser-Context pro Messung → keine GPU-State-Überreste
          const ctx  = await browser.newContext({ viewport: { width: 1280, height: 720 } });
          const page = await ctx.newPage();

          // Diagnose (Punkt 1): Timer-Warnungen aus der Seite in die Node-Konsole spiegeln.
          page.on('console', (msg) => {
            const t = msg.type();
            const txt = msg.text();
            if (t === 'warning' || t === 'error' || txt.includes('[GpuTimer]') || txt.includes('[GlTimer]') || txt.includes('[WebGPU]') || txt.includes('[WebGL]')) {
              console.log(`      \u2937 page:${t} ${txt}`);
            }
          });
          page.on('pageerror', (e) => console.log(`      \u2937 pageerror ${e.message}`));

          try {
            // Wert direkt über Query-Param setzen (?v=) – kein lil-gui-Slider-Setzen mehr,
            // das bei großen N-Werten langsam/fragil war und die Messung verfälschte.
            await page.goto(`${url}?v=${n}`, { waitUntil: 'networkidle', timeout: 30_000 });
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

            const cpuMed  = result.cpu?.medMs  != null ? `${result.cpu.medMs.toFixed(2)}` : '—';
            const gpuMed  = result.gpu?.medMs  != null ? `${result.gpu.medMs.toFixed(2)}` : '—';
            console.log(
              `[${result.metric ?? 'frame'}]  ` +
              `avg ${result.avgMs.toFixed(2)} ms  ` +
              `med ${result.medMs.toFixed(2)} ms  ` +
              `p95 ${result.p95Ms.toFixed(2)} ms  ` +
              `│ cpu ${cpuMed}  gpu ${gpuMed} ms  ` +
              `(cpu ${result.cpuCount ?? 0} / gpu ${result.gpuCount ?? 0} samples)`,
            );
          } catch (err) {
            console.log(`FEHLER: ${err.message}`);
            // 15 Spalten: showcase,api,n,metric + 10 Leerspalten + Fehlermeldung (frameMedMs-Position)
            const errRow = toCsvRow([showcase.id, api, n, 'error', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', err.message]);
            apiCsvRows.push(errRow);
            allCsvRows.push(errRow);
          } finally {
            await ctx.close();
          }
        }

        // CSV pro Showcase + API schreiben (webgl / webgpu getrennt)
        const outPath = join(RESULTS_DIR, `${showcase.id}-${api}-${timestamp}.csv`);
        writeFileSync(outPath, '\uFEFF' + [CSV_HEADER, ...apiCsvRows].join('\n') + '\n', 'utf8');
      }
    }

    // Kombinations-CSV
    const allPath = join(RESULTS_DIR, `all-benchmarks-${timestamp}.csv`);
    writeFileSync(allPath, '\uFEFF' + [CSV_HEADER, ...allCsvRows].join('\n') + '\n', 'utf8');
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Gesamtergebnis: ${allPath}`);
    console.log('─'.repeat(60));
  } finally {
    await browser.close();
    console.log(`  Log gespeichert: ${logPath}`);
    // stdout/stderr wiederherstellen und Logdatei sauber schließen
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    await new Promise((res) => logStream.end(res));
  }
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
