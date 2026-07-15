// WebGPU Compute-Shader Raytracer.
// Identische Szene wie WebGL-Version, aber:
//   - Compute-Shader: ein Workgroup-Invocation pro Pixel
//   - Frame-Akkumulation: progressives Anti-Aliasing durch jittered Rays
//   - Mehr Bounces möglich (kein Fragment-Shader-Limit)
//   - Blit-Pass: Storage-Buffer → Fullscreen-Quad mit Tone-Mapping

// Compute-Shader: schreibt in Akkumulations-Buffer (RGBA32F, 4 floats/Pixel)
export const COMPUTE_SRC = /* wgsl */`
struct Params {
    resolution:  vec2<u32>,
    frameIndex:  u32,
    _pad:        u32,
    camPos:      vec4<f32>,
    camForward:  vec4<f32>,
    camRight:    vec4<f32>,
    camUp:       vec4<f32>,
}

@group(0) @binding(0) var<uniform>            params:  Params;
@group(0) @binding(1) var<storage, read_write> accum:   array<vec4<f32>>;

// ---- Szene (identisch mit WebGL-Version) --------------------------------

struct Hit {
    t:      f32,
    normal: vec3<f32>,
    mat:    u32,      // 1=diffus 2=Spiegel 3=Glas 4=Boden
    albedo: vec3<f32>,
}

fn hitSphere(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: f32, tmax: f32) -> f32 {
    let oc = ro - c;
    let b  = dot(oc, rd);
    let d  = b*b - dot(oc, oc) + r*r;
    if (d < 0.0) { return -1.0; }
    let sq = sqrt(d);
    var t  = -b - sq;
    if (t < 0.001 || t > tmax) { t = -b + sq; }
    if (t < 0.001 || t > tmax) { return -1.0; }
    return t;
}

fn sceneHit(ro: vec3<f32>, rd: vec3<f32>) -> Hit {
    var h: Hit;
    h.t   = 1e20;
    h.mat = 0u;

    // Boden y = -1.0
    if (abs(rd.y) > 1e-4) {
        let tb = (-1.0 - ro.y) / rd.y;
        if (tb > 0.001 && tb < h.t) {
            h.t      = tb;
            h.normal = vec3<f32>(0.0, 1.0, 0.0);
            h.mat    = 4u;
            let p    = ro + tb * rd;
            // Bitweise gerade/ungerade statt float-%, damit negative Koordinaten korrekt sind.
            let ix   = i32(floor(p.x));
            let iz   = i32(floor(p.z));
            let cb   = (ix + iz) % 2 == 0;
            h.albedo = select(vec3<f32>(0.3), vec3<f32>(0.9), cb);
        }
    }

    // Linke Kugel: Spiegel
    let t1 = hitSphere(ro, rd, vec3<f32>(-1.1, -0.5, -0.5), 0.5, h.t);
    if (t1 > 0.0) {
        h.t = t1; h.normal = normalize(ro + t1*rd - vec3<f32>(-1.1, -0.5, -0.5));
        h.mat = 2u; h.albedo = vec3<f32>(0.9, 0.9, 0.85);
    }
    // Mittlere Kugel: Glas
    let t2 = hitSphere(ro, rd, vec3<f32>(0.0, -0.5, 0.0), 0.5, h.t);
    if (t2 > 0.0) {
        h.t = t2; h.normal = normalize(ro + t2*rd - vec3<f32>(0.0, -0.5, 0.0));
        h.mat = 3u; h.albedo = vec3<f32>(0.95, 0.95, 1.0);
    }
    // Rechte Kugel: diffus
    let t3 = hitSphere(ro, rd, vec3<f32>(1.1, -0.5, -0.5), 0.5, h.t);
    if (t3 > 0.0) {
        h.t = t3; h.normal = normalize(ro + t3*rd - vec3<f32>(1.1, -0.5, -0.5));
        h.mat = 1u; h.albedo = vec3<f32>(0.85, 0.2, 0.15);
    }
    return h;
}

fn schlick(cosT: f32, ior: f32) -> f32 {
    var r0 = (1.0 - ior) / (1.0 + ior); r0 *= r0;
    return r0 + (1.0 - r0) * pow(1.0 - cosT, 5.0);
}

fn directLight(pos: vec3<f32>, N: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
    let lp  = vec3<f32>(2.0, 3.5, 2.0);
    let lc  = vec3<f32>(1.0, 0.97, 0.90) * 5.0;
    let L   = normalize(lp - pos);
    var NdL = max(dot(N, L), 0.0);
    let sh  = sceneHit(pos + N * 0.002, L);
    let d   = length(lp - pos);
    if (sh.t < d) { NdL = 0.0; }
    return albedo * lc * NdL / (d * d) + albedo * 0.05;
}

fn sky(rd: vec3<f32>) -> vec3<f32> {
    let t = 0.5 * (rd.y + 1.0);
    return mix(vec3<f32>(1.0, 0.98, 0.94), vec3<f32>(0.47, 0.67, 0.92), t);
}

// Einfacher Hash für Jitter (Weyl-Sequenz)
fn hash(n: u32) -> f32 {
    let x = n * 1664525u + 1013904223u;
    return f32(x) / 4294967296.0;
}

fn trace(ro_in: vec3<f32>, rd_in: vec3<f32>) -> vec3<f32> {
    var color      = vec3<f32>(0.0);
    var throughput = vec3<f32>(1.0);
    var ro = ro_in;
    var rd = rd_in;

    for (var bounce = 0u; bounce < 7u; bounce++) {
        let h = sceneHit(ro, rd);
        if (h.t >= 1e20) { color += throughput * sky(rd); break; }

        let pos    = ro + h.t * rd;
        let inside = dot(h.normal, rd) > 0.0;
        let N      = select(h.normal, -h.normal, inside);

        if (h.mat == 1u || h.mat == 4u) {
            color += throughput * directLight(pos, N, h.albedo); break;
        } else if (h.mat == 2u) {
            color      += throughput * directLight(pos, N, h.albedo) * 0.04;
            throughput *= h.albedo;
            rd = reflect(rd, N); ro = pos + N * 0.002;
        } else {
            // refract() erwartet eta = n1/n2:
            // Eintreten (inside=false): eta = 1/1.5 (Luft → Glas)
            // Austreten  (inside=true):  eta = 1.5   (Glas → Luft)
            let ior  = select(1.0/1.5, 1.5, inside);
            let cosI = abs(dot(N, -rd));
            let fr   = schlick(cosI, ior);
            let refr = refract(rd, N, ior);
            if (length(refr) < 0.001 || fr > 0.95) {
                rd = reflect(rd, N); ro = pos + N * 0.002;
            } else {
                throughput *= h.albedo;
                rd = normalize(refr); ro = pos - N * 0.002;
            }
        }
    }
    return color;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let W = params.resolution.x;
    let H = params.resolution.y;
    if (gid.x >= W || gid.y >= H) { return; }

    let idx   = gid.y * W + gid.x;
    let seed  = idx * 1973u + params.frameIndex * 9277u;

    // Jittered Ray für Anti-Aliasing
    let jx    = hash(seed)         - 0.5;
    let jy    = hash(seed + 1u)    - 0.5;
    // WebGPU: gid.y=0 ist oben (Y-down), WebGL: gl_FragCoord.y=0 ist unten (Y-up).
    // uv.y muss negiert werden, damit der Himmel oben erscheint.
    let uv = vec2<f32>(
        (f32(gid.x) + jx - 0.5 * f32(W)) / f32(H),
        (0.5 * f32(H) - f32(gid.y) - jy) / f32(H),
    );

    let rd    = normalize(params.camForward.xyz
                        + uv.x * params.camRight.xyz
                        + uv.y * params.camUp.xyz);

    let color = trace(params.camPos.xyz, rd);
    accum[idx] += vec4<f32>(color, 1.0);
}
`;

// Blit-Vertex-Shader: Fullscreen-Dreieck (kein Vertex-Buffer nötig)
export const BLIT_VS = /* wgsl */`
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(i & 1u) * 4 - 1);
    let y = f32(i32(i & 2u) * 2 - 1);
    return vec4<f32>(x, y, 0.0, 1.0);
}
`;

// Blit-Fragment-Shader: liest Akkumulations-Buffer, normiert, Tone-Map, Gamma
export const BLIT_FS = /* wgsl */`
struct BlitParams { resolution: vec2<u32>, _pad: vec2<u32> }

@group(0) @binding(0) var<storage, read> accum:  array<vec4<f32>>;
@group(0) @binding(1) var<uniform>       bparams: BlitParams;

@fragment fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let idx   = u32(pos.y) * bparams.resolution.x + u32(pos.x);
    let a     = accum[idx];
    var color = select(a.xyz / a.w, vec3<f32>(0.0), a.w < 0.5);
    color = color / (color + vec3<f32>(1.0));
    color = pow(color, vec3<f32>(1.0 / 2.2));
    return vec4<f32>(color, 1.0);
}
`;
