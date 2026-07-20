# Fragment-Last / Multi-Light

**N Punkt-Lichtquellen (1–256)** mit Blinn-Phong pro Fragment.
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
#define MAX_LIGHTS 256
uniform vec3 uLightPos[MAX_LIGHTS];   // Feste Array-Größe!
```

Eine dynamische Lichtanzahl ohne Shader-Rebuild ist nicht möglich.

## WebGPU-Vorteil: Storage Buffer

```wgsl
// Dynamische Array-Größe zur Laufzeit
@group(0) @binding(1)
var<storage, read> lights: array<Light>;  // Keine Größenbegrenzung!

for (var i = 0u; i < scene.numLights; i++) { ... }
```

Storage Buffer können auch von Compute-Shadern beschrieben werden — die Basis für
GPU-seitige Lichtverwaltung (z.B. Clustered Shading).

> Zur allgemeinen Messmethodik (BenchmarkRun, VSync-Anforderung, Timing-Semantik)
> siehe das [Projekt-README](../../README.md#benchmark-methodik).
