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
import type { EnqueueWorkerTaskRequest, WorkerTask } from "@sonolect/types";
import {
  enqueueWorkerTaskSchema,
  type EnqueueWorkerTaskInput,
} from "@sonolect/validation";

const serviceName = "sonolect-worker-service";

interface WorkerStores {
  tasks: Map<string, WorkerTask>;
}

type TaskHandler = (task: WorkerTask) => Promise<Record<string, unknown>>;

const createStores = (): WorkerStores => ({ tasks: new Map() });

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

const createDispatcher = (): Record<
  EnqueueWorkerTaskRequest["kind"],
  TaskHandler
> => ({
  audio: async (task) => ({
    accepted: true,
    action: "audio_task_dispatched",
    taskType: task.type,
    note: "Placeholder for transcription, normalization, and audio lifecycle jobs.",
  }),
  agent: async (task) => ({
    accepted: true,
    action: "agent_task_dispatched",
    taskType: task.type,
    note: "Placeholder for rewrite, command, and custom agent jobs.",
  }),
  billing: async (task) => ({
    accepted: true,
    action: "billing_task_dispatched",
    taskType: task.type,
    note: "Placeholder for usage rollups, quota checks, and Stripe reconciliation jobs.",
  }),
});

const enqueueTask = (
  stores: WorkerStores,
  input: EnqueueWorkerTaskInput,
): WorkerTask => {
  const now = new Date().toISOString();
  const task: WorkerTask = {
    id: randomUUID(),
    kind: input.kind,
    type: input.type,
    payload: input.payload,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  stores.tasks.set(task.id, task);
  return task;
};

const dispatchTask = async (
  stores: WorkerStores,
  dispatcher: ReturnType<typeof createDispatcher>,
  taskId: string,
): Promise<WorkerTask | undefined> => {
  const task = stores.tasks.get(taskId);
  if (!task) return undefined;
  const processing: WorkerTask = {
    ...task,
    status: "processing",
    attempts: task.attempts + 1,
    updatedAt: new Date().toISOString(),
  };
  stores.tasks.set(taskId, processing);
  try {
    const result = await dispatcher[processing.kind](processing);
    const completed: WorkerTask = {
      ...processing,
      status: "completed",
      payload: { input: processing.payload, result },
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    stores.tasks.set(taskId, completed);
    return completed;
  } catch (error) {
    const failed: WorkerTask = {
      ...processing,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown worker error",
      updatedAt: new Date().toISOString(),
    };
    stores.tasks.set(taskId, failed);
    return failed;
  }
};

export interface CreateAppOptions {
  stores?: WorkerStores;
  logger?: boolean;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores = options.stores ?? createStores();
  const dispatcher = createDispatcher();
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });

  app.get("/health", async () => ({ status: "ok", service: serviceName }));

  app.get("/tasks", async () => ({
    items: [...stores.tasks.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  }));

  app.post(
    "/tasks",
    async (request, reply): Promise<WorkerTask | FastifyReply> => {
      try {
        const task = enqueueTask(
          stores,
          parseBody<EnqueueWorkerTaskInput>(enqueueWorkerTaskSchema, request),
        );
        return reply.status(202).send(task);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.post("/events/audio", async (request, reply) => {
    const task = enqueueTask(stores, {
      kind: "audio",
      type: "audio.event",
      payload: request.body ?? {},
    });
    return reply.status(202).send(task);
  });

  app.post("/events/agent", async (request, reply) => {
    const task = enqueueTask(stores, {
      kind: "agent",
      type: "agent.event",
      payload: request.body ?? {},
    });
    return reply.status(202).send(task);
  });

  app.post("/events/billing", async (request, reply) => {
    const task = enqueueTask(stores, {
      kind: "billing",
      type: "billing.event",
      payload: request.body ?? {},
    });
    return reply.status(202).send(task);
  });

  app.post<{ Params: { id: string } }>(
    "/tasks/:id/dispatch",
    async (request, reply) => {
      const task = await dispatchTask(stores, dispatcher, request.params.id);
      if (!task)
        return reply
          .status(404)
          .send({ error: "not_found", message: "Task not found" });
      return task;
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
