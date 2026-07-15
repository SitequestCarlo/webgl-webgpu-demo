// Multi-Light Blinn-Phong Shader für Showcase 07.
// WebGL: Uniform-Array (max 256 Lichter), Loop im Fragment-Shader.
// WebGPU: Storage Buffer, dynamische Anzahl.

export const MAX_LIGHTS = 256;

export const ML_VS_GLSL = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel,uView,uProj;
uniform mat3 uNormalMatrix;
out vec3 vWorldPos, vNormal;
void main(){
  vec4 w=uModel*vec4(aPosition,1.0);
  vWorldPos=w.xyz; vNormal=uNormalMatrix*aNormal;
  gl_Position=uProj*uView*w;
}`;

// GLSL ES 300 braucht eine konstante Loop-Grenze → MAX_LIGHTS als #define.
export function buildFragShader(maxLights: number): string {
  return /* glsl */`#version 300 es
precision highp float;
#define MAX_LIGHTS ${maxLights}
in vec3 vWorldPos, vNormal;
uniform vec3 uViewPos;
uniform float uAmbient, uShininess;
uniform int uNumLights;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
out vec4 fragColor;
void main(){
  vec3 N=normalize(vNormal), V=normalize(uViewPos-vWorldPos);
  vec3 col=vec3(uAmbient*0.5);
  for(int i=0;i<uNumLights;i++){
    vec3 L=normalize(uLightPos[i]-vWorldPos);
    vec3 H=normalize(L+V);
    float diff=max(dot(N,L),0.0);
    float spec=pow(max(dot(N,H),0.0),uShininess);
    float d=length(uLightPos[i]-vWorldPos);
    float att=1.0/(1.0+0.09*d+0.032*d*d);
    col+=att*(diff*vec3(0.55,0.17,0.51)*uLightColor[i]+spec*uLightColor[i]);
  }
  fragColor=vec4(col,1.0);
}`;
}

export const ML_WGSL = /* wgsl */`
struct Light { pos: vec3<f32>, _p0: f32, color: vec3<f32>, _p1: f32 }
struct Scene { view: mat4x4<f32>, proj: mat4x4<f32>, model: mat4x4<f32>, normalMat: mat4x4<f32>, viewPos: vec4<f32>, ambient: f32, shininess: f32, numLights: u32, _p: u32 }

@group(0) @binding(0) var<uniform>       scene:  Scene;
@group(0) @binding(1) var<storage, read> lights: array<Light>;

struct VsOut { @builtin(position) clip: vec4<f32>, @location(0) wp: vec3<f32>, @location(1) n: vec3<f32> }

@vertex fn vs(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
  let w = scene.model * vec4<f32>(pos, 1.0);
  var o: VsOut;
  o.clip = scene.proj * scene.view * w; o.wp = w.xyz;
  o.n = (scene.normalMat * vec4<f32>(norm, 0.0)).xyz;
  return o;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let N = normalize(in.n); let V = normalize(scene.viewPos.xyz - in.wp);
  var col = vec3<f32>(scene.ambient * 0.5);
  for(var i = 0u; i < scene.numLights; i++) {
    let L = normalize(lights[i].pos - in.wp);
    let H = normalize(L + V);
    let diff = max(dot(N, L), 0.0);
    let spec = pow(max(dot(N, H), 0.0), scene.shininess);
    let d = length(lights[i].pos - in.wp);
    let att = 1.0 / (1.0 + 0.09 * d + 0.032 * d * d);
    col += att * (diff * vec3<f32>(0.55, 0.17, 0.51) * lights[i].color + spec * lights[i].color);
  }
  return vec4<f32>(col, 1.0);
}
`;
