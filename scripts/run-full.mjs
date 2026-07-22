/**
 * Vollständiger Benchmark-Workflow: N Läufe sequenziell, danach Auswertung.
 *
 * Aufruf (via npm run — keine Flags nach -- nötig):
 *   npm run benchmark:full                              (1 Lauf, Standard)
 *   npm run benchmark:full --bench_runs=3               (3 Läufe)
 *   npm run benchmark:full --bench_filter=06            (nur 06-vertex)
 *   npm run benchmark:full --bench_filter=06 --bench_runs=2
 *   npm run benchmark:full --bench_filter=07,08
 *
 * Alternativ (direkt via node):
 *   node scripts/run-full.mjs --filter 06 --runs 2
 *
 * Alle Argumente werden 1:1 an run-benchmarks.mjs weitergegeben
 * (--runs bzw. npm_config_bench_runs werden von diesem Skript konsumiert).
 *
 * Nach den Läufen wird automatisch ausgeführt:
 *   make-charts.mjs    → aggregierte Charts + all-benchmarks-agg-*.csv
 *   make-chart-data.mjs → chart-*.csv im deutschen Excel-Format
 *   compare-results.mjs → Verhältnis-Tabelle in der Konsole
 */

import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

// ---------------------------------------------------------------------------
// CLI-Argumente parsen
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

// --runs <n> oder npm run ... --bench_runs=<n>  (Standard: 1 Lauf)
const runsIdx = argv.indexOf('--runs');
const runsEnv = process.env.npm_config_bench_runs;
const RUNS = runsIdx !== -1
  ? Math.max(1, parseInt(argv[runsIdx + 1], 10) || 1)
  : runsEnv
    ? Math.max(1, parseInt(runsEnv, 10) || 1)
    : 1;

// Alle Argumente außer --runs <n> werden an run-benchmarks.mjs durchgereicht.
// npm_config_bench_filter / npm_config_bench_api werden vom Kindprozess
// automatisch über die geerbte Umgebung gelesen — kein explizites Forwarding.
const forwardArgs = argv.filter((a, i) =>
  a !== '--runs' && argv[i - 1] !== '--runs'
);

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const LINE = '═'.repeat(60);

function run(label, script, args = []) {
  console.log(`\n${LINE}`);
  console.log(`  ${label}`);
  console.log(LINE);
  const result = spawnSync(node, [join(__dirname, script), ...args], {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
  });
  if (result.status !== 0) {
    console.error(`\nFehler bei: ${script} (Exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

// ---------------------------------------------------------------------------
// N Benchmark-Läufe
// ---------------------------------------------------------------------------

console.log(`\n${LINE}`);
console.log(`  benchmark:full  –  ${RUNS} Lauf/Läufe`);
const filterInfo = process.env.npm_config_bench_filter ?? forwardArgs.find((a, i) => forwardArgs[i - 1] === '--filter');
if (filterInfo) console.log(`  Filter: ${filterInfo}`);
if (forwardArgs.length) console.log(`  Weitergeleitete Argumente: ${forwardArgs.join(' ')}`);
console.log(LINE);

for (let i = 1; i <= RUNS; i++) {
  run(`Lauf ${i} / ${RUNS}`, 'run-benchmarks.mjs', forwardArgs);
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

run('Charts + Aggregiertes CSV', 'make-charts.mjs');
run('Excel-CSVs (Deutsches Format)', 'make-chart-data.mjs');
run('Vergleichstabelle', 'compare-results.mjs');

console.log(`\n${LINE}`);
console.log(`  Fertig. ${RUNS} Lauf/Läufe abgeschlossen.`);
console.log(LINE);
