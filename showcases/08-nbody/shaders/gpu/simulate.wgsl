// simulate.wgsl – N-Body Compute-Shader (WebGPU, Showcase 08)
// VORTEIL: Echter Compute, parallele Kraft-Berechnung (64 Threads/Workgroup).
// Storage Buffer statt Textur → direkter Zugriff, kein Textur-Overhead.
// N bis 4096+ interaktiv (vs. max 512 im WebGL Fragment-Shader-Hack).
struct Particle { pos: vec4<f32>, vel: vec4<f32> }  // pos.w = mass

@group(0) @binding(0) var<storage, read>       inBuf:  array<Particle>;  // Lesen
@group(0) @binding(1) var<storage, read_write> outBuf: array<Particle>;  // Schreiben
@group(0) @binding(2) var<uniform>             uN:     u32;
@group(0) @binding(3) var<uniform>             simU:   vec4<f32>;  // x=dt, y=softening

@compute @workgroup_size(64)  // 64 Threads parallel pro Workgroup
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i=gid.x; if(i>=uN){return;}
    let pi=inBuf[i];
    var acc=vec3<f32>(0.0);
    // O(N²) Kraftberechnung – in Compute viel schneller als Fragment-Shader
    for(var j=0u;j<uN;j++){
        if(j==i){continue;}
        let pj=inBuf[j];
        let d=pj.pos.xyz-pi.pos.xyz;
        let d2=dot(d,d)+simU.y*simU.y;
        acc+=d*(pj.pos.w*inverseSqrt(d2*d2*d2));  // Gravitationskraft
    }
    let vel=pi.vel.xyz+acc*simU.x;
    let pos=pi.pos.xyz+vel*simU.x;
    outBuf[i]=Particle(vec4<f32>(pos,pi.pos.w),vec4<f32>(vel,0.0));
}
