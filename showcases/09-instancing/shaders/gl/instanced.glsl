// instanced.glsl – Instanced Rendering via Vertex-Buffer Divisor (WebGL2, Showcase 09)
// Pro-Instanz-Daten (Position, Farbe) im zweiten Vertex-Buffer mit divisor=1.
// Nur 1 Draw-Call für alle N Instanzen: gl.drawElementsInstanced(...)
#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aInstPos;    // per instance (divisor=1)
layout(location=3) in vec3 aInstColor;  // per instance (divisor=1)
uniform mat4 uView, uProj;
uniform vec3 uLightPos, uViewPos;
out vec3 vNormal, vColor, vWorldPos;
void main() {
  vec3 pos=aPosition*0.4+aInstPos;  // Skalieren + an Instanz-Position setzen
  vWorldPos=pos; vNormal=aNormal; vColor=aInstColor;
  gl_Position=uProj*uView*vec4(pos,1.0);
}

// ============================================================
#version 300 es
precision highp float;
in vec3 vNormal,vColor,vWorldPos;
uniform vec3 uLightPos,uViewPos;
out vec4 fragColor;
void main(){
  vec3 N=normalize(vNormal),L=normalize(uLightPos-vWorldPos),V=normalize(uViewPos-vWorldPos),H=normalize(L+V);
  float diff=max(dot(N,L),0.0),spec=pow(max(dot(N,H),0.0),32.0);
  fragColor=vec4(0.1*vColor+diff*vColor+spec,1.0);
}
