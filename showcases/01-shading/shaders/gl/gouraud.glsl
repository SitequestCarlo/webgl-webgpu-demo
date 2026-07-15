// =============================================================================
// gouraud.glsl – Gouraud Shading (Beleuchtung pro Vertex, glatt interpoliert)
// WebGL2 / GLSL ES 3.00
//
// Wie Flat, aber ohne `flat`-Qualifier → Farbe wird zwischen Vertices
// bilinear interpoliert. Bei groben Meshes sichtbare Artefakte (Spekulare
// Highlights können "verschwinden" wenn sie zwischen Vertices liegen).
//
// Historischer Kontext: Gouraud Shading (1971) war der erste Schritt zu
// realistischerem Rendering und lange der Standard für Echtzeit-Grafik.
// =============================================================================

// --- Vertex Shader -----------------------------------------------------------
// Identisch mit Flat, aber Ausgabe ohne `flat` → wird interpoliert.
#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMatrix;

uniform vec3  uColor;
uniform vec3  uLightPos;
uniform vec3  uViewPos;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform float uShininess;

out vec3 vColor;  // smooth interpolation (Standard, kein Qualifier nötig)

vec3 blinnPhong(vec3 N, vec3 worldPos) {
  vec3 L    = normalize(uLightPos - worldPos);
  vec3 V    = normalize(uViewPos  - worldPos);
  vec3 H    = normalize(L + V);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), uShininess);
  return uAmbient * uColor
       + diff * uColor * uLightColor
       + spec * uLightColor;
}

void main() {
  vec4 world  = uModel * vec4(aPosition, 1.0);
  vec3 N      = normalize(uNormalMatrix * aNormal);
  vColor      = blinnPhong(N, world.xyz);
  gl_Position = uProj * uView * world;
}

// --- Fragment Shader ---------------------------------------------------------
// Nimmt den interpolierten Farbwert und gibt ihn direkt aus.
#version 300 es
precision highp float;

in  vec3 vColor;   // bilinear zwischen Vertices interpoliert
out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, 1.0);
}
