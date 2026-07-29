// simulate.glsl – N-Body Simulation via Texture-Ping-Pong (WebGL2, Showcase 08)
// Positions in RGBA32F-Textur (r,g,b=xyz, a=mass).
// Fragment-Shader = Compute-Hack: N Textur-Fetches pro Fragment → O(N²).
// LIMIT: N ≤ 512 praktikabel (Fragment-Shader-Bottleneck).
#version 300 es
precision highp float;
layout(location=0) in vec2 aUV;
out vec2 vUV;
void main() { vUV=aUV; gl_Position=vec4(aUV*2.0-1.0,0.0,1.0); }

// ============================================================
// N wird als #define eingebaut (buildSimFS() in shaders.ts)
#version 300 es
precision highp float;
#define N 256
in vec2 vUV;
uniform sampler2D uPos;   // RGBA32F: xyz=position, w=mass
uniform sampler2D uVel;   // RGBA32F: xyz=velocity
uniform float uDt, uSoftening;
layout(location=0) out vec4 outPos;
layout(location=1) out vec4 outVel;
void main(){
  vec4 pos=texture(uPos,vUV); vec4 vel=texture(uVel,vUV);
  vec2 texSize=vec2(textureSize(uPos,0));
  vec3 acc=vec3(0.0);
  // O(N²) Textur-Fetches: jedes Partikel liest alle anderen
  for(int i=0;i<N;i++){
    vec2 uv2=(vec2(float(i%int(texSize.x)),float(i/int(texSize.x)))+0.5)/texSize;
    vec4 other=texture(uPos,uv2);
    vec3 d=other.xyz-pos.xyz;
    float dist2=dot(d,d)+uSoftening*uSoftening;
    acc+=d*(other.w*inversesqrt(dist2*dist2*dist2));  // Gravitation
  }
  vel.xyz+=acc*uDt; pos.xyz+=vel.xyz*uDt;
  outPos=pos; outVel=vel;
}
