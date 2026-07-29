// =============================================================================
// pbr.glsl – PBR Material-Grid, Cook-Torrance BRDF (WebGL2 / GLSL ES 3.00)
// Showcase 02: Identischer Shader für alle 36 Kugeln – Roughness + Metallic
// werden als Uniforms übergeben und ändern sich pro Draw-Call.
// =============================================================================
#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMatrix;
out vec3 vWorldPos, vNormal;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz; vNormal = uNormalMatrix * aNormal;
  gl_Position = uProj * uView * world;
}

// =============================================================================
// Fragment: Cook-Torrance BRDF – D (GGX) · G (Schlick-Smith) · F (Schlick)
// Reinhard Tone-Mapping + Gamma-Korrektur im Shader.
// =============================================================================
#version 300 es
precision highp float;
in vec3 vWorldPos, vNormal;
uniform vec3  uAlbedo, uLightPos, uViewPos, uLightColor;
uniform float uAmbient, uRoughness, uMetallic;
out vec4 fragColor;
const float PI = 3.14159265359;
float distGGX(float NdotH, float a2) { float d=NdotH*NdotH*(a2-1.0)+1.0; return a2/(PI*d*d); }
float geomSchlick(float v, float k) { return v/(v*(1.0-k)+k); }
vec3 fresnelSchlick(float cosT, vec3 F0) { return F0+(1.0-F0)*pow(clamp(1.0-cosT,0.0,1.0),5.0); }
void main() {
  vec3 N=normalize(vNormal), V=normalize(uViewPos-vWorldPos), L=normalize(uLightPos-vWorldPos), H=normalize(V+L);
  float NdotL=max(dot(N,L),0.0), NdotV=max(dot(N,V),0.0), NdotH=max(dot(N,H),0.0), HdotV=max(dot(H,V),0.0);
  float a=uRoughness*uRoughness, a2=a*a, k=((uRoughness+1.0)*(uRoughness+1.0))/8.0;
  vec3 F0=mix(vec3(0.04),uAlbedo,uMetallic);
  vec3 spec=(distGGX(NdotH,a2)*geomSchlick(NdotV,k)*geomSchlick(NdotL,k)*fresnelSchlick(HdotV,F0))/max(4.0*NdotV*NdotL,0.001);
  vec3 kD=(1.0-fresnelSchlick(HdotV,F0))*(1.0-uMetallic);
  vec3 Lo=(kD*uAlbedo/PI+spec)*uLightColor*NdotL;
  vec3 color=uAmbient*uAlbedo+Lo;
  color=color/(color+vec3(1.0)); color=pow(color,vec3(1.0/2.2));  // Reinhard + Gamma
  fragColor=vec4(color,1.0);
}
