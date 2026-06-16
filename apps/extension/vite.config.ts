import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  resolve: {
    alias: {
      "@leetcode-assistant/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, "index.html"),
        options: path.resolve(__dirname, "options.html"),
        background: path.resolve(__dirname, "src/background.ts")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]"
      }
    }
  },
  plugins: [
    react(),
    {
      name: "copy-extension-manifest",
      closeBundle() {
        fs.copyFileSync(path.resolve(__dirname, "manifest.json"), path.resolve(__dirname, "dist/manifest.json"));
      }
    }
  ]
});
