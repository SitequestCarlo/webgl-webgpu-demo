// Implizite Volumenmodelle (Signed Distance Fields) als Datenquelle für die
// Tri-Dexel-Abtastung. Jede Szene liefert eine skalare Funktion f(x,y,z):
//   f < 0  -> im Material (innen)
//   f > 0  -> Luft (aussen)
// Die drei achsenparallelen Strahlfamilien der Tri-Dexel-Struktur werten diese
// Funktion aus und bestimmen exakte Ein-/Austrittspunkte samt Normalen.

export type SceneId = "fraesteil" | "torus" | "kugelschnitt";

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Scene {
  id: SceneId;
  label: string;
  bounds: Bounds;
  sdf: (x: number, y: number, z: number) => number;
}

// --- SDF-Primitive (skalar, allokationsfrei) ---------------------------------

function sdSphere(x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number): number {
  return Math.hypot(x - cx, y - cy, z - cz) - r;
}

/** Achsenausgerichteter Quader, Mittelpunkt (cx,cy,cz), Halbmaße (bx,by,bz). */
function sdBox(
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  bx: number, by: number, bz: number,
): number {
  const qx = Math.abs(x - cx) - bx;
  const qy = Math.abs(y - cy) - by;
  const qz = Math.abs(z - cz) - bz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return Math.hypot(ox, oy, oz) + inside;
}

/** Wie sdBox, aber mit abgerundeten Kanten (Radius r). */
function sdRoundBox(
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  bx: number, by: number, bz: number, r: number,
): number {
  return sdBox(x, y, z, cx, cy, cz, bx - r, by - r, bz - r) - r;
}

/** Endlicher Zylinder entlang Y: Mittelachse (cx,cz), Radius r, Halbhöhe h um cy. */
function sdCylinderY(
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  r: number, h: number,
): number {
  const dr = Math.hypot(x - cx, z - cz) - r;
  const dy = Math.abs(y - cy) - h;
  const ox = Math.max(dr, 0), oy = Math.max(dy, 0);
  return Math.min(Math.max(dr, dy), 0) + Math.hypot(ox, oy);
}

function sdTorus(x: number, y: number, z: number, bigR: number, smallR: number): number {
  const q = Math.hypot(x, z) - bigR;
  return Math.hypot(q, y) - smallR;
}

// --- CSG-Operatoren ----------------------------------------------------------

const opUnion = (a: number, b: number): number => Math.min(a, b);
const opSubtract = (a: number, b: number): number => Math.max(a, -b); // a ohne b
// (opIntersect = Math.max wird derzeit nicht benötigt)

// --- Szenen ------------------------------------------------------------------

/**
 * Frästeil: Rohblock, aus dem eine Tasche, ein Zugangsloch und ein
 * vergrabener Kugel-Hohlraum entfernt sind. Der Hohlraum ist breiter als das
 * Loch -> echter Hinterschnitt, den ein einzelner Z-Dexel nicht abbilden kann.
 */
function sdfFraesteil(x: number, y: number, z: number): number {
  let d = sdRoundBox(x, y, z, 0, 0, 0, 1.0, 0.5, 1.0, 0.05); // Rohblock

  // Abgerundete Rechtecktasche links (offen nach oben)
  const pocket = sdRoundBox(x, y, z, -0.45, 0.55, 0.0, 0.42, 0.55, 0.62, 0.1);
  d = opSubtract(d, pocket);

  // Schmales Zugangsloch rechts (von oben)
  const bore = sdCylinderY(x, y, z, 0.45, 0.55, 0.0, 0.14, 0.55);
  d = opSubtract(d, bore);

  // Vergrabener Kugel-Hohlraum (Hinterschnitt)
  const cavity = sdSphere(x, y, z, 0.45, -0.02, 0.0, 0.3);
  d = opSubtract(d, cavity);

  return d;
}

function sdfTorus(x: number, y: number, z: number): number {
  return sdTorus(x, y, z, 0.6, 0.24);
}

/** Kugel mit herausgeschnittenem Oktanten: runde Fläche trifft scharfe Kanten. */
function sdfKugelschnitt(x: number, y: number, z: number): number {
  let d = sdSphere(x, y, z, 0, 0, 0, 0.72);
  d = opSubtract(d, sdBox(x, y, z, 0.42, 0.42, 0.42, 0.6, 0.6, 0.6));
  // kleine Kugelkuppe als weiches Detail
  d = opUnion(d, sdSphere(x, y, z, -0.35, 0.35, 0.35, 0.18));
  return d;
}

export const SCENES: Scene[] = [
  {
    id: "fraesteil",
    label: "Frästeil (Tasche + Hinterschnitt)",
    bounds: { min: [-1.18, -0.72, -1.18], max: [1.18, 0.9, 1.18] },
    sdf: sdfFraesteil,
  },
  {
    id: "torus",
    label: "Torus",
    bounds: { min: [-1.0, -0.45, -1.0], max: [1.0, 0.45, 1.0] },
    sdf: sdfTorus,
  },
  {
    id: "kugelschnitt",
    label: "Kugelschnitt (scharfe Kante)",
    bounds: { min: [-0.9, -0.9, -0.9], max: [0.9, 0.9, 0.9] },
    sdf: sdfKugelschnitt,
  },
];

export function sceneById(id: SceneId): Scene {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}
