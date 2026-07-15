// none.wgsl – Kein Shading (WebGPU)
struct Transform { model: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>, normalMat: mat4x4<f32> }
struct Material  { colorAmbient: vec4<f32>, lightPosShiny: vec4<f32>, viewPosToon: vec4<f32>, lightColorRough: vec4<f32>, metallic: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(0) var<uniform> tfm: Transform;
@group(0) @binding(1) var<uniform> mtl: Material;
struct VsOut { @builtin(position) clip: vec4<f32>, @location(0) worldPos: vec3<f32>, @location(1) normal: vec3<f32> }
@vertex fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
    let world = tfm.model * vec4<f32>(pos, 1.0);
    var o: VsOut; o.clip = tfm.proj * tfm.view * world; o.worldPos = world.xyz;
    o.normal = (tfm.normalMat * vec4<f32>(norm, 0.0)).xyz; return o;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    return vec4<f32>(mtl.colorAmbient.xyz, 1.0);  // Nur Basisfarbe, kein Licht
}
