import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentCommandSystemPrompt, agentPrompts } from "@sonolect/prompts";
import type {
  AgentCommandExecutionResult,
  AgentCommandType,
  AgentDefinition,
  ListResponse,
} from "@sonolect/types";
import {
  agentCommandExecutionRequestSchema,
  type AgentCommandExecutionInput,
} from "@sonolect/validation";

const serviceName = "sonolect-agent-service";
const localUserId = "local-user";
const localNow = new Date().toISOString();

interface InMemoryStores {
  agents: Map<string, AgentDefinition>;
  commands: Map<string, AgentCommandExecutionResult>;
}

export interface CreateAppOptions {
  stores?: InMemoryStores;
  logger?: boolean;
}

const createStores = (): InMemoryStores => ({
  agents: new Map<string, AgentDefinition>([
    [
      "dictation",
      {
        id: "dictation",
        name: "Dictation Agent",
        type: "dictation",
        systemPrompt: agentPrompts.dictation,
        enabled: true,
        createdAt: localNow,
      },
    ],
    [
      "command",
      {
        id: "command",
        name: "Command Agent",
        type: "command",
        systemPrompt: agentCommandSystemPrompt,
        enabled: true,
        createdAt: localNow,
      },
    ],
  ]),
  commands: new Map<string, AgentCommandExecutionResult>(),
});

const getRouteContext = (request: FastifyRequest): { userId: string } => {
  const header = request.headers["x-user-id"];
  return {
    userId: Array.isArray(header)
      ? (header[0] ?? localUserId)
      : (header ?? localUserId),
  };
};

const parseBody = <T>(
  schema: { parse: (value: unknown) => T },
  request: FastifyRequest,
): T => schema.parse(request.body ?? {});

const sendValidationError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: "validation_error",
      message: "Request validation failed",
      issues: error.issues,
    });
  }
  throw error;
};

const optionalProps = (
  value: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([, prop]) => prop !== undefined),
  );

const blockedPatterns = [
  /delete\s+everything/i,
  /format\s+disk/i,
  /password|secret|token/i,
  /rm\s+-rf/i,
];

const inferCommandType = (
  input: AgentCommandExecutionInput,
): AgentCommandType => {
  if (input.type !== "custom") return input.type;
  if (/^https?:\/\//i.test(input.command) || /open\s+/i.test(input.command))
    return "open_url";
  if (/copy/i.test(input.command)) return "copy_to_clipboard";
  if (/task|todo|remind/i.test(input.command)) return "create_task";
  if (/insert|paste|write/i.test(input.command)) return "insert_text";
  return "custom";
};

const planActions = (
  type: AgentCommandType,
  input: AgentCommandExecutionInput,
): string[] => {
  switch (type) {
    case "copy_to_clipboard":
      return [
        `Copy ${input.selectedText ? "selected text" : "command output"} to clipboard`,
      ];
    case "open_url":
      return [
        `Validate and open URL: ${String(input.arguments.url ?? input.command)}`,
      ];
    case "create_task":
      return [`Create task from command: ${input.command}`];
    case "insert_text":
      return [`Insert generated text into the active target`];
    case "custom":
      return [
        `Prepare custom command plan`,
        `Await explicit integration before external execution`,
      ];
  }
};

const executeCommand = (
  userId: string,
  input: AgentCommandExecutionInput,
): AgentCommandExecutionResult => {
  const now = new Date().toISOString();
  const type = inferCommandType(input);
  const blockedReason = blockedPatterns.some((pattern) =>
    pattern.test(input.command),
  )
    ? "Command appears destructive or credential-related and was blocked by the safe placeholder executor."
    : undefined;
  const dryRun = input.dryRun || Boolean(blockedReason);
  const plannedActions = planActions(type, input);

  return {
    id: randomUUID(),
    userId,
    command: input.command,
    type,
    status: blockedReason ? "blocked" : dryRun ? "queued" : "completed",
    dryRun,
    createdAt: now,
    completedAt: blockedReason || dryRun ? undefined : now,
    output: blockedReason
      ? undefined
      : dryRun
        ? "Dry run only; no external action was executed."
        : `Executed placeholder command: ${input.command}`,
    plannedActions,
    ...optionalProps({ transcriptId: input.transcriptId, blockedReason }),
  } as AgentCommandExecutionResult;
};

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores = options.stores ?? createStores();
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });

  app.get("/health", async () => ({
    status: "ok",
    service: serviceName,
    executor: "safe-placeholder",
  }));

  app.get(
    "/agents",
    async (request): Promise<ListResponse<AgentDefinition>> => {
      const { userId } = getRouteContext(request);
      return {
        items: [...stores.agents.values()].filter(
          (agent) => !agent.userId || agent.userId === userId,
        ),
      };
    },
  );

  app.post(
    "/agents",
    async (request, reply): Promise<AgentDefinition | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const schema = z.object({
          name: z.string().min(1).max(120),
          type: z.string().min(1).max(80),
          systemPrompt: z.string().min(1).max(10_000),
          enabled: z.boolean().default(true),
        });
        const input = parseBody<z.infer<typeof schema>>(schema, request);
        const agent = {
          id: randomUUID(),
          userId,
          createdAt: new Date().toISOString(),
          ...input,
        } satisfies AgentDefinition;
        stores.agents.set(agent.id, agent);
        return reply.status(201).send(agent);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.post(
    "/commands/execute",
    async (
      request,
      reply,
    ): Promise<AgentCommandExecutionResult | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const input = parseBody<AgentCommandExecutionInput>(
          agentCommandExecutionRequestSchema,
          request,
        );
        const result = executeCommand(userId, input);
        stores.commands.set(result.id, result);
        return reply.status(202).send(result);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/commands/:id",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const command = stores.commands.get(request.params.id);
      if (!command || command.userId !== userId)
        return reply
          .status(404)
          .send({ error: "not_found", message: "Command execution not found" });
      return command;
    },
  );

  // -------------------------------------------------------------------------
  // LLM proxy routes — keep API keys server-side only
  // -------------------------------------------------------------------------

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();

  // Simple in-memory rate limiter per userId
  const llmRateLimits = new Map<string, { count: number; resetAt: number }>();
  const LLM_RATE_LIMIT_MAX = 30; // requests per window
  const LLM_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

  function checkLlmRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = llmRateLimits.get(userId);
    if (!entry || now >= entry.resetAt) {
      llmRateLimits.set(userId, {
        count: 1,
        resetAt: now + LLM_RATE_LIMIT_WINDOW_MS,
      });
      return true;
    }
    if (entry.count >= LLM_RATE_LIMIT_MAX) return false;
    entry.count++;
    return true;
  }

  // --- Backend LLM callers (adapted from desktop llmRewriter / aiSummary) ---

  type LlmProvider = "openai" | "anthropic";

  function resolveProvider():
    | { provider: LlmProvider; apiKey: string }
    | undefined {
    if (OPENAI_API_KEY) return { provider: "openai", apiKey: OPENAI_API_KEY };
    if (ANTHROPIC_API_KEY)
      return { provider: "anthropic", apiKey: ANTHROPIC_API_KEY };
    return undefined;
  }

  async function callOpenAiBackend(
    prompt: string,
    apiKey: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature,
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

  async function callAnthropicBackend(
    prompt: string,
    apiKey: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
        temperature,
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

  async function callLlmBackend(
    prompt: string,
    provider: LlmProvider,
    apiKey: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    if (provider === "openai") {
      return callOpenAiBackend(prompt, apiKey, maxTokens, temperature);
    }
    return callAnthropicBackend(prompt, apiKey, maxTokens, temperature);
  }

  // --- Rewrite prompt builder (mirrors desktop logic) ---

  type StylePresetId =
    | "concise"
    | "professional"
    | "casual"
    | "technical"
    | "custom";

  function buildRewritePromptBackend(body: {
    text: string;
    style?: StylePresetId;
    instruction?: string;
    context?: string;
  }): string {
    const parts: string[] = [
      "You are a professional editor. Rewrite the following dictated text.",
      "Preserve the speaker's intent and meaning.",
      "Remove filler words, fix grammar, and improve clarity.",
    ];
    if (body.style) {
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
      const guide = styleGuide[body.style];
      if (guide) parts.push(guide);
    }
    if (body.instruction)
      parts.push(`Additional instruction: ${body.instruction}`);
    if (body.context) parts.push(`Context about the text: ${body.context}`);
    parts.push("Return ONLY the rewritten text, no commentary or explanation.");
    parts.push("");
    parts.push(`Text to rewrite:\n${body.text}`);
    return parts.join("\n");
  }

  // --- Schemas ---

  const llmRewriteSchema = z.object({
    text: z.string().min(1).max(50_000),
    style: z
      .enum(["concise", "professional", "casual", "technical", "custom"])
      .optional(),
    instruction: z.string().max(2000).optional(),
    context: z.string().max(5000).optional(),
  });

  const summaryStyleSchema = z.enum([
    "brief",
    "detailed",
    "bullets",
    "action-items",
    "meeting-notes",
  ]);

  const llmSummarizeSchema = z.object({
    transcript: z.string().min(1).max(200_000),
    segments: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          startMs: z.number(),
          endMs: z.number(),
          speaker: z.string().optional(),
        }),
      )
      .optional(),
    style: summaryStyleSchema,
    maxLength: z.number().int().min(50).max(50_000).optional(),
  });

  // --- POST /llm/rewrite ---

  app.post("/llm/rewrite", async (request, reply) => {
    try {
      const { userId } = getRouteContext(request);
      if (!checkLlmRateLimit(userId)) {
        return reply.status(429).send({
          error: "rate_limit_exceeded",
          message: "Too many LLM requests. Please try again later.",
        });
      }

      const body = parseBody(llmRewriteSchema, request);
      const resolved = resolveProvider();

      if (!resolved) {
        // No API keys — return a local-fallback-style result
        return reply.send({
          original: body.text,
          rewritten: body.text,
          method: "local",
          latencyMs: 0,
          changes: [],
        });
      }

      const prompt = buildRewritePromptBackend(body);
      const start = Date.now();
      const rewritten = await callLlmBackend(
        prompt,
        resolved.provider,
        resolved.apiKey,
        1024,
        0.3,
      );
      const latencyMs = Date.now() - start;

      const changes: string[] = ["LLM-powered rewrite"];
      if (body.style) changes.push(`Applied ${body.style} style`);

      app.log.info(
        {
          userId,
          provider: resolved.provider,
          latencyMs,
          textLength: body.text.length,
        },
        "LLM rewrite completed",
      );

      return reply.send({
        original: body.text,
        rewritten,
        method: "cloud",
        latencyMs,
        changes,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendValidationError(reply, error);
      }
      app.log.error(error, "LLM rewrite failed");
      return reply.status(502).send({
        error: "llm_error",
        message:
          "LLM request failed. Client should fall back to local processing.",
      });
    }
  });

  // --- POST /llm/summarize ---

  function buildSummaryPromptBackend(
    body: z.infer<typeof llmSummarizeSchema>,
  ): string {
    const parts: string[] = [];
    parts.push(
      "You are a meeting assistant. Analyze the following transcript and return a JSON response.",
    );
    parts.push("Do NOT include any text outside the JSON object.");
    parts.push("");

    const maxLen = body.maxLength ?? 500;

    switch (body.style) {
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

    if (body.segments && body.segments.length > 0) {
      parts.push("");
      parts.push("Speaker-labelled transcript:");
      for (const seg of body.segments) {
        const label = seg.speaker ?? "Unknown";
        parts.push(`[${label}]: ${seg.text}`);
      }
    } else {
      parts.push("");
      parts.push("Transcript:");
      parts.push(body.transcript);
    }

    return parts.join("\n");
  }

  function parseLlmSummaryResponse(raw: string) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { summary: raw };

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const result: Record<string, unknown> = {};

      if (typeof parsed.summary === "string") result.summary = parsed.summary;

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
            dueDate:
              typeof item.dueDate === "string" ? item.dueDate : undefined,
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

  app.post("/llm/summarize", async (request, reply) => {
    try {
      const { userId } = getRouteContext(request);
      if (!checkLlmRateLimit(userId)) {
        return reply.status(429).send({
          error: "rate_limit_exceeded",
          message: "Too many LLM requests. Please try again later.",
        });
      }

      const body = parseBody(llmSummarizeSchema, request);
      const resolved = resolveProvider();

      if (!resolved) {
        // No API keys — return empty-ish result so client falls back to local
        return reply.send({
          summary: "",
          actionItems: [],
          keyDecisions: [],
          participants: [],
          method: "local",
          latencyMs: 0,
        });
      }

      const prompt = buildSummaryPromptBackend(body);
      const start = Date.now();
      const raw = await callLlmBackend(
        prompt,
        resolved.provider,
        resolved.apiKey,
        2048,
        0.2,
      );
      const latencyMs = Date.now() - start;

      const parsed = parseLlmSummaryResponse(raw);

      app.log.info(
        {
          userId,
          provider: resolved.provider,
          latencyMs,
          transcriptLength: body.transcript.length,
        },
        "LLM summarize completed",
      );

      return reply.send({
        summary: (parsed.summary as string) ?? "",
        actionItems: (parsed.actionItems as unknown[]) ?? [],
        keyDecisions: (parsed.keyDecisions as string[]) ?? [],
        participants: (parsed.participants as string[]) ?? [],
        method: "cloud",
        latencyMs,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendValidationError(reply, error);
      }
      app.log.error(error, "LLM summarize failed");
      return reply.status(502).send({
        error: "llm_error",
        message:
          "LLM request failed. Client should fall back to local processing.",
      });
    }
  });

  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port });
}
