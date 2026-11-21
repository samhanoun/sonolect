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
import {
  BoundedMap,
  ServiceHttpError,
  disableEndpoints,
  getServiceUserId,
  registerServiceSecurity,
  resolveListenOptions,
  type UnavailableEndpoint,
} from "@sonolect/service-kit";

const serviceName = "sonolect-audio-service";
const MAX_TRANSCRIPTION_JOBS = 5_000;
const MAX_REFINEMENTS = 5_000;

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
  env?: NodeJS.ProcessEnv;
}

class ProviderNotConfiguredError extends Error {
  readonly code = "provider_not_configured";

  constructor(provider: SttProviderName, missingEnv: string[]) {
    super(
      `${provider} STT provider_not_configured: missing required environment variable${missingEnv.length === 1 ? "" : "s"} ${missingEnv.join(
        ", ",
      )}`,
    );
    this.name = "ProviderNotConfiguredError";
  }
}

class ProviderUnavailableError extends Error {
  readonly code = "provider_unavailable";

  constructor(provider: SttProviderName, reason: string) {
    super(`${provider} STT provider_unavailable: ${reason}`);
    this.name = "ProviderUnavailableError";
  }
}

type SttProviderEnv = Partial<
  Pick<NodeJS.ProcessEnv, "STT_PROVIDER" | "GOOGLE_CLOUD_PROJECT" | "NODE_ENV">
>;

const isProduction = (env: SttProviderEnv): boolean =>
  env.NODE_ENV === "production";

interface ProviderSelectionOptions {
  requested?: SttProviderName | undefined;
  env?: SttProviderEnv | undefined;
}

/**
 * No provider can transcribe in production: the mock is off there, and the
 * google provider always fails because Google Speech-to-Text runs in the API
 * service. The job endpoints answer 501 instead of storing a failed job in
 * memory.
 */
const TRANSCRIPTION_UNAVAILABLE_MESSAGE =
  "This service cannot transcribe in production. The API serves POST /v1/transcribe.";
const PRODUCTION_UNAVAILABLE: readonly UnavailableEndpoint[] = [
  "POST /transcriptions",
  "GET /transcriptions/:id",
  "POST /transcriptions/:id/cancel",
].map((route) => ({
  route,
  statusCode: 501,
  error: "not_implemented",
  message: TRANSCRIPTION_UNAVAILABLE_MESSAGE,
}));
const PRODUCTION_NOTES = [
  "POST /refinements: rewrite and translate answer 501; clean and summarize use the template provider",
];

const createStores = (): InMemoryStores => ({
  transcriptionJobs: new BoundedMap<string, TranscriptionJob>(
    MAX_TRANSCRIPTION_JOBS,
  ),
  refinements: new BoundedMap<string, RefinementResult>(MAX_REFINEMENTS),
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

const validateGoogleSttConfiguration = (env: SttProviderEnv): void => {
  const missingEnv = ["GOOGLE_CLOUD_PROJECT"].filter(
    (key) => !env[key as keyof SttProviderEnv],
  );
  if (missingEnv.length > 0) {
    throw new ProviderNotConfiguredError("google", missingEnv);
  }
};

// Google Speech-to-Text runs in the API service (POST /v1/transcribe). This
// service has no Google client yet, so a google job fails with a clear error
// instead of returning made-up transcript text.
const createGoogleProvider = (env: SttProviderEnv): SttProvider => ({
  name: "google",
  async transcribe() {
    validateGoogleSttConfiguration(env);
    throw new ProviderUnavailableError(
      "google",
      "Google Speech-to-Text is served by the API service at POST /v1/transcribe",
    );
  },
});

// The mock provider exists for local development and tests only. Production
// must never hand a fabricated transcript back to a user.
const createMockProvider = (env: SttProviderEnv): SttProvider =>
  isProduction(env)
    ? {
        name: "mock",
        async transcribe() {
          throw new ProviderUnavailableError(
            "mock",
            "the mock provider is disabled in production",
          );
        },
      }
    : mockProvider;

const resolveConfiguredProviderName = (
  env: SttProviderEnv = process.env,
): SttProviderName => {
  const selected = env.STT_PROVIDER ?? "mock";
  return selected === "google" ? "google" : "mock";
};

const resolveProvider = ({
  requested,
  env = process.env,
}: ProviderSelectionOptions = {}): SttProvider => {
  const selected = requested ?? resolveConfiguredProviderName(env);
  return selected === "google"
    ? createGoogleProvider(env)
    : createMockProvider(env);
};

const processTranscriptionJob = async (
  job: TranscriptionJob,
  input: TranscriptionJobInput,
  env: SttProviderEnv = process.env,
): Promise<TranscriptionJob> => {
  if (job.status === "cancelled") return job;
  const now = new Date().toISOString();
  const provider = resolveProvider({ requested: input.provider, env });
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
  const env = options.env ?? process.env;
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });
  registerServiceSecurity(app, { serviceName, env });
  if (isProduction(env))
    disableEndpoints(app, PRODUCTION_UNAVAILABLE, PRODUCTION_NOTES);

  app.get("/health", async () => ({
    status: "ok",
    service: serviceName,
    // The mock provider is switched off in production, so do not advertise it.
    sttProvider:
      isProduction(env) && resolveConfiguredProviderName(env) === "mock"
        ? "unconfigured"
        : resolveConfiguredProviderName(env),
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
        const provider = resolveProvider({ requested: input.provider, env });
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
        const completed = await processTranscriptionJob(job, input, env);
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
        // Rewrite and translate need a language model. The template output
        // below is a development stand-in, so production refuses it rather
        // than return text that only looks rewritten or translated.
        if (
          isProduction(env) &&
          (input.action === "rewrite" || input.action === "translate")
        )
          throw new ServiceHttpError(
            501,
            "refinement_unavailable",
            `The ${input.action} refinement is not available on this service`,
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
  await app.listen(resolveListenOptions());
}
