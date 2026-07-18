// Hello Triangle – WebGPU
// Alle Setup-Schritte in einer Datei, Shader als Template-Literal (kein separates .wgsl).
// Zeigt den minimalen WebGPU-Initialisierungsweg.
import '/src/shared/showcase.css';

// ---------------------------------------------------------------------------
// 1. Canvas & WebGPU-Kontext
// ---------------------------------------------------------------------------
const canvas = document.getElementById('gpu') as HTMLCanvasElement;

if (!navigator.gpu) throw new Error('WebGPU nicht verfügbar.');
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('Kein WebGPU-Adapter gefunden.');
const device  = await adapter.requestDevice();

const context = canvas.getContext('webgpu') as GPUCanvasContext;
const format  = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

// ---------------------------------------------------------------------------
// 2. Shader-Quellcode als Template-Literal (inline, keine externe Datei)
// ---------------------------------------------------------------------------
const SHADER_SRC = /* wgsl */`
struct VertexIn {
    @location(0) pos   : vec2<f32>,  // Vertex-Position (NDC)
    @location(1) color : vec3<f32>,  // Vertex-Farbe
}
struct VertexOut {
    @builtin(position) pos   : vec4<f32>,
    @location(0)       color : vec3<f32>,
}

@vertex
fn vs_main(v: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.pos   = vec4<f32>(v.pos, 0.0, 1.0);
    out.color = v.color;
    return out;
}

@fragment
fn fs_main(@location(0) color: vec3<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(color, 1.0);
}
`;

// ---------------------------------------------------------------------------
// 3. Vertex-Daten: Position (x,y) + Farbe (r,g,b) interleaved – identisch zu WebGL
// ---------------------------------------------------------------------------
//   x      y     r     g     b
const vertices = new Float32Array([
     0.0,  0.6,  1.0,  0.0,  0.0,   // oben   – rot
    -0.6, -0.4,  0.0,  1.0,  0.0,   // links  – grün
     0.6, -0.4,  0.0,  0.0,  1.0,   // rechts – blau
]);

const vertexBuf = device.createBuffer({
    size:  vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuf, 0, vertices);

// ---------------------------------------------------------------------------
// 4. Shader-Modul und Render-Pipeline erstellen
// ---------------------------------------------------------------------------
const shaderModule = device.createShaderModule({ code: SHADER_SRC });

const STRIDE = 5 * 4; // 5 floats * 4 Bytes

const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module:     shaderModule,
        entryPoint: 'vs_main',
        buffers: [{
            arrayStride: STRIDE,
            attributes: [
                { shaderLocation: 0, offset: 0,      format: 'float32x2' }, // Position
                { shaderLocation: 1, offset: 2 * 4,  format: 'float32x3' }, // Farbe
            ],
        }],
    },
    fragment: {
        module:     shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
});

// ---------------------------------------------------------------------------
// 5. Einmalig zeichnen (kein Render-Loop nötig – das Bild ändert sich nicht)
// ---------------------------------------------------------------------------
const encoder    = device.createCommandEncoder();
const renderPass = encoder.beginRenderPass({
    colorAttachments: [{
        view:       context.getCurrentTexture().createView(),
        clearValue: { r: 0.08, g: 0.08, b: 0.10, a: 1.0 },
        loadOp:     'clear',
        storeOp:    'store',
    }],
});

renderPass.setPipeline(pipeline);
renderPass.setVertexBuffer(0, vertexBuf); // Vertex-Buffer binden (slot 0)
renderPass.draw(3);                        // 3 Vertices = 1 Dreieck
renderPass.end();

device.queue.submit([encoder.finish()]);
