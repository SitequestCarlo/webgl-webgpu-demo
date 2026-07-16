import '/src/shared/showcase.css';
import { GUI } from "lil-gui";
import { mat3, mat4, vec3 } from "gl-matrix";
import { getWebGL2, createProgram, createBuffer, getUniforms, resizeCanvasToDisplaySize } from "../../../src/shared/gl";
import { createUvSphere } from "../../../src/shared/geometry";
import { createStatsPanel, BenchmarkRun, formatResult } from "../../../src/shared/benchmark";
import { splitGLSL } from "../../../src/shared/splitGLSL";
import multiLightGlsl from "../shaders/gl/multi-light.glsl?raw";

const [ML_VS_GLSL, ML_FS_GLSL] = splitGLSL(multiLightGlsl);
const MAX_LIGHTS = 256;

const canvas    = document.getElementById("gl") as HTMLCanvasElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const gl = getWebGL2(canvas);
gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(0.02, 0.02, 0.04, 1);

// Shader: MAX_LIGHTS als Shader-Konstante → einmal compilieren
const program = createProgram(gl, ML_VS_GLSL, ML_FS_GLSL);
const U = getUniforms(gl, program, [
  "uModel","uView","uProj","uNormalMatrix","uViewPos",
  "uAmbient","uShininess","uNumLights",
] as const);
// Licht-Arrays dynamisch abfragen
const lightPosLocs:   (WebGLUniformLocation|null)[] = [];
const lightColorLocs: (WebGLUniformLocation|null)[] = [];
for (let i = 0; i < MAX_LIGHTS; i++) {
  lightPosLocs.push(gl.getUniformLocation(program, `uLightPos[${i}]`));
  lightColorLocs.push(gl.getUniformLocation(program, `uLightColor[${i}]`));
}

// Geometrie: dichte Kugelkachel (Fragment-Shader-Last)
const geo = createUvSphere(1, 200, 100);
const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);
createBuffer(gl, gl.ARRAY_BUFFER, geo.vertices);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geo.indices);
gl.bindVertexArray(null);

const proj = mat4.create(), view = mat4.create(), model = mat4.create(), normalMat = mat3.create();
const cameraPos = vec3.fromValues(0, 0, 2.5);
mat4.lookAt(view, cameraPos, [0,0,0], [0,1,0]);

// Licht-Positionen auf einem Kreis
function buildLights(n: number): { pos: Float32Array; col: Float32Array } {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1.5 + 0.8 * Math.sin(i * 2.3);
    pos[i*3] = Math.cos(a)*r; pos[i*3+1] = Math.sin(a*0.7)*1.2; pos[i*3+2] = Math.sin(a)*r;
    const h = (i/n)*360, [R,G,B] = hsl(h, 1, 0.6);
    col[i*3]=R; col[i*3+1]=G; col[i*3+2]=B;
  }
  return { pos, col };
}
function hsl(h: number, s: number, l: number): [number,number,number] {
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return [r+m,g+m,b+m];
}

const params = { numLights: 16, autoRotate: true };
let lights = buildLights(params.numLights);
const stats = createStatsPanel(document.getElementById("app")!); stats.showPanel(1);
const benchmark = new BenchmarkRun(30, 200);

const gui = new GUI({ title: "Multi-Light (WebGL)" });
let pendingCapture = false;
gui.add(params, "numLights", 1, MAX_LIGHTS, 1).name("Lichtquellen").onChange((v:number) => { lights = buildLights(Math.round(v)); });
gui.add(params, "autoRotate").name("Rotation");
gui.add({ run: async () => {
  resultsEl.style.display = "block"; resultsEl.textContent = `Messe ${params.numLights} Lichter ...`;
  const r = await benchmark.start();
  resultsEl.textContent = `[WebGL] ${params.numLights} Lichter\n${formatResult(r)}`;
}}, "run").name("Benchmark starten");
gui.add({ shot: () => { pendingCapture = true; } }, "shot").name("Screenshot (PNG)");

let angle = 0, lastT = performance.now();
function render(now: number): void {
  const dt = (now - lastT) / 1000; lastT = now;
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0,0,canvas.width,canvas.height);
    mat4.perspective(proj, Math.PI/3.6, canvas.width/Math.max(1,canvas.height), 0.1, 50);
  }
  if (params.autoRotate) angle += dt * 0.4;
  mat4.identity(model); mat4.rotateY(model, model, angle);
  mat3.normalFromMat4(normalMat, model);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);
  gl.uniformMatrix4fv(U.uModel!, false, model);
  gl.uniformMatrix4fv(U.uView!, false, view);
  gl.uniformMatrix4fv(U.uProj!, false, proj);
  gl.uniformMatrix3fv(U.uNormalMatrix!, false, normalMat);
  gl.uniform3fv(U.uViewPos!, cameraPos);
  gl.uniform1f(U.uAmbient!, 0.05);
  gl.uniform1f(U.uShininess!, 64);
  const n = Math.round(params.numLights);
  gl.uniform1i(U.uNumLights!, n);
  for (let i = 0; i < n; i++) {
    // Animate light positions
    const a = (i/n)*Math.PI*2 + angle*0.5;
    const r = 1.5 + 0.5*Math.sin(i*2.3);
    gl.uniform3f(lightPosLocs[i]!, Math.cos(a)*r, Math.sin(a*0.7)*1.2, Math.sin(a)*r);
    gl.uniform3fv(lightColorLocs[i]!, [lights.col[i*3], lights.col[i*3+1], lights.col[i*3+2]]);
  }
  gl.bindVertexArray(vao);
  gl.drawElements(gl.TRIANGLES, geo.indexCount, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
  if (pendingCapture) { pendingCapture = false; canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'lights-webgl.png'; a.click(); }, 'image/png'); }
  stats.update(); benchmark.sample(now);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
