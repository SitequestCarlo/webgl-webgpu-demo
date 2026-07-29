// =============================================================================
// phong.glsl – Klassisches Phong Shading (Beleuchtung pro Fragment)
// WebGL2 / GLSL ES 3.00
//
// Der Vertex-Shader reicht nur Weltposition und Normale weiter.
// Die Beleuchtungsberechnung findet im Fragment-Shader statt → höhere
// Qualität als Gouraud, da Normale pro Fragment interpoliert wird.
//
// Specular: Reflect-Vektor (klassisches Phong, 1975).
// Nachteil: Bei flachem Lichteinfall kann der Reflect-Vektor "hinter"
// die Oberfläche zeigen → Highlight bricht abrupt ab.
// Verbesserung: Blinn-Phong (Half-Vector, nächste Datei).
// =============================================================================

// --- Vertex Shader (Pass-Through) --------------------------------------------
// Keine Lichtberechnung – nur Koordinatentransformation.
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
  vNormal     = uNormalMatrix * aNormal;   // Normal-Matrix = transpose(inverse(Model))
  gl_Position = uProj * uView * world;
}

// --- Fragment Shader ---------------------------------------------------------
// Klassische Phong-Beleuchtung: Diffuse (Lambert) + Specular (Reflect).
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
  vec3 L = normalize(uLightPos - vWorldPos);      // Richtung zur Lichtquelle
  vec3 V = normalize(uViewPos  - vWorldPos);      // Richtung zur Kamera
  vec3 R = reflect(-L, N);                         // Spiegelung von L an N

  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(R, V), 0.0), uShininess);  // Reflect · View

  vec3 color = uAmbient * uColor                   // Ambient
             + diff * uColor * uLightColor         // Diffuse (Lambert)
             + spec * uLightColor;                 // Specular

  fragColor = vec4(color, 1.0);
}
