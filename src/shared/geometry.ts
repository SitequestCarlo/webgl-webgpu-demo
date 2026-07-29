// Geometrie-Erzeugung ohne Framework. Liefert verschachtelte Attribute
// (Position + Normale) plus Index-Buffer, damit dieselben Daten für alle
// Shading-Modi verwendet werden können.

export interface Geometry {
  // Interleaved: [px, py, pz, nx, ny, nz] pro Vertex.
  vertices: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

// Einzelnes Dreieck in der xy-Ebene, Normale zeigt in +z.
export function createTriangle(): Geometry {
  const vertices = new Float32Array([
    // Position            Normale
    0.0, 0.9, 0.0, 0.0, 0.0, 1.0,
    -0.9, -0.7, 0.0, 0.0, 0.0, 1.0,
    0.9, -0.7, 0.0, 0.0, 0.0, 1.0,
  ]);
  const indices = new Uint32Array([0, 1, 2]);
  return { vertices, indices, vertexCount: 3, indexCount: 3 };
}

// UV-Kugel mit einstellbarer Tessellierung. Normalen sind glatt
// (= normalisierte Position), Flat-Shading wird im Fragment-Shader
// über Ableitungen berechnet.
// Einheits-Würfel: 24 Vertices (4 pro Fläche), 36 Indices.
export function createCube(size = 1): Geometry {
  const h = size / 2;
  const v = [
    // +X
     h,-h,-h,1,0,0,  h, h,-h,1,0,0,  h, h, h,1,0,0,  h,-h, h,1,0,0,
    // -X
    -h,-h, h,-1,0,0, -h, h, h,-1,0,0, -h, h,-h,-1,0,0, -h,-h,-h,-1,0,0,
    // +Y
    -h, h,-h,0,1,0,  -h, h, h,0,1,0,  h, h, h,0,1,0,  h, h,-h,0,1,0,
    // -Y
    -h,-h, h,0,-1,0, -h,-h,-h,0,-1,0, h,-h,-h,0,-1,0,  h,-h, h,0,-1,0,
    // +Z
    -h,-h, h,0,0,1,  h,-h, h,0,0,1,  h, h, h,0,0,1,  -h, h, h,0,0,1,
    // -Z
     h,-h,-h,0,0,-1, -h,-h,-h,0,0,-1, -h, h,-h,0,0,-1, h, h,-h,0,0,-1,
  ];
  const idx: number[] = [];
  for (let f = 0; f < 6; f++) { const b = f*4; idx.push(b,b+1,b+2,b,b+2,b+3); }
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx), vertexCount: 24, indexCount: 36 };
}

export function createUvSphere(
  radius = 1,
  segments = 32,
  rings = 16,
): Geometry {
  segments = Math.max(3, Math.floor(segments));
  rings = Math.max(2, Math.floor(rings));

  const cols = segments + 1;
  const rows = rings + 1;
  const vertexCount = cols * rows;
  const indexCount  = segments * rings * 6;

  if (indexCount > 0xffff_ffff) {
    throw new Error(`createUvSphere: indexCount ${indexCount} überschreitet den Uint32-Bereich.`);
  }

  // Direkt in typisierte Arrays schreiben (kein number[]-Zwischenpuffer) — erlaubt
  // sehr große Meshes (z. B. Vertex-Throughput-Benchmark) ohne JS-Heap-Explosion.
  const vertices = new Float32Array(vertexCount * 6);
  const indices  = new Uint32Array(indexCount);

  let p = 0;
  for (let y = 0; y < rows; y++) {
    const v = y / rings;
    const phi = v * Math.PI; // 0 .. PI
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let x = 0; x < cols; x++) {
      const u = x / segments;
      const theta = u * Math.PI * 2; // 0 .. 2PI
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      const nx = sinPhi * cosTheta;
      const ny = cosPhi;
      const nz = sinPhi * sinTheta;

      // Position
      vertices[p++] = nx * radius;
      vertices[p++] = ny * radius;
      vertices[p++] = nz * radius;
      // Normale (glatt)
      vertices[p++] = nx;
      vertices[p++] = ny;
      vertices[p++] = nz;
    }
  }

  let i = 0;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * cols + x;
      const b = a + cols;
      // Gegen den Uhrzeigersinn von außen betrachtet -> Normalen zeigen nach außen.
      indices[i++] = a;
      indices[i++] = a + 1;
      indices[i++] = b;
      indices[i++] = a + 1;
      indices[i++] = b + 1;
      indices[i++] = b;
    }
  }

  return {
    vertices,
    indices,
    vertexCount,
    indexCount,
  };
}
