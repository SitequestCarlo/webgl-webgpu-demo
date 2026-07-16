import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat4, mat3 } from "gl-matrix";
import { getWebGL2, createProgram } from "../../../src/shared/gl";
import { createUvSphere } from "../../../src/shared/geometry";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import { splitGLSL } from "../../../src/shared/splitGLSL";
import raytracerGlsl from "../shaders/gl/raytracer.glsl?raw";

const [VS_SRC, FS_SRC] = splitGLSL(raytracerGlsl);

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const gl = getWebGL2(canvas);
gl.clearColor(0.08, 0.09, 0.11, 1);

// ---------------------------------------------------------------------------
// Raytracer-Pipeline (Fullscreen-Quad)
// ---------------------------------------------------------------------------

const rtProgram = createProgram(gl, VS_SRC, FS_SRC);
const rtVao = gl.createVertexArray()!;
gl.bindVertexArray(rtVao);
const rtVb = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, rtVb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
gl.bindVertexArray(null);

const uRes    = gl.getUniformLocation(rtProgram, "uResolution");
const uCamPos = gl.getUniformLocation(rtProgram, "uCamPos");
const uTime   = gl.getUniformLocation(rtProgram, "uTime");

// ---------------------------------------------------------------------------
// Rasterisierungs-Pipeline (Blinn-Phong, zum Vergleich)
// ---------------------------------------------------------------------------

const RAST_VS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMat;
out vec3 vWorldPos;
out vec3 vNormal;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos  = world.xyz;
  vNormal    = uNormalMat * aNorm;
  gl_Position = uProj * uView * world;
}`;

const RAST_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
uniform vec3 uColor;
uniform vec3 uCamPosR;
uniform int  uIsFloor;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(vec3(2.0, 3.5, 2.0) - vWorldPos);
  vec3 V = normalize(uCamPosR - vWorldPos);
  vec3 H = normalize(L + V);
  if (dot(N, V) < 0.0) N = -N;
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), 64.0);
  vec3 base = uColor;
  // Schachbrett-Muster für den Boden (identisch mit dem Raytracer)
  if (uIsFloor == 1) {
    bool cb = mod(floor(vWorldPos.x) + floor(vWorldPos.z), 2.0) < 1.0;
    base = cb ? vec3(0.9) : vec3(0.3);
  }
  vec3 col = 0.08 * base + diff * base + spec * vec3(1.0);
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;

const rastProgram = createProgram(gl, RAST_VS, RAST_FS);
const uModel     = gl.getUniformLocation(rastProgram, "uModel");
const uView      = gl.getUniformLocation(rastProgram, "uView");
const uProj      = gl.getUniformLocation(rastProgram, "uProj");
const uNormalMat = gl.getUniformLocation(rastProgram, "uNormalMat");
const uColor     = gl.getUniformLocation(rastProgram, "uColor");
const uCamPosR   = gl.getUniformLocation(rastProgram, "uCamPosR");
const uIsFloor   = gl.getUniformLocation(rastProgram, "uIsFloor");

// Kugel-Geometrie (für alle 3 Kugeln wiederverwendet)
const sphereGeo = createUvSphere(0.5, 32, 16);
const sphVao = gl.createVertexArray()!;
gl.bindVertexArray(sphVao);
const sphVb = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, sphVb);
gl.bufferData(gl.ARRAY_BUFFER, sphereGeo.vertices, gl.STATIC_DRAW);
const sphIb = gl.createBuffer()!;
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphIb);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphereGeo.indices, gl.STATIC_DRAW);
const STRIDE = 4 * 6; // position(3) + normal(3) floats
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
gl.bindVertexArray(null);

// Boden-Quad (y = -1, 8×8 Einheiten)
const FLOOR_VERTS = new Float32Array([
  -40,-1,-40, 0,1,0,   40,-1,-40, 0,1,0,   40,-1, 40, 0,1,0,
  -40,-1,-40, 0,1,0,   40,-1, 40, 0,1,0,  -40,-1, 40, 0,1,0,
]);
const floorVao = gl.createVertexArray()!;
gl.bindVertexArray(floorVao);
const floorVb = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, floorVb);
gl.bufferData(gl.ARRAY_BUFFER, FLOOR_VERTS, gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
gl.bindVertexArray(null);

// Szene-Objekte: [x, y, z], [r, g, b], shininess-Bemerkung
const SCENE_OBJECTS = [
  { pos: [-1.1, -0.5, -0.5] as [number,number,number], color: [0.9, 0.9, 0.85] as [number,number,number] }, // Spiegel (silber)
  { pos: [ 0.0, -0.5,  0.0] as [number,number,number], color: [0.7, 0.85, 1.0] as [number,number,number] }, // Glas (blau)
  { pos: [ 1.1, -0.5, -0.5] as [number,number,number], color: [0.85, 0.2, 0.15] as [number,number,number] }, // Diffus (rot)
];

// Matrizen für Rasterisierung
const viewM  = mat4.create();
const projM  = mat4.create();
const modelM = mat4.create();

// --- Orbit-Kamera --------------------------------------------------------

const orbit = { theta: 0, phi: 1.32, dist: 3.4 };
const TARGET: [number, number, number] = [0, -0.2, 0];
function orbitCamPos(): [number, number, number] {
  return [
    TARGET[0] + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    TARGET[1] + orbit.dist * Math.cos(orbit.phi),
    TARGET[2] + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta),
  ];
}

// Maus-Orbit
{
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lastX) * 0.008;
    orbit.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, orbit.phi - (e.clientY - lastY) * 0.008));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("wheel", (e) => {
    orbit.dist = Math.max(1.0, Math.min(8.0, orbit.dist + e.deltaY * 0.01));
    e.preventDefault();
  }, { passive: false });
}

// --- Benchmark & GUI -----------------------------------------------------

const stats     = createStatsPanel(document.getElementById("app")!);
const benchmark = new BenchmarkRun(60, 300);
let pendingCapture = false;

function captureWebp(): void {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raytracer-webgl-${new Date().toISOString().replace(/[:.]/g, "-")}.webp`;
      a.click();
      URL.revokeObjectURL(url);
    },
    "image/webp",
    0.92,
  );
}

async function runBenchmark(): Promise<void> {
  resultsEl.style.display = "block";
  resultsEl.textContent = "Messung läuft ...";
  const result = await benchmark.start();
  resultsEl.textContent = `[WebGL] Fragment Raytracer\n${formatResult(result)}`;
}

const gui = new GUI({ title: "Raytracer (WebGL)" });
const params = { raytracing: true };
gui.add(params, "raytracing").name("Raytracing An/Aus");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (webp)");
gui.add({ run: () => void runBenchmark() }, "run").name("Benchmark starten");

// --- Render-Loop ---------------------------------------------------------

function resizeCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}

function render(now: number): void {
  resizeCanvas();
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const [cx, cy, cz] = orbitCamPos();

  if (params.raytracing) {
    // ---- Raytracing-Modus: Fullscreen-Quad --------------------------------
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(rtProgram);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform3f(uCamPos, cx, cy, cz);
    gl.uniform1f(uTime, now * 0.001);
    gl.bindVertexArray(rtVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

  } else {
    // ---- Rasterisierungs-Modus: Blinn-Phong, keine Schatten/Reflexionen ---
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(rastProgram);

    mat4.lookAt(viewM, [cx, cy, cz], TARGET, [0, 1, 0]);
    const aspect = canvas.width / canvas.height;
    mat4.perspective(projM, Math.PI / 3.5, aspect, 0.1, 50);
    gl.uniformMatrix4fv(uView, false, viewM);
    gl.uniformMatrix4fv(uProj, false, projM);
    gl.uniform3f(uCamPosR, cx, cy, cz);

    // Kugeln
    gl.bindVertexArray(sphVao);
    gl.uniform1i(uIsFloor, 0);
    for (const obj of SCENE_OBJECTS) {
      mat4.fromTranslation(modelM, obj.pos);
      const nm = mat3.normalFromMat4(mat3.create(), modelM)!;
      gl.uniformMatrix4fv(uModel, false, modelM);
      gl.uniformMatrix3fv(uNormalMat, false, nm);
      gl.uniform3f(uColor, ...obj.color);
      gl.drawElements(gl.TRIANGLES, sphereGeo.indexCount, gl.UNSIGNED_INT, 0);
    }

    // Boden mit Schachbrett-Muster (wie im Raytracer, aber ohne Schatten)
    gl.bindVertexArray(floorVao);
    gl.uniform1i(uIsFloor, 1);
    mat4.identity(modelM);
    const nmFloor = mat3.normalFromMat4(mat3.create(), modelM)!;
    gl.uniformMatrix4fv(uModel, false, modelM);
    gl.uniformMatrix3fv(uNormalMat, false, nmFloor);
    gl.uniform3f(uColor, 0.6, 0.6, 0.6);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  if (pendingCapture) { pendingCapture = false; captureWebp(); }
  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
