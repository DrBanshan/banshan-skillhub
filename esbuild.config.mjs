import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFile, mkdir } from "fs/promises";

const prod = process.argv[2] === "production";
const pluginDir = ".obsidian/plugins/banshan-skillhub";
const pluginMain = `${pluginDir}/main.js`;

async function copyPluginFiles() {
  await mkdir(pluginDir, { recursive: true });
  await Promise.all([
    copyFile("manifest.json", `${pluginDir}/manifest.json`),
    copyFile("styles.css", `${pluginDir}/styles.css`),
  ]);
}

const copyPluginFilesPlugin = {
  name: "copy-plugin-files",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await copyPluginFiles();
        await copyFile(pluginMain, "main.js");
      }
    });
  },
};

await copyPluginFiles();

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: prod,
  outfile: pluginMain,
  plugins: [copyPluginFilesPlugin],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
