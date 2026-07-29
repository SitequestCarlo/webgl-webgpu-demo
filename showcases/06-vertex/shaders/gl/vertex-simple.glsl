// =============================================================================
// vertex-simple.glsl – Standard Vertex-Shader (Showcase 06: Vertex Throughput)
// WebGL2 / GLSL ES 3.00
//
// Einfacher Blinn-Phong ohne zusätzliche Berechnungen.
// Dient als Referenz/Baseline für den Vertex-Durchsatz-Benchmark.
// GPU-Timing: gl.finish() nach drawElements() misst echte GPU-Wartezeit.
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

// --- Fragment Shader ---------------------------------------------------------
// Standard Blinn-Phong – identisch in Simple und Heavy VS.
// ============================================================
#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;

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

  fragColor = vec4(
    uAmbient * uColor
    + diff * uColor * uLightColor
    + spec * uLightColor, 1.0);
}

