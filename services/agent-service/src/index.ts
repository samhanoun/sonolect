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
}

const createStores = (): InMemoryStores => ({
  rateLimits: new Map<string, RateLimitEntry>(),
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

  /* ------------------------------------------------------------------ */
  /*  Rate limiter                                                      */
  /* ------------------------------------------------------------------ */

  const checkRateLimit = (userId: string): boolean => {
    const now = Date.now();
    const entry = stores.rateLimits.get(userId);
    if (!entry || now >= entry.resetAt) {
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

  const callOpenAI = async (
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2048,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0]?.message.content ?? "";
  };

  const callAnthropic = async (
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = (await res.json()) as {
      content: { text: string }[];
    };
    return data.content[0]?.text ?? "";
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
    if (preferred === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      return { provider: "anthropic", hasKey: true };
    }
    if (preferred === "openai" && process.env.OPENAI_API_KEY) {
      return { provider: "openai", hasKey: true };
    }
    if (!preferred) {
      if (process.env.OPENAI_API_KEY)
        return { provider: "openai", hasKey: true };
      if (process.env.ANTHROPIC_API_KEY)
        return { provider: "anthropic", hasKey: true };
    }
    return { provider: preferred ?? "openai", hasKey: false };
  };

  /* ------------------------------------------------------------------ */
  /*  POST /llm/rewrite                                                 */
  /* ------------------------------------------------------------------ */

  const rewriteBodySchema = z.object({
    text: z.string().min(1),
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
    text: z.string().min(1),
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
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port });
}
