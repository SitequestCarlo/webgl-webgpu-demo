// =============================================================================
// raytracer.glsl – Fragment-Shader Raytracer (WebGL2 / GLSL ES 3.00)
// Showcase 03: Kein Compute verfügbar → Raytracing im Fragment-Shader.
// Fullscreen-Quad: jeder Fragment = ein Pixel-Ray.
// Szene: Schachbrett-Boden + 3 Kugeln (diffus, Spiegel, Glas IOR=1.5).
// Iterativer Bounce-Loop (max 5): kein Recursion in GLSL ES 300.
// =============================================================================
#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }

// =============================================================================
#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uCamPos;
uniform float uTime;
out vec4 fragColor;
const float INF = 1e20;

// Ray-Kugel Schnitt (analytisch)
bool hitSphere(vec3 ro, vec3 rd, vec3 c, float r, float tmax, out float t) {
  vec3 oc=ro-c; float b=dot(oc,rd), d=b*b-dot(oc,oc)+r*r;
  if(d<0.0) return false;
  float sq=sqrt(d); t=-b-sq;
  if(t<0.001||t>tmax){t=-b+sq;}
  return t>0.001&&t<tmax;
}

struct Hit { float t; vec3 n; int mat; vec3 albedo; };

Hit sceneHit(vec3 ro, vec3 rd) {
  Hit h; h.t=INF; h.mat=0;
  float t;
  // Boden y=-1: Schachbrett
  if(abs(rd.y)>1e-4){ float tb=(-1.0-ro.y)/rd.y; if(tb>0.001&&tb<h.t){ h.t=tb; h.n=vec3(0,1,0); h.mat=4; vec3 p=ro+tb*rd; bool cb=mod(floor(p.x)+floor(p.z),2.0)<1.0; h.albedo=cb?vec3(0.9):vec3(0.3); } }
  if(hitSphere(ro,rd,vec3(-1.1,-0.5,-0.5),0.5,h.t,t)){ h.t=t; h.n=normalize(ro+t*rd-vec3(-1.1,-0.5,-0.5)); h.mat=2; h.albedo=vec3(0.9,0.9,0.85); }  // Spiegel
  if(hitSphere(ro,rd,vec3(0.0,-0.5,0.0),0.5,h.t,t)) { h.t=t; h.n=normalize(ro+t*rd-vec3(0.0,-0.5,0.0));  h.mat=3; h.albedo=vec3(0.95,0.95,1.0); }   // Glas
  if(hitSphere(ro,rd,vec3(1.1,-0.5,-0.5),0.5,h.t,t)) { h.t=t; h.n=normalize(ro+t*rd-vec3(1.1,-0.5,-0.5)); h.mat=1; h.albedo=vec3(0.85,0.2,0.15); }  // Diffus
  return h;
}

float schlick(float cosT, float ior) { float r0=(1.0-ior)/(1.0+ior); r0*=r0; return r0+(1.0-r0)*pow(1.0-cosT,5.0); }
vec3 sky(vec3 rd) { float t=0.5*(rd.y+1.0); return mix(vec3(1.0,0.98,0.94),vec3(0.47,0.67,0.92),t); }
vec3 directLight(vec3 pos, vec3 N, vec3 albedo) {
  vec3 lp=vec3(2.0,3.5,2.0); vec3 L=normalize(lp-pos);
  float NdL=max(dot(N,L),0.0); Hit sh=sceneHit(pos+N*0.002,L);
  if(sh.t<length(lp-pos)) NdL=0.0;
  return albedo*vec3(1.0,0.97,0.90)*5.0*NdL/dot(lp-pos,lp-pos)+albedo*0.05;
}

// Iterativer Bounce-Loop (max 5 Sprünge, kein Recursion!)
vec3 trace(vec3 ro, vec3 rd) {
  vec3 color=vec3(0.0), throughput=vec3(1.0);
  for(int b=0; b<5; b++) {
    Hit h=sceneHit(ro,rd);
    if(h.t>=INF){ color+=throughput*sky(rd); break; }
    vec3 pos=ro+h.t*rd; vec3 N=h.n; bool inside=dot(N,rd)>0.0; if(inside) N=-N;
    if(h.mat==1||h.mat==4){ color+=throughput*directLight(pos,N,h.albedo); break; }
    else if(h.mat==2){ color+=throughput*directLight(pos,N,h.albedo)*0.05; throughput*=h.albedo; rd=reflect(rd,N); ro=pos+N*0.002; }
    else { // Glas: Snell + Schlick-Fresnel
      float ior=inside?1.5:(1.0/1.5); float cosI=abs(dot(N,-rd)); float fr=schlick(cosI,ior);
      vec3 refr=refract(rd,N,ior);
      if(length(refr)<0.001||fr>0.98){ rd=reflect(rd,N); ro=pos+N*0.002; }
      else { throughput*=h.albedo; rd=normalize(refr); ro=pos-N*0.002; }
    }
  }
  return color;
}

void main() {
  vec2 uv=(gl_FragCoord.xy-0.5*uResolution)/uResolution.y;
  vec3 fwd=normalize(vec3(0.0,-0.2,0.0)-uCamPos);
  vec3 right=normalize(cross(fwd,vec3(0,1,0))); vec3 up=cross(right,fwd);
  vec3 rd=normalize(fwd+uv.x*right+uv.y*up);
  vec3 col=trace(uCamPos,rd);
  col=col/(col+vec3(1.0)); col=pow(col,vec3(1.0/2.2));
  fragColor=vec4(col,1.0);
}
