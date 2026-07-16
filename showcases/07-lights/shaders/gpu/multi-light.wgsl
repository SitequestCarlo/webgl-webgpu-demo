// =============================================================================
// multi-light.wgsl – N Lichter via Storage Buffer (WebGPU, Showcase 07)
//
// Vorteil gegenüber WebGL: Die Lichtanzahl ist dynamisch – kein Compile-Zeit-
// Limit wie bei WebGL-Uniform-Arrays. Neue Lichter können zur Laufzeit
// hinzugefügt werden ohne Shader-Neucompilierung.
// =============================================================================

// Ein Licht: Position + Farbe (je vec3 + 4-Byte-Padding für 16-Byte-Alignment)
struct Light {
    pos:   vec3<f32>,
    _p0:   f32,
    color: vec3<f32>,
    _p1:   f32,
}

struct Scene {
    view:      mat4x4<f32>,
    proj:      mat4x4<f32>,
    model:     mat4x4<f32>,
    normalMat: mat4x4<f32>,
    viewPos:   vec4<f32>,
    ambient:   f32,
    shininess: f32,
    numLights: u32,         // Laufzeit-Wert, kein Compile-Zeit-Limit!
    _p:        u32,
}

@group(0) @binding(0) var<uniform>       scene:  Scene;
@group(0) @binding(1) var<storage, read> lights: array<Light>;  // Dynamisches Array!

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0)       wp:   vec3<f32>,
    @location(1)       n:    vec3<f32>,
}

@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>) -> VsOut {
    let w = scene.model * vec4<f32>(pos, 1.0);
    var o: VsOut;
    o.clip = scene.proj * scene.view * w;
    o.wp   = w.xyz;
    o.n    = (scene.normalMat * vec4<f32>(norm, 0.0)).xyz;
    return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let N = normalize(in.n);
    let V = normalize(scene.viewPos.xyz - in.wp);

    var col = vec3<f32>(scene.ambient * 0.5);  // Ambient-Beitrag

    // Loop über alle Lichter – Laufzeit-N, kein Compile-Zeit-Limit!
    for (var i = 0u; i < scene.numLights; i++) {
        let L   = normalize(lights[i].pos - in.wp);
        let H   = normalize(L + V);
        let d   = length(lights[i].pos - in.wp);

        // Quadratische Abschwächung (physikalisch korrekt)
        let att = 1.0 / (1.0 + 0.09 * d + 0.032 * d * d);

        let diff = max(dot(N, L), 0.0);
        let spec = pow(max(dot(N, H), 0.0), scene.shininess);

        // Feste Materialfarbe (violett), skaliert mit Lichtfarbe
        col += att * (diff * vec3<f32>(0.55, 0.17, 0.51) * lights[i].color
                    + spec * lights[i].color);
    }
    return vec4<f32>(col, 1.0);
}

