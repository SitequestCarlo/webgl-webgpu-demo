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

## GPU-Timing

| API | Methode | Genauigkeit |
|---|---|---|
| WebGL2 | `gl.finish()` nach `drawElements()` | ~1ms |
| WebGPU | `timestamp-query` Feature | ~0.001ms (ns) |

Die `timestamp-query` Methode ist asynchron und blockiert den Render-Loop nicht.

## Messung

Die Messung erfolgt manuell über den GUI-Button **„Benchmark starten"** für den
aktuell eingestellten Parameter (Warmup + feste Anzahl Mess-Frames). Das Ergebnis
erscheint als Overlay; ausgewertet werden u.a. Median und p95 der Frametimes.

### Reproduzierbarkeit

Die `requestAnimationFrame`-Frametime ist nur unter **deaktiviertem VSync und
aufgehobenem Frame-Limit** aussagekräftig, sonst werden Zeiten unter 8,33 ms
(120 Hz) auf die Bildwiederholrate geklemmt. Getestet mit Chrome unter
`--disable-frame-rate-limit --disable-gpu-vsync`.
