/**
 * What Copy puts on the clipboard for a note: the text as it is, and an HTML
 * version that keeps its shape where it is pasted (paragraphs, line breaks,
 * the Tasks list as a real list). Pure, so it is tested without a device;
 * ui/actions.ts writes it. Adapted from the desktop's richClipboard.ts.
 */

export interface NoteClipboard {
  text: string;
  html: string;
}

/**
 * iOS reads the HTML through NSAttributedString, which takes text without
 * a declared charset for Latin-1: "é" would paste as "Ã©".
 */
export const HTML_PREFIX = '<meta charset="utf-8">';

const BULLET = /^\s*[-*•]\s+(.+)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The note as HTML. Blocks are separated by a newline as well, so a plain
 * text taken from the HTML (the web's textContent) keeps its lines.
 */
export function noteToHtml(text: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  const endParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.join("<br>\n")}</p>`);
    paragraph = [];
  };
  const endList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${item}</li>`).join("\n");
      blocks.push(`<${list.tag}>\n${items}\n</${list.tag}>`);
    }
    list = undefined;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list?.tag !== tag) {
        endList();
        list = { tag, items: [] };
      }
      list.items.push(escapeHtml((bullet ?? numbered)![1]!.trim()));
    } else {
      endList();
      paragraph.push(escapeHtml(line.trim()));
    }
  }
  endParagraph();
  endList();
  return blocks.length ? `${HTML_PREFIX}${blocks.join("\n")}` : "";
}

export function noteClipboard(text: string): NoteClipboard {
  return { text, html: noteToHtml(text) };
}
