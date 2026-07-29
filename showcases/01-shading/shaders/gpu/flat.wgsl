// flat.wgsl – Flat Shading (WebGPU / WGSL)
// @interpolate(flat, first) → Provoking-Vertex-Farbe gilt für ganzes Dreieck.
struct Transform { model: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>, normalMat: mat4x4<f32> }
struct Material  { colorAmbient: vec4<f32>, lightPosShiny: vec4<f32>, viewPosToon: vec4<f32>, lightColorRough: vec4<f32>, metallic: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(0) var<uniform> tfm: Transform;
@group(0) @binding(1) var<uniform> mtl: Material;

fn blinnPhong(N: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
    let L = normalize(mtl.lightPosShiny.xyz - worldPos);
    let V = normalize(mtl.viewPosToon.xyz   - worldPos);
    let H = normalize(L + V);
    let diff = max(dot(N, L), 0.0);
    let spec = pow(max(dot(N, H), 0.0), mtl.lightPosShiny.w);
    return mtl.colorAmbient.w * mtl.colorAmbient.xyz
         + diff * mtl.colorAmbient.xyz * mtl.lightColorRough.xyz
         + spec * mtl.lightColorRough.xyz;
}

struct VsOutFlat {
    @builtin(position) clip: vec4<f32>,
    @location(0) @interpolate(flat, first) color: vec3<f32>,  // kein Blend!
}

@vertex fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOutFlat {
    let world = tfm.model * vec4<f32>(pos, 1.0);
    let N     = normalize((tfm.normalMat * vec4<f32>(norm, 0.0)).xyz);
    var o: VsOutFlat;
    o.clip  = tfm.proj * tfm.view * world;
    o.color = blinnPhong(N, world.xyz);   // Beleuchtung pro Vertex
    return o;
}

@fragment fn fs_main(in: VsOutFlat) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);       // Provoking-Vertex-Farbe für ganzes Dreieck
}
