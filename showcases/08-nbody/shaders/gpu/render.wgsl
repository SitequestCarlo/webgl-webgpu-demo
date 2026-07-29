// render.wgsl – N-Body Partikel-Rendering (WebGPU, Showcase 08)
// Liest Positionen direkt aus dem Compute-Storage-Buffer (kein Umweg über Textur).
struct Params { viewProj: mat4x4<f32>, n: u32 }  // 64+4 = 68, padded to 80 bytes (struct align=16)
struct Particle { pos: vec4<f32>, vel: vec4<f32> }
@group(0) @binding(0) var<uniform>       params: Params;
@group(0) @binding(1) var<storage, read> buf:    array<Particle>;  // Direkter Buffer-Zugriff

struct VsOut { @builtin(position) clip: vec4<f32>, @location(0) col: vec3<f32> }

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
    let p = buf[i];
    var o: VsOut;
    o.clip = params.viewProj * vec4<f32>(p.pos.xyz, 1.0);
    let h = f32(i) / f32(params.n);
    o.col = vec3<f32>(0.5+0.5*sin(h*6.28), 0.3+0.3*cos(h*6.28+2.1), 0.5+0.5*sin(h*6.28+4.2));
    return o;
}

@fragment fn fs(@location(0) col: vec3<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(col, 0.8);
}

