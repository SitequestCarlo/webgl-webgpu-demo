// Standalone PBR-Shader für Showcase 02.
// Cook-Torrance Microfacet-BRDF:
//   D = GGX Normal Distribution
//   G = Schlick-Smith Geometry Masking
//   F = Schlick Fresnel
// Reinhard Tone Mapping + Gamma-Korrektur im Fragment-Shader.

export const VS_SRC = /* glsl */ `#version 300 es
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
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = uNormalMatrix * aNormal;
  gl_Position = uProj * uView * world;
}
`;

export const FS_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;

uniform vec3  uAlbedo;
uniform vec3  uLightPos;
uniform vec3  uViewPos;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform float uRoughness;
uniform float uMetallic;

out vec4 fragColor;

const float PI = 3.14159265359;

// GGX Normal Distribution
float distributionGGX(float NdotH, float a2) {
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

// Schlick-Smith Geometry term (single direction)
float geometrySchlick(float NdotX, float k) {
  return NdotX / (NdotX * (1.0 - k) + k);
}

// Schlick Fresnel
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uViewPos - vWorldPos);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float HdotV = max(dot(H, V), 0.0);

  // GGX parameters
  float a     = uRoughness * uRoughness;
  float a2    = a * a;
  float r     = uRoughness + 1.0;
  float k     = (r * r) / 8.0;

  // F0: Dielektrikum = 0.04, Metall = Albedo-Farbe
  vec3 F0 = mix(vec3(0.04), uAlbedo, uMetallic);

  float D = distributionGGX(NdotH, a2);
  float G = geometrySchlick(NdotV, k) * geometrySchlick(NdotL, k);
  vec3  F = fresnelSchlick(HdotV, F0);

  // Cook-Torrance Specular
  vec3 specular = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);

  // Lambert Diffuse (Metall hat keinen diffusen Anteil)
  vec3 kD      = (1.0 - F) * (1.0 - uMetallic);
  vec3 diffuse = kD * uAlbedo / PI;

  vec3 Lo    = (diffuse + specular) * uLightColor * NdotL;
  vec3 color = uAmbient * uAlbedo + Lo;

  // Reinhard Tone Mapping + Gamma-Korrektur (sRGB)
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));

  fragColor = vec4(color, 1.0);
}
`;

export const UNIFORM_NAMES = [
  "uModel",
  "uView",
  "uProj",
  "uNormalMatrix",
  "uAlbedo",
  "uLightPos",
  "uViewPos",
  "uLightColor",
  "uAmbient",
  "uRoughness",
  "uMetallic",
] as const;
