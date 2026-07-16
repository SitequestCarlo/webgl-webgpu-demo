// =============================================================================
// instanced.wgsl – Instanced Rendering via Storage Buffer (WebGPU, Showcase 09)
//
// Alle N Instanzen werden mit EINEM einzigen Draw-Call gerendert.
// Pro-Instanz-Daten (Position, Farbe) liegen in einem Storage Buffer,
// der über @builtin(instance_index) adressiert wird.
//
// Vorteil gegenüber WebGL-Instancing: Storage Buffer kann auch von
// Compute-Shadern beschrieben werden → GPU-Simulation ohne CPU-Roundtrip.
// =============================================================================

struct InstanceData {
    pos:   vec4<f32>,   // xyz = Weltposition,  w unused
    color: vec4<f32>,   // xyz = Farbe,         w unused
}

struct Uniforms {
    view:     mat4x4<f32>,
    proj:     mat4x4<f32>,
    lightPos: vec4<f32>,
    viewPos:  vec4<f32>,
}

@group(0) @binding(0) var<uniform>       u:         Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<InstanceData>;  // GPU-beschreibbar!

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0)       wp:   vec3<f32>,   // Weltposition
    @location(1)       n:    vec3<f32>,   // Normale
    @location(2)       col:  vec3<f32>,   // Instanz-Farbe
}

@vertex
fn vs(
    @location(0) pos:  vec3<f32>,
    @location(1) norm: vec3<f32>,
    @builtin(instance_index) inst: u32,  // Index in den Storage Buffer
) -> VsOut {
    let d  = instances[inst];
    let wp = pos * 0.4 + d.pos.xyz;     // Skalieren auf 40% + an Instanz-Position setzen
    var o: VsOut;
    o.clip = u.proj * u.view * vec4<f32>(wp, 1.0);
    o.wp   = wp;
    o.n    = norm;
    o.col  = d.color.xyz;
    return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let N    = normalize(in.n);
    let L    = normalize(u.lightPos.xyz - in.wp);
    let V    = normalize(u.viewPos.xyz  - in.wp);
    let H    = normalize(L + V);
    let diff = max(dot(N, L), 0.0);
    let spec = pow(max(dot(N, H), 0.0), 32.0);
    return vec4<f32>(0.1 * in.col + diff * in.col + spec, 1.0);
}

