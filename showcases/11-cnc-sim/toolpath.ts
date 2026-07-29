// Toolpath-Generator für die 2,5D-Abtragsimulation.
// Erzeugt eine Sequenz von Werkzeugpositionen (ToolMove) die drei typische
// CNC-Operationen nachbilden:
//   1. Planfräsen  (Flachfräser, Zigzag-Raster)
//   2. Rechtecktasche (Flachfräser, Zigzag-Raster)
//   3. Spiralfräsen  (Kugelkopffräser, Spirale nach innen)
//
// Alle Bahnen werden mit KONSTANTEM VORSCHUB abgetastet: entlang jeder
// Polyline werden Werkzeugpositionen im festen Abstand FEED_STEP erzeugt.
// Dadurch überlappen sich die Werkzeugabdrücke stark und es entsteht eine
// glatte, kontinuierlich gefräste Oberfläche statt einzelner "Stempel".

export interface ToolMove {
  x: number;          // Werkzeugmittelpunkt Welt-X  (-1 .. 1)
  y: number;          // Werkzeugmittelpunkt Welt-Y  (-1 .. 1) → Z-Achse der Zmap
  cutZ: number;       // Schneidtiefe (Werkzeugspitze Höhe, 0..1, kleiner = tiefer)
  toolType: 0 | 1;    // 0 = Flachfräser, 1 = Kugelkopffräser
  toolRadius: number; // Werkzeugradius in Weltkoordinaten
}

interface Point { x: number; y: number; }

// Konstanter Vorschub-Abstand zwischen zwei Werkzeugpositionen (Weltkoordinaten).
// Deutlich kleiner als jeder Werkzeugradius → dichte Überlappung, glatte Fläche.
const FEED_STEP = 0.008;

/**
 * Tastet eine Polyline (Wegpunkte) mit konstantem Vorschub ab und hängt die
 * erzeugten Werkzeugpositionen an `moves` an. Zwischen zwei Wegpunkten werden
 * so viele Zwischenschritte eingefügt, dass der Abstand ≤ FEED_STEP bleibt.
 */
function emitPolyline(
  moves: ToolMove[],
  pts: Point[],
  cutZ: number,
  toolType: 0 | 1,
  r: number,
): void {
  if (pts.length === 0) return;
  moves.push({ x: pts[0].x, y: pts[0].y, cutZ, toolType, toolRadius: r });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / FEED_STEP));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      moves.push({ x: a.x + dx * t, y: a.y + dy * t, cutZ, toolType, toolRadius: r });
    }
  }
}

export function generateToolpath(): ToolMove[] {
  const moves: ToolMove[] = [];

  // ------------------------------------------------------------------
  // Op 1: Planfräsen
  //   Flachfräser r=0.18, Tiefe=0.85 (15 % der Blockhöhe abtragen)
  //   Durchgehender Zigzag über die gesamte Werkstückfläche (mit Überlauf,
  //   letzte Bahn exakt am Rand → keine stehenbleibenden Streifen).
  // ------------------------------------------------------------------
  {
    const r = 0.18;
    const step = r * 1.5;   // Bahnabstand (Flachfräser → flacher Boden)
    const cutZ = 0.85;
    const yTo = 1.0;        // bis Blockkante (Werkzeug läuft leicht über)
    const xLo = -1.12;
    const xHi = 1.12;
    const pts: Point[] = [];
    let y = -1.0;
    let dir = 1;
    for (;;) {
      const yy = Math.min(y, yTo);
      const x0 = dir > 0 ? xLo : xHi;
      const x1 = dir > 0 ? xHi : xLo;
      pts.push({ x: x0, y: yy });
      pts.push({ x: x1, y: yy });
      if (yy >= yTo) break;
      y += step;
      dir = -dir;
    }
    emitPolyline(moves, pts, cutZ, 0, r);
  }

  // ------------------------------------------------------------------
  // Op 2: Rechtecktasche  [-0.5, 0.5]²
  //   Flachfräser r=0.08, Tiefe=0.55
  //   Durchgehender Zigzag; letzte Bahn exakt an der Taschengrenze.
  // ------------------------------------------------------------------
  {
    const r = 0.08;
    const step = r * 1.4;
    const cutZ = 0.55;
    const xMin = -0.5 + r;
    const xMax = 0.5 - r;
    const yLim = 0.5 - r;
    const pts: Point[] = [];
    let y = -yLim;
    let dir = 1;
    for (;;) {
      const yy = Math.min(y, yLim);
      const x0 = dir > 0 ? xMin : xMax;
      const x1 = dir > 0 ? xMax : xMin;
      pts.push({ x: x0, y: yy });
      pts.push({ x: x1, y: yy });
      if (yy >= yLim) break;
      y += step;
      dir = -dir;
    }
    emitPolyline(moves, pts, cutZ, 0, r);

    // Konturbahn (Schlichtbahn) entlang der 4 Wände → keine Grate zwischen den
    // Zigzag-Bahnen.
    const contour: Point[] = [
      { x: xMin, y: -yLim }, { x: xMax, y: -yLim },
      { x: xMax, y: yLim }, { x: xMin, y: yLim }, { x: xMin, y: -yLim },
    ];
    emitPolyline(moves, contour, cutZ, 0, r);
  }

  // ------------------------------------------------------------------
  // Op 3: Spiralfräsen (zentriert)
  //   Flachfräser r=0.05, Tiefe=0.30 → vertikale Wand + flacher Boden
  //   (passt exakt zum Zylinder-Zielkörper). Erst volle Konturbahn an der
  //   Außenwand, dann archimedische Spirale von außen nach innen.
  // ------------------------------------------------------------------
  {
    const r = 0.05;
    const cutZ = 0.30;
    const rMax = 0.24;
    const pitch = 0.02;      // radialer Vorschub pro Umdrehung (< Werkzeug-Ø)
    const pts: Point[] = [];
    let ang = 0;
    let rad = rMax;

    // Konturbahn: ein voller Kreis an der Außenwand (rad bleibt konstant).
    const contourEnd = ang + Math.PI * 2;
    while (ang < contourEnd) {
      pts.push({ x: Math.cos(ang) * rMax, y: Math.sin(ang) * rMax });
      ang += FEED_STEP / rMax;
    }
    while (rad > 0) {
      pts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
      const dAng = FEED_STEP / Math.max(rad, 1e-3);   // Winkelschritt für ~FEED_STEP Bogenlänge
      ang += dAng;
      rad -= (pitch * dAng) / (2 * Math.PI);          // Radius proportional verkleinern
    }
    pts.push({ x: 0, y: 0 });   // Mittelpunkt
    emitPolyline(moves, pts, cutZ, 0, r);
  }

  return moves;
}
