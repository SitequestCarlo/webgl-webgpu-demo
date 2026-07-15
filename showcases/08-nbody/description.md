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
@compute @workgroup_size(64)  // 64 Threads parallel
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    for (var j = 0u; j < uN; j++) {
        // Direkter Storage-Buffer-Zugriff (kein Textur-Overhead)
        let d = inBuf[j].pos.xyz - inBuf[i].pos.xyz;
        acc += d * (inBuf[j].pos.w * inverseSqrt(dot(d,d) + s*s));
    }
}
```

**Limit:** N = 4096+ interaktiv möglich.
