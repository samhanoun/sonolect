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

  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port });
}
