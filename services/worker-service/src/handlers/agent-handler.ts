// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentTaskType = "rewrite" | "summarize" | "extract-actions";

export interface AgentTask {
  taskType: AgentTaskType;
  text: string;
  style?: string;
  userId: string;
}

export interface AgentTaskResult {
  success: boolean;
  taskType: AgentTaskType;
  output: string;
  method: "cloud" | "local";
  durationMs: number;
  error?: string;
}

export interface LlmConfig {
  provider: "openai" | "anthropic";
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentHandlerDeps {
  fetchFn?: typeof globalThis.fetch;
  getEnv?: (key: string) => string | undefined;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildRewritePrompt(text: string, style?: string): string {
  const parts: string[] = [
    "You are a professional editor. Rewrite the following dictated text.",
    "Preserve the speaker's intent and meaning.",
    "Remove filler words, fix grammar, and improve clarity.",
  ];

  if (style) {
    const styleGuide: Record<string, string> = {
      concise:
        "Make the text concise: remove redundancy, shorten sentences, keep the core meaning.",
      professional:
        "Use a professional tone: formal language, no contractions, business-appropriate.",
      casual:
        "Use a casual tone: conversational, friendly, contractions are fine.",
      technical:
        "Use a technical style: precise terminology, structured, no ambiguity.",
    };
    const guide = styleGuide[style];
    if (guide) {
      parts.push(guide);
    }
  }

  parts.push("Return ONLY the rewritten text, no commentary or explanation.");
  parts.push("");
  parts.push(`Text to rewrite:\n${text}`);

  return parts.join("\n");
}

export function buildSummaryPrompt(text: string, style?: string): string {
  const parts: string[] = [
    "You are a meeting assistant. Summarize the following text.",
  ];

  if (style === "brief") {
    parts.push("Provide a 2-3 sentence summary capturing the main points.");
  } else if (style === "bullets") {
    parts.push(
      "Provide a bullet-point list of the key points discussed. Each bullet should be a concise statement.",
    );
  } else if (style === "detailed") {
    parts.push(
      "Provide a detailed paragraph summary with all key points, context, and nuances.",
    );
  } else {
    parts.push(
      "Provide a clear and concise summary capturing the main points.",
    );
  }

  parts.push("Return ONLY the summary, no commentary or explanation.");
  parts.push("");
  parts.push(`Text to summarize:\n${text}`);

  return parts.join("\n");
}

export function buildActionExtractionPrompt(text: string): string {
  const parts: string[] = [
    "You are a meeting assistant. Extract all action items from the following text.",
    "For each action item, return it on its own line prefixed with '- '.",
    "Include who is responsible if mentioned, and any deadlines.",
    "If no action items are found, return 'No action items identified.'",
    "",
    `Text:\n${text}`,
  ];

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// LLM API calls (same pattern as desktop llmRewriter.ts / aiSummary.ts)
// ---------------------------------------------------------------------------

async function callOpenAi(
  prompt: string,
  config: LlmConfig,
  fetchFn: typeof globalThis.fetch,
): Promise<string> {
  const model = config.model ?? "gpt-4o-mini";
  const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: config.maxTokens ?? 1024,
      temperature: config.temperature ?? 0.3,
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
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }
  return content.trim();
}

async function callAnthropic(
  prompt: string,
  config: LlmConfig,
  fetchFn: typeof globalThis.fetch,
): Promise<string> {
  const model = config.model ?? "claude-sonnet-4-20250514";
  const response = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: config.maxTokens ?? 1024,
      messages: [{ role: "user", content: prompt }],
      temperature: config.temperature ?? 0.3,
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
  if (!textBlock?.text) {
    throw new Error("Anthropic returned empty response");
  }
  return textBlock.text.trim();
}

// ---------------------------------------------------------------------------
// Local fallback (no API key needed)
// ---------------------------------------------------------------------------

function localRewrite(text: string, style?: string): string {
  // Basic local rewriting: trim whitespace, remove filler words, fix capitalisation
  let result = text
    .replace(
      /\b(um|uh|er|like|you know|basically|actually|literally)\b[,]?\s*/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();

  // Capitalise first letter
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  // Ensure ending punctuation
  if (result.length > 0 && !/[.!?]$/.test(result)) {
    result += ".";
  }

  if (style === "concise") {
    // Remove parenthetical asides for conciseness
    result = result
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return result;
}

function localSummarize(text: string): string {
  // Extract key sentences using a simple heuristic
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 3) {
    return sentences.join(" ");
  }

  // Pick first, middle, and last sentences as a rough summary
  const first = sentences[0]!;
  const middle = sentences[Math.floor(sentences.length / 2)]!;
  const last = sentences[sentences.length - 1]!;

  return [first, middle, last].join(" ");
}

function localExtractActions(text: string): string {
  const patterns = [
    /(?:we |i |they |you )?need to\s+(.+?)(?:\.|$)/gi,
    /(?:we |i |they |you )?should\s+(.+?)(?:\.|$)/gi,
    /(?:we |i |they |you )?will\s+(.+?)(?:\.|$)/gi,
    /(?:we |i |they |you )?must\s+(.+?)(?:\.|$)/gi,
    /action item[:\s]+(.+?)(?:\.|$)/gi,
    /todo[:\s]+(.+?)(?:\.|$)/gi,
    /(?:please|let's|let us)\s+(.+?)(?:\.|$)/gi,
  ];

  const seen = new Set<string>();
  const items: string[] = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1]?.trim();
      if (!raw || raw.length < 5) continue;
      const normalized = raw.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      items.push(`- ${raw.charAt(0).toUpperCase() + raw.slice(1)}`);
    }
  }

  if (items.length === 0) {
    return "No action items identified.";
  }

  return items.join("\n");
}

// ---------------------------------------------------------------------------
// Resolve LLM config from environment
// ---------------------------------------------------------------------------

function resolveLlmConfig(
  getEnv: (key: string) => string | undefined,
): LlmConfig | undefined {
  const openaiKey = getEnv("OPENAI_API_KEY");
  if (openaiKey?.trim()) {
    return { provider: "openai", apiKey: openaiKey.trim() };
  }

  const anthropicKey = getEnv("ANTHROPIC_API_KEY");
  if (anthropicKey?.trim()) {
    return { provider: "anthropic", apiKey: anthropicKey.trim() };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function processAgentTask(
  task: AgentTask,
  deps: AgentHandlerDeps = {},
): Promise<AgentTaskResult> {
  const start = Date.now();
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const getEnv = deps.getEnv ?? ((key: string) => process.env[key]);
  const llmConfig = resolveLlmConfig(getEnv);

  // Build prompt based on task type
  let prompt: string;
  switch (task.taskType) {
    case "rewrite":
      prompt = buildRewritePrompt(task.text, task.style);
      break;
    case "summarize":
      prompt = buildSummaryPrompt(task.text, task.style);
      break;
    case "extract-actions":
      prompt = buildActionExtractionPrompt(task.text);
      break;
  }

  // Try cloud LLM if config is available
  if (llmConfig) {
    try {
      let output: string;
      if (llmConfig.provider === "openai") {
        output = await callOpenAi(prompt, llmConfig, fetchFn);
      } else {
        output = await callAnthropic(prompt, llmConfig, fetchFn);
      }

      return {
        success: true,
        taskType: task.taskType,
        output,
        method: "cloud",
        durationMs: Date.now() - start,
      };
    } catch {
      // Fall through to local fallback
    }
  }

  // Local fallback
  try {
    let output: string;
    switch (task.taskType) {
      case "rewrite":
        output = localRewrite(task.text, task.style);
        break;
      case "summarize":
        output = localSummarize(task.text);
        break;
      case "extract-actions":
        output = localExtractActions(task.text);
        break;
    }

    return {
      success: true,
      taskType: task.taskType,
      output,
      method: "local",
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      taskType: task.taskType,
      output: "",
      method: "local",
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown agent error",
    };
  }
}
