import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { getWebGL2, createProgram } from "../../../src/shared/gl";
import { BenchmarkRun, createStatsPanel, formatResult } from "../../../src/shared/benchmark";
import { splitGLSL } from "../../../src/shared/splitGLSL";
import raytracerGlsl from "../shaders/gl/raytracer.glsl?raw";

const [VS_SRC, FS_SRC] = splitGLSL(raytracerGlsl);

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;

const gl = getWebGL2(canvas);
gl.clearColor(0, 0, 0, 1);

// --- Fullscreen-Quad (2 Dreiecke, NDC-Koordinaten) ----------------------

const program = createProgram(gl, VS_SRC, FS_SRC);
const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);
const vb = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, vb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
gl.bindVertexArray(null);

// --- Uniforms ------------------------------------------------------------

const uRes     = gl.getUniformLocation(program, "uResolution");
const uCamPos  = gl.getUniformLocation(program, "uCamPos");
const uTime    = gl.getUniformLocation(program, "uTime");

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

  gl.useProgram(program);
  gl.uniform2f(uRes, canvas.width, canvas.height);
  const [cx, cy, cz] = orbitCamPos();
  gl.uniform3f(uCamPos, cx, cy, cz);
  gl.uniform1f(uTime, now * 0.001);

  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);

  if (pendingCapture) { pendingCapture = false; captureWebp(); }

  stats.update();
  benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
