// WGSL-Shader für Showcase 02 PBR Material-Grid (WebGPU).
// Instanced Rendering: alle 36 Kugeln in einem einzigen Draw-Call.
// Per-Kugel-Daten (model, normalMat, roughness, metallic) kommen aus einem
// Storage-Buffer der via @builtin(instance_index) indiziert wird.
//
// Bind-Gruppen:
//   @group(0) @binding(0) : Camera-Uniform   (view, proj, viewPos, lightPos, lightColor, ambient)
//   @group(1) @binding(0) : Sphere-Storage   (array<SphereData, 36>)

export const VS_SRC = /* wgsl */`
struct Camera {
    view:       mat4x4<f32>,
    proj:       mat4x4<f32>,
    viewPos:    vec4<f32>,   // w unused
    lightPos:   vec4<f32>,   // w unused
    lightColor: vec4<f32>,   // w unused
    albedo:     vec4<f32>,   // xyz = albedo, w = ambient
}

struct SphereData {
    model:     mat4x4<f32>,
    normalMat: mat4x4<f32>,
    roughness: f32,
    metallic:  f32,
    _p0: f32,  _p1: f32,
}

@group(0) @binding(0) var<uniform>         cam:     Camera;
@group(1) @binding(0) var<storage, read>   spheres: array<SphereData>;

struct VsOut {
    @builtin(position) clip:      vec4<f32>,
    @location(0)       worldPos:  vec3<f32>,
    @location(1)       normal:    vec3<f32>,
    @location(2) @interpolate(flat, first) roughness: f32,
    @location(3) @interpolate(flat, first) metallic:  f32,
}

@vertex fn vs_main(
    @location(0) pos:  vec3<f32>,
    @location(1) norm: vec3<f32>,
    @builtin(instance_index) inst: u32,
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
`;

export const FS_SRC = /* wgsl */`
struct Camera {
    view:       mat4x4<f32>,
    proj:       mat4x4<f32>,
    viewPos:    vec4<f32>,
    lightPos:   vec4<f32>,
    lightColor: vec4<f32>,
    albedo:     vec4<f32>,
}

struct SphereData {
    model:     mat4x4<f32>,
    normalMat: mat4x4<f32>,
    roughness: f32,
    metallic:  f32,
    _p0: f32, _p1: f32,
}

@group(0) @binding(0) var<uniform>       cam:     Camera;
@group(1) @binding(0) var<storage, read> spheres: array<SphereData>;

struct VsOut {
    @builtin(position) clip:      vec4<f32>,
    @location(0)       worldPos:  vec3<f32>,
    @location(1)       normal:    vec3<f32>,
    @location(2) @interpolate(flat, first) roughness: f32,
    @location(3) @interpolate(flat, first) metallic:  f32,
}

const PI: f32 = 3.14159265359;

fn distGGX(NdotH: f32, a2: f32) -> f32 {
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}
fn geomSchlick(v: f32, k: f32) -> f32 { return v / (v * (1.0 - k) + k); }
fn fresnelSchlick(cosT: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let albedo    = cam.albedo.xyz;
    let ambient   = cam.albedo.w;
    let rough     = in.roughness;
    let metal     = in.metallic;

    let N = normalize(in.normal);
    let V = normalize(cam.viewPos.xyz  - in.worldPos);
    let L = normalize(cam.lightPos.xyz - in.worldPos);
    let H = normalize(V + L);

    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let a = rough * rough; let a2 = a * a;
    let k = ((rough + 1.0) * (rough + 1.0)) / 8.0;

    let F0   = mix(vec3<f32>(0.04), albedo, metal);
    let D    = distGGX(NdotH, a2);
    let G    = geomSchlick(NdotV, k) * geomSchlick(NdotL, k);
    let F    = fresnelSchlick(HdotV, F0);
    let spec = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
    let kD   = (1.0 - F) * (1.0 - metal);
    let Lo   = (kD * albedo / PI + spec) * cam.lightColor.xyz * NdotL;

    var color = ambient * albedo + Lo;
    // Reinhard + Gamma
    color = color / (color + vec3<f32>(1.0));
    color = pow(color, vec3<f32>(1.0 / 2.2));
    return vec4<f32>(color, 1.0);
}
`;
