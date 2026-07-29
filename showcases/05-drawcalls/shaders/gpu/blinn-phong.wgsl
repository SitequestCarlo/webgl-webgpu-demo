// =============================================================================
// blinn-phong.wgsl – Benchmark Shader (Showcase 05: Draw-Call Overhead, WebGPU)
//
// Dynamic Offsets: @group(1) @binding(0) mit hasDynamicOffset:true.
// Pro Draw-Call wird lediglich der Byte-Offset im Uniform-Buffer verschoben
// (kein neuer Buffer, kein neues BindGroup-Objekt).
//
// Uniform-Layout im Scene-Buffer:
//   Bytes  0–63: view (mat4)
//   Bytes 64–127: proj (mat4)
//   Bytes 128–143: lightPos (vec4)
//   Bytes 144–159: viewPos  (vec4)
//   Bytes 160–175: lightColor (vec4, w = ambient)
//   Bytes 176: shininess (f32)
// =============================================================================

struct Scene {
    view:       mat4x4<f32>,
    proj:       mat4x4<f32>,
    lightPos:   vec4<f32>,
    viewPos:    vec4<f32>,
    lightColor: vec4<f32>,  // w = ambient-Faktor
    shininess:  f32,
    _p:         vec3<f32>,  // Padding auf 16-Byte-Grenze
}

struct Draw {
    model:     mat4x4<f32>,
    normalMat: mat4x4<f32>,
    color:     vec4<f32>,
    _pad:      array<vec4<f32>, 7>,  // Auf 256 Bytes aufgefüllt (Dynamic-Offset)
}

@group(0) @binding(0) var<uniform> scene: Scene;
@group(1) @binding(0) var<uniform> draw:  Draw;  // Dynamic Offset → anderer Slot pro Objekt

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0)       wp:   vec3<f32>,  // Weltposition
    @location(1)       n:    vec3<f32>,  // Normale (Welt-Raum)
}

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
    let world = draw.model * vec4<f32>(pos, 1.0);
    var o: VsOut;
    o.clip = scene.proj * scene.view * world;
    o.wp   = world.xyz;
    o.n    = (draw.normalMat * vec4<f32>(norm, 0.0)).xyz;
    return o;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N = normalize(in.n);
    let L = normalize(scene.lightPos.xyz - in.wp);
    let V = normalize(scene.viewPos.xyz  - in.wp);
    let H = normalize(L + V);   // Half-Vector (Blinn-Phong)

    let diff = max(dot(N, L), 0.0);
    let spec = pow(max(dot(N, H), 0.0), scene.shininess);

    let col = scene.lightColor.w  * draw.color.xyz             // Ambient
            + diff * draw.color.xyz  * scene.lightColor.xyz    // Diffuse
            + spec * scene.lightColor.xyz;                     // Specular
    return vec4<f32>(col, 1.0);
}

