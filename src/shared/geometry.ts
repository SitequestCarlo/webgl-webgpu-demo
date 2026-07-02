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
export function createUvSphere(
  radius = 1,
  segments = 32,
  rings = 16,
): Geometry {
  segments = Math.max(3, Math.floor(segments));
  rings = Math.max(2, Math.floor(rings));

  const positions: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI; // 0 .. PI
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const theta = u * Math.PI * 2; // 0 .. 2PI
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      const nx = sinPhi * cosTheta;
      const ny = cosPhi;
      const nz = sinPhi * sinTheta;

      // Position
      positions.push(nx * radius, ny * radius, nz * radius);
      // Normale (glatt)
      positions.push(nx, ny, nz);
    }
  }

  const cols = segments + 1;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * cols + x;
      const b = a + cols;
      // Gegen den Uhrzeigersinn von außen betrachtet -> Normalen zeigen nach außen.
      indices.push(a, a + 1, b);
      indices.push(a + 1, b + 1, b);
    }
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 6,
    indexCount: indices.length,
  };
}
