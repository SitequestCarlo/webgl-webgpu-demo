// Hello Triangle – WebGL2
// Alle Setup-Schritte in einer Datei, Shader als Template-Literals (kein separates .glsl).
// Zeigt den minimalen WebGL2-Initialisierungsweg.
import '/src/shared/showcase.css';

// ---------------------------------------------------------------------------
// 1. Canvas & Kontext
// ---------------------------------------------------------------------------
const canvas = document.getElementById('gl') as HTMLCanvasElement;

const gl = canvas.getContext('webgl2')!;
if (!gl) throw new Error('WebGL2 nicht verfügbar.');
gl.viewport(0, 0, canvas.width, canvas.height);

// ---------------------------------------------------------------------------
// 2. Shader-Quellcode als Template-Literals (inline, keine externe Datei)
// ---------------------------------------------------------------------------
const VS_SRC = /* glsl */`#version 300 es
layout(location = 0) in vec2 aPos;   // Vertex-Position (NDC)
layout(location = 1) in vec3 aColor; // Vertex-Farbe

out vec3 vColor; // Weitergabe an Fragment-Shader

void main() {
    vColor      = aColor;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS_SRC = /* glsl */`#version 300 es
precision mediump float;

in  vec3 vColor;   // Interpolierte Farbe vom Vertex-Shader
out vec4 fragColor;

void main() {
    fragColor = vec4(vColor, 1.0);
}`;

// ---------------------------------------------------------------------------
// 3. Shader kompilieren und Programm linken
// ---------------------------------------------------------------------------
function compileShader(type: number, src: string): WebGLShader {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? 'Shader-Fehler');
    return s;
}

const program = gl.createProgram()!;
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VS_SRC));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FS_SRC));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'Link-Fehler');

// ---------------------------------------------------------------------------
// 4. Vertex-Daten: Position (x,y) + Farbe (r,g,b) interleaved
// ---------------------------------------------------------------------------
//        x      y     r     g     b
const vertices = new Float32Array([
     0.0,  0.6,  1.0,  0.0,  0.0,   // oben  – rot
    -0.6, -0.4,  0.0,  1.0,  0.0,   // links – grün
     0.6, -0.4,  0.0,  0.0,  1.0,   // rechts – blau
]);

const STRIDE = 5 * 4; // 5 floats * 4 Bytes

// Vertex Array Object (VAO) speichert das Buffer- und Attrib-Layout
const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);

const vbo = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

// Attribut 0: Position (2 floats, Offset 0)
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);

// Attribut 1: Farbe (3 floats, Offset 8 Bytes)
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 2 * 4);

gl.bindVertexArray(null);

// ---------------------------------------------------------------------------
// 5. Einmalig zeichnen (kein Render-Loop nötig – das Bild ändert sich nicht)
// ---------------------------------------------------------------------------
gl.clearColor(0.08, 0.08, 0.10, 1.0);
gl.clear(gl.COLOR_BUFFER_BIT);

gl.useProgram(program);
gl.bindVertexArray(vao);
gl.drawArrays(gl.TRIANGLES, 0, 3); // 3 Vertices = 1 Dreieck
gl.bindVertexArray(null);
