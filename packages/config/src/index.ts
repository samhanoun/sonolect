export const SONOLECT_APP_NAME = "Sonolect";
export const SONOLECT_TAGLINE = "Speak. Refine. Act.";
export const DEFAULT_REGION = "europe-west1";

export const SECURITY_LOGGING_DENYLIST = [
  "raw_audio",
  "full_transcript",
  "selected_text",
  "private_generated_response",
  "token",
  "api_key",
  "payment_data",
  "signed_url",
  "sensitive_prompt",
] as const;

export {
  buildCspDirectives,
  serializeCsp,
  buildSecurityHeaders,
  fastifySecurityConfig,
} from "./securityHeaders";
export type {
  CspDirectives,
  SecurityHeadersOptions,
} from "./securityHeaders";

export {
  DEFAULT_RATE_LIMITS,
  createPreset,
  buildRateLimitConfig,
  toFastifyRateLimitOptions,
} from "./rateLimiting";
export type {
  RateLimitPreset,
  RateLimitConfig,
} from "./rateLimiting";
