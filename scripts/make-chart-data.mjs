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

function newestAllBenchmarks() {
  const files = readdirSync(RESULTS_DIR)
    .filter(f => /^all-benchmarks-.*\.csv$/.test(f))
    .sort(); // ISO-Zeitstempel → lexikografisch = chronologisch
  if (files.length === 0) throw new Error('Keine all-benchmarks-*.csv in benchmark-results/ gefunden.');
  return join(RESULTS_DIR, files[files.length - 1]);
}

const inputPath = process.argv[2] ?? newestAllBenchmarks();

// ---------------------------------------------------------------------------
// CSV einlesen (Quelle: '.'-Dezimal, ','-Trennzeichen)
// ---------------------------------------------------------------------------

const raw = readFileSync(inputPath, 'utf8').trim();
const lines = raw.split(/\r?\n/);
const header = lines[0].split(',');
const col = (name) => header.indexOf(name);

const iShowcase = col('showcase');
const iApi      = col('api');
const iN        = col('n');
const iCpu      = col('cpuMedMs');
const iGpu      = col('gpuMedMs');
const iFrame    = col('frameMedMs');

/** @type {Map<string, Array<{n:number, api:string, cpu:string, gpu:string, frame:string}>>} */
const byShowcase = new Map();

for (let i = 1; i < lines.length; i++) {
  const cells = lines[i].split(',');
  const showcase = cells[iShowcase];
  if (!showcase) continue;
  const api = cells[iApi];
  const n   = Number(cells[iN]);
  if (!Number.isFinite(n)) continue; // Fehlerzeilen überspringen
  if (!byShowcase.has(showcase)) byShowcase.set(showcase, []);
  byShowcase.get(showcase).push({
    n,
    api,
    cpu:   cells[iCpu]   ?? '',
    gpu:   cells[iGpu]   ?? '',
    frame: cells[iFrame] ?? '',
  });
}

// ---------------------------------------------------------------------------
// Deutsches Zahlenformat: '.'-Dezimal → ','; leer → '0'
// ---------------------------------------------------------------------------

const de = (v) => {
  if (v === undefined || v === null || v === '') return '0';
  return String(v).replace('.', ',');
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

  const out = [`N${SEP}API${SEP}CPU (ms)${SEP}GPU (ms)${SEP}Frame (ms)`];
  for (const r of rows) {
    out.push([r.n, API_LABEL[r.api] ?? r.api, de(r.cpu), de(r.gpu), de(r.frame)].join(SEP));
  }

  const outPath = join(RESULTS_DIR, `chart-${showcase}.csv`);
  writeFileSync(outPath, BOM + out.join('\r\n') + '\r\n', 'utf8');
  written.push(outPath);
}

console.log(`Quelle: ${inputPath}`);
console.log(`${written.length} Chart-Dateien geschrieben:`);
for (const p of written) console.log(`  ${p}`);
