// =============================================================================
// pbr.glsl – Physically Based Rendering (Cook-Torrance BRDF)
// WebGL2 / GLSL ES 3.00
//
// Microfacet-BRDF: Die Oberfläche besteht aus zufällig ausgerichteten
// Mikro-Spiegeln. Zwei physikalische Parameter beschreiben das Material:
//   - Roughness (0 = perfekter Spiegel, 1 = vollständig matt)
//   - Metallic  (0 = Dielektrikum/Plastik, 1 = Metall)
//
// BRDF-Komponenten:
//   D = GGX/Trowbridge-Reitz  – Verteilung der Mikrofacetten-Normalen
//   G = Schlick-Smith          – Geometrie-Maskierung (Selbstverschattung)
//   F = Schlick Fresnel        – Reflektivität abhängig vom Einfallswinkel
//
// Energie-Erhaltung: kD * Diffuse + kS * Specular ≤ 1
//   kS = F (Fresnel)
//   kD = (1 - F) * (1 - Metallic)  → Metalle haben keinen diffusen Anteil
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
// Cook-Torrance BRDF: Lo = (kD * diffuse + kS * specular) * Li * NdotL
#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;

uniform vec3  uColor;       // Albedo (Basisfarbe)
uniform vec3  uLightPos;
uniform vec3  uViewPos;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform float uRoughness;   // [0.05, 1.0]
uniform float uMetallic;    // [0.0,  1.0]

out vec4 fragColor;

const float PI = 3.14159265359;

// GGX Normal Distribution Function: Mikrofacetten-Ausrichtung
float distributionGGX(float NdotH, float roughness) {
  float a  = roughness * roughness;
  float a2 = a * a;
  float d  = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

// Schlick-Smith Geometry Term: Selbstverschattung der Mikrofacetten
float geometrySchlick(float NdotX, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotX / (NdotX * (1.0 - k) + k);
}

// Schlick Fresnel: Reflektivität steigt bei streifendem Licht
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uViewPos  - vWorldPos);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float HdotV = max(dot(H, V), 0.0);

  // F0: Basisreflektivität. Dielektrikum = grau (0.04), Metall = Albedo-Farbe
  vec3 F0 = mix(vec3(0.04), uColor, uMetallic);

  float D = distributionGGX(NdotH, uRoughness);
  float G = geometrySchlick(NdotV, uRoughness) * geometrySchlick(NdotL, uRoughness);
  vec3  F = fresnelSchlick(HdotV, F0);

  // Specular Cook-Torrance: (D * G * F) / (4 * NdotV * NdotL)
  vec3 specular = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);

  // Diffuse Lambert: nur Dielektrika haben Diffuse (Metalle absorbieren alles)
  vec3 kD      = (1.0 - F) * (1.0 - uMetallic);
  vec3 diffuse = kD * uColor / PI;

  vec3 Lo = (diffuse + specular) * uLightColor * NdotL;
  fragColor = vec4(uAmbient * uColor + Lo, 1.0);
}
