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

- **Vite 5** + **TypeScript 5** (Multi-Page-App, `?raw`-Imports für Shader)
- **WebGL2** / **WebGPU** direkt (kein 3D-Framework)
- **lil-gui** · **gl-matrix** · **highlight.js** · **marked**
