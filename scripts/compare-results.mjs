/**
 * Liest die neueste all-benchmarks-agg-*.csv und gibt pro Showcase
 * eine Vergleichstabelle aus: CPU-Zeit, GPU-Zeit und Gesamtzeit (CPU+GPU)
 * für WebGL vs. WebGPU, jeweils mit prozentualem Verhältnis.
 *
 * Aufruf:
 *   node scripts/compare-results.mjs
 *   node scripts/compare-results.mjs benchmark-results/all-benchmarks-agg-<ts>.csv
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'benchmark-results');

// ---------------------------------------------------------------------------
// Eingabedatei
// ---------------------------------------------------------------------------

function newestAgg() {
  const files = readdirSync(RESULTS_DIR)
    .filter(f => /^all-benchmarks-agg-.*\.csv$/.test(f))
    .sort();
  if (!files.length) throw new Error('Keine all-benchmarks-agg-*.csv gefunden.');
  return join(RESULTS_DIR, files[files.length - 1]);
}

const inputPath = process.argv[2] ?? newestAgg();
console.log(`Quelle: ${inputPath}\n`);

// ---------------------------------------------------------------------------
// CSV einlesen (deutsches Format: ; Trenner, , Dezimal, optionaler BOM)
// ---------------------------------------------------------------------------

const raw   = readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.trim().split(/\r?\n/);
const hdr   = lines[0].split(';');
const c     = (name) => hdr.indexOf(name);
const pn    = (s) => { const v = Number((s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };

const iSh  = c('showcase'), iAp = c('api'), iN = c('n'), iMe = c('metric');
const iCpu = c('cpuMedMs'), iGpu = c('gpuMedMs');

/** @type {Map<string, {n:number, api:string, metric:string, cpu:number, gpu:number}[]>} */
const byShowcase = new Map();

for (let i = 1; i < lines.length; i++) {
  const row = lines[i].split(';');
  const sh  = row[iSh]; if (!sh) continue;
  if (!byShowcase.has(sh)) byShowcase.set(sh, []);
  byShowcase.get(sh).push({
    n:      Number(row[iN]),
    api:    row[iAp],
    metric: row[iMe] || 'gpu',
    cpu:    pn(row[iCpu]),
    gpu:    pn(row[iGpu]),
  });
}

// ---------------------------------------------------------------------------
// Ausgabe-Hilfsfunktionen
// ---------------------------------------------------------------------------

const fmt = (v) => v.toFixed(3).padStart(7);

/** Verhältnis webgpu/webgl: positiv = webgpu schneller, negativ = webgpu langsamer */
function ratio(glVal, gpuVal) {
  if (glVal === 0 && gpuVal === 0) return null;
  if (glVal === 0) return null; // nicht sinnvoll berechenbar
  const pct = (1 - gpuVal / glVal) * 100;
  if (Math.abs(pct) < 1) return '  ≈ gleichauf';
  const sign = pct > 0 ? 'WebGPU' : 'WebGL ';
  return `${sign} ${Math.abs(pct).toFixed(1).padStart(5)} % kürzer`;
}

const LINE = '─'.repeat(100);
const SHOW_LABELS = {
  '05-drawcalls':  '05 – Draw-Call Overhead   (Primärmetrik: CPU)',
  '06-vertex':     '06 – Vertex-Throughput    (Primärmetrik: GPU)',
  '07-lights':     '07 – Multi-Light          (Primärmetrik: GPU)',
  '08-nbody':      '08 – N-Body Simulation    (Primärmetrik: GPU)',
  '09-instancing': '09 – Instanced Rendering  (Primärmetrik: GPU)',
};

// ---------------------------------------------------------------------------
// Pro Showcase ausgeben
// ---------------------------------------------------------------------------

for (const [sh, rows] of [...byShowcase.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const glRows  = rows.filter(r => r.api === 'webgl') .sort((a, b) => a.n - b.n);
  const gpuRows = rows.filter(r => r.api === 'webgpu').sort((a, b) => a.n - b.n);

  console.log(LINE);
  console.log(`  ${SHOW_LABELS[sh] ?? sh}`);
  console.log(LINE);
  console.log(
    '  ' +
    'N'.padStart(8) + ' │ ' +
    'GL CPU'.padStart(7) + ' GL GPU'.padStart(8) + ' GL Σ'.padStart(8) + ' │ ' +
    'GPU CPU'.padStart(7) + ' GPU GPU'.padStart(8) + ' GPU Σ'.padStart(8) + ' │ ' +
    'CPU-Δ'.padStart(19) + ' GPU-Δ'.padStart(21) + ' Σ-Δ'.padStart(21)
  );
  console.log('  ' + '─'.repeat(98));

  const ns = [...new Set([...glRows.map(r => r.n), ...gpuRows.map(r => r.n)])].sort((a, b) => a - b);
  for (const n of ns) {
    const gl  = glRows .find(r => r.n === n);
    const gpu = gpuRows.find(r => r.n === n);
    if (!gl || !gpu) continue;

    const glTot  = gl.cpu  + gl.gpu;
    const gpuTot = gpu.cpu + gpu.gpu;

    const cpuRatio   = ratio(gl.cpu,  gpu.cpu);
    const gpuRatio   = ratio(gl.gpu,  gpu.gpu);
    const totRatio   = ratio(glTot,   gpuTot);

    console.log(
      '  ' +
      String(n).padStart(8) + ' │ ' +
      fmt(gl.cpu)  + ' ' + fmt(gl.gpu)  + ' ' + fmt(glTot)  + ' │ ' +
      fmt(gpu.cpu) + ' ' + fmt(gpu.gpu) + ' ' + fmt(gpuTot) + ' │ ' +
      (cpuRatio ?? '              –    ').padStart(19) + ' ' +
      (gpuRatio ?? '              –    ').padStart(20) + ' ' +
      (totRatio ?? '              –    ').padStart(20)
    );
  }
  console.log('');
}
