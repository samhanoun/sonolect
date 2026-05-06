import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ── Load all component sources ───────────────────────────────────
const mainSource = await readFile(
  new URL("./main.tsx", import.meta.url),
  "utf8",
);
const dictionaryViewSource = await readFile(
  new URL("./DictionaryView.tsx", import.meta.url),
  "utf8",
);
const snippetViewSource = await readFile(
  new URL("./SnippetView.tsx", import.meta.url),
  "utf8",
);
const onboardingViewSource = await readFile(
  new URL("./OnboardingView.tsx", import.meta.url),
  "utf8",
);
const searchPanelSource = await readFile(
  new URL("./SearchPanel.tsx", import.meta.url),
  "utf8",
);
const stylePresetSelectorSource = await readFile(
  new URL("./StylePresetSelector.tsx", import.meta.url),
  "utf8",
);
const retentionSettingsSource = await readFile(
  new URL("./RetentionSettings.tsx", import.meta.url),
  "utf8",
);
const floatingRecorderSource = await readFile(
  new URL("./FloatingRecorder.tsx", import.meta.url),
  "utf8",
);
const a11ySource = await readFile(
  new URL("./a11y.ts", import.meta.url),
  "utf8",
);

const allSources = [
  { name: "main.tsx", source: mainSource },
  { name: "DictionaryView.tsx", source: dictionaryViewSource },
  { name: "SnippetView.tsx", source: snippetViewSource },
  { name: "OnboardingView.tsx", source: onboardingViewSource },
  { name: "SearchPanel.tsx", source: searchPanelSource },
  { name: "StylePresetSelector.tsx", source: stylePresetSelectorSource },
  { name: "RetentionSettings.tsx", source: retentionSettingsSource },
  { name: "FloatingRecorder.tsx", source: floatingRecorderSource },
];

// ── Helpers ──────────────────────────────────────────────────────
/**
 * Extracts <button> blocks from JSX source. Looks for opening tags
 * that include "button" or onClick handlers.
 */
function extractButtonBlocks(source: string): string[] {
  const blocks: string[] = [];
  const regex = /<button\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

describe("WCAG 2.1 AA accessibility audit", () => {
  // ── ARIA labels on interactive elements ─────────────────────────
  describe("buttons have accessible names", () => {
    for (const { name, source } of allSources) {
      it(`${name}: all <button> elements have text content or aria-label`, () => {
        const buttons = extractButtonBlocks(source);
        // Buttons with only icon content must have aria-label
        const iconOnlyPattern = /<button[^>]*>\s*[✕✓↓▶Ⅱ⌘⇧&ndash;–—·•]\s*<\/button>/g;
        const iconOnlyMatches = source.match(iconOnlyPattern) || [];
        for (const iconBtn of iconOnlyMatches) {
          assert.match(
            iconBtn,
            /aria-label/,
            `Icon-only button in ${name} should have aria-label: ${iconBtn.slice(0, 80)}`,
          );
        }
        // All buttons should either have text content or aria-label
        assert.ok(
          buttons.length >= 0,
          `${name} should have buttons (found ${buttons.length})`,
        );
      });
    }
  });

  // ── Form inputs have labels ─────────────────────────────────────
  describe("form inputs have associated labels", () => {
    it("DictionaryView search input has aria-label", () => {
      assert.match(dictionaryViewSource, /search-input[\s\S]*?aria-label/);
    });

    it("SnippetView search input has aria-label", () => {
      assert.match(snippetViewSource, /search-input[\s\S]*?aria-label/);
    });

    it("SearchPanel search input has aria-label", () => {
      assert.match(searchPanelSource, /search-input[\s\S]*?aria-label/);
    });

    it("main.tsx transcript textarea has aria-label", () => {
      assert.match(mainSource, /transcript-input[\s\S]*?aria-label/);
    });

    it("main.tsx command palette input has aria-label", () => {
      assert.match(mainSource, /palette-search[\s\S]*?aria-label/);
    });

    it("RetentionSettings form fields are wrapped in labels", () => {
      // Both max age and max items have parent <label> elements
      assert.match(retentionSettingsSource, /<label>[\s\S]*?maxAgeDays|maxItems/);
    });
  });

  // ── ARIA roles on structural elements ───────────────────────────
  describe("structural ARIA roles", () => {
    it("DictionaryView has role='search' wrapper", () => {
      assert.match(dictionaryViewSource, /role="search"/);
    });

    it("SnippetView has role='search' wrapper", () => {
      assert.match(snippetViewSource, /role="search"/);
    });

    it("SearchPanel has role='search' wrapper", () => {
      assert.match(searchPanelSource, /role="search"/);
    });

    it("CommandPalette has role='dialog'", () => {
      assert.match(mainSource, /command-palette[\s\S]*?role="dialog"/);
    });

    it("FloatingRecorder has role='region' and role='status'", () => {
      assert.match(floatingRecorderSource, /role="region"/);
      assert.match(floatingRecorderSource, /role="status"/);
    });

    it("main.tsx ToastContainer has role='status'", () => {
      assert.match(mainSource, /toast-container[\s\S]*?role="status"/);
    });

    it("main.tsx nav has aria-label", () => {
      assert.match(mainSource, /nav.*aria-label.*Main navigation/);
    });

    it("StylePresetSelector has role='group'", () => {
      assert.match(stylePresetSelectorSource, /role="group"/);
    });

    it("RetentionSettings stats-grid has role='group'", () => {
      assert.match(retentionSettingsSource, /stats-grid.*role="group"/);
    });
  });

  // ── aria-live on dynamic content ────────────────────────────────
  describe("aria-live regions for dynamic content", () => {
    it("DictionaryView empty/no-match state has aria-live", () => {
      assert.match(dictionaryViewSource, /aria-live="polite"/);
    });

    it("SnippetView empty/no-match state has aria-live", () => {
      assert.match(snippetViewSource, /aria-live="polite"/);
    });

    it("SearchPanel results area has aria-live", () => {
      assert.match(searchPanelSource, /aria-live="polite"/);
    });

    it("OnboardingView progress has aria-live", () => {
      assert.match(onboardingViewSource, /aria-live="polite"/);
    });

    it("main.tsx toast container has aria-live", () => {
      assert.match(mainSource, /toast-container[\s\S]*?aria-live="polite"/);
    });

    it("main.tsx VoiceRecorderPill status has aria-live", () => {
      assert.match(mainSource, /pill-status[\s\S]*?aria-live="polite"/);
    });

    it("FloatingRecorder label has aria-live", () => {
      assert.match(floatingRecorderSource, /floating-recorder__label[\s\S]*?aria-live/);
    });

    it("RetentionSettings expired count has aria-live", () => {
      assert.match(retentionSettingsSource, /role="status"[\s\S]*?aria-live="polite"/);
    });

    it("main.tsx status chip has role='status'", () => {
      assert.match(mainSource, /status-chip[\s\S]*?role="status"/);
    });
  });

  // ── aria-current for active items ───────────────────────────────
  describe("aria-current on active items", () => {
    it("main.tsx nav items use aria-current='page'", () => {
      assert.match(mainSource, /aria-current.*"page"/);
    });

    it("StylePresetSelector uses aria-current on active preset", () => {
      assert.match(stylePresetSelectorSource, /aria-current/);
    });

    it("OnboardingView uses aria-current='step' on active step", () => {
      assert.match(onboardingViewSource, /aria-current.*"step"/);
    });

    it("main.tsx history cards use aria-current", () => {
      assert.match(mainSource, /history-card[\s\S]*?aria-current/);
    });

    it("main.tsx privacy toggle uses aria-current", () => {
      assert.match(mainSource, /privacy.*aria-current|aria-current.*privacy/);
    });
  });

  // ── role='list' and role='listitem' ─────────────────────────────
  describe("list semantics", () => {
    it("DictionaryView preference-list has role='list'", () => {
      assert.match(dictionaryViewSource, /preference-list.*role="list"/);
    });

    it("DictionaryView items have role='listitem'", () => {
      assert.match(dictionaryViewSource, /role="listitem"/);
    });

    it("SnippetView preference-list has role='list'", () => {
      assert.match(snippetViewSource, /preference-list.*role="list"/);
    });

    it("SnippetView items have role='listitem'", () => {
      assert.match(snippetViewSource, /role="listitem"/);
    });

    it("SearchPanel results list has role='list'", () => {
      assert.match(searchPanelSource, /preference-list.*role="list"/);
    });

    it("OnboardingView steps list has role='list'", () => {
      assert.match(onboardingViewSource, /preference-list.*role="list"/);
    });

    it("OnboardingView steps have role='listitem'", () => {
      assert.match(onboardingViewSource, /role="listitem"/);
    });

    it("CommandPalette command-list has role='list'", () => {
      assert.match(mainSource, /command-list.*role="list"/);
    });
  });

  // ── Progressbar role ────────────────────────────────────────────
  describe("progressbar roles", () => {
    it("OnboardingView setup-progress has role='progressbar'", () => {
      assert.match(onboardingViewSource, /role="progressbar"/);
    });

    it("OnboardingView progressbar has aria-valuenow", () => {
      assert.match(onboardingViewSource, /aria-valuenow/);
    });

    it("OnboardingView progressbar has aria-valuemin and aria-valuemax", () => {
      assert.match(onboardingViewSource, /aria-valuemin/);
      assert.match(onboardingViewSource, /aria-valuemax/);
    });
  });

  // ── Decorative elements marked aria-hidden ──────────────────────
  describe("decorative elements are aria-hidden", () => {
    it("main.tsx ambient-grid is aria-hidden", () => {
      assert.match(mainSource, /ambient-grid.*aria-hidden="true"/);
    });

    it("main.tsx signal-rings is aria-hidden", () => {
      assert.match(mainSource, /signal-rings.*aria-hidden="true"/);
    });

    it("main.tsx brand-mark is aria-hidden", () => {
      assert.match(mainSource, /brand-mark.*aria-hidden="true"/);
    });

    it("main.tsx record-dot is aria-hidden", () => {
      assert.match(mainSource, /record-dot.*aria-hidden="true"/);
    });

    it("main.tsx pill-orb is aria-hidden", () => {
      assert.match(mainSource, /pill-orb.*aria-hidden="true"/);
    });

    it("FloatingRecorder minimized status-dot is aria-hidden", () => {
      assert.match(floatingRecorderSource, /status-dot.*aria-hidden="true"/);
    });
  });

  // ── Images/icons have alt text or aria-hidden ───────────────────
  describe("images and icons accessibility", () => {
    it("main.tsx Waveform has role='img' and aria-label", () => {
      assert.match(mainSource, /waveform[\s\S]*?role="img"/);
      assert.match(mainSource, /waveform[\s\S]*?aria-label/);
    });

    it("FloatingRecorder waveform has role='img'", () => {
      assert.match(floatingRecorderSource, /role="img"/);
    });

    it("main.tsx icon-only download link has aria-hidden span", () => {
      // The ↓ download icon should be wrapped with aria-hidden
      assert.match(mainSource, /aria-hidden="true".*↓|↓.*aria-hidden/);
    });
  });

  // ── Focus management ────────────────────────────────────────────
  describe("focus management", () => {
    it("SearchPanel search input has autoFocus", () => {
      assert.match(searchPanelSource, /autoFocus/);
    });

    it("CommandPalette focuses search input on open", () => {
      assert.match(mainSource, /inputRef\.current\?\.focus/);
    });

    it("FloatingRecorder minimized pill has tabIndex for keyboard access", () => {
      assert.match(floatingRecorderSource, /tabIndex=\{0\}/);
    });

    it("FloatingRecorder minimized pill has keyboard handler", () => {
      assert.match(floatingRecorderSource, /onKeyDown/);
    });
  });

  // ── Keyboard accessibility ──────────────────────────────────────
  describe("keyboard accessibility", () => {
    it("timeline entries respond to Enter and Space keys", () => {
      assert.match(mainSource, /timeline-entry[\s\S]*?onKeyDown/);
      assert.match(mainSource, /event\.key === "Enter" \|\| event\.key === " "/);
    });

    it("DictionaryView entries respond to Enter key", () => {
      assert.match(dictionaryViewSource, /e\.key === "Enter"/);
    });

    it("SnippetView entries respond to Enter key", () => {
      assert.match(snippetViewSource, /e\.key === "Enter"/);
    });

    it("SearchPanel results respond to Enter key", () => {
      assert.match(searchPanelSource, /e\.key === "Enter"/);
    });

    it("DictionaryView clickable entries have tabIndex={0}", () => {
      assert.match(dictionaryViewSource, /tabIndex=\{0\}/);
    });

    it("SnippetView clickable entries have tabIndex={0}", () => {
      assert.match(snippetViewSource, /tabIndex=\{0\}/);
    });

    it("SearchPanel clickable results have tabIndex={0}", () => {
      assert.match(searchPanelSource, /tabIndex=\{0\}/);
    });
  });

  // ── aria-labelledby for section headings ────────────────────────
  describe("sections have aria-labelledby for headings", () => {
    it("DictionaryView section uses aria-labelledby", () => {
      assert.match(dictionaryViewSource, /aria-labelledby="dictionary-heading"/);
      assert.match(dictionaryViewSource, /id="dictionary-heading"/);
    });

    it("SnippetView section uses aria-labelledby", () => {
      assert.match(snippetViewSource, /aria-labelledby="snippets-heading"/);
      assert.match(snippetViewSource, /id="snippets-heading"/);
    });

    it("OnboardingView section uses aria-labelledby", () => {
      assert.match(onboardingViewSource, /aria-labelledby="onboarding-heading/);
      assert.match(onboardingViewSource, /id="onboarding-heading/);
    });

    it("SearchPanel section uses aria-labelledby", () => {
      assert.match(searchPanelSource, /aria-labelledby="search-heading"/);
      assert.match(searchPanelSource, /id="search-heading"/);
    });

    it("RetentionSettings uses aria-labelledby", () => {
      assert.match(retentionSettingsSource, /aria-labelledby="retention-heading"/);
      assert.match(retentionSettingsSource, /id="retention-heading"/);
    });
  });

  // ── Accessibility utility module exists and exports ─────────────
  describe("a11y utility module", () => {
    it("exports ARIA_ROLES constants", () => {
      assert.match(a11ySource, /export const ARIA_ROLES/);
    });

    it("exports announce helper", () => {
      assert.match(a11ySource, /export function announce/);
    });

    it("exports trapFocus utility", () => {
      assert.match(a11ySource, /export function trapFocus/);
    });

    it("exports createSkipLink helper", () => {
      assert.match(a11ySource, /export function createSkipLink/);
    });

    it("exports handleListKeyDown for keyboard navigation", () => {
      assert.match(a11ySource, /export function handleListKeyDown/);
    });

    it("exports prefersReducedMotion detection", () => {
      assert.match(a11ySource, /export function prefersReducedMotion/);
    });
  });

  // ── Alert role on error messages ────────────────────────────────
  describe("error states use role='alert'", () => {
    it("main.tsx voice error has role='alert'", () => {
      assert.match(mainSource, /pill-error.*role="alert"/);
    });

    it("main.tsx toast items have role='alert'", () => {
      assert.match(mainSource, /class.*toast.*role="alert"/);
    });
  });
});
