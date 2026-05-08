import { polishDictation } from "./wisprWorkflow";
import { applyStylePreset } from "./stylePresets";
import { createAuthHeaders } from "./localDevAuth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StylePresetId =
  | "concise"
  | "professional"
  | "casual"
  | "technical"
  | "custom";

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
      concise:
        "Make the text concise: remove redundancy, shorten sentences, keep the core meaning.",
      professional:
        "Use a professional tone: formal language, no contractions, business-appropriate.",
      casual:
        "Use a casual tone: conversational, friendly, contractions are fine.",
      technical:
        "Use a technical style: precise terminology, structured, no ambiguity.",
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
// Cloud LLM rewriting (via backend proxy)
// ---------------------------------------------------------------------------

const API_URL = (
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_SONOLECT_API_URL?.trim()
    : undefined
) as string | undefined;

export async function rewriteWithLlm(
  request: RewriteRequest,
  config: LlmRewriterConfig,
): Promise<RewriteResult> {
  if (config.provider === "local") {
    return rewriteWithLocalRules(request);
  }

  const apiUrl = API_URL;
  if (!apiUrl) {
    // No backend URL configured — fall back to local
    return rewriteWithLocalRules(request);
  }

  const start = Date.now();

  try {
    const endpoint = new URL("/llm/rewrite", apiUrl).toString();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createAuthHeaders(),
      },
      body: JSON.stringify({
        text: request.text,
        ...(request.style ? { style: request.style } : {}),
        ...(request.instruction ? { instruction: request.instruction } : {}),
        ...(request.context ? { context: request.context } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend LLM proxy error ${response.status}`);
    }

    const result = (await response.json()) as RewriteResult;
    return {
      ...result,
      latencyMs: Date.now() - start,
    };
  } catch {
    // Fallback to local rules on any backend/network error
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

  // Try backend proxy, falls back to local on error internally
  return rewriteWithLlm(request, config);
}
