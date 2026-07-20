// Minimale WebGL2-Helfer: Shader kompilieren, Programme linken, Buffer anlegen.
// Bewusst ohne Framework, um den API-Overhead im Vergleich WebGL/WebGPU gering zu halten.

export function getWebGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    powerPreference: "high-performance",
  });
  if (!gl) {
    throw new Error("WebGL2 wird von diesem Browser nicht unterstützt.");
  }
  return gl;
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader fehlgeschlagen.");
  gl.shaderSource(shader, source.trimStart());
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader-Compile-Fehler:\n${log}\n\nQuelle:\n${source}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram fehlgeschlagen.");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Programm-Link-Fehler:\n${log}`);
  }
  return program;
}

export interface UniformMap {
  [name: string]: WebGLUniformLocation | null;
}

export function getUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): UniformMap {
  const map: UniformMap = {};
  for (const name of names) {
    map[name] = gl.getUniformLocation(program, name);
  }
  return map;
}

export function createBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  data: AllowSharedBufferSource,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("createBuffer fehlgeschlagen.");
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}

// Passt die Zeichenpuffer-Auflösung an Anzeigegröße und Device-Pixel-Ratio an.
export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  maxDpr = 2,
): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const width = Math.round(canvas.clientWidth * dpr);
  const height = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GPU-Timing via EXT_disjoint_timer_query_webgl2
// ---------------------------------------------------------------------------

// Misst die ECHTE GPU-Ausführungszeit der zwischen begin()/end() aufgezeichneten
// Draw-Calls — ohne den CPU-Thread mit gl.finish() zu blockieren (das würde die
// Frame-Pacing-Messung verzerren). Ergebnisse sind einige Frames verzögert
// verfügbar; ein Query-Pool erlaubt mehrere gleichzeitig laufende Messungen.
export class GlTimer {
  readonly enabled: boolean;
  private gl: WebGL2RenderingContext;
  // EXT_disjoint_timer_query_webgl2 ist nicht in den TS-DOM-Typen enthalten.
  private ext: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  private free: WebGLQuery[] = [];
  private inflight: WebGLQuery[] = [];
  private results: number[] = [];
  private active: WebGLQuery | null = null;
  private lastMsValue = 0;

  constructor(gl: WebGL2RenderingContext, poolSize = 4) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
      TIME_ELAPSED_EXT: number;
      GPU_DISJOINT_EXT: number;
    } | null;
    this.enabled = this.ext !== null;
    if (!this.enabled) return;
    for (let i = 0; i < poolSize; i++) {
      const q = gl.createQuery();
      if (q) this.free.push(q);
    }
  }

  /** Vor den zu messenden Draw-Calls. */
  begin(): void {
    if (!this.enabled || this.active || this.free.length === 0) return;
    this.active = this.free.pop()!;
    this.gl.beginQuery(this.ext!.TIME_ELAPSED_EXT, this.active);
  }

  /** Nach den zu messenden Draw-Calls. */
  end(): void {
    if (!this.enabled || !this.active) return;
    this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT);
    this.inflight.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    if (!this.enabled) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
    if (disjoint) {
      // GPU hat den Takt gewechselt → alle laufenden Messungen sind ungültig.
      for (const q of this.inflight) this.free.push(q);
      this.inflight.length = 0;
      return;
    }
    while (this.inflight.length > 0) {
      const q = this.inflight[0];
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      const ms = ns / 1_000_000;
      if (Number.isFinite(ms) && ms >= 0) {
        this.results.push(ms);
        this.lastMsValue = ms;
      }
      this.inflight.shift();
      this.free.push(q);
    }
  }

  /** Neuesten fertigen GPU-Messwert (ms) liefern und Puffer leeren; null falls keiner. */
  takeSample(): number | null {
    this.poll();
    if (this.results.length === 0) return null;
    const v = this.results[this.results.length - 1];
    this.results.length = 0;
    return v;
  }

  /** Zuletzt gemessene GPU-Zeit (ms) für die Live-Anzeige. */
  get lastMs(): number {
    return this.lastMsValue;
  }
}
