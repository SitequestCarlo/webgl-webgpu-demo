// heightfield.wgsl – Höhenfeld-Rendering für Z-Map (WebGPU, Showcase 10)
// Zwei Vertex-Einstiegspunkte: vs_surface (Deckel) + vs_skirt (Schürze).
// YS = HEIGHT_SCALE = 0.7: Höhe → Welt-Y-Skalierung.
const YS : f32 = 0.7;

struct Camera {
  view_proj : mat4x4<f32>,
  cam_pos   : vec3<f32>,
  grid_size : f32,
}

@group(0) @binding(0) var<storage, read> zmap : array<f32>;
@group(0) @binding(1) var<uniform>       cam  : Camera;

struct VSOut {
  @builtin(position) clip_pos  : vec4<f32>,
  @location(0)       world_pos : vec3<f32>,
  @location(1)       normal    : vec3<f32>,
  @location(2)       height    : f32,
}

fn read_h(xi : i32, yi : i32) -> f32 {
  let gs = i32(cam.grid_size);
  let x = clamp(xi, 0, gs - 1);
  let y = clamp(yi, 0, gs - 1);
  return zmap[u32(y) * u32(gs) + u32(x)];
}

// Deckel: Höhenfeld-Gitter mit glatter Gradienten-Normale.
@vertex
fn vs_surface(@builtin(vertex_index) vi : u32) -> VSOut {
  let gs  = u32(cam.grid_size);
  let col = i32(vi % gs);
  let row = i32(vi / gs);
  let h   = read_h(col, row);
  let wx  = f32(col) / f32(gs - 1u) * 2.0 - 1.0;
  let wz  = f32(row) / f32(gs - 1u) * 2.0 - 1.0;

  let hl = read_h(col - 1, row);
  let hr = read_h(col + 1, row);
  let hd = read_h(col, row - 1);
  let hu = read_h(col, row + 1);
  let ds = 2.0 / f32(gs - 1u);
  let nx = (hl - hr) * YS / (2.0 * ds);
  let nz = (hd - hu) * YS / (2.0 * ds);

  var out : VSOut;
  out.clip_pos  = cam.view_proj * vec4<f32>(wx, h * YS, wz, 1.0);
  out.world_pos = vec3<f32>(wx, h * YS, wz);
  out.normal    = normalize(vec3<f32>(nx, 1.0, nz));
  out.height    = h;
  return out;
}

// Schürze: vertikale Blockseiten am Domänenrand (x,z = +/-1).
@vertex
fn vs_skirt(@builtin(vertex_index) vi : u32) -> VSOut {
  let gs = i32(cam.grid_size);
  let segPerEdge = u32(gs - 1);
  let quad   = vi / 6u;
  let corner = vi % 6u;
  let edge   = quad / segPerEdge;
  let s      = i32(quad % segPerEdge);

  var g0 = vec2<i32>(0, 0);
  var g1 = vec2<i32>(0, 0);
  var nrm = vec3<f32>(0.0);
  if (edge == 0u)      { g0 = vec2<i32>(s, 0);        g1 = vec2<i32>(s + 1, 0);      nrm = vec3<f32>(0, 0, -1); }
  else if (edge == 1u) { g0 = vec2<i32>(gs-1, s);     g1 = vec2<i32>(gs-1, s+1);     nrm = vec3<f32>(1, 0,  0); }
  else if (edge == 2u) { g0 = vec2<i32>(s+1, gs-1);   g1 = vec2<i32>(s, gs-1);       nrm = vec3<f32>(0, 0,  1); }
  else                 { g0 = vec2<i32>(0, s+1);      g1 = vec2<i32>(0, s);          nrm = vec3<f32>(-1, 0, 0); }

  var g = g0; var top = true;
  if      (corner == 1u) { g = g0; top = false; }
  else if (corner == 2u) { g = g1; top = true;  }
  else if (corner == 3u) { g = g1; top = true;  }
  else if (corner == 4u) { g = g0; top = false; }
  else if (corner == 5u) { g = g1; top = false; }

  let h  = read_h(g.x, g.y);
  let wx = f32(g.x) / f32(gs - 1) * 2.0 - 1.0;
  let wz = f32(g.y) / f32(gs - 1) * 2.0 - 1.0;
  let wy = select(0.0, h * YS, top);

  var out : VSOut;
  out.clip_pos  = cam.view_proj * vec4<f32>(wx, wy, wz, 1.0);
  out.world_pos = vec3<f32>(wx, wy, wz);
  out.normal    = nrm;
  out.height    = 1.0;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  var N = normalize(in.normal);
  let L = normalize(vec3<f32>(0.5, 1.0, 0.6));
  let V = normalize(cam.cam_pos - in.world_pos);
  if (dot(N, V) < 0.0) { N = -N; }
  let H = normalize(L + V);

  // Farbe aus der Höhe: ungefräst (hoch) vs. gefräst (tiefer).
  let raw      = vec3<f32>(0.52, 0.46, 0.38);
  let machined = vec3<f32>(0.82, 0.84, 0.88);
  let base = mix(machined, raw, smoothstep(0.9, 1.0, in.height));

  let hemi = mix(0.12, 0.32, N.y * 0.5 + 0.5);
  let diff = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, H), 0.0), 60.0) * 0.4;
  return vec4<f32>(base * (hemi + diff) + vec3<f32>(spec), 1.0);
}
