// blinn-phong.glsl – Benchmark Shader (Showcase 05: Draw-Call Overhead)
// Einfacher Blinn-Phong, einmal compiliert, N× pro Frame aufgerufen.
// Der Unterschied WebGL vs. WebGPU liegt NICHT im Shader, sondern im
// API-Overhead des Draw-Calls (uniformMatrix4fv vs. setBindGroup).
#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMatrix;
out vec3 vWorldPos, vNormal;
void main() { vec4 w=uModel*vec4(aPosition,1.0); vWorldPos=w.xyz; vNormal=uNormalMatrix*aNormal; gl_Position=uProj*uView*w; }

// ============================================================
#version 300 es
precision highp float;
in vec3 vWorldPos, vNormal;
uniform vec3 uColor, uLightPos, uViewPos, uLightColor;
uniform float uAmbient, uShininess;
out vec4 fragColor;
void main() {
  vec3 N=normalize(vNormal), L=normalize(uLightPos-vWorldPos), V=normalize(uViewPos-vWorldPos), H=normalize(L+V);
  float diff=max(dot(N,L),0.0), spec=pow(max(dot(N,H),0.0),uShininess);
  fragColor=vec4(uAmbient*uColor+diff*uColor*uLightColor+spec*uLightColor,1.0);
}
