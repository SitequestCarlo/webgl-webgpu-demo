// =============================================================================
// flat.glsl – Flat Shading (eine Farbe pro Dreieck)
// WebGL2 / GLSL ES 3.00
//
// Beleuchtung wird PRO VERTEX berechnet. Der `flat`-Qualifier sorgt dafür,
// dass die Farbe des "Provoking Vertex" (erster Vertex des Dreiecks) für
// alle Fragmente des Dreiecks gilt → keine Interpolation → harte Facetten.
//
// Vergleich mit Gouraud: identische Berechnung, aber `flat` statt smooth.
// =============================================================================

// --- Vertex Shader -----------------------------------------------------------
// Berechnet Blinn-Phong pro Vertex. Output: flat out vColor (kein Blend).
#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMatrix;

// Licht-/Material-Uniforms
uniform vec3  uColor;
uniform vec3  uLightPos;
uniform vec3  uViewPos;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform float uShininess;

// flat = kein Interpolieren, Provoking-Vertex-Wert gilt für ganzes Dreieck
flat out vec3 vColor;

vec3 blinnPhong(vec3 N, vec3 worldPos) {
  vec3 L    = normalize(uLightPos - worldPos);
  vec3 V    = normalize(uViewPos  - worldPos);
  vec3 H    = normalize(L + V);                     // Half-Vector
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), uShininess);
  return uAmbient * uColor
       + diff * uColor * uLightColor
       + spec * uLightColor;
}

void main() {
  vec4 world  = uModel * vec4(aPosition, 1.0);
  vec3 N      = normalize(uNormalMatrix * aNormal);
  vColor      = blinnPhong(N, world.xyz);   // Licht pro Vertex
  gl_Position = uProj * uView * world;
}

// --- Fragment Shader ---------------------------------------------------------
// Übernimmt den flat-interpolierten Farbwert des Provoking Vertex.
#version 300 es
precision highp float;

flat in vec3 vColor;  // keine Interpolation – eine Farbe pro Dreieck
out  vec4 fragColor;

void main() {
  fragColor = vec4(vColor, 1.0);
}
