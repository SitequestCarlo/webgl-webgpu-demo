// =============================================================================
// pbr.wgsl – PBR Material-Grid (WebGPU / WGSL)
// Showcase 02: Instanced Rendering via Storage Buffer.
// VS liest Roughness/Metallic per Instanz via @builtin(instance_index).
// =============================================================================

struct Camera {
    view: mat4x4<f32>, proj: mat4x4<f32>,
    viewPos: vec4<f32>, lightPos: vec4<f32>, lightColor: vec4<f32>,
    albedo: vec4<f32>,  // xyz=albedo, w=ambient
}
struct SphereData {
    model: mat4x4<f32>, normalMat: mat4x4<f32>,
    roughness: f32, metallic: f32, _p0: f32, _p1: f32,
}
@group(0) @binding(0) var<uniform>       cam:     Camera;
@group(1) @binding(0) var<storage, read> spheres: array<SphereData>;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) worldPos: vec3<f32>, @location(1) normal: vec3<f32>,
    @location(2) @interpolate(flat, first) roughness: f32,
    @location(3) @interpolate(flat, first) metallic:  f32,
}

@vertex fn vs_main(
    @location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>,
    @builtin(instance_index) inst: u32,   // ← Zugriff auf Instanz-Daten
) -> VsOut {
    let s = spheres[inst];
    let world = s.model * vec4<f32>(pos, 1.0);
    var o: VsOut;
    o.clip = cam.proj * cam.view * world; o.worldPos = world.xyz;
    o.normal = (s.normalMat * vec4<f32>(norm, 0.0)).xyz;
    o.roughness = s.roughness; o.metallic = s.metallic;
    return o;
}

const PI: f32 = 3.14159265359;
fn distGGX(h: f32, a2: f32) -> f32 { let d=h*h*(a2-1.0)+1.0; return a2/(PI*d*d); }
fn geomSchlick(v: f32, k: f32) -> f32 { return v/(v*(1.0-k)+k); }
fn fresnelSchlick(c: f32, F0: vec3<f32>) -> vec3<f32> { return F0+(1.0-F0)*pow(clamp(1.0-c,0.0,1.0),5.0); }

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N=normalize(in.normal); let V=normalize(cam.viewPos.xyz-in.worldPos);
    let L=normalize(cam.lightPos.xyz-in.worldPos); let H=normalize(V+L);
    let NdotL=max(dot(N,L),0.0); let NdotV=max(dot(N,V),0.0);
    let NdotH=max(dot(N,H),0.0); let HdotV=max(dot(H,V),0.0);
    let a=in.roughness*in.roughness; let a2=a*a;
    let k=((in.roughness+1.0)*(in.roughness+1.0))/8.0;
    let F0=mix(vec3<f32>(0.04),cam.albedo.xyz,in.metallic);
    let spec=(distGGX(NdotH,a2)*geomSchlick(NdotV,k)*geomSchlick(NdotL,k)*fresnelSchlick(HdotV,F0))/max(4.0*NdotV*NdotL,0.001);
    let kD=(1.0-fresnelSchlick(HdotV,F0))*(1.0-in.metallic);
    let Lo=(kD*cam.albedo.xyz/PI+spec)*cam.lightColor.xyz*NdotL;
    var color=cam.albedo.w*cam.albedo.xyz+Lo;
    color=color/(color+vec3<f32>(1.0)); color=pow(color,vec3<f32>(1.0/2.2));
    return vec4<f32>(color,1.0);
}
