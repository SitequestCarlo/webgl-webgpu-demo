# Shading-Modelle im Vergleich

Dreieck (links) und tessellierte Kugel (rechts) — 7 umschaltbare Beleuchtungsmodelle auf einer geteilten Canvas.

## Implementierte Modi

| Modus | Beleuchtung | Besonderheit |
|---|---|---|
| **None** | Keine | Reine Basisfarbe, kein Shader-Overhead |
| **Flat** | Pro Vertex | `flat`-Qualifier: Provoking-Vertex-Farbe für das ganze Dreieck |
| **Gouraud** | Pro Vertex | Farbe glatt interpoliert → sichtbare Artefakte bei groben Meshes |
| **Phong** | Pro Fragment | Specular via **Reflect-Vektor** `R = reflect(-L, N)` |
| **Blinn-Phong** | Pro Fragment | Specular via **Half-Vector** `H = normalize(L + V)` — heute Standard |
| **Toon** | Pro Fragment | Quantisierte Stufen + Silhouetten-Rim via `dot(N, V) < 0.25` |
| **PBR** | Pro Fragment | Cook-Torrance BRDF: GGX · Schlick-Smith · Schlick-Fresnel |

## Phong vs. Blinn-Phong

Der einzige Unterschied liegt im Specular-Term:

```glsl
// Phong (klassisch): Reflect-Vektor
vec3 R = reflect(-L, N);
float spec = pow(max(dot(R, V), 0.0), shininess);

// Blinn-Phong (moderner Standard): Half-Vector
vec3 H = normalize(L + V);
float spec = pow(max(dot(N, H), 0.0), shininess);
```

Blinn-Phong ist stabiler bei streifendem Licht und heute in allen Echtzeit-Engines Standard.

## WebGL vs. WebGPU

Beide APIs compilieren **7 separate Shader-Programme** (ein Programm pro Modus).
In WebGPU ist der Pipeline-Switch effizienter, da Pipelines explizit verwaltet werden.

Die Shader-Quellen sind in `shaders/gl/*.glsl` bzw. `shaders/gpu/*.wgsl` zu finden.
