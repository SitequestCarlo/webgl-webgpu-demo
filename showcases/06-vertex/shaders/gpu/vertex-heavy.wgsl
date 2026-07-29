// =============================================================================
// vertex-heavy.wgsl – Heavy Vertex Shader: 8 sin/cos-Ops pro Vertex (WebGPU, Showcase 06)
//
// Skalare Akkumulation identisch zu vertex-heavy.glsl → fairer WebGL/WebGPU-Vergleich.
// Erhöht die Vertex-ALU-Last, damit der Benchmark eindeutig vertex-bound ist (und die
// GPU zuverlässig auf Boost-Takt hochfährt).
// =============================================================================

struct Scene {
    view:       mat4x4<f32>,
    proj:       mat4x4<f32>,
    lightPos:   vec4<f32>,
    viewPos:    vec4<f32>,
    lightColor: vec4<f32>,  // w = ambient
    shininess:  f32,
    _p:         vec3<f32>,  // Padding
}
struct Draw {
    model:     mat4x4<f32>,
    normalMat: mat4x4<f32>,
    color:     vec4<f32>,
    _pad:      array<vec4<f32>, 7>,
}

@group(0) @binding(0) var<uniform> scene: Scene;
@group(1) @binding(0) var<uniform> draw:  Draw;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0)       wp:   vec3<f32>,  // Weltposition
    @location(1)       n:    vec3<f32>,  // Normale
}

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
    // 8 sin/cos-Iterationen pro Vertex – simuliert teure Vertex-Arbeit (z. B. Skinning).
    var d: f32 = 0.0;
    for (var i: i32 = 0; i < 8; i = i + 1) {
        let fi = f32(i + 1);
        d = d + sin(pos.x * fi) * cos(pos.y * fi) * sin(pos.z * fi) * 0.02;
    }
    let p = pos + norm * d;
    let w = draw.model * vec4<f32>(p, 1.0);
    var o: VsOut;
    o.clip = scene.proj * scene.view * w;
    o.wp   = w.xyz;
    o.n    = (draw.normalMat * vec4<f32>(norm, 0.0)).xyz;
    return o;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N    = normalize(in.n);
    let L    = normalize(scene.lightPos.xyz - in.wp);
    let V    = normalize(scene.viewPos.xyz  - in.wp);
    let H    = normalize(L + V);
    let diff = max(dot(N, L), 0.0);
    let spec = pow(max(dot(N, H), 0.0), scene.shininess);
    let col  = scene.lightColor.w  * draw.color.xyz
             + diff * draw.color.xyz * scene.lightColor.xyz
             + spec * scene.lightColor.xyz;
    return vec4<f32>(col, 1.0);
}
