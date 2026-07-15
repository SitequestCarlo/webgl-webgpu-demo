// GLSL-ES-300-Shader für fünf Shading-Modi. Alle nutzen dieselben
// Vertex-Attribute (Position an Location 0, Normale an Location 1) und
// dieselben Transform-Uniforms, damit ein fairer Vergleich möglich ist.
//
// - none:        reine Basisfarbe, keine Beleuchtung
// - flat:        Beleuchtung pro Vertex, mit `flat`-Interpolation -> eine Farbe
//                pro Fläche (Provoking-Vertex)
// - gouraud:     Beleuchtung pro Vertex (Blinn-Phong), Farbe wird interpoliert
// - phong:       Beleuchtung pro Fragment, Specular via Reflect-Vektor (klassisch)
// - blinn-phong: Beleuchtung pro Fragment, Specular via Half-Vector (moderner Standard)
// - toon:        Quantisierte Beleuchtung (Stufen) + Silhouetten-Rim
// - pbr:         Cook-Torrance Microfacet-BRDF (GGX/Schlick) mit Roughness + Metallic

export type ShadingMode = "none" | "flat" | "gouraud" | "phong" | "blinn-phong" | "toon" | "pbr";

export const SHADING_MODES: ShadingMode[] = ["none", "flat", "gouraud", "phong", "blinn-phong", "toon", "pbr"];

// Gemeinsamer Uniform-Block für alle Vertex-Shader.
const VS_UNIFORMS = /* glsl */ `
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMatrix;
`;

// Uniforms + Diffuse, die beide Beleuchtungsmodelle teilen.
const LIGHTING_COMMON = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform vec3 uLightColor;
uniform float uAmbient;
uniform float uShininess;

vec3 diffuseAmbient(vec3 N, vec3 L) {
  float diff = max(dot(N, L), 0.0);
  return uAmbient * uColor + diff * uColor * uLightColor;
}
`;

// Klassisches Phong: Specular über den Reflect-Vektor.
const LIGHTING_PHONG = LIGHTING_COMMON + /* glsl */ `
vec3 shadingPhong(vec3 N, vec3 worldPos) {
  vec3 L = normalize(uLightPos - worldPos);
  vec3 V = normalize(uViewPos - worldPos);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), uShininess);
  return diffuseAmbient(N, L) + spec * uLightColor;
}
`;

// Blinn-Phong: Specular über den Half-Vector (stabiler, heute Standard).
const LIGHTING_BLINNPHONG = LIGHTING_COMMON + /* glsl */ `
vec3 shadingBlinnPhong(vec3 N, vec3 worldPos) {
  vec3 L = normalize(uLightPos - worldPos);
  vec3 V = normalize(uViewPos - worldPos);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), uShininess);
  return diffuseAmbient(N, L) + spec * uLightColor;
}
`;

// Alias für Flat und Gouraud (nutzen Blinn-Phong).
const LIGHTING_FN = LIGHTING_BLINNPHONG.replace("shadingBlinnPhong", "blinnPhong");

// Vertex-Shader, der Weltposition und Normale weiterreicht
// (für none, flat, phong).
const VS_PASS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
${VS_UNIFORMS}
out vec3 vWorldPos;
out vec3 vNormal;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = uNormalMatrix * aNormal;
  gl_Position = uProj * uView * world;
}
`;

const FS_NONE = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(uColor, 1.0);
}
`;

// Flat: Beleuchtung pro Vertex, aber mit `flat`-Qualifier -> die Farbe des
// Provoking-Vertex gilt für das ganze Dreieck (eine Farbe pro Fläche).
const VS_FLAT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
${VS_UNIFORMS}
${LIGHTING_FN}
flat out vec3 vColor;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec3 N = normalize(uNormalMatrix * aNormal);
  vColor = blinnPhong(N, world.xyz);
  gl_Position = uProj * uView * world;
}
`;

const FS_FLAT = /* glsl */ `#version 300 es
precision highp float;
flat in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}
`;

const FS_PHONG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
${LIGHTING_PHONG}
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  fragColor = vec4(shadingPhong(N, vWorldPos), 1.0);
}
`;

const FS_BLINNPHONG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
${LIGHTING_BLINNPHONG}
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  fragColor = vec4(shadingBlinnPhong(N, vWorldPos), 1.0);
}
`;

// Gouraud: Beleuchtung im Vertex-Shader, Farbe interpoliert.
const VS_GOURAUD = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
${VS_UNIFORMS}
${LIGHTING_FN}
out vec3 vColor;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec3 N = normalize(uNormalMatrix * aNormal);
  vColor = blinnPhong(N, world.xyz);
  gl_Position = uProj * uView * world;
}
`;

const FS_GOURAUD = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Toon: Beleuchtungsstärke in diskrete Stufen quantisiert + Silhouetten-Rim.
// ---------------------------------------------------------------------------
const FS_TOON = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
uniform vec3 uColor;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform vec3 uLightColor;
uniform float uAmbient;
uniform float uToonSteps;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos - vWorldPos);

  // Diffuse quantisiert.
  float diff = max(dot(N, L), 0.0);
  float stepped = floor(diff * uToonSteps) / uToonSteps;
  vec3 color = (uAmbient + stepped) * uColor * uLightColor;

  // Silhouette: Rim-Dunkel wo Normale von Kamera weg zeigt.
  float rim = dot(N, V);
  if (rim < 0.25) color = vec3(0.0);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

// ---------------------------------------------------------------------------
// PBR: Cook-Torrance Microfacet-BRDF
//   D  = GGX / Trowbridge-Reitz Normal Distribution
//   G  = Schlick-Smith Geometry Masking
//   F  = Schlick Fresnel
// ---------------------------------------------------------------------------
const FS_PBR = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
uniform vec3 uColor;      // Albedo
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform vec3 uLightColor;
uniform float uAmbient;
uniform float uRoughness;
uniform float uMetallic;
out vec4 fragColor;

const float PI = 3.14159265359;

float distributionGGX(float NdotH, float roughness) {
  float a  = roughness * roughness;
  float a2 = a * a;
  float d  = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

float geometrySchlickGGX(float NdotX, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotX / (NdotX * (1.0 - k) + k);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
  vec3 N   = normalize(vNormal);
  vec3 V   = normalize(uViewPos - vWorldPos);
  vec3 L   = normalize(uLightPos - vWorldPos);
  vec3 H   = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float HdotV = max(dot(H, V), 0.0);

  // F0: Basisreflektivität. Dielektrikum = 0.04, Metall = Albedo-Farbe.
  vec3 F0 = mix(vec3(0.04), uColor, uMetallic);

  float D = distributionGGX(NdotH, uRoughness);
  float G = geometrySchlickGGX(NdotV, uRoughness) * geometrySchlickGGX(NdotL, uRoughness);
  vec3  F = fresnelSchlick(HdotV, F0);

  // Specular Cook-Torrance.
  vec3 specular = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);

  // Diffuse (Lambert). Metalle haben keinen diffusen Anteil (kS verbraucht alles).
  vec3 kD = (1.0 - F) * (1.0 - uMetallic);
  vec3 diffuse = kD * uColor / PI;

  vec3 Lo = (diffuse + specular) * uLightColor * NdotL;
  vec3 ambient = uAmbient * uColor;

  fragColor = vec4(ambient + Lo, 1.0);
}
`;

export interface ShaderSource {
  vertex: string;
  fragment: string;
}

export const SHADER_SOURCES: Record<ShadingMode, ShaderSource> = {
  none: { vertex: VS_PASS, fragment: FS_NONE },
  flat: { vertex: VS_FLAT, fragment: FS_FLAT },
  gouraud: { vertex: VS_GOURAUD, fragment: FS_GOURAUD },
  phong: { vertex: VS_PASS, fragment: FS_PHONG },
  "blinn-phong": { vertex: VS_PASS, fragment: FS_BLINNPHONG },
  toon: { vertex: VS_PASS, fragment: FS_TOON },
  pbr: { vertex: VS_PASS, fragment: FS_PBR },
};

// Uniform-Namen, die je Programm abgefragt werden (nicht vorhandene
// liefern null und werden ignoriert).
export const UNIFORM_NAMES = [
  "uModel",
  "uView",
  "uProj",
  "uNormalMatrix",
  "uColor",
  "uLightPos",
  "uViewPos",
  "uLightColor",
  "uAmbient",
  "uShininess",
  "uToonSteps",
  "uRoughness",
  "uMetallic",
] as const;
