// Tri-Dexel-Extraktion + Dual Contouring.
//
// Ablauf:
//   1. Das SDF wird auf einem regulären Gitter ((N+1)^3 Punkte) abgetastet.
//   2. Tri-Dexel: entlang der drei Achsen (X, Y, Z) werden alle Gitterkanten mit
//      Vorzeichenwechsel gesucht. Für jede wird der EXAKTE Schnittpunkt (per
//      Bisektion auf dem echten SDF) und die Normale (SDF-Gradient) bestimmt.
//      Diese Punkt+Normale-Paare sind die Hermite-Daten der Tri-Dexel-Struktur.
//   3. Dual Contouring: pro Zelle wird aus ihren Kanten-Hermite-Daten via QEF
//      (quadratische Fehlerfunktion) EIN optimaler Vertex platziert. Für jede
//      Kante mit Vorzeichenwechsel werden die Vertices der vier angrenzenden
//      Zellen zu einem Quad verbunden.
//
// Ergebnis: ein indiziertes Dreiecksnetz mit glatten Normalen. Senkrechte Wände
// und runde Konturen entstehen exakt, weil die Hermite-Daten subvoxelgenau sind.

import type { Scene } from "./field";

export interface Mesh {
  vertices: Float32Array; // interleaved: pos(3) + normal(3)
  indices: Uint32Array;
  points: Float32Array; // Tri-Dexel-Schnittpunkte: pos(3) + achse(1)
  vertexCount: number;
  indexCount: number;
  triangleCount: number;
  pointCount: number;
}

// Würfel-Ecken: Bit0=x, Bit1=y, Bit2=z
const CORNER = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
// 12 Kanten als Eckenpaare
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // entlang X
  [0, 2], [1, 3], [4, 6], [5, 7], // entlang Y
  [0, 4], [1, 5], [2, 6], [3, 7], // entlang Z
];

export function extractDualContour(scene: Scene, n: number): Mesh {
  const sdf = scene.sdf;
  const { min, max } = scene.bounds;
  const p = n + 1; // Gitterpunkte je Achse
  const hx = (max[0] - min[0]) / n;
  const hy = (max[1] - min[1]) / n;
  const hz = (max[2] - min[2]) / n;
  const eps = Math.min(hx, hy, hz) * 0.5;

  const gx = (i: number): number => min[0] + i * hx;
  const gy = (j: number): number => min[1] + j * hy;
  const gz = (k: number): number => min[2] + k * hz;

  // --- 1. Feld abtasten ---
  const field = new Float32Array(p * p * p);
  const fi = (i: number, j: number, k: number): number => (k * p + j) * p + i;
  for (let k = 0; k < p; k++) {
    const z = gz(k);
    for (let j = 0; j < p; j++) {
      const y = gy(j);
      for (let i = 0; i < p; i++) {
        field[fi(i, j, k)] = sdf(gx(i), y, z);
      }
    }
  }

  // Normale = normalisierter SDF-Gradient (zentrale Differenz auf echtem Feld)
  const gradInto = (x: number, y: number, z: number, out: Float32Array, o: number): void => {
    let nx = sdf(x + eps, y, z) - sdf(x - eps, y, z);
    let ny = sdf(x, y + eps, z) - sdf(x, y - eps, z);
    let nz = sdf(x, y, z + eps) - sdf(x, y, z - eps);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    out[o] = nx; out[o + 1] = ny; out[o + 2] = nz;
  };

  // Exakter Kanten-Schnittpunkt zwischen zwei Gitterpunkten a und b (Bisektion).
  const cross = new Float32Array(3);
  const findCrossing = (
    ax: number, ay: number, az: number, va: number,
    bx: number, by: number, bz: number,
  ): void => {
    let lo = 0, hi = 1;
    const sa = va < 0;
    for (let s = 0; s < 6; s++) {
      const t = (lo + hi) * 0.5;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      if ((sdf(x, y, z) < 0) === sa) lo = t; else hi = t;
    }
    const t = (lo + hi) * 0.5;
    cross[0] = ax + (bx - ax) * t;
    cross[1] = ay + (by - ay) * t;
    cross[2] = az + (bz - az) * t;
  };

  // --- 2./3. Pro Zelle einen Vertex via QEF platzieren ---
  const cellN = n;
  const cellVert = new Int32Array(cellN * cellN * cellN).fill(-1);
  const ci = (i: number, j: number, k: number): number => (k * cellN + j) * cellN + i;

  const verts: number[] = [];
  let vcount = 0;

  const nrm = new Float32Array(3);
  for (let k = 0; k < cellN; k++) {
    for (let j = 0; j < cellN; j++) {
      for (let i = 0; i < cellN; i++) {
        // 8 Eckenwerte
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[fi(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2])];
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue; // vollständig innen/aussen

        // QEF-Akkumulatoren (symmetrische 3x3 + rechte Seite + Massenpunkt)
        let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
        let b0 = 0, b1 = 0, b2 = 0;
        let mx = 0, my = 0, mz = 0, ecount = 0;

        for (let e = 0; e < 12; e++) {
          const ca = EDGES[e][0], cb = EDGES[e][1];
          const sa = (mask >> ca) & 1;
          const sb = (mask >> cb) & 1;
          if (sa === sb) continue; // kein Vorzeichenwechsel

          const ia = i + CORNER[ca][0], ja = j + CORNER[ca][1], ka = k + CORNER[ca][2];
          const ib = i + CORNER[cb][0], jb = j + CORNER[cb][1], kb = k + CORNER[cb][2];
          const va = field[fi(ia, ja, ka)];
          findCrossing(gx(ia), gy(ja), gz(ka), va, gx(ib), gy(jb), gz(kb));
          const px = cross[0], py = cross[1], pz = cross[2];
          gradInto(px, py, pz, nrm, 0);
          const nx = nrm[0], ny = nrm[1], nz = nrm[2];
          const d = nx * px + ny * py + nz * pz;

          a00 += nx * nx; a01 += nx * ny; a02 += nx * nz;
          a11 += ny * ny; a12 += ny * nz; a22 += nz * nz;
          b0 += nx * d; b1 += ny * d; b2 += nz * d;
          mx += px; my += py; mz += pz; ecount++;
        }
        if (ecount === 0) continue;

        const cx = mx / ecount, cy = my / ecount, cz = mz / ecount;

        // Bias zum Massenpunkt für numerische Stabilität (kaum Einfluss auf Kanten)
        const lambda = 0.03;
        a00 += lambda; a11 += lambda; a22 += lambda;
        b0 += lambda * cx; b1 += lambda * cy; b2 += lambda * cz;

        // Symmetrisches 3x3-System lösen (Cofaktoren)
        const co00 = a11 * a22 - a12 * a12;
        const co01 = a02 * a12 - a01 * a22;
        const co02 = a01 * a12 - a02 * a11;
        const det = a00 * co00 + a01 * co01 + a02 * co02;

        let vx: number, vy: number, vz: number;
        if (Math.abs(det) < 1e-12) {
          vx = cx; vy = cy; vz = cz;
        } else {
          const co11 = a00 * a22 - a02 * a02;
          const co12 = a02 * a01 - a00 * a12;
          const co22 = a00 * a11 - a01 * a01;
          const inv = 1 / det;
          vx = (co00 * b0 + co01 * b1 + co02 * b2) * inv;
          vy = (co01 * b0 + co11 * b1 + co12 * b2) * inv;
          vz = (co02 * b0 + co12 * b1 + co22 * b2) * inv;
        }

        // In Zellgrenzen halten (verhindert Ausreisser bei fast parallelen Normalen)
        const x0 = gx(i), x1 = gx(i + 1);
        const y0 = gy(j), y1 = gy(j + 1);
        const z0 = gz(k), z1 = gz(k + 1);
        vx = Math.min(Math.max(vx, x0), x1);
        vy = Math.min(Math.max(vy, y0), y1);
        vz = Math.min(Math.max(vz, z0), z1);

        gradInto(vx, vy, vz, nrm, 0);
        verts.push(vx, vy, vz, nrm[0], nrm[1], nrm[2]);
        cellVert[ci(i, j, k)] = vcount++;
      }
    }
  }

  // --- Quads: pro innerer Kante die vier angrenzenden Zell-Vertices verbinden ---
  const indices: number[] = [];
  const quad = (
    va: number, vb: number, vc: number, vd: number, flip: boolean,
  ): void => {
    if (va < 0 || vb < 0 || vc < 0 || vd < 0) return;
    if (!flip) {
      indices.push(va, vb, vc, va, vc, vd);
    } else {
      indices.push(va, vd, vc, va, vc, vb);
    }
  };

  // X-Kanten
  for (let k = 1; k < cellN; k++) {
    for (let j = 1; j < cellN; j++) {
      for (let i = 0; i < cellN; i++) {
        const s0 = field[fi(i, j, k)] < 0;
        const s1 = field[fi(i + 1, j, k)] < 0;
        if (s0 === s1) continue;
        quad(
          cellVert[ci(i, j - 1, k - 1)],
          cellVert[ci(i, j, k - 1)],
          cellVert[ci(i, j, k)],
          cellVert[ci(i, j - 1, k)],
          !s0,
        );
      }
    }
  }
  // Y-Kanten
  for (let k = 1; k < cellN; k++) {
    for (let j = 0; j < cellN; j++) {
      for (let i = 1; i < cellN; i++) {
        const s0 = field[fi(i, j, k)] < 0;
        const s1 = field[fi(i, j + 1, k)] < 0;
        if (s0 === s1) continue;
        quad(
          cellVert[ci(i - 1, j, k - 1)],
          cellVert[ci(i, j, k - 1)],
          cellVert[ci(i, j, k)],
          cellVert[ci(i - 1, j, k)],
          s0,
        );
      }
    }
  }
  // Z-Kanten
  for (let k = 0; k < cellN; k++) {
    for (let j = 1; j < cellN; j++) {
      for (let i = 1; i < cellN; i++) {
        const s0 = field[fi(i, j, k)] < 0;
        const s1 = field[fi(i, j, k + 1)] < 0;
        if (s0 === s1) continue;
        quad(
          cellVert[ci(i - 1, j - 1, k)],
          cellVert[ci(i, j - 1, k)],
          cellVert[ci(i, j, k)],
          cellVert[ci(i - 1, j, k)],
          !s0,
        );
      }
    }
  }

  // --- Tri-Dexel-Schnittpunkte einsammeln (Visualisierung, achsengefärbt) ---
  const pts: number[] = [];
  const collect = (
    ia: number, ja: number, ka: number, ib: number, jb: number, kb: number, axis: number,
  ): void => {
    const va = field[fi(ia, ja, ka)];
    findCrossing(gx(ia), gy(ja), gz(ka), va, gx(ib), gy(jb), gz(kb));
    pts.push(cross[0], cross[1], cross[2], axis);
  };
  for (let k = 0; k < p; k++) {
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < p; i++) {
        if (i < n && (field[fi(i, j, k)] < 0) !== (field[fi(i + 1, j, k)] < 0)) collect(i, j, k, i + 1, j, k, 0);
        if (j < n && (field[fi(i, j, k)] < 0) !== (field[fi(i, j + 1, k)] < 0)) collect(i, j, k, i, j + 1, k, 1);
        if (k < n && (field[fi(i, j, k)] < 0) !== (field[fi(i, j, k + 1)] < 0)) collect(i, j, k, i, j, k + 1, 2);
      }
    }
  }

  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(indices),
    points: new Float32Array(pts),
    vertexCount: vcount,
    indexCount: indices.length,
    triangleCount: indices.length / 3,
    pointCount: pts.length / 4,
  };
}
