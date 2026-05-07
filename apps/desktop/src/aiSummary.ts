import type { TranscriptSegment } from "./segmentEditor";
import type { LlmRewriterConfig } from "./llmRewriter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SummaryStyle =
  | "brief"
  | "detailed"
  | "bullets"
  | "action-items"
  | "meeting-notes";

export type SummaryRequest = {
  transcript: string;
  segments?: TranscriptSegment[];
  style: SummaryStyle;
  maxLength?: number;
};

export type ActionItem = {
  text: string;
  assignee?: string | undefined;
  priority: "high" | "medium" | "low";
  dueDate?: string | undefined;
};

export type SummaryResult = {
  summary: string;
  actionItems: ActionItem[];
  keyDecisions: string[];
  participants: string[];
  duration?: string | undefined;
  method: "local" | "cloud";
  latencyMs: number;
};

// ---------------------------------------------------------------------------
// Participant extraction
// ---------------------------------------------------------------------------

export function extractParticipants(segments: TranscriptSegment[]): string[] {
  const speakers = new Set<string>();
  for (const seg of segments) {
    if (seg.speaker) {
      speakers.add(seg.speaker.trim());
    }
  }
  return [...speakers].sort();
}

// ---------------------------------------------------------------------------
// Action-item extraction (regex-based, offline)
// ---------------------------------------------------------------------------

const ACTION_PATTERNS = [
  /(?:we |i |they |you )?need to\s+(.+?)(?:\.|$)/gi,
  /(?:we |i |they |you )?should\s+(.+?)(?:\.|$)/gi,
  /(?:we |i |they |you )?will\s+(.+?)(?:\.|$)/gi,
  /(?:we |i |they |you )?must\s+(.+?)(?:\.|$)/gi,
  /action item[:\s]+(.+?)(?:\.|$)/gi,
  /todo[:\s]+(.+?)(?:\.|$)/gi,
  /(?:please|let's|let us)\s+(.+?)(?:\.|$)/gi,
  /(?:make sure|ensure)\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
];

const PRIORITY_HIGH =
  /urgent|asap|critical|immediately|right away|high priority/i;
const PRIORITY_LOW =
  /eventually|when possible|low priority|nice to have|someday/i;

function inferPriority(text: string): "high" | "medium" | "low" {
  if (PRIORITY_HIGH.test(text)) return "high";
  if (PRIORITY_LOW.test(text)) return "low";
  return "medium";
}

function inferAssignee(
  sentence: string,
  participants: string[],
): string | undefined {
  for (const p of participants) {
    if (sentence.toLowerCase().includes(p.toLowerCase())) {
      return p;
    }
  }
  return undefined;
}

function findSurroundingSentence(text: string, matchIndex: number): string {
  // Walk backward to find sentence start
  let start = matchIndex;
  while (start > 0 && !/[.!?\n]/.test(text.charAt(start - 1))) {
    start--;
  }
  // Walk forward to find sentence end
  let end = matchIndex;
  while (end < text.length && !/[.!?\n]/.test(text.charAt(end))) {
    end++;
  }
  return text.slice(start, end + 1).trim();
}

function isDuplicate(normalized: string, seen: Set<string>): boolean {
  for (const existing of seen) {
    if (existing.includes(normalized) || normalized.includes(existing)) {
      return true;
    }
  }
  return false;
}

export function extractActionItems(
  text: string,
  participants: string[] = [],
): ActionItem[] {
  const seen = new Set<string>();
  const items: ActionItem[] = [];

  for (const pattern of ACTION_PATTERNS) {
    // Reset lastIndex for each global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1]?.trim();
      if (!raw || raw.length < 5) continue;
      const normalized = raw.toLowerCase();
      if (seen.has(normalized) || isDuplicate(normalized, seen)) continue;
      seen.add(normalized);

      const sentence = findSurroundingSentence(text, match.index);
      items.push({
        text: raw.charAt(0).toUpperCase() + raw.slice(1),
        assignee: inferAssignee(sentence, participants),
        priority: inferPriority(sentence),
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Key-decision extraction (regex-based, offline)
// ---------------------------------------------------------------------------

const DECISION_PATTERNS = [
  /(?:we |they |the team )?decided\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
  /(?:we |they |the team )?agreed\s+(?:to\s+|that\s+)?(.+?)(?:\.|$)/gi,
  /(?:the )?conclusion\s+(?:is|was)\s+(?:that\s+)?(.+?)(?:\.|$)/gi,
  /(?:we |they )?resolved\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
  /(?:the )?decision\s+(?:is|was)\s+(?:to\s+|that\s+)?(.+?)(?:\.|$)/gi,
  /(?:we |they )?chose\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
  /(?:it was |we )determined\s+(?:that\s+)?(.+?)(?:\.|$)/gi,
  /(?:we )finalized\s+(.+?)(?:\.|$)/gi,
];

export function extractKeyDecisions(text: string): string[] {
  const seen = new Set<string>();
  const decisions: string[] = [];

  for (const pattern of DECISION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1]?.trim();
      if (!raw || raw.length < 5) continue;
      const normalized = raw.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      decisions.push(raw.charAt(0).toUpperCase() + raw.slice(1));
    }
  }

  return decisions;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildSummaryPrompt(request: SummaryRequest): string {
  const parts: string[] = [];

  parts.push(
    "You are a meeting assistant. Analyze the following transcript and return a JSON response.",
  );
  parts.push("Do NOT include any text outside the JSON object.");
  parts.push("");

  const maxLen = request.maxLength ?? 500;

  switch (request.style) {
    case "brief":
      parts.push(
        `Provide a 2-3 sentence summary (max ${maxLen} chars) capturing the main points.`,
      );
      break;
    case "detailed":
      parts.push(
        `Provide a detailed paragraph summary (max ${maxLen} chars) with all key points, context, and nuances.`,
      );
      break;
    case "bullets":
      parts.push(
        "Provide a bullet-point list of the key points discussed. Each bullet should be a concise statement.",
      );
      break;
    case "action-items":
      parts.push(
        "Extract all action items from the transcript. For each, identify who is responsible (if mentioned) and the priority (high/medium/low).",
      );
      break;
    case "meeting-notes":
      parts.push(
        "Generate full meeting minutes including: attendees, agenda topics discussed, key decisions made, and action items with assignees.",
      );
      break;
  }

  parts.push("");
  parts.push("Return valid JSON matching this schema:");
  parts.push(
    JSON.stringify(
      {
        summary: "string — the summary text",
        actionItems: [
          {
            text: "string",
            assignee: "string or null",
            priority: "high | medium | low",
            dueDate: "string or null",
          },
        ],
        keyDecisions: ["string"],
        participants: ["string"],
      },
      null,
      2,
    ),
  );

  if (request.segments && request.segments.length > 0) {
    parts.push("");
    parts.push("Speaker-labelled transcript:");
    for (const seg of request.segments) {
      const label = seg.speaker ?? "Unknown";
      parts.push(`[${label}]: ${seg.text}`);
    }
  } else {
    parts.push("");
    parts.push("Transcript:");
    parts.push(request.transcript);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// LLM-backed summarization
// ---------------------------------------------------------------------------

async function callLlm(
  prompt: string,
  config: LlmRewriterConfig,
): Promise<string> {
  if (config.provider === "openai") {
    const model = config.model ?? "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: config.maxTokens ?? 2048,
        temperature: config.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response");
    return content.trim();
  }

  if (config.provider === "anthropic") {
    const model = config.model ?? "claude-sonnet-4-20250514";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: config.maxTokens ?? 2048,
        messages: [{ role: "user", content: prompt }],
        temperature: config.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      content?: { type?: string; text?: string }[];
    };
    const textBlock = json.content?.find((b) => b.type === "text");
    if (!textBlock?.text) throw new Error("Anthropic returned empty response");
    return textBlock.text.trim();
  }

  throw new Error(`Unsupported provider: ${config.provider}`);
}

function parseLlmResponse(raw: string): Partial<SummaryResult> {
  // Try to extract JSON from the response (might be wrapped in markdown fences)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { summary: raw };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const result: Partial<SummaryResult> = {};

    if (typeof parsed.summary === "string") {
      result.summary = parsed.summary;
    }

    if (Array.isArray(parsed.actionItems)) {
      result.actionItems = (parsed.actionItems as Record<string, unknown>[])
        .filter((item) => typeof item.text === "string")
        .map((item) => ({
          text: item.text as string,
          assignee:
            typeof item.assignee === "string" ? item.assignee : undefined,
          priority:
            item.priority === "high" ||
            item.priority === "medium" ||
            item.priority === "low"
              ? item.priority
              : "medium",
          dueDate: typeof item.dueDate === "string" ? item.dueDate : undefined,
        }));
    }

    if (Array.isArray(parsed.keyDecisions)) {
      result.keyDecisions = (parsed.keyDecisions as unknown[]).filter(
        (d): d is string => typeof d === "string",
      );
    }

    if (Array.isArray(parsed.participants)) {
      result.participants = (parsed.participants as unknown[]).filter(
        (p): p is string => typeof p === "string",
      );
    }

    return result;
  } catch {
    return { summary: raw };
  }
}

export async function summarizeWithLlm(
  request: SummaryRequest,
  config: LlmRewriterConfig,
): Promise<SummaryResult> {
  const prompt = buildSummaryPrompt(request);
  const start = Date.now();

  const raw = await callLlm(prompt, config);
  const parsed = parseLlmResponse(raw);

  const participants =
    parsed.participants ??
    (request.segments ? extractParticipants(request.segments) : []);

  return {
    summary: parsed.summary ?? "",
    actionItems: parsed.actionItems ?? [],
    keyDecisions: parsed.keyDecisions ?? [],
    participants,
    method: "cloud",
    latencyMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Local (offline) summarization
// ---------------------------------------------------------------------------

function extractKeySentences(text: string, maxSentences: number): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= maxSentences) return sentences;

  // Score sentences by word count and position — longer and earlier sentences
  // tend to carry more information.
  const scored = sentences.map((s, i) => ({
    text: s,
    index: i,
    score: s.split(/\s+/).length * (1 + 1 / (i + 1)),
  }));

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, maxSentences);

  // Return in original order
  selected.sort((a, b) => a.index - b.index);
  return selected.map((s) => s.text);
}

function estimateDuration(segments: TranscriptSegment[]): string | undefined {
  if (segments.length === 0) return undefined;
  const firstStart = segments[0]!.startMs;
  const lastEnd = segments[segments.length - 1]!.endMs;
  const totalMs = lastEnd - firstStart;
  if (totalMs <= 0) return undefined;

  const totalSec = Math.round(totalMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function summarizeLocally(request: SummaryRequest): SummaryResult {
  const start = Date.now();
  const { transcript, segments, style } = request;

  const participants = segments ? extractParticipants(segments) : [];
  const actionItems = extractActionItems(transcript, participants);
  const keyDecisions = extractKeyDecisions(transcript);
  const duration = segments ? estimateDuration(segments) : undefined;

  let summary: string;

  switch (style) {
    case "brief": {
      const keySentences = extractKeySentences(transcript, 3);
      summary = keySentences.join(" ");
      break;
    }
    case "detailed": {
      const keySentences = extractKeySentences(transcript, 6);
      summary = keySentences.join(" ");
      if (keyDecisions.length > 0) {
        summary += `\n\nKey decisions: ${keyDecisions.join("; ")}.`;
      }
      break;
    }
    case "bullets": {
      const keySentences = extractKeySentences(transcript, 8);
      summary = keySentences.map((s) => `- ${s}`).join("\n");
      break;
    }
    case "action-items": {
      if (actionItems.length === 0) {
        summary = "No action items identified in the transcript.";
      } else {
        summary = actionItems
          .map((item) => {
            let line = `- [${item.priority.toUpperCase()}] ${item.text}`;
            if (item.assignee) line += ` (${item.assignee})`;
            return line;
          })
          .join("\n");
      }
      break;
    }
    case "meeting-notes": {
      const parts: string[] = [];
      parts.push("# Meeting Notes\n");
      if (participants.length > 0) {
        parts.push(`**Attendees:** ${participants.join(", ")}\n`);
      }
      if (duration) {
        parts.push(`**Duration:** ${duration}\n`);
      }
      parts.push("## Summary\n");
      const keySentences = extractKeySentences(transcript, 4);
      parts.push(keySentences.join(" "));
      if (keyDecisions.length > 0) {
        parts.push("\n\n## Key Decisions\n");
        parts.push(keyDecisions.map((d) => `- ${d}`).join("\n"));
      }
      if (actionItems.length > 0) {
        parts.push("\n\n## Action Items\n");
        parts.push(
          actionItems
            .map((item) => {
              let line = `- [${item.priority.toUpperCase()}] ${item.text}`;
              if (item.assignee) line += ` (${item.assignee})`;
              return line;
            })
            .join("\n"),
        );
      }
      summary = parts.join("");
      break;
    }
  }

  // Apply maxLength truncation
  if (request.maxLength && summary.length > request.maxLength) {
    summary = summary.slice(0, request.maxLength - 3) + "...";
  }

  return {
    summary,
    actionItems,
    keyDecisions,
    participants,
    duration,
    method: "local",
    latencyMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Smart dispatcher (cloud with local fallback)
// ---------------------------------------------------------------------------

export async function summarize(
  request: SummaryRequest,
  config?: LlmRewriterConfig,
): Promise<SummaryResult> {
  // Empty or extremely short transcript — return immediately
  if (!request.transcript.trim()) {
    return {
      summary: "",
      actionItems: [],
      keyDecisions: [],
      participants: request.segments
        ? extractParticipants(request.segments)
        : [],
      method: "local",
      latencyMs: 0,
    };
  }

  // No config, local provider, or missing API key — use local
  if (!config || config.provider === "local" || !config.apiKey) {
    return summarizeLocally(request);
  }

  // Try cloud, fall back to local on any error
  try {
    return await summarizeWithLlm(request, config);
  } catch {
    return summarizeLocally(request);
  }
}
