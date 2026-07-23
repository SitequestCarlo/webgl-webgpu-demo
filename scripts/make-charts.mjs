/**
 * Liest die neueste all-benchmarks-*.csv und erzeugt pro Showcase
 * einen Chart.js-Balkendiagramm als PNG-Datei.
 *
 * Aufruf: npm run charts
 *
 * Ausgabe: benchmark-results/charts/<showcase-id>-<timestamp>.png
 *          benchmark-results/charts/charts-<timestamp>.html
 *
 * Diagramm-Format:
 *   - Pro Kategorie (N-Wert): zwei Gruppen – WebGL (links) und WebGPU (rechts)
 *   - Jede Gruppe: zwei überlappende Balken – CPU (transparent, breit) und GPU (solid, schmaler)
 *   - Fehlerbalken: P5–P95 der jeweiligen Dimension
 *   - Y-Achse: logarithmisch
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const CHARTJS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js');
const CHARTJS_INLINE = readFileSync(CHARTJS_PATH, 'utf8');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'benchmark-results');
const CHARTS_DIR  = join(RESULTS_DIR, 'charts');

// ---------------------------------------------------------------------------
// CSV lesen
// ---------------------------------------------------------------------------

const csvFiles = readdirSync(RESULTS_DIR)
  .filter(f => /^all-benchmarks-\d{4}-.*\.csv$/.test(f))
  .sort().reverse();

if (csvFiles.length === 0) {
  console.error('Keine all-benchmarks-*.csv gefunden. Zuerst npm run benchmark ausführen.');
  process.exit(1);
}

const csvFile = csvFiles[0];
const csvPath = join(RESULTS_DIR, csvFile);
console.log(`Lese: ${csvPath}`);

const csv   = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = csv.trim().split('\n');
const header = lines[0].split(';');
const col = (name) => header.indexOf(name);

const iShowcase = col('showcase');
const iApi      = col('api');
const iN        = col('n');
const iMetric   = col('metric');
const iMed      = col('medMs');
const iP5       = col('p5Ms');
const iP95      = col('p95Ms');
// Per-Dimension (CPU / GPU)
const iCpuMed   = col('cpuMedMs');
const iCpuP5    = col('cpuP5Ms');
const iCpuP95   = col('cpuP95Ms');
const iGpuMed   = col('gpuMedMs');
const iGpuP5    = col('gpuP5Ms');
const iGpuP95   = col('gpuP95Ms');

// ---------------------------------------------------------------------------
// Daten gruppieren
// ---------------------------------------------------------------------------

/** @type {Record<string, Record<string, Record<number, object>>>} */
const data = {};

for (let i = 1; i < lines.length; i++) {
  const row = lines[i].split(';');
  const showcase = row[iShowcase];
  if (!showcase || !/^\d{2}-/.test(showcase) || row[iMetric] === 'error') continue;
  const api    = row[iApi];
  const n      = Number(row[iN]);
  const metric = row[iMetric] || 'gpu';
  const pn = (s) => { const v = Number((s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
  const med    = pn(row[iMed]);
  const p5     = iP5  >= 0 && row[iP5]  ? pn(row[iP5])  : med;
  const p95    = iP95 >= 0 && row[iP95] ? pn(row[iP95]) : med;
  const nf = (idx) => { if (idx < 0 || !row[idx]) return null; const v = Number(row[idx].replace(',', '.')); return Number.isFinite(v) ? v : null; };
  const cpuMed = nf(iCpuMed); const cpuP5 = nf(iCpuP5); const cpuP95 = nf(iCpuP95);
  const gpuMed = nf(iGpuMed); const gpuP5 = nf(iGpuP5); const gpuP95 = nf(iGpuP95);

  if (!data[showcase]) data[showcase] = {};
  if (!data[showcase][api]) data[showcase][api] = {};
  data[showcase][api][n] = {
    med, p5, p95, metric,
    cpuMed, cpuP5: cpuP5 ?? cpuMed, cpuP95: cpuP95 ?? cpuMed,
    gpuMed, gpuP5: gpuP5 ?? gpuMed, gpuP95: gpuP95 ?? gpuMed,
  };
}

// ---------------------------------------------------------------------------
// Alle CSV-Dateien aggregieren (Median der Mediane ueber alle Läufe)
// ---------------------------------------------------------------------------

function arrMedian(arr) {
  const vals = arr.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  return vals[Math.floor(vals.length / 2)];
}

/** Liest eine CSV und gibt pro (showcase, api, n) ein Array von Messwert-Objekten zurueck. */
function collectRows(filePath) {
  const ls  = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim().split('\n');
  const hdr = ls[0].split(';');
  const c   = (name) => hdr.indexOf(name);
  const iSh = c('showcase'), iAp = c('api'), iNn = c('n'), iMe = c('metric');
  const iCM = c('cpuMedMs'), iCP5 = c('cpuP5Ms'), iCP95 = c('cpuP95Ms');
  const iCT10 = c('cpuTrimMean10Ms'), iCT20 = c('cpuTrimMean20Ms');
  const iGM = c('gpuMedMs'), iGP5 = c('gpuP5Ms'), iGP95 = c('gpuP95Ms');
  const iGT10 = c('gpuTrimMean10Ms'), iGT20 = c('gpuTrimMean20Ms');
  const out = {};
  for (let i = 1; i < ls.length; i++) {
    const row = ls[i].split(';');
    const showcase = row[iSh];
    if (!showcase || !/^\d{2}-/.test(showcase) || row[iMe] === 'error') continue;
    const api = row[iAp];
    const n   = Number(row[iNn]);
    const nf  = (idx) => { if (idx < 0 || !row[idx]) return null; const v = Number(row[idx].replace(',', '.')); return Number.isFinite(v) ? v : null; };
    out[showcase]      ??= {};
    out[showcase][api] ??= {};
    out[showcase][api][n] ??= [];
    out[showcase][api][n].push({
      metric: row[iMe] || 'gpu',
      cpuMed: nf(iCM), cpuP5: nf(iCP5), cpuP95: nf(iCP95),
      cpuTrimMean10: nf(iCT10), cpuTrimMean20: nf(iCT20),
      gpuMed: nf(iGM), gpuP5: nf(iGP5), gpuP95: nf(iGP95),
      gpuTrimMean10: nf(iGT10), gpuTrimMean20: nf(iGT20),
    });
  }
  return out;
}

// Alle CSV-Dateien einlesen und zusammenfuehren
const allRuns = {};
for (const f of csvFiles) {
  const parsed = collectRows(join(RESULTS_DIR, f));
  for (const [sh, apis] of Object.entries(parsed)) {
    for (const [api, ns] of Object.entries(apis)) {
      for (const [n, rows] of Object.entries(ns)) {
        allRuns[sh]      ??= {};
        allRuns[sh][api] ??= {};
        allRuns[sh][api][n] ??= [];
        allRuns[sh][api][n].push(...rows);
      }
    }
  }
}

// Median-Aggregation
const dataAgg = {};
for (const [sh, apis] of Object.entries(allRuns)) {
  for (const [api, ns] of Object.entries(apis)) {
    for (const [n, rows] of Object.entries(ns)) {
      dataAgg[sh]      ??= {};
      dataAgg[sh][api] ??= {};
      const m = (key) => arrMedian(rows.map(r => r[key]));
      dataAgg[sh][api][Number(n)] = {
        metric: rows[0].metric,
        cpuMed:        m('cpuMed'),
        cpuTrimMean10: m('cpuTrimMean10'),
        cpuTrimMean20: m('cpuTrimMean20'),
        cpuP5:   m('cpuP5')  ?? m('cpuMed'),
        cpuP95:  m('cpuP95') ?? m('cpuMed'),
        gpuMed:        m('gpuMed'),
        gpuTrimMean10: m('gpuTrimMean10'),
        gpuTrimMean20: m('gpuTrimMean20'),
        gpuP5:   m('gpuP5')  ?? m('gpuMed'),
        gpuP95:  m('gpuP95') ?? m('gpuMed'),
      };
    }
  }
}

console.log(`Aggregiert ${csvFiles.length} Läufe für Zusammenfassungs-Charts.`);

// ---------------------------------------------------------------------------
// Aggregiertes CSV exportieren (Median der Mediane über alle Läufe)
// Dieses CSV repräsentiert exakt die Werte, die in den Zusammenfassungs-Charts
// dargestellt werden, und dient als Grundlage für make-chart-data.mjs.
// ---------------------------------------------------------------------------
{
  const fx = (v) => (v != null && Number.isFinite(v)) ? v.toFixed(3).replace('.', ',') : '';
  const aggHeader = 'showcase;api;n;metric;cpuMedMs;cpuTrimMean10Ms;cpuTrimMean20Ms;cpuP5Ms;cpuP95Ms;gpuMedMs;gpuTrimMean10Ms;gpuTrimMean20Ms;gpuP5Ms;gpuP95Ms';
  const aggRows   = [aggHeader];
  for (const sh of Object.keys(dataAgg).sort()) {
    for (const api of ['webgl', 'webgpu']) {
      const ns = dataAgg[sh]?.[api];
      if (!ns) continue;
      for (const n of Object.keys(ns).map(Number).sort((a, b) => a - b)) {
        const d = ns[n];
        aggRows.push([sh, api, n, d.metric,
          fx(d.cpuMed), fx(d.cpuTrimMean10), fx(d.cpuTrimMean20), fx(d.cpuP5), fx(d.cpuP95),
          fx(d.gpuMed), fx(d.gpuTrimMean10), fx(d.gpuTrimMean20), fx(d.gpuP5), fx(d.gpuP95),
        ].join(';'));
      }
    }
  }
  const aggTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const aggPath = join(RESULTS_DIR, `all-benchmarks-agg-${aggTimestamp}.csv`);
  writeFileSync(aggPath, '\uFEFF' + aggRows.join('\n') + '\n', 'utf8');
  console.log(`Aggregiert-CSV: ${aggPath}`);
};

// ---------------------------------------------------------------------------
// Chart-HTML pro Showcase
// ---------------------------------------------------------------------------

const SHOWCASE_LABELS = {
  '05-drawcalls': 'Draw-Call-Overhead',
  '06-vertex':    'Vertex-Durchsatz',
  '07-lights':    'Viele Lichtquellen',
  '08-nbody':     'N-Körper-Simulation',
  '09-instancing':'Instanziertes Rendering',
  '10-transfer':  'Puffer-Transfer',
};

const X_AXIS_LABELS = {
  '05-drawcalls': 'Anzahl Würfel',
  '06-vertex':    'Segmente',
  '07-lights':    'Anzahl Lichtquellen',
  '08-nbody':     'Anzahl Teilchen',
  '09-instancing':'Anzahl Instanzen',
  '10-transfer':  'Puffergröße (MB)',
};

// Y-Achsen-Beschriftung je Showcase (Default: Frame-Zeit). 10-transfer misst keine
// Frame-Zeit, sondern Latenz pro Transfer.
const Y_AXIS_LABELS = {
  '10-transfer': 'Zeit pro Transfer (ms)',
};

// 10-transfer: 2 einfache Balken pro N (kein gestapelter GPU-Stack), lineare Y-Achse.
const LOG_Y = new Set(['10-transfer']);

const METRIC_UNIT = { cpu: 'CPU-Zeit', gpu: 'GPU-Zeit', frame: 'Frame-Zeit' };

/**
 * Inline Chart.js-Plugin für Fehlerbalken (P5–P95-Whisker auf dem CPU-Segment).
 */
const PLUGINS_SRC = `
const errorBarPlugin = {
  id: 'errorBars',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset, di) => {
      if (!dataset.errorBars) return;
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((bar, bi) => {
        const eb = dataset.errorBars[bi];
        if (!eb || eb.lo == null || eb.hi == null || eb.lo <= 0 || eb.hi <= 0) return;
        const x   = bar.x;
        const yLo = chart.scales.y.getPixelForValue(eb.lo);
        const yHi = chart.scales.y.getPixelForValue(eb.hi);
        const w   = 4;
        ctx.save();
        ctx.strokeStyle = dataset.borderColor || '#333';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, yLo);   ctx.lineTo(x, yHi);
        ctx.moveTo(x-w, yHi); ctx.lineTo(x+w, yHi);
        ctx.moveTo(x-w, yLo); ctx.lineTo(x+w, yLo);
        ctx.stroke();
        ctx.restore();
      });
    });
  }
};`;

/** @param {string} showcaseId @param {object} dataSource @param {string} titleSuffix @param {string} idSuffix @param {'Med'|'TrimMean10'|'TrimMean20'} valueKey */
function buildChartSection(showcaseId, dataSource = data, titleSuffix = '', idSuffix = '', valueKey = 'Med') {
  const apis = dataSource[showcaseId];
  if (!apis) return '';

  const label    = SHOWCASE_LABELS[showcaseId] || showcaseId;
  const xLabel   = X_AXIS_LABELS[showcaseId]   || 'N';
  const yLabel   = Y_AXIS_LABELS[showcaseId]   || 'Zeit pro Frame (ms)';
  const useLog   = false; // Log-Achse deaktiviert — lineare Skala für alle Showcases
  const yType    = 'linear';
  const useCpuBars = LOG_Y.has(showcaseId); // 10-transfer: 2 einfache CPU-Balken statt gestapelt
  const stacked  = !useCpuBars;
  const allNs  = [...new Set(
    Object.values(apis).flatMap(a => Object.keys(a).map(Number))
  )].sort((a, b) => a - b);

  const gl  = apis['webgl']  || {};
  const gpu = apis['webgpu'] || {};
  const cpuKey = `cpu${valueKey}`;
  const gpuKey = `gpu${valueKey}`;
  const g   = (src, key) => allNs.map(n => src[n]?.[key] ?? null);

  const glCpuMeds  = g(gl,  cpuKey);  const glCpuP5s  = g(gl,  'cpuP5');  const glCpuP95s  = g(gl,  'cpuP95');
  const glGpuMeds  = g(gl,  gpuKey);  const glGpuP5s  = g(gl,  'gpuP5');  const glGpuP95s  = g(gl,  'gpuP95');
  const gpCpuMeds  = g(gpu, cpuKey);  const gpCpuP5s  = g(gpu, 'cpuP5');  const gpCpuP95s  = g(gpu, 'cpuP95');
  const gpGpuMeds  = g(gpu, gpuKey);  const gpGpuP5s  = g(gpu, 'gpuP5');  const gpGpuP95s  = g(gpu, 'gpuP95');

  // Ein einziger Whisker oben auf dem gestapelten Balken: (gpuP5+cpuP5) → (gpuP95+cpuP95)
  const ebTotal = (gpuP5s, gpuP95s, cpuP5s, cpuP95s) => allNs.map((_, i) => {
    const gLo = gpuP5s[i], gHi = gpuP95s[i];
    const cLo = cpuP5s[i] ?? 0, cHi = cpuP95s[i] ?? 0;
    return (gLo != null && gHi != null) ? { lo: gLo + cLo, hi: gHi + cHi } : null;
  });

  const glEb = ebTotal(glGpuP5s, glGpuP95s, glCpuP5s, glCpuP95s);
  const gpEb = ebTotal(gpGpuP5s, gpGpuP95s, gpCpuP5s, gpCpuP95s);

  // Y-Achsen-Maximum: 5 % über dem höchsten sichtbaren Punkt (Whisker-Tip oder Balkenhöhe),
  // damit Whisker vollständig sichtbar sind, aber ohne übermäßigen Leerraum.
  const allTops = useCpuBars
    // CPU-only Showcases: kein Whisker, höchste Balkenhöhe
    ? [...glCpuMeds, ...gpCpuMeds].filter(v => v != null && Number.isFinite(v))
    // Gestapelte GPU+CPU: Whisker-Tips (gpuP95+cpuP95); falls keine, Balkenhöhen
    : [...glEb, ...gpEb].map(e => e?.hi).filter(v => v != null && Number.isFinite(v));
  const ySuggestedMax = allTops.length ? Math.max(...allTops) * 1.05 : undefined;
  const unitLabel = METRIC_UNIT[(Object.values(gl)[0] || Object.values(gpu)[0])?.metric || 'gpu'];
  const safeId    = showcaseId.replace(/[^a-z0-9]/g, '_') + idSuffix;
  const labels    = allNs.map(String);

  return `
<div class="chart-wrap" id="wrap_${safeId}">
  <h2>${label}${titleSuffix}</h2>
  <div class="canvas-box">
    <canvas id="chart_${safeId}"></canvas>
  </div>
</div>
<script>
(function(){
  ${PLUGINS_SRC}
  const ctx = document.getElementById('chart_${safeId}').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    plugins: [errorBarPlugin],
    data: {
      labels: ${JSON.stringify(labels)},
      datasets: ${useCpuBars
        // CPU-Metrik-Showcases (10-transfer): nur je 1 Balken pro API, kein leerer GPU-Stack.
        ? JSON.stringify([
          {
            label: 'WebGL',  categoryPercentage: 0.7, barPercentage: 0.9,
            data: glCpuMeds,
            errorBars: glEb,
            backgroundColor: 'rgba(183,0,119,0.7)', borderColor: 'rgba(140,0,90,1)', borderWidth: 1,
          },
          {
            label: 'WebGPU', categoryPercentage: 0.7, barPercentage: 0.9,
            data: gpCpuMeds,
            errorBars: gpEb,
            backgroundColor: 'rgba(26,115,232,0.7)', borderColor: 'rgba(15,80,180,1)', borderWidth: 1,
          },
        ])
        // GPU-Metrik-Showcases: gestapelte CPU+GPU-Balken wie bisher.
        : `[
        {
          label: 'WebGL \u2013 GPU-Zeit', stack: 'webgl', order: 2,
          data: ${JSON.stringify(glGpuMeds)},
          backgroundColor: 'rgba(183,0,119,0.85)', borderColor: 'rgba(140,0,90,1)', borderWidth: 1,
        },
        {
          label: 'WebGL \u2013 CPU-Zeit', stack: 'webgl', order: 1,
          data: ${JSON.stringify(glCpuMeds)},
          errorBars: ${JSON.stringify(ebTotal(glGpuP5s, glGpuP95s, glCpuP5s, glCpuP95s))},
          backgroundColor: 'rgba(183,0,119,0.35)', borderColor: 'rgba(140,0,90,0.7)', borderWidth: 1,
        },
        {
          label: 'WebGPU \u2013 GPU-Zeit', stack: 'webgpu', order: 2,
          data: ${JSON.stringify(gpGpuMeds)},
          backgroundColor: 'rgba(26,115,232,0.85)', borderColor: 'rgba(15,80,180,1)', borderWidth: 1,
        },
        {
          label: 'WebGPU \u2013 CPU-Zeit', stack: 'webgpu', order: 1,
          data: ${JSON.stringify(gpCpuMeds)},
          errorBars: ${JSON.stringify(ebTotal(gpGpuP5s, gpGpuP95s, gpCpuP5s, gpCpuP95s))},
          backgroundColor: 'rgba(26,115,232,0.35)', borderColor: 'rgba(15,80,180,0.7)', borderWidth: 1,
        }
        ]`
      }
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 }, boxWidth: 14 } },
      },
      scales: {
        x: {
          title: { display: true, text: ${JSON.stringify(xLabel)}, font: { size: 13 } },
          grid:  { color: '#e5e7eb' },
          stacked: ${stacked},
        },
        y: {
          stacked: ${stacked},
          type: '${yType}',
          suggestedMax: ${JSON.stringify(ySuggestedMax)},
          title: { display: true, text: ${JSON.stringify(yLabel)}, font: { size: 13 } },
          grid:  { color: '#e5e7eb' },
          ticks: { callback: (v) => v + ' ms' }
        }
      }
    }
  });
})();
</script>`;
}
// ---------------------------------------------------------------------------
// Vollständige HTML-Seite
// ---------------------------------------------------------------------------

const VARIANTS = [
  { key: 'Med',        suffix: '_med',    filename: 'med',     label: ' – Median' },
  { key: 'TrimMean10', suffix: '_trim10', filename: 'trim10',  label: ' – 10 % getrimmter Mittelwert (p5–p95)' },
  { key: 'TrimMean20', suffix: '_trim20', filename: 'trim20',  label: ' – 20 % getrimmter Mittelwert (p10–p90)' },
];

const showcaseIds  = Object.keys(dataAgg).sort();
const chartsHtml   = showcaseIds.flatMap(id =>
  VARIANTS.map(v => buildChartSection(id, dataAgg, v.label, v.suffix, v.key))
).join('\n');
const timestamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const fullHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WebGL vs. WebGPU – Benchmark-Ergebnisse</title>
  <script>${CHARTJS_INLINE}<\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body   { font-family: system-ui, -apple-system, sans-serif; background: #f3f4f6;
             color: #111; margin: 0; padding: 24px; }
    h1     { text-align: center; font-size: 1.4em; margin: 0 0 4px; }
    .meta  { text-align: center; color: #6b7280; font-size: 0.85em; margin: 0 0 32px; }
    .chart-wrap {
      background: #fff; border: 1px solid #d1d5db; border-radius: 10px;
      padding: 20px 24px 16px; margin: 0 auto 32px; max-width: 920px;
    }
    h2       { margin: 0 0 2px; font-size: 1.05em; }
    .subtitle{ color: #6b7280; font-size: 0.78em; margin: 0 0 14px; }
    .canvas-box { position: relative; height: 360px; }
  </style>
</head>
<body>
  <h1>WebGL vs. WebGPU – Benchmark-Ergebnisse</h1>
  <p class="meta">Aggregiert aus ${csvFiles.length} Läufen (Median | 10\u202f%\u00a0TrimMean | 20\u202f%\u00a0TrimMean) &nbsp;|&nbsp; Erstellt: ${new Date().toLocaleString('de-DE')}</p>
  ${chartsHtml}
</body>
</html>`;

// ---------------------------------------------------------------------------
// HTML speichern
// ---------------------------------------------------------------------------

mkdirSync(CHARTS_DIR, { recursive: true });
const htmlPath = join(CHARTS_DIR, `charts-${timestamp}.html`);
writeFileSync(htmlPath, fullHtml, 'utf8');
console.log(`HTML:  ${htmlPath}`);

// ---------------------------------------------------------------------------
// Playwright: pro Showcase einen Screenshot erstellen
// ---------------------------------------------------------------------------

console.log('Starte Playwright für Screenshots...');
const browser = await chromium.launch({ headless: true });
const page    = await browser.newContext({ deviceScaleFactor: 2 }).then(ctx => ctx.newPage());
await page.setViewportSize({ width: 980, height: 500 });

await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle', timeout: 30_000 });

for (const id of showcaseIds) {
  for (const { suffix, filename } of VARIANTS) {
    const safeId = id.replace(/[^a-z0-9]/g, '_') + suffix;
    const wrap   = page.locator(`#wrap_${safeId}`);
    if (await wrap.count() === 0) { console.log(`  Kein Element fuer ${id}${suffix}, uebersprungen.`); continue; }
    await wrap.screenshot({ path: join(CHARTS_DIR, `${id}-${filename}-${timestamp}.png`) });
    console.log(`  ok  ${id}-${filename}.png`);
  }
}

await browser.close();
console.log(`\nAlle Diagramme in: ${CHARTS_DIR}`);
