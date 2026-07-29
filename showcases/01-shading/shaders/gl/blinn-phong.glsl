// =============================================================================
// blinn-phong.glsl – Blinn-Phong Shading (Half-Vector statt Reflect)
// WebGL2 / GLSL ES 3.00
//
// Verbesserung gegenüber klassischem Phong: Statt des Reflect-Vektors wird
// der Half-Vector H = normalize(L + V) verwendet.
//
// Vorteile:
//   - Stabiler bei streifendem Licht (kein abruptes "Abschneiden")
//   - Ursprünglich schneller (heute kein Unterschied)
//   - Physikalisch besser motiviert (Mikrofacetten-Interpretation)
//   - Heute der Standard in Echtzeit-Rendering
//
// Phong vs. Blinn-Phong: Bei gleichem shininess-Wert ist Blinn-Phong
// etwas weicher/breiter. Shininess × 4 ≈ äquivalente Phong-Schärfe.
// =============================================================================

// --- Vertex Shader (Pass-Through) – identisch mit phong.glsl ---------------
#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
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
// Blinn-Phong: Specular über den Half-Vector H = normalize(L + V).
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
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos  - vWorldPos);
  vec3 H = normalize(L + V);   // ← Half-Vector: die entscheidende Änderung

  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), uShininess);  // N · H (nicht R · V!)

  fragColor = vec4(
    uAmbient * uColor
    + diff * uColor * uLightColor
    + spec * uLightColor, 1.0);
}
