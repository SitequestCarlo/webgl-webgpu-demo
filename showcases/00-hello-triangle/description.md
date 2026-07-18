# Hello Triangle

Das **minimale Programm** beider Web-Grafik-APIs: Ein farbiges Dreieck, dessen drei Ecken die
Grundfarben Rot, Grün und Blau tragen. Die GPU interpoliert die Farben automatisch über die Fläche.

Der Quellcode ist bewusst auf eine einzige Datei `main.ts` beschränkt — kein separater
Shader-Datei, kein Framework, nur die nackte API. So wird der Unterschied im Initialisierungsweg
direkt sichtbar.

## WebGL2: Setup-Schritte

```typescript
// 1. Kontext holen
const gl = canvas.getContext('webgl2');

// 2. Shader kompilieren und Programm linken
const program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER,   VS_SRC));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FS_SRC));
gl.linkProgram(program);

// 3. Vertex-Daten in GPU-Buffer laden (Position + Farbe interleaved)
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);       // Position
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 2 * 4);   // Farbe

// 4. Zeichnen
gl.drawArrays(gl.TRIANGLES, 0, 3);
```

## WebGPU: Setup-Schritte

```typescript
// 1. Adapter und Device anfordern (asynchron)
const adapter = await navigator.gpu.requestAdapter();
const device  = await adapter.requestDevice();

// 2. Canvas konfigurieren
context.configure({ device, format, alphaMode: 'opaque' });

// 3. Shader-Modul und Render-Pipeline erstellen
const pipeline = device.createRenderPipeline({
    vertex:   { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
});

// 4. Render-Pass in Command-Buffer aufzeichnen und absenden
const encoder = device.createCommandEncoder();
const pass    = encoder.beginRenderPass({ colorAttachments: [...] });
pass.setPipeline(pipeline);
pass.draw(3);   // Positionen kommen direkt aus dem Shader (kein Buffer noetig)
pass.end();
device.queue.submit([encoder.finish()]);
```

## Wichtige Unterschiede

| | WebGL2 | WebGPU |
|---|---|---|
| **Shader-Sprache** | GLSL ES 3.00 | WGSL |
| **Initialisierung** | synchron | **asynchron** (`await requestAdapter/Device`) |
| **Vertex-Daten** | VAO + VBO zwingend | optional: Shader kann Vertices eingebaut haben |
| **Zeichenbefehl** | sofort ausgeführt | in **Command-Buffer** aufgezeichnet, dann `queue.submit()` |
| **Zustandsmodel** | globaler Kontext (mutable state) | immutable Pipeline-Objekte |
| **Fehlerbehandlung** | `getError()` nach jedem Aufruf | **DeviceLost-Callback** + Validation-Layer |

> Der WebGPU-Shader braucht hier nicht einmal einen Vertex-Buffer: Positionen und Farben sind
> direkt im WGSL-Code als Arrays codiert und werden über `@builtin(vertex_index)` indexiert.
> Das ist in WebGL nicht möglich (dort ist `gl_VertexID` vorhanden, aber kein direktes Array-Init).
