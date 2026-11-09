#!/usr/bin/env node
// Checks that every tracked YAML file (or the files given as arguments) parses.
//
// Each file is parsed as one whole string. The `yaml valid` CLI used before
// reads stdin in 64 KiB chunks, and its incremental lexer can misread
// indentation that is split across a chunk boundary. Valid files, such as a
// large pnpm-lock.yaml, then failed at offsets like 262144 depending only on
// their length.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : execFileSync("git", ["ls-files", "*.yml", "*.yaml"], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean);

let failed = 0;
for (const file of files) {
  const problems = [];
  for (const doc of parseAllDocuments(readFileSync(file, "utf8"))) {
    problems.push(...doc.errors.map((error) => error.message));
    if (doc.errors.length === 0) {
      try {
        doc.toJS();
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (problems.length > 0) {
    failed += 1;
    for (const problem of problems) console.error(`${file}: ${problem}`);
  } else {
    console.log(`ok ${file}`);
  }
}

if (failed > 0) {
  console.error(`${failed} YAML file(s) failed to parse`);
  process.exit(1);
}
