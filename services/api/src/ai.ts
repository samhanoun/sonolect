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

  const polished = (result.response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return { polished: polished || opts.transcript, model: geminiModel };
}

const errorBody = (code: string, message: string, retryable: boolean) => ({
  error: { code, message, retryable },
});

const getQueryLanguage = (request: FastifyRequest): string => {
  const language = (request.query as { language?: string } | undefined)
    ?.language;
  return typeof language === "string" && language.trim() ? language : "en-US";
};

/**
 * Registers POST /v1/transcribe and POST /v1/polish on an existing Fastify app.
 * Audio bodies are parsed by the app's audio content-type parser (Buffer).
 */
export function registerAiRoutes(app: FastifyInstance): void {
  app.post("/v1/transcribe", async (request, reply): Promise<unknown> => {
    if (!aiConfigured()) {
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
      const result = await transcribeAudio(
        request.body,
        getQueryLanguage(request),
      );
      return result;
    } catch (error) {
      return reply
        .status(503)
        .send(
          errorBody(
            "transcribe_failed",
            error instanceof Error ? error.message : "Transcription failed.",
            true,
          ),
        );
    }
  });

  app.post("/v1/polish", async (request, reply): Promise<unknown> => {
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
    if (!aiConfigured()) {
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
              typeof entry.spoken === "string" &&
              typeof entry.written === "string",
          )
        : undefined;
      const result = await polishTranscript({
        transcript: body.transcript,
        ...(typeof body.stylePreset === "string"
          ? { stylePreset: body.stylePreset }
          : {}),
        ...(dictionary ? { dictionary } : {}),
        ...(typeof body.locale === "string" ? { locale: body.locale } : {}),
      });
      return result;
    } catch (error) {
      return reply
        .status(503)
        .send(
          errorBody(
            "polish_failed",
            error instanceof Error ? error.message : "Polish failed.",
            true,
          ),
        );
    }
  });
}
