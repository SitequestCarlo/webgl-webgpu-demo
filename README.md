# WebGL / WebGPU – Thesis Demos

Interaktive Showcase-Sammlung für eine Informatik-Thesis zum Thema **WebGL vs. WebGPU** im Browser. Alle Beispiele laufen direkt im Browser – kein Server, kein Framework, kein Plugin.

## Struktur

Die Demos sind in drei Kategorien gegliedert:

### Rendering
Visuelle Effekte und Beleuchtungsmodelle – zeigen die Rendering-Pipeline beider APIs im direkten Vergleich.

| # | Showcase | Inhalt |
|---|---|---|
| 01 | **Shading-Modelle** | Flat, Gouraud, Phong, Blinn-Phong, Toon, PBR |
| 02 | **PBR Material-Grid** | 6×6 Kugeln entlang Roughness × Metallic-Achsen |
| 03 | **Raytracer** | Analytischer Raytracer im Fragment-Shader – Reflexion, Refraktion, Schatten |
| 04 | **Path Tracer** | Monte-Carlo-Path-Tracer; WebGL: Alpha-Blending-Akkumulation, WebGPU: persistent RNG + HDR |

### Performance
Benchmarks die gezielt API-Overhead, Vertex-Throughput, Fragment-Last und Compute-Kapazität messen.

| # | Showcase | Inhalt |
|---|---|---|
| 05 | **Draw-Call Overhead** | N Objekte × 1 Draw-Call – CPU-seitiger API-Overhead im Vergleich |
| 06 | **Vertex Throughput** | Skalierbare UV-Kugel, GPU-Timestamps, Heavy-VS mit 8 sin/cos-Ops |
| 07 | **Multi-Light** | N Punktlichter im Fragment-Shader vs. Storage-Buffer-Loop |
| 08 | **N-Body Simulation** | O(N²) Gravitation – WebGL Fragment-Shader-Hack vs. WebGPU Compute |
| 09 | **Instanced Rendering** | 1 Draw-Call, N Instanzen via Storage Buffer / Instanz-Attribut |

### Compute
WebGPU-exklusive Compute-Shader-Demos ohne WebGL-Entsprechung.

| # | Showcase | Inhalt |
|---|---|---|
| 10 | **CNC-Abtragsimulation** | Z-Map-basierter Materialabtrag per Compute-Shader, MSAA-Rendering |

## Bedienung

- **Sidebar** – Showcase auswählen
- **WebGL2 / WebGPU** – API umschalten (sofern beide Varianten verfügbar)
- **File-Liste** – README.md, Shader-Quellen und main.ts direkt im Browser lesen
- **Orbit-Kamera** – Maus-Drag + Scroll in 3D-Szenen
- **GUI** – lil-gui-Panel oben rechts pro Showcase

## Technologie-Stack

- **Vite 8** + **TypeScript 7**
- **WebGL2** / **WebGPU** direkt (kein 3D-Framework wie Three.js oder Babylon.js)
- **lil-gui** · **gl-matrix** · **highlight.js** · **marked** · **stats.js**

## Benchmark-Methodik

### Messprinzip

Alle Performance-Showcases erfassen pro Frame **drei getrennte Zeit-Dimensionen**,
weil WebGL vs. WebGPU zwei verschiedene Geschichten hat — GPU-Durchsatz **und**
CPU-/API-Overhead:

1. **CPU-Zeit (Record+Submit)** — die Zeit, um die Frame-Kommandos zu erzeugen und
   abzuschicken (`performance.now()` um Uniform-Uploads + Command-Recording +
   Submit). Das erfasst Treiber-Validierung und JS→Native-Übergänge, also den
   **API-Overhead** — genau den Unterschied bei vielen Draw-Calls/Uniform-Uploads.
   GPU-Timestamps erfassen diesen Anteil **nicht**.
2. **GPU-Zeit (Timestamp-Query)** — die reine Ausführungszeit auf der GPU
   (WebGPU `timestamp-query`, WebGL2 `EXT_disjoint_timer_query_webgl2`),
   unabhängig von VSync/Compositor/Swapchain.
3. **Frame-Zeit (rAF-Delta)** — End-to-End inkl. Present; zwischen den APIs **nicht**
   vergleichbar, nur als Kontext.

Jedes Showcase legt über `primary` fest, welche Dimension die Headline-Metrik ist:
CPU-bound Showcases (05 Draw-Calls) → `cpu`, GPU-bound Showcases (06 Vertex,
08 N-Body, 09 Instancing) → `gpu`. Alle drei Werte stehen aber immer in der CSV,
sodass sich belegen lässt, *ob* ein Showcase CPU- oder GPU-bound ist.

Warmup und Messfenster sind **zeitbasiert** (nicht frame-basiert), damit beide
APIs trotz stark unterschiedlicher Frame-Zeiten gleich lange aufwärmen
(GPU-DVFS/Boost-Clocks) und gleich lange gemessen werden.

```typescript
const benchmark = new BenchmarkRun({ warmupMs: 800, measureMs: 3000, minFrames: 60, primary: "cpu" });
const gpuTimer  = new GpuTimer(device);       // bzw. new GlTimer(gl)
const cpuTimer  = new CpuTimer();
// ... pro Frame:
benchmark.sample(now, gpuTimer.takeSample() ?? undefined, cpuTimer.lastMs);
await benchmark.start(); // liefert Statistiken nach dem Messfenster
```

### Ausgegebene Metriken

| Metrik | Bedeutung |
|---|---|
| `metric` | Primärmetrik dieses Showcases: `cpu`, `gpu` oder `frame` (Fallback) |
| `Avg` | Arithmetischer Mittelwert der Primärmetrik |
| `Median` | Robuster Mittelwert (unempfindlich gegen Browser-Hitches) |
| `p95` | 95. Perzentil – wie schlecht können 5 % der Frames sein? |
| `Min / Max` | Extremwerte des Messfensters |
| `cpuMedMs` | Median der CPU-Zeit Record+Submit (API-Overhead) |
| `gpuMedMs` | Median der GPU-Ausführungszeit (Timestamp-Query) |
| `frameMedMs` | Median der Wall-Clock-Frame-Zeit (Kontext) |

### WebGL vs. WebGPU: Timing-Semantik

Der entscheidende Punkt für einen fairen Vergleich: **Frame-Zeit (rAF-Delta) misst
bei beiden APIs unterschiedliche Dinge** — WebGL läuft „fire-and-forget" (nur
CPU-Submit-Zeit), WebGPU wird über `getCurrentTexture()` durch die Swapchain
gedrosselt (Present-Stall). Deshalb ist die Frame-Zeit **nicht** als Vergleichs-
metrik geeignet.

Stattdessen werden CPU- und GPU-Zeit **getrennt** gemessen. Während eines
Benchmark-Laufs schaltet der Render-Loop in einen **serialisierten Modus** (pro
Frame wird die GPU voll gedrained), damit die GPU-Messung zuverlässig ein Sample
pro Frame liefert:

```
CPU-Phase:  record + submit  → cpuMs   (CpuTimer, performance.now)
GPU-Phase:  GPU-Ausführungszeit → gpuMs
  WebGPU: await queue.onSubmittedWorkDone()  → Wall-Clock-Wartezeit
  WebGL : Fence (clientWaitSync) als Drain, GPU-Zeit aus EXT_disjoint_timer_query (ns)
```

- **Wichtig (WebGL):** `gl.finish()` ist in Chrome praktisch ein No-Op und
  serialisiert **nicht** — deshalb ein echter Fence (`fenceSync` + `clientWaitSync`).
  Und weil GPU-Arbeit in WebGL mit dem CPU-Issue **überlappt**, würde eine
  Wall-Clock-Wartezeit ~0 ergeben; die echte GPU-Zeit kommt daher aus der
  **Disjoint-Timer-Query** (GPU-Nanosekunden), die nach dem Fence garantiert
  verfügbar ist.
- **Deterministisch:** Jede Iteration liefert genau **ein** CPU- und ein GPU-Sample —
  kein Pipeline-Lag und keine verlorenen Timestamp-Readbacks (das war der Grund,
  warum die asynchronen Timer bei Showcases mit nur einem Draw-Call fast keine
  GPU-Samples lieferten).
- **Present ausgeschlossen:** Durch das Drainen pro Frame findet der Swapchain-Present
  *zwischen* den Frames statt — außerhalb beider Messphasen.
- **Methodik-Hinweis:** WebGPU misst GPU-Wall-Clock (Exec + etwas Scheduling-Latenz),
  WebGL misst reine GPU-Exec (Timestamps). Für GPU-lastige Workloads sind beide
  vergleichbar; bei sehr kleiner GPU-Last kann WebGPU durch die Latenz-Untergrenze
  leicht höher wirken.

Außerhalb des Benchmarks (freies Rendern) bleibt der Loop unverändert; dort speisen
die asynchronen `GpuTimer`/`GlTimer` weiterhin die Live-Anzeige im GUI-Panel.

So zeigt z. B. Showcase 05, dass die vielen Draw-Calls **CPU-bound** sind
(`cpuMedMs` ≫ `gpuMedMs`), während Showcase 08 (N-Body) **GPU-bound** ist
(`gpuMedMs` ≫ `cpuMedMs`).

### Reproduzierbarkeit

VSync sollte deaktiviert und das Frame-Limit aufgehoben sein, damit der Render-Loop
frei läuft und genügend GPU-Timestamp-Samples pro Sekunde entstehen:

```
chrome --disable-frame-rate-limit --disable-gpu-vsync
```

Ohne diese Flags wird der Loop auf die Bildwiederholrate geklemmt; die
GPU-Zeit-Messung bleibt gültig, liefert aber weniger Samples pro Sekunde.
