// =============================================================================
// simulate.wgsl – N-Body Gravitations-Simulation (WebGPU Compute, Showcase 08)
//
// Jeder Thread berechnet die Gesamtkraft auf EIN Partikel (global_invocation_id).
// Workgroup-Größe 64: 64 Threads laufen parallel auf der GPU.
//
// Komplexität: O(N²) – jedes Partikel liest alle anderen.
// Vergleich WebGL: Fragment-Shader-Hack via RGBA32F-Textur, max ~512 Partikel.
// Hier: echter GPU-Compute, N = 4096+ interaktiv möglich.
// =============================================================================

struct Particle {
    pos: vec4<f32>,   // xyz = Position, w = Masse
    vel: vec4<f32>,   // xyz = Geschwindigkeit
}

@group(0) @binding(0) var<storage, read>       inBuf:  array<Particle>;  // Eingabe (Lesen)
@group(0) @binding(1) var<storage, read_write> outBuf: array<Particle>;  // Ausgabe (Schreiben)
@group(0) @binding(2) var<uniform>             uN:     u32;               // Partikelanzahl
@group(0) @binding(3) var<uniform>             simU:   vec4<f32>;         // x=dt, y=softening

@compute @workgroup_size(64)   // 64 Threads parallel pro Workgroup
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uN) { return; }   // Letzter Teil-Workgroup: überschüssige Threads abbrechen

    let pi  = inBuf[i];
    var acc = vec3<f32>(0.0);

    // O(N²): Jedes Partikel liest alle anderen und summiert die Gravitationskraft.
    for (var j = 0u; j < uN; j++) {
        if (j == i) { continue; }           // Kein Selbst-Einfluss
        let pj = inBuf[j];
        let d  = pj.pos.xyz - pi.pos.xyz;  // Richtungsvektor
        let d2 = dot(d, d) + simU.y * simU.y;  // |d|² + softening² (verhindert Singularität)
        acc += d * (pj.pos.w * inverseSqrt(d2 * d2 * d2));  // Newtonsche Gravitation
    }

    // Euler-Integration: v(t+dt) = v(t) + a·dt,  x(t+dt) = x(t) + v·dt
    let vel = pi.vel.xyz + acc * simU.x;
    let pos = pi.pos.xyz + vel * simU.x;
    outBuf[i] = Particle(vec4<f32>(pos, pi.pos.w), vec4<f32>(vel, 0.0));
}
