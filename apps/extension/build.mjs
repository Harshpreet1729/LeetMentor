import path from "node:path";
import fs from "node:fs";
import { build as viteBuild } from "vite";
import { build as esbuildBuild } from "esbuild";

const extensionDir = path.resolve("D:/Leetcode_assistant/apps/extension");
const distDir = path.join(extensionDir, "dist");

await viteBuild({
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
