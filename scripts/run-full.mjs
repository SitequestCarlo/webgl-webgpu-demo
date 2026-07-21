/**
 * Vollständiger Benchmark-Workflow: N Läufe sequenziell, danach Auswertung.
 *
 * Aufruf:
 *   npm run benchmark:full              (5 Läufe, Standard)
 *   npm run benchmark:full -- --runs 3  (3 Läufe)
 *   npm run benchmark:full -- --only 06 --runs 2
 *
 * Alle Argumente hinter -- werden 1:1 an run-benchmarks.mjs weitergegeben
 * (außer --runs, das von diesem Skript konsumiert wird).
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

const runsIdx = argv.indexOf('--runs');
const RUNS    = runsIdx !== -1 ? Math.max(1, parseInt(argv[runsIdx + 1], 10) || 5) : 5;

// Alle Argumente außer --runs <n> werden an run-benchmarks.mjs durchgereicht
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
