# Monte-Carlo Path Tracer

Offene Szene mit Himmels-Umgebungslicht. Zeigt **indirekte Beleuchtung** und **Farbbluten** —
Effekte die mit klassischem Raytracing oder Rasterization nicht direkt möglich sind.

## Was ist Path Tracing?

Path Tracing löst die Rendering-Gleichung über **Monte-Carlo-Integration**:
Statt einem deterministischen Strahl werden zufällige Strahlen in der Halbkugel
über der Oberfläche verfolgt.

### Kosinus-gewichtete Halbkugel-Stichprobe

$$\text{PDF} = \frac{\cos\theta}{\pi} \qquad \text{Lambert-BRDF} = \frac{\text{Albedo}}{\pi}$$

Das Gewicht des Samples ist immer `Albedo` (die π-Terme kürzen sich heraus):

```glsl
vec3 cosineSample(vec3 N) {
    float phi = 6.28318 * rand();
    float sq  = sqrt(rand());
    // Tangenten-Rahmen aufbauen und Richtung konstruieren
    return sq * (cos(phi)*T + sin(phi)*B) + sqrt(1.0 - sq*sq) * N;
}
```

## Was zeigt die Szene?

- **Rote linke Wand** und **grüne rechte Wand** — Farbbluten auf Boden und Rückwand sichtbar
- **Zwei Boxen** — weiche Schatten durch indirekte Beleuchtung
- **Progressive Qualität** — das Bild konvergiert mit jedem Frame

## WebGL vs. WebGPU

| | WebGL2 | WebGPU |
|---|---|---|
| Akkumulation | `preserveDrawingBuffer` + Alpha-Blending | **Storage Buffer** (HDR) |
| Max. Bounces | **2** (ANGLE/D3D11-Limit) | **1–16** (wählbar im GUI) |
| RNG | Hash pro Frame (stateless) | **Xorshift32** persistenter Zustand pro Pixel |
| Tone-Mapping | Vor der Akkumulation (LDR-Bias) | Nach der Akkumulation (korrekt) |

> **Hinweis:** Die unterschiedliche Helligkeit ist beabsichtigt. WebGPU akkumuliert HDR-Werte vor
> dem Tone-Mapping (physikalisch korrekt). WebGL akkumuliert LDR — ein struktureller Nachteil.

Die Kamera orbitiert per **Maus-Drag**. Bei jeder Bewegung wird die Akkumulation zurückgesetzt.
