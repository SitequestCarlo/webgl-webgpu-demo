// =============================================================================
// simulate.wgsl – N-Body Gravitations-Simulation (WebGPU Compute, Showcase 08)
//
// Jeder Thread berechnet die Gesamtkraft auf EIN Partikel.
// Komplexität: O(N²) – jedes Partikel liest alle anderen.
//
// Optimierung: Workgroup Shared Memory Tiling (GPU Gems 3, Kap. 31)
// ─────────────────────────────────────────────────────────────────
// Problem ohne Tiling: jeder der 4096 Threads liest 4096 × 16B = 64KB aus dem
// globalen Storage Buffer → L1 Data Cache (~10 TB/s pro SM, aber 46 SMs teilen
// sich die Zugriffe bei nur 64 Workgroups → geringe Occupancy).
//
// Mit Tiling:
//   1. N/64 Runden: alle 64 Threads einer Workgroup laden kooperativ
//      64 Positionen in Shared Memory (1 globaler Read pro Thread pro Runde)
//   2. Alle 64 Threads lesen die 64 gecachten Positionen aus Shared Memory
//      (~100 TB/s, vergleichbar mit dem dedizierten L1 Texture Cache der TMUs)
//   Globale Reads: N/64 statt N → 64× weniger globale Bandbreite benötigt.
//
// Override-Konstante N: wird via constants:{N:n} bei createComputePipeline gesetzt.
// TILE muss gleich @workgroup_size sein (64); alle Benchmark-N sind Vielfache von 64.
// =============================================================================

override N: u32 = 256u;
const TILE:  u32 = 64u;   // = @workgroup_size; muss übereinstimmen

struct Particle { pos: vec4<f32>, vel: vec4<f32> }

@group(0) @binding(0) var<storage, read>       inBuf:  array<Particle>;
@group(0) @binding(1) var<storage, read_write> outBuf: array<Particle>;
@group(0) @binding(2) var<uniform>             simU:   vec4<f32>;  // x=dt, y=softening

// 1 KB Shared Memory pro Workgroup: 64 Positionen × vec4<f32> = 64 × 16B
var<workgroup> tile: array<vec4<f32>, 64>;

@compute @workgroup_size(64)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id)  lid: vec3<u32>,
) {
    let i  = gid.x;
    let li = lid.x;
    // Kein Guard nötig: alle Benchmark-N sind Vielfache von 64 →
    // dispatch(N/64) erzeugt genau N Threads, i < N immer garantiert.
    // (workgroupBarrier() verbietet non-uniform early-returns laut WGSL-Spec)

    let pi  = inBuf[i];
    var acc = vec3<f32>(0.0);

    let numTiles = (N + TILE - 1u) / TILE;
    for (var t = 0u; t < numTiles; t++) {

        // ── Kooperatives Laden in Shared Memory ────────────────────────────
        // Jeder der 64 Threads lädt genau 1 Position (1 globaler Read/Runde).
        // select() füllt mit vec4(0) auf falls N kein Vielfaches von TILE ist.
        let j = t * TILE + li;
        tile[li] = select(vec4<f32>(0.0), inBuf[j].pos, j < N);
        workgroupBarrier();  // alle Threads haben geladen → Shared Memory konsistent

        // ── Kräfte aus Shared Memory berechnen ─────────────────────────────
        // Branchlos: wenn k==i → d=0 → Kraftbeitrag=0 (Selbstkraft algebraisch null).
        // Wenn j>=N → tile[k].w=0 (kein Masse) → Kraftbeitrag=0.
        for (var k = 0u; k < TILE; k++) {
            let pj = tile[k];                               // Shared Memory: ~100 TB/s
            let d  = pj.xyz - pi.pos.xyz;
            let d2 = dot(d, d) + simU.y * simU.y;          // |d|² + softening²
            acc += d * (pj.w * inverseSqrt(d2 * d2 * d2)); // Newtonsche Gravitation
        }
        workgroupBarrier();  // vor dem nächsten tile[]-Überschreiben
    }

    // Euler-Integration
    let vel = pi.vel.xyz + acc * simU.x;
    let pos = pi.pos.xyz + vel * simU.x;
    outBuf[i] = Particle(vec4<f32>(pos, pi.pos.w), vec4<f32>(vel, 0.0));
}


