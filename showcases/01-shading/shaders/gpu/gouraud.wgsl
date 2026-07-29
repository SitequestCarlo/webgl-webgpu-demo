// =============================================================================
// gouraud.wgsl – Gouraud Shading (WebGPU / WGSL)
//
// Blinn-Phong-Beleuchtung wird PRO VERTEX berechnet und anschließend
// smooth interpoliert (kein flat-Qualifier). Bei groben Meshes entstehen
// Artefakte, da Highlights zwischen Vertices verloren gehen können.
// =============================================================================

struct Transform {
    model:     mat4x4<f32>,
    view:      mat4x4<f32>,
    proj:      mat4x4<f32>,
    normalMat: mat4x4<f32>,
}
struct Material {
    colorAmbient:    vec4<f32>,  // xyz = Farbe,    w = ambient
    lightPosShiny:   vec4<f32>,  // xyz = lightPos, w = shininess
    viewPosToon:     vec4<f32>,  // xyz = viewPos
    lightColorRough: vec4<f32>,  // xyz = lightColor
    metallic: f32, _p0: f32, _p1: f32, _p2: f32,
}

@group(0) @binding(0) var<uniform> tfm: Transform;
@group(0) @binding(1) var<uniform> mtl: Material;

// Blinn-Phong: Ambient + Diffuse (Lambert) + Specular (Half-Vector)
fn blinnPhong(N: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
    let L    = normalize(mtl.lightPosShiny.xyz - worldPos);
    let V    = normalize(mtl.viewPosToon.xyz   - worldPos);
    let H    = normalize(L + V);                           // Half-Vector
    let diff = max(dot(N, L), 0.0);
    let spec = pow(max(dot(N, H), 0.0), mtl.lightPosShiny.w);
    return mtl.colorAmbient.w  * mtl.colorAmbient.xyz
         + diff * mtl.colorAmbient.xyz * mtl.lightColorRough.xyz
         + spec * mtl.lightColorRough.xyz;
}

struct VsOut {
    @builtin(position) clip:  vec4<f32>,
    @location(0)       color: vec3<f32>,  // smooth interpoliert (Standard)
}

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
    let world = tfm.model * vec4<f32>(pos, 1.0);
    let N     = normalize((tfm.normalMat * vec4<f32>(norm, 0.0)).xyz);
    var o: VsOut;
    o.clip  = tfm.proj * tfm.view * world;
    o.color = blinnPhong(N, world.xyz);   // Beleuchtung pro Vertex
    return o;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // Interpolierter Farbwert direkt ausgeben.
    return vec4<f32>(in.color, 1.0);
}

