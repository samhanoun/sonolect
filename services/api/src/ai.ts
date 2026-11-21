/**
 * Cloud dictation loop: Google Cloud Speech-to-Text v2 (transcribe) and Vertex
 * AI Gemini (polish). Clients are created lazily so the module imports without
 * credentials; the routes return a graceful 503 when GCP is not configured.
 *
 * Runtime config (env, supplied by Cloud Run):
 *   GCP_PROJECT_ID            required to enable the loop
 *   SONOLECT_STT_LOCATION     Speech-to-Text location (default "global")
 *   SONOLECT_VERTEX_LOCATION  Vertex AI region (default "us-central1")
 *   SONOLECT_GEMINI_MODEL     Gemini model id (default "gemini-2.0-flash")
 *
 * NOTE: not runtime-verified locally — validate against real GCP on first deploy.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v2 as speech } from "@google-cloud/speech";
import { VertexAI } from "@google-cloud/vertexai";

const projectId = process.env.GCP_PROJECT_ID;
const sttLocation = process.env.SONOLECT_STT_LOCATION ?? "global";
const vertexLocation = process.env.SONOLECT_VERTEX_LOCATION ?? "us-central1";
const geminiModel = process.env.SONOLECT_GEMINI_MODEL ?? "gemini-2.0-flash";

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

/** The trimmed preset, `undefined` when none was sent, or `null` when invalid. */
const readStylePreset = (value: unknown): string | undefined | null => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const preset = value.trim();
  if (preset.length > MAX_STYLE_PRESET_CHARS) return null;
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
 */
export function registerAiRoutes(
  app: FastifyInstance,
  limits: AiRouteLimits = DEFAULT_AI_ROUTE_LIMITS,
  providers: Partial<AiProviders> = {},
): void {
  const ai = { ...googleProviders, ...providers };
  const config = rateLimitConfig(limits);
  app.post(
    "/v1/transcribe",
    { config },
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
        request.log.error({ err: error }, "cloud transcription failed");
        return reply
          .status(503)
          .send(errorBody("transcribe_failed", "Transcription failed.", true));
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
              `stylePreset must be text of at most ${MAX_STYLE_PRESET_CHARS} characters.`,
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
              (entry) =>
                entry &&
                isShortString(entry.spoken, MAX_HINT_CHARS) &&
                isShortString(entry.written, MAX_HINT_CHARS),
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
        request.log.error({ err: error }, "cloud polish failed");
        return reply
          .status(503)
          .send(errorBody("polish_failed", "Polish failed.", true));
      }
    },
  );
}
