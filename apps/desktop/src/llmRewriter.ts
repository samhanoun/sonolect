import { polishDictation } from "./wisprWorkflow";
import { applyStylePreset } from "./stylePresets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StylePresetId = "concise" | "professional" | "casual" | "technical" | "custom";

export type RewriteRequest = {
  text: string;
  style?: StylePresetId;
  instruction?: string;
  context?: string;
};

export type RewriteResult = {
  original: string;
  rewritten: string;
  method: "local" | "cloud";
  latencyMs: number;
  changes: string[];
};

export type LlmRewriterConfig = {
  provider: "local" | "openai" | "anthropic";
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

// ---------------------------------------------------------------------------
// Local rewriting (always available, no network)
// ---------------------------------------------------------------------------

export function rewriteWithLocalRules(request: RewriteRequest): RewriteResult {
  const start = Date.now();
  const { text, style } = request;

  // Step 1: Polish dictation (filler removal, sentence cleanup)
  let rewritten = polishDictation(text);

  // Step 2: Apply style preset if requested
  if (style && style !== "custom") {
    rewritten = applyStylePreset(rewritten, style);
  }

  const changes: string[] = [];
  if (rewritten !== text) {
    if (rewritten.length < text.length) {
      changes.push("Removed filler words and redundancies");
    }
    if (style && style !== "custom") {
      changes.push(`Applied ${style} style`);
    }
    if (/[A-Z]/.test(rewritten.charAt(0)) && /[a-z]/.test(text.charAt(0))) {
      changes.push("Fixed capitalisation");
    }
    if (rewritten.endsWith(".") && !text.endsWith(".")) {
      changes.push("Added punctuation");
    }
    if (changes.length === 0) {
      changes.push("Cleaned up text");
    }
  }

  return {
    original: text,
    rewritten,
    method: "local",
    latencyMs: Date.now() - start,
    changes,
  };
}

// ---------------------------------------------------------------------------
// LLM prompt construction
// ---------------------------------------------------------------------------

export function buildRewritePrompt(request: RewriteRequest): string {
  const parts: string[] = [
    "You are a professional editor. Rewrite the following dictated text.",
    "Preserve the speaker's intent and meaning.",
    "Remove filler words, fix grammar, and improve clarity.",
  ];

  if (request.style) {
    const styleGuide: Record<StylePresetId, string> = {
      concise: "Make the text concise: remove redundancy, shorten sentences, keep the core meaning.",
      professional: "Use a professional tone: formal language, no contractions, business-appropriate.",
      casual: "Use a casual tone: conversational, friendly, contractions are fine.",
      technical: "Use a technical style: precise terminology, structured, no ambiguity.",
      custom: "",
    };
    const guide = styleGuide[request.style];
    if (guide) {
      parts.push(guide);
    }
  }

  if (request.instruction) {
    parts.push(`Additional instruction: ${request.instruction}`);
  }

  if (request.context) {
    parts.push(`Context about the text: ${request.context}`);
  }

  parts.push("Return ONLY the rewritten text, no commentary or explanation.");
  parts.push("");
  parts.push(`Text to rewrite:\n${request.text}`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Cloud LLM rewriting
// ---------------------------------------------------------------------------

async function callOpenAi(
  prompt: string,
  config: LlmRewriterConfig,
): Promise<string> {
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
  config: LlmRewriterConfig,
): Promise<string> {
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

export async function rewriteWithLlm(
  request: RewriteRequest,
  config: LlmRewriterConfig,
): Promise<RewriteResult> {
  const prompt = buildRewritePrompt(request);
  const start = Date.now();

  try {
    let rewritten: string;
    if (config.provider === "openai") {
      rewritten = await callOpenAi(prompt, config);
    } else if (config.provider === "anthropic") {
      rewritten = await callAnthropic(prompt, config);
    } else {
      // provider === "local" — delegate immediately
      return rewriteWithLocalRules(request);
    }

    const changes: string[] = ["LLM-powered rewrite"];
    if (request.style) {
      changes.push(`Applied ${request.style} style`);
    }

    return {
      original: request.text,
      rewritten,
      method: "cloud",
      latencyMs: Date.now() - start,
      changes,
    };
  } catch {
    // Fallback to local rules on any cloud error
    return rewriteWithLocalRules(request);
  }
}

// ---------------------------------------------------------------------------
// Smart dispatcher
// ---------------------------------------------------------------------------

export async function rewrite(
  request: RewriteRequest,
  config?: LlmRewriterConfig,
): Promise<RewriteResult> {
  // If no config or provider is local, use local rules
  if (!config || config.provider === "local") {
    return rewriteWithLocalRules(request);
  }

  // If config is provided but missing API key, fall back to local
  if (!config.apiKey) {
    return rewriteWithLocalRules(request);
  }

  // Try cloud, falls back to local on error internally
  return rewriteWithLlm(request, config);
}
