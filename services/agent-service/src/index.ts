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
import {
  BoundedMap,
  ServiceHttpError,
  disableEndpoints,
  getServiceUserId,
  isProduction,
  registerServiceSecurity,
  resolveListenOptions,
  type ServiceEnv,
  type UnavailableEndpoint,
} from "@sonolect/service-kit";

const serviceName = "sonolect-agent-service";
const localNow = new Date().toISOString();

// In-memory stores are capped so a long-running instance cannot be filled up.
const MAX_AGENTS = 2_000;
const MAX_CUSTOM_AGENTS_PER_USER = 50;
const MAX_COMMANDS = 10_000;
const MAX_RATE_LIMIT_ENTRIES = 50_000;
const MAX_LLM_INPUT_CHARS = 50_000;
const LLM_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface InMemoryStores {
  agents: Map<string, AgentDefinition>;
  commands: Map<string, AgentCommandExecutionResult>;
  rateLimits: Map<string, RateLimitEntry>;
}

export interface CreateAppOptions {
  stores?: InMemoryStores;
  logger?: boolean;
  env?: ServiceEnv;
}

/**
 * Production endpoints that cannot give a real answer. Commands only get a
 * placeholder plan, since no executor is connected, and custom agents and
 * command results live in memory and vanish on restart.
 */
const PRODUCTION_UNAVAILABLE: readonly UnavailableEndpoint[] = [
  {
    route: "POST /agents",
    statusCode: 501,
    error: "not_implemented",
    message:
      "Custom agents are kept only in memory, so production does not accept them.",
  },
  {
    route: "POST /commands/execute",
    statusCode: 501,
    error: "not_implemented",
    message:
      "No command executor is connected, so production runs no commands.",
  },
  {
    route: "GET /commands/:id",
    statusCode: 501,
    error: "not_implemented",
    message:
      "No command executor is connected, so production runs no commands.",
  },
];

/**
 * Without a provider key the language model routes would answer with a local
 * text clean-up that only looks like a rewrite or a summary.
 */
const NO_PROVIDER_MESSAGE =
  "No language model provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.";
const PRODUCTION_UNAVAILABLE_WITHOUT_KEY: readonly UnavailableEndpoint[] = [
  "POST /llm/rewrite",
  "POST /llm/summarize",
].map((route) => ({
  route,
  statusCode: 503,
  error: "not_configured",
  message: NO_PROVIDER_MESSAGE,
}));

const createStores = (): InMemoryStores => ({
  rateLimits: new BoundedMap<string, RateLimitEntry>(MAX_RATE_LIMIT_ENTRIES),
  agents: new BoundedMap<string, AgentDefinition>(MAX_AGENTS, [
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
  commands: new BoundedMap<string, AgentCommandExecutionResult>(MAX_COMMANDS),
});

const getRouteContext = (request: FastifyRequest): { userId: string } => ({
  userId: getServiceUserId(request),
});

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
    // No executor integration exists yet, so nothing is ever reported as
    // completed: a non-dry-run command stays queued with its plan.
    status: blockedReason ? "blocked" : "queued",
    dryRun,
    createdAt: now,
    output: blockedReason
      ? undefined
      : dryRun
        ? "Dry run only; no external action was executed."
        : "Planned only; no executor is connected, so no external action was executed.",
    plannedActions,
    ...optionalProps({ transcriptId: input.transcriptId, blockedReason }),
  } as AgentCommandExecutionResult;
};

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores = options.stores ?? createStores();
  const env = options.env ?? process.env;
  const app = Fastify({ logger: options.logger ?? true });
  const production = isProduction(env);

  await app.register(helmet);
  await app.register(cors, { origin: false });
  registerServiceSecurity(app, { serviceName, env });
  if (production)
    disableEndpoints(app, [
      ...PRODUCTION_UNAVAILABLE,
      ...(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY
        ? []
        : PRODUCTION_UNAVAILABLE_WITHOUT_KEY),
    ]);

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
        const ownedAgents = [...stores.agents.values()].filter(
          (existing) => existing.userId === userId,
        ).length;
        if (ownedAgents >= MAX_CUSTOM_AGENTS_PER_USER)
          return reply.status(409).send({
            error: "agent_limit_reached",
            message: `A user can define at most ${MAX_CUSTOM_AGENTS_PER_USER} agents`,
          });
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

  /* ------------------------------------------------------------------ */
  /*  Rate limiter                                                      */
  /* ------------------------------------------------------------------ */

  const checkRateLimit = (userId: string): boolean => {
    const now = Date.now();
    const entry = stores.rateLimits.get(userId);
    if (!entry || now >= entry.resetAt) {
      // Re-insert so the entry counts as the newest one for eviction.
      stores.rateLimits.delete(userId);
      stores.rateLimits.set(userId, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (entry.count >= 30) return false;
    entry.count += 1;
    return true;
  };

  /* ------------------------------------------------------------------ */
  /*  Local fallback helpers                                            */
  /* ------------------------------------------------------------------ */

  const localRewrite = (text: string): string =>
    text
      .replace(/ {2,}/g, " ")
      .replace(
        /(^|[.!?]\s+)(\w)/g,
        (_m, prefix: string, char: string) => `${prefix}${char.toUpperCase()}`,
      );

  const localSummarize = (
    text: string,
    style: "brief" | "detailed" | "bullets" | "action-items",
  ): string => {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    switch (style) {
      case "brief":
        return sentences.slice(0, 3).join(" ").trim();
      case "detailed":
        return sentences.slice(0, 6).join(" ").trim();
      case "bullets":
        return sentences.map((s) => `- ${s.trim()}`).join("\n");
      case "action-items":
        return sentences.map((s) => `[ ] ${s.trim()}`).join("\n");
    }
  };

  /* ------------------------------------------------------------------ */
  /*  LLM fetch helpers                                                 */
  /* ------------------------------------------------------------------ */

  const upstreamError = (
    provider: string,
    detail: string,
  ): ServiceHttpError => {
    // Log the provider detail for operators; callers only get a generic error.
    app.log.error({ provider, detail }, "language model request failed");
    return new ServiceHttpError(
      502,
      "upstream_error",
      "The language model provider request failed",
    );
  };

  const postJson = async (
    provider: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw upstreamError(
        provider,
        error instanceof Error ? error.name : "request failed",
      );
    }
    if (!res.ok) throw upstreamError(provider, `HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw upstreamError(provider, "invalid JSON response");
    }
  };

  const callOpenAI = async (
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> => {
    const data = (await postJson(
      "openai",
      "https://api.openai.com/v1/chat/completions",
      { Authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}` },
      {
        model: env.SONOLECT_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2048,
      },
    )) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "")
      throw upstreamError("openai", "empty completion");
    return content;
  };

  const callAnthropic = async (
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> => {
    const data = (await postJson(
      "anthropic",
      "https://api.anthropic.com/v1/messages",
      {
        "x-api-key": env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      {
        model: env.SONOLECT_ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
    )) as { content?: { type?: string; text?: unknown }[] };
    const text = (data.content ?? [])
      .filter(
        (block) => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text as string)
      .join("");
    if (text.trim() === "")
      throw upstreamError("anthropic", "empty completion");
    return text;
  };

  const callLLM = async (
    provider: "openai" | "anthropic",
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> => {
    if (provider === "anthropic") {
      return callAnthropic(systemPrompt, userPrompt);
    }
    return callOpenAI(systemPrompt, userPrompt);
  };

  const resolveProvider = (
    preferred?: "openai" | "anthropic",
  ): { provider: "openai" | "anthropic"; hasKey: boolean } => {
    if (preferred === "anthropic" && env.ANTHROPIC_API_KEY) {
      return { provider: "anthropic", hasKey: true };
    }
    if (preferred === "openai" && env.OPENAI_API_KEY) {
      return { provider: "openai", hasKey: true };
    }
    if (!preferred) {
      if (env.OPENAI_API_KEY) return { provider: "openai", hasKey: true };
      if (env.ANTHROPIC_API_KEY) return { provider: "anthropic", hasKey: true };
    }
    return { provider: preferred ?? "openai", hasKey: false };
  };

  /** Production refuses the local fallback for a provider without a key. */
  const providerNotConfigured = (
    reply: FastifyReply,
    provider: "openai" | "anthropic",
  ): FastifyReply =>
    reply.status(503).send({
      error: "not_configured",
      message: `The ${provider} provider is not configured. Set ${
        provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
      }.`,
    });

  /* ------------------------------------------------------------------ */
  /*  POST /llm/rewrite                                                 */
  /* ------------------------------------------------------------------ */

  const rewriteBodySchema = z.object({
    text: z.string().min(1).max(MAX_LLM_INPUT_CHARS),
    style: z.enum(["formal", "casual", "concise", "expand"]),
    provider: z.enum(["openai", "anthropic"]).optional(),
  });

  app.post(
    "/llm/rewrite",
    async (
      request,
      reply,
    ): Promise<
      { original: string; rewritten: string; provider: string } | FastifyReply
    > => {
      try {
        const { userId } = getRouteContext(request);
        if (!checkRateLimit(userId)) {
          return reply
            .status(429)
            .send({ error: "rate_limit", message: "Too many requests" });
        }
        const input = parseBody<z.infer<typeof rewriteBodySchema>>(
          rewriteBodySchema,
          request,
        );
        const { provider, hasKey } = resolveProvider(input.provider);
        if (!hasKey && production)
          return providerNotConfigured(reply, provider);
        let rewritten: string;
        if (hasKey) {
          rewritten = await callLLM(
            provider,
            `You are a text rewriter. Rewrite the following text in a ${input.style} style. Return only the rewritten text.`,
            input.text,
          );
        } else {
          rewritten = localRewrite(input.text);
        }
        return {
          original: input.text,
          rewritten,
          provider: hasKey ? provider : "local",
        };
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  POST /llm/summarize                                               */
  /* ------------------------------------------------------------------ */

  const summarizeBodySchema = z.object({
    text: z.string().min(1).max(MAX_LLM_INPUT_CHARS),
    style: z.enum(["brief", "detailed", "bullets", "action-items"]),
    provider: z.enum(["openai", "anthropic"]).optional(),
  });

  app.post(
    "/llm/summarize",
    async (
      request,
      reply,
    ): Promise<
      { summary: string; style: string; provider: string } | FastifyReply
    > => {
      try {
        const { userId } = getRouteContext(request);
        if (!checkRateLimit(userId)) {
          return reply
            .status(429)
            .send({ error: "rate_limit", message: "Too many requests" });
        }
        const input = parseBody<z.infer<typeof summarizeBodySchema>>(
          summarizeBodySchema,
          request,
        );
        const { provider, hasKey } = resolveProvider(input.provider);
        if (!hasKey && production)
          return providerNotConfigured(reply, provider);
        let summary: string;
        if (hasKey) {
          summary = await callLLM(
            provider,
            `You are a text summarizer. Summarize the following text in "${input.style}" style. Return only the summary.`,
            input.text,
          );
        } else {
          summary = localSummarize(input.text, input.style);
        }
        return {
          summary,
          style: input.style,
          provider: hasKey ? provider : "local",
        };
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await createApp();
  await app.listen(resolveListenOptions());
}
