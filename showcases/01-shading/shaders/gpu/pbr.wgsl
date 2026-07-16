// =============================================================================
// pbr.wgsl – Physically Based Rendering, Cook-Torrance BRDF (WebGPU / WGSL)
// Gleicher Algorithmus wie pbr.glsl — GGX, Schlick-Smith, Schlick Fresnel.
// =============================================================================

struct Transform {
    model:     mat4x4<f32>,
    view:      mat4x4<f32>,
    proj:      mat4x4<f32>,
    normalMat: mat4x4<f32>,
}
struct Material {
    colorAmbient:    vec4<f32>,  // xyz = Farbe,      w = ambient
    lightPosShiny:   vec4<f32>,  // xyz = lightPos,   w = shininess (unused bei PBR)
    viewPosToon:     vec4<f32>,  // xyz = viewPos
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

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
    let world = tfm.model * vec4<f32>(pos, 1.0);
    var o: VsOut;
    o.clip     = tfm.proj * tfm.view * world;
    o.worldPos = world.xyz;
    o.normal   = (tfm.normalMat * vec4<f32>(norm, 0.0)).xyz;
    return o;
}

const PI: f32 = 3.14159265359;

// GGX Normal Distribution
fn distGGX(NdotH: f32, a2: f32) -> f32 {
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}
// Schlick-Smith Geometry (einzelne Richtung)
fn geomSchlick(v: f32, k: f32) -> f32 { return v / (v * (1.0 - k) + k); }
// Schlick Fresnel
fn fresnelSchlick(cosT: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N = normalize(in.normal);
    let V = normalize(mtl.viewPosToon.xyz   - in.worldPos);
    let L = normalize(mtl.lightPosShiny.xyz - in.worldPos);
    let H = normalize(V + L);

    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let rough = mtl.lightColorRough.w;
    let a  = rough * rough;
    let a2 = a * a;
    let k  = ((rough + 1.0) * (rough + 1.0)) / 8.0;

    // F0: Dielektrikum (Kunststoff) = 0.04 | Metall = Albedo-Farbe
    let F0 = mix(vec3<f32>(0.04), mtl.colorAmbient.xyz, mtl.metallic);
    let D  = distGGX(NdotH, a2);                          // Normal Distribution
    let G  = geomSchlick(NdotV, k) * geomSchlick(NdotL, k); // Geometry Shadowing
    let F  = fresnelSchlick(HdotV, F0);                   // Fresnel-Reflektanz

    // Cook-Torrance Specular BRDF
    let spec = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
    // Diffuseranteil: kD = (1 - Fresnel) * (1 - metallic)
    let kD   = (1.0 - F) * (1.0 - mtl.metallic);
    let Lo   = (kD * mtl.colorAmbient.xyz / PI + spec) * mtl.lightColorRough.xyz * NdotL;
    return vec4<f32>(mtl.colorAmbient.w * mtl.colorAmbient.xyz + Lo, 1.0);
}
