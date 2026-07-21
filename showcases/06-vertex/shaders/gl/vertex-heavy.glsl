// vertex-heavy.glsl – Heavy Vertex Shader: 8 sin/cos-Ops pro Vertex (Showcase 06)
// Skalare Akkumulation identisch zu vertex-heavy.wgsl → fairer WebGL/WebGPU-Vergleich.
#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition; layout(location=1) in vec3 aNormal;
uniform mat4 uModel,uView,uProj; uniform mat3 uNormalMatrix;
out vec3 vWorldPos,vNormal;
void main(){
  float d=0.0;
  for(int i=0;i<8;i++){
    float fi=float(i+1);
    d+=sin(aPosition.x*fi)*cos(aPosition.y*fi)*sin(aPosition.z*fi)*0.02;
  }
  vec3 pos=aPosition+aNormal*d;
  vec4 w=uModel*vec4(pos,1.0); vWorldPos=w.xyz; vNormal=uNormalMatrix*aNormal;
  gl_Position=uProj*uView*w;
}

// ============================================================
#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;

uniform vec3  uColor, uLightPos, uViewPos, uLightColor;
uniform float uAmbient, uShininess;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos  - vWorldPos);
  vec3 H = normalize(L + V);

  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), uShininess);

  fragColor = vec4(
    uAmbient * uColor
    + diff * uColor * uLightColor
    + spec * uLightColor, 1.0);
}

