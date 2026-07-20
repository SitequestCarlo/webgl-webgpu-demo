# Fragment-Last / Multi-Light

**N Punkt-Lichtquellen (8–1024)** mit Blinn-Phong pro Fragment.
Misst Fragment-Shader-Durchsatz und zeigt eine strukturelle API-Limitation von WebGL.

## Der Loop im Fragment-Shader

```glsl
for (int i = 0; i < numLights; i++) {
    vec3 L   = normalize(lightPos[i] - worldPos);
    float att = 1.0 / (1.0 + 0.09*d + 0.032*d*d);  // Attenuation
    col += att * (diffuse + specular) * lightColor[i];
}
```

## WebGL-Einschränkung: Compile-Zeit-Konstante

In WebGL muss `MAX_LIGHTS` beim Shader-Compile bekannt sein:

```glsl
#define MAX_LIGHTS 1024
uniform vec3 uLightPos[MAX_LIGHTS];   // Feste Array-Größe!
```

Der Shader wird **einmalig** mit dieser Größe kompiliert; die tatsächliche Lichtanzahl
wird zur Laufzeit über ein `uniform int uNumLights` gesteuert. Die Array-Deklaration
im Shader muss aber die **maximale** Anzahl reservieren — ungenutzte Einträge
verbrauchen trotzdem Uniform-Speicher.

Weitere Konsequenzen dieser Einschränkung:
- Änderung von `MAX_LIGHTS` erfordert Shader-Neukompilierung (teuer, sichtbare Pause)
- Uniform Arrays sind auf `gl.MAX_FRAGMENT_UNIFORM_VECTORS` limitiert
  (WebGL2-Minimum: 224 vec4; Implementierungen bieten oft 4096+)
- Werte über 1024 wären möglicherweise nicht portabel

## WebGPU-Vorteil: Storage Buffer

```wgsl
// Dynamische Array-Größe zur Laufzeit — kein Compile-Zeit-Limit
@group(0) @binding(1)
var<storage, read> lights: array<Light>;  // Größe durch Buffer-Binding bestimmt

for (var i = 0u; i < scene.numLights; i++) { ... }
```

Der Storage Buffer wächst einfach mit der Lichtanzahl; kein Shader-Rebuild nötig.
Die maximale Größe ist nur durch VRAM begrenzt (nicht durch Uniform-Slots).

Storage Buffer können außerdem von Compute-Shadern beschrieben werden — die Basis für
GPU-seitige Lichtverwaltung (z. B. Tiled/Clustered Shading), die in WebGL mangels
Compute-Shadern nicht möglich ist.

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

> Zur allgemeinen Messmethodik (BenchmarkRun, VSync-Anforderung, Timing-Semantik)
> siehe das [Projekt-README](../../README.md#benchmark-methodik).
