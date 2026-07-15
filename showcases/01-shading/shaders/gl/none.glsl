// =============================================================================
// none.glsl – Kein Shading (reine Basisfarbe)
// WebGL2 / GLSL ES 3.00
//
// Kein Lichtmodell – jeder Pixel erhält exakt die eingestellte Farbe.
// Nützlich als Referenz und für Wireframe-Ansichten.
// =============================================================================

// --- Vertex Shader -----------------------------------------------------------
// Transformiert Position in Clip-Space. Normale wird nicht benötigt.
#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;    // unused, aber im VAO vorhanden

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMatrix;

out vec3 vWorldPos;
out vec3 vNormal;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos   = world.xyz;
  vNormal     = uNormalMatrix * aNormal;
  gl_Position = uProj * uView * world;
}

// --- Fragment Shader ---------------------------------------------------------
// Gibt die uniform uColor unverändert aus. Keinerlei Lichtberechnung.
#version 300 es
precision highp float;

uniform vec3 uColor;  // Material-Basisfarbe (RGB)
out vec4 fragColor;

void main() {
  fragColor = vec4(uColor, 1.0);
}
