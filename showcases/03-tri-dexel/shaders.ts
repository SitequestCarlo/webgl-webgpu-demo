// WGSL-Shader für Showcase 03 (Tri-Dexel + Dual Contouring).
//   MESH_SHADER  – rendert das extrahierte Dreiecksnetz mit glatten Normalen.
//   POINT_SHADER – zeichnet die Tri-Dexel-Schnittpunkte, gefärbt nach Achse.

// Geteilter Kamera-Uniform: view_proj (64) + cam_pos (12) + pad (4) = 80 Byte.
const CAMERA_STRUCT = /* wgsl */`
struct Camera {
  view_proj : mat4x4<f32>,
  cam_pos   : vec3<f32>,
  pad       : f32,
}
`;

export const MESH_SHADER = /* wgsl */`
${CAMERA_STRUCT}
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
  let V = normalize(cam.cam_pos - in.world_pos);
  if (dot(N, V) < 0.0) { N = -N; }               // zweiseitige Beleuchtung
  let L = normalize(vec3<f32>(0.45, 0.9, 0.55));
  let diff = max(dot(N, L), 0.0);
  let hemi = 0.32 + 0.30 * (N.y * 0.5 + 0.5);     // Himmel/Boden-Ambient
  let H = normalize(L + V);
  let spec = pow(max(dot(N, H), 0.0), 40.0) * 0.35;
  let base = vec3<f32>(0.60, 0.65, 0.72);         // Stahlgrau
  let col = base * (hemi + diff * 0.75) + vec3<f32>(spec);
  return vec4<f32>(col, 1.0);
}
`;

export const POINT_SHADER = /* wgsl */`
${CAMERA_STRUCT}
@group(0) @binding(0) var<uniform> cam : Camera;

struct VSOut {
  @builtin(position) clip_pos : vec4<f32>,
  @location(0)       color    : vec3<f32>,
}

@vertex
fn vs_main(@location(0) data : vec4<f32>) -> VSOut {
  var out : VSOut;
  out.clip_pos = cam.view_proj * vec4<f32>(data.xyz, 1.0);
  let axis = u32(data.w + 0.5);
  var c = vec3<f32>(0.90, 0.32, 0.32);            // X = rot
  if (axis == 1u) { c = vec3<f32>(0.34, 0.85, 0.42); }   // Y = grün
  if (axis == 2u) { c = vec3<f32>(0.40, 0.58, 0.96); }   // Z = blau
  out.color = c;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;
