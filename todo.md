# Thesis Demo – Offene Aufgaben

## Infrastruktur
- [x] Projekt-Setup (Vite, TypeScript, lil-gui, stats.js, gl-matrix)
- [x] `src/shared/gl.ts` – WebGL2-Helfer
- [x] `src/shared/geometry.ts` – Dreieck, UV-Kugel
- [x] `src/shared/benchmark.ts` – FPS-Panel, BenchmarkRun
- [ ] `src/shared/webgpu.ts` – WebGPU-Helfer (Adapter, Device, Buffer, Resize)
- [ ] `@webgpu/types` installieren + tsconfig erweitern

## 01 · Shading-Modelle
- [x] `showcases/01-shading/` WebGL2-Version
  - [x] none, flat, gouraud, phong, blinn-phong, toon, pbr
  - [x] Split-Viewport (Dreieck links, Kugel rechts)
  - [x] lil-gui, stats.js, Benchmark, Screenshot
- [ ] `showcases/01-shading/webgpu/` WebGPU-Version
  - [ ] WGSL-Shader für alle 7 Modi
  - [ ] Render-Pipeline pro Modus
  - [ ] Gleiche GUI + Benchmark wie WebGL
  - [ ] Link WebGL ↔ WebGPU in beiden Seiten

## 02 · PBR Material-Grid
- [x] `showcases/02-pbr/` WebGL2-Version
  - [x] Cook-Torrance BRDF (GGX/Schlick)
  - [x] 6×6 Materialkugeln (Roughness × Metallic)
  - [x] Achsenbeschriftung (2D-Canvas-Overlay)
  - [x] lil-gui, Benchmark, Screenshot
- [ ] `showcases/02-pbr/webgpu/` WebGPU-Version
  - [ ] WGSL Cook-Torrance Shader
  - [ ] Storage Buffer + Instanced Rendering (alle 36 Kugeln in einem Draw-Call)
  - [ ] Gleiche Achsenbeschriftung + GUI

## 03 · Raytracer
- [ ] `showcases/03-raytracer/index.html` – Hub (Links zu WebGL + WebGPU)
- [ ] `showcases/03-raytracer/webgl/` – Fragment-Shader-Raytracer
  - [ ] Analytische Szene: Bodenebene + 3 Kugeln (diffus, Spiegel, Glas)
  - [ ] Iterativer Bounce-Loop (kein Recursion in GLSL ES)
  - [ ] Reflexion (reflect), Refraktion (Snell + Schlick-Fresnel), Schatten
  - [ ] Fullscreen-Quad, GUI (Szene-Parameter), Benchmark
- [ ] `showcases/03-raytracer/webgpu/` – Compute-Shader-Raytracer
  - [ ] Gleiche Szene, mehr Bounces (kein Fragment-Shader-Limit)
  - [ ] Frame-Akkumulation (progressive Anti-Aliasing)
  - [ ] Storage-Buffer für Akkumulations-Puffer
  - [ ] Compute-Pass → Blit-Pass (Fullscreen-Quad mit Tone-Mapping)
  - [ ] Benchmark: Vergleich mit WebGL-Version

## Landing Page
- [x] Showcase 01 verlinkt
- [x] Showcase 02 verlinkt
- [ ] Showcase 03 verlinkt (mit WebGL/WebGPU-Tag)
- [ ] WebGPU-Badges für 01 + 02 ergänzen

## Bekannte Einschränkungen / Notizen
- WebGPU braucht sicheren Kontext (HTTPS oder localhost)
- `@interpolate(flat, first)` in WGSL ≈ Provoking-Vertex in WebGL (nicht identisch)
- WebGPU Compute Raytracer kann Frame-akkumulieren; WebGL kann nicht ohne
  Ping-Pong-Framebuffer (bewusste Asymmetrie für Thesis-Vergleich)
