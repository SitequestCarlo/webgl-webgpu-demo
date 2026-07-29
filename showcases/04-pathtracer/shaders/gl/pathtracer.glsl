// pathtracer.glsl - Rendering-Vergleich (WebGL2 / GLSL ES 3.00)
// Showcase 04: preserveDrawingBuffer + Alpha-Blending als Akkumulations-Hack.
// EIN Fragment-Shader, drei Modi (uMode):
//   0 = Whitted-Raytracing : direkte Beleuchtung + harte Schatten + Spiegel/Glas-Rekursion,
//                            KEIN indirektes diffuses Licht (schwarze Ecken).
//   1 = Path Tracing (naiv): volle GI, Licht nur zufaellig getroffen -> stark verrauscht.
//   2 = Path Tracing (NEE)  : volle GI + direkte Lichtstichprobe -> sauberes direktes Licht.
// Szene: Cornell Box + Halbkugel-Lampe + Spiegel-Kugel + Glas-Kugel.
// Material-Typen: 0=Diffus, 1=Spiegel, 2=Glas, 3=Lichtquelle (emissiv).
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
uniform int   uMode;
uniform int   uMaxBounces;
uniform vec3  uCamPos, uCamRight, uCamUp, uCamFwd;
out vec4 fragColor;
const float PI = 3.14159265359;
const float INF = 1e20;
const vec3  LC = vec3(0.0, 1.0, 0.0);   // Lampen-Zentrum (Deckenhoehe)
const float LR = 0.35;                   // Lampen-Radius
const vec3  LE = vec3(4.0);              // Emissions-Radianz
uint rng;
float rand() { rng ^= rng << 13u; rng ^= rng >> 17u; rng ^= rng << 5u; return float(rng) * (1.0 / 4294967296.0); }
vec3 cosineSample(vec3 N) {
  float r1 = rand(), r2 = rand(), phi = 6.28318530 * r1, sq = sqrt(r2);
  vec3 T = normalize(abs(N.x) < 0.9 ? cross(N, vec3(1,0,0)) : cross(N, vec3(0,1,0)));
  vec3 B = cross(N, T);
  return sq * (cos(phi) * T + sin(phi) * B) + sqrt(1.0 - r2) * N;
}
float schlick(float cosT, float ior) {
  float r0 = (1.0 - ior) / (1.0 + ior); r0 *= r0;
  return r0 + (1.0 - r0) * pow(1.0 - cosT, 5.0);
}
struct Hit { float t; vec3 n; vec3 albedo; int mat; };
float hitSphere(vec3 ro, vec3 rd, vec3 c, float r, float tmax) {
  vec3 oc = ro - c; float b = dot(oc, rd), d = b*b - dot(oc,oc) + r*r;
  if (d < 0.0) return -1.0;
  float sq = sqrt(d), t = -b - sq;
  if (t < 0.001) t = -b + sq;
  return (t > 0.001 && t < tmax) ? t : -1.0;
}
bool hitYPlane(vec3 ro, vec3 rd, float y, float x0, float x1, float z0, float z1, float tmax, out float t) { if (abs(rd.y) < 1e-6) return false; t = (y - ro.y) / rd.y; if (t < 0.001 || t > tmax) return false; vec3 p = ro + t * rd; return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1; }
bool hitXPlane(vec3 ro, vec3 rd, float x, float y0, float y1, float z0, float z1, float tmax, out float t) { if (abs(rd.x) < 1e-6) return false; t = (x - ro.x) / rd.x; if (t < 0.001 || t > tmax) return false; vec3 p = ro + t * rd; return p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1; }
bool hitZPlane(vec3 ro, vec3 rd, float z, float x0, float x1, float y0, float y1, float tmax, out float t) { if (abs(rd.z) < 1e-6) return false; t = (z - ro.z) / rd.z; if (t < 0.001 || t > tmax) return false; vec3 p = ro + t * rd; return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; }

Hit scene(vec3 ro, vec3 rd) {
  Hit h; h.t = INF; h.mat = 0; h.albedo = vec3(0); float t;
  if (hitYPlane(ro, rd, -1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(0,1,0);  h.albedo=vec3(0.73);            h.mat=0; }
  if (hitZPlane(ro, rd, -1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(0,0,1);  h.albedo=vec3(0.73);            h.mat=0; }
  if (hitXPlane(ro, rd, -1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(1,0,0);  h.albedo=vec3(0.65,0.05,0.05); h.mat=0; }
  if (hitXPlane(ro, rd,  1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(-1,0,0); h.albedo=vec3(0.12,0.45,0.15); h.mat=0; }
  if (hitYPlane(ro, rd,  1.0,-1.0,1.0,-1.0,1.0, h.t, t)) { h.t=t; h.n=vec3(0,-1,0); h.albedo=vec3(0.8);            h.mat=0; }
  // Halbkugel-Lampe (nur untere Haelfte)
  {
    vec3 oc = ro - LC; float b = dot(oc, rd), disc = b*b - dot(oc,oc) + LR*LR;
    if (disc > 0.0) {
      float sq = sqrt(disc), ta = -b - sq, tb = -b + sq, tl = -1.0;
      if (ta > 0.001 && (ro.y + ta*rd.y) < 1.0)      tl = ta;
      else if (tb > 0.001 && (ro.y + tb*rd.y) < 1.0) tl = tb;
      if (tl > 0.001 && tl < h.t) { h.t = tl; vec3 p = ro + tl*rd; h.n = normalize(p - LC); h.albedo = vec3(1.0); h.mat = 3; }
    }
  }
  t = hitSphere(ro, rd, vec3(-0.45,-0.56,-0.65), 0.44, h.t);
  if (t > 0.0) { h.t=t; h.n=normalize(ro+t*rd-vec3(-0.45,-0.56,-0.65)); h.albedo=vec3(0.9,0.9,0.85);  h.mat=1; }
  t = hitSphere(ro, rd, vec3( 0.40,-0.65,-0.15), 0.35, h.t);
  if (t > 0.0) { h.t=t; h.n=normalize(ro+t*rd-vec3( 0.40,-0.65,-0.15)); h.albedo=vec3(0.95,0.95,1.0); h.mat=2; }
  return h;
}

// Schatten-Ray: true wenn NICHT-Licht-Geometrie den Weg blockiert (Lampe ignoriert)
bool occluded(vec3 P, vec3 wi, float maxDist) {
  float t;
  if (hitYPlane(P, wi, -1.0,-1.0,1.0,-1.0,1.0, maxDist, t)) return true;
  if (hitZPlane(P, wi, -1.0,-1.0,1.0,-1.0,1.0, maxDist, t)) return true;
  if (hitXPlane(P, wi, -1.0,-1.0,1.0,-1.0,1.0, maxDist, t)) return true;
  if (hitXPlane(P, wi,  1.0,-1.0,1.0,-1.0,1.0, maxDist, t)) return true;
  if (hitSphere(P, wi, vec3(-0.45,-0.56,-0.65), 0.44, maxDist) > 0.0) return true;
  if (hitSphere(P, wi, vec3( 0.40,-0.65,-0.15), 0.35, maxDist) > 0.0) return true;
  return false;
}

// Direkte Beleuchtung. hard=true -> fester Lichtpunkt (harte Schatten). hard=false -> Stichprobe (NEE).
vec3 directLight(vec3 P, vec3 N, vec3 albedo, bool hard) {
  vec3 Ls, Ln;
  if (hard) {
    Ls = LC + vec3(0.0, -LR, 0.0); Ln = vec3(0.0, -1.0, 0.0);
  } else {
    float z = -rand();
    float phi = 6.28318530 * rand();
    float r2 = sqrt(max(0.0, 1.0 - z*z));
    vec3 dir = vec3(r2*cos(phi), z, r2*sin(phi));
    Ls = LC + LR * dir; Ln = dir;
  }
  vec3 toL = Ls - P; float dist = length(toL); vec3 wi = toL / dist;
  float cosSurf = max(dot(N, wi), 0.0);
  float cosLight = max(dot(Ln, -wi), 0.0);
  if (cosSurf <= 0.0 || cosLight <= 0.0) return vec3(0.0);
  if (occluded(P + N*0.001, wi, dist - 0.002)) return vec3(0.0);
  float area = 2.0 * PI * LR * LR;
  float G = cosSurf * cosLight / (dist * dist);
  return (albedo / PI) * LE * G * area;
}

vec3 pathTrace(vec3 ro, vec3 rd) {
  vec3 L = vec3(0.0), tp = vec3(1.0);
  bool specular = true;
  for (int b = 0; b < uMaxBounces; b++) {
    Hit h = scene(ro, rd);
    if (h.t >= INF) break;
    if (h.mat == 3) { if (uMode != 2 || specular) L += tp * LE; break; }
    vec3 pos = ro + h.t * rd; vec3 N = h.n;
    bool inside = dot(N, rd) > 0.0; if (inside) N = -N;
    if (h.mat == 1) { tp *= h.albedo; rd = reflect(rd, N); ro = pos + N * 0.001; specular = true; continue; }
    if (h.mat == 2) {
      tp *= h.albedo;
      float ior = inside ? 1.5 : (1.0/1.5);
      vec3 refr = refract(rd, N, ior);
      float fr = schlick(abs(dot(N,-rd)), ior);
      if (length(refr) < 0.001 || fr > 0.98) { rd = reflect(rd, N); ro = pos + N*0.001; }
      else { rd = normalize(refr); ro = pos - N*0.001; }
      specular = true; continue;
    }
    // Diffus
    if (uMode == 0) { L += tp * directLight(pos, N, h.albedo, true); break; }
    if (uMode == 2) { L += tp * directLight(pos, N, h.albedo, false); }
    tp *= h.albedo;
    if (b >= 3) { float q = max(h.albedo.r, max(h.albedo.g, h.albedo.b)); if (rand() > q) break; tp /= q; }
    rd = cosineSample(N); ro = pos + N * 0.001; specular = false;
  }
  return L;
}

void main() {
  uvec2 px = uvec2(gl_FragCoord.xy);
  rng = px.x * 1664525u + px.y * 22695477u + uint(uFrameIndex) * 719393u;
  rng ^= rng >> 11u; rng ^= rng << 7u; rng ^= rng >> 15u;
  // Mehrere Samples pro Frame: fuellt das Bild schneller (v.a. der naive Pfad wird sichtbar)
  const int SPP = 4;
  vec3 s = vec3(0.0);
  for (int k = 0; k < SPP; k++) {
    vec2 jitter = vec2(rand() - 0.5, rand() - 0.5);
    vec2 uv = ((gl_FragCoord.xy + jitter) - 0.5 * uResolution) / uResolution.y;
    vec3 rd = normalize(uCamFwd * 1.2 + uv.x * uCamRight + uv.y * uCamUp);
    vec3 c = pathTrace(uCamPos, rd);
    // Firefly-Clamping: einzelne helle Ausreisser-Samples begrenzen
    float m = max(c.r, max(c.g, c.b));
    if (m > 5.0) c *= 5.0 / m;
    s += c;
  }
  s /= float(SPP);
  vec3 mapped = s / (s + vec3(1.0));
  mapped = pow(mapped, vec3(1.0 / 2.2));
  float alpha = 1.0 / float(uFrameIndex + 1);
  fragColor = vec4(mapped, alpha);
}