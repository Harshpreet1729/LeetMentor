import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { build as esbuildBuild } from "esbuild";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(extensionDir, "dist");

process.chdir(extensionDir);

await viteBuild({
  root: extensionDir,
  configFile: path.join(extensionDir, "vite.config.ts")
});

await esbuildBuild({
  absWorkingDir: extensionDir,
  entryPoints: ["src/contentScript.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome110"],
  jsx: "automatic",
  outfile: path.join(distDir, "assets/contentScript.js"),
  sourcemap: false
});

const stylesPath = path.join(distDir, "assets/styles.css");
const contentStylesPath = path.join(distDir, "assets/contentScript.css");

if (fs.existsSync(stylesPath)) {
  fs.copyFileSync(stylesPath, contentStylesPath);
}
