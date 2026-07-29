// =============================================================================
// blinn-phong.glsl – Benchmark Shader (Showcase 05: Draw-Call Overhead)
// WebGL2 / GLSL ES 3.00
//
// Dieser Shader wird einmal kompiliert und dann N-mal pro Frame aufgerufen.
// Der Unterschied zwischen WebGL und WebGPU liegt NICHT im Shader-Code,
// sondern im API-Overhead jedes Draw-Calls:
//   WebGL:  uniformMatrix4fv() + drawElements() pro Objekt
//   WebGPU: setBindGroup(dynamicOffset) + drawIndexed() pro Objekt
// =============================================================================

// --- Vertex Shader -----------------------------------------------------------
#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMatrix;

out vec3 vWorldPos;
out vec3 vNormal;

void main() {
  vec4 world  = uModel * vec4(aPosition, 1.0);
  vWorldPos   = world.xyz;
  vNormal     = uNormalMatrix * aNormal;
  gl_Position = uProj * uView * world;
}

// =============================================================================
// --- Fragment Shader ---------------------------------------------------------
// Blinn-Phong: Ambient + Diffuse (Lambert) + Specular (Half-Vector)
// =============================================================================
#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;

uniform vec3  uColor;
uniform vec3  uLightPos;
uniform vec3  uViewPos;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform float uShininess;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vWorldPos);   // Richtung zur Lichtquelle
  vec3 V = normalize(uViewPos  - vWorldPos);   // Richtung zur Kamera
  vec3 H = normalize(L + V);                   // Half-Vector (Blinn-Phong)

  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), uShininess);

  fragColor = vec4(
    uAmbient * uColor
    + diff * uColor * uLightColor
    + spec * uLightColor, 1.0);
}