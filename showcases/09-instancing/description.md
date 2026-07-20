# Instanced Rendering

**1 Draw-Call, N Instanzen (1k–500k)**. Vergleicht die Instancing-Mechanismen beider APIs.

## WebGL: Vertex-Buffer Divisor

Per-Instanz-Daten liegen in einem zweiten Vertex-Buffer mit `divisor = 1`:

```typescript
// Setup: zweiter Buffer für Instanz-Daten
gl.enableVertexAttribArray(2);
gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 0);
gl.vertexAttribDivisor(2, 1);  // 1 Wert pro Instanz

// Draw: alle N Instanzen in einem Call
gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_INT, 0, N);
```

Im Shader: Instanz-Daten kommen als Vertex-Attribute:

```glsl
layout(location=2) in vec3 aInstPos;    // per instance
layout(location=3) in vec3 aInstColor;  // per instance
```

## WebGPU: Storage Buffer + instance_index

Per-Instanz-Daten kommen aus einem Storage Buffer:

```wgsl
@group(0) @binding(1)
var<storage, read> instances: array<InstanceData>;

@vertex fn vs(
    @location(0) pos: vec3<f32>,
    @builtin(instance_index) inst: u32,  // Welche Instanz?
) -> VsOut {
    let d = instances[inst];  // Direkter Buffer-Zugriff
    ...
}

// Draw
pass.drawIndexed(indexCount, N);  // N = Anzahl Instanzen
```

## Wichtiger Vorteil von WebGPU

Der Storage Buffer kann auch von **Compute-Shadern** beschrieben werden.
Das ermöglicht GPU-seitige Partikel-Simulation ohne CPU-Roundtrip:

> Zur allgemeinen Messmethodik (BenchmarkRun, VSync-Anforderung, Timing-Semantik)
> siehe das [Projekt-README](../../README.md#benchmark-methodik).
