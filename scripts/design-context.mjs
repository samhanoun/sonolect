import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const output = ".superdesign/init";
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(".superdesign/tmp", { recursive: true });
const source = (file) => fs.readFileSync(file, "utf8");
const dump = (file) =>
  `\n## ${file}\n\n\`\`\`${file.endsWith(".css") ? "css" : "tsx"}\n${source(file)}\n\`\`\`\n`;
const write = (name, text) => fs.writeFileSync(`${output}/${name}.md`, text);
write(
  "components",
  "# Shared UI primitives\nReact 19, Vite 6, Tauri 2, Tailwind 4. Pages mostly use inline button/input/card styles. Shared package exports tokens/types rather than a complete component kit.\n" +
    dump("packages/ui/src/index.ts") +
    dump("packages/ui/config/tokens.ts"),
);
write(
  "layouts",
  "# Current shared layout\nSidebar and App/TopBar/WorkspaceRouter in main.tsx form the current desktop shell.\n" +
    dump("apps/desktop/src/components/Sidebar.tsx") +
    dump("apps/desktop/src/main.tsx"),
);
write(
  "routes",
  "# Routing\nSingle URL /; Zustand activeView selects panels. home = LocalHistoryPanel, settings/onboarding = LocalSettingsPanel, dictionary = DictionaryPanel, snippets = SnippetsPanel, reader = ReaderView, team = TeamView. The requested Models & voices screen is new.\n" +
    dump("apps/desktop/src/main.tsx"),
);
write(
  "theme",
  "# Compact current tokens\nCurrent canvas #0A0A0A, sidebar #080808, cards #101010, white text, slate muted text, cyan accents. Mostly 10–14px text and rounded 12–16px boxes. Current font imports require network; redesigned app must use locally available Segoe UI.\n# Raw theme\n" +
    dump("apps/desktop/src/tailwind.css") +
    dump("packages/ui/config/tokens.ts"),
);
function dependencyTree(file, seen = new Set(), depth = 0) {
  const prefix = "  ".repeat(depth);
  if (seen.has(file)) return `${prefix}- ${file} (already expanded)\n`;
  seen.add(file);
  let text = `${prefix}- ${file}\n`;
  for (const match of source(file).matchAll(
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
      text += dependencyTree(
        path.relative(root, candidate).replaceAll("\\", "/"),
        seen,
        depth + 1,
      );
  }
  return text;
}
write(
  "pages",
  "# Key page dependencies\n" +
    [
      "LocalHistoryPanel",
      "LocalSettingsPanel",
      "DictionaryPanel",
      "SnippetsPanel",
    ]
      .map(
        (name) =>
          `\n## ${name}\n${dependencyTree(`apps/desktop/src/components/${name}.tsx`)}`,
      )
      .join(""),
);
write(
  "extractable-components",
  "# Target extraction selection\nThe current Sidebar is a layout candidate (apps/desktop/src/components/Sidebar.tsx; state: activeView). The new Models & voices target requires a new shell rather than an extracted copy of this deprecated dark shell. No existing layout components are selected for reuse in the new canvas target. Basic input/button/card styles will be inline in the draft.\n",
);
fs.writeFileSync(
  ".superdesign/design-system.md",
  "# Sonolect Studio design direction\n\nTarget: Windows voice workspace, local-first with explicit online providers. New Models & voices page plus shared shell. Primary inspiration: Superdesign mosaic-grid-architecture-style.\n\nPalette: ivory #F5F6F2 main canvas, white #FFFFFF surfaces, forest #1F3429 primary, lime #DDF39A quiet accent, text #202923, muted #6C766E, hairline #E0E6DD. Dark forest sidebar. No gradients/glass effects. Segoe UI/Arial locally available fonts, 14px body, 32px main title, 11px section labels; 4/8/12/16/24/32px spacing; 12px card radius. Native-feeling, calm, spacious, clear hierarchy.\n\nNavigation: Overview, Transcribe, Text to speech, Library, Dictionary, Snippets, Models & voices, Settings. Header: processing mode and model summary. Provider cards: key saved or absent (never fabricated connected state), OpenRouter speech support, OpenCode Zen text-model support, local Whisper. Model selector filters by actual capability. Keys are masked and kept in Windows Credential Manager. Voice playback is manual; no audio starts automatically.\n\nNo customer stats, fake history, fake model prices or fabricated connection success. Empty/loading/error/saved states required. Keyboard focus visible. Reduced motion respected. Model download is distinct from cloud inference.\n",
);
console.log("All six Superdesign init files and design system written.");
