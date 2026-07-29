// render.glsl – N-Body Partikel rendern als Point Sprites (WebGL2, Showcase 08)
// Liest Partikel-Positionen aus RGBA32F-Textur via Index-Attribut.
#version 300 es
precision highp float;
layout(location=0) in float aIndex;
uniform sampler2D uPos;
uniform mat4 uViewProj;
uniform float uTexSize;
out vec3 vColor;
void main(){
  int idx=int(aIndex);
  vec2 uv=(vec2(float(idx)-floor(float(idx)/uTexSize)*uTexSize,floor(float(idx)/uTexSize))+0.5)/uTexSize;
  vec4 pos=texture(uPos,uv);
  gl_Position=uViewProj*vec4(pos.xyz,1.0);
  gl_PointSize=2.0;
  float h=float(idx)/float(int(uTexSize)*int(uTexSize));
  vColor=vec3(0.5+0.5*sin(h*6.28),0.3+0.3*cos(h*6.28+2.1),0.5+0.5*sin(h*6.28+4.2));
}

// ============================================================
#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main(){
  vec2 c=gl_PointCoord-0.5;
  if(dot(c,c)>0.25) discard;  // Kreisförmiger Point Sprite
  fragColor=vec4(vColor,0.8);
}
