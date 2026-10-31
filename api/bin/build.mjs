import { build } from "esbuild";
import { fileURLToPath, URL } from "node:url";

await build({
  absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
  entryPoints: { index: "src/handler.ts", kill: "src/killswitch.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  mainFields: ["module", "main"],
  sourcemap: true,
  external: ["@aws-sdk/client-*", "@aws-sdk/lib-dynamodb"],
});
