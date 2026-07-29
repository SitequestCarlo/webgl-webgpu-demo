# Analytischer Raytracer

Drei Kugeln (diffus, Spiegel, Glas IOR=1.5) auf einem Schachbrett-Boden.
Demonstriert Effekte die mit Rasterization nicht direkt möglich sind.

## Effekte

- **Exakte Reflexionen** — kein Cube-Map-Hack, exakte Spiegelgeometrie
- **Physikalische Refraktion** — Snell'sches Gesetz + Schlick-Fresnel für Total-Reflexion
- **Harte Schatten** — Shadow-Rays direkt zur Lichtquelle
- **Korrekte Tiefen** — Glas-Kugel bricht den Blick auf den Hintergrund

## Algorithmus

Der Raytracer läuft in einem **iterativen Bounce-Loop** (kein Recursion in GLSL ES 300):

```glsl
for (int bounce = 0; bounce < 7; bounce++) {
    Hit h = sceneHit(ro, rd);
    if (h.t >= INF) { color += throughput * sky(rd); break; }
    
    if (h.mat == MIRROR)  { rd = reflect(rd, N); }
    if (h.mat == GLASS)   { rd = refract(rd, N, ior); }
    if (h.mat == DIFFUSE) { color += directLight(pos, N); break; }
}
```

## Refraktion: Snell + Schlick-Fresnel

```glsl
float ior = inside ? 1.5 : (1.0 / 1.5);  // Eintreten vs. Austreten
float fr  = schlick(cosI, ior);            // Fresnel-Anteil
vec3 refr = refract(rd, N, ior);           // GLSL built-in

if (fr > 0.95 || length(refr) < 0.001)
    rd = reflect(rd, N);  // Total-Reflexion
else
    rd = normalize(refr);
```

## WebGL vs. WebGPU

| | WebGL2 | WebGPU |
|---|---|---|
| Shader-Typ | **Fragment-Shader** | **Compute-Shader** |
| Anti-Aliasing | Kein | **Progressiv** (Jitter + Frame-Akkumulation) |
| RNG | Hash-basiert (stateless) | **Persistenter Xorshift32** pro Pixel |

Die Kamera lässt sich per **Maus-Drag** orbitieren, Scroll = Zoom.
