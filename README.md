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

Alle Performance-Showcases nutzen denselben `BenchmarkRun`-Mechanismus:
`requestAnimationFrame`-Callbacks werden über eine feste Anzahl Frames gesammelt
(nach einer Warmup-Phase) und zu einem Ergebnis aggregiert. Gemessen wird die
**Frame-Zeit** (Wall-Clock-Delta zwischen Callbacks), nicht eine isolierte GPU-Zeit.

```typescript
benchmark.sample(now);   // in jedem Render-Frame aufgerufen
await benchmark.start(); // liefert Statistiken nach measureFrames Frames
```

### Ausgegebene Metriken

| Metrik | Bedeutung |
|---|---|
| `Avg` | Arithmetischer Mittelwert aller Frametimes |
| `Median` | Robuster Mittelwert (unempfindlich gegen Browser-Hitches) |
| `p95` | 95. Perzentil – wie schlecht können 5 % der Frames sein? |
| `Min / Max` | Extremwerte des Messfensters |

### WebGL vs. WebGPU: Timing-Semantik

**WebGL** ruft in Showcase **06** (Vertex Throughput) `gl.finish()` **vor**
`benchmark.sample()` auf, weil dort der GPU-Durchsatz das Messziel ist — ohne
Synchronisation würde nur die Submission-Zeit (~0,1 ms konstant) gemessen, nicht
die echte Renderarbeit. Showcase **05** (Draw-Call Overhead) verzichtet dagegen
bewusst auf `gl.finish()`, weil dort die CPU-seitige API-Overhead-Zeit das Messziel ist.

**WebGPU** hat keinen äquivalenten synchronen Block im Render-Loop. Die gemessene
Frame-Zeit enthält GPU-Arbeit + Swapchain-Backpressure + Compositor-Latenz. Der
Live-Timer im GUI-Panel nutzt asynchrone `timestamp-query`-Abfragen für präzisere
GPU-Werte, diese fließen aber nicht in den `BenchmarkRun` ein.

### Reproduzierbarkeit

Die Messung basiert auf `requestAnimationFrame`. Damit Frametimes unter **8,33 ms
(120 Hz)** überhaupt messbar sind, muss VSync deaktiviert und das Frame-Limit
aufgehoben sein:

```
chrome --disable-frame-rate-limit --disable-gpu-vsync
```

Ohne diese Flags werden schnelle Frames auf die Bildwiederholrate der GPU geklemmt
und alle Messungen sind nur innerhalb eines Bildschirm-Intervalls (8,33/16,67 ms)
unterscheidbar.
