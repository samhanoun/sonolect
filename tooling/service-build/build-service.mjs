#!/usr/bin/env node
// Bundles the service in the current directory into dist/index.js.
//
// The workspace packages (@sonolect/*) ship TypeScript sources, so plain `tsc`
// output cannot run under Node: it keeps the `@sonolect/*` imports and nests
// the entry point under dist/services/<name>/src. Bundling inlines the
// workspace code and leaves npm dependencies external, so the image only needs
// the service's production node_modules next to dist/index.js.
import { readFile, rm } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import process from "node:process";
import { build } from "esbuild";

const serviceDir = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(serviceDir, "package.json"), "utf8"),
);
const workspaceScope = "@sonolect/";
const runtimeDependencies = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !name.startsWith(workspaceScope),
);

const isNodeBuiltin = (specifier) =>
  specifier.startsWith("node:") || builtinModules.includes(specifier);

const packageNameOf = (specifier) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

await rm(path.join(serviceDir, "dist"), { recursive: true, force: true });

const result = await build({
  absWorkingDir: serviceDir,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  plugins: [
    {
      // Keep every npm dependency out of the bundle; inline workspace code.
      name: "externalize-npm-dependencies",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.kind === "entry-point") return undefined;
          if (isNodeBuiltin(args.path)) return undefined;
          if (args.path.startsWith(workspaceScope)) return undefined;
          if (path.isAbsolute(args.path)) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

// A dependency that only a workspace package declares would resolve during
// development and then be missing from the deployed image. Fail the build here
// instead of at container start.
const undeclared = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) {
    if (!imported.external || isNodeBuiltin(imported.path)) continue;
    const name = packageNameOf(imported.path);
    if (!runtimeDependencies.includes(name)) undeclared.add(name);
  }
}
if (undeclared.size > 0) {
  console.error(
    `${manifest.name}: dist/index.js imports packages that are missing from "dependencies": ${[...undeclared].join(", ")}`,
  );
  process.exit(1);
}
