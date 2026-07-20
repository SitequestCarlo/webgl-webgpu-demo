# N-Body Simulation

Gravitative Wechselwirkung zwischen N Partikeln: **O(N²)** Kraftberechnungen pro Frame.
Der drastischste Leistungsunterschied aller Showcases.

## Algorithmus

Für jedes Partikel `i` wird die Gravitationskraft von **allen anderen Partikeln** berechnet:

$$\vec{F}_{ij} = G \cdot m_j \cdot \frac{\vec{r}_{ij}}{|\vec{r}_{ij}|^3 + \epsilon^3}$$

Der Softening-Parameter `ε` verhindert Division durch Null bei nahen Partikeln.

## WebGL: Texture-Ping-Pong (Fragment-Shader als Compute-Hack)

Da WebGL2 keine Compute-Shader hat, wird die Simulation im Fragment-Shader durchgeführt:

```glsl
// N Textur-Fetches pro Fragment = O(N²) Textur-Operationen
for (int i = 0; i < N; i++) {
    vec2 uv = (vec2(i % texW, i / texW) + 0.5) / texSize;
    vec4 other = texture(uPos, uv);  // Textur-Fetch für jeden Partikel
    vec3 d = other.xyz - pos.xyz;
    acc += d * (other.w * inversesqrt(dot(d,d) + epsilon*epsilon));
}
```

**Limit:** N ≤ 512 praktikabel (Fragment-Shader-Bottleneck).

## WebGPU: Echter Compute-Shader

```wgsl
override N: u32 = 256u;  // Pipeline-Override-Konstante, gesetzt via constants:{N:n}

@compute @workgroup_size(64)  // 64 Threads parallel
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    for (var j = 0u; j < N; j++) {  // N ist Compile-time-Konstante
        // Direkter Storage-Buffer-Zugriff (kein Textur-Overhead)
        let d = inBuf[j].pos.xyz - inBuf[i].pos.xyz;
        acc += d * (inBuf[j].pos.w * inverseSqrt(dot(d,d) + s*s));
    }
}
```

**Limit:** N = 4096+ interaktiv möglich.

## Fairness des Vergleichs

WebGL kompiliert den Simulations-Shader für jeden N-Wert neu (`#define N` wird ersetzt),
wodurch die Schleifengrenze zur Übersetzungszeit bekannt ist und der Compiler Loop-Unrolling
sowie aggressiveres Instruction-Scheduling anwenden kann.

Damit der WebGPU-Compute-Shader unter denselben Bedingungen antritt, nutzt diese
Implementierung eine **Pipeline-Override-Konstante** ([WebGPU Spec §10.3.1.2](https://www.w3.org/TR/webgpu/#dom-gpudevice-createcomputepipeline)):

```typescript
// In rebuild(n) – wird bei jedem N-Wechsel aufgerufen:
computePipeline = device.createComputePipeline({
  compute: { module: computeShaderModule, entryPoint: "main", constants: { N: n } },
});
```

Dawn (Chrome's WebGPU-Backend) spezialisiert die Pipeline pro N-Wert – äquivalent
zur Shader-Neukompilierung in WebGL. Ein naiver Ansatz (N als `var<uniform>`) würde
diesen Vorteil unberücksichtigt lassen und den Vergleich verzerren.

> Zur allgemeinen Messmethodik (BenchmarkRun, VSync-Anforderung, Timing-Semantik)
> siehe das [Projekt-README](../../README.md#benchmark-methodik).
