// Gemeinsame Blinn-Phong-Shader für Benchmark-Showcases (05, 06, 09).
// WebGL: Per-Draw-Call Uniforms (model, color).
// WebGPU: Getrennte Bind-Gruppen: Szene (View/Proj/Licht) + Draw (Model/Color).

// ----- WebGL ----------------------------------------------------------------

export const BENCH_VS_GLSL = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMatrix;
out vec3 vWorldPos, vNormal;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal   = uNormalMatrix * aNormal;
  gl_Position = uProj * uView * world;
}`;

export const BENCH_FS_GLSL = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorldPos, vNormal;
uniform vec3  uColor, uLightPos, uViewPos, uLightColor;
uniform float uAmbient, uShininess;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos  - vWorldPos);
  vec3 H = normalize(L + V);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), uShininess);
  vec3 col = uAmbient * uColor + diff * uColor * uLightColor + spec * uLightColor;
  fragColor = vec4(col, 1.0);
}`;

// ----- WebGPU ---------------------------------------------------------------
// @group(0) @binding(0): Szene-Uniform (View, Proj, Licht) – einmal pro Frame
// @group(1) @binding(0): Draw-Uniform  (Model, Color)     – Dynamic Offset

export const BENCH_WGSL = /* wgsl */`
struct Scene {
  view:       mat4x4<f32>,
  proj:       mat4x4<f32>,
  lightPos:   vec4<f32>,    // w unused
  viewPos:    vec4<f32>,    // w unused
  lightColor: vec4<f32>,    // w=ambient
  shininess:  f32,
  _p:         vec3<f32>,
}

struct Draw {
  model:     mat4x4<f32>,
  normalMat: mat4x4<f32>,
  color:     vec4<f32>,
  _pad:      array<vec4<f32>, 7>, // align to 256 bytes (total 256)
}

@group(0) @binding(0) var<uniform> scene: Scene;
@group(1) @binding(0) var<uniform> draw:  Draw;

struct VsOut {
  @builtin(position) clip:     vec4<f32>,
  @location(0)       worldPos: vec3<f32>,
  @location(1)       normal:   vec3<f32>,
}

@vertex fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
  let world = draw.model * vec4<f32>(pos, 1.0);
  var o: VsOut;
  o.clip     = scene.proj * scene.view * world;
  o.worldPos = world.xyz;
  o.normal   = (draw.normalMat * vec4<f32>(norm, 0.0)).xyz;
  return o;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let N = normalize(in.normal);
  let L = normalize(scene.lightPos.xyz - in.worldPos);
  let V = normalize(scene.viewPos.xyz  - in.worldPos);
  let H = normalize(L + V);
  let diff = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, H), 0.0), scene.shininess);
  let col  = scene.lightColor.w * draw.color.xyz
           + diff * draw.color.xyz * scene.lightColor.xyz
           + spec * scene.lightColor.xyz;
  return vec4<f32>(col, 1.0);
}
`;

// Draw-Uniform Größe: 256 Bytes (256-Byte-aligned für Dynamic Offsets)
export const DRAW_UNIFORM_SIZE = 256;

// Füllt den Draw-Uniform-Buffer für ein Objekt.
// out: Float32Array (64 Floats = 256 Bytes), offset: Float32-Offset im Buffer
export function writeDrawUniform(
  out: Float32Array,
  floatOffset: number,
  model: Float32Array,       // 16 floats
  normalMat: Float32Array,   // 16 floats (mat3 als mat4)
  color: [number, number, number],
): void {
  out.set(model,     floatOffset);
  out.set(normalMat, floatOffset + 16);
  out[floatOffset + 32] = color[0];
  out[floatOffset + 33] = color[1];
  out[floatOffset + 34] = color[2];
  out[floatOffset + 35] = 1.0;
}
