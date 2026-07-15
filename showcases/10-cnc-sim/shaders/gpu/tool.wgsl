// tool.wgsl – Werkzeug-Overlay Shader (WebGPU, Showcase 10)
// Rendert den Fräser als Rotationskörper mit einfachem Blinn-Phong.
struct Camera {
  view_proj : mat4x4<f32>,
  cam_pos   : vec3<f32>,
  grid_size : f32,
}

@group(0) @binding(0) var<uniform> cam : Camera;

struct VSOut {
  @builtin(position) clip_pos  : vec4<f32>,
  @location(0)       world_pos : vec3<f32>,
  @location(1)       normal    : vec3<f32>,
}

@vertex
fn vs_main(@location(0) pos : vec3<f32>, @location(1) nrm : vec3<f32>) -> VSOut {
  var out : VSOut;
  out.clip_pos  = cam.view_proj * vec4<f32>(pos, 1.0);
  out.world_pos = pos;
  out.normal    = nrm;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  var N = normalize(in.normal);
  let L = normalize(vec3<f32>(0.5, 1.0, 0.6));
  let V = normalize(cam.cam_pos - in.world_pos);
  if (dot(N, V) < 0.0) { N = -N; }
  let H = normalize(L + V);
  let base = vec3<f32>(0.85, 0.47, 0.16);
  let hemi = mix(0.15, 0.35, N.y * 0.5 + 0.5);
  let diff = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, H), 0.0), 45.0) * 0.5;
  return vec4<f32>(base * (hemi + diff * 0.9) + vec3<f32>(spec), 1.0);
}
