// multi-light.wgsl – N Lichter via Storage Buffer (WebGPU, Showcase 07)
// VORTEIL gegenüber WebGL: var<storage, read> lights: array<Light>
// → Dynamische Größe, kein Compile-Zeit-Limit, Laufzeit-Update ohne Shader-Rebuild.
struct Light { pos: vec3<f32>, _p0: f32, color: vec3<f32>, _p1: f32 }
struct Scene { view: mat4x4<f32>, proj: mat4x4<f32>, model: mat4x4<f32>, normalMat: mat4x4<f32>, viewPos: vec4<f32>, ambient: f32, shininess: f32, numLights: u32, _p: u32 }
@group(0) @binding(0) var<uniform>       scene:  Scene;
@group(0) @binding(1) var<storage, read> lights: array<Light>;  // Dynamisches Array!
struct VsOut{@builtin(position)clip:vec4<f32>,@location(0)wp:vec3<f32>,@location(1)n:vec3<f32>}
@vertex fn vs(@location(0)pos:vec3<f32>,@location(1)norm:vec3<f32>)->VsOut{let w=scene.model*vec4<f32>(pos,1.0);var o:VsOut;o.clip=scene.proj*scene.view*w;o.wp=w.xyz;o.n=(scene.normalMat*vec4<f32>(norm,0.0)).xyz;return o;}
@fragment fn fs(in:VsOut)->@location(0)vec4<f32>{
    let N=normalize(in.n);let V=normalize(scene.viewPos.xyz-in.wp);
    var col=vec3<f32>(scene.ambient*0.5);
    for(var i=0u;i<scene.numLights;i++){  // Laufzeit-N, kein Compile-Zeit-Limit
        let L=normalize(lights[i].pos-in.wp);let H=normalize(L+V);
        let d=length(lights[i].pos-in.wp);
        let att=1.0/(1.0+0.09*d+0.032*d*d);
        col+=att*(max(dot(N,L),0.0)*vec3<f32>(0.55,0.17,0.51)*lights[i].color+pow(max(dot(N,H),0.0),scene.shininess)*lights[i].color);
    }
    return vec4<f32>(col,1.0);
}
