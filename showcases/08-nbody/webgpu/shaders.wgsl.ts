// N-Body Compute-Shader + Render-Shader für WebGPU.

export const NBODY_COMPUTE = /* wgsl */`
struct Particle { pos: vec4<f32>, vel: vec4<f32> }  // pos.w = mass

@group(0) @binding(0) var<storage, read>       inBuf:  array<Particle>;
@group(0) @binding(1) var<storage, read_write> outBuf: array<Particle>;
@group(0) @binding(2) var<uniform>             uN:     u32;
@group(0) @binding(3) var<uniform>             simU:   vec4<f32>; // x=dt, y=softening

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= uN) { return; }
  let pi  = inBuf[i];
  var acc = vec3<f32>(0.0);
  for (var j = 0u; j < uN; j++) {
    if (j == i) { continue; }
    let pj = inBuf[j];
    let d  = pj.pos.xyz - pi.pos.xyz;
    let s  = simU.y;
    let d2 = dot(d, d) + s * s;
    let inv = inverseSqrt(d2 * d2 * d2);
    acc += d * (pj.pos.w * inv);
  }
  var vel = pi.vel.xyz + acc * simU.x;
  var pos = pi.pos.xyz + vel * simU.x;
  outBuf[i] = Particle(vec4<f32>(pos, pi.pos.w), vec4<f32>(vel, 0.0));
}
`;

export const NBODY_RENDER_VS = /* wgsl */`
struct Params { viewProj: mat4x4<f32>, n: u32, _p: vec3<u32> }
struct Particle { pos: vec4<f32>, vel: vec4<f32> }

@group(0) @binding(0) var<uniform>       params: Params;
@group(0) @binding(1) var<storage, read> buf:    array<Particle>;

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) col: vec3<f32>,
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = buf[i];
  var o: VsOut;
  o.clip = params.viewProj * vec4<f32>(p.pos.xyz, 1.0);
  let h = f32(i) / f32(params.n);
  o.col = vec3<f32>(0.5 + 0.5*sin(h*6.28), 0.3 + 0.3*cos(h*6.28+2.1), 0.5 + 0.5*sin(h*6.28+4.2));
  return o;
}
`;

export const NBODY_RENDER_FS = /* wgsl */`
@fragment fn fs(@location(0) col: vec3<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(col, 0.8);
}
`;
