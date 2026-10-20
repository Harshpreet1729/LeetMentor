import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/static/mentor/react/" : "/",
  server: {
    proxy: {
      // Keep Host aligned with the browser's Origin for Django's CSRF check.
      "/api": { target: "http://localhost:8000", changeOrigin: false },
      "/static/brand": "http://localhost:8000",
      // Get Django's existing page and CSRF cookie during Vite development.
      "/django-csrf": {
        target: "http://localhost:8000",
        rewrite: () => "/",
      },
    },
  },
  build: {
    outDir: "../static/mentor/react",
    emptyOutDir: true,
    // Django's static storage adds the production cache hashes.
    rollupOptions: {
      input: "src/main.jsx",
      output: {
        entryFileNames: "app.js",
        assetFileNames: "app[extname]",
      },
    },
  },
}));
