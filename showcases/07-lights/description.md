# Fragment-Last / Multi-Light

**N Punkt-Lichtquellen (8–256)** mit Blinn-Phong pro Fragment.
Misst Fragment-Shader-Durchsatz.

## Der Loop im Fragment-Shader

```glsl
for (int i = 0; i < numLights; i++) {
    vec3 L   = normalize(lightPos[i] - worldPos);
    float att = 1.0 / (1.0 + 0.09*d + 0.032*d*d);  // Attenuation
    col += att * (diffuse + specular) * lightColor[i];
}
```
## Wissenschaftliche Einordnung

Dieser Showcase illustriert einen **strukturellen Unterschied** zwischen den APIs,
nicht nur einen Performance-Unterschied:

| | WebGL | WebGPU |
|---|---|---|
| Lichtarray-Größe | Compile-Zeit-Konstante (`#define`) | Laufzeit-dynamisch |
| Shader bei N-Änderung | Neukompilierung nötig | Kein Rebuild, nur Buffer-Update |
| Größenlimit | `MAX_FRAGMENT_UNIFORM_VECTORS` | VRAM |
| GPU-Lichtverwaltung | Nicht möglich (kein Compute) | Möglich via Compute-Shader |

Die **Laufzeit-Performance** beider APIs ist beim gleichen N vergleichbar
(gleiche Shader-Math), aber WebGL erfordert mehr Entwicklungsaufwand bei
dynamischen Lichtszenarien.

## Benchmark-Reichweite und Vergleichbarkeit

Der Benchmark deckt N = 8–256 ab — den Bereich, in dem **beide APIs identisch
arbeiten**: gleiche Datenmenge pro Licht (2× `vec3`: Position + RGB-Farbe), gleiche
Shader-Operationen pro Fragment, gleiche Geometrie.

Eine Erweiterung auf N > 256 für WebGL würde eine Datenpaket-Änderung erfordern (z. B. Position und Farbe in eine einzelne `vec4` pro Licht kodieren), was den Workload verändert und den Vergleich verzerren würde. WebGPU kann ohne Code-Änderung bis in den Tausender-Bereich skalieren — diese Flexibilität ist das eigentliche
Ergebnis, das über die Performance-Messung hinausgeht.

> Zur allgemeinen Messmethodik (BenchmarkRun, VSync-Anforderung, Timing-Semantik)
> siehe das [Projekt-README](../../README.md#benchmark-methodik).
