// pathtracer.glsl – Monte-Carlo Path Tracer (WebGL2 / GLSL ES 3.00)
// Showcase 04: preserveDrawingBuffer + Alpha-Blending als Akkumulations-Hack.
// Szene: Cornell Box – 4 Waende + Boden, kein Dach, 2 AABB-Boxen.
// 2 Bounces – minimal für ANGLE/D3D11 (nur mit blendFunc, nicht blendFuncSeparate).
#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }

// ============================================================
#version 300 es
precision highp float;
precision highp int;
uniform vec2  uResolution;
uniform int   uFrameIndex;
uniform vec3  uCamPos, uCamRight, uCamUp, uCamFwd;
out vec4 fragColor;
const float PI = 3.14159265359;
const float INF = 1e20;
uint rng;
float rand() { rng ^= rng << 13u; rng ^= rng >> 17u; rng ^= rng << 5u; return float(rng) * (1.0 / 4294967296.0); }
vec3 cosineSample(vec3 N) {
  float r1 = rand(), r2 = rand(), phi = 6.28318530 * r1, sq = sqrt(r2);
  vec3 T = normalize(abs(N.x) < 0.9 ? cross(N, vec3(1,0,0)) : cross(N, vec3(0,1,0)));
  vec3 B = cross(N, T);
  return sq * (cos(phi) * T + sin(phi) * B) + sqrt(1.0 - r2) * N;
}
struct Hit { float t; vec3 n; vec3 albedo; };
float hitAABBt(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, float tmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tlo = min(t0, t1), thi = max(t0, t1);
  float te = max(max(tlo.x, tlo.y), tlo.z);
  float tx = min(min(thi.x, thi.y), thi.z);
  if (tx <= max(te, 0.001) || te >= tmax) return -1.0;
  float t = te > 0.001 ? te : tx;
  return t < tmax ? t : -1.0;
}
vec3 aabbNormal(vec3 pos, vec3 bmin, vec3 bmax) {
  vec3 c = (bmin + bmax) * 0.5, h = (bmax - bmin) * 0.5;
  vec3 d = abs((pos - c) / h);
  if (d.x >= d.y && d.x >= d.z) return vec3(sign((pos - c).x), 0.0, 0.0);
  if (d.y >= d.z) return vec3(0.0, sign((pos - c).y), 0.0);
  return vec3(0.0, 0.0, sign((pos - c).z));
}
bool hitYPlane(vec3 ro, vec3 rd, float y, float x0, float x1, float z0, float z1, float tmax, out float t) { if (abs(rd.y) < 1e-6) return false; t = (y - ro.y) / rd.y; if (t < 0.001 || t > tmax) return false; vec3 p = ro + t * rd; return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1; }
bool hitXPlane(vec3 ro, vec3 rd, float x, float y0, float y1, float z0, float z1, float tmax, out float t) { if (abs(rd.x) < 1e-6) return false; t = (x - ro.x) / rd.x; if (t < 0.001 || t > tmax) return false; vec3 p = ro + t * rd; return p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1; }
bool hitZPlane(vec3 ro, vec3 rd, float z, float x0, float x1, float y0, float y1, float tmax, out float t) { if (abs(rd.z) < 1e-6) return false; t = (z - ro.z) / rd.z; if (t < 0.001 || t > tmax) return false; vec3 p = ro + t * rd; return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; }
Hit scene(vec3 ro, vec3 rd) {
  Hit h; h.t = INF; h.albedo = vec3(0); float t;
  if (hitYPlane(ro, rd, -1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(0,1,0);  h.albedo=vec3(0.73); }
  if (hitZPlane(ro, rd, -1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(0,0,1);  h.albedo=vec3(0.73); }
  if (hitXPlane(ro, rd, -1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(1,0,0);  h.albedo=vec3(0.65,0.05,0.05); }
  if (hitXPlane(ro, rd,  1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(-1,0,0); h.albedo=vec3(0.12,0.45,0.15); }
  t = hitAABBt(ro, rd, vec3(-0.65,-1.0,-0.85), vec3(-0.1, 0.3,-0.2), h.t);
  if (t > 0.0) { h.t=t; vec3 p=ro+t*rd; h.n=aabbNormal(p, vec3(-0.65,-1.0,-0.85), vec3(-0.1,0.3,-0.2)); h.albedo=vec3(0.73); }
  t = hitAABBt(ro, rd, vec3(0.1,-1.0,-0.85), vec3(0.65,-0.4,-0.2), h.t);
  if (t > 0.0) { h.t=t; vec3 p=ro+t*rd; h.n=aabbNormal(p, vec3(0.1,-1.0,-0.85), vec3(0.65,-0.4,-0.2)); h.albedo=vec3(0.73); }
  return h;
}
vec3 sky(vec3 rd) { float s = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0); return mix(vec3(0.85, 0.82, 0.75), vec3(0.45, 0.68, 1.0), s * s); }
vec3 pathTrace(vec3 ro, vec3 rd) {
  Hit h0 = scene(ro, rd); if (h0.t >= INF) return sky(rd);
  vec3 tp = h0.albedo;
  vec3 ro1 = ro + h0.t * rd + h0.n * 0.001; vec3 rd1 = cosineSample(h0.n);
  Hit h1 = scene(ro1, rd1); if (h1.t >= INF) return tp * sky(rd1);
  vec3 ro2 = ro1 + h1.t * rd1 + h1.n * 0.001; vec3 rd2 = cosineSample(h1.n);
  Hit h2 = scene(ro2, rd2); if (h2.t >= INF) return tp * h1.albedo * sky(rd2);
  return vec3(0.0);
}
void main() {
  uvec2 px = uvec2(gl_FragCoord.xy);
  rng = px.x * 1664525u + px.y * 22695477u + uint(uFrameIndex) * 719393u;
  rng ^= rng >> 11u; rng ^= rng << 7u; rng ^= rng >> 15u;
  vec2 jitter = vec2(rand() - 0.5, rand() - 0.5);
  vec2 uv = ((gl_FragCoord.xy + jitter) - 0.5 * uResolution) / uResolution.y;
  vec3 rd = normalize(uCamFwd * 1.2 + uv.x * uCamRight + uv.y * uCamUp);
  vec3 s = pathTrace(uCamPos, rd);
  vec3 mapped = s / (s + vec3(1.0));
  mapped = pow(mapped, vec3(1.0 / 2.2));
  float alpha = 1.0 / float(uFrameIndex + 1);
  fragColor = vec4(mapped, alpha);
}