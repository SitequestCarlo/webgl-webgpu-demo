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
