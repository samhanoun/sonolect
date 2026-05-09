import { marked, lexer, type Token, type Tokens } from "marked";

export type DocumentType = "pdf" | "docx" | "markdown" | "text";

export type DocumentSection = {
  id: string;
  title: string;
  content: string;
  level: number;
  startIndex: number;
  endIndex: number;
};

export type DocumentMetadata = {
  pageCount?: number;
  wordCount: number;
  estimatedReadTimeMinutes: number;
  language?: string;
  author?: string;
};

export type ParsedDocument = {
  title: string;
  type: DocumentType;
  content: string;
  sections: DocumentSection[];
  metadata: DocumentMetadata;
  rawText: string;
};

const EXTENSION_MAP: Record<string, DocumentType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "docx",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".text": "text",
};

export function detectDocumentType(fileName: string): DocumentType {
  const lower = fileName.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex === -1) return "text";
  const ext = lower.slice(dotIndex);
  return EXTENSION_MAP[ext] ?? "text";
}

export function estimateReadTime(wordCount: number, wpm = 200): number {
  return Math.ceil(wordCount / wpm);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function extractTitle(text: string, fallback: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0);
  return firstLine?.trim().slice(0, 200) ?? fallback;
}

function fileBaseName(fileName: string): string {
  const name = fileName.split(/[/\\]/).pop() ?? fileName;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

export function splitIntoSentences(text: string): string[] {
  const abbreviations = new Set([
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "sr",
    "jr",
    "st",
    "ave",
    "blvd",
    "dept",
    "est",
    "vol",
    "vs",
    "etc",
    "inc",
    "ltd",
    "co",
    "corp",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
    "fig",
    "approx",
    "govt",
    "org",
    "univ",
  ]);

  const results: string[] = [];
  let current = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    current += ch;

    if ((ch === "." || ch === "!" || ch === "?") && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === " " || next === "\n" || next === "\r") {
        if (ch === ".") {
          const before = current.slice(0, -1);
          const lastSpace = before.lastIndexOf(" ");
          const word = before
            .slice(lastSpace + 1)
            .toLowerCase()
            .replace(/[^a-z]/g, "");
          if (abbreviations.has(word)) {
            continue;
          }
        }
        const trimmed = current.trim();
        if (trimmed) results.push(trimmed);
        current = "";
      }
    }
  }

  const trimmed = current.trim();
  if (trimmed) results.push(trimmed);
  return results;
}

export function filterSmartContent(text: string): string {
  let result = text;
  result = result.replace(/^[\s]*[-—–]?\s*\d+\s*[-—–]?\s*$/gm, "");
  result = result.replace(/^\s*page\s+\d+\s*(of\s+\d+)?\s*$/gim, "");
  result = result.replace(/\[\d+\]/g, "");
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

function buildMetadata(text: string, pageCount?: number): DocumentMetadata {
  const wc = countWords(text);
  const meta: DocumentMetadata = {
    wordCount: wc,
    estimatedReadTimeMinutes: estimateReadTime(wc),
  };
  if (pageCount !== undefined) {
    meta.pageCount = pageCount;
  }
  return meta;
}

export async function parsePdf(
  buffer: ArrayBuffer,
  fileName = "document.pdf",
): Promise<ParsedDocument> {
  let pdfjsLib: typeof import("pdfjs-dist");
  try {
    pdfjsLib = await import("pdfjs-dist");
  } catch {
    throw new Error("pdfjs-dist is not available in this environment");
  }

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
  }

  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join(" ");
    pageTexts.push(pageText);
  }

  const rawText = pageTexts.join("\n\n");
  const filtered = filterSmartContent(rawText);
  const title = extractTitle(filtered, fileBaseName(fileName));

  const sections: DocumentSection[] = pageTexts.map((pt, idx) => ({
    id: `page-${idx + 1}`,
    title: `Page ${idx + 1}`,
    content: pt,
    level: 1,
    startIndex: rawText.indexOf(pt),
    endIndex: rawText.indexOf(pt) + pt.length,
  }));

  return {
    title,
    type: "pdf",
    content: filtered,
    sections,
    metadata: buildMetadata(filtered, doc.numPages),
    rawText,
  };
}

export async function parseDocx(
  buffer: ArrayBuffer,
  fileName = "document.docx",
): Promise<ParsedDocument> {
  let mammoth: typeof import("mammoth");
  try {
    mammoth = await import("mammoth");
  } catch {
    throw new Error("mammoth is not available in this environment");
  }

  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const rawText = result.value;
  const filtered = filterSmartContent(rawText);
  const title = extractTitle(filtered, fileBaseName(fileName));

  const paragraphs = filtered.split(/\n\n+/).filter((p) => p.trim());
  const sections: DocumentSection[] = paragraphs.map((p, idx) => {
    const start = filtered.indexOf(p);
    return {
      id: `section-${idx + 1}`,
      title: p.slice(0, 60).trim(),
      content: p,
      level: 1,
      startIndex: start,
      endIndex: start + p.length,
    };
  });

  return {
    title,
    type: "docx",
    content: filtered,
    sections,
    metadata: buildMetadata(filtered),
    rawText,
  };
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export function parseMarkdown(
  text: string,
  fileName = "document.md",
): ParsedDocument {
  const html = marked(text) as string;
  const plainText = stripHtmlTags(html).trim();
  const filtered = filterSmartContent(plainText);

  const tokens = lexer(text);
  const sections: DocumentSection[] = [];
  let sectionIndex = 0;

  function walkTokens(tokenList: Token[]) {
    for (const token of tokenList) {
      if (token.type === "heading") {
        const heading = token as Tokens.Heading;
        const start = text.indexOf(heading.raw);
        sections.push({
          id: `heading-${sectionIndex++}`,
          title: heading.text,
          content: heading.raw,
          level: heading.depth,
          startIndex: start,
          endIndex: start + heading.raw.length,
        });
      }
    }
  }

  walkTokens(tokens);

  const title =
    sections.length > 0
      ? sections[0]!.title
      : extractTitle(text, fileBaseName(fileName));

  return {
    title,
    type: "markdown",
    content: filtered,
    sections,
    metadata: buildMetadata(filtered),
    rawText: text,
  };
}

export function parsePlainText(
  text: string,
  fileName = "document.txt",
): ParsedDocument {
  const filtered = filterSmartContent(text);
  const paragraphs = filtered.split(/\n\n+/).filter((p) => p.trim());

  const sections: DocumentSection[] = paragraphs.map((p, idx) => {
    const start = filtered.indexOf(p);
    return {
      id: `section-${idx + 1}`,
      title: p.slice(0, 60).trim(),
      content: p,
      level: 1,
      startIndex: start,
      endIndex: start + p.length,
    };
  });

  const title = extractTitle(filtered, fileBaseName(fileName));

  return {
    title,
    type: "text",
    content: filtered,
    sections,
    metadata: buildMetadata(filtered),
    rawText: text,
  };
}

export async function parseDocument(
  fileName: string,
  data: ArrayBuffer | string,
): Promise<ParsedDocument> {
  const docType = detectDocumentType(fileName);

  switch (docType) {
    case "pdf":
      if (typeof data === "string") throw new Error("PDF requires ArrayBuffer");
      return parsePdf(data, fileName);
    case "docx":
      if (typeof data === "string")
        throw new Error("DOCX requires ArrayBuffer");
      return parseDocx(data, fileName);
    case "markdown":
      if (typeof data !== "string") throw new Error("Markdown requires string");
      return parseMarkdown(data, fileName);
    case "text":
      if (typeof data !== "string")
        throw new Error("Plain text requires string");
      return parsePlainText(data, fileName);
  }
}
