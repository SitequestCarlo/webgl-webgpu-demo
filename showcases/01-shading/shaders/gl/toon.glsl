// =============================================================================
// toon.glsl – Toon / Cel Shading
// WebGL2 / GLSL ES 3.00
//
// Quantisiert die kontinuierliche Diffuse-Helligkeit in diskrete Stufen
// (controlled über uToonSteps). Zusätzlich: Silhouetten-Rim via dot(N, V).
//
// Typisch für Cartoon-Ästhetik (z.B. Zelda: Breath of the Wild).
// Zeigt, dass Shading keine physikalische Simulation sein muss.
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
// Zwei Effekte: quantisierte Helligkeitsstufen + Silhouetten-Abdunklung.
#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;

uniform vec3  uColor;
uniform vec3  uLightPos;
uniform vec3  uViewPos;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform float uToonSteps;  // Anzahl der Helligkeitsstufen (2–10)

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos  - vWorldPos);

  // Kontinuierliche Helligkeit → diskrete Stufen
  float diff    = max(dot(N, L), 0.0);
  float stepped = floor(diff * uToonSteps) / uToonSteps;  // Quantisierung

  vec3 color = (uAmbient + stepped) * uColor * uLightColor;

  // Silhouette: Normale zeigt weg von Kamera → schwarze Silhouette
  if (dot(N, V) < 0.25) color = vec3(0.0);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
