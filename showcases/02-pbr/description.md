# PBR Material-Grid

Ein 6×6-Grid aus Kugeln mit variierendem **Roughness** (X-Achse, 0.05–1.0) und **Metallic** (Y-Achse, 0–1).
Zeigt den vollständigen Parameterraum des Cook-Torrance BRDF.

## Cook-Torrance BRDF

$$L_o = \frac{D \cdot G \cdot F}{4 \cdot (N \cdot V) \cdot (N \cdot L)} \cdot L_i \cdot (N \cdot L)$$

| Komponente | Funktion | Implementierung |
|---|---|---|
| **D** | Normal Distribution | GGX / Trowbridge-Reitz |
| **G** | Geometry Masking | Schlick-Smith |
| **F** | Fresnel | Schlick Approximation |

### F₀ (Basisreflektivität)

```glsl
vec3 F0 = mix(vec3(0.04), albedo, metallic);
// Dielektrikum (metallic=0): F0 = 0.04 (grau)
// Metall (metallic=1):       F0 = Albedo-Farbe
```

## WebGL vs. WebGPU

| | WebGL2 | WebGPU |
|---|---|---|
| Draw-Calls | **36 separate** Draw-Calls | **1 Draw-Call** |
| Per-Instanz-Daten | 36× `uniformMatrix4fv` | Storage Buffer + `@builtin(instance_index)` |

Das WebGPU-Beispiel demonstriert **Instanced Rendering**: alle 36 Kugeln mit einem einzigen
`drawIndexed(indexCount, 36)`. Die per-Kugel-Daten (Roughness, Metallic, Model-Matrix) werden
aus einem Storage Buffer gelesen.
