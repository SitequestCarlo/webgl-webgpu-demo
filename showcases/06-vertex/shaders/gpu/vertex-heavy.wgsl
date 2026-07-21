// =============================================================================
// vertex-heavy.wgsl – Heavy Vertex Shader (WebGPU, Showcase 06)
//
// 8 sin/cos-Operationen pro Vertex simulieren teure Displacement-Berechnungen
// (z.B. Skinning, Morph Targets, prozedurale Animation).
// Ab hoher Vertexanzahl wird die GPU vertex-bound → messbar höhere GPU-Zeit.
// =============================================================================

struct Scene {
    view:       mat4x4<f32>,
    proj:       mat4x4<f32>,
    lightPos:   vec4<f32>,
    viewPos:    vec4<f32>,
    lightColor: vec4<f32>,  // w = ambient
    shininess:  f32,
    _p:         vec3<f32>,
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
    @location(0)       wp:   vec3<f32>,
    @location(1)       n:    vec3<f32>,
}

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
    // Teure Displacement-Berechnung: 8 sin/cos-Paare über alle Achsen.
    // Skalare Akkumulation identisch zur GLSL-Variante → fairer API-Vergleich.
    var d = 0.0;
    for (var i = 0u; i < 8u; i++) {
        let fi = f32(i + 1u);
        d += sin(pos.x * fi) * cos(pos.y * fi) * sin(pos.z * fi) * 0.02;
    }
    let dpos = pos + norm * d;
    let world = draw.model * vec4<f32>(dpos, 1.0);
    var o: VsOut;
    o.clip = scene.proj * scene.view * world;
    o.wp   = world.xyz;
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

