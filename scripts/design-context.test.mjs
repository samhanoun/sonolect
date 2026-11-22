import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("design-context.mjs", import.meta.url));
const initFiles = [
  "components",
  "layouts",
  "routes",
  "theme",
  "pages",
  "extractable-components",
];

// Runs the script in a temporary directory, so it never writes into the
// repository. `links` names repository folders to make visible there.
const runIn = (links) => {
  const dir = mkdtempSync(join(tmpdir(), "sonolect-design-context-"));
  try {
    for (const link of links)
      symlinkSync(join(repoRoot, link), join(dir, link));
    const result = spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
    });
    const written = initFiles.filter((name) =>
      existsSync(join(dir, ".superdesign/init", `${name}.md`)),
    );
    const pages = existsSync(join(dir, ".superdesign/init/pages.md"))
      ? readFileSync(join(dir, ".superdesign/init/pages.md"), "utf8")
      : "";
    return { ...result, written, pages };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("design-context script", () => {
  it("writes every init file and warns when sources are missing", () => {
    const result = runIn([]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.written, initFiles);
    assert.match(
      result.stderr,
      /Skipped apps\/desktop\/src\/components\/StudioShell\.tsx: not found\./,
    );
  });

  it("finds every source file it names in the repository", () => {
    const result = runIn(["apps", "packages"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "", "no source file was skipped");
    assert.deepEqual(result.written, initFiles);
    assert.match(
      result.pages,
      /- apps\/desktop\/src\/components\/StudioModels\.tsx/,
    );
    assert.doesNotMatch(result.pages, /\(not found\)/);
  });
});
