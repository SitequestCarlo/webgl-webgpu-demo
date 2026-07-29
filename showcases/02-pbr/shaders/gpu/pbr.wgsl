// =============================================================================
// pbr.wgsl – PBR Material-Grid (WebGPU / WGSL)
// Showcase 02: Instanced Rendering via Storage Buffer.
//
// Alle 36 Kugeln (6×6 Raster) werden mit EINEM Draw-Call gerendert.
// Roughness und Metallic werden pro Instanz aus dem Storage Buffer gelesen.
// =============================================================================

struct Camera {
    view:       mat4x4<f32>,
    proj:       mat4x4<f32>,
    viewPos:    vec4<f32>,
    lightPos:   vec4<f32>,
    lightColor: vec4<f32>,
    albedo:     vec4<f32>,  // xyz = Albedo, w = ambient
}

struct SphereData {
    model:     mat4x4<f32>,
    normalMat: mat4x4<f32>,
    roughness: f32,
    metallic:  f32,
    _p0: f32, _p1: f32,
}

@group(0) @binding(0) var<uniform>       cam:     Camera;
@group(1) @binding(0) var<storage, read> spheres: array<SphereData>;  // 36 Einträge

struct VsOut {
    @builtin(position) clip:     vec4<f32>,
    @location(0)       worldPos: vec3<f32>,
    @location(1)       normal:   vec3<f32>,
    // flat = nicht interpoliert → gleicher Wert für alle Fragmente einer Kugel
    @location(2) @interpolate(flat, first) roughness: f32,
    @location(3) @interpolate(flat, first) metallic:  f32,
}

@vertex
fn vs_main(
    @location(0) pos:  vec3<f32>,
    @location(1) norm: vec3<f32>,
    @builtin(instance_index) inst: u32,  // Zugriff auf per-Instanz-Daten
) -> VsOut {
    let s     = spheres[inst];
    let world = s.model * vec4<f32>(pos, 1.0);
    var o: VsOut;
    o.clip      = cam.proj * cam.view * world;
    o.worldPos  = world.xyz;
    o.normal    = (s.normalMat * vec4<f32>(norm, 0.0)).xyz;
    o.roughness = s.roughness;
    o.metallic  = s.metallic;
    return o;
}

const PI: f32 = 3.14159265359;

// GGX Normal Distribution Function
fn distGGX(NdotH: f32, a2: f32) -> f32 {
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}
// Schlick-Smith Geometry (einzelne Richtung)
fn geomSchlick(v: f32, k: f32) -> f32 {
    return v / (v * (1.0 - k) + k);
}
// Fresnel-Schlick Näherung
fn fresnelSchlick(cosT: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N = normalize(in.normal);
    let V = normalize(cam.viewPos.xyz  - in.worldPos);
    let L = normalize(cam.lightPos.xyz - in.worldPos);
    let H = normalize(V + L);

    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let a  = in.roughness * in.roughness;
    let a2 = a * a;
    let k  = ((in.roughness + 1.0) * (in.roughness + 1.0)) / 8.0;

    // F0: Dielektrikum = 0.04 (Kunststoff) | Metall = Albedo-Farbe
    let F0   = mix(vec3<f32>(0.04), cam.albedo.xyz, in.metallic);
    let D    = distGGX(NdotH, a2);
    let G    = geomSchlick(NdotV, k) * geomSchlick(NdotL, k);
    let F    = fresnelSchlick(HdotV, F0);

    // Cook-Torrance Specular BRDF
    let spec = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
    let kD   = (1.0 - F) * (1.0 - in.metallic);   // Diffuseranteil
    let Lo   = (kD * cam.albedo.xyz / PI + spec) * cam.lightColor.xyz * NdotL;

    // Reinhard Tone-Mapping + Gamma-Korrektur (sRGB)
    var color = cam.albedo.w * cam.albedo.xyz + Lo;
    color = color / (color + vec3<f32>(1.0));
    color = pow(color, vec3<f32>(1.0 / 2.2));
    return vec4<f32>(color, 1.0);
}

