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
        main: resolve(__dirname, "index.html"),
        "01-shading": resolve(__dirname, "showcases/01-shading/index.html"),
      },
    },
  },
});
