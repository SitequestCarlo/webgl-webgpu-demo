// =============================================================================
// blit.wgsl – Blit-Pass: Akkumulations-Buffer → Tone-Mapping → Screen
// Showcase 03 + 04 (WebGPU): Liest HDR-Akkumulation, normiert, gibt sRGB aus.
//
// Der Akkumulations-Buffer speichert die Summe aller Samples pro Pixel.
// Beim Blit-Pass wird der Mittelwert (sum / sampleCount) berechnet.
// =============================================================================

// Fullscreen-Dreieck ohne Vertex-Buffer: Index → Clip-Position.
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(i & 1u) * 4 - 1);
    let y = f32(i32(i & 2u) * 2 - 1);
    return vec4<f32>(x, y, 0.0, 1.0);
}

struct BlitParams {
    resolution: vec2<u32>,
    _pad:       vec2<u32>,
}

@group(0) @binding(0) var<storage, read> accum:   array<vec4<f32>>;
@group(0) @binding(1) var<uniform>       bparams: BlitParams;

@fragment
fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let idx = u32(pos.y) * bparams.resolution.x + u32(pos.x);
    let a   = accum[idx];

    var color = select(a.xyz / a.w, vec3<f32>(0.0), a.w < 0.5);
    color = color / (color + vec3<f32>(1.0));   // Reinhard Tone-Mapping
    color = pow(color, vec3<f32>(1.0 / 2.2));    // Gamma-Korrektur (sRGB)
    return vec4<f32>(color, 1.0);
}

