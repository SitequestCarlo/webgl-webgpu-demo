// Fragment-Shader-Raytracer (WebGL2).
// Iterativer Bounce-Loop (kein Recursion in GLSL ES 300).
// Szene: Bodenebene + 3 analytische Kugeln (diffus, Spiegel, Glas).
// Effekte: harte Schatten, Reflexion, Refraktion (Snell + Schlick-Fresnel).

export const VS_SRC = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FS_SRC = /* glsl */`#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform vec3  uCamPos;
uniform float uTime;

out vec4 fragColor;

// ---- Szene ----------------------------------------------------------------
// Kugel-Materialien: 1=diffus  2=Spiegel  3=Glas  4=Boden(diffus)

struct Hit {
  float t;
  vec3  normal;
  int   mat;
  vec3  albedo;
};

const float INF = 1e20;

bool hitSphere(vec3 ro, vec3 rd, vec3 c, float r, float tmax, out float t) {
  vec3  oc = ro - c;
  float b  = dot(oc, rd);
  float d  = b*b - dot(oc, oc) + r*r;
  if (d < 0.0) return false;
  float sq = sqrt(d);
  t = -b - sq;
  if (t < 0.001 || t > tmax) { t = -b + sq; }
  return t > 0.001 && t < tmax;
}

Hit sceneHit(vec3 ro, vec3 rd) {
  Hit h; h.t = INF; h.mat = 0;

  float t;

  // Boden y = -1.0
  if (abs(rd.y) > 1e-4) {
    float tb = (-1.0 - ro.y) / rd.y;
    if (tb > 0.001 && tb < h.t) {
      h.t      = tb;
      h.normal = vec3(0.0, 1.0, 0.0);
      h.mat    = 4;
      // Schachbrettmuster
      vec3 p = ro + tb * rd;
      bool cb = mod(floor(p.x) + floor(p.z), 2.0) < 1.0;
      h.albedo = cb ? vec3(0.9) : vec3(0.3);
    }
  }

  // Linke Kugel: Spiegel
  if (hitSphere(ro, rd, vec3(-1.1, -0.5, -0.5), 0.5, h.t, t)) {
    h.t      = t;
    h.normal = normalize(ro + t*rd - vec3(-1.1, -0.5, -0.5));
    h.mat    = 2;
    h.albedo = vec3(0.9, 0.9, 0.85);
  }

  // Mittlere Kugel: Glas (IOR=1.5)
  if (hitSphere(ro, rd, vec3(0.0, -0.5, 0.0), 0.5, h.t, t)) {
    h.t      = t;
    h.normal = normalize(ro + t*rd - vec3(0.0, -0.5, 0.0));
    h.mat    = 3;
    h.albedo = vec3(0.95, 0.95, 1.0);
  }

  // Rechte Kugel: diffus rot
  if (hitSphere(ro, rd, vec3(1.1, -0.5, -0.5), 0.5, h.t, t)) {
    h.t      = t;
    h.normal = normalize(ro + t*rd - vec3(1.1, -0.5, -0.5));
    h.mat    = 1;
    h.albedo = vec3(0.85, 0.2, 0.15);
  }

  return h;
}

// Schlick-Fresnel Approximation
float schlick(float cosTheta, float ior) {
  float r0 = (1.0 - ior) / (1.0 + ior);
  r0 *= r0;
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

// Direkte Beleuchtung (Blinn-Phong diffus + harter Schatten)
vec3 directLight(vec3 pos, vec3 N, vec3 albedo) {
  vec3 lightPos   = vec3(2.0, 3.5, 2.0);
  vec3 lightColor = vec3(1.0, 0.97, 0.90) * 5.0;
  vec3 L = normalize(lightPos - pos);
  float NdotL = max(dot(N, L), 0.0);

  // Schatten-Ray
  Hit sh = sceneHit(pos + N * 0.002, L);
  float dist = length(lightPos - pos);
  if (sh.t < dist) NdotL = 0.0;

  return albedo * lightColor * NdotL / (dist * dist) + albedo * 0.05;
}

// Hintergrund: einfacher Himmelsgradient
vec3 sky(vec3 rd) {
  float t = 0.5 * (rd.y + 1.0);
  return mix(vec3(1.0, 0.98, 0.94), vec3(0.47, 0.67, 0.92), t);
}

// Iterativer Bounce-Loop (max. 5 Sprünge)
vec3 trace(vec3 ro, vec3 rd) {
  vec3 color      = vec3(0.0);
  vec3 throughput = vec3(1.0);

  for (int bounce = 0; bounce < 5; bounce++) {
    Hit h = sceneHit(ro, rd);

    if (h.t >= INF) {
      color += throughput * sky(rd);
      break;
    }

    vec3 pos = ro + h.t * rd;
    vec3 N   = h.normal;
    bool inside = dot(N, rd) > 0.0;
    if (inside) N = -N;

    if (h.mat == 1 || h.mat == 4) {
      // Diffus: direkte Beleuchtung, kein weiterer Bounce
      color += throughput * directLight(pos, N, h.albedo);
      break;

    } else if (h.mat == 2) {
      // Spiegel
      color      += throughput * directLight(pos, N, h.albedo) * 0.05;
      throughput *= h.albedo;
      rd = reflect(rd, N);
      ro = pos + N * 0.002;

    } else {
      // Glas: Refraktion + Reflexion via Fresnel
      float ior     = inside ? 1.5 : (1.0 / 1.5);
      float cosI    = abs(dot(N, -rd));
      float fr      = schlick(cosI, ior);
      vec3  refr    = refract(rd, N, ior);

      if (length(refr) < 0.001 || fr > 0.98) {
        // Totalreflexion
        rd = reflect(rd, N);
        ro = pos + N * 0.002;
      } else {
        // Refraktion überwiegt (einfache Entscheidung)
        throughput *= h.albedo;
        rd = normalize(refr);
        ro = pos - N * 0.002;
      }
    }
  }
  return color;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // Kamera-Basis
  vec3 target  = vec3(0.0, -0.2, 0.0);
  vec3 forward = normalize(target - uCamPos);
  vec3 right   = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up      = cross(right, forward);
  vec3 rd      = normalize(forward + uv.x * right + uv.y * up);

  vec3 col = trace(uCamPos, rd);

  // Reinhard + Gamma
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));

  fragColor = vec4(col, 1.0);
}`;
