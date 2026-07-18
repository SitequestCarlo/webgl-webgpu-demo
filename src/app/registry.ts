import type { ShowcaseEntry } from './app';

// ---------------------------------------------------------------------------
// Zentrale Showcase-Registry.
// Beschreibungen: /showcases/{id}/description.md (via import.meta.glob in app.ts)
// Shader-Quellen: shaderBase + fileOrder (via import.meta.glob in app.ts)
// Alles wird zur Build-Zeit von Vite gebundelt – kein Runtime-Fetch.
// ---------------------------------------------------------------------------

export const registry: ShowcaseEntry[] = [

  {
    id: '00-readme', num: '00', title: 'README',
    category: 'overview' as any,
    tags: [],
    // Kein Showcase-URL: zeigt nur die globale README.md
  },

  {
    id: '00-hello-triangle', num: '00', title: 'Hello Triangle',
    category: 'rendering', tags: ['Einstieg', 'Shader', 'Minimal'],
    webgl:  './showcases/00-hello-triangle/webgl/index.html',
    webgpu: './showcases/00-hello-triangle/webgpu/index.html',
    shaderBase: '/showcases/00-hello-triangle',
    fileOrder: { webgl: ['main.ts'], webgpu: ['main.ts'] },
  },

  {
    id: '01-shading', num: '01', title: 'Shading-Modelle',
    category: 'rendering', tags: ['Blinn-Phong', 'PBR', 'Toon', 'Flat', 'Gouraud'],
    webgl: './showcases/01-shading/index.html',
    webgpu: './showcases/01-shading/webgpu/index.html',
    shaderBase: '/showcases/01-shading/shaders',
    fileOrder: {
      webgl:  ['none.glsl','flat.glsl','gouraud.glsl','phong.glsl','blinn-phong.glsl','toon.glsl','pbr.glsl', 'main.ts'],
      webgpu: ['none.wgsl','flat.wgsl','gouraud.wgsl','phong.wgsl','blinn-phong.wgsl','toon.wgsl','pbr.wgsl', 'main.ts'],
    },
  },

  {
    id: '02-pbr', num: '02', title: 'PBR Material-Grid',
    category: 'rendering', tags: ['PBR', 'Cook-Torrance', 'GGX', 'Roughness', 'Metallic'],
    webgl: './showcases/02-pbr/index.html',
    webgpu: './showcases/02-pbr/webgpu/index.html',
    shaderBase: '/showcases/02-pbr/shaders',
    fileOrder: { webgl: ['pbr.glsl', 'main.ts'], webgpu: ['pbr.wgsl', 'main.ts'] },
  },

  {
    id: '03-raytracer', num: '03', title: 'Raytracer',
    category: 'rendering', tags: ['Raytracing', 'Refraktion', 'Reflexion', 'Schatten'],
    webgl:  './showcases/03-raytracer/webgl/index.html',
    webgpu: './showcases/03-raytracer/webgpu/index.html',
    shaderBase: '/showcases/03-raytracer/shaders',
    fileOrder: {
      webgl:  ['raytracer.glsl', 'main.ts'],
      webgpu: ['compute.wgsl', 'blit.wgsl', 'main.ts'],
    },
  },

  {
    id: '04-pathtracer', num: '04', title: 'Rendering-Vergleich',
    category: 'rendering', tags: ['Whitted', 'Path Tracing', 'NEE', 'Global Illumination'],
    webgl:  './showcases/04-pathtracer/webgl/index.html',
    webgpu: './showcases/04-pathtracer/webgpu/index.html',
    shaderBase: '/showcases/04-pathtracer/shaders',
    fileOrder: {
      webgl:  ['pathtracer.glsl', 'main.ts'],
      webgpu: ['compute.wgsl', 'blit.wgsl', 'main.ts'],
    },
  },

  {
    id: '05-drawcalls', num: '05', title: 'Draw-Call Overhead',
    category: 'performance', tags: ['API-Overhead', 'CPU-Benchmark', 'Command Buffer'],
    webgl:  './showcases/05-drawcalls/webgl/index.html',
    webgpu: './showcases/05-drawcalls/webgpu/index.html',
    shaderBase: '/showcases/05-drawcalls/shaders',
    fileOrder: { webgl: ['blinn-phong.glsl', 'main.ts'], webgpu: ['blinn-phong.wgsl', 'main.ts'] },
  },

  {
    id: '06-vertex', num: '06', title: 'Vertex Throughput',
    category: 'performance', tags: ['GPU-Benchmark', 'Vertex-Shader', 'GPU-Timing'],
    webgl:  './showcases/06-vertex/webgl/index.html',
    webgpu: './showcases/06-vertex/webgpu/index.html',
    shaderBase: '/showcases/06-vertex/shaders',
    fileOrder: {
      webgl:  ['vertex-simple.glsl', 'vertex-heavy.glsl', 'main.ts'],
      webgpu: ['vertex-simple.wgsl', 'vertex-heavy.wgsl', 'main.ts'],
    },
  },

  {
    id: '07-lights', num: '07', title: 'Fragment-Last / Multi-Light',
    category: 'performance', tags: ['Fragment-Shader', 'N Lichter', 'Storage Buffer'],
    webgl:  './showcases/07-lights/webgl/index.html',
    webgpu: './showcases/07-lights/webgpu/index.html',
    shaderBase: '/showcases/07-lights/shaders',
    fileOrder: { webgl: ['multi-light.glsl', 'main.ts'], webgpu: ['multi-light.wgsl', 'main.ts'] },
  },

  {
    id: '08-nbody', num: '08', title: 'N-Body Simulation',
    category: 'performance', tags: ['Compute', 'O(N²)', 'Simulation', 'Gravitation'],
    webgl:  './showcases/08-nbody/webgl/index.html',
    webgpu: './showcases/08-nbody/webgpu/index.html',
    shaderBase: '/showcases/08-nbody/shaders',
    fileOrder: {
      webgl:  ['simulate.glsl', 'render.glsl', 'main.ts'],
      webgpu: ['simulate.wgsl', 'render.wgsl', 'main.ts'],
    },
  },

  {
    id: '09-instancing', num: '09', title: 'Instanced Rendering',
    category: 'performance', tags: ['Instancing', 'Storage Buffer', '1 Draw-Call'],
    webgl:  './showcases/09-instancing/webgl/index.html',
    webgpu: './showcases/09-instancing/webgpu/index.html',
    shaderBase: '/showcases/09-instancing/shaders',
    fileOrder: { webgl: ['instanced.glsl', 'main.ts'], webgpu: ['instanced.wgsl', 'main.ts'] },
  },

  {
    id: '10-cnc-sim', num: '10', title: 'CNC-Abtragsimulation',
    category: 'compute', tags: ['Compute', 'Z-Map', 'Dexel', 'Höhenfeld', 'MSAA'],
    webgpu: './showcases/10-cnc-sim/index.html',
    shaderBase: '/showcases/10-cnc-sim/shaders',
    fileOrder: {
      webgpu: ['simulate.wgsl', 'heightfield.wgsl', 'tool.wgsl', 'main.ts'],
    },
  },
];