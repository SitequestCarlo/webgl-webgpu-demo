# Vertex Throughput

Eine UV-Kugel mit skalierender Polygonanzahl (**10k–4M Dreiecke**).
Misst den GPU-seitigen Vertex-Shader-Durchsatz.

## Kernaussage

Beide APIs liefern **identischen Durchsatz** — die Grenze ist die GPU-Hardware, nicht die API.
Dies ist eine zentrale Aussage der Thesis:

> Der Vertex-Throughput ist hardware-limitiert. API-Overhead zeigt sich erst bei
> der Command-Submission (→ Showcase 05), nicht bei der GPU-Berechnung selbst.

## Heavy VS Modus

8 zusätzliche `sin/cos`-Operationen pro Vertex simulieren teure Berechnungen (z.B. Skinning):

```glsl
for (int i = 0; i < 8; i++) {
    float fi = float(i + 1);
    pos += normal * sin(pos.x*fi) * cos(pos.y*fi) * sin(pos.z*fi) * 0.02;
}
```

Ab ~1M Dreiecken mit Heavy VS wird die GPU **vertex-bound** — die GPU-Zeit steigt sichtbar.

## GPU-Timing (Live-Anzeige im GUI)

| API | Methode | Genauigkeit |
|---|---|---|
| WebGL2 | `gl.finish()` nach `drawElements()` | ~1ms |
| WebGPU | `timestamp-query` Feature | ~0.001ms (ns) |

Da WebGL `gl.finish()` vor `benchmark.sample()` aufruft, spiegelt die gemessene
Frame-Zeit die echte GPU-Zeit wider. Weitere Details zur Messmethodik im
[Projekt-README](../../README.md#benchmark-methodik).
