// Minimale WebGL2-Helfer: Shader kompilieren, Programme linken, Buffer anlegen.
// Bewusst ohne Framework, um den API-Overhead im Vergleich WebGL/WebGPU gering zu halten.

export function getWebGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    // Fairer API-Vergleich (siehe toji.dev/webgpu-best-practices/webgl-performance-comparison):
    // WebGPU-Canvas ist single-sampled + opaque, daher WebGL ebenso — sonst leistet
    // WebGL durch MSAA + Alpha-Blending unbemerkt Mehrarbeit.
    antialias: false,
    alpha: false,
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
// Asynchrone GPU-Synchronisation (für zuverlässige GPU-Timestamps)
// ---------------------------------------------------------------------------

// Yield an den Event-Loop OHNE die ~4ms-Drosselung von setTimeout(0). Nötig, damit
// der GPU-Prozess den Fence-Status aktualisieren kann (synchrones Busy-Wait
// funktioniert im Browser NICHT — die GPU läuft in einem eigenen Prozess).
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

// Wartet ASYNCHRON (mit Event-Loop-Yields) bis die GPU-Arbeit dieses Frames fertig
// ist. Wichtig: gl.finish() ist in Chrome ein No-Op und synchrones Busy-Wait auf
// clientWaitSync stallt nur (der GPU-Prozess kommt nie zum Zug). Nach glFenceAsync()
// sind die EXT_disjoint_timer_query-Ergebnisse (echte GPU-ns) zuverlässig verfügbar.
export async function glFenceAsync(gl: WebGL2RenderingContext): Promise<void> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) { gl.flush(); return; }
  gl.flush(); // Fence-Kommando abschicken
  const deadline = performance.now() + 1000; // Sicherheitsobergrenze
  for (;;) {
    const status = gl.clientWaitSync(sync, 0, 0);
    if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
    if (status === gl.WAIT_FAILED || performance.now() > deadline) break;
    await yieldToEventLoop(); // Event-Loop laufen lassen → GPU-Prozess signalisiert den Fence
  }
  gl.deleteSync(sync);
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

  // Diagnose-Zähler (Punkt 1).
  private nSubmitted = 0;  // beginQuery/endQuery-Paare gestartet
  private nResolved = 0;   // gültiges Ergebnis ausgelesen
  private nDropped = 0;    // Query-Pool leer → Frame übersprungen
  private nDisjoint = 0;   // GPU_DISJOINT → laufende Messungen verworfen
  private warnedDisjoint = false;

  constructor(gl: WebGL2RenderingContext, poolSize = 4) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
      TIME_ELAPSED_EXT: number;
      GPU_DISJOINT_EXT: number;
    } | null;
    this.enabled = this.ext !== null;
    if (!this.enabled) {
      console.warn("[GlTimer] EXT_disjoint_timer_query_webgl2 nicht unterstützt – keine GPU-Zeitmessung.");
      return;
    }
    for (let i = 0; i < poolSize; i++) {
      const q = gl.createQuery();
      if (q) this.free.push(q);
    }
  }

  /** Vor den zu messenden Draw-Calls. */
  begin(): void {
    if (!this.enabled || this.active) return;
    if (this.free.length === 0) { this.nDropped++; return; }
    this.active = this.free.pop()!;
    this.gl.beginQuery(this.ext!.TIME_ELAPSED_EXT, this.active);
  }

  /** Nach den zu messenden Draw-Calls. */
  end(): void {
    if (!this.enabled || !this.active) return;
    this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT);
    this.inflight.push(this.active);
    this.active = null;
    this.nSubmitted++;
    this.poll();
  }

  private poll(): void {
    if (!this.enabled) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
    if (disjoint) {
      // GPU hat den Takt gewechselt → alle laufenden Messungen sind ungültig.
      this.nDisjoint++;
      if (!this.warnedDisjoint) {
        this.warnedDisjoint = true;
        console.warn("[GlTimer] GPU_DISJOINT – Messungen verworfen (GPU-Taktwechsel/DVFS).");
      }
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
        this.nResolved++;
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

  /** Diagnose-Schnappschuss (Punkt 1). */
  get diagnostics(): { enabled: boolean; submitted: number; resolved: number; dropped: number; disjoint: number } {
    return {
      enabled: this.enabled,
      submitted: this.nSubmitted,
      resolved: this.nResolved,
      dropped: this.nDropped,
      disjoint: this.nDisjoint,
    };
  }
}
