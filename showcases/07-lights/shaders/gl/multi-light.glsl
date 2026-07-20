// multi-light.glsl – N Punkt-Lichtquellen, Blinn-Phong (WebGL2, Showcase 07)
// EINSCHRÄNKUNG: MAX_LIGHTS muss als Compile-Zeit-Konstante in den Shader.
// Änderung der Lichtanzahl ohne Shader-Rebuild ist nicht möglich.
#version 300 es
precision highp float;
layout(location=0)in vec3 aPosition; layout(location=1)in vec3 aNormal;
uniform mat4 uModel,uView,uProj; uniform mat3 uNormalMatrix;
out vec3 vWorldPos,vNormal;
void main(){vec4 w=uModel*vec4(aPosition,1.0);vWorldPos=w.xyz;vNormal=uNormalMatrix*aNormal;gl_Position=uProj*uView*w;}

// ============================================================
// MAX_LIGHTS wird beim Compile ersetzt (siehe buildFragShader() in shaders.ts)
#version 300 es
precision highp float;
#define MAX_LIGHTS 1024
in vec3 vWorldPos,vNormal;
uniform vec3 uViewPos; uniform float uAmbient,uShininess; uniform int uNumLights;
uniform vec3 uLightPos[MAX_LIGHTS];    // Array fester Größe – WebGL-Limitation
uniform vec3 uLightColor[MAX_LIGHTS];
out vec4 fragColor;
void main(){
  vec3 N=normalize(vNormal),V=normalize(uViewPos-vWorldPos);
  vec3 col=vec3(uAmbient*0.5);
  for(int i=0;i<uNumLights;i++){   // Loop über N Lichter
    vec3 L=normalize(uLightPos[i]-vWorldPos),H=normalize(L+V);
    float d=length(uLightPos[i]-vWorldPos);
    float att=1.0/(1.0+0.09*d+0.032*d*d);
    col+=att*(max(dot(N,L),0.0)*vec3(0.55,0.17,0.51)*uLightColor[i]+pow(max(dot(N,H),0.0),uShininess)*uLightColor[i]);
  }
  fragColor=vec4(col,1.0);
}
