// N-Body Simulation via RGBA32F Texture Ping-Pong (WebGL2).
// Simulation-Pass: Fragment-Shader liest alle Positionen aus Textur → berechnet Kraft.
// Render-Pass: Punkte an simulierten Positionen.

export const SIM_VS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec2 aUV; // Textur-Koordinate des zu simulierenden Partikels
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aUV * 2.0 - 1.0, 0.0, 1.0);
}`;

export function buildSimFS(n: number): string {
  return /* glsl */`#version 300 es
precision highp float;
#define N ${n}
in vec2 vUV;
uniform sampler2D uPos;  // RGBA: xyz=position, w=mass
uniform sampler2D uVel;  // RGBA: xyz=velocity
uniform float uDt;
uniform float uSoftening;
layout(location=0) out vec4 outPos;
layout(location=1) out vec4 outVel;
void main() {
  vec4 pos = texture(uPos, vUV);
  vec4 vel = texture(uVel, vUV);
  vec2 texSize = vec2(textureSize(uPos, 0));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec2 uv2 = (vec2(float(i % int(texSize.x)), float(i / int(texSize.x))) + 0.5) / texSize;
    vec4 other = texture(uPos, uv2);
    vec3 d = other.xyz - pos.xyz;
    float dist2 = dot(d, d) + uSoftening * uSoftening;
    float inv = inversesqrt(dist2 * dist2 * dist2);
    acc += d * (other.w * inv);
  }
  vel.xyz += acc * uDt;
  pos.xyz += vel.xyz * uDt;
  outPos = pos;
  outVel = vel;
}`;
}

export const PASS_VS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in float aIndex;
uniform sampler2D uPos;
uniform mat4 uViewProj;
uniform float uTexSize;
out vec3 vColor;
void main() {
  int idx = int(aIndex);
  vec2 uv = (vec2(float(idx) - floor(float(idx)/uTexSize)*uTexSize, floor(float(idx)/uTexSize)) + 0.5) / uTexSize;
  vec4 pos = texture(uPos, uv);
  gl_Position = uViewProj * vec4(pos.xyz, 1.0);
  gl_PointSize = 2.0;
  float speed = length(texture(uPos, uv).w);
  float h = float(idx) / float(textureSize(uPos, 0).x * textureSize(uPos, 0).y);
  vColor = vec3(0.5 + 0.5*sin(h*6.28), 0.3 + 0.3*cos(h*6.28+2.1), 0.5 + 0.5*sin(h*6.28+4.2));
}`;

export const PASS_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c,c) > 0.25) discard;
  fragColor = vec4(vColor, 0.8);
}`;
