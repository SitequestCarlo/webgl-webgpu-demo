// =============================================================================
// raytracer.glsl – Fragment-Shader Raytracer (WebGL2 / GLSL ES 3.00)
// Showcase 03: Analytischer Raytracer ohne Compute-Shader-Unterstützung.
//
// Architektur:
//   Vertex-Shader: Fullscreen-Quad (2 Dreiecke), keine Transformation.
//   Fragment-Shader: Jeder Fragment berechnet einen vollständigen Ray-Trace.
//
// Szene: Schachbrett-Boden (y = -1) + 3 Kugeln:
//   mat=1  Diffus   (rot)
//   mat=2  Spiegel  (silber)
//   mat=3  Glas     (IOR = 1.5, Snell + Schlick-Fresnel)
//   mat=4  Boden    (Schachbrett, direkte Beleuchtung)
//
// Iterativer Bounce-Loop (max 5): GLSL ES 300 erlaubt keine Rekursion.
// =============================================================================

// --- Vertex Shader -----------------------------------------------------------
// Gibt die Position der Fullscreen-Quad-Vertices unverändert aus.
#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}

// --- Fragment Shader ---------------------------------------------------------
// Jeder Pixel = ein Primärstrahl. Beleuchtung: direkte Lichtquelle + Reflexion.
// ============================================================
#version 300 es
precision highp float;

uniform vec2 uResolution;  // Viewport-Auflösung (px)
uniform vec3 uCamPos;      // Kameraposition (Orbit-Kamera)
uniform float uTime;       // Zeit (aktuell ungenutzt, reserviert für Animation)

out vec4 fragColor;

const float INF = 1e20;

// ---------------------------------------------------------------------------
// Hilfs-Funktionen
// ---------------------------------------------------------------------------

// Analytischer Kugel-Schnitt: gibt Schnitzdistanz t zurück.
// Löst quadratische Gleichung |ro + t*rd - c|² = r².
bool hitSphere(vec3 ro, vec3 rd, vec3 c, float r, float tmax, out float t) {
  vec3 oc = ro - c;
  float b  = dot(oc, rd);
  float d  = b * b - dot(oc, oc) + r * r;
  if (d < 0.0) return false;
  float sq = sqrt(d);
  t = -b - sq;
  if (t < 0.001 || t > tmax) { t = -b + sq; }
  return t > 0.001 && t < tmax;
}

// Material-Hit-Struktur
struct Hit {
  float t;     // Schnitzdistanz
  vec3  n;     // Oberflächen-Normale (zeigt nach außen)
  int   mat;   // Material: 1=diffus, 2=spiegel, 3=glas, 4=boden
  vec3  albedo; // Reflexions-/Durchlassfarbe
};

// Schnittpunkt mit allen Szenen-Objekten.
// Gibt den nächstgelegenen Treffer zurück.
Hit sceneHit(vec3 ro, vec3 rd) {
  Hit h;
  h.t   = INF;
  h.mat = 0;
  float t;

  // Schachbrett-Boden (unendliche Y-Ebene bei y = -1)
  if (abs(rd.y) > 1e-4) {
    float tb = (-1.0 - ro.y) / rd.y;
    if (tb > 0.001 && tb < h.t) {
      h.t   = tb;
      h.n   = vec3(0, 1, 0);
      h.mat = 4;
      vec3 p = ro + tb * rd;
      bool cb = mod(floor(p.x) + floor(p.z), 2.0) < 1.0;
      h.albedo = cb ? vec3(0.9) : vec3(0.3);
    }
  }

  // Spiegel-Kugel (links hinten)
  if (hitSphere(ro, rd, vec3(-1.1, -0.5, -0.5), 0.5, h.t, t)) {
    h.t = t;  h.n = normalize(ro + t * rd - vec3(-1.1, -0.5, -0.5));
    h.mat = 2;  h.albedo = vec3(0.9, 0.9, 0.85);
  }
  // Glas-Kugel (mittig)
  if (hitSphere(ro, rd, vec3(0.0, -0.5, 0.0), 0.5, h.t, t)) {
    h.t = t;  h.n = normalize(ro + t * rd - vec3(0.0, -0.5, 0.0));
    h.mat = 3;  h.albedo = vec3(0.95, 0.95, 1.0);
  }
  // Diffuse Kugel (rechts hinten)
  if (hitSphere(ro, rd, vec3(1.1, -0.5, -0.5), 0.5, h.t, t)) {
    h.t = t;  h.n = normalize(ro + t * rd - vec3(1.1, -0.5, -0.5));
    h.mat = 1;  h.albedo = vec3(0.85, 0.2, 0.15);
  }
  return h;
}

// Schlick-Fresnel: Näherung für den Reflexionsanteil an einer Grenzfläche.
float schlick(float cosT, float ior) {
  float r0 = (1.0 - ior) / (1.0 + ior);
  r0 *= r0;
  return r0 + (1.0 - r0) * pow(1.0 - cosT, 5.0);
}

// Himmel-Gradient (Horizont warm-weiß → Zenit hellblau)
vec3 sky(vec3 rd) {
  float t = 0.5 * (rd.y + 1.0);
  return mix(vec3(1.0, 0.98, 0.94), vec3(0.47, 0.67, 0.92), t);
}

// Direkte Beleuchtung: Lambertian + Schatten-Ray zur Lichtquelle.
vec3 directLight(vec3 pos, vec3 N, vec3 albedo) {
  vec3  lp  = vec3(2.0, 3.5, 2.0);           // Lichtposition (Welt-Raum)
  vec3  L   = normalize(lp - pos);
  float NdL = max(dot(N, L), 0.0);

  // Schatten-Test: trifft der Shadow-Ray etwas vor der Lichtquelle?
  Hit sh = sceneHit(pos + N * 0.002, L);
  if (sh.t < length(lp - pos)) NdL = 0.0;   // im Schatten

  // Physikalisches Falloff: Intensität ∝ 1 / |d|²
  return albedo * vec3(1.0, 0.97, 0.90) * 5.0 * NdL / dot(lp - pos, lp - pos)
       + albedo * 0.05;                        // Ambient-Term
}

// ---------------------------------------------------------------------------
// Hauptalgorithmus: Iterativer Bounce-Loop
// ---------------------------------------------------------------------------
// Verfolgt den Strahl durch max. 5 Reflexionen/Brechungen.
// Keine Rekursion möglich in GLSL ES 300 → Schleife mit explizitem Zustand.
vec3 trace(vec3 ro, vec3 rd) {
  vec3 color      = vec3(0.0);
  vec3 throughput = vec3(1.0);  // Akkumulierter Transmissionsterm

  for (int b = 0; b < 5; b++) {
    Hit h = sceneHit(ro, rd);

    // Kein Treffer → Himmel leuchtet
    if (h.t >= INF) { color += throughput * sky(rd); break; }

    vec3  pos    = ro + h.t * rd;
    vec3  N      = h.n;
    bool  inside = dot(N, rd) > 0.0;   // Ray kommt von innen (z.B. Glas-Austritt)
    if (inside) N = -N;                 // Normale immer gegen den Ray

    if (h.mat == 1 || h.mat == 4) {
      // Diffuse / Boden: direkte Beleuchtung berechnen, dann Stop.
      color += throughput * directLight(pos, N, h.albedo);
      break;

    } else if (h.mat == 2) {
      // Spiegel: kleiner Diffuse-Anteil + perfekte Reflexion
      color += throughput * directLight(pos, N, h.albedo) * 0.05;
      throughput *= h.albedo;
      rd = reflect(rd, N);
      ro = pos + N * 0.002;

    } else {
      // Glas: Snell'sches Gesetz + Schlick-Fresnel-Überprüfung
      float ior  = inside ? 1.5 : (1.0 / 1.5);  // Eintreten vs. Austreten
      float cosI = abs(dot(N, -rd));
      float fr   = schlick(cosI, ior);           // Fresnel-Reflexionsanteil
      vec3  refr = refract(rd, N, ior);

      if (length(refr) < 0.001 || fr > 0.98) {
        // Totalreflexion oder fast-totale Reflexion → spiegeln
        rd = reflect(rd, N);
        ro = pos + N * 0.002;
      } else {
        // Brechung (Transmission)
        throughput *= h.albedo;
        rd = normalize(refr);
        ro = pos - N * 0.002;  // Leicht INside verschieben
      }
    }
  }
  return color;
}

// ---------------------------------------------------------------------------
// Fragment-Main: UV-Mapping → Kamera-Ray → Trace → Tone-Mapping
// ---------------------------------------------------------------------------
void main() {
  // UV: [-aspect, aspect] × [-1, 1] (Höhe = 1 normiert)
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // Orbit-Kamera: Kamerakoordinatensystem aus Position + Blickrichtung
  vec3 fwd   = normalize(vec3(0.0, -0.2, 0.0) - uCamPos);
  vec3 right = normalize(cross(fwd, vec3(0, 1, 0)));
  vec3 up    = cross(right, fwd);
  vec3 rd    = normalize(fwd + uv.x * right + uv.y * up);

  // Ray-Trace + Reinhard Tone-Mapping + Gamma-Korrektur
  vec3 col = trace(uCamPos, rd);
  col = col / (col + vec3(1.0));          // Reinhard
  col = pow(col, vec3(1.0 / 2.2));       // Gamma (sRGB)
  fragColor = vec4(col, 1.0);
}
