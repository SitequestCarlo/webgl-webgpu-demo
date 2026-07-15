// blit.wgsl – Blit: Akkumulations-Buffer → Tone-Mapping → Screen (Showcase 04)
// Gleiche Logik wie showcases/03-raytracer/shaders/gpu/blit.wgsl
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let x=f32(i32(i&1u)*4-1); let y=f32(i32(i&2u)*2-1); return vec4<f32>(x,y,0.0,1.0);
}
struct BlitParams { resolution: vec2<u32>, _pad: vec2<u32> }
@group(0) @binding(0) var<storage, read> accum:  array<vec4<f32>>;
@group(0) @binding(1) var<uniform>       bparams: BlitParams;
@fragment fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let idx=u32(pos.y)*bparams.resolution.x+u32(pos.x);
    let a=accum[idx];
    var color=select(a.xyz/a.w,vec3<f32>(0.0),a.w<0.5);
    color=color/(color+vec3<f32>(1.0)); color=pow(color,vec3<f32>(1.0/2.2));
    return vec4<f32>(color,1.0);
}
