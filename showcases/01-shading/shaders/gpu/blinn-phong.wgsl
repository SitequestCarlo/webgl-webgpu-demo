// =============================================================================
// blinn-phong.wgsl – Blinn-Phong Shading (WebGPU / WGSL)
// Identischer Algorithmus wie blinn-phong.glsl, aber WGSL-Syntax.
//
// Unterschiede zur WebGL-Version:
//   - Uniforms in Bind Groups statt globalen Uniform-Variablen
//   - @group(0) @binding(0): Transform-Buffer  (model, view, proj, normalMat)
//   - @group(0) @binding(1): Material-Buffer   (color+ambient, lightPos+shininess, ...)
//   - Vertex- und Fragment-Shader in EINER .wgsl-Datei (separate entry points)
// =============================================================================

struct Transform {
    model:     mat4x4<f32>,
    view:      mat4x4<f32>,
    proj:      mat4x4<f32>,
    normalMat: mat4x4<f32>,   // upper-left 3×3 = Normal-Matrix
}
struct Material {
    colorAmbient:    vec4<f32>,  // xyz = Farbe,      w = ambient
    lightPosShiny:   vec4<f32>,  // xyz = lightPos,   w = shininess
    viewPosToon:     vec4<f32>,  // xyz = viewPos,    w = toonSteps
    lightColorRough: vec4<f32>,  // xyz = lightColor, w = roughness
    metallic: f32, _p0: f32, _p1: f32, _p2: f32,
}

@group(0) @binding(0) var<uniform> tfm: Transform;
@group(0) @binding(1) var<uniform> mtl: Material;

struct VsOut {
    @builtin(position) clip:     vec4<f32>,
    @location(0)       worldPos: vec3<f32>,
    @location(1)       normal:   vec3<f32>,
}

@vertex fn vs_main(
    @location(0) pos:  vec3<f32>,
    @location(1) norm: vec3<f32>,
) -> VsOut {
    let world = tfm.model * vec4<f32>(pos, 1.0);
    var o: VsOut;
    o.clip     = tfm.proj * tfm.view * world;
    o.worldPos = world.xyz;
    o.normal   = (tfm.normalMat * vec4<f32>(norm, 0.0)).xyz;
    return o;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N = normalize(in.normal);
    let L = normalize(mtl.lightPosShiny.xyz - in.worldPos);
    let V = normalize(mtl.viewPosToon.xyz   - in.worldPos);
    let H = normalize(L + V);                           // Half-Vector (Blinn)

    let diff = max(dot(N, L), 0.0);
    let spec = pow(max(dot(N, H), 0.0), mtl.lightPosShiny.w);

    return vec4<f32>(
        mtl.colorAmbient.w * mtl.colorAmbient.xyz
        + diff * mtl.colorAmbient.xyz * mtl.lightColorRough.xyz
        + spec * mtl.lightColorRough.xyz, 1.0);
}
