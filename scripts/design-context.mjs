// Writes the Superdesign context for the desktop studio to .superdesign/init
// (ignored by git) and refreshes .superdesign/design-system.md. Run it from
// the repository root: node scripts/design-context.mjs
//
// A source file that is gone is skipped with a warning, so one renamed
// component cannot stop the rest of the context from being written.
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const output = ".superdesign/init";
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(".superdesign/tmp", { recursive: true });
const missing = [];
const source = (file) => {
  if (!fs.existsSync(file)) {
    if (!missing.includes(file)) {
      missing.push(file);
      console.warn(`Skipped ${file}: not found.`);
    }
    return undefined;
  }
  return fs.readFileSync(file, "utf8");
};
const dump = (file) => {
  const text = source(file);
  if (text === undefined) return `\n## ${file}\n\nNot found.\n`;
  return `\n## ${file}\n\n\`\`\`${file.endsWith(".css") ? "css" : "tsx"}\n${text}\n\`\`\`\n`;
};
const write = (name, text) => fs.writeFileSync(`${output}/${name}.md`, text);
write(
  "components",
  "# Shared UI primitives\nReact 19, Vite 6, Tauri 2, Tailwind 4. Pages mostly use the studio.css classes for buttons, inputs and cards. The shared package exports tokens and types rather than a complete component kit.\n" +
    dump("packages/ui/src/index.ts") +
    dump("packages/ui/config/tokens.ts"),
);
write(
  "layouts",
  "# Current shared layout\nStudioShell (sidebar, quick navigation, header and the active page) is the desktop shell. main.tsx mounts it next to the dictation bubble.\n" +
    dump("apps/desktop/src/components/StudioShell.tsx") +
    dump("apps/desktop/src/main.tsx"),
);
write(
  "routes",
  "# Routing\nSingle URL /; the Zustand activeView (store/appStore.ts) selects the page in StudioShell. home = StudioOverview, transcribe = StudioTranscribe, speech = StudioSpeech, library = StudioLibrary, dictionary and snippets = StudioVocabulary, models = StudioModels, settings and onboarding = StudioSettings. All pages but StudioModels are in StudioWorkbench.tsx.\n" +
    dump("apps/desktop/src/components/StudioShell.tsx"),
);
write(
  "theme",
  "# Current theme\nThe ivory and forest studio theme is in studio.css, its dark variant in studio-night.css. tailwind.css holds only the Tailwind theme and utilities. The app uses locally available fonts (Segoe UI, Arial).\n# Raw theme\n" +
    dump("apps/desktop/src/studio.css") +
    dump("apps/desktop/src/studio-night.css") +
    dump("apps/desktop/src/tailwind.css") +
    dump("packages/ui/config/tokens.ts"),
);
function dependencyTree(file, seen = new Set(), depth = 0) {
  const prefix = "  ".repeat(depth);
  if (seen.has(file)) return `${prefix}- ${file} (already expanded)\n`;
  seen.add(file);
  const text = source(file);
  if (text === undefined) return `${prefix}- ${file} (not found)\n`;
  let tree = `${prefix}- ${file}\n`;
  for (const match of text.matchAll(
    /(?:from\s*|import\s*\()?["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    const base = path.resolve(path.dirname(file), match[1]);
    const candidate = [
      base,
      base + ".ts",
      base + ".tsx",
      base + "/index.ts",
      base + "/index.tsx",
    ].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (
      candidate &&
      /\.(tsx?|css)$/.test(candidate) &&
      candidate.startsWith(root)
    )
      tree += dependencyTree(
        path.relative(root, candidate).replaceAll("\\", "/"),
        seen,
        depth + 1,
      );
  }
  return tree;
}
write(
  "pages",
  "# Key page dependencies\n" +
    ["StudioShell", "StudioWorkbench", "StudioModels"]
      .map(
        (name) =>
          `\n## ${name}\n${dependencyTree(`apps/desktop/src/components/${name}.tsx`)}`,
      )
      .join(""),
);
write(
  "extractable-components",
  "# Target extraction selection\nThe shell is StudioShell (apps/desktop/src/components/StudioShell.tsx; state: activeView). The Models & voices page is StudioModels (apps/desktop/src/components/StudioModels.tsx). No layout components are extracted for the canvas; basic input, button and card styles come from the studio.css classes.\n",
);
fs.writeFileSync(
  ".superdesign/design-system.md",
  "# Sonolect Studio design direction\n\nTarget: Windows voice workspace, local-first with explicit online providers. New Models & voices page plus shared shell. Primary inspiration: Superdesign mosaic-grid-architecture-style.\n\nPalette: ivory #F5F6F2 main canvas, white #FFFFFF surfaces, forest #1F3429 primary, lime #DDF39A quiet accent, text #202923, muted #6C766E, hairline #E0E6DD. Dark forest sidebar. No gradients/glass effects. Segoe UI/Arial locally available fonts, 14px body, 32px main title, 11px section labels; 4/8/12/16/24/32px spacing; 12px card radius. Native-feeling, calm, spacious, clear hierarchy.\n\nNavigation: Overview, Transcribe, Text to speech, Library, Dictionary, Snippets, Models & voices, Settings. Header: processing mode and model summary. Provider cards: key saved or absent (never fabricated connected state), OpenRouter speech support, OpenCode Zen text-model support, local Whisper. Model selector filters by actual capability. Keys are masked and kept in Windows Credential Manager. Voice playback is manual; no audio starts automatically.\n\nNo customer stats, fake history, fake model prices or fabricated connection success. Empty/loading/error/saved states required. Keyboard focus visible. Reduced motion respected. Model download is distinct from cloud inference.\n",
);
console.log(
  missing.length === 0
    ? "All six Superdesign init files and design system written."
    : `All six Superdesign init files and design system written, without ${missing.length} missing file(s).`,
);
