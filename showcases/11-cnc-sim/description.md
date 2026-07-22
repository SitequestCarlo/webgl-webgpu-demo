# 11 · CNC-Abtragsimulation

**WebGPU Compute** – Echtzeit-Materialabtrag via Z-Map (Dexel-Verfahren).

## Algorithmus

Eine **256×256 Z-Map** (Storage Buffer) speichert für jeden Oberflächenpixel die aktuelle Materialhöhe. Pro Werkzeugschritt aktualisiert ein **Compute-Shader** den betroffenen Bereich:

- **Flachfräser** (`toolType=0`): Abtrag auf konstante Schnitttiefe `cut_z`
- **Kugelkopffräser** (`toolType=1`): Sphärischer Abtrag, Offset = `r − √(r²−d²)`

Der Dispatch ist auf den **AABB-Fußabdruck** des Werkzeugs begrenzt → nur die tatsächlich betroffenen Pixel werden berechnet.

## Rendering

Das Höhenfeld wird mit zwei Render-Pässen visualisiert:

| Pass | Entry Point | Geometrie |
|---|---|---|
| **Deckel** | `vs_surface` | N×N Vertex-Gitter, Normale per Gradienten-Finite-Differenzen |
| **Schürze** | `vs_skirt` | 4×(N−1) vertikale Quads am Rand |

Farbe: **beiges Rohteil** (height ≈ 1.0) → **silbrig gefräst** (height < 0.9). Licht: Hemisphere + Blinn-Phong + Specular. MSAA 4×.

## WebGPU-Vorteile

- **Compute → Storage → Render** in einem Frame ohne CPU-Readback
- Dynamic Offsets für per-Schritt-Uniforms (keine Bind-Group-Wechsel)
- Kein WebGL-Äquivalent: GLSL ES 3.00 hat keinen Compute-Shader
