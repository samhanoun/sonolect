/**
 * Copies a transcript so that it keeps its shape when pasted: paragraphs,
 * headings, lists, bold and italic, and who said what. The clipboard gets a
 * rich (HTML) version for editors and mail, and a plain one for everything
 * else.
 */
export type ClipboardSegment = {
  text: string;
  speaker?: string | null | undefined;
};

export type ClipboardContent = { text: string; html: string };

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bold, italic and code inside one line. The input is already escaped. */
function inline(escaped: string) {
  return escaped
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])/g, "<em>$1</em>")
    .replace(/(?<![_\w])_(?=\S)([^_\n]+?)(?<=\S)_(?![_\w])/g, "<em>$1</em>");
}

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^\s*[-*•]\s+(.+)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;

/** HTML for text that may use light Markdown, as the rewriting tools write it. */
export function textToHtml(text: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  const endParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.join("<br>")}</p>`);
    paragraph = [];
  };
  const endList = () => {
    if (list)
      blocks.push(
        `<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.tag}>`,
      );
    list = undefined;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (heading) {
      endParagraph();
      endList();
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${inline(escapeHtml(heading[2]!))}</h${level}>`);
    } else if (bullet || numbered) {
      endParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list?.tag !== tag) {
        endList();
        list = { tag, items: [] };
      }
      list.items.push(inline(escapeHtml((bullet ?? numbered)![1]!)));
    } else {
      endList();
      paragraph.push(inline(escapeHtml(line.trimStart())));
    }
  }
  endParagraph();
  endList();
  return blocks.join("");
}

/**
 * What to put on the clipboard for a transcript. When segments carry speaker
 * names, each change of speaker starts a paragraph that opens with the name.
 */
export function transcriptClipboard(
  transcript: string,
  segments: ClipboardSegment[] = [],
): ClipboardContent {
  const spoken = segments.filter((segment) => segment.text.trim());
  if (!spoken.some((segment) => segment.speaker?.trim()))
    return { text: transcript, html: textToHtml(transcript) };

  const turns: { speaker: string; lines: string[] }[] = [];
  for (const segment of spoken) {
    const speaker = segment.speaker?.trim() ?? "";
    const last = turns.at(-1);
    if (last && last.speaker === speaker) last.lines.push(segment.text.trim());
    else turns.push({ speaker, lines: [segment.text.trim()] });
  }
  return {
    text: turns
      .map(({ speaker, lines }) =>
        speaker ? `${speaker}: ${lines.join(" ")}` : lines.join(" "),
      )
      .join("\n\n"),
    html: turns
      .map(({ speaker, lines }) => {
        const words = inline(escapeHtml(lines.join(" ")));
        return speaker
          ? `<p><strong>${escapeHtml(speaker)}:</strong> ${words}</p>`
          : `<p>${words}</p>`;
      })
      .join(""),
  };
}

/**
 * Writes both versions to the clipboard. Webviews without rich clipboard
 * support get the plain version.
 */
export async function copyTranscript(
  transcript: string,
  segments: ClipboardSegment[] = [],
  clipboard: Clipboard = navigator.clipboard,
): Promise<"rich" | "plain"> {
  const content = transcriptClipboard(transcript, segments);
  if (typeof ClipboardItem !== "undefined" && clipboard.write && content.html) {
    try {
      await clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([content.html], { type: "text/html" }),
          "text/plain": new Blob([content.text], { type: "text/plain" }),
        }),
      ]);
      return "rich";
    } catch {
      // Fall through to plain text.
    }
  }
  await clipboard.writeText(content.text);
  return "plain";
}
