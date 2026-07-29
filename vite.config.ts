import { defineConfig } from "vite";
import { resolve } from "node:path";

// Multi-Page-Setup: jede Showcase ist eine eigene statische HTML-Seite.
export default defineConfig({
  root: ".",
  base: "./",
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main:          resolve(__dirname, "index.html"),
        "00-hello-gl":    resolve(__dirname, "showcases/00-hello-triangle/webgl/index.html"),
        "00-hello-gpu":   resolve(__dirname, "showcases/00-hello-triangle/webgpu/index.html"),
        "00-hello":       resolve(__dirname, "showcases/00-hello-triangle/index.html"),
        "01-shading-gl":  resolve(__dirname, "showcases/01-shading/index.html"),
        "01-shading-gpu": resolve(__dirname, "showcases/01-shading/webgpu/index.html"),
        "02-pbr-gl":      resolve(__dirname, "showcases/02-pbr/index.html"),
        "02-pbr-gpu":     resolve(__dirname, "showcases/02-pbr/webgpu/index.html"),
        "03-raytracer":   resolve(__dirname, "showcases/03-raytracer/index.html"),
        "03-rt-webgl":    resolve(__dirname, "showcases/03-raytracer/webgl/index.html"),
        "03-rt-webgpu":   resolve(__dirname, "showcases/03-raytracer/webgpu/index.html"),
        "04-pathtracer":  resolve(__dirname, "showcases/04-pathtracer/index.html"),
        "04-pt-webgl":    resolve(__dirname, "showcases/04-pathtracer/webgl/index.html"),
        "04-pt-webgpu":   resolve(__dirname, "showcases/04-pathtracer/webgpu/index.html"),
        "05-drawcalls":   resolve(__dirname, "showcases/05-drawcalls/index.html"),
        "05-dc-gl":       resolve(__dirname, "showcases/05-drawcalls/webgl/index.html"),
        "05-dc-gpu":      resolve(__dirname, "showcases/05-drawcalls/webgpu/index.html"),
        "06-vertex":      resolve(__dirname, "showcases/06-vertex/index.html"),
        "06-vt-gl":       resolve(__dirname, "showcases/06-vertex/webgl/index.html"),
        "06-vt-gpu":      resolve(__dirname, "showcases/06-vertex/webgpu/index.html"),
        "07-lights":      resolve(__dirname, "showcases/07-lights/index.html"),
        "07-lt-gl":       resolve(__dirname, "showcases/07-lights/webgl/index.html"),
        "07-lt-gpu":      resolve(__dirname, "showcases/07-lights/webgpu/index.html"),
        "08-nbody":       resolve(__dirname, "showcases/08-nbody/index.html"),
        "08-nb-gl":       resolve(__dirname, "showcases/08-nbody/webgl/index.html"),
        "08-nb-gpu":      resolve(__dirname, "showcases/08-nbody/webgpu/index.html"),
        "09-instancing":  resolve(__dirname, "showcases/09-instancing/index.html"),
        "09-in-gl":       resolve(__dirname, "showcases/09-instancing/webgl/index.html"),
        "09-in-gpu":      resolve(__dirname, "showcases/09-instancing/webgpu/index.html"),
        "10-transfer":    resolve(__dirname, "showcases/10-transfer/index.html"),
        "10-tr-gl":       resolve(__dirname, "showcases/10-transfer/webgl/index.html"),
        "10-tr-gpu":      resolve(__dirname, "showcases/10-transfer/webgpu/index.html"),
        "11-cnc-sim":     resolve(__dirname, "showcases/11-cnc-sim/index.html"),
      },
    },
  },
});
