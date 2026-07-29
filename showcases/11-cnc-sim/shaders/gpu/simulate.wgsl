// simulate.wgsl – CNC Z-Map Abtragssimulation (WebGPU Compute, Showcase 11)
// Berechnet pro Pixel ob das Werkzeug Material abtraegt und aktualisiert die Z-Map.
// WG_SIZE=8 → 8×8 Threads pro Workgroup (optimaler Footprint für Quadrat-Dispatch).
struct ToolUniforms {
  pos_x     : f32, pos_y   : f32, cut_z  : f32, radius  : f32,
  tool_type : u32, zmap_size: u32, offset_x: u32, offset_y: u32,
}

@group(0) @binding(0) var<storage, read_write> zmap : array<f32>;
@group(0) @binding(1) var<uniform>             tool : ToolUniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let ix = gid.x + tool.offset_x;
  let iy = gid.y + tool.offset_y;
  let sz = tool.zmap_size;
  if (ix >= sz || iy >= sz) { return; }

  let px = (f32(ix) + 0.5) / f32(sz) * 2.0 - 1.0;
  let py = (f32(iy) + 0.5) / f32(sz) * 2.0 - 1.0;
  let dx = px - tool.pos_x;
  let dy = py - tool.pos_y;
  let dist2 = dx * dx + dy * dy;
  let r = tool.radius;
  if (dist2 > r * r) { return; }

  var tool_z : f32;
  if (tool.tool_type == 0u) {
    tool_z = tool.cut_z;                            // Flachfräser
  } else {
    tool_z = tool.cut_z + r - sqrt(r * r - dist2); // Kugelkopffräser
  }

  let idx = iy * sz + ix;
  if (tool_z < zmap[idx]) { zmap[idx] = tool_z; }
}
