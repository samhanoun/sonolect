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
import type {
  RefinementResult,
  SttProviderName,
  TranscriptionJob,
  TranscriptionSegment,
} from "@sonolect/types";
import { buildRefinementPrompt } from "@sonolect/prompts";
import {
  refinementRequestSchema,
  transcriptionJobRequestSchema,
  type RefinementInput,
  type TranscriptionJobInput,
} from "@sonolect/validation";

const serviceName = "sonolect-audio-service";
const localUserId = "local-user";

interface SttProvider {
  name: SttProviderName;
  transcribe(input: TranscriptionJobInput): Promise<{
    text: string;
    confidence: number;
    segments: TranscriptionSegment[];
  }>;
}

interface InMemoryStores {
  transcriptionJobs: Map<string, TranscriptionJob>;
  refinements: Map<string, RefinementResult>;
}

export interface CreateAppOptions {
  stores?: InMemoryStores;
  logger?: boolean;
}

const createStores = (): InMemoryStores => ({
  transcriptionJobs: new Map<string, TranscriptionJob>(),
  refinements: new Map<string, RefinementResult>(),
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

const mockProvider: SttProvider = {
  name: "mock",
  async transcribe(input) {
    const source = input.audio.uri
      ? `audio at ${input.audio.uri}`
      : "inline audio payload";
    const text = `[mock transcript:${input.language}] Transcription placeholder for ${source}.`;
    return {
      text,
      confidence: 0.99,
      segments: [{ text, startMs: 0, confidence: 0.99 }],
    };
  },
};

const googlePlaceholderProvider: SttProvider = {
  name: "google",
  async transcribe(input) {
    const model = input.model ?? "latest_long";
    const source = input.audio.uri
      ? `audio at ${input.audio.uri}`
      : "inline audio payload";
    const text = `[google speech-to-text placeholder:${model}:${input.language}] Transcription would be requested for ${source}.`;
    return {
      text,
      confidence: 0,
      segments: [{ text, startMs: 0, confidence: 0 }],
    };
  },
};

const resolveProvider = (requested?: SttProviderName): SttProvider => {
  const selected =
    requested ??
    (process.env.STT_PROVIDER as SttProviderName | undefined) ??
    "mock";
  return selected === "google" ? googlePlaceholderProvider : mockProvider;
};

const processTranscriptionJob = async (
  job: TranscriptionJob,
  input: TranscriptionJobInput,
): Promise<TranscriptionJob> => {
  if (job.status === "cancelled") return job;
  const now = new Date().toISOString();
  const provider = resolveProvider(input.provider);
  try {
    const result = await provider.transcribe(input);
    return {
      ...job,
      status: "completed",
      updatedAt: now,
      completedAt: now,
      transcriptText: result.text,
      confidence: result.confidence,
      segments: result.segments,
    };
  } catch (error) {
    return {
      ...job,
      status: "failed",
      updatedAt: now,
      error: error instanceof Error ? error.message : "Transcription failed",
    };
  }
};

const cleanText = (text: string): string =>
  text
    .replace(/\b(um|uh|erm|euh|bah)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

const refineText = (input: RefinementInput): string => {
  const cleaned = cleanText(input.text);
  switch (input.action) {
    case "clean":
      return cleaned;
    case "rewrite":
      return `${cleaned}${input.instructions ? `\n\nApplied instructions: ${input.instructions}` : ""}`;
    case "summarize": {
      const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
      return sentences.length <= 2 ? cleaned : sentences.slice(0, 2).join(" ");
    }
    case "translate":
      return `[${input.targetLanguage} translation placeholder] ${cleaned}`;
  }
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
    sttProvider:
      (process.env.STT_PROVIDER as SttProviderName | undefined) ?? "mock",
  }));

  app.post(
    "/transcriptions",
    async (request, reply): Promise<TranscriptionJob | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const input = parseBody<TranscriptionJobInput>(
          transcriptionJobRequestSchema,
          request,
        );
        const provider = resolveProvider(input.provider);
        const now = new Date().toISOString();
        const job = {
          id: randomUUID(),
          userId,
          status: "processing" as const,
          provider: provider.name,
          language: input.language,
          createdAt: now,
          updatedAt: now,
          audio: input.audio,
          segments: [],
          metadata: input.metadata,
          ...optionalProps({
            model: input.model,
            callbackUrl: input.callbackUrl,
          }),
        } as TranscriptionJob;
        stores.transcriptionJobs.set(job.id, job);
        const completed = await processTranscriptionJob(job, input);
        stores.transcriptionJobs.set(completed.id, completed);
        return reply.status(202).send(completed);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/transcriptions/:id",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const job = stores.transcriptionJobs.get(request.params.id);
      if (!job || job.userId !== userId)
        return reply
          .status(404)
          .send({ error: "not_found", message: "Transcription job not found" });
      return job;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/transcriptions/:id/cancel",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const job = stores.transcriptionJobs.get(request.params.id);
      if (!job || job.userId !== userId)
        return reply
          .status(404)
          .send({ error: "not_found", message: "Transcription job not found" });
      if (job.status === "completed")
        return reply.status(409).send({
          error: "already_completed",
          message: "Completed jobs cannot be cancelled",
        });
      const cancelled = {
        ...job,
        status: "cancelled" as const,
        updatedAt: new Date().toISOString(),
      };
      stores.transcriptionJobs.set(job.id, cancelled);
      return cancelled;
    },
  );

  app.post(
    "/refinements",
    async (request, reply): Promise<RefinementResult | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const input = parseBody<RefinementInput>(
          refinementRequestSchema,
          request,
        );
        const createdAt = new Date().toISOString();
        const result = {
          id: randomUUID(),
          userId,
          action: input.action,
          inputText: input.text,
          outputText: refineText(input),
          provider: "template" as const,
          createdAt,
          ...optionalProps({
            language: input.language,
            targetLanguage: input.targetLanguage,
          }),
        } as RefinementResult & { prompt: string };
        stores.refinements.set(result.id, result);
        return reply
          .status(200)
          .send({ ...result, prompt: buildRefinementPrompt(input) });
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
