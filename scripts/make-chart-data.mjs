/**
 * Erzeugt aus den Benchmark-CSVs pro Showcase eine Chart-Datei für DEUTSCHES Excel.
 *
 * Format:
 *   - Trennzeichen ';'  (deutsches Excel-Listentrennzeichen)
 *   - Dezimal-Komma     (1,234 statt 1.234)
 *   - UTF-8 mit BOM     (Excel erkennt Umlaute korrekt)
 *
 * Layout je Datei (chart-<showcase>.csv):
 *   N ; API ; CPU (ms) ; GPU (ms)
 *   Zwei Zeilen pro N-Wert (WebGL, WebGPU). Die ersten beiden Textspalten bilden in
 *   Excel eine ZWEISTUFIGE Kategorieachse (N außen, API innen). So ergibt ein
 *   "Gestapelte Säule"-Diagramm pro N zwei Balken (WebGL/WebGPU), jeweils gestapelt
 *   CPU (unten) + GPU (oben).
 *
 * Excel-Schritte:
 *   1. Datei per Doppelklick öffnen (';' + Komma werden automatisch erkannt).
 *   2. Bereich A1:D… markieren → Einfügen → Säule → "Gestapelte Säule".
 *   3. X-Achse zeigt N (außen) mit WebGL/WebGPU (innen); jede Säule ist CPU+GPU gestapelt.
 *
 * Aufruf:
 *   npm run chart                       (nutzt die neueste all-benchmarks-*.csv)
 *   node scripts/make-chart-data.mjs benchmark-results/all-benchmarks-<ts>.csv
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'benchmark-results');

// ---------------------------------------------------------------------------
// Eingabedatei bestimmen: CLI-Argument oder neueste all-benchmarks-*.csv
// ---------------------------------------------------------------------------

function allRunFiles() {
  // Nur echte Lauf-Dateien (all-benchmarks-YYYY-…), keine agg-Dateien
  const files = readdirSync(RESULTS_DIR)
    .filter(f => /^all-benchmarks-\d{4}-.*\.csv$/.test(f))
    .sort();
  if (files.length === 0) throw new Error('Keine all-benchmarks-*.csv in benchmark-results/ gefunden.');
  return files.map(f => join(RESULTS_DIR, f));
}

const runFiles = process.argv[2] ? [process.argv[2]] : allRunFiles();

// ---------------------------------------------------------------------------
// Alle Lauf-CSVs einlesen, nach (showcase, api, n) gruppieren
// ---------------------------------------------------------------------------

function parseFile(filePath) {
  const lines = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const hdr = lines[0].split(';');
  const c = (name) => hdr.indexOf(name);
  const iSh = c('showcase'), iAp = c('api'), iNn = c('n'), iMe = c('metric');
  const iCpu = c('cpuMedMs'), iGpu = c('gpuMedMs');
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(';');
    const showcase = cells[iSh];
    if (!showcase || cells[iMe] === 'error') continue;
    const api = cells[iAp];
    const n   = Number(cells[iNn]);
    if (!Number.isFinite(n)) continue;
    const nf  = (idx) => { if (idx < 0 || !cells[idx]) return null; const v = Number(cells[idx].replace(',', '.')); return Number.isFinite(v) ? v : null; };
    out[showcase]      ??= {};
    out[showcase][api] ??= {};
    out[showcase][api][n] ??= [];
    out[showcase][api][n].push({ cpu: nf(iCpu), gpu: nf(iGpu), metric: cells[iMe] || 'gpu' });
  }
  return out;
}

const allRuns = {};
for (const f of runFiles) {
  for (const [sh, apis] of Object.entries(parseFile(f))) {
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

// ---------------------------------------------------------------------------
// Median der Mediane über alle Läufe
// ---------------------------------------------------------------------------

function median(arr) {
  const vals = arr.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return null;
  return vals[Math.floor(vals.length / 2)];
}

/** @type {Map<string, Array<{n:number, api:string, cpu:number|null, gpu:number|null, frame:number|null}>>} */
const byShowcase = new Map();
for (const [sh, apis] of Object.entries(allRuns)) {
  for (const api of ['webgl', 'webgpu']) {
    const ns = apis[api];
    if (!ns) continue;
    for (const [n, rows] of Object.entries(ns)) {
      if (!byShowcase.has(sh)) byShowcase.set(sh, []);
      byShowcase.get(sh).push({
        n:     Number(n),
        api,
        cpu:   median(rows.map(r => r.cpu)),
        gpu:   median(rows.map(r => r.gpu)),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Deutsches Zahlenformat: '.'-Dezimal → ','; leer → '0'
// ---------------------------------------------------------------------------

const de = (v) => {
  if (v == null || !Number.isFinite(v)) return '0';
  return v.toFixed(3).replace('.', ',');
};

const API_LABEL = { webgl: 'WebGL', webgpu: 'WebGPU' };
const SEP = ';';
const BOM = '\uFEFF';

// ---------------------------------------------------------------------------
// Pro Showcase eine Chart-Datei schreiben
// ---------------------------------------------------------------------------

const written = [];

for (const [showcase, rows] of byShowcase) {
  // Nach N aufsteigend, innerhalb N: WebGL vor WebGPU
  rows.sort((a, b) => a.n - b.n || (a.api === 'webgl' ? -1 : 1));

  const out = [`N${SEP}API${SEP}CPU (ms)${SEP}GPU (ms)`];
  for (const r of rows) {
    out.push([r.n, API_LABEL[r.api] ?? r.api, de(r.cpu), de(r.gpu)].join(SEP));
  }

  const outPath = join(RESULTS_DIR, `chart-${showcase}.csv`);
  writeFileSync(outPath, BOM + out.join('\r\n') + '\r\n', 'utf8');
  written.push(outPath);
}

console.log(`Quellen: ${runFiles.length} Lauf-CSV(s), Median aggregiert.`);
console.log(`${written.length} Chart-Dateien geschrieben:`);
for (const p of written) console.log(`  ${p}`);
