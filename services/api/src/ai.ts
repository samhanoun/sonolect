/**
 * Cloud dictation loop: Google Cloud Speech-to-Text v2 (transcribe) and Vertex
 * AI Gemini (polish). Clients are created lazily so the module imports without
 * credentials; the routes return a graceful 503 when GCP is not configured.
 *
 * Runtime config (env, supplied by Cloud Run):
 *   GCP_PROJECT_ID            required to enable the loop
 *   SONOLECT_STT_LOCATION     Speech-to-Text location (default "global")
 *   SONOLECT_VERTEX_LOCATION  Vertex AI region (default "us-central1")
 *   SONOLECT_GEMINI_MODEL     Gemini model id (default "gemini-2.5-flash")
 *
 * NOTE: not runtime-verified locally — validate against real GCP on first deploy.
 */
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { v2 as speech } from "@google-cloud/speech";
import { VertexAI } from "@google-cloud/vertexai";

/**
 * The polish model when SONOLECT_GEMINI_MODEL is unset or blank. Google
 * retires Gemini models on fixed dates, and Vertex AI retired this one on
 * October 16, 2026, so with it /v1/polish is expected to answer 502
 * model_not_found. Its replacement is an owner decision, because the newer
 * models may not be served in every region and this SDK only builds regional
 * hosts (docs/api.md). Keep infra/terraform on the same id.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** The model SONOLECT_GEMINI_MODEL names, or the default when it is unset or blank. */
export const resolveGeminiModel = (
  env: Record<string, string | undefined> = process.env,
): string => env.SONOLECT_GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

const projectId = process.env.GCP_PROJECT_ID;
const sttLocation = process.env.SONOLECT_STT_LOCATION ?? "global";
const vertexLocation = process.env.SONOLECT_VERTEX_LOCATION ?? "us-central1";
const geminiModel = resolveGeminiModel();

let speechClient: speech.SpeechClient | undefined;
let vertex: VertexAI | undefined;

export function aiConfigured(): boolean {
  return Boolean(projectId);
}

export type DictionaryHint = { spoken: string; written: string };

/**
 * Both routes spend money with Google on every call, and any signed-in
 * account can call them, so each account gets a request budget and the
 * polish input is bounded. Limits are per API instance (in memory).
 */
export type AiRouteLimits = {
  /** Requests per account per window, for each route. */
  maxRequests: number;
  windowMs: number;
};
export const DEFAULT_AI_ROUTE_LIMITS: AiRouteLimits = {
  maxRequests: 30,
  windowMs: 60_000,
};
export const MAX_POLISH_CHARS = 20_000;
export const MAX_DICTIONARY_ENTRIES = 200;
const MAX_HINT_CHARS = 100;
const MAX_OPTION_CHARS = 64;
/**
 * A style preset is a sentence of instructions the app sends with the text,
 * such as "Turn this into a short, polite reply ready to send". The longest
 * one the apps send today is 87 characters (apps/mobile/src/refine.ts). A
 * longer or malformed preset gets a 422: dropping it would turn a Rewrite or a
 * Reply into a plain polish without telling anyone.
 */
export const MAX_STYLE_PRESET_CHARS = 256;
/**
 * Google's synchronous recognize takes at most 10 MB of inline audio (and one
 * minute of speech). /v1/transcribe refuses a bigger body before reading it,
 * so the API never buffers audio that Google would reject.
 */
export const MAX_TRANSCRIBE_AUDIO_BYTES = 10 * 1024 * 1024;

export async function transcribeAudio(
  audio: Buffer,
  languageCode = "en-US",
): Promise<{ transcript: string; language: string }> {
  if (!projectId) throw new Error("GCP_PROJECT_ID is not configured");
  speechClient ??= new speech.SpeechClient();

  const recognizer = `projects/${projectId}/locations/${sttLocation}/recognizers/_`;
  const [response] = await speechClient.recognize({
    recognizer,
    config: {
      autoDecodingConfig: {},
      languageCodes: [languageCode === "auto" ? "en-US" : languageCode],
      model: "long",
    },
    content: audio,
  });

  const transcript = (response.results ?? [])
    .map((result) => result.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return { transcript, language: languageCode };
}

const SYSTEM_PROMPT = [
  "You are Sonolect's dictation editor.",
  "Rewrite raw speech-to-text into clean, polished written text.",
  "Remove filler words (um, uh, like), false starts, and stutters.",
  "Fix grammar, punctuation, and capitalization; format into clear sentences.",
  "Preserve the speaker's meaning, intent, names, and tone. Do NOT add new facts.",
  "Return ONLY the polished text with no preamble or quotes.",
].join(" ");

export async function polishTranscript(opts: {
  transcript: string;
  stylePreset?: string;
  dictionary?: DictionaryHint[];
  locale?: string;
}): Promise<{ polished: string; model: string }> {
  if (!projectId) throw new Error("GCP_PROJECT_ID is not configured");
  vertex ??= new VertexAI({ project: projectId, location: vertexLocation });

  const model = vertex.getGenerativeModel({
    model: geminiModel,
    systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
  });

  const style = opts.stylePreset ? `Style: ${opts.stylePreset}.` : "";
  const dictionary = opts.dictionary?.length
    ? `Preserve these exact spellings: ${opts.dictionary
        .map((entry) => `"${entry.spoken}" -> "${entry.written}"`)
        .join(", ")}.`
    : "";
  const prompt = `${style} ${dictionary}`.trim();

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: `${prompt}\n\nRaw dictation:\n${opts.transcript}`.trim() },
        ],
      },
    ],
  });

  return { polished: polishedText(result.response), model: geminiModel };
}

/** The parts of a Vertex AI answer that polishTranscript reads. */
export interface PolishModelResponse {
  candidates?: ReadonlyArray<{
    finishReason?: string;
    content?: { parts?: ReadonlyArray<{ text?: string }> };
  }>;
}

/** The model answered, but not with a complete text the route can return. */
export class UnusablePolishError extends Error {
  readonly code: "polish_empty" | "polish_incomplete";
  /** The model's finish reason, for the log. Never sent to the client. */
  readonly finishReason: string | undefined;

  constructor(
    code: "polish_empty" | "polish_incomplete",
    finishReason?: string,
  ) {
    super(
      code === "polish_empty"
        ? "The model returned no text."
        : "The model stopped before the answer was complete.",
    );
    this.name = "UnusablePolishError";
    this.code = code;
    this.finishReason = finishReason;
  }
}

/**
 * The polished text of a model answer. Only a first candidate that stopped
 * normally (`STOP`) with some text counts. An answer cut off at the token
 * limit, or stopped by a safety or other filter, is not a polished version of
 * the dictation, so this throws UnusablePolishError and the route answers 502.
 * It never falls back to the raw transcript.
 */
export function polishedText(response: PolishModelResponse): string {
  const candidate = response.candidates?.[0];
  if (!candidate) throw new UnusablePolishError("polish_empty");
  if (candidate.finishReason !== "STOP")
    throw new UnusablePolishError("polish_incomplete", candidate.finishReason);
  const text = (candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new UnusablePolishError("polish_empty", "STOP");
  return text;
}

const errorBody = (code: string, message: string, retryable: boolean) => ({
  error: { code, message, retryable },
});

const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
/** A canonical status name such as NOT_FOUND, not an HTTP status text. */
const STATUS_NAME = /^[A-Z][A-Z_]*$/;

/**
 * What a provider error means for the client, when that is known.
 *
 * - `not_found`: the model, recognizer or project is gone, for example a
 *   retired Gemini model. It fails the same way until the config changes.
 * - `invalid_argument`: Google refused this input, for example audio longer
 *   than one minute. Sending it again fails the same way.
 *
 * Speech-to-Text (google-gax) errors carry a numeric gRPC `code`. Vertex AI
 * throws a ClientError whose `cause` holds the HTTP `code` and the `status`
 * name. When Google's answer is not JSON, that `status` is the HTTP status
 * text, such as "Not Found", so the HTTP `code` decides. Anything else, such
 * as quota, timeouts or network errors, is undefined and stays retryable.
 */
export const classifyProviderError = (
  error: unknown,
): "not_found" | "invalid_argument" | undefined => {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { code, status, cause } = current as {
      code?: unknown;
      status?: unknown;
      cause?: unknown;
    };
    if (typeof status === "string" && STATUS_NAME.test(status)) {
      if (status === "NOT_FOUND") return "not_found";
      if (status === "INVALID_ARGUMENT") return "invalid_argument";
    } else if (typeof code === "number") {
      if (code === GRPC_NOT_FOUND || code === 404) return "not_found";
      if (code === GRPC_INVALID_ARGUMENT || code === 400)
        return "invalid_argument";
    }
    current = cause;
  }
  return undefined;
};

type ProviderFailure = {
  statusCode: number;
  body: ReturnType<typeof errorBody>;
};

/** The answer for a provider error. The error itself is only logged. */
const providerFailure = (
  error: unknown,
  route: "transcribe" | "polish",
): ProviderFailure => {
  switch (classifyProviderError(error)) {
    case "not_found":
      return {
        statusCode: 502,
        body: errorBody(
          "model_not_found",
          route === "transcribe"
            ? "The configured speech model is not available."
            : "The configured model is not available.",
          false,
        ),
      };
    case "invalid_argument":
      return route === "transcribe"
        ? {
            statusCode: 422,
            body: errorBody(
              "audio_rejected",
              "The audio was refused. Send at most one minute of audio in a supported format.",
              false,
            ),
          }
        : {
            statusCode: 422,
            body: errorBody("polish_rejected", "The text was refused.", false),
          };
    default:
      return route === "transcribe"
        ? {
            statusCode: 503,
            body: errorBody("transcribe_failed", "Transcription failed.", true),
          }
        : {
            statusCode: 503,
            body: errorBody("polish_failed", "Polish failed.", true),
          };
  }
};

const getQueryLanguage = (request: FastifyRequest): string => {
  const language = (request.query as { language?: string } | undefined)
    ?.language;
  return typeof language === "string" && language.trim() ? language : "en-US";
};

const rateLimitConfig = (limits: AiRouteLimits) => ({
  rateLimit: {
    max: limits.maxRequests,
    timeWindow: limits.windowMs,
    // The verified account, so one user cannot exhaust another's budget and
    // switching IP addresses does not reset it.
    keyGenerator: (request: FastifyRequest) =>
      request.actor?.userId ? `user:${request.actor.userId}` : request.ip,
    errorResponseBuilder: (
      _request: FastifyRequest,
      context: { after: string; statusCode: number },
    ) => ({
      statusCode: context.statusCode,
      ...errorBody(
        "rate_limited",
        `Too many requests. Try again in ${context.after}.`,
        true,
      ),
    }),
  },
});

const isShortString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/**
 * Control characters, line breaks included. The style preset and the
 * dictionary go into the prompt's instructions, ahead of the "Raw dictation:"
 * marker, so a line break in them could fake that marker and add instructions.
 */
const CONTROL_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;

const isOneLine = (value: string): boolean => !CONTROL_CHARACTER.test(value);

const isHint = (value: unknown): value is string =>
  isShortString(value, MAX_HINT_CHARS) && isOneLine(value);

/** The trimmed preset, `undefined` when none was sent, or `null` when invalid. */
const readStylePreset = (value: unknown): string | undefined | null => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const preset = value.trim();
  if (preset.length > MAX_STYLE_PRESET_CHARS || !isOneLine(preset)) return null;
  return preset || undefined;
};

/** The Google calls behind the /v1 routes. Tests replace them. */
export interface AiProviders {
  configured: () => boolean;
  transcribe: typeof transcribeAudio;
  polish: typeof polishTranscript;
}

const googleProviders: AiProviders = {
  configured: aiConfigured,
  transcribe: transcribeAudio,
  polish: polishTranscript,
};

/**
 * Registers POST /v1/transcribe and POST /v1/polish on an existing Fastify app.
 * Audio bodies are parsed by the app's audio content-type parser (Buffer).
 * The app must have @fastify/rate-limit registered (createApp does).
 * `maxAudioBytes` can only lower the transcribe body limit below
 * MAX_TRANSCRIBE_AUDIO_BYTES.
 */
export function registerAiRoutes(
  app: FastifyInstance,
  limits: AiRouteLimits = DEFAULT_AI_ROUTE_LIMITS,
  providers: Partial<AiProviders> = {},
  {
    maxAudioBytes = MAX_TRANSCRIBE_AUDIO_BYTES,
  }: { maxAudioBytes?: number } = {},
): void {
  const ai = { ...googleProviders, ...providers };
  const config = rateLimitConfig(limits);
  const audioLimit = Math.min(maxAudioBytes, MAX_TRANSCRIBE_AUDIO_BYTES);
  app.post(
    "/v1/transcribe",
    {
      config,
      bodyLimit: audioLimit,
      // Fastify stops reading the body at the limit and raises this error.
      errorHandler: (error: FastifyError, _request, reply) => {
        if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE")
          return reply
            .status(413)
            .send(
              errorBody(
                "audio_too_large",
                `Send at most ${audioLimit} bytes of audio (about one minute).`,
                false,
              ),
            );
        // Other errors go on to the app's handler. The rate limiter throws a
        // plain object, not an Error: rethrown, Fastify would send it with
        // status 200, so it is sent here with its own status.
        if (error instanceof Error) throw error;
        const { statusCode } = error as { statusCode?: unknown };
        return reply
          .status(typeof statusCode === "number" ? statusCode : 500)
          .send(error);
      },
    },
    async (request, reply): Promise<unknown> => {
      if (!ai.configured()) {
        return reply
          .status(503)
          .send(
            errorBody(
              "not_configured",
              "Cloud transcription is not configured (GCP_PROJECT_ID missing).",
              false,
            ),
          );
      }
      if (!Buffer.isBuffer(request.body)) {
        return reply
          .status(400)
          .send(
            errorBody(
              "invalid_audio",
              "Send audio bytes with an audio/* Content-Type.",
              false,
            ),
          );
      }
      try {
        const result = await ai.transcribe(
          request.body,
          getQueryLanguage(request),
        );
        return result;
      } catch (error) {
        // Provider errors can name projects and quotas: log them, don't return them.
        const failure = providerFailure(error, "transcribe");
        request.log.error(
          { err: error, code: failure.body.error.code },
          "cloud transcription failed",
        );
        return reply.status(failure.statusCode).send(failure.body);
      }
    },
  );

  app.post(
    "/v1/polish",
    { config },
    async (request, reply): Promise<unknown> => {
      const body = request.body as
        | {
            transcript?: unknown;
            stylePreset?: unknown;
            dictionary?: unknown;
            locale?: unknown;
          }
        | undefined;
      if (
        !body ||
        typeof body.transcript !== "string" ||
        !body.transcript.trim()
      ) {
        return reply
          .status(400)
          .send(
            errorBody(
              "invalid_request",
              "A non-empty transcript is required.",
              false,
            ),
          );
      }
      if (
        body.transcript.length > MAX_POLISH_CHARS ||
        (Array.isArray(body.dictionary) &&
          body.dictionary.length > MAX_DICTIONARY_ENTRIES)
      ) {
        return reply
          .status(413)
          .send(
            errorBody(
              "too_large",
              `Send at most ${MAX_POLISH_CHARS} characters and ${MAX_DICTIONARY_ENTRIES} dictionary entries.`,
              false,
            ),
          );
      }
      const stylePreset = readStylePreset(body.stylePreset);
      if (stylePreset === null) {
        return reply
          .status(422)
          .send(
            errorBody(
              "invalid_style_preset",
              `stylePreset must be one line of text of at most ${MAX_STYLE_PRESET_CHARS} characters.`,
              false,
            ),
          );
      }
      if (!ai.configured()) {
        return reply
          .status(503)
          .send(
            errorBody(
              "not_configured",
              "Cloud polish is not configured (GCP_PROJECT_ID missing).",
              false,
            ),
          );
      }
      try {
        const dictionary = Array.isArray(body.dictionary)
          ? (body.dictionary as DictionaryHint[]).filter(
              (entry) => entry && isHint(entry.spoken) && isHint(entry.written),
            )
          : undefined;
        const result = await ai.polish({
          transcript: body.transcript,
          ...(stylePreset ? { stylePreset } : {}),
          ...(dictionary ? { dictionary } : {}),
          ...(isShortString(body.locale, MAX_OPTION_CHARS)
            ? { locale: body.locale }
            : {}),
        });
        // Never hand the raw transcript back as if the model had polished it.
        if (!result.polished.trim())
          throw new UnusablePolishError("polish_empty");
        return result;
      } catch (error) {
        if (error instanceof UnusablePolishError) {
          request.log.warn(
            { code: error.code, finishReason: error.finishReason },
            "cloud polish gave no usable text",
          );
          // A cut-off or filtered answer would likely end the same way again.
          return reply
            .status(502)
            .send(
              errorBody(
                error.code,
                error.message,
                error.code === "polish_empty",
              ),
            );
        }
        const failure = providerFailure(error, "polish");
        request.log.error(
          { err: error, code: failure.body.error.code },
          "cloud polish failed",
        );
        return reply.status(failure.statusCode).send(failure.body);
      }
    },
  );
}
