// vertex-heavy.glsl – Heavy Vertex Shader: 8 sin/cos-Ops pro Vertex (Showcase 06)
// Simuliert teure Vertex-Berechnungen (z.B. Skinning, Morphing).
// Ab ~1M Dreiecken wird die GPU vertex-bound → messbar höhere GPU-Zeit.
#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition; layout(location=1) in vec3 aNormal;
uniform mat4 uModel,uView,uProj; uniform mat3 uNormalMatrix;
uniform float uTime;
out vec3 vWorldPos,vNormal;
void main(){
  // Teure Displacement-Berechnung (simuliert Skinning/Morphing)
  vec3 pos=aPosition;
  for(int i=0;i<8;i++){
    float fi=float(i+1);
    pos+=aNormal*sin(aPosition.x*fi+uTime)*cos(aPosition.y*fi+uTime)*sin(aPosition.z*fi+uTime)*0.02;
  }
  vec4 w=uModel*vec4(pos,1.0); vWorldPos=w.xyz; vNormal=uNormalMatrix*aNormal;
  gl_Position=uProj*uView*w;
}

// ============================================================
#version 300 es
precision highp float;
in vec3 vWorldPos,vNormal;
uniform vec3 uColor,uLightPos,uViewPos,uLightColor; uniform float uAmbient,uShininess;
out vec4 fragColor;
void main(){vec3 N=normalize(vNormal),L=normalize(uLightPos-vWorldPos),V=normalize(uViewPos-vWorldPos),H=normalize(L+V);float diff=max(dot(N,L),0.0),spec=pow(max(dot(N,H),0.0),uShininess);fragColor=vec4(uAmbient*uColor+diff*uColor*uLightColor+spec*uLightColor,1.0);}
